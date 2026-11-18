import React from 'react';
import { Plus, FileText } from 'lucide-react';
import { PostCard } from './PostCard';
import { Button } from '@/components/ui';
import type { Post, Variant } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

interface PostGridProps {
    posts: Post[];
    variants: Variant[];
    onPostClick: (postId: string) => void;
    onCreateNew: () => void;
}

export const PostGrid: React.FC<PostGridProps> = ({
    posts,
    variants,
    onPostClick,
    onCreateNew,
}) => {
    const { t } = useTranslation();

    const getVariantsForPost = (postId: string) => {
        return variants.filter((v) => v.postId === postId);
    };

    if (posts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-10 px-4 border border-dashed border-border-primary rounded-xl bg-bg-secondary/40 text-center">
                <div className="w-9 h-9 rounded-full bg-bg-secondary border border-border-primary flex items-center justify-center text-text-muted mb-2.5">
                    <FileText size={16} />
                </div>
                <p className="text-xs font-bold text-text-primary mb-1">{t('dashboard.empty')}</p>
                <p className="text-[11px] text-text-muted mb-3">{t('dashboard.subtitle')}</p>
                <Button size="sm" onClick={onCreateNew} leftIcon={<Plus size={13} />}>
                    {t('nav.new_post')}
                </Button>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 min-[640px]:grid-cols-2 gap-2 pb-4">
            {posts.map((post) => (
                <PostCard
                    key={post.id}
                    post={post}
                    variants={getVariantsForPost(post.id)}
                    onClick={() => onPostClick(post.id)}
                />
            ))}
        </div>
    );
};
