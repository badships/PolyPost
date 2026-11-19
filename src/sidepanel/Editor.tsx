import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

// Module-level save queue and sync state shared across Editor mount cycles
// so delayed autosaves cannot race with newly reopened Editor instances.
let sharedSaveChain: Promise<void> = Promise.resolve();
let sharedInFlightSaveCount = 0;
let sharedEditVersion = 0;
let sharedQueueTicket = 0;
const committedContentByPost = new Map<string, string>();
const committedVersionByPost = new Map<string, number>();
const pendingPublishByPost = new Map<string, boolean>();
const publishVersionByPost = new Map<string, number>();
const latestQueuedContentByPost = new Map<string, string>();
const latestQueuedVersionByPost = new Map<string, number>();
const latestQueuedTicketByPost = new Map<string, number>();
const mountedEditorSyncListeners = new Set<(postId: string) => void>();

const notifyMountedEditors = (postId: string): void => {
    for (const listener of mountedEditorSyncListeners) {
        listener(postId);
    }
};

const pruneSupersededQueuedSource = (postId: string, committedVersion: number): void => {
    const queuedVersion = latestQueuedVersionByPost.get(postId);
    if (queuedVersion !== undefined && queuedVersion <= committedVersion) {
        latestQueuedVersionByPost.delete(postId);
        latestQueuedContentByPost.delete(postId);
        latestQueuedTicketByPost.delete(postId);
    }
};

export const Editor: React.FC<EditorProps> = ({ onNavigateBack, onNavigateToSettings }) => {
    const { t, getTemplateName } = useTranslation();
    const {
        currentPostId,
        getPostById,
        updatePost,
        discardEmptyNewDraft,
        clearNewlyCreatedDraft,
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
    const [hasPendingPublishStatus, setHasPendingPublishStatus] = useState(false);
    const contentRef = useRef(content);
    const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
    const editVersionRef = useRef(sharedEditVersion);
    const mountEditVersionRef = useRef(sharedEditVersion);
    const loadedPostIdRef = useRef<string | null>(null);
    const createdDraftRevisionRef = useRef<number | null>(null);

    const enqueueEditorSave = useCallback((task: () => Promise<void>): Promise<void> => {
        sharedInFlightSaveCount += 1;
        const next = sharedSaveChain.then(task, task).finally(() => {
            sharedInFlightSaveCount = Math.max(0, sharedInFlightSaveCount - 1);
        });
        sharedSaveChain = next.catch(() => undefined);
        return next;
    }, []);

    const executePostCommit = useCallback(
        async (options: {
            targetPostId: string;
            sourceContent: string;
            forceSourceWrite?: boolean;
            checkSourceDirty?: boolean;
            versionAtCall?: number;
            includePendingPublish?: boolean;
            forceMarkPosted?: boolean;
            publishVersionAtCall?: number;
            clearDraftRevision?: boolean;
        }) => {
            const {
                targetPostId,
                sourceContent,
                forceSourceWrite = false,
                checkSourceDirty = true,
                versionAtCall,
                includePendingPublish = false,
                forceMarkPosted = false,
                publishVersionAtCall,
                clearDraftRevision = false,
            } = options;

            const committed = committedContentByPost.get(targetPostId);
            const committedVersion = committedVersionByPost.get(targetPostId) ?? -1;
            const isStaleSourceVersion =
                versionAtCall !== undefined &&
                (versionAtCall < committedVersion ||
                    (versionAtCall === committedVersion &&
                        committed !== undefined &&
                        sourceContent !== committed));
            const needSource =
                checkSourceDirty &&
                !isStaleSourceVersion &&
                (forceSourceWrite || committed === undefined || sourceContent !== committed);
            const needPosted =
                forceMarkPosted ||
                (includePendingPublish && Boolean(pendingPublishByPost.get(targetPostId)));

            if (!needSource && !needPosted) {
                if (isStaleSourceVersion) {
                    pruneSupersededQueuedSource(targetPostId, committedVersion);
                } else if (checkSourceDirty && versionAtCall !== undefined) {
                    const nextCommittedVersion = Math.max(committedVersion, versionAtCall);
                    committedVersionByPost.set(targetPostId, nextCommittedVersion);
                    pruneSupersededQueuedSource(targetPostId, nextCommittedVersion);
                }
                if (
                    checkSourceDirty &&
                    versionAtCall !== undefined &&
                    loadedPostIdRef.current === targetPostId &&
                    editVersionRef.current === versionAtCall &&
                    sharedEditVersion === versionAtCall
                ) {
                    hasUnsavedChangesRef.current = false;
                    setHasUnsavedChanges(false);
                }
                return;
            }

            await updatePost(targetPostId, {
                ...(needSource ? { sourceContent } : {}),
                ...(needPosted ? { status: 'posted' as const } : {}),
            });

            if (needSource) {
                committedContentByPost.set(targetPostId, sourceContent);
                if (versionAtCall !== undefined) {
                    const nextCommittedVersion = Math.max(
                        committedVersionByPost.get(targetPostId) ?? -1,
                        versionAtCall,
                    );
                    committedVersionByPost.set(targetPostId, nextCommittedVersion);
                    pruneSupersededQueuedSource(targetPostId, nextCommittedVersion);
                } else if (committedVersion >= 0) {
                    pruneSupersededQueuedSource(targetPostId, committedVersion);
                }
            } else if (isStaleSourceVersion) {
                pruneSupersededQueuedSource(targetPostId, committedVersion);
            }
            if (
                needPosted &&
                (publishVersionAtCall === undefined ||
                    publishVersionByPost.get(targetPostId) === publishVersionAtCall)
            ) {
                pendingPublishByPost.set(targetPostId, false);
                if (loadedPostIdRef.current === targetPostId) {
                    setHasPendingPublishStatus(false);
                }
            }
            if (loadedPostIdRef.current === targetPostId) {
                if (clearDraftRevision && (needSource || needPosted)) {
                    createdDraftRevisionRef.current = null;
                }
                if (
                    needSource &&
                    versionAtCall !== undefined &&
                    editVersionRef.current === versionAtCall &&
                    sharedEditVersion === versionAtCall
                ) {
                    hasUnsavedChangesRef.current = false;
                    setHasUnsavedChanges(false);
                }
            }
        },
        [updatePost],
    );

    const commitQueuedPostUpdate = useCallback(
        (options: {
            targetPostId: string;
            sourceContent: string;
            forceSourceWrite?: boolean;
            checkSourceDirty?: boolean;
            versionAtCall?: number;
            includePendingPublish?: boolean;
            forceMarkPosted?: boolean;
            publishVersionAtCall?: number;
            clearDraftRevision?: boolean;
        }) => {
            const { targetPostId, sourceContent, checkSourceDirty = true, versionAtCall } = options;

            const queueTicket = ++sharedQueueTicket;
            const queuedVersion = versionAtCall ?? sharedEditVersion;
            const committedVersion = committedVersionByPost.get(targetPostId) ?? -1;
            const currentQueuedVersion = latestQueuedVersionByPost.get(targetPostId) ?? -1;
            const trackedAsLatest =
                checkSourceDirty &&
                queuedVersion > committedVersion &&
                queuedVersion >= currentQueuedVersion;
            if (trackedAsLatest) {
                latestQueuedContentByPost.set(targetPostId, sourceContent);
                latestQueuedVersionByPost.set(targetPostId, queuedVersion);
                latestQueuedTicketByPost.set(targetPostId, queueTicket);
            }

            return enqueueEditorSave(async () => {
                try {
                    await executePostCommit(options);
                } finally {
                    if (
                        trackedAsLatest &&
                        latestQueuedTicketByPost.get(targetPostId) === queueTicket
                    ) {
                        latestQueuedTicketByPost.delete(targetPostId);
                        latestQueuedVersionByPost.delete(targetPostId);
                        latestQueuedContentByPost.delete(targetPostId);
                    }
                    notifyMountedEditors(targetPostId);
                }
            });
        },
        [enqueueEditorSave, executePostCommit],
    );

    const defaultTranslateTargets = useMemo<Language[]>(() => [defaultLanguage], [defaultLanguage]);

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
        if (!post) {
            loadedPostIdRef.current = null;
            createdDraftRevisionRef.current = null;
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
            setHasPendingPublishStatus(false);
            return;
        }
        if (loadedPostIdRef.current !== post.id) {
            loadedPostIdRef.current = post.id;
            const createdDraft = usePostsStore.getState().newlyCreatedDraft;
            createdDraftRevisionRef.current =
                createdDraft?.id === post.id &&
                createdDraft.updatedAt === post.updatedAt &&
                post.status === 'draft' &&
                !post.sourceContent.trim()
                    ? post.updatedAt
                    : null;
            if (sharedInFlightSaveCount === 0 || !committedContentByPost.has(post.id)) {
                committedContentByPost.set(post.id, post.sourceContent);
            }
            const queuedVersion = latestQueuedVersionByPost.get(post.id);
            const committedVersion = committedVersionByPost.get(post.id) ?? -1;
            const hasNewerQueuedSource =
                sharedInFlightSaveCount > 0 &&
                queuedVersion !== undefined &&
                queuedVersion > committedVersion &&
                latestQueuedContentByPost.has(post.id);
            const initialContent = hasNewerQueuedSource
                ? latestQueuedContentByPost.get(post.id)!
                : post.sourceContent;
            const initialDirty = hasNewerQueuedSource || initialContent !== post.sourceContent;
            const initialVersion = hasNewerQueuedSource
                ? queuedVersion
                : Math.max(committedVersion, 0);
            editVersionRef.current = initialVersion;
            mountEditVersionRef.current = initialVersion;
            contentRef.current = initialContent;
            hasUnsavedChangesRef.current = initialDirty;
            setContent(initialContent);
            setHasUnsavedChanges(initialDirty);
            setHasPendingPublishStatus(Boolean(pendingPublishByPost.get(post.id)));
        } else {
            setHasPendingPublishStatus(Boolean(pendingPublishByPost.get(post.id)));
            if (sharedInFlightSaveCount === 0) {
                committedContentByPost.set(post.id, post.sourceContent);
                if (!hasUnsavedChangesRef.current && post.sourceContent !== contentRef.current) {
                    contentRef.current = post.sourceContent;
                    setContent(post.sourceContent);
                } else if (
                    hasUnsavedChangesRef.current &&
                    editVersionRef.current === mountEditVersionRef.current &&
                    post.sourceContent === contentRef.current
                ) {
                    hasUnsavedChangesRef.current = false;
                    setHasUnsavedChanges(false);
                }
            }
        }
    }, [post]);

    useEffect(() => {
        const handleSync = (syncedPostId: string) => {
            if (loadedPostIdRef.current !== syncedPostId) {
                return;
            }
            setHasPendingPublishStatus(Boolean(pendingPublishByPost.get(syncedPostId)));
            if (latestQueuedVersionByPost.has(syncedPostId)) {
                return;
            }
            const committed = committedContentByPost.get(syncedPostId);
            const committedVer = committedVersionByPost.get(syncedPostId) ?? -1;
            if (committed === undefined) {
                return;
            }
            if (contentRef.current === committed) {
                if (
                    editVersionRef.current <= committedVer ||
                    editVersionRef.current === mountEditVersionRef.current
                ) {
                    hasUnsavedChangesRef.current = false;
                    setHasUnsavedChanges(false);
                }
            } else if (
                !hasUnsavedChangesRef.current &&
                editVersionRef.current === mountEditVersionRef.current &&
                committedVer >= editVersionRef.current
            ) {
                contentRef.current = committed;
                setContent(committed);
                if (committedVer >= 0) {
                    editVersionRef.current = Math.max(editVersionRef.current, committedVer);
                    mountEditVersionRef.current = editVersionRef.current;
                }
            } else if (
                editVersionRef.current > committedVer ||
                editVersionRef.current === mountEditVersionRef.current
            ) {
                hasUnsavedChangesRef.current = true;
                setHasUnsavedChanges(true);
            }
        };

        mountedEditorSyncListeners.add(handleSync);
        if (loadedPostIdRef.current) {
            handleSync(loadedPostIdRef.current);
        }
        return () => {
            mountedEditorSyncListeners.delete(handleSync);
        };
    }, []);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        hasUnsavedChangesRef.current = hasUnsavedChanges;
    }, [hasUnsavedChanges]);

    // Save on unmount or when switching posts
    useEffect(() => {
        return () => {
            if (!currentPostId) return;
            const targetPostId = currentPostId;
            const hadUnsavedSnapshot = hasUnsavedChangesRef.current;
            const hadPendingPublishSnapshot = Boolean(pendingPublishByPost.get(targetPostId));
            if (!hadUnsavedSnapshot && !hadPendingPublishSnapshot) {
                return;
            }
            const contentSnapshot = contentRef.current;
            const publishVersionSnapshot = publishVersionByPost.get(targetPostId) ?? 0;
            const versionAtUnmount = editVersionRef.current;
            void commitQueuedPostUpdate({
                targetPostId,
                sourceContent: contentSnapshot,
                checkSourceDirty: hadUnsavedSnapshot,
                versionAtCall: versionAtUnmount,
                includePendingPublish: hadPendingPublishSnapshot,
                publishVersionAtCall: publishVersionSnapshot,
            }).catch((err) => {
                console.error('Save on unmount failed:', err);
            });
        };
    }, [commitQueuedPostUpdate, currentPostId]);

    const handleContentChange = (newContent: string) => {
        sharedEditVersion += 1;
        editVersionRef.current = sharedEditVersion;
        contentRef.current = newContent;
        hasUnsavedChangesRef.current = true;
        setContent(newContent);
        setError(null);
        setHasUnsavedChanges(true);
    };

    const handleBlur = useCallback(async () => {
        if (!currentPostId || !hasUnsavedChangesRef.current) return;
        const targetPostId = currentPostId;
        const versionAtStart = editVersionRef.current;
        const contentToSave = contentRef.current;
        try {
            await commitQueuedPostUpdate({
                targetPostId,
                sourceContent: contentToSave,
                versionAtCall: versionAtStart,
                clearDraftRevision: true,
            });
        } catch (err) {
            console.error('Save on blur failed:', err);
            if (loadedPostIdRef.current === targetPostId) {
                hasUnsavedChangesRef.current = true;
                setHasUnsavedChanges(true);
                setError(err instanceof Error ? err.message : 'Failed to save post');
            }
        }
    }, [commitQueuedPostUpdate, currentPostId]);

    const handleClearSource = useCallback(async () => {
        sharedEditVersion += 1;
        const versionAtClear = sharedEditVersion;
        editVersionRef.current = versionAtClear;
        contentRef.current = '';
        setContent('');
        setError(null);
        if (!currentPostId) {
            hasUnsavedChangesRef.current = false;
            setHasUnsavedChanges(false);
            return;
        }
        const targetPostId = currentPostId;
        createdDraftRevisionRef.current = null;
        clearNewlyCreatedDraft(targetPostId);
        hasUnsavedChangesRef.current = true;
        setHasUnsavedChanges(true);
        try {
            await commitQueuedPostUpdate({
                targetPostId,
                sourceContent: '',
                forceSourceWrite: true,
                versionAtCall: versionAtClear,
            });
        } catch (err) {
            console.error('Clear source failed:', err);
            if (loadedPostIdRef.current === targetPostId) {
                hasUnsavedChangesRef.current = true;
                setHasUnsavedChanges(true);
                setError(err instanceof Error ? err.message : 'Failed to save post');
            }
        }
    }, [clearNewlyCreatedDraft, commitQueuedPostUpdate, currentPostId]);

    const handleSave = async () => {
        if (!currentPostId) return;
        const targetPostId = currentPostId;
        const versionAtStart = editVersionRef.current;
        const contentToSave = contentRef.current;
        const hasSourceChanges = hasUnsavedChangesRef.current;
        const publishVersionAtStart = publishVersionByPost.get(targetPostId) ?? 0;
        setIsSaving(true);
        setError(null);
        try {
            await commitQueuedPostUpdate({
                targetPostId,
                sourceContent: contentToSave,
                checkSourceDirty: hasSourceChanges,
                forceSourceWrite: hasSourceChanges,
                versionAtCall: versionAtStart,
                includePendingPublish: true,
                publishVersionAtCall: publishVersionAtStart,
                clearDraftRevision: true,
            });
        } catch (err) {
            console.error('Save post failed:', err);
            if (loadedPostIdRef.current === targetPostId) {
                if (hasSourceChanges) {
                    hasUnsavedChangesRef.current = true;
                    setHasUnsavedChanges(true);
                }
                setError(err instanceof Error ? err.message : 'Failed to save post');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleNavigateBack = async () => {
        if (!currentPostId) {
            onNavigateBack();
            return;
        }
        const targetPostId = currentPostId;

        setError(null);
        try {
            let discarded = false;
            await enqueueEditorSave(async () => {
                const liveRevision = createdDraftRevisionRef.current;
                const liveContent = contentRef.current;
                const liveVariants = usePostsStore.getState().getVariantsByPostId(targetPostId);
                const hasPendingPublish = Boolean(pendingPublishByPost.get(targetPostId));

                if (
                    liveRevision !== null &&
                    !liveContent.trim() &&
                    liveVariants.length === 0 &&
                    !hasPendingPublish
                ) {
                    discarded = await discardEmptyNewDraft(targetPostId, liveRevision);
                    if (discarded) {
                        if (loadedPostIdRef.current === targetPostId) {
                            createdDraftRevisionRef.current = null;
                            hasUnsavedChangesRef.current = false;
                            pendingPublishByPost.set(targetPostId, false);
                            setHasUnsavedChanges(false);
                            setHasPendingPublishStatus(false);
                        }
                        return;
                    }
                    if (loadedPostIdRef.current === targetPostId) {
                        createdDraftRevisionRef.current = null;
                    }
                } else {
                    clearNewlyCreatedDraft(targetPostId);
                }

                const finalContent = contentRef.current;
                const finalVersion = editVersionRef.current;
                const shouldCheckSource =
                    hasUnsavedChangesRef.current ||
                    committedContentByPost.get(targetPostId) !== finalContent;
                await executePostCommit({
                    targetPostId,
                    sourceContent: finalContent,
                    checkSourceDirty: shouldCheckSource,
                    versionAtCall: finalVersion,
                    includePendingPublish: true,
                    publishVersionAtCall: publishVersionByPost.get(targetPostId) ?? 0,
                });
                notifyMountedEditors(targetPostId);
            });
            if (discarded) {
                onNavigateBack();
                return;
            }
            onNavigateBack();
        } catch (err) {
            console.error('Navigate back save failed:', err);
            if (loadedPostIdRef.current === targetPostId) {
                setError(err instanceof Error ? err.message : 'Failed to save post');
            }
        }
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

        // Mark as posted after opening intent, syncing any unsaved source content
        if (currentPostId) {
            const targetPostId = currentPostId;
            const hadUnsavedAtPublish = hasUnsavedChangesRef.current;
            const versionAtPublish = editVersionRef.current;
            const contentToSave = contentRef.current;
            const publishVersion = (publishVersionByPost.get(targetPostId) ?? 0) + 1;
            publishVersionByPost.set(targetPostId, publishVersion);
            pendingPublishByPost.set(targetPostId, true);
            setHasPendingPublishStatus(true);
            createdDraftRevisionRef.current = null;
            clearNewlyCreatedDraft(targetPostId);

            void commitQueuedPostUpdate({
                targetPostId,
                sourceContent: contentToSave,
                checkSourceDirty: hadUnsavedAtPublish,
                versionAtCall: versionAtPublish,
                forceMarkPosted: true,
                publishVersionAtCall: publishVersion,
            }).catch((err) => {
                console.error('Failed to persist publish state:', err);
                pendingPublishByPost.set(targetPostId, true);
                if (loadedPostIdRef.current === targetPostId) {
                    setHasPendingPublishStatus(true);
                    setError(err instanceof Error ? err.message : 'Failed to save post');
                }
            });
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
        if (!currentPostId) return;
        if (!content.trim()) {
            setError(t('editor.polish_error'));
            return;
        }

        const targetPostId = currentPostId;
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

            if (!usePostsStore.getState().getPostById(targetPostId)) {
                throw new Error('Post no longer exists');
            }

            const newVariant = await addVariant({
                postId: targetPostId,
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
        if (!currentPostId) return;
        const targetPostId = currentPostId;
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

                if (!usePostsStore.getState().getPostById(targetPostId)) {
                    throw new Error('Post no longer exists');
                }

                const newVariant = await addVariant({
                    postId: targetPostId,
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
        const targetPostId = currentPostId;
        setError(null);
        try {
            await enqueueEditorSave(async () => {
                await updatePost(targetPostId, { folderId });
                if (loadedPostIdRef.current === targetPostId) {
                    createdDraftRevisionRef.current = null;
                }
            });
        } catch (err) {
            console.error('Change folder failed:', err);
            setError(err instanceof Error ? err.message : 'Failed to update folder');
        }
    };

    const handleQuickTranslate = async (
        targetLanguage: Language,
        sourceMode: 'source' | 'selected',
    ) => {
        await handleTranslate([targetLanguage], sourceMode);
    };

    const isDirty = hasUnsavedChanges || hasPendingPublishStatus;

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
                        disabled={isSaving || !isDirty}
                        className={`text-[11px] truncate transition-colors ${
                            isDirty
                                ? 'text-accent hover:text-accent-hover font-semibold cursor-pointer'
                                : 'text-text-muted cursor-default'
                        }`}
                    >
                        {isSaving
                            ? t('editor.saving')
                            : isDirty
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
                        onClear={handleClearSource}
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
                defaultTargets={defaultTranslateTargets}
                progress={translationProgress}
            />
        </div>
    );
};
