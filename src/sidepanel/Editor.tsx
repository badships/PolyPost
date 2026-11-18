import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { SourceEditor, VariantsPanel, PolishModal, TranslateModal } from '@/components/editor';
import { usePostsStore, useSettingsStore, useUIStore, useFoldersStore } from '@/store';
import { aiService } from '@/services/ai';
import { resolveActiveProviderConfig } from '@/services/settingsDefaults';
import { ensureHostPermission } from '@/services/permissions';
import { twitterService } from '@/services/twitter';
import type { PolishTemplate, Language, BuiltInProviderId } from '@/types';
import { LANGUAGE_NAMES, POLISH_TEMPLATE_NAMES } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

const PROVIDER_SHORT_NAMES: Record<BuiltInProviderId, string> = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    gemini: 'Gemini',
    xai: 'Grok',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    kimi: 'Kimi',
    zhipu: 'GLM',
    openrouter: 'OpenRouter',
};

interface EditorProps {
    onNavigateBack: () => void;
    onNavigateToSettings?: () => void;
}

export const Editor: React.FC<EditorProps> = ({ onNavigateBack, onNavigateToSettings }) => {
    const { t, getTemplateName } = useTranslation();
    const {
        currentPostId,
        getPostById,
        updatePost,
        addVariant,
        selectVariant,
        deselectVariants,
        deleteVariant,
    } = usePostsStore();
    const { folders } = useFoldersStore();
    const variants = usePostsStore((s) => s.getVariantsByPostId(currentPostId || ''));
    const {
        prompts,
        defaultLanguage,
        provider,
        providerConfigs,
        customProviders,
        activeCustomProviderId,
        openaiApiKey,
        customApiUrl,
        customApiKey,
        modelName,
    } = useSettingsStore();
    const {
        isPolishModalOpen,
        isTranslateModalOpen,
        openPolishModal,
        closePolishModal,
        openTranslateModal,
        closeTranslateModal,
    } = useUIStore();

    const post = currentPostId ? getPostById(currentPostId) : null;
    const [content, setContent] = useState(post?.sourceContent || '');
    const [isPolishing, setIsPolishing] = useState(false);
    const [isTranslating, setIsTranslating] = useState(false);
    const [translationProgress, setTranslationProgress] = useState<{
        completed: number;
        total: number;
        currentLabel?: string;
    } | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const contentRef = useRef(content);
    const hasUnsavedChangesRef = useRef(hasUnsavedChanges);

    // Get selected variant content (if any)
    const selectedVariant = variants.find((v) => v.isSelected);
    const contentToPublish = selectedVariant?.content || content;
    const getPromptName = (templateId?: string | null) => {
        if (!templateId) return 'Variant';
        const prompt = prompts.find((item) => item.id === templateId);
        const fallback =
            prompt?.name ||
            POLISH_TEMPLATE_NAMES[templateId as keyof typeof POLISH_TEMPLATE_NAMES] ||
            templateId;
        return getTemplateName(templateId, fallback);
    };

    const selectedVariantLabel = selectedVariant
        ? selectedVariant.type === 'translation' && selectedVariant.language
            ? LANGUAGE_NAMES[selectedVariant.language]
            : getPromptName(selectedVariant.promptTemplate)
        : '';

    // Update content when post changes
    useEffect(() => {
        if (post) {
            setContent(post.sourceContent);
            setHasUnsavedChanges(false);
        }
    }, [post]);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        hasUnsavedChangesRef.current = hasUnsavedChanges;
    }, [hasUnsavedChanges]);

    // Save on unmount or when switching posts
    useEffect(() => {
        return () => {
            if (hasUnsavedChangesRef.current && currentPostId) {
                void updatePost(currentPostId, { sourceContent: contentRef.current });
            }
        };
    }, [currentPostId, updatePost]);

    const handleContentChange = (newContent: string) => {
        setContent(newContent);
        setError(null);
        setHasUnsavedChanges(true);
    };

    const handleBlur = useCallback(async () => {
        if (!currentPostId || !hasUnsavedChanges) return;
        try {
            await updatePost(currentPostId, { sourceContent: content });
            setHasUnsavedChanges(false);
        } catch (err) {
            console.error('Save on blur failed:', err);
        }
    }, [currentPostId, content, hasUnsavedChanges, updatePost]);

    const handleSave = async () => {
        if (!currentPostId) return;
        setIsSaving(true);
        try {
            await updatePost(currentPostId, { sourceContent: content });
            setHasUnsavedChanges(false);
        } finally {
            setIsSaving(false);
        }
    };

    const handleNavigateBack = async () => {
        if (hasUnsavedChanges && currentPostId) {
            await updatePost(currentPostId, { sourceContent: content });
        }
        onNavigateBack();
    };

    const handlePublish = () => {
        if (!contentToPublish.trim()) {
            setError(t('editor.save_error'));
            return;
        }

        // Open Twitter Web Intent with the content
        twitterService.openTweetIntent({
            text: contentToPublish,
        });

        // Mark as posted after opening intent
        if (currentPostId) {
            updatePost(currentPostId, { status: 'posted' });
        }
    };

    const resolveAndAuthorizeProvider = async () => {
        const activeConfig = resolveActiveProviderConfig(useSettingsStore.getState());
        if (activeConfig.isCustom && (!activeConfig.baseUrl || !activeConfig.apiKey)) {
            setError(t('editor.api_key_missing_custom'));
            return null;
        }
        if (!activeConfig.isCustom && !activeConfig.apiKey) {
            setError(t('editor.api_key_missing_openai'));
            return null;
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
            return null;
        }

        return activeConfig;
    };

    const handlePolish = async (templateId: PolishTemplate) => {
        if (!content.trim()) {
            setError(t('editor.polish_error'));
            return;
        }

        const { prompts } = useSettingsStore.getState();
        const selectedPrompt = prompts.find((p) => p.id === templateId);

        if (!selectedPrompt) {
            setError(t('editor.polish_prompt_error'));
            return;
        }

        const activeConfig = await resolveAndAuthorizeProvider();
        if (!activeConfig) {
            closePolishModal();
            return;
        }

        setIsPolishing(true);
        setError(null);

        try {
            const result = await aiService.polish(
                content,
                selectedPrompt.content,
                activeConfig.apiKey,
                activeConfig.modelName,
                activeConfig.baseUrl,
                activeConfig.apiFormat,
            );

            const newVariant = await addVariant({
                postId: currentPostId!,
                type: 'polish',
                language: null,
                promptTemplate: templateId,
                content: result.content,
                description: selectedPrompt.description || result.description,
                isSelected: false,
            });
            await selectVariant(newVariant.id);

            closePolishModal();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('editor.polish_fail'));
        } finally {
            setIsPolishing(false);
        }
    };

    const handleTranslate = async (
        targetLanguages: Language[],
        sourceMode: 'source' | 'selected',
    ) => {
        const sourceContent =
            sourceMode === 'selected' && selectedVariant?.content
                ? selectedVariant.content
                : content;

        if (!sourceContent.trim()) {
            setError(t('editor.translate_error'));
            return;
        }

        if (targetLanguages.length === 0) {
            return;
        }

        const activeConfig = await resolveAndAuthorizeProvider();
        if (!activeConfig) {
            closeTranslateModal();
            return;
        }

        setIsTranslating(true);
        setError(null);
        setTranslationProgress({ completed: 0, total: targetLanguages.length });

        try {
            let completed = 0;
            for (const targetLanguage of targetLanguages) {
                setTranslationProgress({
                    completed,
                    total: targetLanguages.length,
                    currentLabel: LANGUAGE_NAMES[targetLanguage] || targetLanguage,
                });
                const result = await aiService.translate(
                    sourceContent,
                    targetLanguage,
                    activeConfig.apiKey,
                    activeConfig.modelName,
                    activeConfig.baseUrl,
                    activeConfig.apiFormat,
                );

                const newVariant = await addVariant({
                    postId: currentPostId!,
                    type: 'translation',
                    language: targetLanguage,
                    promptTemplate: null,
                    content: result.content,
                    description: result.description,
                    isSelected: false,
                });
                await selectVariant(newVariant.id);

                completed += 1;
                setTranslationProgress({
                    completed,
                    total: targetLanguages.length,
                    currentLabel: LANGUAGE_NAMES[targetLanguage] || targetLanguage,
                });
            }

            closeTranslateModal();
        } catch (err) {
            setError(err instanceof Error ? err.message : t('editor.translate_fail'));
        } finally {
            setIsTranslating(false);
            setTranslationProgress(null);
        }
    };

    const handleSelectVariant = async (variantId: string) => {
        await selectVariant(variantId);
    };

    const handleUseSource = async () => {
        if (currentPostId) {
            await deselectVariants(currentPostId);
        }
    };

    const handleDeleteVariant = async (variantId: string) => {
        await deleteVariant(variantId);
    };

    const postStatus = post?.status || 'draft';

    const activeConfig = resolveActiveProviderConfig({
        provider,
        providerConfigs,
        customProviders,
        activeCustomProviderId,
        openaiApiKey,
        customApiUrl,
        customApiKey,
        modelName,
    });
    const activeCustom =
        customProviders.find((c) => c.id === activeCustomProviderId) || customProviders[0];
    const providerLabel = activeConfig.isCustom
        ? activeCustom?.name || 'Custom'
        : PROVIDER_SHORT_NAMES[activeConfig.provider as BuiltInProviderId] || activeConfig.provider;
    const modelShortLabel = activeConfig.modelName
        ? `${providerLabel} · ${activeConfig.modelName}`
        : providerLabel;
    const hasApiKey = Boolean(activeConfig.apiKey);

    const handleChangeFolder = async (folderId: string | null) => {
        if (!currentPostId) return;
        await updatePost(currentPostId, { folderId });
    };

    const handleQuickTranslate = async (
        targetLanguage: Language,
        sourceMode: 'source' | 'selected',
    ) => {
        await handleTranslate([targetLanguage], sourceMode);
    };

    return (
        <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
            {/* Compact X-Native Studio Header */}
            <header className="sticky top-0 z-20 h-11 shrink-0 bg-bg-primary/85 backdrop-blur-md border-b border-border-primary flex items-center justify-between gap-2 px-3">
                <div className="flex items-center gap-1.5 min-w-0">
                    <button
                        onClick={handleNavigateBack}
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors shrink-0"
                        aria-label="Back"
                    >
                        <ChevronLeft size={17} />
                    </button>

                    <Badge variant={postStatus === 'posted' ? 'posted' : 'draft'}>
                        {postStatus === 'posted' ? t('post.status.posted') : t('post.status.draft')}
                    </Badge>

                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasUnsavedChanges}
                        className={`text-[11px] truncate transition-colors ${
                            hasUnsavedChanges
                                ? 'text-accent hover:text-accent-hover font-semibold cursor-pointer'
                                : 'text-text-muted cursor-default'
                        }`}
                    >
                        {isSaving
                            ? t('editor.saving')
                            : hasUnsavedChanges
                              ? `${t('editor.save')}*`
                              : t('editor.saved')}
                    </button>

                    {onNavigateToSettings && (
                        <button
                            onClick={onNavigateToSettings}
                            title={modelShortLabel}
                            className="hidden min-[340px]:inline-flex items-center gap-1 h-5 px-2 rounded-full bg-bg-secondary border border-border-primary hover:border-border-secondary text-[10.5px] text-text-secondary hover:text-text-primary transition-colors min-w-0 max-w-[110px]"
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                    hasApiKey ? 'bg-[#00ba7c]' : 'bg-[#ffd400]'
                                }`}
                            />
                            <span className="truncate">{modelShortLabel}</span>
                        </button>
                    )}
                </div>

                <Button size="sm" rightIcon={<ArrowUpRight size={13} />} onClick={handlePublish}>
                    {t('editor.post_to_x')}
                </Button>
            </header>

            {/* Error message */}
            {error && (
                <div className="mx-3 mt-2.5 px-3 py-2 bg-[#f4212e]/10 border border-[#f4212e]/30 rounded-xl text-[#f4212e] text-xs shrink-0">
                    {error}
                </div>
            )}

            {/* Unified Scrollable Composer Studio */}
            <div className="flex-1 overflow-y-auto px-3 py-2.5">
                <div className="max-w-5xl mx-auto w-full space-y-3 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-4 lg:items-start">
                    <SourceEditor
                        content={content}
                        onChange={handleContentChange}
                        onBlur={handleBlur}
                        onPolish={openPolishModal}
                        onPolishTemplate={handlePolish}
                        onTranslate={openTranslateModal}
                        onQuickTranslate={handleQuickTranslate}
                        prompts={prompts}
                        folders={folders}
                        currentFolderId={post?.folderId ?? null}
                        onChangeFolder={handleChangeFolder}
                        activeModelName={activeConfig.modelName || providerLabel}
                        defaultLanguage={defaultLanguage}
                        hasSelectedVariant={Boolean(selectedVariant)}
                        selectedVariantLabel={selectedVariantLabel}
                        onUseSource={handleUseSource}
                        isPolishing={isPolishing}
                        isTranslating={isTranslating}
                    />

                    <VariantsPanel
                        variants={variants}
                        onSelectVariant={handleSelectVariant}
                        onDeleteVariant={handleDeleteVariant}
                        onGenerateMore={openPolishModal}
                        isGenerating={isPolishing}
                    />
                </div>
            </div>

            {/* Modals */}
            <PolishModal
                isOpen={isPolishModalOpen}
                onClose={closePolishModal}
                onPolish={handlePolish}
                isLoading={isPolishing}
            />
            <TranslateModal
                isOpen={isTranslateModalOpen}
                onClose={closeTranslateModal}
                onTranslate={handleTranslate}
                isLoading={isTranslating}
                hasSelectedVariant={Boolean(selectedVariant)}
                selectedVariantLabel={selectedVariantLabel}
                defaultSourceMode={selectedVariant ? 'selected' : 'source'}
                defaultTargets={[defaultLanguage]}
                progress={translationProgress}
            />
        </div>
    );
};
