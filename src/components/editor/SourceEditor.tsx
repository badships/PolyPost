import React, { useState, useRef, useEffect } from 'react';
import {
    Sparkles,
    Globe,
    Copy,
    Check,
    Trash2,
    ChevronDown,
    Briefcase,
    Flame,
    Coffee,
    Cpu,
    Smile,
    Zap,
    PenTool,
    Loader2,
} from 'lucide-react';
import { countCharacters } from '@/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { Folder, Language, PolishPrompt, PolishTemplate } from '@/types';
import { LANGUAGE_NAMES } from '@/types';

const MAX_CHARS = 280;
const CIRCLE_R = 7.5;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
    professional: <Briefcase size={11} />,
    viral: <Flame size={11} />,
    casual: <Coffee size={11} />,
    technical: <Cpu size={11} />,
    emoji: <Smile size={11} />,
    concise: <Zap size={11} />,
};

const LANGUAGE_FLAGS: Record<Language, string> = {
    en: '🇺🇸',
    zh: '🇨🇳',
    jp: '🇯🇵',
    es: '🇪🇸',
    fr: '🇫🇷',
    de: '🇩🇪',
    ko: '🇰🇷',
};

interface SourceEditorProps {
    content: string;
    onChange: (content: string) => void;
    onBlur?: () => void;
    onClear?: () => void;
    onPolish: () => void;
    onPolishTemplate?: (templateId: PolishTemplate) => void;
    onTranslate: () => void;
    onQuickTranslate?: (targetLanguage: Language, sourceMode: 'source' | 'selected') => void;
    prompts?: PolishPrompt[];
    folders?: Folder[];
    currentFolderId?: string | null;
    onChangeFolder?: (folderId: string | null) => void;
    activeModelName?: string;
    defaultLanguage?: Language;
    hasSelectedVariant?: boolean;
    selectedVariantLabel?: string;
    onUseSource?: () => void;
    isPolishing?: boolean;
    isTranslating?: boolean;
}

export const SourceEditor: React.FC<SourceEditorProps> = ({
    content,
    onChange,
    onBlur,
    onClear,
    onPolish,
    onPolishTemplate,
    onTranslate,
    onQuickTranslate,
    prompts = [],
    folders = [],
    currentFolderId = null,
    onChangeFolder,
    activeModelName,
    defaultLanguage = 'en',
    hasSelectedVariant = false,
    selectedVariantLabel,
    onUseSource,
    isPolishing = false,
    isTranslating = false,
}) => {
    const { t, getTemplateName } = useTranslation();

    // Track IME composition state
    const isComposingRef = useRef(false);
    const [isComposing, setIsComposing] = useState(false);
    const [localValue, setLocalValue] = useState(content);
    const [copied, setCopied] = useState(false);
    const [activeTray, setActiveTray] = useState<'polish' | 'translate' | null>('polish');
    const [translateSourceMode, setTranslateSourceMode] = useState<'source' | 'selected'>('source');
    const [isFolderMenuOpen, setIsFolderMenuOpen] = useState(false);
    const folderMenuRef = useRef<HTMLDivElement>(null);

    const displayedContent = isComposing ? localValue : content;
    const charCount = countCharacters(displayedContent);
    const isOverLimit = charCount > MAX_CHARS;
    const isNearLimit = !isOverLimit && charCount > 240;
    const progress = Math.min(charCount / MAX_CHARS, 1);
    const dashOffset = CIRCLE_CIRCUMFERENCE * (1 - progress);
    const ringStroke = isOverLimit ? '#f4212e' : isNearLimit ? '#ffd400' : '#1d9bf0';

    // Sync local value with props when content changes externally
    useEffect(() => {
        if (!isComposingRef.current) {
            setLocalValue(content);
        }
    }, [content]);

    useEffect(() => {
        if (!hasSelectedVariant) {
            setTranslateSourceMode('source');
        }
    }, [hasSelectedVariant]);

    useEffect(() => {
        if (!isFolderMenuOpen) return;
        const handleOutside = (event: MouseEvent) => {
            if (folderMenuRef.current && !folderMenuRef.current.contains(event.target as Node)) {
                setIsFolderMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [isFolderMenuOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        if (isComposingRef.current) {
            setLocalValue(newValue);
            return;
        }
        onChange(newValue);
    };

    const handleCompositionStart = () => {
        isComposingRef.current = true;
        setIsComposing(true);
        setLocalValue(content);
    };

    const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
        isComposingRef.current = false;
        setIsComposing(false);
        const finalVal = (e.target as HTMLTextAreaElement).value;
        setLocalValue(finalVal);
        onChange(finalVal);
    };

    const handleCopySource = async () => {
        if (!content || !navigator?.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Failed to copy source content:', err);
        }
    };

    const currentFolder = folders.find((f) => f.id === currentFolderId) || null;
    const languages = Object.entries(LANGUAGE_NAMES) as [Language, string][];

    const getTemplateIcon = (prompt: PolishPrompt) => {
        return (
            TEMPLATE_ICONS[prompt.template] || TEMPLATE_ICONS[prompt.id] || <PenTool size={11} />
        );
    };

    return (
        <div className="bg-bg-secondary border border-border-primary rounded-xl p-2.5 transition-colors focus-within:border-accent">
            {/* Composer Header */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                    {/* Folder Selector Chip */}
                    <div className="relative" ref={folderMenuRef}>
                        <button
                            type="button"
                            onClick={() => {
                                if (onChangeFolder) {
                                    setIsFolderMenuOpen((prev) => !prev);
                                }
                            }}
                            className="h-[22px] px-2 rounded-full bg-bg-primary border border-border-primary hover:border-border-secondary text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors inline-flex items-center gap-1.5 max-w-[130px]"
                        >
                            <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                    backgroundColor: currentFolder?.color || '#1d9bf0',
                                }}
                            />
                            <span className="truncate">
                                {currentFolder ? currentFolder.name : t('post.no_folder')}
                            </span>
                            {onChangeFolder && (
                                <ChevronDown size={10} className="shrink-0 opacity-75" />
                            )}
                        </button>

                        {isFolderMenuOpen && onChangeFolder && (
                            <div className="absolute left-0 mt-1 w-44 py-1 rounded-xl bg-bg-primary border border-border-primary shadow-xl z-30">
                                <button
                                    type="button"
                                    onClick={() => {
                                        void onChangeFolder(null);
                                        setIsFolderMenuOpen(false);
                                    }}
                                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${
                                        !currentFolderId
                                            ? 'bg-accent/10 text-accent font-semibold'
                                            : 'text-text-primary hover:bg-bg-secondary'
                                    }`}
                                >
                                    <span className="w-1.5 h-1.5 rounded-full bg-border-secondary shrink-0" />
                                    <span className="truncate">{t('post.no_folder')}</span>
                                </button>
                                {folders.map((folder) => (
                                    <button
                                        key={folder.id}
                                        type="button"
                                        onClick={() => {
                                            void onChangeFolder(folder.id);
                                            setIsFolderMenuOpen(false);
                                        }}
                                        className={`w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${
                                            currentFolderId === folder.id
                                                ? 'bg-accent/10 text-accent font-semibold'
                                                : 'text-text-primary hover:bg-bg-secondary'
                                        }`}
                                    >
                                        <span
                                            className="w-1.5 h-1.5 rounded-full shrink-0"
                                            style={{ backgroundColor: folder.color }}
                                        />
                                        <span className="truncate">{folder.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {hasSelectedVariant && onUseSource && (
                        <button
                            type="button"
                            onClick={onUseSource}
                            className="h-5 px-2 rounded-full border border-border-secondary text-[10.5px] font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shrink-0"
                        >
                            {t('editor.use_source')}
                        </button>
                    )}
                </div>

                {/* X-Style Circular SVG Char Gauge */}
                <div className="flex items-center gap-1.5 shrink-0">
                    <span
                        className={`text-[11px] tabular-nums ${
                            isOverLimit
                                ? 'text-[#f4212e] font-semibold'
                                : isNearLimit
                                  ? 'text-[#ffd400] font-medium'
                                  : 'text-text-muted'
                        }`}
                    >
                        {charCount} / {MAX_CHARS}
                    </span>
                    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
                        <circle
                            cx="10"
                            cy="10"
                            r={CIRCLE_R}
                            fill="none"
                            stroke="rgb(var(--border-secondary))"
                            strokeWidth="2"
                        />
                        <circle
                            cx="10"
                            cy="10"
                            r={CIRCLE_R}
                            fill="none"
                            stroke={ringStroke}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeDasharray={CIRCLE_CIRCUMFERENCE.toFixed(2)}
                            strokeDashoffset={dashOffset.toFixed(2)}
                            transform="rotate(-90 10 10)"
                            className="transition-all duration-150"
                        />
                    </svg>
                </div>
            </div>

            {/* Clean borderless textarea */}
            <textarea
                value={displayedContent}
                onChange={handleChange}
                onBlur={onBlur}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder={t('editor.source.placeholder_text')}
                className="w-full min-h-[76px] lg:min-h-[160px] bg-transparent border-0 p-0 text-[13px] leading-[1.48] text-text-primary placeholder-text-muted focus:outline-none focus:ring-0 focus-visible:outline-none resize-none"
            />

            {/* Bottom Composer Toolbar */}
            <div className="pt-2 mt-1.5 border-t border-border-primary flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() =>
                            setActiveTray((prev) => (prev === 'polish' ? null : 'polish'))
                        }
                        disabled={isPolishing}
                        className={`h-[26px] px-2.5 rounded-full text-[11.5px] font-semibold text-accent inline-flex items-center gap-1 transition-colors disabled:opacity-50 ${
                            activeTray === 'polish'
                                ? 'bg-accent/10 ring-1 ring-accent/45'
                                : 'hover:bg-accent/10'
                        }`}
                    >
                        {isPolishing ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <Sparkles size={12} />
                        )}
                        <span>{t('editor.ai_polish')}</span>
                        <ChevronDown
                            size={10}
                            className={`transition-transform ${activeTray === 'polish' ? 'rotate-180' : ''}`}
                        />
                    </button>

                    <button
                        type="button"
                        onClick={() =>
                            setActiveTray((prev) => (prev === 'translate' ? null : 'translate'))
                        }
                        disabled={isTranslating}
                        className={`h-[26px] px-2.5 rounded-full text-[11.5px] font-semibold text-accent inline-flex items-center gap-1 transition-colors disabled:opacity-50 ${
                            activeTray === 'translate'
                                ? 'bg-accent/10 ring-1 ring-accent/45'
                                : 'hover:bg-accent/10'
                        }`}
                    >
                        {isTranslating ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : (
                            <Globe size={12} />
                        )}
                        <span>{t('editor.translate')}</span>
                        <ChevronDown
                            size={10}
                            className={`transition-transform ${activeTray === 'translate' ? 'rotate-180' : ''}`}
                        />
                    </button>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        type="button"
                        onClick={handleCopySource}
                        disabled={!content}
                        className={`w-6 h-6 rounded-full inline-flex items-center justify-center transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                            copied
                                ? 'text-status-posted bg-status-posted/10'
                                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                        }`}
                        title={copied ? t('actions.copied') : t('actions.copy')}
                        aria-label={copied ? t('actions.copied') : t('actions.copy')}
                    >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                        }}
                        onClick={() => {
                            setLocalValue('');
                            if (onClear) {
                                onClear();
                            } else {
                                onChange('');
                            }
                        }}
                        disabled={!content}
                        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-[#f4212e] hover:bg-[#f4212e]/10 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                        title={t('quick_translate.clear')}
                        aria-label={t('quick_translate.clear')}
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>

            {/* Inline AI Polish Tray */}
            {activeTray === 'polish' && (
                <div className="mt-2 p-2 rounded-[10px] bg-bg-primary border border-border-primary flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-[10.5px] font-semibold text-text-muted">
                        <span className="truncate">{t('editor.polish.tray_hint')}</span>
                        {activeModelName && (
                            <span className="font-mono shrink-0 text-text-secondary">
                                {activeModelName}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {prompts.map((prompt) => (
                            <button
                                key={prompt.id}
                                type="button"
                                disabled={isPolishing}
                                onClick={() => {
                                    if (onPolishTemplate) {
                                        onPolishTemplate(prompt.id);
                                    } else {
                                        onPolish();
                                    }
                                }}
                                className="h-[22px] px-2 rounded-full border border-border-secondary bg-bg-secondary hover:border-accent hover:text-accent hover:bg-accent/10 text-[10.5px] font-semibold text-text-primary inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                                {getTemplateIcon(prompt)}
                                <span>{getTemplateName(prompt.id, prompt.name)}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Inline Translate Tray */}
            {activeTray === 'translate' && (
                <div className="mt-2 p-2 rounded-[10px] bg-bg-primary border border-border-primary flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2 text-[10.5px] font-semibold text-text-muted">
                        <span className="truncate">{t('editor.translate.tray_hint')}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                            {hasSelectedVariant && (
                                <button
                                    type="button"
                                    onClick={() =>
                                        setTranslateSourceMode((m) =>
                                            m === 'source' ? 'selected' : 'source',
                                        )
                                    }
                                    className="px-1.5 py-0.5 rounded-full border border-border-primary bg-bg-secondary text-[10px] text-text-secondary hover:text-text-primary transition-colors"
                                >
                                    {translateSourceMode === 'selected'
                                        ? `${t('editor.translate.source.selected')}${selectedVariantLabel ? ` · ${selectedVariantLabel}` : ''}`
                                        : t('editor.translate.source.source')}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onTranslate}
                                className="text-accent hover:underline font-bold"
                            >
                                {t('editor.translate.batch_btn')}
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {languages.map(([lang, label]) => {
                            const isDefault = lang === defaultLanguage;
                            return (
                                <button
                                    key={lang}
                                    type="button"
                                    disabled={isTranslating}
                                    onClick={() => {
                                        if (onQuickTranslate) {
                                            onQuickTranslate(lang, translateSourceMode);
                                        } else {
                                            onTranslate();
                                        }
                                    }}
                                    className={`h-[22px] px-2 rounded-full border text-[10.5px] font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-50 ${
                                        isDefault
                                            ? 'border-accent/45 bg-accent/10 text-accent hover:bg-accent/15'
                                            : 'border-border-secondary bg-bg-secondary text-text-primary hover:border-accent hover:text-accent hover:bg-accent/10'
                                    }`}
                                >
                                    <span className="text-[11px] leading-none">
                                        {LANGUAGE_FLAGS[lang]}
                                    </span>
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
