import type { Settings } from '@/types';
import { DEFAULT_OPENAI_MODEL, normalizeModelName } from '@/services/models';

export const DEFAULT_SETTINGS: Settings = {
    openaiApiKey: '',
    provider: 'openai',
    customApiUrl: '',
    customApiKey: '',
    modelName: DEFAULT_OPENAI_MODEL,
    defaultLanguage: 'en',
    defaultPolishTemplate: 'professional',
    theme: 'dark',
    uiLanguage: 'en',
    prompts: [],
};

export const normalizeSettings = (settings?: Partial<Settings> | null): Settings => {
    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        customApiUrl: settings?.customApiUrl ?? DEFAULT_SETTINGS.customApiUrl,
        customApiKey: settings?.customApiKey ?? DEFAULT_SETTINGS.customApiKey,
        modelName: normalizeModelName(settings?.modelName),
        prompts: settings?.prompts ?? DEFAULT_SETTINGS.prompts,
    };
};
