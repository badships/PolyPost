import { create } from 'zustand';
import type { Settings, Language, PolishPrompt } from '@/types';
import { storage } from '@/services/storage';
import { buildDefaultPrompts, DEFAULT_SETTINGS } from '@/services/settingsDefaults';
import { normalizeModelName } from '@/services/models';
import { getWebExt } from '@/services/webext';

interface SettingsState extends Settings {
    isLoading: boolean;

    // Actions
    loadSettings: () => Promise<void>;
    updateSettings: (updates: Partial<Settings>) => Promise<void>;
    setOpenaiApiKey: (key: string) => Promise<void>;
    setProvider: (provider: 'openai' | 'custom') => Promise<void>;
    setCustomApiUrl: (url: string) => Promise<void>;
    setCustomApiKey: (key: string) => Promise<void>;
    setModelName: (modelName: string) => Promise<void>;
    setDefaultLanguage: (language: Language) => Promise<void>;
    setDefaultPolishTemplate: (template: string) => Promise<void>;
    setTheme: (theme: 'dark' | 'light' | 'system') => Promise<void>;
    setUiLanguage: (language: 'en' | 'zh') => Promise<void>;

    // Prompt Actions
    addPrompt: (prompt: PolishPrompt) => Promise<void>;
    updatePrompt: (prompt: PolishPrompt) => Promise<void>;
    deletePrompt: (id: string) => Promise<void>;
    resetPrompts: () => Promise<void>;
}

const SETTING_KEYS: (keyof Settings)[] = [
    'openaiApiKey',
    'provider',
    'customApiUrl',
    'customApiKey',
    'modelName',
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
        defaultLanguage: 'en',
        defaultPolishTemplate: 'professional',
        theme: 'dark',
        uiLanguage: 'en',
        prompts: [], // Will be populated on load
        isLoading: false,

        loadSettings: async () => {
            const currentLoadSeq = ++loadSeq;
            const startVersion = mutationVersion;
            set({ isLoading: true });
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

                set({ ...hydrated, isLoading: false });
            } catch (error) {
                if (currentLoadSeq !== loadSeq) {
                    return;
                }
                console.error('Failed to load settings:', error);
                const currentState = get();
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
            const normalizedUpdates: Partial<Settings> = {
                ...updates,
                ...(updates.modelName !== undefined
                    ? { modelName: normalizeModelName(updates.modelName) }
                    : {}),
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
            await applySettingsMutation(['openaiApiKey'], { openaiApiKey: key }, () =>
                storage.updateSettings({ openaiApiKey: key }),
            );
        },

        setProvider: async (provider: 'openai' | 'custom') => {
            await applySettingsMutation(['provider'], { provider }, () =>
                storage.updateSettings({ provider }),
            );
        },

        setCustomApiUrl: async (url: string) => {
            await applySettingsMutation(['customApiUrl'], { customApiUrl: url }, () =>
                storage.updateSettings({ customApiUrl: url }),
            );
        },

        setCustomApiKey: async (key: string) => {
            await applySettingsMutation(['customApiKey'], { customApiKey: key }, () =>
                storage.updateSettings({ customApiKey: key }),
            );
        },

        setModelName: async (modelName: string) => {
            const normalizedModelName = normalizeModelName(modelName);
            await applySettingsMutation(['modelName'], { modelName: normalizedModelName }, () =>
                storage.updateSettings({ modelName: normalizedModelName }),
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

        addPrompt: async (prompt: PolishPrompt) => {
            const { prompts } = get();
            const exists = prompts.some((p) => p.id === prompt.id);
            const newPrompts = exists
                ? prompts.map((p) => (p.id === prompt.id ? prompt : p))
                : [...prompts, prompt];
            await applySettingsMutation(['prompts'], { prompts: newPrompts }, () =>
                storage.addPrompt(prompt),
            );
        },

        updatePrompt: async (updatedPrompt: PolishPrompt) => {
            const { prompts } = get();
            const newPrompts = prompts.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p));
            await applySettingsMutation(['prompts'], { prompts: newPrompts }, () =>
                storage.updatePrompt(updatedPrompt),
            );
        },

        deletePrompt: async (id: string) => {
            const { prompts, defaultPolishTemplate } = get();
            if (prompts.length <= 1) {
                throw new Error('Cannot delete the last prompt');
            }
            const newPrompts = prompts.filter((p) => p.id !== id);
            const nextDefaultTemplate =
                defaultPolishTemplate === id
                    ? newPrompts[0]?.id || 'professional'
                    : defaultPolishTemplate;
            await applySettingsMutation(
                ['prompts', 'defaultPolishTemplate'],
                { prompts: newPrompts, defaultPolishTemplate: nextDefaultTemplate },
                () => storage.deletePrompt(id),
            );
        },

        resetPrompts: async () => {
            const { defaultPolishTemplate } = get();
            const defaultPrompts = buildDefaultPrompts();
            const hasCurrentDefault = defaultPrompts.some((p) => p.id === defaultPolishTemplate);
            const nextDefaultTemplate = hasCurrentDefault
                ? defaultPolishTemplate
                : defaultPrompts[0]?.id || 'professional';
            await applySettingsMutation(
                ['prompts', 'defaultPolishTemplate'],
                { prompts: defaultPrompts, defaultPolishTemplate: nextDefaultTemplate },
                () => storage.resetPrompts(),
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
