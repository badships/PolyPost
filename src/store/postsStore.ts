import { create } from 'zustand';
import type { Post, PostStatus, LibraryFilter, Variant } from '@/types';
import { storage } from '@/services/storage';
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

export const usePostsStore = create<PostsState>((set, get) => ({
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
            set({ posts, variants, isLoading: false });
        } catch (error) {
            console.error('Failed to load posts:', error);
            set({ isLoading: false });
        }
    },

    createPost: async (sourceContent: string, folderId: string | null = null) => {
        const now = Date.now();
        const post: Post = {
            id: generateId(),
            folderId,
            sourceContent,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
        };

        await storage.addPost(post);
        set((state) => ({
            posts: [...state.posts, post],
            newlyCreatedDraft: !sourceContent.trim()
                ? { id: post.id, updatedAt: post.updatedAt }
                : state.newlyCreatedDraft,
        }));
        return post;
    },

    updatePost: async (id: string, updates: Partial<Post>) => {
        await storage.updatePost(id, updates);
        set((state) => ({
            posts: state.posts.map((p) =>
                p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p,
            ),
            newlyCreatedDraft: state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
        }));
    },

    deletePost: async (id: string) => {
        await storage.deletePost(id);
        set((state) => ({
            posts: state.posts.filter((p) => p.id !== id),
            variants: state.variants.filter((v) => v.postId !== id),
            currentPostId: state.currentPostId === id ? null : state.currentPostId,
            newlyCreatedDraft: state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
        }));
    },

    discardEmptyNewDraft: async (id: string, expectedUpdatedAt: number) => {
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
            newlyCreatedDraft: state.newlyCreatedDraft?.id === id ? null : state.newlyCreatedDraft,
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
        const variant: Variant = {
            ...variantData,
            id: generateId(),
            createdAt: Date.now(),
        };

        await storage.addVariant(variant);
        set((state) => ({
            variants: [...state.variants, variant],
            newlyCreatedDraft:
                state.newlyCreatedDraft?.id === variantData.postId ? null : state.newlyCreatedDraft,
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
}));
