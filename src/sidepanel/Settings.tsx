import React, { useRef, useState } from 'react';
import {
    ChevronLeft,
    Key,
    Globe,
    Palette,
    Sun,
    Moon,
    Laptop,
    Plus,
    Trash2,
    CheckCircle2,
    AlertCircle,
} from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useSettingsStore } from '@/store';
import { aiService } from '@/services/ai';
import { ensureHostPermission } from '@/services/permissions';
import type {
    ApiFormat,
    BuiltInProviderId,
    BuiltInProviderSetting,
    CustomProviderConfig,
    Language,
    ProviderId,
    Settings as SettingsType,
} from '@/types';
import { LANGUAGE_NAMES, POLISH_TEMPLATE_NAMES } from '@/types';
import { useTranslation, type DictionaryKey } from '@/hooks/useTranslation';
import {
    BUILTIN_PROVIDER_IDS,
    CUSTOM_MODEL_OPTION_VALUE,
    getProviderDefinition,
    getProviderModelOptions,
    isBuiltInModelForProvider,
    isBuiltInProviderId,
    normalizeModelName,
    normalizeModelNameForProvider,
} from '@/services/models';

interface SettingsProps {
    onNavigateBack: () => void;
}

type AiFormField = 'provider' | 'providerConfigs' | 'customProviders' | 'activeCustomProviderId';
const AI_FORM_FIELDS: AiFormField[] = [
    'provider',
    'providerConfigs',
    'customProviders',
    'activeCustomProviderId',
];

const PROVIDER_LABEL_KEYS: Record<ProviderId, DictionaryKey> = {
    openai: 'settings.provider.openai',
    anthropic: 'settings.provider.anthropic',
    gemini: 'settings.provider.gemini',
    xai: 'settings.provider.xai',
    deepseek: 'settings.provider.deepseek',
    qwen: 'settings.provider.qwen',
    kimi: 'settings.provider.kimi',
    zhipu: 'settings.provider.zhipu',
    openrouter: 'settings.provider.openrouter',
    custom: 'settings.provider.custom',
};

const PROVIDER_MATRIX_LABELS: Record<BuiltInProviderId, string> = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    gemini: 'Gemini',
    xai: 'Grok',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    kimi: 'Kimi',
    zhipu: 'GLM',
    openrouter: 'OpenRouter',
};

interface AiFormState {
    provider: ProviderId;
    providerConfigs: Record<BuiltInProviderId, BuiltInProviderSetting>;
    customProviders: CustomProviderConfig[];
    activeCustomProviderId: string;
}

const cloneProviderConfigs = (
    configs: Record<BuiltInProviderId, BuiltInProviderSetting>,
): Record<BuiltInProviderId, BuiltInProviderSetting> => {
    return BUILTIN_PROVIDER_IDS.reduce(
        (acc, id) => {
            acc[id] = { ...configs[id] };
            return acc;
        },
        {} as Record<BuiltInProviderId, BuiltInProviderSetting>,
    );
};

const cloneCustomProviders = (channels: CustomProviderConfig[]): CustomProviderConfig[] => {
    return channels.map((channel) => ({ ...channel }));
};

const buildInitialBuiltInVersions = (): Record<BuiltInProviderId, number> => {
    return BUILTIN_PROVIDER_IDS.reduce(
        (acc, id) => {
            acc[id] = 0;
            return acc;
        },
        {} as Record<BuiltInProviderId, number>,
    );
};

export const Settings: React.FC<SettingsProps> = ({ onNavigateBack }) => {
    const {
        provider,
        providerConfigs,
        customProviders,
        activeCustomProviderId,
        defaultLanguage,
        defaultPolishTemplate,
        theme,
        uiLanguage,
        prompts,
        updateSettings,
        setDefaultLanguage,
        setDefaultPolishTemplate,
        setTheme,
        setUiLanguage,
    } = useSettingsStore();

    const { t, getTemplateName } = useTranslation();
    const promptOptions = prompts.length
        ? prompts.map((prompt) => ({
              id: prompt.id,
              name: getTemplateName(prompt.id, prompt.name),
          }))
        : Object.entries(POLISH_TEMPLATE_NAMES).map(([id, name]) => ({
              id,
              name: getTemplateName(id, name),
          }));

    const [form, setForm] = useState<AiFormState>(() => ({
        provider: provider || 'openai',
        providerConfigs: cloneProviderConfigs(providerConfigs),
        customProviders: cloneCustomProviders(customProviders),
        activeCustomProviderId: activeCustomProviderId || customProviders[0]?.id || '',
    }));

    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [testFeedback, setTestFeedback] = useState<{
        ok: boolean;
        message: string;
    } | null>(null);
    const dirtyFieldsRef = useRef<Set<AiFormField>>(new Set());
    const dirtyBuiltInProvidersRef = useRef<Set<BuiltInProviderId>>(new Set());
    const fieldEditVersionRef = useRef<Record<AiFormField, number>>({
        provider: 0,
        providerConfigs: 0,
        customProviders: 0,
        activeCustomProviderId: 0,
    });
    const builtInVersionRef = useRef<Record<BuiltInProviderId, number>>(
        buildInitialBuiltInVersions(),
    );

    const markFieldDirty = (field: AiFormField) => {
        dirtyFieldsRef.current.add(field);
        fieldEditVersionRef.current[field] += 1;
        setSaveError(null);
        setTestFeedback(null);
    };

    const mergeProviderConfigsFromStore = (
        current: Record<BuiltInProviderId, BuiltInProviderSetting>,
        incoming: Record<BuiltInProviderId, BuiltInProviderSetting>,
    ): Record<BuiltInProviderId, BuiltInProviderSetting> => {
        return BUILTIN_PROVIDER_IDS.reduce(
            (acc, id) => {
                acc[id] = dirtyBuiltInProvidersRef.current.has(id)
                    ? current[id]
                    : { ...incoming[id] };
                return acc;
            },
            {} as Record<BuiltInProviderId, BuiltInProviderSetting>,
        );
    };

    // Update local state when store changes unless a field has unsaved local edits
    React.useEffect(() => {
        setForm((current) => ({
            provider: dirtyFieldsRef.current.has('provider')
                ? current.provider
                : provider || 'openai',
            providerConfigs: mergeProviderConfigsFromStore(
                current.providerConfigs,
                providerConfigs,
            ),
            customProviders: dirtyFieldsRef.current.has('customProviders')
                ? current.customProviders
                : cloneCustomProviders(customProviders),
            activeCustomProviderId: dirtyFieldsRef.current.has('activeCustomProviderId')
                ? current.activeCustomProviderId
                : activeCustomProviderId || customProviders[0]?.id || '',
        }));
    }, [provider, providerConfigs, customProviders, activeCustomProviderId]);

    const handleProviderChange = (nextProvider: ProviderId) => {
        markFieldDirty('provider');
        setForm((current) => ({
            ...current,
            provider: nextProvider,
        }));
    };

    const updateBuiltInField = (
        providerId: BuiltInProviderId,
        patch: Partial<BuiltInProviderSetting>,
    ) => {
        markFieldDirty('providerConfigs');
        dirtyBuiltInProvidersRef.current.add(providerId);
        builtInVersionRef.current[providerId] += 1;
        setForm((current) => ({
            ...current,
            providerConfigs: {
                ...current.providerConfigs,
                [providerId]: {
                    ...current.providerConfigs[providerId],
                    ...patch,
                },
            },
        }));
    };

    const activeCustomChannel =
        form.customProviders.find((channel) => channel.id === form.activeCustomProviderId) ||
        form.customProviders[0];

    const handleSelectCustomChannel = (channelId: string) => {
        markFieldDirty('activeCustomProviderId');
        setForm((current) => ({
            ...current,
            activeCustomProviderId: channelId,
        }));
    };

    const updateActiveCustomChannel = (patch: Partial<CustomProviderConfig>) => {
        if (!activeCustomChannel) return;
        markFieldDirty('customProviders');
        setForm((current) => ({
            ...current,
            customProviders: current.customProviders.map((channel) =>
                channel.id === activeCustomChannel.id ? { ...channel, ...patch } : channel,
            ),
        }));
    };

    const handleAddCustomChannel = () => {
        const nextIndex = form.customProviders.length + 1;
        const newChannel: CustomProviderConfig = {
            id: `custom_${Date.now()}`,
            name: t('settings.customChannel.default_name', nextIndex),
            apiFormat: 'openai',
            baseUrl: '',
            apiKey: '',
            modelName: '',
        };
        markFieldDirty('customProviders');
        markFieldDirty('activeCustomProviderId');
        setForm((current) => ({
            ...current,
            customProviders: [...current.customProviders, newChannel],
            activeCustomProviderId: newChannel.id,
        }));
    };

    const handleDeleteCustomChannel = () => {
        if (form.customProviders.length <= 1 || !activeCustomChannel) {
            return;
        }
        const remaining = form.customProviders.filter(
            (channel) => channel.id !== activeCustomChannel.id,
        );
        markFieldDirty('customProviders');
        markFieldDirty('activeCustomProviderId');
        setForm((current) => ({
            ...current,
            customProviders: remaining,
            activeCustomProviderId: remaining[0].id,
        }));
    };

    const handleSaveSettings = async () => {
        setIsSaving(true);
        setSaveError(null);
        try {
            const submittedFields = AI_FORM_FIELDS.filter((field) =>
                dirtyFieldsRef.current.has(field),
            );
            const submittedDirtyBuiltIns = Array.from(dirtyBuiltInProvidersRef.current);
            const submittedVersions: Record<AiFormField, number> = {
                ...fieldEditVersionRef.current,
            };
            const submittedBuiltInVersions: Record<BuiltInProviderId, number> = {
                ...builtInVersionRef.current,
            };

            if (submittedFields.length === 0) {
                return;
            }

            const latestStore = useSettingsStore.getState();
            const updates: Partial<SettingsType> = {};

            const effectiveProvider = dirtyFieldsRef.current.has('provider')
                ? form.provider
                : latestStore.provider;

            let effectiveProviderConfigs = cloneProviderConfigs(latestStore.providerConfigs);
            if (dirtyFieldsRef.current.has('providerConfigs')) {
                for (const id of submittedDirtyBuiltIns) {
                    const edited = form.providerConfigs[id];
                    effectiveProviderConfigs = {
                        ...effectiveProviderConfigs,
                        [id]: {
                            apiKey: edited.apiKey,
                            modelName: normalizeModelNameForProvider(id, edited.modelName),
                        },
                    };
                }
                updates.providerConfigs = effectiveProviderConfigs;
            }

            let effectiveCustomProviders = cloneCustomProviders(latestStore.customProviders);
            if (dirtyFieldsRef.current.has('customProviders')) {
                effectiveCustomProviders = form.customProviders.map((channel, index) => ({
                    ...channel,
                    name:
                        channel.name.trim() || t('settings.customChannel.default_name', index + 1),
                    modelName: normalizeModelName(channel.modelName),
                }));
                updates.customProviders = effectiveCustomProviders;
            }

            const candidateActiveCustomId = dirtyFieldsRef.current.has('activeCustomProviderId')
                ? form.activeCustomProviderId
                : latestStore.activeCustomProviderId;
            const effectiveActiveCustom =
                effectiveCustomProviders.find((c) => c.id === candidateActiveCustomId) ||
                effectiveCustomProviders[0];
            const effectiveActiveCustomId = effectiveActiveCustom?.id || '';

            if (dirtyFieldsRef.current.has('provider')) {
                updates.provider = effectiveProvider;
            }
            if (dirtyFieldsRef.current.has('activeCustomProviderId')) {
                updates.activeCustomProviderId = effectiveActiveCustomId;
            }

            // Keep legacy top-level fields synced for edited fields so storage.sync timestamps stay aligned.
            if (submittedDirtyBuiltIns.includes('openai')) {
                updates.openaiApiKey = effectiveProviderConfigs.openai.apiKey;
            }
            if (
                dirtyFieldsRef.current.has('customProviders') ||
                dirtyFieldsRef.current.has('activeCustomProviderId')
            ) {
                updates.customApiUrl = effectiveActiveCustom?.baseUrl || '';
                updates.customApiKey = effectiveActiveCustom?.apiKey || '';
            }
            updates.modelName =
                effectiveProvider === 'custom'
                    ? effectiveActiveCustom?.modelName || normalizeModelName('')
                    : effectiveProviderConfigs[effectiveProvider].modelName;

            await updateSettings(updates);

            for (const id of submittedDirtyBuiltIns) {
                if (builtInVersionRef.current[id] === submittedBuiltInVersions[id]) {
                    dirtyBuiltInProvidersRef.current.delete(id);
                }
            }
            for (const field of submittedFields) {
                if (field === 'providerConfigs') {
                    if (dirtyBuiltInProvidersRef.current.size === 0) {
                        dirtyFieldsRef.current.delete(field);
                    }
                    continue;
                }
                if (fieldEditVersionRef.current[field] === submittedVersions[field]) {
                    dirtyFieldsRef.current.delete(field);
                }
            }

            const nextState = useSettingsStore.getState();
            setForm((current) => ({
                provider: dirtyFieldsRef.current.has('provider')
                    ? current.provider
                    : nextState.provider || 'openai',
                providerConfigs: mergeProviderConfigsFromStore(
                    current.providerConfigs,
                    nextState.providerConfigs,
                ),
                customProviders: dirtyFieldsRef.current.has('customProviders')
                    ? current.customProviders
                    : cloneCustomProviders(nextState.customProviders),
                activeCustomProviderId: dirtyFieldsRef.current.has('activeCustomProviderId')
                    ? current.activeCustomProviderId
                    : nextState.activeCustomProviderId || nextState.customProviders[0]?.id || '',
            }));
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setTestFeedback(null);

        const isBuiltIn = activeBuiltInProvider !== null && activeBuiltInDef && activeBuiltInConfig;
        const apiFormat: ApiFormat = isBuiltIn
            ? activeBuiltInDef.apiFormat
            : activeCustomChannel?.apiFormat === 'anthropic'
              ? 'anthropic'
              : 'openai';
        const baseUrl = (
            isBuiltIn ? activeBuiltInDef.baseUrl : activeCustomChannel?.baseUrl || ''
        ).trim();
        const apiKey = isBuiltIn ? activeBuiltInConfig.apiKey : activeCustomChannel?.apiKey || '';
        const modelName = isBuiltIn
            ? normalizeModelNameForProvider(activeBuiltInProvider, activeBuiltInConfig.modelName)
            : normalizeModelName(activeCustomChannel?.modelName);

        if (isBuiltIn && !apiKey.trim()) {
            setTestFeedback({ ok: false, message: t('editor.api_key_missing_openai') });
            return;
        }
        if (!isBuiltIn && (!baseUrl || !apiKey.trim())) {
            setTestFeedback({ ok: false, message: t('editor.api_key_missing_custom') });
            return;
        }

        setIsTesting(true);
        try {
            const permissionResult = await ensureHostPermission(baseUrl);
            if (!permissionResult.granted) {
                if (permissionResult.reason === 'invalid_url') {
                    setTestFeedback({ ok: false, message: t('editor.permission.invalid_url') });
                } else if (permissionResult.reason === 'not_allowed') {
                    setTestFeedback({
                        ok: false,
                        message: t('editor.permission.not_allowed', permissionResult.origin || ''),
                    });
                } else {
                    setTestFeedback({
                        ok: false,
                        message: t('editor.permission.denied', permissionResult.origin || ''),
                    });
                }
                return;
            }

            const result = await aiService.testConnection({
                apiFormat,
                apiKey,
                baseURL: baseUrl,
                modelName,
            });
            setTestFeedback({
                ok: true,
                message: t('settings.test.success', result.latencyMs, result.model),
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            setTestFeedback({
                ok: false,
                message: t('settings.test.failed', msg),
            });
        } finally {
            setIsTesting(false);
        }
    };

    const activeBuiltInProvider: BuiltInProviderId | null = isBuiltInProviderId(form.provider)
        ? form.provider
        : null;
    const activeBuiltInDef = activeBuiltInProvider
        ? getProviderDefinition(activeBuiltInProvider)
        : null;
    const activeBuiltInConfig = activeBuiltInProvider
        ? form.providerConfigs[activeBuiltInProvider]
        : null;
    const activeProviderModelOptions = activeBuiltInProvider
        ? getProviderModelOptions(activeBuiltInProvider)
        : [];
    const selectedModelPreset =
        activeBuiltInProvider &&
        activeBuiltInConfig &&
        isBuiltInModelForProvider(activeBuiltInProvider, activeBuiltInConfig.modelName.trim())
            ? activeBuiltInConfig.modelName.trim()
            : CUSTOM_MODEL_OPTION_VALUE;

    const isActiveConfigured = activeBuiltInProvider
        ? Boolean(activeBuiltInConfig?.apiKey?.trim())
        : Boolean(activeCustomChannel?.baseUrl?.trim() && activeCustomChannel?.apiKey?.trim());

    return (
        <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
            {/* Compact Sticky X-Native Header */}
            <header className="sticky top-0 z-20 h-11 shrink-0 border-b border-border-primary flex items-center justify-between gap-2 px-3 bg-bg-primary/85 backdrop-blur-md">
                <div className="flex items-center gap-1.5 min-w-0">
                    <button
                        onClick={onNavigateBack}
                        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors shrink-0"
                        aria-label="Back"
                    >
                        <ChevronLeft size={17} />
                    </button>
                    <h1 className="text-[13.5px] font-bold text-text-primary truncate">
                        {t('settings.title')}
                    </h1>
                </div>

                <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-bg-secondary border border-border-primary text-[11px] font-mono text-text-secondary shrink-0">
                    <span
                        className={`w-1.5 h-1.5 rounded-full ${
                            isActiveConfigured ? 'bg-[#00ba7c]' : 'bg-[#ffd400]'
                        }`}
                    />
                    <span>
                        {activeBuiltInProvider
                            ? PROVIDER_MATRIX_LABELS[activeBuiltInProvider]
                            : activeCustomChannel?.name.trim() || 'Custom'}
                    </span>
                </span>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="max-w-xl mx-auto w-full space-y-4 pb-4">
                    {/* AI Configuration */}
                    <section>
                        <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
                            <div className="flex items-center gap-1.5">
                                <Key size={13} className="text-accent" />
                                <h2 className="text-[11.5px] font-bold text-text-secondary">
                                    {t('settings.ai.title')}
                                </h2>
                            </div>
                            <span className="text-[10.5px] font-mono text-text-muted">
                                9 + Custom
                            </span>
                        </div>

                        <div className="space-y-3 bg-bg-secondary rounded-xl p-3 border border-border-primary">
                            {/* 3x3 Built-In Provider Matrix + Custom Selector */}
                            <div>
                                <label className="block text-[11px] font-semibold text-text-muted mb-1.5">
                                    {t('settings.provider.label')}
                                </label>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {BUILTIN_PROVIDER_IDS.map((id) => {
                                        const isSelected = form.provider === id;
                                        const hasKey = Boolean(
                                            form.providerConfigs[id]?.apiKey?.trim(),
                                        );
                                        const label =
                                            id === 'qwen' && uiLanguage === 'zh'
                                                ? '千问 Qwen'
                                                : id === 'zhipu' && uiLanguage === 'zh'
                                                  ? '智谱 GLM'
                                                  : PROVIDER_MATRIX_LABELS[id];
                                        return (
                                            <button
                                                key={id}
                                                type="button"
                                                onClick={() => handleProviderChange(id)}
                                                className={`h-7 px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-between gap-1 transition-colors min-w-0 ${
                                                    isSelected
                                                        ? 'border-accent bg-accent/10 text-text-primary'
                                                        : 'border-border-primary bg-bg-primary text-text-secondary hover:border-border-secondary hover:text-text-primary'
                                                }`}
                                                title={t(PROVIDER_LABEL_KEYS[id])}
                                            >
                                                <span className="truncate">{label}</span>
                                                {hasKey && (
                                                    <span className="w-1.5 h-1.5 rounded-full bg-[#00ba7c] shrink-0" />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleProviderChange('custom')}
                                    className={`mt-1.5 w-full h-7 px-2.5 rounded-lg border text-[11px] font-semibold flex items-center justify-between gap-2 transition-colors ${
                                        form.provider === 'custom'
                                            ? 'border-accent bg-accent/10 text-text-primary'
                                            : 'border-border-primary bg-bg-primary text-text-secondary hover:border-border-secondary hover:text-text-primary'
                                    }`}
                                >
                                    <span className="truncate">
                                        {t('settings.provider.custom')}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 shrink-0 text-[10.5px] font-mono text-text-muted">
                                        <span>{form.customProviders.length}</span>
                                        {Boolean(
                                            activeCustomChannel?.baseUrl?.trim() &&
                                            activeCustomChannel?.apiKey?.trim(),
                                        ) && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#00ba7c]" />
                                        )}
                                    </span>
                                </button>

                                <p className="text-[11px] text-text-muted mt-2 font-mono break-all">
                                    {activeBuiltInDef
                                        ? t(
                                              'settings.provider.endpoint_hint',
                                              activeBuiltInDef.baseUrl,
                                          )
                                        : t('settings.permission_hint')}
                                </p>
                            </div>

                            {activeBuiltInProvider && activeBuiltInDef && activeBuiltInConfig ? (
                                <>
                                    <div>
                                        <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                            {t(
                                                'settings.apikey.provider_label',
                                                t(PROVIDER_LABEL_KEYS[activeBuiltInProvider]),
                                            )}
                                        </label>
                                        <div className="flex gap-1.5 items-center">
                                            <div className="flex-1 min-w-0">
                                                <Input
                                                    type={showApiKey ? 'text' : 'password'}
                                                    value={activeBuiltInConfig.apiKey}
                                                    onChange={(e) =>
                                                        updateBuiltInField(activeBuiltInProvider, {
                                                            apiKey: e.target.value,
                                                        })
                                                    }
                                                    placeholder={t('settings.apikey.placeholder')}
                                                    className="font-mono"
                                                />
                                            </div>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => setShowApiKey(!showApiKey)}
                                            >
                                                {showApiKey
                                                    ? t('settings.hide')
                                                    : t('settings.show')}
                                            </Button>
                                        </div>
                                        <p className="text-[11px] text-text-muted mt-1.5">
                                            {t('settings.apikey.help')}
                                        </p>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                            {t('settings.modelPreset.label')}
                                        </label>
                                        <select
                                            value={selectedModelPreset}
                                            onChange={(e) => {
                                                const nextModel =
                                                    e.target.value === CUSTOM_MODEL_OPTION_VALUE
                                                        ? isBuiltInModelForProvider(
                                                              activeBuiltInProvider,
                                                              activeBuiltInConfig.modelName.trim(),
                                                          )
                                                            ? ''
                                                            : activeBuiltInConfig.modelName
                                                        : e.target.value;
                                                updateBuiltInField(activeBuiltInProvider, {
                                                    modelName: nextModel,
                                                });
                                            }}
                                            className="w-full h-8 px-3 py-1 text-xs bg-bg-primary border border-border-primary rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
                                        >
                                            {activeProviderModelOptions.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                            <option value={CUSTOM_MODEL_OPTION_VALUE}>
                                                {t('settings.modelPreset.custom')}
                                            </option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                            {t('settings.modelName.label')}
                                        </label>
                                        <Input
                                            type="text"
                                            value={activeBuiltInConfig.modelName}
                                            onChange={(e) =>
                                                updateBuiltInField(activeBuiltInProvider, {
                                                    modelName: e.target.value,
                                                })
                                            }
                                            placeholder={activeBuiltInDef.defaultModel}
                                            className="font-mono"
                                        />
                                        <p className="text-[11px] text-text-muted mt-1.5">
                                            {t('settings.modelName.help')}
                                        </p>
                                    </div>
                                </>
                            ) : (
                                activeCustomChannel && (
                                    <>
                                        {/* Saved Custom Channels Pill Pool */}
                                        <div>
                                            <div className="flex items-center justify-between gap-2 mb-1.5">
                                                <label className="text-[11px] font-semibold text-text-secondary">
                                                    {t('settings.customChannel.label')}
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={handleAddCustomChannel}
                                                        className="inline-flex items-center gap-0.5 text-[11px] font-bold text-accent hover:underline"
                                                    >
                                                        <Plus size={12} strokeWidth={2.5} />
                                                        <span>
                                                            {t('settings.customChannel.add')}
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleDeleteCustomChannel}
                                                        disabled={form.customProviders.length <= 1}
                                                        className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-text-muted hover:text-[#f4212e] disabled:opacity-35 disabled:cursor-not-allowed"
                                                        title={t('settings.customChannel.delete')}
                                                        aria-label={t(
                                                            'settings.customChannel.delete',
                                                        )}
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap gap-1.5">
                                                {form.customProviders.map((channel, index) => {
                                                    const isCurrent =
                                                        channel.id === activeCustomChannel.id;
                                                    return (
                                                        <button
                                                            key={channel.id}
                                                            type="button"
                                                            onClick={() =>
                                                                handleSelectCustomChannel(
                                                                    channel.id,
                                                                )
                                                            }
                                                            className={`h-7 px-2.5 rounded-full text-[11px] border transition-colors truncate max-w-[160px] ${
                                                                isCurrent
                                                                    ? 'bg-cta-bg text-cta-text border-cta-bg font-bold'
                                                                    : 'bg-bg-primary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary font-semibold'
                                                            }`}
                                                        >
                                                            {channel.name.trim() ||
                                                                t(
                                                                    'settings.customChannel.default_name',
                                                                    index + 1,
                                                                )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                                    {t('settings.customChannel.name.label')}
                                                </label>
                                                <Input
                                                    type="text"
                                                    value={activeCustomChannel.name}
                                                    onChange={(e) =>
                                                        updateActiveCustomChannel({
                                                            name: e.target.value,
                                                        })
                                                    }
                                                    placeholder={t(
                                                        'settings.customChannel.name.placeholder',
                                                    )}
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                                    {t('settings.apiFormat.label')}
                                                </label>
                                                <div className="grid grid-cols-2 gap-1 h-8">
                                                    {(
                                                        [
                                                            { id: 'openai', label: 'OpenAI' },
                                                            { id: 'anthropic', label: 'Anthropic' },
                                                        ] as { id: ApiFormat; label: string }[]
                                                    ).map((fmt) => {
                                                        const activeFmt =
                                                            activeCustomChannel.apiFormat ===
                                                            fmt.id;
                                                        return (
                                                            <button
                                                                key={fmt.id}
                                                                type="button"
                                                                onClick={() =>
                                                                    updateActiveCustomChannel({
                                                                        apiFormat: fmt.id,
                                                                    })
                                                                }
                                                                className={`rounded-full text-[11px] border transition-colors flex items-center justify-center ${
                                                                    activeFmt
                                                                        ? 'bg-cta-bg text-cta-text border-cta-bg font-bold'
                                                                        : 'bg-bg-primary border-border-primary text-text-secondary hover:text-text-primary font-semibold'
                                                                }`}
                                                                title={
                                                                    fmt.id === 'openai'
                                                                        ? t(
                                                                              'settings.apiFormat.openai',
                                                                          )
                                                                        : t(
                                                                              'settings.apiFormat.anthropic',
                                                                          )
                                                                }
                                                            >
                                                                {fmt.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                                {t('settings.customUrl.label')}
                                            </label>
                                            <Input
                                                type="text"
                                                value={activeCustomChannel.baseUrl}
                                                onChange={(e) =>
                                                    updateActiveCustomChannel({
                                                        baseUrl: e.target.value,
                                                    })
                                                }
                                                placeholder={t('settings.customUrl.placeholder')}
                                                className="font-mono"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                                {t('settings.customKey.label')}
                                            </label>
                                            <div className="flex gap-1.5 items-center">
                                                <div className="flex-1 min-w-0">
                                                    <Input
                                                        type={showApiKey ? 'text' : 'password'}
                                                        value={activeCustomChannel.apiKey}
                                                        onChange={(e) =>
                                                            updateActiveCustomChannel({
                                                                apiKey: e.target.value,
                                                            })
                                                        }
                                                        placeholder={t(
                                                            'settings.customKey.placeholder',
                                                        )}
                                                        className="font-mono"
                                                    />
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                >
                                                    {showApiKey
                                                        ? t('settings.hide')
                                                        : t('settings.show')}
                                                </Button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                                {t('settings.modelName.label')}
                                            </label>
                                            <Input
                                                type="text"
                                                value={activeCustomChannel.modelName}
                                                onChange={(e) =>
                                                    updateActiveCustomChannel({
                                                        modelName: e.target.value,
                                                    })
                                                }
                                                placeholder={t('settings.modelName.placeholder')}
                                                className="font-mono"
                                            />
                                        </div>
                                    </>
                                )
                            )}

                            {saveError && (
                                <p className="text-xs text-[#f4212e]" role="alert">
                                    {saveError}
                                </p>
                            )}

                            {testFeedback && (
                                <div
                                    className={`flex items-start gap-1.5 px-2.5 py-2 rounded-lg text-[11px] leading-snug border ${
                                        testFeedback.ok
                                            ? 'bg-[#00ba7c]/10 border-[#00ba7c]/30 text-[#00ba7c]'
                                            : 'bg-[#f4212e]/10 border-[#f4212e]/30 text-[#f4212e]'
                                    }`}
                                    role={testFeedback.ok ? 'status' : 'alert'}
                                >
                                    {testFeedback.ok ? (
                                        <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
                                    ) : (
                                        <AlertCircle size={13} className="shrink-0 mt-0.5" />
                                    )}
                                    <span className="break-words">{testFeedback.message}</span>
                                </div>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-1">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleTestConnection}
                                    isLoading={isTesting}
                                >
                                    {isTesting ? t('settings.testing') : t('settings.test')}
                                </Button>
                                <Button size="sm" onClick={handleSaveSettings} isLoading={isSaving}>
                                    {t('settings.save')}
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* Default Preferences */}
                    <section>
                        <div className="flex items-center gap-1.5 mb-2 px-0.5">
                            <Globe size={13} className="text-accent" />
                            <h2 className="text-[11.5px] font-bold text-text-secondary">
                                {t('settings.defaults.title')}
                            </h2>
                        </div>

                        <div className="space-y-3 bg-bg-secondary rounded-xl p-3 border border-border-primary">
                            <div>
                                <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                    {t('settings.language.label')}
                                </label>
                                <select
                                    value={uiLanguage}
                                    onChange={(e) => {
                                        void setUiLanguage(e.target.value as 'en' | 'zh').catch(
                                            (err) => {
                                                console.error('Failed to save UI language:', err);
                                            },
                                        );
                                    }}
                                    className="w-full h-8 px-3 py-1 text-xs bg-bg-primary border border-border-primary rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
                                >
                                    <option value="en">English</option>
                                    <option value="zh">中文</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                    {t('settings.translation.label')}
                                </label>
                                <select
                                    value={defaultLanguage}
                                    onChange={(e) => {
                                        void setDefaultLanguage(e.target.value as Language).catch(
                                            (err) => {
                                                console.error(
                                                    'Failed to save default language:',
                                                    err,
                                                );
                                            },
                                        );
                                    }}
                                    className="w-full h-8 px-3 py-1 text-xs bg-bg-primary border border-border-primary rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
                                >
                                    {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                                        <option key={code} value={code}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-text-secondary mb-1">
                                    {t('settings.template.label')}
                                </label>
                                <select
                                    value={defaultPolishTemplate}
                                    onChange={(e) => {
                                        void setDefaultPolishTemplate(e.target.value).catch(
                                            (err) => {
                                                console.error(
                                                    'Failed to save default template:',
                                                    err,
                                                );
                                            },
                                        );
                                    }}
                                    className="w-full h-8 px-3 py-1 text-xs bg-bg-primary border border-border-primary rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
                                >
                                    {promptOptions.map((prompt) => (
                                        <option key={prompt.id} value={prompt.id}>
                                            {prompt.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* Appearance */}
                    <section>
                        <div className="flex items-center gap-1.5 mb-2 px-0.5">
                            <Palette size={13} className="text-accent" />
                            <h2 className="text-[11.5px] font-bold text-text-secondary">
                                {t('settings.appearance.title')}
                            </h2>
                        </div>

                        <div className="space-y-3 bg-bg-secondary rounded-xl p-3 border border-border-primary">
                            <div>
                                <label className="block text-[11px] font-semibold text-text-secondary mb-1.5">
                                    {t('settings.theme.label')}
                                </label>
                                <div className="grid grid-cols-3 gap-1.5">
                                    <button
                                        onClick={() => setTheme('light')}
                                        className={`h-8 px-2 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                                            theme === 'light'
                                                ? 'border-accent bg-accent/10 text-text-primary'
                                                : 'border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:border-border-secondary'
                                        }`}
                                    >
                                        <Sun size={13} /> {t('settings.theme.light')}
                                    </button>
                                    <button
                                        onClick={() => setTheme('dark')}
                                        className={`h-8 px-2 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                                            theme === 'dark'
                                                ? 'border-accent bg-accent/10 text-text-primary'
                                                : 'border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:border-border-secondary'
                                        }`}
                                    >
                                        <Moon size={13} /> {t('settings.theme.dark')}
                                    </button>
                                    <button
                                        onClick={() => setTheme('system')}
                                        className={`h-8 px-2 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                                            theme === 'system'
                                                ? 'border-accent bg-accent/10 text-text-primary'
                                                : 'border-border-primary bg-bg-primary text-text-muted hover:text-text-primary hover:border-border-secondary'
                                        }`}
                                    >
                                        <Laptop size={13} /> {t('settings.theme.system')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};
