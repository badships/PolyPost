import type { Post, Variant, Folder, Settings } from '@/types';
import { getWebExt } from '@/services/webext';
import { DEFAULT_SETTINGS, normalizeSettings } from '@/services/settingsDefaults';

// Storage keys
const STORAGE_KEYS = {
    POSTS: 'polypost_posts',
    VARIANTS: 'polypost_variants',
    FOLDERS: 'polypost_folders',
    SETTINGS: 'polypost_settings',
} as const;

type StoredSettingsRecord = Settings & { __updatedAt?: number };

const STORAGE_LOCK_NAME = 'polypost_storage_lock';

let storageQueue: Promise<unknown> = Promise.resolve();
const enqueueStorageOp = <T>(fn: () => Promise<T>): Promise<T> => {
    const runWithLock = async (): Promise<T> => {
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            return (await navigator.locks.request(STORAGE_LOCK_NAME, () => fn())) as T;
        }
        return fn();
    };
    const next = storageQueue.then(runWithLock, runWithLock);
    storageQueue = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
};

let lastSettingsUpdatedAt = 0;
const nextSettingsTimestamp = (): number => {
    lastSettingsUpdatedAt = Math.max(Date.now(), lastSettingsUpdatedAt + 1);
    return lastSettingsUpdatedAt;
};

const stripSettingsMetadata = (
    raw?: Partial<StoredSettingsRecord> | null,
): Partial<Settings> | null => {
    if (!raw) {
        return null;
    }

    const { __updatedAt, ...rest } = raw;
    void __updatedAt;
    return rest;
};

const readLocal = <T>(key: string, fallback: T): T => {
    if (typeof localStorage === 'undefined') {
        return fallback;
    }

    const stored = localStorage.getItem(key);
    if (!stored) {
        return fallback;
    }

    try {
        return JSON.parse(stored) as T;
    } catch (error) {
        console.warn(`Failed to parse localStorage key "${key}". Resetting to defaults.`, error);
        return fallback;
    }
};

const writeLocal = (key: string, value: unknown): void => {
    if (typeof localStorage === 'undefined') {
        return;
    }

    localStorage.setItem(key, JSON.stringify(value));
};

const _getPosts = async (): Promise<Post[]> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        const result = await webext.storage.local.get(STORAGE_KEYS.POSTS);
        return result[STORAGE_KEYS.POSTS] || [];
    }

    return readLocal<Post[]>(STORAGE_KEYS.POSTS, []);
};

const _savePosts = async (posts: Post[]): Promise<void> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        await webext.storage.local.set({ [STORAGE_KEYS.POSTS]: posts });
        return;
    }

    writeLocal(STORAGE_KEYS.POSTS, posts);
};

const _getVariants = async (): Promise<Variant[]> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        const result = await webext.storage.local.get(STORAGE_KEYS.VARIANTS);
        return result[STORAGE_KEYS.VARIANTS] || [];
    }

    return readLocal<Variant[]>(STORAGE_KEYS.VARIANTS, []);
};

const _saveVariants = async (variants: Variant[]): Promise<void> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        await webext.storage.local.set({ [STORAGE_KEYS.VARIANTS]: variants });
        return;
    }

    writeLocal(STORAGE_KEYS.VARIANTS, variants);
};

const _getFolders = async (): Promise<Folder[]> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        const result = await webext.storage.local.get(STORAGE_KEYS.FOLDERS);
        return result[STORAGE_KEYS.FOLDERS] || [];
    }

    return readLocal<Folder[]>(STORAGE_KEYS.FOLDERS, []);
};

const _saveFolders = async (folders: Folder[]): Promise<void> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        await webext.storage.local.set({ [STORAGE_KEYS.FOLDERS]: folders });
        return;
    }

    writeLocal(STORAGE_KEYS.FOLDERS, folders);
};

const _getSettingsRecord = async (options?: { strict?: boolean }): Promise<Settings> => {
    const strict = options?.strict ?? false;
    const webext = getWebExt();
    let syncRaw: Partial<StoredSettingsRecord> | undefined;
    let localRaw: Partial<StoredSettingsRecord> | undefined;
    let syncError: unknown;
    let localError: unknown;

    if (webext?.storage?.sync) {
        try {
            const syncResult = await webext.storage.sync.get(STORAGE_KEYS.SETTINGS);
            syncRaw = syncResult?.[STORAGE_KEYS.SETTINGS];
        } catch (error) {
            syncError = error;
            console.warn('Failed to read settings from storage.sync:', error);
        }
    }

    if (webext?.storage?.local) {
        try {
            const localResult = await webext.storage.local.get(STORAGE_KEYS.SETTINGS);
            localRaw = localResult?.[STORAGE_KEYS.SETTINGS];
        } catch (error) {
            localError = error;
            console.warn('Failed to read settings from storage.local:', error);
        }
    }

    if (strict) {
        if (localError !== undefined) {
            throw localError;
        }
        if (localRaw === undefined && syncError !== undefined) {
            throw syncError;
        }
    }

    if (syncRaw !== undefined || localRaw !== undefined) {
        if (localRaw?.__updatedAt !== undefined) {
            lastSettingsUpdatedAt = Math.max(lastSettingsUpdatedAt, localRaw.__updatedAt);
        }
        if (syncRaw?.__updatedAt !== undefined) {
            lastSettingsUpdatedAt = Math.max(lastSettingsUpdatedAt, syncRaw.__updatedAt);
        }

        let chosen: Partial<StoredSettingsRecord> | undefined;
        if (syncRaw !== undefined && localRaw !== undefined) {
            const localUpdatedAt = localRaw.__updatedAt ?? 0;
            const syncUpdatedAt = syncRaw.__updatedAt ?? 0;
            chosen = localUpdatedAt > syncUpdatedAt ? localRaw : syncRaw;
        } else {
            chosen = localRaw ?? syncRaw;
        }

        return normalizeSettings(stripSettingsMetadata(chosen));
    }

    if (localError !== undefined || syncError !== undefined) {
        throw localError ?? syncError;
    }

    if (webext?.storage?.sync || webext?.storage?.local) {
        return normalizeSettings(null);
    }

    const webLocalRaw = readLocal<Partial<StoredSettingsRecord> | null>(
        STORAGE_KEYS.SETTINGS,
        null,
    );
    if (webLocalRaw?.__updatedAt !== undefined) {
        lastSettingsUpdatedAt = Math.max(lastSettingsUpdatedAt, webLocalRaw.__updatedAt);
    }
    return normalizeSettings(stripSettingsMetadata(webLocalRaw));
};

const _saveSettingsRecord = async (settings: Settings): Promise<void> => {
    const clean = normalizeSettings(stripSettingsMetadata(settings as StoredSettingsRecord));
    const record: StoredSettingsRecord = {
        ...clean,
        __updatedAt: nextSettingsTimestamp(),
    };

    const webext = getWebExt();
    if (!webext?.storage?.sync && !webext?.storage?.local) {
        writeLocal(STORAGE_KEYS.SETTINGS, record);
        return;
    }

    let localSaved = false;
    let syncSaved = false;
    let lastError: unknown;

    if (webext?.storage?.local) {
        try {
            await webext.storage.local.set({ [STORAGE_KEYS.SETTINGS]: record });
            localSaved = true;
        } catch (error) {
            lastError = error;
        }
    }

    if (webext?.storage?.sync) {
        try {
            await webext.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: record });
            syncSaved = true;
        } catch (error) {
            lastError = error;
            if (localSaved) {
                console.warn(
                    'Failed to sync settings to storage.sync; keeping newer copy in storage.local:',
                    error,
                );
            }
        }
    }

    if (!localSaved && !syncSaved && lastError) {
        throw lastError;
    }
};

/**
 * WebExtension Storage API wrapper for data persistence.
 * Includes fallback to localStorage for plain-browser web development.
 */
export const storage = {
    // ============================================
    // Posts
    // ============================================
    async getPosts(): Promise<Post[]> {
        return _getPosts();
    },

    async savePosts(posts: Post[]): Promise<void> {
        return enqueueStorageOp(() => _savePosts(posts));
    },

    async addPost(post: Post): Promise<void> {
        return enqueueStorageOp(async () => {
            const posts = await _getPosts();
            posts.push(post);
            await _savePosts(posts);
        });
    },

    async updatePost(id: string, updates: Partial<Post>): Promise<void> {
        return enqueueStorageOp(async () => {
            const posts = await _getPosts();
            const index = posts.findIndex((p) => p.id === id);
            if (index !== -1) {
                posts[index] = { ...posts[index], ...updates, updatedAt: Date.now() };
                await _savePosts(posts);
            }
        });
    },

    async deletePost(id: string): Promise<void> {
        return enqueueStorageOp(async () => {
            const [posts, variants] = await Promise.all([_getPosts(), _getVariants()]);
            const filtered = posts.filter((p) => p.id !== id);
            const filteredVariants = variants.filter((v) => v.postId !== id);
            const webext = getWebExt();
            if (webext?.storage?.local) {
                await webext.storage.local.set({
                    [STORAGE_KEYS.POSTS]: filtered,
                    [STORAGE_KEYS.VARIANTS]: filteredVariants,
                });
                return;
            }

            writeLocal(STORAGE_KEYS.POSTS, filtered);
            writeLocal(STORAGE_KEYS.VARIANTS, filteredVariants);
        });
    },

    // ============================================
    // Variants
    // ============================================
    async getVariants(): Promise<Variant[]> {
        return _getVariants();
    },

    async saveVariants(variants: Variant[]): Promise<void> {
        return enqueueStorageOp(() => _saveVariants(variants));
    },

    async addVariant(variant: Variant): Promise<void> {
        return enqueueStorageOp(async () => {
            const variants = await _getVariants();
            variants.push(variant);
            await _saveVariants(variants);
        });
    },

    async getVariantsByPostId(postId: string): Promise<Variant[]> {
        const variants = await _getVariants();
        return variants.filter((v) => v.postId === postId);
    },

    async deleteVariant(id: string): Promise<void> {
        return enqueueStorageOp(async () => {
            const variants = await _getVariants();
            const filtered = variants.filter((v) => v.id !== id);
            await _saveVariants(filtered);
        });
    },

    async updateVariant(id: string, updates: Partial<Variant>): Promise<void> {
        return enqueueStorageOp(async () => {
            const variants = await _getVariants();
            const index = variants.findIndex((v) => v.id === id);
            if (index !== -1) {
                variants[index] = { ...variants[index], ...updates };
                await _saveVariants(variants);
            }
        });
    },

    // ============================================
    // Folders
    // ============================================
    async getFolders(): Promise<Folder[]> {
        return _getFolders();
    },

    async saveFolders(folders: Folder[]): Promise<void> {
        return enqueueStorageOp(() => _saveFolders(folders));
    },

    async addFolder(folder: Folder): Promise<void> {
        return enqueueStorageOp(async () => {
            const folders = await _getFolders();
            folders.push(folder);
            await _saveFolders(folders);
        });
    },

    async updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
        return enqueueStorageOp(async () => {
            const folders = await _getFolders();
            const index = folders.findIndex((f) => f.id === id);
            if (index !== -1) {
                folders[index] = { ...folders[index], ...updates, updatedAt: Date.now() };
                await _saveFolders(folders);
            }
        });
    },

    async deleteFolder(id: string): Promise<void> {
        return enqueueStorageOp(async () => {
            const [folders, posts] = await Promise.all([_getFolders(), _getPosts()]);
            const filtered = folders.filter((f) => f.id !== id);
            const updatedPosts = posts.map((p) =>
                p.folderId === id ? { ...p, folderId: null, updatedAt: Date.now() } : p,
            );
            const webext = getWebExt();
            if (webext?.storage?.local) {
                await webext.storage.local.set({
                    [STORAGE_KEYS.FOLDERS]: filtered,
                    [STORAGE_KEYS.POSTS]: updatedPosts,
                });
                return;
            }

            writeLocal(STORAGE_KEYS.FOLDERS, filtered);
            writeLocal(STORAGE_KEYS.POSTS, updatedPosts);
        });
    },

    // ============================================
    // Settings
    // ============================================
    async getSettings(): Promise<Settings> {
        return _getSettingsRecord();
    },

    async saveSettings(settings: Settings): Promise<void> {
        return enqueueStorageOp(() => _saveSettingsRecord(settings));
    },

    async updateSettings(updates: Partial<Settings>): Promise<void> {
        return enqueueStorageOp(async () => {
            const settings = await _getSettingsRecord({ strict: true });
            await _saveSettingsRecord({ ...DEFAULT_SETTINGS, ...settings, ...updates });
        });
    },
};
