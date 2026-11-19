import { create } from 'zustand';
import type { Folder } from '@/types';
import { storage } from '@/services/storage';
import { generateId } from '@/utils';
import { FOLDER_COLORS } from '@/types';
import { usePostsStore, nextLocalPostTimestamp } from './postsStore';
import { useUIStore } from './uiStore';

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
        set({ isLoading: true });
        try {
            const folders = await storage.getFolders();
            set({ folders, isLoading: false });
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

        await storage.addFolder(folder);
        set((state) => ({ folders: [...state.folders, folder] }));
        return folder;
    },

    updateFolder: async (id: string, updates: Partial<Folder>) => {
        await storage.updateFolder(id, updates);
        set((state) => ({
            folders: state.folders.map((f) =>
                f.id === id ? { ...f, ...updates, updatedAt: Date.now() } : f,
            ),
        }));
    },

    deleteFolder: async (id: string) => {
        await storage.deleteFolder(id);
        const storedPosts = await storage.getPosts();
        const storedUpdatedAtById = new Map(storedPosts.map((p) => [p.id, p.updatedAt]));
        set((state) => ({
            folders: state.folders.filter((f) => f.id !== id),
        }));
        usePostsStore.setState((state) => ({
            posts: state.posts.map((p) => {
                if (p.folderId !== id) {
                    return p;
                }
                const persistedUpdatedAt = storedUpdatedAtById.get(p.id);
                return {
                    ...p,
                    folderId: null,
                    updatedAt:
                        persistedUpdatedAt !== undefined
                            ? persistedUpdatedAt
                            : nextLocalPostTimestamp(p.updatedAt),
                };
            }),
        }));
        if (useUIStore.getState().selectedFolderId === id) {
            useUIStore.getState().setSelectedFolderId(null);
        }
    },

    getFolderById: (id: string) => {
        return get().folders.find((f) => f.id === id);
    },
}));
