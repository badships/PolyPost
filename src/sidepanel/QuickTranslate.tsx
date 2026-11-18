import React, { useEffect, useState } from 'react';
import { Copy, Check, Languages, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/hooks/useTranslation';
import { aiService } from '@/services/ai';
import { resolveActiveProviderConfig } from '@/services/settingsDefaults';
import { ensureHostPermission } from '@/services/permissions';
import { countCharacters } from '@/utils';
import type { Language } from '@/types';
import { LANGUAGE_NAMES } from '@/types';

const LANGUAGE_FLAGS: Record<Language, string> = {
    en: '🇺🇸',
    zh: '🇨🇳',
    jp: '🇯🇵',
    es: '🇪🇸',
    fr: '🇫🇷',
    de: '🇩🇪',
    ko: '🇰🇷',
};

export const QuickTranslate: React.FC = () => {
    const { t } = useTranslation();
    const defaultLanguage = useSettingsStore((s) => s.defaultLanguage);

    const [sourceText, setSourceText] = useState('');
    const [translatedText, setTranslatedText] = useState('');
    const [targetLanguage, setTargetLanguage] = useState<Language>(defaultLanguage);
    const [isTranslating, setIsTranslating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setTargetLanguage(defaultLanguage);
    }, [defaultLanguage]);

    const handleTranslate = async () => {
        if (!sourceText.trim()) {
            setError(t('editor.translate_error'));
            return;
        }

        const activeConfig = resolveActiveProviderConfig(useSettingsStore.getState());
        if (activeConfig.isCustom && (!activeConfig.baseUrl || !activeConfig.apiKey)) {
            setError(t('editor.api_key_missing_custom'));
            return;
        }
        if (!activeConfig.isCustom && !activeConfig.apiKey) {
            setError(t('editor.api_key_missing_openai'));
            return;
        }

        const permissionResult = await ensureHostPermission(activeConfig.baseUrl);
        if (!permissionResult.granted) {
            if (permissionResult.reason === 'invalid_url') {
                setError(t('editor.permission.invalid_url'));
            } else if (permissionResult.reason === 'not_allowed') {
                setError(t('editor.permission.not_allowed', permissionResult.origin || ''));
            } else {
                setError(t('editor.permission.denied', permissionResult.origin || ''));
            }
            return;
        }

        setIsTranslating(true);
        setError(null);

        try {
            const result = await aiService.translate(
                sourceText,
                targetLanguage,
                activeConfig.apiKey,
                activeConfig.modelName,
                activeConfig.baseUrl,
                activeConfig.apiFormat,
            );
            setTranslatedText(result.content);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('editor.translate_fail'));
        } finally {
            setIsTranslating(false);
        }
    };

    const handleCopy = async () => {
        if (!translatedText || !navigator?.clipboard?.writeText) {
            return;
        }

        try {
            await navigator.clipboard.writeText(translatedText);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Failed to copy translation:', err);
        }
    };

    const handleClear = () => {
        setSourceText('');
        setTranslatedText('');
        setCopied(false);
        setError(null);
    };

    const languages = Object.entries(LANGUAGE_NAMES) as [Language, string][];

    return (
        <div className="space-y-2.5 pb-4">
            {/* 1-Tap Target Language Capsules */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                {languages.map(([lang, label]) => {
                    const active = targetLanguage === lang;
                    return (
                        <button
                            key={lang}
                            onClick={() => setTargetLanguage(lang)}
                            className={`shrink-0 h-7 px-2.5 rounded-full text-[11px] border transition-colors inline-flex items-center gap-1 ${
                                active
                                    ? 'bg-cta-bg text-cta-text border-cta-bg font-bold'
                                    : 'bg-bg-primary border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-secondary font-semibold'
                            }`}
                        >
                            <span className="text-xs leading-none">{LANGUAGE_FLAGS[lang]}</span>
                            <span>{label}</span>
                        </button>
                    );
                })}
            </div>

            {error && (
                <div className="px-3 py-2 bg-[#f4212e]/10 border border-[#f4212e]/30 rounded-xl text-[#f4212e] text-xs">
                    {error}
                </div>
            )}

            {/* Unified Split Translator Card */}
            <div className="bg-bg-secondary border border-border-primary rounded-xl overflow-hidden">
                {/* Upper Source Section */}
                <div className="p-3 border-b border-border-primary">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-semibold text-text-muted">
                            {t('quick_translate.source.label')}
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-text-muted tabular-nums">
                                {t('post.chars_count', countCharacters(sourceText))}
                            </span>
                            {(sourceText || translatedText) && (
                                <button
                                    onClick={handleClear}
                                    className="w-5 h-5 rounded-full inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                                    title={t('quick_translate.clear')}
                                    aria-label={t('quick_translate.clear')}
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    </div>

                    <textarea
                        value={sourceText}
                        onChange={(event) => {
                            setSourceText(event.target.value);
                            setError(null);
                        }}
                        placeholder={t('quick_translate.source.placeholder')}
                        className="min-h-[110px] w-full bg-transparent border-0 p-0 text-[13px] leading-[1.48] text-text-primary placeholder-text-muted focus:outline-none focus:ring-0 focus-visible:outline-none resize-none"
                    />
                </div>

                {/* Middle Action Divider */}
                <div className="px-3 py-2 border-b border-border-primary bg-bg-secondary flex items-center justify-between gap-2">
                    <span className="text-[11px] text-text-muted">
                        {t('editor.translate.auto_detect')}
                    </span>
                    <Button
                        size="sm"
                        onClick={handleTranslate}
                        isLoading={isTranslating}
                        leftIcon={<Languages size={13} />}
                    >
                        {t('quick_translate.translate')}
                    </Button>
                </div>

                {/* Lower Output Section */}
                <div className="p-3 bg-bg-primary">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-semibold text-accent">
                            {t('quick_translate.target.label')}
                        </span>
                        <button
                            onClick={handleCopy}
                            disabled={!translatedText}
                            className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                copied
                                    ? 'bg-status-posted/15 text-status-posted border border-status-posted/35'
                                    : 'bg-bg-secondary border border-border-primary text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            {copied ? <Check size={11} /> : <Copy size={11} />}
                            <span>{copied ? t('actions.copied') : t('actions.copy')}</span>
                        </button>
                    </div>

                    <textarea
                        readOnly
                        value={translatedText}
                        placeholder={t('quick_translate.target.placeholder')}
                        className="min-h-[110px] w-full bg-transparent border-0 p-0 text-[13px] leading-[1.48] text-text-primary placeholder-text-muted focus:outline-none focus:ring-0 focus-visible:outline-none resize-none"
                    />
                </div>
            </div>
        </div>
    );
};
