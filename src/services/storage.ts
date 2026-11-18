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

type StoredSettingsRecord = Partial<Settings> & {
    __updatedAt?: number;
    __fieldUpdatedAt?: Partial<Record<keyof Settings, number>>;
};

const SETTING_KEYS: (keyof Settings)[] = [
    'openaiApiKey',
    'provider',
    'customApiUrl',
    'customApiKey',
    'modelName',
    'providerConfigs',
    'customProviders',
    'activeCustomProviderId',
    'defaultLanguage',
    'defaultPolishTemplate',
    'theme',
    'uiLanguage',
    'prompts',
];

const STORAGE_LOCK_NAME = 'polypost_storage_lock';
const STORAGE_RPC_TYPE = 'polypost:storage_rpc';
const QUEUE_SYM = Symbol.for('polypost.storage.queue');
const UPDATED_AT_SYM = Symbol.for('polypost.storage.lastUpdatedAt');
const POST_UPDATED_AT_SYM = Symbol.for('polypost.storage.lastPostUpdatedAt');

type StorageMutationMethod =
    | 'savePosts'
    | 'addPost'
    | 'updatePost'
    | 'deletePost'
    | 'deleteEmptyDraftIfUnmodified'
    | 'saveVariants'
    | 'addVariant'
    | 'deleteVariant'
    | 'updateVariant'
    | 'saveFolders'
    | 'addFolder'
    | 'updateFolder'
    | 'deleteFolder'
    | 'saveSettings'
    | 'updateSettings';

type StorageRpcMessage = {
    type: typeof STORAGE_RPC_TYPE;
    method: StorageMutationMethod;
    args: unknown[];
};

type StorageRpcResponse = {
    __polypostStorageRpc: true;
    ok: boolean;
    value?: unknown;
    error?: string;
};

interface SharedStorageState {
    [QUEUE_SYM]?: Promise<unknown>;
    [UPDATED_AT_SYM]?: number;
    [POST_UPDATED_AT_SYM]?: number;
}

const fallbackSharedState: SharedStorageState = {};

const getSharedState = (): SharedStorageState => {
    const webext = getWebExt();
    const host = (webext?.storage ?? webext?.storage?.local) as unknown as
        | (SharedStorageState & object)
        | undefined;
    if (host && (typeof host === 'object' || typeof host === 'function')) {
        try {
            if (typeof host[UPDATED_AT_SYM] !== 'number') {
                host[UPDATED_AT_SYM] = 0;
            }
            if (typeof host[POST_UPDATED_AT_SYM] !== 'number') {
                host[POST_UPDATED_AT_SYM] = 0;
            }
            if (!host[QUEUE_SYM]) {
                host[QUEUE_SYM] = Promise.resolve();
            }
            return host;
        } catch {
            // Fall through when host object is frozen or non-extensible.
        }
    }

    if (typeof fallbackSharedState[UPDATED_AT_SYM] !== 'number') {
        fallbackSharedState[UPDATED_AT_SYM] = 0;
    }
    if (typeof fallbackSharedState[POST_UPDATED_AT_SYM] !== 'number') {
        fallbackSharedState[POST_UPDATED_AT_SYM] = 0;
    }
    if (!fallbackSharedState[QUEUE_SYM]) {
        fallbackSharedState[QUEUE_SYM] = Promise.resolve();
    }
    return fallbackSharedState;
};

const enqueueStorageOp = <T>(fn: () => Promise<T>): Promise<T> => {
    const shared = getSharedState();
    const prevQueue = shared[QUEUE_SYM] ?? Promise.resolve();

    const runWithLock = async (): Promise<T> => {
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            return (await navigator.locks.request(STORAGE_LOCK_NAME, () => fn())) as T;
        }
        return fn();
    };

    const next = prevQueue.then(runWithLock, runWithLock);
    shared[QUEUE_SYM] = next.then(
        () => undefined,
        () => undefined,
    );
    return next;
};

const getLastSettingsUpdatedAt = (): number => {
    return getSharedState()[UPDATED_AT_SYM] ?? 0;
};

const bumpLastSettingsUpdatedAt = (timestamp?: number): void => {
    if (typeof timestamp !== 'number') {
        return;
    }
    const shared = getSharedState();
    shared[UPDATED_AT_SYM] = Math.max(shared[UPDATED_AT_SYM] ?? 0, timestamp);
};

const nextSettingsTimestamp = (): number => {
    const shared = getSharedState();
    const next = Math.max(Date.now(), (shared[UPDATED_AT_SYM] ?? 0) + 1);
    shared[UPDATED_AT_SYM] = next;
    return next;
};

const bumpLastPostUpdatedAt = (timestamp?: number): void => {
    if (typeof timestamp !== 'number') {
        return;
    }
    const shared = getSharedState();
    shared[POST_UPDATED_AT_SYM] = Math.max(shared[POST_UPDATED_AT_SYM] ?? 0, timestamp);
};

const nextPostTimestamp = (minFloor = 0): number => {
    const shared = getSharedState();
    const next = Math.max(Date.now(), (shared[POST_UPDATED_AT_SYM] ?? 0) + 1, minFloor + 1);
    shared[POST_UPDATED_AT_SYM] = next;
    return next;
};

const isEmbeddedFrame = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }
    try {
        return window.top !== window;
    } catch {
        return true;
    }
};

const stripSettingsMetadata = (
    raw?: Partial<StoredSettingsRecord> | null,
): Partial<Settings> | null => {
    if (!raw) {
        return null;
    }

    const { __updatedAt, __fieldUpdatedAt, ...rest } = raw;
    void __updatedAt;
    void __fieldUpdatedAt;
    return rest;
};

const getMaxFieldTimestamp = (record?: Partial<StoredSettingsRecord> | null): number => {
    if (!record?.__fieldUpdatedAt) {
        return 0;
    }
    let maxTs = 0;
    for (const ts of Object.values(record.__fieldUpdatedAt)) {
        if (typeof ts === 'number' && ts > maxTs) {
            maxTs = ts;
        }
    }
    return maxTs;
};

const getEffectiveFieldTimestamp = (
    record: Partial<StoredSettingsRecord> | undefined,
    key: keyof Settings,
): number => {
    if (!record || !(key in record)) {
        return -1;
    }
    const recordUpdatedAt = record.__updatedAt ?? 0;
    const fieldMap = record.__fieldUpdatedAt;
    if (!fieldMap) {
        return recordUpdatedAt;
    }
    const maxTrackedTs = getMaxFieldTimestamp(record);
    if (recordUpdatedAt > maxTrackedTs) {
        return recordUpdatedAt;
    }
    const fieldTs = fieldMap[key];
    return typeof fieldTs === 'number' ? fieldTs : 0;
};

type SettingsReadMeta = {
    settings: Settings;
    syncRaw?: Partial<StoredSettingsRecord>;
    localRaw?: Partial<StoredSettingsRecord>;
    syncUpdatedAt: number;
    localUpdatedAt: number;
    fieldUpdatedAt: Partial<Record<keyof Settings, number>>;
};

const mergeSettingsWithFieldTimestamps = (
    syncRaw?: Partial<StoredSettingsRecord>,
    localRaw?: Partial<StoredSettingsRecord>,
): {
    settings: Settings;
    fieldUpdatedAt: Partial<Record<keyof Settings, number>>;
} => {
    const syncUpdatedAt = syncRaw?.__updatedAt ?? 0;
    const localUpdatedAt = localRaw?.__updatedAt ?? 0;
    const mergedRaw: Partial<Settings> = {};
    const fieldUpdatedAt: Partial<Record<keyof Settings, number>> = {};

    for (const key of SETTING_KEYS) {
        const localTs = getEffectiveFieldTimestamp(localRaw, key);
        const syncTs = getEffectiveFieldTimestamp(syncRaw, key);

        if (localTs < 0 && syncTs < 0) {
            continue;
        }

        let sourceRecord: Partial<StoredSettingsRecord> | undefined;
        let chosenTs: number;

        if (localTs > syncTs) {
            sourceRecord = localRaw;
            chosenTs = localTs;
        } else if (syncTs > localTs) {
            sourceRecord = syncRaw;
            chosenTs = syncTs;
        } else {
            sourceRecord = localUpdatedAt > syncUpdatedAt ? localRaw : syncRaw;
            chosenTs = Math.max(localTs, syncTs);
        }

        if (sourceRecord && key in sourceRecord) {
            (mergedRaw as Record<string, unknown>)[key] = sourceRecord[key];
            fieldUpdatedAt[key] = chosenTs;
        }
    }

    return {
        settings: normalizeSettings(mergedRaw),
        fieldUpdatedAt,
    };
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

const normalizeStoredPost = (post: Post): Post => ({
    ...post,
    status: post.status === 'posted' ? 'posted' : 'draft',
});

const _getPosts = async (): Promise<Post[]> => {
    const webext = getWebExt();
    if (webext?.storage?.local) {
        const result = await webext.storage.local.get(STORAGE_KEYS.POSTS);
        const posts = (result[STORAGE_KEYS.POSTS] || []) as Post[];
        return posts.map(normalizeStoredPost);
    }

    return readLocal<Post[]>(STORAGE_KEYS.POSTS, []).map(normalizeStoredPost);
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

const _readSettingsWithMeta = async (options?: { strict?: boolean }): Promise<SettingsReadMeta> => {
    const strict = options?.strict ?? false;
    const webext = getWebExt();
    let localRaw: Partial<StoredSettingsRecord> | undefined;
    let syncRaw: Partial<StoredSettingsRecord> | undefined;
    let localError: unknown;
    let syncError: unknown;

    // Read local before sync so a late sync delivery triggered during local.get
    // is visible to the subsequent sync.get in the same transaction.
    if (webext?.storage?.local) {
        try {
            const localResult = await webext.storage.local.get(STORAGE_KEYS.SETTINGS);
            localRaw = localResult?.[STORAGE_KEYS.SETTINGS];
        } catch (error) {
            localError = error;
            console.warn('Failed to read settings from storage.local:', error);
        }
    }

    if (webext?.storage?.sync) {
        try {
            const syncResult = await webext.storage.sync.get(STORAGE_KEYS.SETTINGS);
            syncRaw = syncResult?.[STORAGE_KEYS.SETTINGS];
        } catch (error) {
            syncError = error;
            console.warn('Failed to read settings from storage.sync:', error);
        }
    }

    if (strict) {
        if (localError !== undefined) {
            throw localError;
        }
        if (syncError !== undefined) {
            throw syncError;
        }
    }

    if (syncRaw !== undefined || localRaw !== undefined) {
        const localUpdatedAt = localRaw?.__updatedAt ?? 0;
        const syncUpdatedAt = syncRaw?.__updatedAt ?? 0;
        bumpLastSettingsUpdatedAt(localUpdatedAt);
        bumpLastSettingsUpdatedAt(syncUpdatedAt);

        const { settings, fieldUpdatedAt } = mergeSettingsWithFieldTimestamps(syncRaw, localRaw);
        return {
            settings,
            syncRaw,
            localRaw,
            syncUpdatedAt,
            localUpdatedAt,
            fieldUpdatedAt,
        };
    }

    if (localError !== undefined || syncError !== undefined) {
        throw localError ?? syncError;
    }

    if (webext?.storage?.sync || webext?.storage?.local) {
        return {
            settings: normalizeSettings(null),
            syncUpdatedAt: 0,
            localUpdatedAt: 0,
            fieldUpdatedAt: {},
        };
    }

    const webLocalRaw = readLocal<Partial<StoredSettingsRecord> | null>(
        STORAGE_KEYS.SETTINGS,
        null,
    );
    bumpLastSettingsUpdatedAt(webLocalRaw?.__updatedAt);
    void getLastSettingsUpdatedAt;
    const { settings, fieldUpdatedAt } = mergeSettingsWithFieldTimestamps(
        undefined,
        webLocalRaw ?? undefined,
    );
    return {
        settings,
        localRaw: webLocalRaw ?? undefined,
        syncUpdatedAt: 0,
        localUpdatedAt: webLocalRaw?.__updatedAt ?? 0,
        fieldUpdatedAt,
    };
};

const _getSettingsRecord = async (options?: { strict?: boolean }): Promise<Settings> => {
    const meta = await _readSettingsWithMeta(options);
    return meta.settings;
};

const _writeSettingsRecord = async (
    settings: Settings,
    fieldUpdatedAt: Partial<Record<keyof Settings, number>>,
    updatedAt: number,
    options?: {
        patchedKeys?: (keyof Settings)[];
        initialSyncUpdatedAt?: number;
        patchValues?: Partial<Settings>;
    },
): Promise<Settings> => {
    let clean = normalizeSettings(stripSettingsMetadata(settings as StoredSettingsRecord));
    let nextFieldUpdatedAt = { ...fieldUpdatedAt };
    let nextUpdatedAt = updatedAt;

    const webext = getWebExt();
    if (!webext?.storage?.sync && !webext?.storage?.local) {
        const record: StoredSettingsRecord = {
            ...clean,
            __updatedAt: nextUpdatedAt,
            __fieldUpdatedAt: nextFieldUpdatedAt,
        };
        writeLocal(STORAGE_KEYS.SETTINGS, record);
        return clean;
    }

    let localSaved = false;
    let syncSaved = false;
    let lastError: unknown;

    const buildRecord = (): StoredSettingsRecord => ({
        ...clean,
        __updatedAt: nextUpdatedAt,
        __fieldUpdatedAt: nextFieldUpdatedAt,
    });

    if (webext?.storage?.local) {
        try {
            await webext.storage.local.set({ [STORAGE_KEYS.SETTINGS]: buildRecord() });
            localSaved = true;
        } catch (error) {
            lastError = error;
        }
    }

    if (webext?.storage?.sync) {
        try {
            // Re-check sync right before writing so a concurrent sync update arriving
            // between the initial read and sync.set does not have untouched fields clobbered.
            if (options?.patchedKeys && typeof webext.storage.sync.get === 'function') {
                try {
                    const syncCheckResult = await webext.storage.sync.get(STORAGE_KEYS.SETTINGS);
                    const latestSync = syncCheckResult?.[STORAGE_KEYS.SETTINGS] as
                        | Partial<StoredSettingsRecord>
                        | undefined;
                    const latestSyncUpdatedAt = latestSync?.__updatedAt ?? 0;
                    if (latestSync && latestSyncUpdatedAt > (options.initialSyncUpdatedAt ?? 0)) {
                        const patchedSet = new Set<keyof Settings>(options.patchedKeys);
                        const mergedClean: Partial<Settings> = { ...clean };
                        const patchedFieldMap: Partial<Record<keyof Settings, number>> = {
                            ...nextFieldUpdatedAt,
                        };
                        for (const key of SETTING_KEYS) {
                            if (patchedSet.has(key)) {
                                if (options.patchValues && key in options.patchValues) {
                                    (mergedClean as Record<string, unknown>)[key] =
                                        options.patchValues[key];
                                }
                                continue;
                            }
                            const syncKeyTs = getEffectiveFieldTimestamp(latestSync, key);
                            const ourKeyTs = nextFieldUpdatedAt[key] ?? 0;
                            if (syncKeyTs > ourKeyTs && key in latestSync) {
                                (mergedClean as Record<string, unknown>)[key] = latestSync[key];
                                patchedFieldMap[key] = syncKeyTs;
                            }
                        }
                        bumpLastSettingsUpdatedAt(latestSyncUpdatedAt);
                        nextUpdatedAt = Math.max(nextUpdatedAt, nextSettingsTimestamp());
                        for (const key of patchedSet) {
                            patchedFieldMap[key] = nextUpdatedAt;
                        }
                        clean = normalizeSettings(mergedClean);
                        nextFieldUpdatedAt = patchedFieldMap;
                        if (webext.storage.local && localSaved) {
                            await webext.storage.local
                                .set({ [STORAGE_KEYS.SETTINGS]: buildRecord() })
                                .catch(() => undefined);
                        }
                    }
                } catch {
                    // Proceed with the sync write using our latest read snapshot.
                }
            }

            await webext.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: buildRecord() });
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

    return clean;
};

const _commitSettingsPatch = async (
    mutator: (current: Settings) => { patch: Partial<Settings> },
): Promise<Settings> => {
    const meta = await _readSettingsWithMeta({ strict: true });
    const { patch } = mutator(meta.settings);
    const patchedKeys = Object.keys(patch) as (keyof Settings)[];

    const baseTs = Math.max(meta.syncUpdatedAt, meta.localUpdatedAt);
    bumpLastSettingsUpdatedAt(baseTs);
    const updatedAt = nextSettingsTimestamp();
    const nextFieldUpdatedAt: Partial<Record<keyof Settings, number>> = {
        ...meta.fieldUpdatedAt,
    };

    for (const key of patchedKeys) {
        nextFieldUpdatedAt[key] = updatedAt;
    }

    const nextSettings = normalizeSettings({
        ...DEFAULT_SETTINGS,
        ...meta.settings,
        ...patch,
    });

    return _writeSettingsRecord(nextSettings, nextFieldUpdatedAt, updatedAt, {
        patchedKeys,
        initialSyncUpdatedAt: meta.syncUpdatedAt,
        patchValues: patch,
    });
};

const localMutations = {
    async savePosts(posts: Post[]): Promise<void> {
        return enqueueStorageOp(() => _savePosts(posts));
    },

    async addPost(post: Post): Promise<void> {
        return enqueueStorageOp(async () => {
            const posts = await _getPosts();
            const exists = posts.some((p) => p.id === post.id);
            const nextPosts = exists
                ? posts.map((p) => (p.id === post.id ? post : p))
                : [...posts, post];
            bumpLastPostUpdatedAt(post.updatedAt);
            await _savePosts(nextPosts);
        });
    },

    async updatePost(id: string, updates: Partial<Post>): Promise<Post> {
        return enqueueStorageOp(async () => {
            const posts = await _getPosts();
            const index = posts.findIndex((p) => p.id === id);
            if (index === -1) {
                throw new Error('Post no longer exists');
            }
            const nextPost: Post = {
                ...posts[index],
                ...updates,
                updatedAt: nextPostTimestamp(posts[index].updatedAt),
            };
            posts[index] = nextPost;
            await _savePosts(posts);
            return nextPost;
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

    async deleteEmptyDraftIfUnmodified(id: string, expectedUpdatedAt: number): Promise<boolean> {
        return enqueueStorageOp(async () => {
            const [posts, variants] = await Promise.all([_getPosts(), _getVariants()]);
            const target = posts.find((p) => p.id === id);
            if (!target) {
                return false;
            }
            const hasVariants = variants.some((v) => v.postId === id);
            if (
                target.status !== 'draft' ||
                target.updatedAt !== expectedUpdatedAt ||
                target.sourceContent.trim().length > 0 ||
                hasVariants
            ) {
                return false;
            }

            const filtered = posts.filter((p) => p.id !== id);
            await _savePosts(filtered);
            return true;
        });
    },

    async saveVariants(variants: Variant[]): Promise<void> {
        return enqueueStorageOp(() => _saveVariants(variants));
    },

    async addVariant(variant: Variant): Promise<void> {
        return enqueueStorageOp(async () => {
            const variants = await _getVariants();
            const exists = variants.some((v) => v.id === variant.id);
            const nextVariants = exists
                ? variants.map((v) => (v.id === variant.id ? variant : v))
                : [...variants, variant];
            await _saveVariants(nextVariants);
        });
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

    async saveFolders(folders: Folder[]): Promise<void> {
        return enqueueStorageOp(() => _saveFolders(folders));
    },

    async addFolder(folder: Folder): Promise<void> {
        return enqueueStorageOp(async () => {
            const folders = await _getFolders();
            const exists = folders.some((f) => f.id === folder.id);
            const nextFolders = exists
                ? folders.map((f) => (f.id === folder.id ? folder : f))
                : [...folders, folder];
            await _saveFolders(nextFolders);
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
                p.folderId === id
                    ? { ...p, folderId: null, updatedAt: nextPostTimestamp(p.updatedAt) }
                    : p,
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

    async saveSettings(settings: Settings): Promise<void> {
        return enqueueStorageOp(async () => {
            const webext = getWebExt();
            const latest =
                webext?.storage?.sync || webext?.storage?.local
                    ? await _readSettingsWithMeta({ strict: false })
                    : null;
            if (latest) {
                bumpLastSettingsUpdatedAt(Math.max(latest.syncUpdatedAt, latest.localUpdatedAt));
            }
            const updatedAt = nextSettingsTimestamp();
            const fieldUpdatedAt: Partial<Record<keyof Settings, number>> = {};
            for (const key of SETTING_KEYS) {
                fieldUpdatedAt[key] = updatedAt;
            }
            await _writeSettingsRecord(settings, fieldUpdatedAt, updatedAt);
        });
    },

    async updateSettings(updates: Partial<Settings>): Promise<Settings> {
        return enqueueStorageOp(async () => {
            return _commitSettingsPatch(() => ({ patch: updates }));
        });
    },
};

const ALLOWED_RPC_METHODS = new Set<StorageMutationMethod>(
    Object.keys(localMutations) as StorageMutationMethod[],
);

const runMutation = async <M extends StorageMutationMethod>(
    method: M,
    args: Parameters<(typeof localMutations)[M]>,
): Promise<Awaited<ReturnType<(typeof localMutations)[M]>>> => {
    const webext = getWebExt();
    if (isEmbeddedFrame()) {
        if (!webext?.runtime?.sendMessage) {
            throw new Error('Background storage RPC unavailable');
        }
        const rpcResponse = (await webext.runtime.sendMessage({
            type: STORAGE_RPC_TYPE,
            method,
            args,
        } satisfies StorageRpcMessage)) as StorageRpcResponse | undefined;

        if (!rpcResponse || typeof rpcResponse !== 'object' || !rpcResponse.__polypostStorageRpc) {
            throw new Error('Background storage RPC unavailable');
        }
        if (!rpcResponse.ok) {
            throw new Error(rpcResponse.error || 'Storage operation failed');
        }
        return rpcResponse.value as Awaited<ReturnType<(typeof localMutations)[M]>>;
    }

    const fn = localMutations[method] as (...fnArgs: unknown[]) => Promise<unknown>;
    return (await fn(...args)) as Awaited<ReturnType<(typeof localMutations)[M]>>;
};

export const handleStorageRpcMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender | undefined,
    sendResponse: (response?: unknown) => void,
): boolean | undefined => {
    if (!message || typeof message !== 'object') {
        return undefined;
    }

    const candidate = message as Partial<StorageRpcMessage>;
    if (
        candidate.type !== STORAGE_RPC_TYPE ||
        typeof candidate.method !== 'string' ||
        !ALLOWED_RPC_METHODS.has(candidate.method as StorageMutationMethod) ||
        !Array.isArray(candidate.args)
    ) {
        return undefined;
    }

    const webext = getWebExt();
    const extBaseUrl = webext?.runtime?.getURL?.('');
    if (extBaseUrl && sender?.url && !sender.url.startsWith(extBaseUrl)) {
        sendResponse({
            __polypostStorageRpc: true,
            ok: false,
            error: 'Unauthorized storage RPC sender',
        } satisfies StorageRpcResponse);
        return false;
    }

    const executor = localMutations[candidate.method as StorageMutationMethod] as (
        ...args: unknown[]
    ) => Promise<unknown>;

    executor(...candidate.args)
        .then((value) => {
            sendResponse({
                __polypostStorageRpc: true,
                ok: true,
                value,
            } satisfies StorageRpcResponse);
        })
        .catch((error) => {
            sendResponse({
                __polypostStorageRpc: true,
                ok: false,
                error: error instanceof Error ? error.message : 'Storage operation failed',
            } satisfies StorageRpcResponse);
        });

    return true;
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
        return runMutation('savePosts', [posts]);
    },

    async addPost(post: Post): Promise<void> {
        return runMutation('addPost', [post]);
    },

    async updatePost(id: string, updates: Partial<Post>): Promise<Post> {
        return runMutation('updatePost', [id, updates]);
    },

    async deletePost(id: string): Promise<void> {
        return runMutation('deletePost', [id]);
    },

    async deleteEmptyDraftIfUnmodified(id: string, expectedUpdatedAt: number): Promise<boolean> {
        return runMutation('deleteEmptyDraftIfUnmodified', [id, expectedUpdatedAt]);
    },

    // ============================================
    // Variants
    // ============================================
    async getVariants(): Promise<Variant[]> {
        return _getVariants();
    },

    async saveVariants(variants: Variant[]): Promise<void> {
        return runMutation('saveVariants', [variants]);
    },

    async addVariant(variant: Variant): Promise<void> {
        return runMutation('addVariant', [variant]);
    },

    async getVariantsByPostId(postId: string): Promise<Variant[]> {
        const variants = await _getVariants();
        return variants.filter((v) => v.postId === postId);
    },

    async deleteVariant(id: string): Promise<void> {
        return runMutation('deleteVariant', [id]);
    },

    async updateVariant(id: string, updates: Partial<Variant>): Promise<void> {
        return runMutation('updateVariant', [id, updates]);
    },

    // ============================================
    // Folders
    // ============================================
    async getFolders(): Promise<Folder[]> {
        return _getFolders();
    },

    async saveFolders(folders: Folder[]): Promise<void> {
        return runMutation('saveFolders', [folders]);
    },

    async addFolder(folder: Folder): Promise<void> {
        return runMutation('addFolder', [folder]);
    },

    async updateFolder(id: string, updates: Partial<Folder>): Promise<void> {
        return runMutation('updateFolder', [id, updates]);
    },

    async deleteFolder(id: string): Promise<void> {
        return runMutation('deleteFolder', [id]);
    },

    // ============================================
    // Settings
    // ============================================
    async getSettings(): Promise<Settings> {
        return _getSettingsRecord();
    },

    async saveSettings(settings: Settings): Promise<void> {
        return runMutation('saveSettings', [settings]);
    },

    async updateSettings(updates: Partial<Settings>): Promise<Settings> {
        return runMutation('updateSettings', [updates]);
    },
};
