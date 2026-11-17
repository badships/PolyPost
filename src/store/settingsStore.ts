import { create } from 'zustand';
import type { Settings, Language, PolishPrompt } from '@/types';
import { storage } from '@/services/storage';
import { POLISH_PROMPTS, POLISH_TEMPLATE_DESCRIPTIONS } from '@/services/prompts';
import { POLISH_TEMPLATE_NAMES } from '@/types';
import { DEFAULT_SETTINGS } from '@/services/settingsDefaults';
import { normalizeModelName } from '@/services/models';

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

// Helper to generate default prompts from constants
const getDefaultPrompts = (): PolishPrompt[] => {
    return Object.entries(POLISH_PROMPTS).map(([key, content]) => ({
        id: key,
        template: key,
        name: POLISH_TEMPLATE_NAMES[key as keyof typeof POLISH_TEMPLATE_NAMES] || key,
        description:
            POLISH_TEMPLATE_DESCRIPTIONS[key as keyof typeof POLISH_TEMPLATE_DESCRIPTIONS] || '',
        content,
    }));
};

const mutatedFields = new Set<keyof Settings>();

const markMutated = (fields: (keyof Settings)[]) => {
    fields.forEach((field) => mutatedFields.add(field));
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
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
        set({ isLoading: true });
        try {
            const settings = await storage.getSettings();

            const hadEmptyPrompts = !settings.prompts || settings.prompts.length === 0;
            const repairedPrompts = hadEmptyPrompts ? getDefaultPrompts() : settings.prompts;
            const hasValidDefault = repairedPrompts.some(
                (p) => p.id === settings.defaultPolishTemplate,
            );
            const repairedDefaultTemplate = hasValidDefault
                ? settings.defaultPolishTemplate
                : repairedPrompts[0]?.id || 'professional';
            const needsRepair =
                hadEmptyPrompts || repairedDefaultTemplate !== settings.defaultPolishTemplate;

            const currentState = get();
            const hydrated: Settings = {
                ...settings,
                prompts: repairedPrompts,
                defaultPolishTemplate: repairedDefaultTemplate,
            };

            for (const key of mutatedFields) {
                (hydrated as any)[key] = currentState[key];
            }

            // Hydrate memory first so a subsequent repair write failure never blanks the UI.
            set({ ...hydrated, isLoading: false });

            if (
                needsRepair &&
                !mutatedFields.has('prompts') &&
                !mutatedFields.has('defaultPolishTemplate')
            ) {
                try {
                    await storage.updateSettings({
                        prompts: hydrated.prompts,
                        defaultPolishTemplate: hydrated.defaultPolishTemplate,
                    });
                } catch (repairError) {
                    console.warn('Failed to persist repaired default prompts:', repairError);
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
            const currentState = get();
            set({
                prompts:
                    currentState.prompts.length > 0 ? currentState.prompts : getDefaultPrompts(),
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
        markMutated(Object.keys(normalizedUpdates) as (keyof Settings)[]);
        set(normalizedUpdates);
        await storage.updateSettings(normalizedUpdates);
    },

    setOpenaiApiKey: async (key: string) => {
        markMutated(['openaiApiKey']);
        set({ openaiApiKey: key });
        await storage.updateSettings({ openaiApiKey: key });
    },

    setProvider: async (provider: 'openai' | 'custom') => {
        markMutated(['provider']);
        set({ provider });
        await storage.updateSettings({ provider });
    },

    setCustomApiUrl: async (url: string) => {
        markMutated(['customApiUrl']);
        set({ customApiUrl: url });
        await storage.updateSettings({ customApiUrl: url });
    },

    setCustomApiKey: async (key: string) => {
        markMutated(['customApiKey']);
        set({ customApiKey: key });
        await storage.updateSettings({ customApiKey: key });
    },

    setModelName: async (modelName: string) => {
        const normalizedModelName = normalizeModelName(modelName);
        markMutated(['modelName']);
        set({ modelName: normalizedModelName });
        await storage.updateSettings({ modelName: normalizedModelName });
    },

    setDefaultLanguage: async (language: Language) => {
        markMutated(['defaultLanguage']);
        set({ defaultLanguage: language });
        await storage.updateSettings({ defaultLanguage: language });
    },

    setDefaultPolishTemplate: async (template: string) => {
        markMutated(['defaultPolishTemplate']);
        set({ defaultPolishTemplate: template });
        await storage.updateSettings({ defaultPolishTemplate: template });
    },

    setTheme: async (theme: 'dark' | 'light' | 'system') => {
        markMutated(['theme']);
        set({ theme });
        try {
            await storage.updateSettings({ theme });
        } catch (error) {
            console.error('Failed to save theme setting:', error);
        }
    },

    setUiLanguage: async (language: 'en' | 'zh') => {
        markMutated(['uiLanguage']);
        set({ uiLanguage: language });
        await storage.updateSettings({ uiLanguage: language });
    },

    addPrompt: async (prompt: PolishPrompt) => {
        const { prompts } = get();
        const newPrompts = [...prompts, prompt];
        markMutated(['prompts']);
        set({ prompts: newPrompts });
        await storage.updateSettings({ prompts: newPrompts });
    },

    updatePrompt: async (updatedPrompt: PolishPrompt) => {
        const { prompts } = get();
        const newPrompts = prompts.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p));
        markMutated(['prompts']);
        set({ prompts: newPrompts });
        await storage.updateSettings({ prompts: newPrompts });
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
        markMutated(['prompts', 'defaultPolishTemplate']);
        set({ prompts: newPrompts, defaultPolishTemplate: nextDefaultTemplate });
        await storage.updateSettings({
            prompts: newPrompts,
            defaultPolishTemplate: nextDefaultTemplate,
        });
    },

    resetPrompts: async () => {
        const defaultPrompts = getDefaultPrompts();
        markMutated(['prompts']);
        set({ prompts: defaultPrompts });
        await storage.updateSettings({ prompts: defaultPrompts });
    },
}));
