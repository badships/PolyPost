import React, { useState } from 'react';
import { Sparkles, Globe, Plus, Trash2, Copy, Check } from 'lucide-react';
import type { Variant } from '@/types';
import { POLISH_TEMPLATE_NAMES, LANGUAGE_NAMES } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store';
import { countCharacters } from '@/utils';

interface VariantsPanelProps {
    variants: Variant[];
    onSelectVariant: (id: string) => void;
    onDeleteVariant: (id: string) => void;
    onGenerateMore: () => void;
    isGenerating?: boolean;
}

export const VariantsPanel: React.FC<VariantsPanelProps> = ({
    variants,
    onSelectVariant,
    onDeleteVariant,
    onGenerateMore,
    isGenerating = false,
}) => {
    const { t, getTemplateName } = useTranslation();
    const prompts = useSettingsStore((s) => s.prompts);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const getPromptName = (templateId?: string | null) => {
        if (!templateId) return 'Variant';
        const prompt = prompts.find((item) => item.id === templateId);
        const fallback =
            prompt?.name ||
            POLISH_TEMPLATE_NAMES[templateId as keyof typeof POLISH_TEMPLATE_NAMES] ||
            templateId;
        return getTemplateName(templateId, fallback);
    };

    const getVariantLabel = (variant: Variant) => {
        if (variant.type === 'polish' && variant.promptTemplate) {
            return getPromptName(variant.promptTemplate);
        }
        if (variant.type === 'translation' && variant.language) {
            return LANGUAGE_NAMES[variant.language];
        }
        return 'Variant';
    };

    const getVariantIcon = (variant: Variant) => {
        if (variant.type === 'translation') {
            return <Globe size={10} />;
        }
        return <Sparkles size={10} />;
    };

    const handleCopy = async (variantId: string, content: string) => {
        if (!navigator?.clipboard?.writeText) {
            console.warn('Clipboard API is not available.');
            return;
        }

        try {
            await navigator.clipboard.writeText(content);
            setCopiedId(variantId);
            window.setTimeout(() => {
                setCopiedId((current) => (current === variantId ? null : current));
            }, 1500);
        } catch (error) {
            console.error('Failed to copy variant content:', error);
        }
    };

    const getVariantFooter = (variant: Variant) => {
        if (variant.isSelected) {
            return t('editor.variants.selected_hint');
        }
        if (variant.type === 'polish') {
            return t('editor.variants.polished');
        }
        if (variant.type === 'translation') {
            return t('editor.variants.translated');
        }
        return variant.description;
    };

    return (
        <div className="flex flex-col">
            {/* Header row with inline Regenerate action */}
            <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
                <div className="flex items-center gap-1.5">
                    <h2 className="text-[11.5px] font-bold text-text-secondary">
                        {t('editor.variants')}
                    </h2>
                    <span className="inline-flex items-center justify-center h-[17px] px-1.5 rounded-full bg-bg-tertiary text-text-primary text-[10.5px] font-bold tabular-nums">
                        {variants.length}
                    </span>
                </div>

                <button
                    type="button"
                    onClick={onGenerateMore}
                    disabled={isGenerating}
                    className="inline-flex items-center gap-0.5 text-[11.5px] font-bold text-accent hover:underline transition-colors disabled:opacity-50"
                >
                    <Plus size={12} strokeWidth={2.5} />
                    <span>
                        {isGenerating
                            ? t('editor.variants.generate_more.loading')
                            : t('editor.variants.generate_more')}
                    </span>
                </button>
            </div>

            {/* Variants list */}
            {variants.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-border-primary rounded-xl bg-bg-secondary/40">
                    <div className="w-9 h-9 rounded-full bg-bg-secondary border border-border-primary flex items-center justify-center mb-2">
                        <Sparkles size={15} className="text-text-muted" />
                    </div>
                    <p className="text-text-muted text-xs leading-relaxed">
                        {t('editor.variants.empty')}
                        <br />
                        {t('editor.variants.empty_desc')}
                    </p>
                </div>
            ) : (
                <div className="space-y-2 pb-4">
                    {variants.map((variant) => {
                        const isCopied = copiedId === variant.id;
                        const charCount = countCharacters(variant.content);
                        return (
                            <div
                                key={variant.id}
                                onClick={() => onSelectVariant(variant.id)}
                                className={`rounded-xl p-2.5 border cursor-pointer transition-colors ${
                                    variant.isSelected
                                        ? 'bg-accent/[0.08] border-accent/50'
                                        : 'bg-bg-primary border-border-primary hover:border-border-secondary hover:bg-bg-secondary/60'
                                }`}
                            >
                                {/* Variant header */}
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-bg-secondary border border-border-primary text-[10.5px] font-bold text-text-primary truncate">
                                            {getVariantIcon(variant)}
                                            <span className="truncate">
                                                {getVariantLabel(variant)}
                                            </span>
                                        </span>
                                        {variant.isSelected && (
                                            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-accent text-white text-[10px] font-bold shrink-0">
                                                <Check size={10} strokeWidth={3} />
                                                <span>{t('editor.variant.active')}</span>
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-0.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void handleCopy(variant.id, variant.content);
                                            }}
                                            className={`w-6 h-6 rounded-full inline-flex items-center justify-center hover:bg-bg-tertiary transition-colors ${
                                                isCopied
                                                    ? 'text-status-posted'
                                                    : 'text-text-muted hover:text-text-primary'
                                            }`}
                                            aria-label={
                                                isCopied ? t('actions.copied') : t('actions.copy')
                                            }
                                            title={
                                                isCopied ? t('actions.copied') : t('actions.copy')
                                            }
                                        >
                                            {isCopied ? <Check size={12} /> : <Copy size={12} />}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDeleteVariant(variant.id);
                                            }}
                                            className="w-6 h-6 rounded-full inline-flex items-center justify-center hover:bg-[#f4212e]/10 text-text-muted hover:text-[#f4212e] transition-colors"
                                            aria-label={t('actions.delete')}
                                            title={t('actions.delete')}
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>

                                {/* Content preview */}
                                <p className="text-[13px] text-text-primary leading-[1.48] my-1.5 whitespace-pre-wrap break-words">
                                    {variant.content}
                                </p>

                                {/* Footer */}
                                <div className="flex items-center justify-between text-[11px] text-text-secondary">
                                    <span>{getVariantFooter(variant)}</span>
                                    <span className="tabular-nums">{charCount} / 280</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
