import { create } from 'zustand';
import type { Settings, Language, ProviderId } from '@/types';
import { storage } from '@/services/storage';
import { buildDefaultPrompts, DEFAULT_SETTINGS } from '@/services/settingsDefaults';
import {
    isBuiltInProviderId,
    normalizeModelName,
    normalizeModelNameForProvider,
} from '@/services/models';
import { getWebExt } from '@/services/webext';
import { applyThemeToDocument } from '@/utils';

interface SettingsState extends Settings {
    isLoading: boolean;

    // Actions
    loadSettings: () => Promise<void>;
    updateSettings: (updates: Partial<Settings>) => Promise<void>;
    setOpenaiApiKey: (key: string) => Promise<void>;
    setProvider: (provider: ProviderId) => Promise<void>;
    setCustomApiUrl: (url: string) => Promise<void>;
    setCustomApiKey: (key: string) => Promise<void>;
    setModelName: (modelName: string) => Promise<void>;
    setDefaultLanguage: (language: Language) => Promise<void>;
    setDefaultPolishTemplate: (template: string) => Promise<void>;
    setTheme: (theme: 'dark' | 'light' | 'system') => Promise<void>;
    setUiLanguage: (language: 'en' | 'zh') => Promise<void>;
}

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

const inFlightCounts = new Map<keyof Settings, number>();
const committedMutations = new Map<keyof Settings, { version: number; value: unknown }>();
const fieldMutationSeq = new Map<keyof Settings, number>();
const committedValues = new Map<keyof Settings, unknown>();
let mutationVersion = 0;
let loadSeq = 0;
let hasHydratedOnce = false;

const assignSettingField = (
    target: Partial<Settings>,
    key: keyof Settings,
    value: unknown,
): void => {
    (target as Record<keyof Settings, unknown>)[key] = value;
};

export const useSettingsStore = create<SettingsState>((set, get) => {
    const applySettingsMutation = async (
        fields: (keyof Settings)[],
        optimisticPatch: Partial<Settings>,
        storageOp: () => Promise<Settings>,
    ): Promise<void> => {
        const currentState = get();
        const startLoadSeq = loadSeq;
        const myFieldSeq = new Map<keyof Settings, number>();

        for (const field of fields) {
            const prevCount = inFlightCounts.get(field) ?? 0;
            if (prevCount === 0) {
                committedValues.set(field, currentState[field]);
            }
            inFlightCounts.set(field, prevCount + 1);
            const nextSeq = (fieldMutationSeq.get(field) ?? 0) + 1;
            fieldMutationSeq.set(field, nextSeq);
            myFieldSeq.set(field, nextSeq);
        }

        if (Object.keys(optimisticPatch).length > 0) {
            set(optimisticPatch);
        }

        try {
            const saved = await storageOp();
            const version = ++mutationVersion;
            const latestState = get();
            const nextState: Partial<Settings> = {};
            const fieldSet = new Set<keyof Settings>(fields);

            for (const field of fields) {
                committedValues.set(field, saved[field]);
                const otherCount = Math.max(0, (inFlightCounts.get(field) ?? 1) - 1);
                const isLatestOnField = fieldMutationSeq.get(field) === myFieldSeq.get(field);
                if (isLatestOnField || otherCount === 0) {
                    committedMutations.set(field, { version, value: saved[field] });
                    assignSettingField(nextState, field, saved[field]);
                }
            }

            if (loadSeq === startLoadSeq) {
                for (const key of SETTING_KEYS) {
                    if (fieldSet.has(key)) {
                        continue;
                    }
                    if ((inFlightCounts.get(key) ?? 0) === 0) {
                        committedValues.set(key, saved[key]);
                        assignSettingField(nextState, key, saved[key]);
                    } else {
                        assignSettingField(nextState, key, latestState[key]);
                    }
                }
            }

            if (Object.keys(nextState).length > 0) {
                set(nextState);
            }
        } catch (error) {
            const rollback: Partial<Settings> = {};
            for (const field of fields) {
                const remaining = (inFlightCounts.get(field) ?? 1) - 1;
                if (remaining <= 0) {
                    assignSettingField(rollback, field, committedValues.get(field));
                }
            }
            if (Object.keys(rollback).length > 0) {
                set(rollback);
            }
            throw error;
        } finally {
            for (const field of fields) {
                const nextCount = (inFlightCounts.get(field) ?? 1) - 1;
                if (nextCount <= 0) {
                    inFlightCounts.delete(field);
                } else {
                    inFlightCounts.set(field, nextCount);
                }
            }
        }
    };

    return {
        openaiApiKey: '',
        provider: 'openai',
        customApiUrl: '',
        customApiKey: '',
        modelName: DEFAULT_SETTINGS.modelName,
        providerConfigs: DEFAULT_SETTINGS.providerConfigs,
        customProviders: DEFAULT_SETTINGS.customProviders,
        activeCustomProviderId: DEFAULT_SETTINGS.activeCustomProviderId,
        defaultLanguage: 'en',
        defaultPolishTemplate: 'professional',
        theme: 'dark',
        uiLanguage: 'en',
        prompts: [], // Will be populated on load
        isLoading: false,

        loadSettings: async () => {
            const currentLoadSeq = ++loadSeq;
            const startVersion = mutationVersion;
            if (!hasHydratedOnce) {
                set({ isLoading: true });
            }
            try {
                const settings = await storage.getSettings();
                if (currentLoadSeq !== loadSeq) {
                    return;
                }

                const currentState = get();
                const hydrated: Settings = {
                    ...settings,
                };

                for (const [key, entry] of committedMutations.entries()) {
                    if (entry.version > startVersion) {
                        assignSettingField(hydrated, key, entry.value);
                    }
                }

                for (const key of SETTING_KEYS) {
                    committedValues.set(key, hydrated[key]);
                }

                for (const [key, count] of inFlightCounts.entries()) {
                    if (count > 0) {
                        assignSettingField(hydrated, key, currentState[key]);
                    }
                }

                hasHydratedOnce = true;
                applyThemeToDocument(hydrated.theme);
                set({ ...hydrated, isLoading: false });
            } catch (error) {
                if (currentLoadSeq !== loadSeq) {
                    return;
                }
                console.error('Failed to load settings:', error);
                const currentState = get();
                hasHydratedOnce = true;
                set({
                    prompts:
                        currentState.prompts.length > 0
                            ? currentState.prompts
                            : buildDefaultPrompts(),
                    isLoading: false,
                });
            }
        },

        updateSettings: async (updates: Partial<Settings>) => {
            const targetProvider = updates.provider ?? get().provider;
            const normalizedModel =
                updates.modelName !== undefined
                    ? isBuiltInProviderId(targetProvider)
                        ? normalizeModelNameForProvider(targetProvider, updates.modelName)
                        : normalizeModelName(updates.modelName)
                    : undefined;
            const normalizedUpdates: Partial<Settings> = {
                ...updates,
                ...(normalizedModel !== undefined ? { modelName: normalizedModel } : {}),
            };

            const effectiveKeys = Object.keys(normalizedUpdates) as (keyof Settings)[];
            if (effectiveKeys.length === 0) {
                return;
            }

            await applySettingsMutation(effectiveKeys, normalizedUpdates, () =>
                storage.updateSettings(normalizedUpdates),
            );
        },

        setOpenaiApiKey: async (key: string) => {
            const { providerConfigs } = get();
            const nextProviderConfigs = {
                ...providerConfigs,
                openai: { ...providerConfigs.openai, apiKey: key },
            };
            await applySettingsMutation(
                ['openaiApiKey', 'providerConfigs'],
                { openaiApiKey: key, providerConfigs: nextProviderConfigs },
                () =>
                    storage.updateSettings({
                        openaiApiKey: key,
                        providerConfigs: nextProviderConfigs,
                    }),
            );
        },

        setProvider: async (provider: ProviderId) => {
            await applySettingsMutation(['provider'], { provider }, () =>
                storage.updateSettings({ provider }),
            );
        },

        setCustomApiUrl: async (url: string) => {
            const { customProviders, activeCustomProviderId } = get();
            const nextCustomProviders = customProviders.map((channel) =>
                channel.id === activeCustomProviderId ? { ...channel, baseUrl: url } : channel,
            );
            await applySettingsMutation(
                ['customApiUrl', 'customProviders'],
                { customApiUrl: url, customProviders: nextCustomProviders },
                () =>
                    storage.updateSettings({
                        customApiUrl: url,
                        customProviders: nextCustomProviders,
                    }),
            );
        },

        setCustomApiKey: async (key: string) => {
            const { customProviders, activeCustomProviderId } = get();
            const nextCustomProviders = customProviders.map((channel) =>
                channel.id === activeCustomProviderId ? { ...channel, apiKey: key } : channel,
            );
            await applySettingsMutation(
                ['customApiKey', 'customProviders'],
                { customApiKey: key, customProviders: nextCustomProviders },
                () =>
                    storage.updateSettings({
                        customApiKey: key,
                        customProviders: nextCustomProviders,
                    }),
            );
        },

        setModelName: async (modelName: string) => {
            const { provider, providerConfigs, customProviders, activeCustomProviderId } = get();
            if (isBuiltInProviderId(provider)) {
                const normalizedModelName = normalizeModelNameForProvider(provider, modelName);
                const nextProviderConfigs = {
                    ...providerConfigs,
                    [provider]: {
                        ...providerConfigs[provider],
                        modelName: normalizedModelName,
                    },
                };
                await applySettingsMutation(
                    ['modelName', 'providerConfigs'],
                    { modelName: normalizedModelName, providerConfigs: nextProviderConfigs },
                    () =>
                        storage.updateSettings({
                            modelName: normalizedModelName,
                            providerConfigs: nextProviderConfigs,
                        }),
                );
                return;
            }

            const normalizedModelName = normalizeModelName(modelName);
            const nextCustomProviders = customProviders.map((channel) =>
                channel.id === activeCustomProviderId
                    ? { ...channel, modelName: normalizedModelName }
                    : channel,
            );
            await applySettingsMutation(
                ['modelName', 'customProviders'],
                { modelName: normalizedModelName, customProviders: nextCustomProviders },
                () =>
                    storage.updateSettings({
                        modelName: normalizedModelName,
                        customProviders: nextCustomProviders,
                    }),
            );
        },

        setDefaultLanguage: async (language: Language) => {
            await applySettingsMutation(['defaultLanguage'], { defaultLanguage: language }, () =>
                storage.updateSettings({ defaultLanguage: language }),
            );
        },

        setDefaultPolishTemplate: async (template: string) => {
            await applySettingsMutation(
                ['defaultPolishTemplate'],
                { defaultPolishTemplate: template },
                () => storage.updateSettings({ defaultPolishTemplate: template }),
            );
        },

        setTheme: async (theme: 'dark' | 'light' | 'system') => {
            applyThemeToDocument(theme);
            try {
                await applySettingsMutation(['theme'], { theme }, () =>
                    storage.updateSettings({ theme }),
                );
            } catch (error) {
                console.error('Failed to save theme setting:', error);
            }
        },

        setUiLanguage: async (language: 'en' | 'zh') => {
            await applySettingsMutation(['uiLanguage'], { uiLanguage: language }, () =>
                storage.updateSettings({ uiLanguage: language }),
            );
        },
    };
});

getWebExt()?.storage?.onChanged?.addListener((changes, areaName) => {
    if (
        (areaName === undefined || areaName === 'local' || areaName === 'sync') &&
        changes?.polypost_settings
    ) {
        void useSettingsStore.getState().loadSettings();
    }
});
