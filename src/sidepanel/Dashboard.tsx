import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Header } from '@/components/layout';
import { PostGrid, FolderModal, DeleteFolderModal } from '@/components/library';
import { Button } from '@/components/ui';
import { Plus, Edit2, Trash2, Search, X, Folder, ChevronDown, Check } from 'lucide-react';
import { QuickTranslate } from './QuickTranslate';
import { FollowersFilter } from './FollowersFilter';
import { usePostsStore, useFoldersStore, useUIStore } from '@/store';
import { useTranslation } from '@/hooks/useTranslation';
import type { LibraryFilter } from '@/types';

interface DashboardProps {
    onNavigateToEditor: (postId?: string) => void;
    onNavigateToSettings: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
    onNavigateToEditor,
    onNavigateToSettings,
}) => {
    const { posts, variants, createPost, setCurrentPost, isLoading } = usePostsStore();
    const { folders } = useFoldersStore();
    const {
        libraryFilter,
        selectedFolderId,
        searchQuery,
        dashboardView,
        setLibraryFilter,
        setSelectedFolderId,
        setSearchQuery,
        openFolderModal,
        openDeleteFolderModal,
    } = useUIStore();
    const { t } = useTranslation();

    const [isFolderOpen, setIsFolderOpen] = useState(false);
    const folderDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isFolderOpen) return;
        const handleOutside = (event: MouseEvent) => {
            if (
                folderDropdownRef.current &&
                !folderDropdownRef.current.contains(event.target as Node)
            ) {
                setIsFolderOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [isFolderOpen]);

    const folderScopedPosts = useMemo(() => {
        return selectedFolderId ? posts.filter((p) => p.folderId === selectedFolderId) : posts;
    }, [posts, selectedFolderId]);

    const filteredPosts = useMemo(() => {
        let result = folderScopedPosts;

        switch (libraryFilter) {
            case 'drafts':
                result = result.filter((p) => p.status === 'draft');
                break;
            case 'posted':
                result = result.filter((p) => p.status === 'posted');
                break;
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter((p) => p.sourceContent.toLowerCase().includes(query));
        }

        return [...result].sort((a, b) => b.updatedAt - a.updatedAt);
    }, [folderScopedPosts, libraryFilter, searchQuery]);

    const draftCount = useMemo(
        () => folderScopedPosts.filter((p) => p.status === 'draft').length,
        [folderScopedPosts],
    );
    const postedCount = useMemo(
        () => folderScopedPosts.filter((p) => p.status === 'posted').length,
        [folderScopedPosts],
    );

    const activeFolder = folders.find((f) => f.id === selectedFolderId) || null;
    const effectiveView =
        dashboardView === 'translate' || dashboardView === 'followers' ? dashboardView : 'posts';

    const handlePostClick = (postId: string) => {
        setCurrentPost(postId);
        onNavigateToEditor(postId);
    };

    const handleCreateNew = async () => {
        const post = await createPost('', selectedFolderId);
        setCurrentPost(post.id);
        onNavigateToEditor(post.id);
    };

    const statusTabs: { id: LibraryFilter; label: string; count: number }[] = [
        { id: 'all', label: t('filter.all'), count: folderScopedPosts.length },
        { id: 'drafts', label: t('filter.drafts'), count: draftCount },
        { id: 'posted', label: t('filter.posted'), count: postedCount },
    ];

    return (
        <div className="flex flex-col h-screen bg-bg-primary text-text-primary">
            <Header onSettings={onNavigateToSettings} />

            <main className="flex-1 overflow-y-auto px-3 py-2.5">
                <div className="max-w-3xl mx-auto w-full">
                    {effectiveView === 'posts' && (
                        <div className="mb-2.5 pb-2.5 border-b border-border-primary space-y-2">
                            {/* Control Bar Row 1: X Search Capsule + Monochrome Primary CTA */}
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1 min-w-0">
                                    <Search
                                        size={13}
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                                    />
                                    <input
                                        type="text"
                                        placeholder={t('dashboard.search')}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full h-8 pl-8 pr-7 bg-bg-secondary border border-border-primary rounded-full text-text-primary placeholder-text-muted text-xs transition-colors duration-150 focus:outline-none focus:bg-bg-primary focus:border-accent"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                            aria-label="Clear search"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                                <Button
                                    onClick={handleCreateNew}
                                    leftIcon={<Plus size={13} strokeWidth={2.5} />}
                                    size="sm"
                                >
                                    {t('actions.create')}
                                </Button>
                            </div>

                            {/* Control Bar Row 2: Segmented Status Switcher (Left) vs Dedicated Folder Dropdown (Right) */}
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                {/* Segmented Status Switcher */}
                                <div className="inline-flex items-center p-0.5 rounded-full bg-bg-secondary border border-border-primary shrink-0">
                                    {statusTabs.map((tab) => {
                                        const active = libraryFilter === tab.id;
                                        return (
                                            <button
                                                key={tab.id}
                                                onClick={() => setLibraryFilter(tab.id)}
                                                className={`h-6 px-2.5 rounded-full text-[11px] transition-colors inline-flex items-center gap-1 ${
                                                    active
                                                        ? 'bg-cta-bg text-cta-text font-bold'
                                                        : 'text-text-secondary hover:text-text-primary font-semibold'
                                                }`}
                                            >
                                                <span>{tab.label}</span>
                                                <span
                                                    className={`text-[10px] tabular-nums ${
                                                        active ? 'opacity-80' : 'text-text-muted'
                                                    }`}
                                                >
                                                    {tab.count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Dedicated Folder Dropdown Selector */}
                                <div className="relative min-w-0" ref={folderDropdownRef}>
                                    <button
                                        type="button"
                                        onClick={() => setIsFolderOpen((prev) => !prev)}
                                        aria-expanded={isFolderOpen}
                                        className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors min-w-0 max-w-[165px] ${
                                            activeFolder
                                                ? 'bg-accent/10 border-accent/45 text-accent'
                                                : 'bg-bg-secondary border-border-primary hover:border-border-secondary text-text-primary'
                                        }`}
                                    >
                                        {activeFolder ? (
                                            <span
                                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                                style={{ backgroundColor: activeFolder.color }}
                                            />
                                        ) : (
                                            <Folder
                                                size={12}
                                                className="shrink-0 text-text-secondary"
                                            />
                                        )}
                                        <span className="truncate">
                                            {activeFolder
                                                ? activeFolder.name
                                                : t('nav.all_folders')}
                                        </span>
                                        <ChevronDown
                                            size={12}
                                            className={`shrink-0 opacity-75 transition-transform ${
                                                isFolderOpen ? 'rotate-180' : ''
                                            }`}
                                        />
                                    </button>

                                    {isFolderOpen && (
                                        <div className="absolute right-0 mt-1.5 w-52 py-1 rounded-xl bg-bg-primary border border-border-primary shadow-2xl z-30">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedFolderId(null);
                                                    setIsFolderOpen(false);
                                                }}
                                                className={`w-full px-3 py-1.5 text-left text-xs transition-colors flex items-center justify-between gap-2 ${
                                                    !selectedFolderId
                                                        ? 'bg-accent/10 text-accent font-semibold'
                                                        : 'text-text-primary hover:bg-bg-secondary'
                                                }`}
                                            >
                                                <span className="inline-flex items-center gap-2 min-w-0">
                                                    <Folder size={12} className="shrink-0" />
                                                    <span className="truncate">
                                                        {t('nav.all_folders')}
                                                    </span>
                                                </span>
                                                {!selectedFolderId && (
                                                    <Check size={12} className="shrink-0" />
                                                )}
                                            </button>

                                            {folders.length > 0 && (
                                                <div className="my-1 border-t border-border-primary" />
                                            )}

                                            {folders.map((folder) => {
                                                const active = selectedFolderId === folder.id;
                                                return (
                                                    <div
                                                        key={folder.id}
                                                        className={`flex items-center justify-between gap-1 px-2 py-0.5 transition-colors ${
                                                            active
                                                                ? 'bg-accent/10'
                                                                : 'hover:bg-bg-secondary'
                                                        }`}
                                                    >
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedFolderId(folder.id);
                                                                setIsFolderOpen(false);
                                                            }}
                                                            className={`flex-1 min-w-0 py-1 px-1 text-left text-xs flex items-center gap-2 ${
                                                                active
                                                                    ? 'text-accent font-semibold'
                                                                    : 'text-text-primary'
                                                            }`}
                                                        >
                                                            <span
                                                                className="w-2 h-2 rounded-full shrink-0"
                                                                style={{
                                                                    backgroundColor: folder.color,
                                                                }}
                                                            />
                                                            <span className="truncate">
                                                                {folder.name}
                                                            </span>
                                                        </button>

                                                        <div className="flex items-center gap-0.5 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setIsFolderOpen(false);
                                                                    openFolderModal(
                                                                        'edit',
                                                                        folder.id,
                                                                    );
                                                                }}
                                                                className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                                                                aria-label={t('actions.edit')}
                                                                title={t('actions.edit')}
                                                            >
                                                                <Edit2 size={11} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setIsFolderOpen(false);
                                                                    openDeleteFolderModal(
                                                                        folder.id,
                                                                    );
                                                                }}
                                                                className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-[#f4212e] hover:bg-[#f4212e]/10 transition-colors"
                                                                aria-label={t('actions.delete')}
                                                                title={t('actions.delete')}
                                                            >
                                                                <Trash2 size={11} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            <div className="my-1 border-t border-border-primary" />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsFolderOpen(false);
                                                    openFolderModal('create');
                                                }}
                                                className="w-full px-3 py-1.5 text-left text-xs font-semibold text-accent hover:bg-bg-secondary transition-colors flex items-center gap-1.5"
                                            >
                                                <Plus size={12} strokeWidth={2.5} />
                                                <span>{t('folder.modal.create_title')}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Content */}
                    {isLoading ? (
                        <div className="flex items-center justify-center h-64">
                            <div className="animate-spin w-7 h-7 border-2 border-accent border-t-transparent rounded-full" />
                        </div>
                    ) : effectiveView === 'translate' ? (
                        <QuickTranslate />
                    ) : effectiveView === 'followers' ? (
                        <FollowersFilter />
                    ) : (
                        <PostGrid
                            posts={filteredPosts}
                            variants={variants}
                            onPostClick={handlePostClick}
                            onCreateNew={handleCreateNew}
                        />
                    )}
                </div>
            </main>

            {/* Modals */}
            <FolderModal />
            <DeleteFolderModal />
        </div>
    );
};
