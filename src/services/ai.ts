import OpenAI from 'openai';
import type { Language } from '@/types';
import { getTranslationPrompt, LANGUAGE_FULL_NAMES } from './prompts';
import { proxyFetch } from './proxyFetch';
import { normalizeModelName, supportsCustomTemperature, usesMaxCompletionTokens } from './models';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

const STANDARD_MAX_TOKENS = 300;
const REASONING_MAX_COMPLETION_TOKENS = 2048;

const normalizeBaseUrl = (baseURL?: string): string => {
    const trimmed = baseURL?.trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_OPENAI_BASE_URL;
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
    confidence: number;
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

    /**
     * Polish content using specified prompt template
     */
    async polish(
        content: string,
        promptTemplate: string, // The actual prompt text, not just ID
        apiKey: string,
        modelName?: string,
        baseURL?: string,
    ): Promise<AIResponse> {
        if (!apiKey) {
            throw new Error('API key is required. Please configure it in Settings.');
        }

        const client = this.getClient(apiKey, baseURL);
        const resolvedModelName = normalizeModelName(modelName);

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

        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
            const isCustomEndpoint = isCustomApiEndpoint(baseURL);
            response = await client.chat.completions.create({
                model: resolvedModelName,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a professional social media content writer. Keep the output in the same language as the input. 不要翻译，保持与输入相同语言。Output only the rewritten text, nothing else.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                ...(usesMaxCompletionTokens(resolvedModelName, isCustomEndpoint)
                    ? { max_completion_tokens: REASONING_MAX_COMPLETION_TOKENS }
                    : { max_tokens: STANDARD_MAX_TOKENS }),
                ...(supportsCustomTemperature(resolvedModelName) ? { temperature: 0.7 } : {}),
            });
        } catch (error) {
            console.error('Polish error:', error);
            throw new Error('Failed to polish content. Please check your API key and try again.');
        }

        const generatedContent = this.extractCompletionText(response);

        // Calculate confidence based on response quality
        const confidence = this.calculateConfidence(content, generatedContent);

        return {
            content: generatedContent,
            confidence,
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
    ): Promise<AIResponse> {
        if (!apiKey) {
            throw new Error('API key is required. Please configure it in Settings.');
        }

        const client = this.getClient(apiKey, baseURL);
        const resolvedModelName = normalizeModelName(modelName);
        const prompt = getTranslationPrompt(content, targetLanguage);

        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
            const isCustomEndpoint = isCustomApiEndpoint(baseURL);
            response = await client.chat.completions.create({
                model: resolvedModelName,
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are a professional translator. Detect the source language automatically and translate to the target language. 请自动识别源语言并翻译成目标语言。Output only the translated text, nothing else.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                ...(usesMaxCompletionTokens(resolvedModelName, isCustomEndpoint)
                    ? { max_completion_tokens: REASONING_MAX_COMPLETION_TOKENS }
                    : { max_tokens: STANDARD_MAX_TOKENS }),
                ...(supportsCustomTemperature(resolvedModelName) ? { temperature: 0.3 } : {}),
            });
        } catch (error) {
            console.error('Translation error:', error);
            throw new Error(
                'Failed to translate content. Please check your API key and try again.',
            );
        }

        const translatedContent = this.extractCompletionText(response);

        return {
            content: translatedContent,
            confidence: 95, // High confidence for translation
            description: `Accurate translation to ${LANGUAGE_FULL_NAMES[targetLanguage]}`,
        };
    }

    /**
     * Calculate AI confidence score
     */
    private calculateConfidence(original: string, generated: string): number {
        // Simple heuristic based on length and content
        if (!generated) return 0;

        // Check if generated content is reasonable length
        const lengthRatio = generated.length / original.length;
        if (lengthRatio < 0.3 || lengthRatio > 3) {
            return 70;
        }

        // Check if within Twitter limit
        if (generated.length > 280) {
            return 75;
        }

        // Good generation
        return 90 + Math.floor(Math.random() * 8); // 90-97
    }
}

// Singleton instance
export const aiService = new AIService();
