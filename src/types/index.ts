// ============================================
// Core Data Types for PolyPost
// ============================================

// Post status enum
export type PostStatus = 'draft' | 'posted';

// Variant type enum
export type VariantType = 'polish' | 'translation';

// Polish template names or IDs
export type PolishTemplate = string;
// Was:
// | 'professional'
// | 'viral'
// | 'casual'
// | 'technical'
// | 'emoji'
// | 'concise';

// Supported languages
export type Language = 'en' | 'zh' | 'jp' | 'es' | 'fr' | 'de' | 'ko';

// Language display names
export const LANGUAGE_NAMES: Record<Language, string> = {
    en: 'English',
    zh: '中文',
    jp: '日本語',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    ko: '한국어',
};

// Language short codes for badges
export const LANGUAGE_CODES: Record<Language, string> = {
    en: 'EN',
    zh: 'ZH',
    jp: 'JP',
    es: 'ES',
    fr: 'FR',
    de: 'DE',
    ko: 'KO',
};

// Polish template display names
export const POLISH_TEMPLATE_NAMES: Record<PolishTemplate, string> = {
    professional: 'Professional Polish',
    viral: 'Viral Hook',
    casual: 'Casual Friendly',
    technical: 'Technical Expert',
    emoji: 'Emoji Rich',
    concise: 'Concise Sharp',
};

// ============================================
// Folder
// ============================================
export interface Folder {
    id: string;
    name: string;
    color: string;
    icon?: string;
    createdAt: number;
    updatedAt: number;
}

// ============================================
// Post
// ============================================
export interface Post {
    id: string;
    folderId: string | null;
    sourceContent: string;
    status: PostStatus;
    createdAt: number;
    updatedAt: number;
}

// ============================================
// Variant
// ============================================
export interface Variant {
    id: string;
    postId: string;
    type: VariantType;
    language: Language | null; // Only for translations
    promptTemplate: PolishTemplate | null; // Only for polish
    content: string;
    description: string;
    isSelected: boolean;
    createdAt: number;
}

// ============================================
// Settings
// ============================================
// ============================================
// Prompts
// ============================================
export interface PolishPrompt {
    id: string;
    template: string; // was PolishTemplate, now flexible string ID
    name: string;
    description: string;
    content: string;
}

// ============================================
// Settings
// ============================================
export type BuiltInProviderId =
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'xai'
    | 'deepseek'
    | 'qwen'
    | 'kimi'
    | 'zhipu'
    | 'openrouter';

export type ProviderId = BuiltInProviderId | 'custom';

export type ApiFormat = 'openai' | 'anthropic';

export interface BuiltInProviderSetting {
    apiKey: string;
    modelName: string;
}

export interface CustomProviderConfig {
    id: string;
    name: string;
    apiFormat: ApiFormat;
    baseUrl: string;
    apiKey: string;
    modelName: string;
}

export interface Settings {
    openaiApiKey: string;
    provider: ProviderId;
    customApiUrl?: string;
    customApiKey?: string;
    modelName: string;
    providerConfigs: Record<BuiltInProviderId, BuiltInProviderSetting>;
    customProviders: CustomProviderConfig[];
    activeCustomProviderId: string;
    defaultLanguage: Language;
    defaultPolishTemplate: string; // Changed from PolishTemplate to string to support custom IDs
    theme: 'dark' | 'light' | 'system';
    uiLanguage: 'en' | 'zh';
    prompts: PolishPrompt[];
}

// ============================================
// UI State
// ============================================
export type ViewMode = 'grid' | 'list';
export type LibraryFilter = 'all' | 'drafts' | 'posted';
export type DashboardView = 'posts' | 'translate' | 'followers';

export interface UIState {
    viewMode: ViewMode;
    libraryFilter: LibraryFilter;
    selectedFolderId: string | null;
    searchQuery: string;
    currentPage: 'dashboard' | 'editor' | 'settings';
    dashboardView: DashboardView;
}

// Default folder colors
export const FOLDER_COLORS = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#8B5CF6', // Purple
    '#F59E0B', // Orange
    '#EF4444', // Red
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#84CC16', // Lime
];
