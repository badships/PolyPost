import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/globals.css';
import { openPolyPostForCurrentTab } from '@/services/webext';
import { storage } from '@/services/storage';
import { useSettingsStore } from '@/store';
import { useTranslation } from '@/hooks/useTranslation';

const Popup: React.FC = () => {
    const { t } = useTranslation();
    const { loadSettings, theme } = useSettingsStore();
    const [counts, setCounts] = useState({ drafts: 0, scheduled: 0, posted: 0 });

    useEffect(() => {
        void loadSettings();
        storage
            .getPosts()
            .then((posts) => {
                setCounts({
                    drafts: posts.filter((p) => p.status === 'draft').length,
                    scheduled: posts.filter((p) => p.status === 'scheduled').length,
                    posted: posts.filter((p) => p.status === 'posted').length,
                });
            })
            .catch((error) => {
                console.error('Failed to load popup stats:', error);
            });
    }, [loadSettings]);

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        if (theme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            root.classList.add(mediaQuery.matches ? 'dark' : 'light');
            return;
        }
        root.classList.add(theme);
    }, [theme]);

    const openSidePanel = () => {
        openPolyPostForCurrentTab()
            .then(() => {
                window.close();
            })
            .catch((error) => {
                console.error('Failed to open PolyPost', error);
            });
    };

    return (
        <div className="w-72 p-4 bg-bg-primary">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 flex items-center justify-center overflow-hidden rounded-xl">
                    <img
                        src="/icons/icon128.png"
                        alt="PolyPost Logo"
                        className="w-full h-full object-cover"
                    />
                </div>
                <div>
                    <h1 className="text-text-primary font-semibold text-lg">{t('app.name')}</h1>
                    <p className="text-text-muted text-xs">{t('app.description')}</p>
                </div>
            </div>

            {/* Description */}
            <p className="text-text-secondary text-sm mb-4">{t('dashboard.subtitle')}</p>

            {/* Open Side Panel Button */}
            <button
                onClick={openSidePanel}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium text-sm transition-colors"
            >
                {t('app.name')}
            </button>

            {/* Quick Stats */}
            <div className="mt-4 pt-4 border-t border-border-primary grid grid-cols-3 gap-2 text-center">
                <div>
                    <p className="text-accent font-semibold text-lg">{counts.drafts}</p>
                    <p className="text-text-muted text-xs">{t('dashboard.title.drafts')}</p>
                </div>
                <div>
                    <p className="text-status-scheduled font-semibold text-lg">
                        {counts.scheduled}
                    </p>
                    <p className="text-text-muted text-xs">{t('dashboard.title.scheduled')}</p>
                </div>
                <div>
                    <p className="text-status-posted font-semibold text-lg">{counts.posted}</p>
                    <p className="text-text-muted text-xs">{t('dashboard.title.posted')}</p>
                </div>
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Popup />
    </React.StrictMode>,
);
