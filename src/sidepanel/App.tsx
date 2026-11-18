import React, { useState, useEffect } from 'react';
import { Dashboard } from './Dashboard';
import { Editor } from './Editor';
import { Settings } from './Settings';
import { useSettingsStore, usePostsStore, useFoldersStore } from '@/store';
import { applyThemeToDocument } from '@/utils';

type Page = 'dashboard' | 'editor' | 'settings';

export const App: React.FC = () => {
    const [currentPage, setCurrentPage] = useState<Page>('dashboard');
    const loadSettings = useSettingsStore((s) => s.loadSettings);
    const theme = useSettingsStore((s) => s.theme);
    const loadPosts = usePostsStore((s) => s.loadPosts);
    const loadFolders = useFoldersStore((s) => s.loadFolders);

    // Load initial data
    useEffect(() => {
        loadSettings();
        loadPosts();
        loadFolders();
    }, [loadSettings, loadPosts, loadFolders]);

    useEffect(() => {
        applyThemeToDocument(theme);

        if (theme === 'system') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const handleSystemChange = () => applyThemeToDocument('system');
            mediaQuery.addEventListener('change', handleSystemChange);
            return () => mediaQuery.removeEventListener('change', handleSystemChange);
        }
    }, [theme]);

    const navigateToDashboard = () => {
        setCurrentPage('dashboard');
    };

    const navigateToEditor = () => {
        setCurrentPage('editor');
    };

    const navigateToSettings = () => {
        setCurrentPage('settings');
    };

    switch (currentPage) {
        case 'editor':
            return (
                <Editor
                    onNavigateBack={navigateToDashboard}
                    onNavigateToSettings={navigateToSettings}
                />
            );
        case 'settings':
            return <Settings onNavigateBack={navigateToDashboard} />;
        default:
            return (
                <Dashboard
                    onNavigateToEditor={navigateToEditor}
                    onNavigateToSettings={navigateToSettings}
                />
            );
    }
};
