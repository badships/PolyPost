import type { PolishPrompt, Settings } from '@/types';
import { POLISH_TEMPLATE_NAMES } from '@/types';
import { POLISH_PROMPTS, POLISH_TEMPLATE_DESCRIPTIONS } from '@/services/prompts';
import { DEFAULT_OPENAI_MODEL, normalizeModelName } from '@/services/models';

export const buildDefaultPrompts = (): PolishPrompt[] => {
    return Object.entries(POLISH_PROMPTS).map(([key, content]) => ({
        id: key,
        template: key,
        name: POLISH_TEMPLATE_NAMES[key] || key,
        description: POLISH_TEMPLATE_DESCRIPTIONS[key] || '',
        content,
    }));
};

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
    prompts: buildDefaultPrompts(),
};

export const normalizeSettings = (settings?: Partial<Settings> | null): Settings => {
    const rawPrompts = Array.isArray(settings?.prompts) ? settings.prompts : [];
    const prompts =
        rawPrompts.length > 0 ? rawPrompts.map((prompt) => ({ ...prompt })) : buildDefaultPrompts();
    const requestedDefault =
        settings?.defaultPolishTemplate || DEFAULT_SETTINGS.defaultPolishTemplate;
    const defaultPolishTemplate = prompts.some((prompt) => prompt.id === requestedDefault)
        ? requestedDefault
        : prompts[0]?.id || DEFAULT_SETTINGS.defaultPolishTemplate;

    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        customApiUrl: settings?.customApiUrl ?? DEFAULT_SETTINGS.customApiUrl,
        customApiKey: settings?.customApiKey ?? DEFAULT_SETTINGS.customApiKey,
        modelName: normalizeModelName(settings?.modelName),
        defaultPolishTemplate,
        prompts,
    };
};
