import OpenAI from 'openai';
import type { ApiFormat, Language } from '@/types';
import { getTranslationPrompt, LANGUAGE_FULL_NAMES } from './prompts';
import { proxyFetch } from './proxyFetch';
import { normalizeModelName, supportsCustomTemperature, usesMaxCompletionTokens } from './models';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

const COMPLETION_TOKEN_LIMIT = 2048;

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
        const resolvedBaseUrl = normalizeBaseUrl(baseURL);
        const useProxyFetch = isCustomApiEndpoint(baseURL);
        const configKey = `${apiKey}|${resolvedBaseUrl}|${useProxyFetch ? 'proxy' : 'direct'}`;

        if (!this.client || this.clientConfigKey !== configKey) {
            this.client = new OpenAI({
                apiKey,
                baseURL: resolvedBaseUrl,
                fetch: useProxyFetch ? proxyFetch : undefined,
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

    private async createAnthropicCompletion(params: {
        apiKey: string;
        baseURL?: string;
        model: string;
        system: string;
        userPrompt: string;
        failureMessage: string;
    }): Promise<string> {
        const url = buildAnthropicMessagesUrl(params.baseURL);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-api-key': params.apiKey,
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
            response = await proxyFetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: params.model,
                    max_tokens: COMPLETION_TOKEN_LIMIT,
                    system: params.system,
                    messages: [
                        {
                            role: 'user',
                            content: params.userPrompt,
                        },
                    ],
                }),
            });
        } catch (error) {
            console.error('Anthropic request error:', error);
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
            const apiMessage =
                data?.error?.message ||
                data?.message ||
                `Request failed with status ${response.status}`;
            throw new Error(apiMessage);
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
        if (!apiKey) {
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
            apiKey,
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
        if (!apiKey) {
            throw new Error('API key is required. Please configure it in Settings.');
        }

        const prompt = getTranslationPrompt(content, targetLanguage);

        const translatedContent = await this.runCompletion({
            apiFormat,
            apiKey,
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
