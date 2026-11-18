import OpenAI from 'openai';
import type { ApiFormat, Language } from '@/types';
import { getTranslationPrompt, LANGUAGE_FULL_NAMES } from './prompts';
import { proxyFetch, type ProxyFetchInit } from './proxyFetch';
import { normalizeModelName, supportsCustomTemperature, usesMaxCompletionTokens } from './models';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const TEST_CONNECTION_TIMEOUT_MS = 10_000;

const COMPLETION_TOKEN_LIMIT = 2048;

const sanitizeApiKey = (apiKey: string): string => {
    let result = '';
    for (const ch of apiKey) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
            continue;
        }
        result += ch;
    }
    return result.trim();
};

const stripControlChars = (value: string): string => {
    let result = '';
    for (const ch of value) {
        const code = ch.charCodeAt(0);
        if ((code >= 0x00 && code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
            continue;
        }
        result += ch;
    }
    return result.trim();
};

const toSafeErrorText = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'object') {
        const obj = value as { error?: unknown; message?: unknown; detail?: unknown };
        if (obj.error !== undefined && obj.error !== value) {
            const nested = toSafeErrorText(obj.error);
            if (nested) return nested;
        }
        if (obj.message !== undefined && obj.message !== value) {
            const nested = toSafeErrorText(obj.message);
            if (nested) return nested;
        }
        if (obj.detail !== undefined && obj.detail !== value) {
            const nested = toSafeErrorText(obj.detail);
            if (nested) return nested;
        }
        if (value instanceof Error && typeof value.message === 'string') {
            return value.message;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return '';
        }
    }
    return '';
};

export const sanitizeProviderErrorMessage = (
    raw: unknown,
    apiKey?: string,
    status?: number,
    fallback = 'Connection test failed.',
): string => {
    const rawStatus =
        status ??
        (raw && typeof raw === 'object' && typeof (raw as { status?: unknown }).status === 'number'
            ? (raw as { status: number }).status
            : undefined);

    let message = stripControlChars(toSafeErrorText(raw));
    if (!message) {
        message = rawStatus ? `Request failed with status ${rawStatus}` : fallback;
    }

    const candidates = new Set<string>();
    if (typeof apiKey === 'string') {
        const trimmed = apiKey.trim();
        const cleaned = sanitizeApiKey(apiKey);
        if (trimmed.length >= 4) candidates.add(trimmed);
        if (cleaned.length >= 4) candidates.add(cleaned);
    }
    for (const secret of candidates) {
        message = message.split(secret).join('[REDACTED]');
    }

    message = message
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]');

    if (message.length > 240) {
        message = `${message.slice(0, 237)}...`;
    }

    if (rawStatus && !message.includes(String(rawStatus))) {
        return `${rawStatus}: ${message}`;
    }
    return message;
};

const isValidOpenAIProbeResponse = (data: unknown): boolean => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const obj = data as { error?: unknown; choices?: unknown };
    if (obj.error) {
        return false;
    }
    if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
        return false;
    }
    const choice = obj.choices[0] as {
        finish_reason?: unknown;
        message?: unknown;
    } | null;
    if (!choice || typeof choice !== 'object') {
        return false;
    }
    const message = choice.message as {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
    } | null;
    if (!message || typeof message !== 'object') {
        return false;
    }
    const hasText =
        (typeof message.content === 'string' && message.content.trim().length > 0) ||
        (typeof message.reasoning_content === 'string' &&
            message.reasoning_content.trim().length > 0) ||
        (typeof message.reasoning === 'string' && message.reasoning.trim().length > 0);
    if (hasText) {
        return true;
    }
    return (
        choice.finish_reason === 'length' &&
        (typeof message.content === 'string' || message.content === null)
    );
};

const isValidAnthropicProbeResponse = (data: unknown): boolean => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const obj = data as { error?: unknown; content?: unknown };
    if (obj.error) {
        return false;
    }
    if (Array.isArray(obj.content) && obj.content.length > 0) {
        return obj.content.every((block) => {
            if (!block || typeof block !== 'object') {
                return false;
            }
            const b = block as { type?: unknown; text?: unknown; thinking?: unknown };
            if (typeof b.type !== 'string') {
                return false;
            }
            if (b.type === 'text') {
                return typeof b.text === 'string';
            }
            if (b.type === 'thinking') {
                return typeof b.thinking === 'string';
            }
            return true;
        });
    }
    return isValidOpenAIProbeResponse(data);
};

const normalizeBaseUrl = (baseURL?: string): string => {
    const trimmed = baseURL?.trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_OPENAI_BASE_URL;
};

export const buildAnthropicMessagesUrl = (baseURL?: string): string => {
    const trimmed = baseURL?.trim().replace(/\/+$/, '');
    if (!trimmed) {
        return `${DEFAULT_ANTHROPIC_BASE_URL}/messages`;
    }
    if (trimmed.endsWith('/v1/messages') || trimmed.endsWith('/messages')) {
        return trimmed;
    }
    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/messages`;
    }
    return `${trimmed}/v1/messages`;
};

const isCustomApiEndpoint = (baseURL?: string): boolean => {
    if (!baseURL?.trim()) {
        return false;
    }

    const normalized = normalizeBaseUrl(baseURL);
    if (normalized === DEFAULT_OPENAI_BASE_URL) {
        return false;
    }

    try {
        return new URL(normalized).hostname.toLowerCase() !== 'api.openai.com';
    } catch {
        return true;
    }
};

const noRedirectDirectFetch: typeof fetch = (input, init) => {
    return fetch(input, {
        ...init,
        redirect: init?.redirect ?? 'error',
    });
};

const noRedirectProxyFetch: typeof fetch = (input, init) => {
    return proxyFetch(input, {
        ...init,
        redirect: init?.redirect ?? 'error',
    });
};

interface AIResponse {
    content: string;
    description: string;
}

/**
 * AI Service for content polishing and translation
 */
export class AIService {
    private client: OpenAI | null = null;
    private clientConfigKey: string | null = null;

    private getLanguageGuardrail(): string {
        return '请保持输出与输入语言一致，不要翻译。Keep the output in the same language as the input. Do not translate.';
    }

    private getClient(apiKey: string, baseURL?: string): OpenAI {
        const cleanKey = sanitizeApiKey(apiKey);
        const resolvedBaseUrl = normalizeBaseUrl(baseURL);
        const useProxyFetch = isCustomApiEndpoint(baseURL);
        const configKey = `${cleanKey}|${resolvedBaseUrl}|${useProxyFetch ? 'proxy' : 'direct'}`;

        if (!this.client || this.clientConfigKey !== configKey) {
            this.client = new OpenAI({
                apiKey: cleanKey,
                baseURL: resolvedBaseUrl,
                fetch: useProxyFetch ? noRedirectProxyFetch : noRedirectDirectFetch,
                dangerouslyAllowBrowser: true, // Required for browser extension
            });
            this.clientConfigKey = configKey;
        }
        return this.client;
    }

    private extractCompletionText(response: OpenAI.Chat.Completions.ChatCompletion): string {
        const choice = response.choices[0];
        const text = choice?.message?.content?.trim() || '';
        if (!text) {
            throw new Error('AI returned an empty response. Please try again.');
        }
        if (choice?.finish_reason === 'length') {
            throw new Error('AI response was truncated before completion. Please try again.');
        }
        return text;
    }

    private async sendAnthropicRequest(params: {
        apiKey: string;
        baseURL?: string;
        model: string;
        system: string;
        userPrompt: string;
        maxTokens?: number;
        timeoutMs?: number;
        signal?: AbortSignal;
        failureMessage: string;
    }): Promise<any> {
        const cleanKey = sanitizeApiKey(params.apiKey);
        const url = buildAnthropicMessagesUrl(params.baseURL);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-api-key': cleanKey,
            'anthropic-version': '2023-06-01',
        };

        try {
            if (new URL(url).hostname.toLowerCase() === 'api.anthropic.com') {
                headers['anthropic-dangerous-direct-browser-access'] = 'true';
            }
        } catch {
            // Allow proxyFetch to surface URL validation errors if malformed.
        }

        let response: Response;
        try {
            const requestInit: ProxyFetchInit = {
                method: 'POST',
                headers,
                redirect: 'error',
                signal: params.signal,
                timeoutMs: params.timeoutMs,
                body: JSON.stringify({
                    model: params.model,
                    max_tokens: params.maxTokens ?? COMPLETION_TOKEN_LIMIT,
                    system: params.system,
                    messages: [
                        {
                            role: 'user',
                            content: params.userPrompt,
                        },
                    ],
                }),
            };
            response = await proxyFetch(url, requestInit);
        } catch (error) {
            console.error('Anthropic request error:', error);
            if (params.signal?.aborted) {
                throw new Error('Connection test timed out.');
            }
            throw new Error(params.failureMessage);
        }

        const rawBody = await response.text();
        let data: any = null;
        if (rawBody) {
            try {
                data = JSON.parse(rawBody);
            } catch {
                data = null;
            }
        }

        if (!response.ok) {
            throw new Error(
                sanitizeProviderErrorMessage(
                    data ?? rawBody,
                    params.apiKey,
                    response.status,
                    `Request failed with status ${response.status}`,
                ),
            );
        }

        return data;
    }

    private async createAnthropicCompletion(params: {
        apiKey: string;
        baseURL?: string;
        model: string;
        system: string;
        userPrompt: string;
        maxTokens?: number;
        failureMessage: string;
    }): Promise<string> {
        const data = await this.sendAnthropicRequest(params);

        if (data?.stop_reason === 'max_tokens') {
            throw new Error('AI response was truncated before completion. Please try again.');
        }

        const contentBlocks = Array.isArray(data?.content) ? data.content : [];
        const textFromBlocks = contentBlocks
            .filter(
                (block: any) => block && block.type === 'text' && typeof block.text === 'string',
            )
            .map((block: any) => block.text)
            .join('')
            .trim();

        const fallbackText =
            typeof data?.choices?.[0]?.message?.content === 'string'
                ? data.choices[0].message.content.trim()
                : '';

        const text = textFromBlocks || fallbackText;
        if (!text) {
            throw new Error('AI returned an empty response. Please try again.');
        }

        return text;
    }

    private async createOpenAICompletion(params: {
        apiKey: string;
        baseURL?: string;
        model: string;
        system: string;
        userPrompt: string;
        temperature: number;
        failureMessage: string;
    }): Promise<string> {
        const client = this.getClient(params.apiKey, params.baseURL);
        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
            const isCustomEndpoint = isCustomApiEndpoint(params.baseURL);
            response = await client.chat.completions.create({
                model: params.model,
                messages: [
                    {
                        role: 'system',
                        content: params.system,
                    },
                    {
                        role: 'user',
                        content: params.userPrompt,
                    },
                ],
                ...(usesMaxCompletionTokens(params.model, isCustomEndpoint)
                    ? { max_completion_tokens: COMPLETION_TOKEN_LIMIT }
                    : { max_tokens: COMPLETION_TOKEN_LIMIT }),
                ...(supportsCustomTemperature(params.model)
                    ? { temperature: params.temperature }
                    : {}),
            });
        } catch (error) {
            console.error('OpenAI request error:', error);
            throw new Error(params.failureMessage);
        }

        return this.extractCompletionText(response);
    }

    private async runCompletion(params: {
        apiFormat: ApiFormat;
        apiKey: string;
        baseURL?: string;
        modelName?: string;
        system: string;
        userPrompt: string;
        temperature: number;
        failureMessage: string;
    }): Promise<string> {
        const model = normalizeModelName(params.modelName);
        if (params.apiFormat === 'anthropic') {
            return this.createAnthropicCompletion({
                apiKey: params.apiKey,
                baseURL: params.baseURL,
                model,
                system: params.system,
                userPrompt: params.userPrompt,
                failureMessage: params.failureMessage,
            });
        }

        return this.createOpenAICompletion({
            apiKey: params.apiKey,
            baseURL: params.baseURL,
            model,
            system: params.system,
            userPrompt: params.userPrompt,
            temperature: params.temperature,
            failureMessage: params.failureMessage,
        });
    }

    /**
     * Verify API key and model connectivity
     */
    async testConnection(params: {
        apiFormat: ApiFormat;
        apiKey: string;
        baseURL?: string;
        modelName?: string;
        timeoutMs?: number;
    }): Promise<{ model: string; latencyMs: number }> {
        const cleanKey = sanitizeApiKey(params.apiKey);
        if (!cleanKey) {
            throw new Error('API key is required.');
        }

        const timeoutMs =
            typeof params.timeoutMs === 'number' && params.timeoutMs > 0
                ? params.timeoutMs
                : TEST_CONNECTION_TIMEOUT_MS;
        const startedAt = Date.now();
        const model = normalizeModelName(params.modelName);
        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            if (params.apiFormat === 'anthropic') {
                const data = await this.sendAnthropicRequest({
                    apiKey: cleanKey,
                    baseURL: params.baseURL,
                    model,
                    system: 'Reply with OK.',
                    userPrompt: 'Ping',
                    maxTokens: 64,
                    timeoutMs,
                    signal: controller.signal,
                    failureMessage: 'Network error while connecting to endpoint.',
                });
                if (!isValidAnthropicProbeResponse(data)) {
                    throw new Error('Provider returned an unexpected response format.');
                }
                return { model, latencyMs: Math.max(1, Date.now() - startedAt) };
            }

            const isCustomEndpoint = isCustomApiEndpoint(params.baseURL);
            const probeFetch: typeof fetch = (input, init) => {
                const probeInit: ProxyFetchInit = {
                    ...init,
                    redirect: 'error',
                    timeoutMs,
                };
                return isCustomEndpoint ? proxyFetch(input, probeInit) : fetch(input, probeInit);
            };
            const probeClient = new OpenAI({
                apiKey: cleanKey,
                baseURL: normalizeBaseUrl(params.baseURL),
                fetch: probeFetch,
                maxRetries: 0,
                timeout: timeoutMs,
                dangerouslyAllowBrowser: true,
            });

            const response = await probeClient.chat.completions.create(
                {
                    model,
                    messages: [{ role: 'user', content: 'Ping' }],
                    ...(usesMaxCompletionTokens(model, isCustomEndpoint)
                        ? { max_completion_tokens: 64 }
                        : { max_tokens: 64 }),
                },
                {
                    maxRetries: 0,
                    timeout: timeoutMs,
                    signal: controller.signal,
                },
            );
            if (!isValidOpenAIProbeResponse(response)) {
                throw new Error('Provider returned an unexpected response format.');
            }
            return { model, latencyMs: Math.max(1, Date.now() - startedAt) };
        } catch (error) {
            if (timedOut) {
                throw new Error('Connection test timed out.');
            }
            throw new Error(
                sanitizeProviderErrorMessage(
                    error,
                    params.apiKey,
                    undefined,
                    'Connection test failed.',
                ),
            );
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Polish content using specified prompt template
     */
    async polish(
        content: string,
        promptTemplate: string, // The actual prompt text, not just ID
        apiKey: string,
        modelName?: string,
        baseURL?: string,
        apiFormat: ApiFormat = 'openai',
    ): Promise<AIResponse> {
        const cleanKey = sanitizeApiKey(apiKey);
        if (!cleanKey) {
            throw new Error('API key is required. Please configure it in Settings.');
        }

        // Construct the full prompt
        let prompt: string;
        if (promptTemplate.includes('{content}')) {
            // User provided a custom template with placeholder
            prompt = promptTemplate.replace('{content}', content);
        } else {
            // Standard wrapping for simple instructions
            prompt = `${promptTemplate}

Original tweet:
${content}

Rewritten tweet:`;
        }

        prompt = `${prompt}\n\n${this.getLanguageGuardrail()}`;

        const generatedContent = await this.runCompletion({
            apiFormat,
            apiKey: cleanKey,
            baseURL,
            modelName,
            system: 'You are a professional social media content writer. Keep the output in the same language as the input. 不要翻译，保持与输入相同语言。Output only the rewritten text, nothing else.',
            userPrompt: prompt,
            temperature: 0.7,
            failureMessage: 'Failed to polish content. Please check your API key and try again.',
        });

        return {
            content: generatedContent,
            description: 'Polished content', // Description handling needs update in caller
        };
    }

    /**
     * Translate content to target language
     */
    async translate(
        content: string,
        targetLanguage: Language,
        apiKey: string,
        modelName?: string,
        baseURL?: string,
        apiFormat: ApiFormat = 'openai',
    ): Promise<AIResponse> {
        const cleanKey = sanitizeApiKey(apiKey);
        if (!cleanKey) {
            throw new Error('API key is required. Please configure it in Settings.');
        }

        const prompt = getTranslationPrompt(content, targetLanguage);

        const translatedContent = await this.runCompletion({
            apiFormat,
            apiKey: cleanKey,
            baseURL,
            modelName,
            system: 'You are a professional translator. Detect the source language automatically and translate to the target language. 请自动识别源语言并翻译成目标语言。Output only the translated text, nothing else.',
            userPrompt: prompt,
            temperature: 0.3,
            failureMessage: 'Failed to translate content. Please check your API key and try again.',
        });

        return {
            content: translatedContent,
            description: `Accurate translation to ${LANGUAGE_FULL_NAMES[targetLanguage]}`,
        };
    }
}

// Singleton instance
export const aiService = new AIService();
