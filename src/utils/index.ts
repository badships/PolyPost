/**
 * Generate a unique ID
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(timestamp: number, locale: 'en' | 'zh' = 'en'): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (locale === 'zh') {
        if (days > 0) {
            if (days === 1) return '昨天';
            if (days < 7) return `${days} 天前`;
            const date = new Date(timestamp);
            return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        }

        if (hours > 0) return `${hours} 小时前`;
        if (minutes > 0) return `${minutes} 分钟前`;
        return '刚刚';
    }

    if (days > 0) {
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

/**
 * Truncate text to specified length
 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Count characters (Twitter counts differently for some chars)
 */
export function countCharacters(text: string): number {
    // Simplified character count - Twitter has more complex rules
    // For URLs and special characters
    return text.length;
}
