import { create } from 'zustand';
import type { Folder } from '@/types';
import { storage } from '@/services/storage';
import { generateId } from '@/utils';
import { FOLDER_COLORS } from '@/types';
import {
    usePostsStore,
    nextLocalPostTimestamp,
    isPromotingLocalDraft,
    markFolderDeleted,
    clearDeletedFolderMark,
    isFolderDeleted,
    syncNewlyCreatedDraftRevision,
} from './postsStore';
import { useUIStore } from './uiStore';

let folderMutationSeq = 0;
const folderWriteSeqById = new Map<string, number>();

const recordFolderWrite = (id: string): void => {
    folderWriteSeqById.set(id, ++folderMutationSeq);
};

interface FoldersState {
    folders: Folder[];
    isLoading: boolean;

    // Actions
    loadFolders: () => Promise<void>;
    createFolder: (name: string, color?: string) => Promise<Folder>;
    updateFolder: (id: string, updates: Partial<Folder>) => Promise<void>;
    deleteFolder: (id: string) => Promise<void>;

    // Getters
    getFolderById: (id: string) => Folder | undefined;
}

export const useFoldersStore = create<FoldersState>((set, get) => ({
    folders: [],
    isLoading: false,

    loadFolders: async () => {
        const seqAtStart = folderMutationSeq;
        set({ isLoading: true });
        try {
            const folders = await storage.getFolders();
            set((state) => {
                const existingById = new Map(state.folders.map((f) => [f.id, f]));
                const loadedIds = new Set<string>();
                const mergedFolders: Folder[] = [];

                for (const folder of folders) {
                    if (isFolderDeleted(folder.id)) {
                        continue;
                    }
                    loadedIds.add(folder.id);
                    const existing = existingById.get(folder.id);
                    if (existing && (folderWriteSeqById.get(folder.id) ?? 0) > seqAtStart) {
                        mergedFolders.push(existing);
                    } else {
                        mergedFolders.push(folder);
                    }
                }

                for (const current of state.folders) {
                    if (loadedIds.has(current.id) || isFolderDeleted(current.id)) {
                        continue;
                    }
                    if ((folderWriteSeqById.get(current.id) ?? 0) > seqAtStart) {
                        mergedFolders.push(current);
                    }
                }

                return { folders: mergedFolders, isLoading: false };
            });
        } catch (error) {
            console.error('Failed to load folders:', error);
            set({ isLoading: false });
        }
    },

    createFolder: async (name: string, color?: string) => {
        const existingColors = get().folders.map((f) => f.color);
        const availableColors = FOLDER_COLORS.filter((c) => !existingColors.includes(c));
        const selectedColor = color || availableColors[0] || FOLDER_COLORS[0];

        const folder: Folder = {
            id: generateId(),
            name,
            color: selectedColor,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        clearDeletedFolderMark(folder.id);
        recordFolderWrite(folder.id);
        await storage.addFolder(folder);
        set((state) => ({ folders: [...state.folders, folder] }));
        return folder;
    },

    updateFolder: async (id: string, updates: Partial<Folder>) => {
        recordFolderWrite(id);
        await storage.updateFolder(id, updates);
        set((state) => ({
            folders: state.folders.map((f) =>
                f.id === id ? { ...f, ...updates, updatedAt: Date.now() } : f,
            ),
        }));
    },

    deleteFolder: async (id: string) => {
        markFolderDeleted(id);
        recordFolderWrite(id);
        const storedPosts = await storage.deleteFolder(id);
        const storedPostById = new Map(storedPosts.map((p) => [p.id, p]));
        set((state) => ({
            folders: state.folders.filter((f) => f.id !== id),
        }));
        usePostsStore.setState((state) => {
            let nextNewlyCreatedDraft = state.newlyCreatedDraft;
            const nextPosts = state.posts.map((p) => {
                const persisted = storedPostById.get(p.id);
                let nextPost = p;
                if (persisted) {
                    nextPost = persisted.updatedAt > p.updatedAt ? persisted : p;
                } else if (p.folderId === id && !isPromotingLocalDraft(p.id)) {
                    nextPost = {
                        ...p,
                        folderId: null,
                        updatedAt: nextLocalPostTimestamp(p.updatedAt),
                    };
                }

                syncNewlyCreatedDraftRevision(nextPost);
                if (
                    nextNewlyCreatedDraft?.id === nextPost.id &&
                    nextPost.status === 'draft' &&
                    !nextPost.sourceContent.trim()
                ) {
                    nextNewlyCreatedDraft = {
                        id: nextPost.id,
                        updatedAt: nextPost.updatedAt,
                    };
                }

                return nextPost;
            });
            return {
                posts: nextPosts,
                newlyCreatedDraft: nextNewlyCreatedDraft,
            };
        });
        if (useUIStore.getState().selectedFolderId === id) {
            useUIStore.getState().setSelectedFolderId(null);
        }
    },

    getFolderById: (id: string) => {
        return get().folders.find((f) => f.id === id);
    },
}));
