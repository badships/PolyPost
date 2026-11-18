import React, { useEffect, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import type { Language } from '@/types';
import { LANGUAGE_NAMES } from '@/types';
import { Languages } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

type TranslateSourceMode = 'source' | 'selected';

interface TranslateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTranslate: (targetLanguages: Language[], sourceMode: TranslateSourceMode) => void;
    isLoading?: boolean;
    hasSelectedVariant?: boolean;
    selectedVariantLabel?: string;
    defaultSourceMode?: TranslateSourceMode;
    defaultTargets?: Language[];
    progress?: {
        completed: number;
        total: number;
        currentLabel?: string;
    } | null;
}

const languageFlags: Record<Language, string> = {
    en: '🇺🇸',
    zh: '🇨🇳',
    jp: '🇯🇵',
    es: '🇪🇸',
    fr: '🇫🇷',
    de: '🇩🇪',
    ko: '🇰🇷',
};

export const TranslateModal: React.FC<TranslateModalProps> = ({
    isOpen,
    onClose,
    onTranslate,
    isLoading = false,
    hasSelectedVariant = false,
    selectedVariantLabel,
    defaultSourceMode = 'source',
    defaultTargets,
    progress = null,
}) => {
    const { t } = useTranslation();
    const [selectedTargets, setSelectedTargets] = useState<Language[]>(defaultTargets || ['zh']);
    const [sourceMode, setSourceMode] = useState<TranslateSourceMode>(defaultSourceMode);

    const languages = Object.keys(LANGUAGE_NAMES) as Language[];

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        setSourceMode(hasSelectedVariant ? defaultSourceMode : 'source');
        if (defaultTargets && defaultTargets.length > 0) {
            setSelectedTargets(defaultTargets);
        }
    }, [isOpen, hasSelectedVariant, defaultSourceMode, defaultTargets]);

    const handleTranslate = () => {
        if (selectedTargets.length > 0) {
            onTranslate(selectedTargets, sourceMode);
        }
    };

    const toggleTarget = (lang: Language) => {
        setSelectedTargets((prev) => {
            if (prev.includes(lang)) {
                return prev.filter((item) => item !== lang);
            }
            return [...prev, lang];
        });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('editor.translate.title')} size="sm">
            <div className="space-y-4">
                {hasSelectedVariant && (
                    <div>
                        <label className="block text-xs font-semibold text-text-secondary mb-2">
                            {t('editor.translate.source')}
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setSourceMode('source')}
                                className={`
                  p-2.5 rounded-xl border text-center transition-colors flex flex-col items-center
                  ${
                      sourceMode === 'source'
                          ? 'border-accent bg-accent/[0.08]'
                          : 'border-border-primary bg-bg-secondary hover:border-border-secondary'
                  }
                `}
                            >
                                <span className="text-xs font-semibold text-text-primary">
                                    {t('editor.translate.source.source')}
                                </span>
                            </button>
                            <button
                                onClick={() => setSourceMode('selected')}
                                className={`
                  p-2.5 rounded-xl border text-center transition-colors flex flex-col items-center
                  ${
                      sourceMode === 'selected'
                          ? 'border-accent bg-accent/[0.08]'
                          : 'border-border-primary bg-bg-secondary hover:border-border-secondary'
                  }
                `}
                            >
                                <span className="text-xs font-semibold text-text-primary">
                                    {t('editor.translate.source.selected')}
                                </span>
                                {selectedVariantLabel && (
                                    <span className="text-[11px] text-text-muted mt-0.5">
                                        {selectedVariantLabel}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {/* Target language */}
                <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1">
                        {t('editor.translate.to')}
                    </label>
                    <p className="text-[11px] text-text-muted mb-2.5">
                        {t('editor.translate.auto_detect')} · {t('editor.translate.multi_select')}
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        {languages.map((lang) => (
                            <button
                                key={`target-${lang}`}
                                onClick={() => toggleTarget(lang)}
                                className={`
                  p-2.5 rounded-xl border text-center transition-colors
                  ${
                      selectedTargets.includes(lang)
                          ? 'border-accent bg-accent/[0.08]'
                          : 'border-border-primary bg-bg-secondary hover:border-border-secondary'
                  }
                `}
                            >
                                <span className="text-base">{languageFlags[lang]}</span>
                                <p className="text-[11px] font-semibold text-text-primary mt-1">
                                    {LANGUAGE_NAMES[lang]}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>

                {progress && progress.total > 0 && (
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-text-muted">
                            <span>
                                {t('editor.translate.progress')}
                                {progress.currentLabel ? ` · ${progress.currentLabel}` : ''}
                            </span>
                            <span className="tabular-nums">
                                {progress.completed}/{progress.total}
                            </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden">
                            <div
                                className="h-full bg-accent transition-all"
                                style={{
                                    width: `${Math.min((progress.completed / progress.total) * 100, 100)}%`,
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-3 border-t border-border-primary">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {t('editor.translate.cancel')}
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleTranslate}
                        isLoading={isLoading}
                        leftIcon={<Languages size={14} />}
                        disabled={selectedTargets.length === 0}
                    >
                        {selectedTargets.length > 1
                            ? t('editor.translate.submit.multi', selectedTargets.length)
                            : t('editor.translate.submit', LANGUAGE_NAMES[selectedTargets[0]])}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
