import { create } from 'zustand';
import type { Post, PostStatus, LibraryFilter, Variant } from '@/types';
import {
    storage,
    nextPostTimestamp,
    getLatestPersistedPost,
    isPostEvicted,
} from '@/services/storage';
import { generateId } from '@/utils';

interface PostsState {
    posts: Post[];
    variants: Variant[];
    currentPostId: string | null;
    newlyCreatedDraft: { id: string; updatedAt: number } | null;
    isLoading: boolean;

    // Actions
    loadPosts: () => Promise<void>;
    createPost: (sourceContent: string, folderId?: string | null) => Promise<Post>;
    updatePost: (id: string, updates: Partial<Post>) => Promise<void>;
    deletePost: (id: string) => Promise<void>;
    discardEmptyNewDraft: (id: string, expectedUpdatedAt: number) => Promise<boolean>;
    clearNewlyCreatedDraft: (id?: string) => void;
    setCurrentPost: (id: string | null) => void;

    // Variant actions
    loadVariants: (postId: string) => Promise<void>;
    addVariant: (variant: Omit<Variant, 'id' | 'createdAt'>) => Promise<Variant>;
    selectVariant: (variantId: string) => Promise<void>;
    deselectVariants: (postId: string) => Promise<void>;
    deleteVariant: (id: string) => Promise<void>;

    // Getters
    getPostById: (id: string) => Post | undefined;
    getPostsByFilter: (filter: LibraryFilter, folderId?: string | null) => Post[];
    getVariantsByPostId: (postId: string) => Variant[];
}

const localBlankDraftIds = new Set<string>();
const pendingLocalPromotions = new Map<string, Promise<void>>();
const deletedFolderIds = new Set<string>();

export const markFolderDeleted = (folderId: string): void => {
    deletedFolderIds.add(folderId);
};

export const clearDeletedFolderMark = (folderId: string): void => {
    deletedFolderIds.delete(folderId);
};

export const isPromotingLocalDraft = (id: string): boolean => pendingLocalPromotions.has(id);

export const nextLocalPostTimestamp = (minFloor = 0): number => {
    return nextPostTimestamp(minFloor);
};

const pickNewerPost = (candidate: Post, existing?: Post): Post => {
    if (!existing) return candidate;
    return existing.updatedAt > candidate.updatedAt ? existing : candidate;
};

const sanitizePostFolder = (post: Post): Post => {
    if (post.folderId !== null && deletedFolderIds.has(post.folderId)) {
        return { ...post, folderId: null };
    }
    return post;
};

export const usePostsStore = create<PostsState>((set, get) => {
    const promoteLocalDraftIfNeeded = async (
        id: string,
        updates?: Partial<Post>,
    ): Promise<boolean> => {
        const pending = pendingLocalPromotions.get(id);
        if (pending) {
            await pending.catch(() => undefined);
        }

        if (!localBlankDraftIds.has(id)) {
            return false;
        }

        const localDraft = get().posts.find((p) => p.id === id);
        if (!localDraft) {
            localBlankDraftIds.delete(id);
            throw new Error('Post no longer exists');
        }

        const toPersist: Post = sanitizePostFolder(
            updates
                ? {
                      ...localDraft,
                      ...updates,
                      updatedAt: nextLocalPostTimestamp(localDraft.updatedAt),
                  }
                : localDraft,
        );

        const promotionPromise = storage.addPost(toPersist).then((savedPost) => {
            const authoritativePost = sanitizePostFolder(
                pickNewerPost(savedPost, getLatestPersistedPost(id)),
            );
            localBlankDraftIds.delete(id);
            set((state) => ({
                posts: state.posts.map((p) =>
                    p.id === id ? pickNewerPost(authoritativePost, p) : p,
                ),
                newlyCreatedDraft:
                    state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
            }));
        });

        pendingLocalPromotions.set(id, promotionPromise);
        try {
            await promotionPromise;
        } catch (error) {
            if (localBlankDraftIds.has(id)) {
                set((state) => {
                    let nextNewlyCreatedDraft = state.newlyCreatedDraft;
                    const nextPosts = state.posts.map((p) => {
                        if (
                            p.id === id &&
                            p.folderId !== null &&
                            deletedFolderIds.has(p.folderId)
                        ) {
                            const nextUpdatedAt = nextLocalPostTimestamp(p.updatedAt);
                            if (
                                state.newlyCreatedDraft?.id === p.id &&
                                p.status === 'draft' &&
                                !p.sourceContent.trim()
                            ) {
                                nextNewlyCreatedDraft = { id: p.id, updatedAt: nextUpdatedAt };
                            }
                            return {
                                ...p,
                                folderId: null,
                                updatedAt: nextUpdatedAt,
                            };
                        }
                        return p;
                    });
                    return {
                        posts: nextPosts,
                        newlyCreatedDraft: nextNewlyCreatedDraft,
                    };
                });
            }
            throw error;
        } finally {
            if (pendingLocalPromotions.get(id) === promotionPromise) {
                pendingLocalPromotions.delete(id);
            }
        }

        return true;
    };

    return {
        posts: [],
        variants: [],
        currentPostId: null,
        newlyCreatedDraft: null,
        isLoading: false,

        loadPosts: async () => {
            set({ isLoading: true });
            try {
                const [posts, variants] = await Promise.all([
                    storage.getPosts(),
                    storage.getVariants().catch((variantError) => {
                        console.warn('Failed to load variants:', variantError);
                        return [] as Variant[];
                    }),
                ]);
                set((state) => {
                    const storedIds = new Set<string>();
                    const mergedPosts: Post[] = [];
                    const existingById = new Map(state.posts.map((p) => [p.id, p]));

                    for (const rawPost of posts) {
                        if (isPostEvicted(rawPost.id)) {
                            localBlankDraftIds.delete(rawPost.id);
                            continue;
                        }
                        storedIds.add(rawPost.id);
                        localBlankDraftIds.delete(rawPost.id);
                        const latestPersisted = getLatestPersistedPost(rawPost.id);
                        const existing = existingById.get(rawPost.id);
                        let merged = latestPersisted
                            ? pickNewerPost(rawPost, latestPersisted)
                            : rawPost;
                        if (existing) {
                            merged = pickNewerPost(merged, existing);
                        }
                        mergedPosts.push(sanitizePostFolder(merged));
                    }

                    for (const p of state.posts) {
                        if (storedIds.has(p.id) || isPostEvicted(p.id)) {
                            continue;
                        }
                        const latestPersisted = getLatestPersistedPost(p.id);
                        if (
                            localBlankDraftIds.has(p.id) ||
                            isPromotingLocalDraft(p.id) ||
                            latestPersisted !== undefined
                        ) {
                            const resolved = latestPersisted
                                ? pickNewerPost(latestPersisted, p)
                                : p;
                            mergedPosts.push(sanitizePostFolder(resolved));
                        }
                    }

                    return {
                        posts: mergedPosts,
                        variants,
                        isLoading: false,
                    };
                });
            } catch (error) {
                console.error('Failed to load posts:', error);
                set({ isLoading: false });
            }
        },

        createPost: async (sourceContent: string, folderId: string | null = null) => {
            const now = nextLocalPostTimestamp();
            const isBlankDraft = !sourceContent.trim();
            const post: Post = sanitizePostFolder({
                id: generateId(),
                folderId,
                sourceContent,
                status: 'draft',
                createdAt: now,
                updatedAt: now,
            });

            let persistedPost = post;
            if (isBlankDraft) {
                // Keep new blank drafts local until the first save or variant creation
                // so another panel cannot open or edit an uncommitted blank draft.
                localBlankDraftIds.add(post.id);
            } else {
                const savedPost = await storage.addPost(post);
                persistedPost = sanitizePostFolder(
                    pickNewerPost(savedPost, getLatestPersistedPost(post.id)),
                );
            }

            set((state) => {
                const latestPost = isBlankDraft
                    ? sanitizePostFolder(persistedPost)
                    : sanitizePostFolder(
                          pickNewerPost(persistedPost, getLatestPersistedPost(persistedPost.id)),
                      );
                const existing = state.posts.find((p) => p.id === latestPost.id);
                const resolvedPost = existing
                    ? sanitizePostFolder(pickNewerPost(latestPost, existing))
                    : latestPost;
                return {
                    posts: existing
                        ? state.posts.map((p) => (p.id === resolvedPost.id ? resolvedPost : p))
                        : [...state.posts, resolvedPost],
                    newlyCreatedDraft: isBlankDraft
                        ? { id: resolvedPost.id, updatedAt: resolvedPost.updatedAt }
                        : state.newlyCreatedDraft,
                };
            });
            if (isBlankDraft) {
                return sanitizePostFolder(
                    get().posts.find((p) => p.id === persistedPost.id) ?? persistedPost,
                );
            }
            const authoritativePost = sanitizePostFolder(
                pickNewerPost(persistedPost, getLatestPersistedPost(persistedPost.id)),
            );
            return sanitizePostFolder(
                pickNewerPost(
                    authoritativePost,
                    get().posts.find((p) => p.id === authoritativePost.id),
                ),
            );
        },

        updatePost: async (id: string, updates: Partial<Post>) => {
            const promoted = await promoteLocalDraftIfNeeded(id, updates);
            if (promoted) {
                return;
            }

            const sanitizedUpdates =
                'folderId' in updates &&
                updates.folderId !== null &&
                updates.folderId !== undefined &&
                deletedFolderIds.has(updates.folderId)
                    ? { ...updates, folderId: null }
                    : updates;
            const savedPost = await storage.updatePost(id, sanitizedUpdates);
            if (!savedPost) {
                throw new Error('Post no longer exists in storage');
            }
            const authoritativePost = sanitizePostFolder(
                pickNewerPost(savedPost, getLatestPersistedPost(id)),
            );
            set((state) => ({
                posts: state.posts.map((p) =>
                    p.id === id ? pickNewerPost(authoritativePost, p) : p,
                ),
                newlyCreatedDraft:
                    state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
            }));
        },

        deletePost: async (id: string) => {
            const pending = pendingLocalPromotions.get(id);
            if (pending) {
                await pending.catch(() => undefined);
            }

            if (localBlankDraftIds.has(id)) {
                localBlankDraftIds.delete(id);
            } else {
                await storage.deletePost(id);
            }

            set((state) => ({
                posts: state.posts.filter((p) => p.id !== id),
                variants: state.variants.filter((v) => v.postId !== id),
                currentPostId: state.currentPostId === id ? null : state.currentPostId,
                newlyCreatedDraft:
                    state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
            }));
        },

        discardEmptyNewDraft: async (id: string, expectedUpdatedAt: number) => {
            const pending = pendingLocalPromotions.get(id);
            if (pending) {
                await pending.catch(() => undefined);
            }

            if (localBlankDraftIds.has(id)) {
                const state = get();
                const target = state.posts.find((p) => p.id === id);
                const hasVariants = state.variants.some((v) => v.postId === id);
                if (
                    !target ||
                    target.status !== 'draft' ||
                    target.updatedAt !== expectedUpdatedAt ||
                    target.sourceContent.trim().length > 0 ||
                    hasVariants
                ) {
                    set((s) => ({
                        newlyCreatedDraft:
                            s.newlyCreatedDraft?.id === id ? null : s.newlyCreatedDraft,
                    }));
                    return false;
                }

                localBlankDraftIds.delete(id);
                set((s) => ({
                    posts: s.posts.filter((p) => p.id !== id),
                    variants: s.variants.filter((v) => v.postId !== id),
                    currentPostId: s.currentPostId === id ? null : s.currentPostId,
                    newlyCreatedDraft: s.newlyCreatedDraft?.id === id ? null : s.newlyCreatedDraft,
                }));
                return true;
            }

            const deleted = await storage.deleteEmptyDraftIfUnmodified(id, expectedUpdatedAt);
            if (deleted) {
                set((state) => ({
                    posts: state.posts.filter((p) => p.id !== id),
                    variants: state.variants.filter((v) => v.postId !== id),
                    currentPostId: state.currentPostId === id ? null : state.currentPostId,
                    newlyCreatedDraft:
                        state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
                }));
                return true;
            }
            set((state) => ({
                newlyCreatedDraft:
                    state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
            }));
            await get().loadPosts();
            return false;
        },

        clearNewlyCreatedDraft: (id?: string) => {
            set((state) => ({
                newlyCreatedDraft:
                    !id || state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
            }));
        },

        setCurrentPost: (id: string | null) => {
            set({ currentPostId: id });
            if (id) {
                get().loadVariants(id);
            }
        },

        loadVariants: async (postId: string) => {
            try {
                const variants = await storage.getVariantsByPostId(postId);
                set((state) => ({
                    variants: [...state.variants.filter((v) => v.postId !== postId), ...variants],
                }));
            } catch (error) {
                console.error('Failed to load variants:', error);
            }
        },

        addVariant: async (variantData: Omit<Variant, 'id' | 'createdAt'>) => {
            await promoteLocalDraftIfNeeded(variantData.postId);

            if (!get().posts.some((p) => p.id === variantData.postId)) {
                throw new Error('Post no longer exists');
            }

            const variant: Variant = {
                ...variantData,
                id: generateId(),
                createdAt: Date.now(),
            };

            await storage.addVariant(variant);
            if (!get().posts.some((p) => p.id === variant.postId)) {
                throw new Error('Post no longer exists');
            }

            set((state) => ({
                variants: [...state.variants, variant],
                newlyCreatedDraft:
                    state.newlyCreatedDraft?.id === variantData.postId
                        ? null
                        : state.newlyCreatedDraft,
            }));
            return variant;
        },

        selectVariant: async (variantId: string) => {
            const variant = get().variants.find((v) => v.id === variantId);
            if (!variant) return;

            // Deselect all variants for this post, then select the chosen one
            const updatedVariants = get().variants.map((v) =>
                v.postId === variant.postId ? { ...v, isSelected: v.id === variantId } : v,
            );

            // Update in storage
            for (const v of updatedVariants.filter((v) => v.postId === variant.postId)) {
                await storage.updateVariant(v.id, { isSelected: v.isSelected });
            }

            set({ variants: updatedVariants });
        },

        deselectVariants: async (postId: string) => {
            const postVariants = get().variants.filter((v) => v.postId === postId && v.isSelected);
            if (postVariants.length === 0) return;

            const updatedVariants = get().variants.map((v) =>
                v.postId === postId ? { ...v, isSelected: false } : v,
            );

            for (const v of postVariants) {
                await storage.updateVariant(v.id, { isSelected: false });
            }

            set({ variants: updatedVariants });
        },

        deleteVariant: async (id: string) => {
            await storage.deleteVariant(id);
            set((state) => ({
                variants: state.variants.filter((v) => v.id !== id),
            }));
        },

        getPostById: (id: string) => {
            return get().posts.find((p) => p.id === id);
        },

        getPostsByFilter: (filter: LibraryFilter, folderId?: string | null) => {
            let posts = get().posts;

            // Filter by folder
            if (folderId !== undefined) {
                posts = posts.filter((p) => p.folderId === folderId);
            }

            // Filter by status
            const statusMap: Record<LibraryFilter, PostStatus | null> = {
                all: null,
                drafts: 'draft',
                posted: 'posted',
            };

            const status = statusMap[filter];
            if (status) {
                posts = posts.filter((p) => p.status === status);
            }

            // Sort by updatedAt descending without mutating store state
            return [...posts].sort((a, b) => b.updatedAt - a.updatedAt);
        },

        getVariantsByPostId: (postId: string) => {
            return get()
                .variants.filter((v) => v.postId === postId)
                .sort((a, b) => b.createdAt - a.createdAt);
        },
    };
});
