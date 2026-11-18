import React, { useState } from 'react';
import { FolderInput, Sparkles, Trash2 } from 'lucide-react';
import { Badge, Modal, Button } from '@/components/ui';
import type { Post, Variant } from '@/types';
import { truncateText, formatRelativeTime, countCharacters } from '@/utils';
import { LANGUAGE_CODES } from '@/types';
import { useFoldersStore, usePostsStore } from '@/store';
import { useTranslation } from '@/hooks/useTranslation';

interface MovePostModalProps {
    isOpen: boolean;
    onClose: () => void;
    post: Post;
}

export const MovePostModal: React.FC<MovePostModalProps> = ({ isOpen, onClose, post }) => {
    const { folders } = useFoldersStore();
    const { updatePost } = usePostsStore();
    const { t } = useTranslation();

    const handleMoveToFolder = async (folderId: string | null) => {
        await updatePost(post.id, { folderId });
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('post.move_modal.title')} size="sm">
            <div className="space-y-1.5">
                <button
                    onClick={() => handleMoveToFolder(null)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors
              ${!post.folderId ? 'bg-accent/10 text-accent font-medium' : 'text-text-primary hover:bg-bg-tertiary'}`}
                >
                    {t('post.no_folder')}
                </button>
                {folders.map((folder) => (
                    <button
                        key={folder.id}
                        onClick={() => handleMoveToFolder(folder.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors
                ${post.folderId === folder.id ? 'bg-accent/10 text-accent font-medium' : 'text-text-primary hover:bg-bg-tertiary'}`}
                    >
                        <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: folder.color }}
                        />
                        <span className="truncate">{folder.name}</span>
                    </button>
                ))}
            </div>
            <div className="flex justify-end mt-4">
                <Button variant="ghost" size="sm" onClick={onClose}>
                    {t('actions.cancel')}
                </Button>
            </div>
        </Modal>
    );
};

interface PostCardProps {
    post: Post;
    variants: Variant[];
    onClick: () => void;
}

export const PostCard: React.FC<PostCardProps> = ({ post, variants, onClick }) => {
    const [showMoveModal, setShowMoveModal] = useState(false);
    const { folders } = useFoldersStore();
    const { deletePost } = usePostsStore();
    const { t, language } = useTranslation();

    const languages = [...new Set(variants.filter((v) => v.language).map((v) => v.language!))]
        .map((lang) => LANGUAGE_CODES[lang])
        .slice(0, 4);

    const polishCount = variants.filter((v) => v.type === 'polish').length;
    const charCount = countCharacters(post.sourceContent);

    const statusVariant = {
        draft: 'draft' as const,
        posted: 'posted' as const,
    };

    const statusLabels = {
        draft: t('post.status.draft'),
        posted: t('post.status.posted'),
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(t('post.delete_confirm'))) {
            await deletePost(post.id);
        }
    };

    const currentFolder = folders.find((f) => f.id === post.folderId);

    return (
        <>
            <div
                onClick={onClick}
                className="p-2.5 rounded-xl border border-border-primary bg-bg-primary hover:bg-bg-secondary hover:border-border-secondary flex flex-col gap-1.5 relative overflow-hidden group cursor-pointer transition-colors"
            >
                {/* Header row: status pill + clean monochrome folder label + timestamp */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Badge variant={statusVariant[post.status]}>
                            {statusLabels[post.status]}
                        </Badge>
                        {currentFolder && (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-secondary truncate max-w-[130px]">
                                <span
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{ backgroundColor: currentFolder.color }}
                                />
                                <span className="truncate">{currentFolder.name}</span>
                            </span>
                        )}
                    </div>

                    <span className="text-text-muted text-[11px] whitespace-nowrap shrink-0">
                        {formatRelativeTime(post.updatedAt, language)}
                    </span>
                </div>

                {/* Content preview */}
                <p
                    className={`text-[12.5px] leading-[1.45] line-clamp-2 break-words ${
                        post.sourceContent ? 'text-text-primary' : 'text-text-muted italic'
                    }`}
                >
                    {truncateText(post.sourceContent, 160) || t('post.empty')}
                </p>

                {/* Footer row: compact monochrome badges + char count + quick actions */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-1 flex-wrap min-w-0">
                        {polishCount > 0 && (
                            <span className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-full bg-bg-secondary border border-border-primary text-[10px] font-semibold text-text-secondary">
                                <Sparkles size={9} />
                                <span className="tabular-nums">{polishCount}</span>
                            </span>
                        )}
                        {languages.map((lang) => (
                            <span
                                key={lang}
                                className="inline-flex items-center h-[18px] px-1.5 rounded-full bg-bg-secondary border border-border-primary text-[10px] font-semibold text-text-secondary"
                            >
                                {lang}
                            </span>
                        ))}
                        <span className="text-[11px] text-text-muted tabular-nums ml-0.5">
                            {t('post.chars_count', charCount)}
                        </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMoveModal(true);
                            }}
                            className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                            title={t('post.move_to_folder')}
                            aria-label={t('post.move_to_folder')}
                        >
                            <FolderInput size={12} />
                        </button>
                        <button
                            onClick={handleDelete}
                            className="w-6 h-6 rounded-full inline-flex items-center justify-center text-text-muted hover:text-[#f4212e] hover:bg-[#f4212e]/10 transition-colors"
                            title={t('actions.delete')}
                            aria-label={t('actions.delete')}
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                </div>
            </div>

            <MovePostModal
                isOpen={showMoveModal}
                onClose={() => setShowMoveModal(false)}
                post={post}
            />
        </>
    );
};
