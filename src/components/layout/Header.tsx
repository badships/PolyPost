import React from 'react';
import { ChevronDown, Sun, Moon, Monitor, Settings as SettingsIcon } from 'lucide-react';
import { useUIStore, useSettingsStore, usePostsStore } from '@/store';
import { useTranslation } from '@/hooks/useTranslation';
import { resolveActiveProviderConfig } from '@/services/settingsDefaults';
import type { BuiltInProviderId, DashboardView } from '@/types';

const PROVIDER_SHORT_NAMES: Record<BuiltInProviderId, string> = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    gemini: 'Gemini',
    xai: 'Grok',
    deepseek: 'DeepSeek',
    qwen: 'Qwen',
    kimi: 'Kimi',
    zhipu: 'GLM',
    openrouter: 'OpenRouter',
};

export const PolyPostLogo: React.FC<{ className?: string }> = ({
    className = 'w-[22px] h-[22px]',
}) => (
    <svg
        viewBox="0 0 128 128"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden="true"
    >
        <rect x="4" y="4" width="120" height="120" rx="28" fill="#0A0D12" />
        <rect x="4" y="4" width="120" height="120" rx="28" stroke="#2F3336" strokeWidth="4" />
        {/* Primary crisp white geometric P */}
        <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M34 27H70C85.5 27 96 36.2 96 49.5C96 62.8 85.5 72 70 72H52V101H34V27ZM52 42.5V56.5H68.5C75.2 56.5 79.2 53.6 79.2 49.5C79.2 45.4 75.2 42.5 68.5 42.5H52Z"
            fill="#EFF3F4"
        />
        {/* Accent X-Blue launch wing */}
        <path d="M58 84.5L96 74L83.5 103L75.5 91.5L58 84.5Z" fill="#1D9BF0" />
    </svg>
);

interface HeaderProps {
    onSettings: () => void;
    onNewPost?: () => void;
    showNewPost?: boolean;
    showSearch?: boolean;
    showViewToggle?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onSettings }) => {
    const dashboardView = useUIStore((s) => s.dashboardView);
    const setDashboardView = useUIStore((s) => s.setDashboardView);
    const postsCount = usePostsStore((s) => s.posts.length);

    const uiLanguage = useSettingsStore((s) => s.uiLanguage);
    const setUiLanguage = useSettingsStore((s) => s.setUiLanguage);
    const theme = useSettingsStore((s) => s.theme);
    const setTheme = useSettingsStore((s) => s.setTheme);
    const provider = useSettingsStore((s) => s.provider);
    const providerConfigs = useSettingsStore((s) => s.providerConfigs);
    const customProviders = useSettingsStore((s) => s.customProviders);
    const activeCustomProviderId = useSettingsStore((s) => s.activeCustomProviderId);
    const openaiApiKey = useSettingsStore((s) => s.openaiApiKey);
    const customApiUrl = useSettingsStore((s) => s.customApiUrl);
    const customApiKey = useSettingsStore((s) => s.customApiKey);
    const modelName = useSettingsStore((s) => s.modelName);

    const { t } = useTranslation();

    const activeConfig = resolveActiveProviderConfig({
        provider,
        providerConfigs,
        customProviders,
        activeCustomProviderId,
        openaiApiKey,
        customApiUrl,
        customApiKey,
        modelName,
    });

    const activeCustom =
        customProviders.find((c) => c.id === activeCustomProviderId) || customProviders[0];
    const providerLabel = activeConfig.isCustom
        ? activeCustom?.name || 'Custom'
        : PROVIDER_SHORT_NAMES[activeConfig.provider as BuiltInProviderId] || activeConfig.provider;
    const hasApiKey = Boolean(activeConfig.apiKey);
    const modelBadgeText = activeConfig.modelName
        ? `${providerLabel} · ${activeConfig.modelName}`
        : providerLabel;

    const toggleLanguage = () => {
        void setUiLanguage(uiLanguage === 'zh' ? 'en' : 'zh');
    };

    const cycleTheme = () => {
        const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
        void setTheme(nextTheme);
    };

    const themeIcon =
        theme === 'light' ? (
            <Sun size={14} />
        ) : theme === 'dark' ? (
            <Moon size={14} />
        ) : (
            <Monitor size={14} />
        );

    const themeTitle =
        theme === 'light'
            ? t('settings.theme.light')
            : theme === 'dark'
              ? t('settings.theme.dark')
              : t('settings.theme.system');

    const normalizedView: DashboardView =
        dashboardView === 'translate' || dashboardView === 'followers' ? dashboardView : 'posts';

    const tabs: {
        id: DashboardView;
        label: string;
        badge?: number;
    }[] = [
        {
            id: 'posts',
            label: t('nav.short.posts'),
            badge: postsCount,
        },
        {
            id: 'translate',
            label: t('nav.short.translate'),
        },
        {
            id: 'followers',
            label: t('nav.short.followers'),
        },
    ];

    return (
        <header className="sticky top-0 z-20 bg-bg-primary/85 backdrop-blur-md shrink-0 select-none">
            {/* Top Studio Bar */}
            <div className="h-11 px-3 border-b border-border-primary flex items-center justify-between gap-2">
                {/* Brand + Active AI Pill */}
                <div className="flex items-center gap-2 min-w-0">
                    <PolyPostLogo className="w-[22px] h-[22px] shrink-0" />
                    <span className="text-[13.5px] font-extrabold text-text-primary tracking-tight shrink-0">
                        {t('app.name')}
                    </span>

                    <button
                        onClick={onSettings}
                        title={
                            hasApiKey
                                ? modelBadgeText
                                : `${modelBadgeText} (${t('settings.model_badge.unset')})`
                        }
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-bg-secondary border border-border-primary hover:border-border-secondary text-[11px] text-text-secondary hover:text-text-primary transition-colors min-w-0 max-w-[155px]"
                    >
                        <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                hasApiKey ? 'bg-[#00ba7c]' : 'bg-[#ffd400]'
                            }`}
                        />
                        <span className="truncate">{modelBadgeText}</span>
                        <ChevronDown size={11} className="shrink-0 opacity-75" />
                    </button>
                </div>

                {/* Utility Controls */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={cycleTheme}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                        title={themeTitle}
                        aria-label={themeTitle}
                    >
                        {themeIcon}
                    </button>

                    <button
                        onClick={toggleLanguage}
                        className="h-7 px-2 flex items-center justify-center rounded-full text-[11px] font-bold text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                        title={uiLanguage === 'zh' ? 'Switch to English' : '切换到中文'}
                    >
                        {uiLanguage === 'zh' ? 'EN' : '中'}
                    </button>

                    <button
                        onClick={onSettings}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                        title={t('nav.settings')}
                        aria-label={t('nav.settings')}
                    >
                        <SettingsIcon size={14} />
                    </button>
                </div>
            </div>

            {/* X-Native 3-Tab Underline Navigation */}
            <nav className="h-[38px] border-b border-border-primary grid grid-cols-3 bg-bg-primary">
                {tabs.map((tab) => {
                    const isActive = normalizedView === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setDashboardView(tab.id)}
                            className={`relative flex items-center justify-center gap-1 text-xs transition-colors hover:bg-bg-secondary/60 min-w-0 px-1 ${
                                isActive
                                    ? 'text-text-primary font-bold'
                                    : 'text-text-secondary font-semibold hover:text-text-primary'
                            }`}
                        >
                            <span className="truncate">{tab.label}</span>
                            {tab.badge !== undefined && tab.badge > 0 && (
                                <span className="text-[10.5px] font-medium text-text-muted tabular-nums shrink-0">
                                    {tab.badge}
                                </span>
                            )}
                            {isActive && (
                                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-[3px] rounded-full bg-accent" />
                            )}
                        </button>
                    );
                })}
            </nav>
        </header>
    );
};
