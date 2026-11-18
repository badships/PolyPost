import React, { useRef, useState } from 'react';
import { ArrowLeft, Key, Globe, Palette, Laptop, Plus, Trash2 } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useSettingsStore } from '@/store';
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

    const { t } = useTranslation();
    const promptOptions = prompts.length
        ? prompts.map((prompt) => ({ id: prompt.id, name: prompt.name }))
        : Object.entries(POLISH_TEMPLATE_NAMES).map(([id, name]) => ({ id, name }));

    const [form, setForm] = useState<AiFormState>(() => ({
        provider: provider || 'openai',
        providerConfigs: cloneProviderConfigs(providerConfigs),
        customProviders: cloneCustomProviders(customProviders),
        activeCustomProviderId: activeCustomProviderId || customProviders[0]?.id || '',
    }));

    const [isSaving, setIsSaving] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
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

    return (
        <div className="flex flex-col h-screen bg-bg-primary">
            {/* Header */}
            <header className="h-14 shrink-0 border-b border-border-primary flex items-center px-4">
                <button
                    onClick={onNavigateBack}
                    className="p-2 rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary"
                >
                    <ArrowLeft size={20} />
                </button>
                <h1 className="ml-4 text-lg font-semibold text-text-primary">
                    {t('settings.title')}
                </h1>
            </header>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
                {/* AI Configuration */}
                <section className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Key size={20} className="text-accent" />
                        <h2 className="text-lg font-semibold text-text-primary">
                            {t('settings.ai.title')}
                        </h2>
                    </div>

                    <div className="space-y-4 bg-bg-secondary rounded-xl p-4 border border-border-primary">
                        {/* Provider Selection */}
                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                {t('settings.provider.label')}
                            </label>
                            <select
                                value={form.provider}
                                onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
                                className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                            >
                                {BUILTIN_PROVIDER_IDS.map((id) => (
                                    <option key={id} value={id}>
                                        {t(PROVIDER_LABEL_KEYS[id])}
                                    </option>
                                ))}
                                <option value="custom">{t('settings.provider.custom')}</option>
                            </select>
                            <p className="text-xs text-text-muted mt-2">
                                {activeBuiltInDef
                                    ? t('settings.provider.endpoint_hint', activeBuiltInDef.baseUrl)
                                    : t('settings.permission_hint')}
                            </p>
                        </div>

                        {activeBuiltInProvider && activeBuiltInDef && activeBuiltInConfig ? (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-text-primary mb-2">
                                        {t(
                                            'settings.apikey.provider_label',
                                            t(PROVIDER_LABEL_KEYS[activeBuiltInProvider]),
                                        )}
                                    </label>
                                    <div className="flex gap-2 items-center">
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
                                                className="bg-bg-tertiary"
                                            />
                                        </div>
                                        <Button
                                            variant="ghost"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                        >
                                            {showApiKey ? t('settings.hide') : t('settings.show')}
                                        </Button>
                                    </div>
                                    <p className="text-xs text-text-muted mt-2">
                                        {t('settings.apikey.help')}
                                    </p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-text-primary mb-2">
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
                                        className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
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
                                    <label className="block text-sm font-medium text-text-primary mb-2">
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
                                        className="bg-bg-tertiary"
                                    />
                                    <p className="text-xs text-text-muted mt-2">
                                        {t('settings.modelName.help')}
                                    </p>
                                </div>
                            </>
                        ) : (
                            activeCustomChannel && (
                                <>
                                    {/* Custom Channel Switcher */}
                                    <div>
                                        <label className="block text-sm font-medium text-text-primary mb-2">
                                            {t('settings.customChannel.label')}
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            <select
                                                value={activeCustomChannel.id}
                                                onChange={(e) =>
                                                    handleSelectCustomChannel(e.target.value)
                                                }
                                                className="flex-1 min-w-[160px] px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                                            >
                                                {form.customProviders.map((channel, index) => (
                                                    <option key={channel.id} value={channel.id}>
                                                        {channel.name.trim() ||
                                                            t(
                                                                'settings.customChannel.default_name',
                                                                index + 1,
                                                            )}
                                                    </option>
                                                ))}
                                            </select>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleAddCustomChannel}
                                                leftIcon={<Plus size={14} />}
                                            >
                                                {t('settings.customChannel.add')}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleDeleteCustomChannel}
                                                disabled={form.customProviders.length <= 1}
                                                leftIcon={<Trash2 size={14} />}
                                            >
                                                {t('settings.customChannel.delete')}
                                            </Button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-text-primary mb-2">
                                            {t('settings.customChannel.name.label')}
                                        </label>
                                        <Input
                                            type="text"
                                            value={activeCustomChannel.name}
                                            onChange={(e) =>
                                                updateActiveCustomChannel({ name: e.target.value })
                                            }
                                            placeholder={t(
                                                'settings.customChannel.name.placeholder',
                                            )}
                                            className="bg-bg-tertiary"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-text-primary mb-2">
                                            {t('settings.apiFormat.label')}
                                        </label>
                                        <select
                                            value={activeCustomChannel.apiFormat}
                                            onChange={(e) =>
                                                updateActiveCustomChannel({
                                                    apiFormat: e.target.value as ApiFormat,
                                                })
                                            }
                                            className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                                        >
                                            <option value="openai">
                                                {t('settings.apiFormat.openai')}
                                            </option>
                                            <option value="anthropic">
                                                {t('settings.apiFormat.anthropic')}
                                            </option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-text-primary mb-2">
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
                                            className="bg-bg-tertiary"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-text-primary mb-2">
                                            {t('settings.customKey.label')}
                                        </label>
                                        <div className="flex gap-2 items-center">
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
                                                    className="bg-bg-tertiary"
                                                />
                                            </div>
                                            <Button
                                                variant="ghost"
                                                onClick={() => setShowApiKey(!showApiKey)}
                                            >
                                                {showApiKey
                                                    ? t('settings.hide')
                                                    : t('settings.show')}
                                            </Button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-text-primary mb-2">
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
                                            className="bg-bg-tertiary"
                                        />
                                    </div>
                                </>
                            )
                        )}

                        {saveError && (
                            <p className="text-sm text-red-500" role="alert">
                                {saveError}
                            </p>
                        )}

                        <div className="flex justify-end pt-2">
                            <Button onClick={handleSaveSettings} isLoading={isSaving}>
                                {t('settings.save')}
                            </Button>
                        </div>
                    </div>
                </section>

                {/* Default Preferences */}
                <section className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Globe size={20} className="text-accent" />
                        <h2 className="text-lg font-semibold text-text-primary">
                            {t('settings.defaults.title')}
                        </h2>
                    </div>

                    <div className="space-y-4 bg-bg-secondary rounded-xl p-4 border border-border-primary">
                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
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
                                className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                            >
                                <option value="en">English</option>
                                <option value="zh">中文</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                {t('settings.translation.label')}
                            </label>
                            <select
                                value={defaultLanguage}
                                onChange={(e) => {
                                    void setDefaultLanguage(e.target.value as Language).catch(
                                        (err) => {
                                            console.error('Failed to save default language:', err);
                                        },
                                    );
                                }}
                                className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                            >
                                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                                    <option key={code} value={code}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                {t('settings.template.label')}
                            </label>
                            <select
                                value={defaultPolishTemplate}
                                onChange={(e) => {
                                    void setDefaultPolishTemplate(e.target.value).catch((err) => {
                                        console.error('Failed to save default template:', err);
                                    });
                                }}
                                className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
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
                <section className="mb-8">
                    <div className="flex items-center gap-2 mb-4">
                        <Palette size={20} className="text-accent" />
                        <h2 className="text-lg font-semibold text-text-primary">
                            {t('settings.appearance.title')}
                        </h2>
                    </div>

                    <div className="space-y-4 bg-bg-secondary rounded-xl p-4 border border-border-primary">
                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                {t('settings.theme.label')}
                            </label>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setTheme('light')}
                                    className={`flex-1 py-3 rounded-lg border flex items-center justify-center gap-2 ${
                                        theme === 'light'
                                            ? 'border-accent bg-accent/10 text-text-primary'
                                            : 'border-border-primary text-text-muted hover:border-text-muted'
                                    }`}
                                >
                                    <span>☀️</span> {t('settings.theme.light')}
                                </button>
                                <button
                                    onClick={() => setTheme('dark')}
                                    className={`flex-1 py-3 rounded-lg border flex items-center justify-center gap-2 ${
                                        theme === 'dark'
                                            ? 'border-accent bg-accent/10 text-text-primary'
                                            : 'border-border-primary text-text-muted hover:border-text-muted'
                                    }`}
                                >
                                    <span>🌙</span> {t('settings.theme.dark')}
                                </button>
                                <button
                                    onClick={() => setTheme('system')}
                                    className={`flex-1 py-3 rounded-lg border flex items-center justify-center gap-2 ${
                                        theme === 'system'
                                            ? 'border-accent bg-accent/10 text-text-primary'
                                            : 'border-border-primary text-text-muted hover:border-text-muted'
                                    }`}
                                >
                                    <Laptop size={16} /> {t('settings.theme.system')}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};
