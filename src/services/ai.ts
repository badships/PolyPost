import OpenAI from 'openai';
import type { ApiFormat, Language } from '@/types';
import { getTranslationPrompt, LANGUAGE_FULL_NAMES } from './prompts';
import { proxyFetch, type ProxyFetchInit } from './proxyFetch';
import { normalizeModelName, supportsCustomTemperature, usesMaxCompletionTokens } from './models';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const TEST_CONNECTION_TIMEOUT_MS = 10_000;
export const COMPLETION_TIMEOUT_MS = 120_000;

const COMPLETION_TOKEN_LIMIT = 2048;
const MAX_ERROR_DEPTH = 4;
const DESCRIPTIVE_ERROR_FIELDS = [
    'error_description',
    'detail',
    'message',
    'title',
    'reason',
] as const;

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
        if (
            (code >= 0x00 && code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
            code === 0x7f
        ) {
            continue;
        }
        result += ch;
    }
    return result.trim();
};

const extractErrorTextInternal = (
    value: unknown,
    depth: number,
    seen: Set<unknown>,
    allowScalarError: boolean,
): string => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value !== 'object' || seen.has(value) || depth >= MAX_ERROR_DEPTH) {
        return '';
    }

    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = extractErrorTextInternal(item, depth + 1, seen, allowScalarError);
            if (nested) {
                return nested;
            }
        }
        return '';
    }

    const record = value as Record<string, unknown>;
    if (typeof record.error === 'object' && record.error !== null && record.error !== value) {
        const nestedErrorObject = extractErrorTextInternal(
            record.error,
            depth + 1,
            seen,
            allowScalarError,
        );
        if (nestedErrorObject) {
            return nestedErrorObject;
        }
    }

    for (const key of DESCRIPTIVE_ERROR_FIELDS) {
        if (value instanceof Error && key === 'message') {
            continue;
        }
        const fieldValue = record[key];
        if (fieldValue !== undefined && fieldValue !== value) {
            if (
                typeof fieldValue === 'string' ||
                typeof fieldValue === 'number' ||
                typeof fieldValue === 'boolean'
            ) {
                const text = String(fieldValue);
                if (text) {
                    return text;
                }
                continue;
            }
            const nested = extractErrorTextInternal(fieldValue, depth + 1, seen, allowScalarError);
            if (nested) {
                return nested;
            }
        }
    }

    if (allowScalarError) {
        if (record.error !== undefined && record.error !== value) {
            const nestedScalarError = extractErrorTextInternal(record.error, depth + 1, seen, true);
            if (nestedScalarError) {
                return nestedScalarError;
            }
        }
        if (value instanceof Error && typeof value.message === 'string' && value.message) {
            return value.message;
        }
    }

    return '';
};

const extractKnownErrorText = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    const descriptive = extractErrorTextInternal(value, 0, new Set(), false);
    if (descriptive) {
        return descriptive;
    }
    return extractErrorTextInternal(value, 0, new Set(), true);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

    let message = stripControlChars(extractKnownErrorText(raw));
    if (!message) {
        message = rawStatus ? `Request failed with status ${rawStatus}` : fallback;
    }

    const candidates = new Set<string>();
    const addSecretVariants = (secret: string): void => {
        if (!secret) {
            return;
        }
        candidates.add(secret);
        try {
            const jsonEscaped = JSON.stringify(secret).slice(1, -1);
            if (jsonEscaped) {
                candidates.add(jsonEscaped);
            }
        } catch {
            // Ignore unserializable sequences
        }
        try {
            const uriEncoded = encodeURIComponent(secret);
            if (uriEncoded) {
                candidates.add(uriEncoded);
            }
        } catch {
            // Ignore malformed surrogate sequences
        }
    };

    if (typeof apiKey === 'string') {
        addSecretVariants(apiKey.trim());
        addSecretVariants(sanitizeApiKey(apiKey));
    }

    const sortedCandidates = [...candidates].sort((a, b) => b.length - a.length);
    const longCandidates = sortedCandidates.filter((item) => item.length >= 4);
    const shortCandidates = sortedCandidates.filter((item) => item.length < 4);

    const redactorParts: string[] = [
        String.raw`\b[Bb][Ee][Aa][Rr][Ee][Rr]\s+[^\s,;)"'}\]]+`,
        ...longCandidates.map(escapeRegExp),
        String.raw`\b(?:[Ss][Kk]|[Rr][Kk]|[Pp][Kk])-[A-Za-z0-9._~+/=-]{2,}`,
        ...shortCandidates.map(escapeRegExp),
    ];
    const redactor = new RegExp(redactorParts.join('|'), 'g');
    message = message.replace(redactor, (match) =>
        /^bearer\s+/i.test(match) ? 'Bearer [REDACTED]' : '[REDACTED]',
    );

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

const isValidAnthropicContentBlock = (block: unknown): boolean => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
        return false;
    }
    const b = block as {
        type?: unknown;
        text?: unknown;
        thinking?: unknown;
        signature?: unknown;
        data?: unknown;
        id?: unknown;
        name?: unknown;
        input?: unknown;
    };
    switch (b.type) {
        case 'text':
            return typeof b.text === 'string';
        case 'thinking':
            return typeof b.thinking === 'string' && typeof b.signature === 'string';
        case 'redacted_thinking':
            return typeof b.data === 'string';
        case 'tool_use':
        case 'server_tool_use':
            return (
                typeof b.id === 'string' &&
                typeof b.name === 'string' &&
                Boolean(b.input && typeof b.input === 'object' && !Array.isArray(b.input))
            );
        default:
            return false;
    }
};

const isValidAnthropicProbeResponse = (data: unknown): boolean => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return false;
    }
    const obj = data as {
        error?: unknown;
        type?: unknown;
        role?: unknown;
        stop_reason?: unknown;
        content?: unknown;
    };
    if (obj.error) {
        return false;
    }
    if (Array.isArray(obj.content)) {
        if (obj.type !== 'message' || obj.role !== 'assistant') {
            return false;
        }
        if (obj.content.length > 0) {
            return obj.content.every(isValidAnthropicContentBlock);
        }
        return obj.stop_reason === 'max_tokens';
    }
    if (obj.type !== undefined && obj.type !== 'message') {
        return false;
    }
    if (obj.role !== undefined && obj.role !== 'assistant') {
        return false;
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

const parseJsonSafely = (rawBody: string): unknown => {
    if (!rawBody) {
        return null;
    }
    try {
        return JSON.parse(rawBody);
    } catch {
        return null;
    }
};

const buildSanitizedHttpError = async (response: Response, apiKey?: string): Promise<Error> => {
    const rawBody = await response.text();
    const parsed = parseJsonSafely(rawBody);
    return new Error(
        sanitizeProviderErrorMessage(
            parsed ?? (rawBody || response.statusText),
            apiKey,
            response.status,
            `Request failed with status ${response.status}`,
        ),
    );
};

const createScopedFetch = (options: {
    useProxy: boolean;
    deadlineAt: number;
    apiKey?: string;
    surfaceHttpError?: boolean;
    onHttpError?: (error: Error) => void;
}): typeof fetch => {
    return async (input, init) => {
        const scopedInit: ProxyFetchInit = {
            ...init,
            redirect: 'error',
            deadlineAt: options.deadlineAt,
            forceDirect: !options.useProxy,
        };
        const response = await proxyFetch(input, scopedInit);
        if (options.surfaceHttpError && !response.ok) {
            const httpError = await buildSanitizedHttpError(response, options.apiKey);
            options.onHttpError?.(httpError);
            // Return an OpenAI-shaped JSON error body rather than rejecting inside fetch,
            // because OpenAI SDK wraps any rejection thrown by fetch into APIConnectionError.
            return new Response(JSON.stringify({ error: { message: httpError.message } }), {
                status: response.status,
                statusText: response.statusText,
                headers: { 'content-type': 'application/json' },
            });
        }
        return response;
    };
};

interface AIResponse {
    content: string;
    description: string;
}

/**
 * AI Service for content polishing and translation
 */
export class AIService {
    private getLanguageGuardrail(): string {
        return '请保持输出与输入语言一致，不要翻译。Keep the output in the same language as the input. Do not translate.';
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
        deadlineAt?: number;
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

        const resolvedDeadlineAt =
            params.deadlineAt ??
            (typeof params.timeoutMs === 'number' && params.timeoutMs > 0
                ? Date.now() + params.timeoutMs
                : Date.now() + COMPLETION_TIMEOUT_MS);

        let response: Response;
        try {
            const requestInit: ProxyFetchInit = {
                method: 'POST',
                headers,
                redirect: 'error',
                signal: params.signal,
                deadlineAt: resolvedDeadlineAt,
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
            if (error instanceof Error && error.message === 'Request timed out') {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw error;
            }
            throw new Error(params.failureMessage);
        }

        if (!response.ok) {
            throw await buildSanitizedHttpError(response, params.apiKey);
        }

        const rawBody = await response.text();
        return parseJsonSafely(rawBody);
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
        const controller = new AbortController();
        const deadlineAt = Date.now() + COMPLETION_TIMEOUT_MS;
        const timeoutId = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);

        let data: any;
        try {
            data = await this.sendAnthropicRequest({
                ...params,
                timeoutMs: COMPLETION_TIMEOUT_MS,
                deadlineAt,
                signal: controller.signal,
            });
        } catch (error) {
            if (
                controller.signal.aborted ||
                (error instanceof Error && error.message === 'Request timed out')
            ) {
                throw new Error(params.failureMessage);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }

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
        const cleanKey = sanitizeApiKey(params.apiKey);
        const deadlineAt = Date.now() + COMPLETION_TIMEOUT_MS;
        const controller = new AbortController();
        let capturedHttpError: Error | null = null;
        const timeoutId = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);
        const isCustomEndpoint = isCustomApiEndpoint(params.baseURL);
        const client = new OpenAI({
            apiKey: cleanKey,
            baseURL: normalizeBaseUrl(params.baseURL),
            fetch: createScopedFetch({
                useProxy: isCustomEndpoint,
                deadlineAt,
                apiKey: params.apiKey,
                surfaceHttpError: true,
                onHttpError: (err) => {
                    capturedHttpError = err;
                },
            }),
            maxRetries: 0,
            timeout: COMPLETION_TIMEOUT_MS,
            dangerouslyAllowBrowser: true,
        });

        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
            response = await client.chat.completions.create(
                {
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
                },
                {
                    maxRetries: 0,
                    timeout: COMPLETION_TIMEOUT_MS,
                    signal: controller.signal,
                },
            );
        } catch (error) {
            console.error('OpenAI request error:', error);
            if (
                !controller.signal.aborted &&
                !(error instanceof Error && error.message === 'Request timed out') &&
                capturedHttpError
            ) {
                throw capturedHttpError;
            }
            throw new Error(params.failureMessage);
        } finally {
            clearTimeout(timeoutId);
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
        const deadlineAt = startedAt + timeoutMs;
        const model = normalizeModelName(params.modelName);
        const controller = new AbortController();
        let timedOut = false;
        let capturedHttpError: Error | null = null;
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
                    deadlineAt,
                    signal: controller.signal,
                    failureMessage: 'Network error while connecting to endpoint.',
                });
                if (!isValidAnthropicProbeResponse(data)) {
                    throw new Error('Provider returned an unexpected response format.');
                }
                return { model, latencyMs: Math.max(1, Date.now() - startedAt) };
            }

            const isCustomEndpoint = isCustomApiEndpoint(params.baseURL);
            const probeClient = new OpenAI({
                apiKey: cleanKey,
                baseURL: normalizeBaseUrl(params.baseURL),
                fetch: createScopedFetch({
                    useProxy: isCustomEndpoint,
                    deadlineAt,
                    apiKey: params.apiKey,
                    surfaceHttpError: true,
                    onHttpError: (err) => {
                        capturedHttpError = err;
                    },
                }),
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
            const cause =
                error && typeof error === 'object'
                    ? (error as { cause?: unknown }).cause
                    : undefined;
            if (
                timedOut ||
                (error instanceof Error && error.message === 'Request timed out') ||
                (cause instanceof Error && cause.message === 'Request timed out')
            ) {
                throw new Error('Connection test timed out.');
            }
            if (capturedHttpError) {
                throw capturedHttpError;
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
