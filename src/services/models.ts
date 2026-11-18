import type { ApiFormat, BuiltInProviderId } from '@/types';

export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-terra';

export const OPENAI_MODEL_OPTIONS = [
    'gpt-6.2-astra',
    'gpt-6.2-sol',
    'gpt-6.1-terra',
    'gpt-6-luna',
] as const;

export const LEGACY_BUILTIN_OPENAI_MODELS = [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5-mini',
    'gpt-5-nano',
] as const;

export const CUSTOM_MODEL_OPTION_VALUE = '__custom__';

export interface BuiltInProviderDefinition {
    id: BuiltInProviderId;
    apiFormat: ApiFormat;
    baseUrl: string;
    defaultModel: string;
    models: readonly string[];
}

export const BUILTIN_PROVIDER_IDS: readonly BuiltInProviderId[] = [
    'openai',
    'anthropic',
    'gemini',
    'xai',
    'deepseek',
    'qwen',
    'kimi',
    'zhipu',
    'openrouter',
] as const;

export const BUILTIN_PROVIDERS: Record<BuiltInProviderId, BuiltInProviderDefinition> = {
    openai: {
        id: 'openai',
        apiFormat: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: DEFAULT_OPENAI_MODEL,
        models: OPENAI_MODEL_OPTIONS,
    },
    anthropic: {
        id: 'anthropic',
        apiFormat: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-sonnet-5-5',
        models: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    },
    gemini: {
        id: 'gemini',
        apiFormat: 'openai',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: 'gemini-4-hydrogen',
        models: ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.5-flash-lite'],
    },
    xai: {
        id: 'xai',
        apiFormat: 'openai',
        baseUrl: 'https://api.x.ai/v1',
        defaultModel: 'grok-4.7',
        models: ['grok-4.7', 'grok-4.6', 'grok-4.3', 'grok-4.20-0309-non-reasoning'],
    },
    deepseek: {
        id: 'deepseek',
        apiFormat: 'openai',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-flash',
        models: ['deepseek-flash', 'deepseek-v4-pro'],
    },
    qwen: {
        id: 'qwen',
        apiFormat: 'openai',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen3.7-plus',
        models: [
            'qwen4-max',
            'qwen3.8-max',
            'qwen3.7-plus',
            'qwen3.8-flash',
            'qwen-max',
            'qwen-plus',
            'qwen-flash',
        ],
    },
    kimi: {
        id: 'kimi',
        apiFormat: 'openai',
        baseUrl: 'https://api.moonshot.cn/v1',
        defaultModel: 'kimi-k3.1-pro-highspeed',
        models: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3'],
    },
    zhipu: {
        id: 'zhipu',
        apiFormat: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-5.3-flash',
        models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2'],
    },
    openrouter: {
        id: 'openrouter',
        apiFormat: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'anthropic/claude-sonnet-5.5',
        models: [
            'anthropic/claude-sonnet-5.5',
            'openai/gpt-6.1-terra',
            'google/gemini-4-hydrogen',
            'deepseek/deepseek-flash',
            'x-ai/grok-4.7',
            'qwen/qwen4-max',
        ],
    },
};

export const isBuiltInProviderId = (value?: string | null): value is BuiltInProviderId => {
    return typeof value === 'string' && value in BUILTIN_PROVIDERS;
};

export const getProviderDefinition = (providerId: BuiltInProviderId): BuiltInProviderDefinition => {
    return BUILTIN_PROVIDERS[providerId];
};

export const getProviderModelOptions = (providerId: BuiltInProviderId): readonly string[] => {
    return BUILTIN_PROVIDERS[providerId].models;
};

export const isBuiltInModelForProvider = (
    providerId: BuiltInProviderId,
    modelName: string,
): boolean => {
    return BUILTIN_PROVIDERS[providerId].models.includes(modelName);
};

export const isBuiltInOpenAIModel = (modelName: string): boolean => {
    return isBuiltInModelForProvider('openai', modelName);
};

export const normalizeModelName = (modelName?: string | null): string => {
    const trimmedModelName = modelName?.trim();
    return trimmedModelName || DEFAULT_OPENAI_MODEL;
};

export const normalizeModelNameForProvider = (
    providerId: BuiltInProviderId,
    modelName?: string | null,
): string => {
    const trimmed = modelName?.trim();
    if (!trimmed) {
        return BUILTIN_PROVIDERS[providerId].defaultModel;
    }
    if (
        providerId === 'openai' &&
        LEGACY_BUILTIN_OPENAI_MODELS.includes(
            trimmed as (typeof LEGACY_BUILTIN_OPENAI_MODELS)[number],
        )
    ) {
        return DEFAULT_OPENAI_MODEL;
    }
    return trimmed;
};

export const supportsCustomTemperature = (modelName?: string | null): boolean => {
    const normalized = normalizeModelName(modelName).toLowerCase();
    return !(
        normalized.startsWith('gpt-6') ||
        normalized.startsWith('kimi-k3') ||
        normalized.startsWith('deepseek-reasoner') ||
        normalized.startsWith('deepseek-v4-pro')
    );
};

export const usesMaxCompletionTokens = (
    modelName?: string | null,
    isCustomEndpoint = false,
): boolean => {
    if (isCustomEndpoint) {
        return false;
    }
    const normalized = normalizeModelName(modelName).toLowerCase();
    return normalized.startsWith('gpt-6');
};
