import type {
    ApiFormat,
    BuiltInProviderId,
    BuiltInProviderSetting,
    CustomProviderConfig,
    PolishPrompt,
    ProviderId,
    Settings,
} from '@/types';
import { POLISH_TEMPLATE_NAMES } from '@/types';
import { POLISH_PROMPTS, POLISH_TEMPLATE_DESCRIPTIONS } from '@/services/prompts';
import {
    BUILTIN_PROVIDER_IDS,
    BUILTIN_PROVIDERS,
    DEFAULT_OPENAI_MODEL,
    getProviderDefinition,
    isBuiltInProviderId,
    normalizeModelName,
    normalizeModelNameForProvider,
} from '@/services/models';

export const DEFAULT_CUSTOM_PROVIDER_ID = 'custom_default';

const sanitizeApiSecret = (value?: string | null): string => {
    if (typeof value !== 'string') {
        return '';
    }
    let result = '';
    for (const ch of value) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
            continue;
        }
        result += ch;
    }
    return result.trim();
};

export const buildDefaultPrompts = (): PolishPrompt[] => {
    return Object.entries(POLISH_PROMPTS).map(([key, content]) => ({
        id: key,
        template: key,
        name: POLISH_TEMPLATE_NAMES[key] || key,
        description: POLISH_TEMPLATE_DESCRIPTIONS[key] || '',
        content,
    }));
};

export const buildDefaultProviderConfigs = (): Record<
    BuiltInProviderId,
    BuiltInProviderSetting
> => {
    return BUILTIN_PROVIDER_IDS.reduce(
        (acc, id) => {
            acc[id] = {
                apiKey: '',
                modelName: BUILTIN_PROVIDERS[id].defaultModel,
            };
            return acc;
        },
        {} as Record<BuiltInProviderId, BuiltInProviderSetting>,
    );
};

export const buildDefaultCustomProviders = (): CustomProviderConfig[] => [
    {
        id: DEFAULT_CUSTOM_PROVIDER_ID,
        name: 'Custom 1',
        apiFormat: 'openai',
        baseUrl: '',
        apiKey: '',
        modelName: DEFAULT_OPENAI_MODEL,
    },
];

export const DEFAULT_SETTINGS: Settings = {
    openaiApiKey: '',
    provider: 'openai',
    customApiUrl: '',
    customApiKey: '',
    modelName: DEFAULT_OPENAI_MODEL,
    providerConfigs: buildDefaultProviderConfigs(),
    customProviders: buildDefaultCustomProviders(),
    activeCustomProviderId: DEFAULT_CUSTOM_PROVIDER_ID,
    defaultLanguage: 'en',
    defaultPolishTemplate: 'professional',
    theme: 'dark',
    uiLanguage: 'en',
    prompts: buildDefaultPrompts(),
};

export const normalizeSettings = (settings?: Partial<Settings> | null): Settings => {
    const prompts = buildDefaultPrompts();
    const requestedDefault =
        settings?.defaultPolishTemplate || DEFAULT_SETTINGS.defaultPolishTemplate;
    const defaultPolishTemplate = prompts.some((prompt) => prompt.id === requestedDefault)
        ? requestedDefault
        : prompts[0]?.id || DEFAULT_SETTINGS.defaultPolishTemplate;

    const provider: ProviderId = isBuiltInProviderId(settings?.provider)
        ? settings.provider
        : settings?.provider === 'custom'
          ? 'custom'
          : 'openai';

    const providerConfigs = buildDefaultProviderConfigs();
    for (const id of BUILTIN_PROVIDER_IDS) {
        const rawCfg = settings?.providerConfigs?.[id];
        providerConfigs[id] = {
            apiKey: sanitizeApiSecret(rawCfg?.apiKey),
            modelName: normalizeModelNameForProvider(id, rawCfg?.modelName),
        };
    }

    // Legacy migration from v1.3.x top-level OpenAI fields
    const legacyOpenAiKey = sanitizeApiSecret(settings?.openaiApiKey);
    if (legacyOpenAiKey && !providerConfigs.openai.apiKey) {
        providerConfigs.openai.apiKey = legacyOpenAiKey;
    }
    if (
        (settings?.provider === undefined || settings?.provider === 'openai') &&
        settings?.modelName &&
        !settings?.providerConfigs?.openai?.modelName
    ) {
        providerConfigs.openai.modelName = normalizeModelNameForProvider(
            'openai',
            settings.modelName,
        );
    }

    let customProviders: CustomProviderConfig[];
    if (Array.isArray(settings?.customProviders) && settings.customProviders.length > 0) {
        const seenIds = new Set<string>();
        customProviders = settings.customProviders.map((entry, index) => {
            const candidateId =
                typeof entry?.id === 'string' && entry.id.trim()
                    ? entry.id.trim()
                    : `custom_${index + 1}`;
            const uniqueId = seenIds.has(candidateId) ? `${candidateId}_${index + 1}` : candidateId;
            seenIds.add(uniqueId);
            return {
                id: uniqueId,
                name:
                    typeof entry?.name === 'string' && entry.name.trim()
                        ? entry.name.trim()
                        : `Custom ${index + 1}`,
                apiFormat: entry?.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
                baseUrl: typeof entry?.baseUrl === 'string' ? entry.baseUrl : '',
                apiKey: sanitizeApiSecret(entry?.apiKey),
                modelName: normalizeModelName(entry?.modelName),
            };
        });
    } else {
        customProviders = [
            {
                id: DEFAULT_CUSTOM_PROVIDER_ID,
                name: 'Custom 1',
                apiFormat: 'openai',
                baseUrl: typeof settings?.customApiUrl === 'string' ? settings.customApiUrl : '',
                apiKey: sanitizeApiSecret(settings?.customApiKey),
                modelName:
                    settings?.provider === 'custom'
                        ? normalizeModelName(settings?.modelName)
                        : DEFAULT_OPENAI_MODEL,
            },
        ];
    }

    const activeCustomProviderId =
        settings?.activeCustomProviderId &&
        customProviders.some((channel) => channel.id === settings.activeCustomProviderId)
            ? settings.activeCustomProviderId
            : customProviders[0].id;

    const activeCustom =
        customProviders.find((channel) => channel.id === activeCustomProviderId) ||
        customProviders[0];

    const syncedModelName =
        provider === 'custom' ? activeCustom.modelName : providerConfigs[provider].modelName;

    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        provider,
        providerConfigs,
        customProviders,
        activeCustomProviderId,
        openaiApiKey: providerConfigs.openai.apiKey,
        customApiUrl: activeCustom.baseUrl,
        customApiKey: activeCustom.apiKey,
        modelName: syncedModelName,
        defaultPolishTemplate,
        prompts,
    };
};

export interface ActiveProviderEndpointConfig {
    provider: ProviderId;
    isCustom: boolean;
    apiFormat: ApiFormat;
    baseUrl: string;
    apiKey: string;
    modelName: string;
}

export const resolveActiveProviderConfig = (
    settings: Pick<
        Settings,
        | 'provider'
        | 'providerConfigs'
        | 'customProviders'
        | 'activeCustomProviderId'
        | 'openaiApiKey'
        | 'customApiUrl'
        | 'customApiKey'
        | 'modelName'
    >,
): ActiveProviderEndpointConfig => {
    if (settings.provider === 'custom') {
        const activeCustom =
            settings.customProviders?.find((c) => c.id === settings.activeCustomProviderId) ||
            settings.customProviders?.[0];
        return {
            provider: 'custom',
            isCustom: true,
            apiFormat: activeCustom?.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
            baseUrl: (activeCustom?.baseUrl ?? settings.customApiUrl ?? '').trim(),
            apiKey: sanitizeApiSecret(activeCustom?.apiKey ?? settings.customApiKey),
            modelName: normalizeModelName(activeCustom?.modelName ?? settings.modelName),
        };
    }

    const providerId: BuiltInProviderId = isBuiltInProviderId(settings.provider)
        ? settings.provider
        : 'openai';
    const def = getProviderDefinition(providerId);
    const cfg = settings.providerConfigs?.[providerId];
    const fallbackApiKey = providerId === 'openai' ? settings.openaiApiKey : '';
    const fallbackModelName = providerId === 'openai' ? settings.modelName : undefined;

    return {
        provider: providerId,
        isCustom: false,
        apiFormat: def.apiFormat,
        baseUrl: def.baseUrl,
        apiKey: sanitizeApiSecret(cfg?.apiKey ?? fallbackApiKey),
        modelName: normalizeModelNameForProvider(providerId, cfg?.modelName ?? fallbackModelName),
    };
};
