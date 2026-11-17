export const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';

export const OPENAI_MODEL_OPTIONS = [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5-mini',
    'gpt-5-nano',
] as const;

export const CUSTOM_MODEL_OPTION_VALUE = '__custom__';

export const isBuiltInOpenAIModel = (modelName: string): boolean => {
    return OPENAI_MODEL_OPTIONS.includes(modelName as (typeof OPENAI_MODEL_OPTIONS)[number]);
};

export const normalizeModelName = (modelName?: string | null): string => {
    const trimmedModelName = modelName?.trim();
    return trimmedModelName || DEFAULT_OPENAI_MODEL;
};

export const supportsCustomTemperature = (modelName?: string | null): boolean => {
    const normalized = normalizeModelName(modelName).toLowerCase();
    if (
        normalized === 'gpt-5-mini' ||
        normalized === 'gpt-5-nano' ||
        normalized.startsWith('gpt-5-mini-') ||
        normalized.startsWith('gpt-5-nano-') ||
        /^o[134](-|$)/.test(normalized)
    ) {
        return false;
    }
    return true;
};
