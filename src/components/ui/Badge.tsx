import React from 'react';

interface BadgeProps {
    children: React.ReactNode;
    variant?: 'default' | 'draft' | 'posted' | 'language' | 'tag';
    color?: string;
    className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '' }) => {
    const baseStyles =
        'inline-flex items-center px-2 h-5 rounded-full text-[10.5px] font-bold leading-none border';

    const variantStyles = {
        default: 'bg-bg-secondary border-border-primary text-text-primary',
        draft: 'bg-bg-secondary border-border-primary text-text-primary',
        posted: 'bg-status-posted/15 border-status-posted/35 text-status-posted',
        language: 'bg-accent/10 border-accent/45 text-accent',
        tag: 'bg-bg-secondary border-border-primary text-text-primary',
    };

    return (
        <span className={`${baseStyles} ${variantStyles[variant]} ${className}`}>{children}</span>
    );
};
