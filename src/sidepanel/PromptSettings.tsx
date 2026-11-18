import React, { useState } from 'react';
import {
    Plus,
    Pencil,
    Trash2,
    X,
    Save,
    AlertCircle,
    Star,
    Briefcase,
    Flame,
    Coffee,
    Cpu,
    Smile,
    Zap,
    PenTool,
} from 'lucide-react';
import { useSettingsStore } from '@/store';
import { useTranslation, type DictionaryKey } from '@/hooks/useTranslation';
import { Button, Badge } from '@/components/ui';
import type { PolishPrompt } from '@/types';

const PROMPT_ICONS: Record<string, React.ReactNode> = {
    professional: <Briefcase size={13} />,
    viral: <Flame size={13} />,
    casual: <Coffee size={13} />,
    technical: <Cpu size={13} />,
    emoji: <Smile size={13} />,
    concise: <Zap size={13} />,
};

const PromptStyleCard: React.FC<{
    prompt: PolishPrompt;
    isDefault: boolean;
    onSetDefault: (id: string) => void;
    onEdit: (prompt: PolishPrompt) => void;
    onDelete: (id: string) => void;
    canDelete: boolean;
    t: (key: DictionaryKey, ...args: (string | number)[]) => string;
}> = ({ prompt, isDefault, onSetDefault, onEdit, onDelete, canDelete, t }) => {
    const icon = PROMPT_ICONS[prompt.template] || PROMPT_ICONS[prompt.id] || <PenTool size={13} />;

    return (
        <div
            onClick={() => onEdit(prompt)}
            className={`p-2.5 rounded-xl border flex flex-col gap-1.5 cursor-pointer transition-colors ${
                isDefault
                    ? 'border-accent/45 bg-accent/[0.06]'
                    : 'border-border-primary bg-bg-primary hover:bg-bg-secondary hover:border-border-secondary'
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-[7px] bg-bg-secondary border border-border-primary text-text-primary flex items-center justify-center shrink-0">
                        {icon}
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-text-primary text-[12.5px] truncate">
                            {prompt.name}
                        </span>
                        {isDefault && (
                            <Badge variant="language" className="shrink-0">
                                {t('settings.prompts.default_label')}
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Inline Direct Actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!isDefault) {
                                onSetDefault(prompt.id);
                            }
                        }}
                        disabled={isDefault}
                        className={`w-6 h-6 rounded-full inline-flex items-center justify-center transition-colors ${
                            isDefault
                                ? 'text-accent cursor-default'
                                : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                        }`}
                        title={t('settings.prompts.set_default')}
                        aria-label={t('settings.prompts.set_default')}
                    >
                        <Star size={12} className={isDefault ? 'fill-current' : ''} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(prompt);
                        }}
                        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                        title={t('settings.prompts.edit')}
                        aria-label={t('settings.prompts.edit')}
                    >
                        <Pencil size={12} />
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(prompt.id);
                        }}
                        disabled={!canDelete}
                        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-[#f4212e] hover:bg-[#f4212e]/10 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                        title={t('settings.prompts.delete')}
                        aria-label={t('settings.prompts.delete')}
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            <p className="text-text-secondary text-[11px] leading-[1.4] font-mono line-clamp-2 whitespace-pre-wrap">
                {prompt.content || prompt.template}
            </p>
        </div>
    );
};

export const PromptSettings: React.FC = () => {
    const {
        prompts,
        addPrompt,
        updatePrompt,
        deletePrompt,
        defaultPolishTemplate,
        setDefaultPolishTemplate,
    } = useSettingsStore();
    const { t } = useTranslation();
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState<Omit<PolishPrompt, 'id'>>({
        template: '',
        name: '',
        description: '',
        content: '',
    });

    const resetForm = () => {
        setIsAdding(false);
        setEditingId(null);
        setFormError(null);
        setFormData({ name: '', description: '', template: '', content: '' });
    };

    const handleEdit = (prompt: PolishPrompt) => {
        setEditingId(prompt.id);
        setFormError(null);
        setActionError(null);
        setFormData({
            name: prompt.name,
            description: prompt.description,
            template: prompt.template,
            content: prompt.content,
        });
        setIsAdding(false);
    };

    const handleStartAdd = () => {
        setFormError(null);
        setActionError(null);
        setIsAdding(true);
    };

    const handleSetDefault = async (id: string) => {
        setActionError(null);
        try {
            await setDefaultPolishTemplate(id);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to update default prompt');
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm(t('settings.prompts.delete_confirm'))) {
            setActionError(null);
            try {
                await deletePrompt(id);
            } catch (err) {
                setActionError(err instanceof Error ? err.message : 'Failed to delete prompt');
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name || !formData.content) return;

        setFormError(null);
        try {
            if (isAdding) {
                const newId = `custom_${Date.now()}`;
                await addPrompt({
                    id: newId,
                    template: formData.template || newId,
                    name: formData.name,
                    description: formData.description || '',
                    content: formData.content,
                } as PolishPrompt);
            } else if (editingId) {
                await updatePrompt({
                    id: editingId,
                    name: formData.name,
                    description: formData.description || '',
                    template: formData.template,
                    content: formData.content,
                } as PolishPrompt);
            }
            resetForm();
        } catch (error) {
            setFormError(error instanceof Error ? error.message : 'Failed to save prompt');
        }
    };

    const isFormOpen = isAdding || editingId !== null;

    return (
        <div className="flex flex-col space-y-3 pb-4">
            {/* Compact Action Bar */}
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted truncate">
                    {isFormOpen
                        ? isAdding
                            ? t('settings.prompts.add')
                            : t('settings.prompts.edit')
                        : t('settings.prompts.subtitle')}
                </span>
                {!isFormOpen ? (
                    <Button size="sm" leftIcon={<Plus size={14} />} onClick={handleStartAdd}>
                        {t('settings.prompts.add')}
                    </Button>
                ) : (
                    <button
                        onClick={resetForm}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                        aria-label={t('actions.cancel')}
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {!isFormOpen && actionError && (
                <p className="text-xs text-red-500" role="alert">
                    {actionError}
                </p>
            )}

            {/* Edit/Add Form */}
            {isFormOpen ? (
                <div className="bg-bg-secondary p-3 rounded-xl border border-border-primary">
                    <form onSubmit={handleSubmit} className="space-y-3">
                        <div>
                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                                {t('settings.prompts.form.name')}
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full h-8 bg-bg-primary border border-border-primary rounded-lg px-3 py-1 text-xs text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-text-muted/60 transition-colors"
                                placeholder={t('settings.prompts.form.name')}
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                                {t('settings.prompts.form.template')}
                            </label>
                            <div className="relative">
                                <textarea
                                    value={formData.content}
                                    onChange={(e) =>
                                        setFormData({ ...formData, content: e.target.value })
                                    }
                                    className="w-full bg-bg-primary border border-border-primary rounded-xl px-3 py-2 text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none font-mono text-xs leading-relaxed placeholder:text-text-muted/60 min-h-[140px] transition-colors"
                                    placeholder={t('settings.prompts.form.template.placeholder')}
                                    required
                                />
                                <div className="absolute top-2 right-2 group">
                                    <AlertCircle
                                        size={14}
                                        className="text-text-muted cursor-help"
                                    />
                                    <div className="absolute right-0 w-60 p-2 bg-bg-primary rounded-xl shadow-xl border border-border-primary text-[11px] text-text-secondary invisible group-hover:visible z-10">
                                        {t('settings.prompts.form.placeholder_hint')}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {formError && (
                            <p className="text-xs text-[#f4212e]" role="alert">
                                {formError}
                            </p>
                        )}

                        <div className="flex justify-end gap-2 pt-1">
                            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                                {t('settings.prompts.form.cancel')}
                            </Button>
                            <Button type="submit" size="sm" leftIcon={<Save size={13} />}>
                                {t('settings.prompts.form.save')}
                            </Button>
                        </div>
                    </form>
                </div>
            ) : (
                /* Compact Monochrome Style Cards Grid */
                <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-2">
                    {prompts.map((prompt) => (
                        <PromptStyleCard
                            key={prompt.id}
                            prompt={prompt}
                            isDefault={prompt.id === defaultPolishTemplate}
                            onSetDefault={handleSetDefault}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            canDelete={prompts.length > 1}
                            t={t}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
