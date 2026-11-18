import React, { useRef, useState } from 'react';
import { ArrowLeft, Key, Globe, Palette, Laptop } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { useSettingsStore } from '@/store';
import type { Language, Settings as SettingsType } from '@/types';
import { LANGUAGE_NAMES, POLISH_TEMPLATE_NAMES } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import {
    CUSTOM_MODEL_OPTION_VALUE,
    OPENAI_MODEL_OPTIONS,
    isBuiltInOpenAIModel,
    normalizeModelName,
} from '@/services/models';

interface SettingsProps {
    onNavigateBack: () => void;
}

type AiFormField = 'provider' | 'openaiApiKey' | 'customApiUrl' | 'customApiKey' | 'modelName';
const AI_FORM_FIELDS: AiFormField[] = [
    'provider',
    'openaiApiKey',
    'customApiUrl',
    'customApiKey',
    'modelName',
];

export const Settings: React.FC<SettingsProps> = ({ onNavigateBack }) => {
    const {
        openaiApiKey,
        provider,
        customApiUrl,
        customApiKey,
        modelName,
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

    const [settings, setSettings] = useState({
        provider: provider || 'openai',
        openaiApiKey: openaiApiKey || '',
        customApiUrl: customApiUrl || '',
        customApiKey: customApiKey || '',
        modelName: modelName || '',
    });

    const [isSaving, setIsSaving] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const dirtyFieldsRef = useRef<Set<AiFormField>>(new Set());
    const fieldEditVersionRef = useRef<Record<AiFormField, number>>({
        provider: 0,
        openaiApiKey: 0,
        customApiUrl: 0,
        customApiKey: 0,
        modelName: 0,
    });

    const updateFormField = <K extends AiFormField>(field: K, value: (typeof settings)[K]) => {
        dirtyFieldsRef.current.add(field);
        fieldEditVersionRef.current[field] += 1;
        setSaveError(null);
        setSettings((current) => ({
            ...current,
            [field]: value,
        }));
    };

    // Update local state when store changes unless a field has unsaved local edits
    React.useEffect(() => {
        setSettings((current) => ({
            provider: dirtyFieldsRef.current.has('provider')
                ? current.provider
                : provider || 'openai',
            openaiApiKey: dirtyFieldsRef.current.has('openaiApiKey')
                ? current.openaiApiKey
                : openaiApiKey || '',
            customApiUrl: dirtyFieldsRef.current.has('customApiUrl')
                ? current.customApiUrl
                : customApiUrl || '',
            customApiKey: dirtyFieldsRef.current.has('customApiKey')
                ? current.customApiKey
                : customApiKey || '',
            modelName: dirtyFieldsRef.current.has('modelName')
                ? current.modelName
                : modelName || '',
        }));
    }, [provider, openaiApiKey, customApiUrl, customApiKey, modelName]);

    const handleSaveSettings = async () => {
        setIsSaving(true);
        setSaveError(null);
        try {
            const submittedFields = AI_FORM_FIELDS.filter((field) =>
                dirtyFieldsRef.current.has(field),
            );
            const submittedVersions: Record<AiFormField, number> = {
                ...fieldEditVersionRef.current,
            };
            const updates: Partial<SettingsType> = {};

            for (const field of submittedFields) {
                if (field === 'provider') {
                    updates.provider = settings.provider;
                } else if (field === 'openaiApiKey') {
                    updates.openaiApiKey = settings.openaiApiKey;
                } else if (field === 'customApiUrl') {
                    updates.customApiUrl = settings.customApiUrl;
                } else if (field === 'customApiKey') {
                    updates.customApiKey = settings.customApiKey;
                } else if (field === 'modelName') {
                    updates.modelName = normalizeModelName(settings.modelName);
                }
            }

            if (submittedFields.length > 0) {
                await updateSettings(updates);
            }

            for (const field of submittedFields) {
                if (fieldEditVersionRef.current[field] === submittedVersions[field]) {
                    dirtyFieldsRef.current.delete(field);
                }
            }

            const nextState = useSettingsStore.getState();
            setSettings((current) => ({
                provider: dirtyFieldsRef.current.has('provider')
                    ? current.provider
                    : nextState.provider || 'openai',
                openaiApiKey: dirtyFieldsRef.current.has('openaiApiKey')
                    ? current.openaiApiKey
                    : nextState.openaiApiKey || '',
                customApiUrl: dirtyFieldsRef.current.has('customApiUrl')
                    ? current.customApiUrl
                    : nextState.customApiUrl || '',
                customApiKey: dirtyFieldsRef.current.has('customApiKey')
                    ? current.customApiKey
                    : nextState.customApiKey || '',
                modelName: dirtyFieldsRef.current.has('modelName')
                    ? current.modelName
                    : nextState.modelName || '',
            }));
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const selectedModelPreset = isBuiltInOpenAIModel(settings.modelName.trim())
        ? settings.modelName.trim()
        : CUSTOM_MODEL_OPTION_VALUE;

    return (
        <div className="flex flex-col h-screen bg-bg-primary">
            {/* Header */}
            <header className="h-14 border-b border-border-primary flex items-center px-4">
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
                                value={settings.provider}
                                onChange={(e) =>
                                    updateFormField(
                                        'provider',
                                        e.target.value as 'openai' | 'custom',
                                    )
                                }
                                className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                            >
                                <option value="openai">{t('settings.provider.openai')}</option>
                                <option value="custom">{t('settings.provider.custom')}</option>
                            </select>
                            <p className="text-xs text-text-muted mt-2">
                                {t('settings.permission_hint')}
                            </p>
                        </div>

                        {settings.provider === 'openai' ? (
                            <div>
                                <label className="block text-sm font-medium text-text-primary mb-2">
                                    {t('settings.apikey.label')}
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        type={showApiKey ? 'text' : 'password'}
                                        value={settings.openaiApiKey}
                                        onChange={(e) =>
                                            updateFormField('openaiApiKey', e.target.value)
                                        }
                                        placeholder={t('settings.apikey.placeholder')}
                                        className="flex-1"
                                    />
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
                        ) : (
                            <>
                                <div>
                                    <label className="block text-sm font-medium text-text-primary mb-2">
                                        {t('settings.customUrl.label')}
                                    </label>
                                    <Input
                                        type="text"
                                        value={settings.customApiUrl}
                                        onChange={(e) =>
                                            updateFormField('customApiUrl', e.target.value)
                                        }
                                        placeholder={t('settings.customUrl.placeholder')}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-text-primary mb-2">
                                        {t('settings.customKey.label')}
                                    </label>
                                    <div className="flex gap-2">
                                        <Input
                                            type={showApiKey ? 'text' : 'password'}
                                            value={settings.customApiKey}
                                            onChange={(e) =>
                                                updateFormField('customApiKey', e.target.value)
                                            }
                                            placeholder={t('settings.customKey.placeholder')}
                                            className="flex-1"
                                        />
                                        <Button
                                            variant="ghost"
                                            onClick={() => setShowApiKey(!showApiKey)}
                                        >
                                            {showApiKey ? t('settings.hide') : t('settings.show')}
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                {t('settings.modelPreset.label')}
                            </label>
                            <select
                                value={selectedModelPreset}
                                onChange={(e) => {
                                    const nextModel =
                                        e.target.value === CUSTOM_MODEL_OPTION_VALUE
                                            ? isBuiltInOpenAIModel(settings.modelName.trim())
                                                ? ''
                                                : settings.modelName
                                            : e.target.value;
                                    updateFormField('modelName', nextModel);
                                }}
                                className="w-full px-4 py-2 bg-bg-tertiary border border-border-primary rounded-lg text-text-primary"
                            >
                                {OPENAI_MODEL_OPTIONS.map((option) => (
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
                                value={settings.modelName}
                                onChange={(e) => updateFormField('modelName', e.target.value)}
                                placeholder={t('settings.modelName.placeholder')}
                            />
                            <p className="text-xs text-text-muted mt-2">
                                {t('settings.modelName.help')}
                            </p>
                        </div>

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
