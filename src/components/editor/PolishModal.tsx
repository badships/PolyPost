import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import { useSettingsStore } from '@/store';
import { Sparkles, Briefcase, Flame, Coffee, Cpu, Smile, Zap, PenTool } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface PolishModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPolish: (templateId: string) => void;
    isLoading?: boolean;
}

const templateIcons: Record<string, React.ReactNode> = {
    professional: <Briefcase size={16} />,
    viral: <Flame size={16} />,
    casual: <Coffee size={16} />,
    technical: <Cpu size={16} />,
    emoji: <Smile size={16} />,
    concise: <Zap size={16} />,
};

// Fallback icon for custom prompts
const DEFAULT_ICON = <PenTool size={16} />;

export const PolishModal: React.FC<PolishModalProps> = ({
    isOpen,
    onClose,
    onPolish,
    isLoading = false,
}) => {
    const { t, getTemplateName, getTemplateDesc } = useTranslation();
    const { prompts, defaultPolishTemplate } = useSettingsStore();
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
        defaultPolishTemplate || 'professional',
    );
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (!isOpen) {
            wasOpenRef.current = false;
            return;
        }
        const justOpened = !wasOpenRef.current;
        wasOpenRef.current = true;

        setSelectedTemplateId((current) => {
            if (!justOpened && prompts.some((p) => p.id === current)) {
                return current;
            }
            if (prompts.some((p) => p.id === defaultPolishTemplate)) {
                return defaultPolishTemplate;
            }
            return prompts[0]?.id || 'professional';
        });
    }, [isOpen, defaultPolishTemplate, prompts]);

    const handlePolish = () => {
        onPolish(selectedTemplateId);
    };

    const getIcon = (id: string, templateKey: string) => {
        return templateIcons[templateKey] || templateIcons[id] || DEFAULT_ICON;
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('editor.polish.title')} size="md">
            <div className="space-y-3.5">
                <p className="text-xs text-text-secondary">{t('editor.polish.desc')}</p>

                {/* Template grid */}
                <div className="grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
                    {prompts.map((prompt) => {
                        const selected = selectedTemplateId === prompt.id;
                        return (
                            <button
                                key={prompt.id}
                                onClick={() => setSelectedTemplateId(prompt.id)}
                                className={`
                                    p-3 rounded-xl border text-left transition-colors
                                    ${
                                        selected
                                            ? 'border-accent bg-accent/[0.08]'
                                            : 'border-border-primary bg-bg-secondary hover:border-border-secondary'
                                    }
                                `}
                            >
                                <div
                                    className={`w-8 h-8 rounded-lg border flex items-center justify-center mb-2 ${
                                        selected
                                            ? 'bg-accent/15 border-accent/45 text-accent'
                                            : 'bg-bg-primary border-border-primary text-text-primary'
                                    }`}
                                >
                                    {getIcon(prompt.id, prompt.template)}
                                </div>
                                <h3 className="font-bold text-text-primary text-xs truncate">
                                    {getTemplateName(prompt.id, prompt.name)}
                                </h3>
                                <p className="text-[11px] text-text-muted mt-1 line-clamp-2">
                                    {getTemplateDesc(prompt.id, prompt.description)}
                                </p>
                            </button>
                        );
                    })}
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-3 border-t border-border-primary">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {t('editor.polish.cancel')}
                    </Button>
                    <Button
                        size="sm"
                        onClick={handlePolish}
                        isLoading={isLoading}
                        leftIcon={<Sparkles size={14} />}
                        disabled={!selectedTemplateId}
                    >
                        {t('editor.polish.submit')}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
