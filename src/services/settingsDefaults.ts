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

const LEGACY_POLISH_PROMPTS: Record<string, string> = {
    professional:
        'You are a professional social media copywriter. Rewrite the following tweet to be more professional and polished while maintaining the core message. Make it suitable for a business or professional audience. Keep it within 280 characters.',
    viral: 'You are a viral content expert. Rewrite the following tweet to maximize engagement and shareability. Use attention-grabbing hooks, create curiosity, and encourage interaction. Keep it within 280 characters.',
    casual: 'You are a friendly social media content creator. Rewrite the following tweet to be more casual, friendly, and approachable. Make it feel like a genuine conversation with friends. Keep it within 280 characters.',
    technical:
        'You are a technical expert in the field. Rewrite the following tweet to sound more authoritative and technically accurate. Use precise terminology and establish expertise. Keep it within 280 characters.',
    emoji: "You are a social media expert who knows how to use emojis effectively. Rewrite the following tweet with strategic emoji placement to enhance readability and emotional impact. Don't overdo it - use 3-5 emojis maximum. Keep it within 280 characters.",
    concise:
        'You are a master of brevity. Rewrite the following tweet to be as concise and impactful as possible. Remove all unnecessary words while preserving the core message. Make every word count. Keep it within 280 characters.',
};

const LEGACY_POLISH_TEMPLATE_DESCRIPTIONS: Record<string, string> = {
    professional: 'Perfect for business content and professional networking',
    viral: 'Optimized for maximum engagement and shares',
    casual: 'Great for personal brand and friendly interactions',
    technical: 'Ideal for industry insights and expert content',
    emoji: 'Enhanced with strategic emoji for visual appeal',
    concise: 'Sharp and impactful, every word matters',
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
    const defaultPrompts = buildDefaultPrompts();
    const defaultPromptById = new Map(defaultPrompts.map((prompt) => [prompt.id, prompt]));
    const rawPrompts = Array.isArray(settings?.prompts) ? settings.prompts : [];
    const prompts =
        rawPrompts.length > 0
            ? rawPrompts.map((prompt) => {
                  const builtIn = defaultPromptById.get(prompt.id);
                  if (!builtIn) {
                      return { ...prompt };
                  }
                  const isLegacyContent =
                      !prompt.content || prompt.content === LEGACY_POLISH_PROMPTS[prompt.id];
                  const isLegacyDescription =
                      !prompt.description ||
                      prompt.description === LEGACY_POLISH_TEMPLATE_DESCRIPTIONS[prompt.id];
                  return {
                      ...prompt,
                      name: prompt.name || builtIn.name,
                      description: isLegacyDescription ? builtIn.description : prompt.description,
                      content: isLegacyContent ? builtIn.content : prompt.content,
                  };
              })
            : defaultPrompts;
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
            apiKey: typeof rawCfg?.apiKey === 'string' ? rawCfg.apiKey : '',
            modelName: normalizeModelNameForProvider(id, rawCfg?.modelName),
        };
    }

    // Legacy migration from v1.3.x top-level OpenAI fields
    if (
        typeof settings?.openaiApiKey === 'string' &&
        settings.openaiApiKey &&
        !providerConfigs.openai.apiKey
    ) {
        providerConfigs.openai.apiKey = settings.openaiApiKey;
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
                apiKey: typeof entry?.apiKey === 'string' ? entry.apiKey : '',
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
                apiKey: typeof settings?.customApiKey === 'string' ? settings.customApiKey : '',
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
            apiKey: (activeCustom?.apiKey ?? settings.customApiKey ?? '').trim(),
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
        apiKey: (cfg?.apiKey ?? fallbackApiKey ?? '').trim(),
        modelName: normalizeModelNameForProvider(providerId, cfg?.modelName ?? fallbackModelName),
    };
};
