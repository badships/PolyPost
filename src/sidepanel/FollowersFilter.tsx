import React, { useState } from 'react';
import { Button, Card } from '@/components/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { ensureHostPermission } from '@/services/permissions';
import { getWebExt } from '@/services/webext';
import {
    UserMinus,
    UserPlus,
    BadgeCheck,
    RefreshCw,
    ExternalLink,
    Power,
    PowerOff,
    AtSign,
} from 'lucide-react';

type ListType = 'followers' | 'verified_followers' | 'following';
type PanelCopy = {
    title: string;
    filters: {
        fans: string;
        notFollowing: string;
        verified: string;
        unverified: string;
    };
    actions: {
        apply: string;
        reset: string;
    };
    hint: string;
};

const X_HOSTS = ['x.com', 'twitter.com'];

const sanitizeHandleInput = (handle: string) => handle.replace(/^@/, '').trim();

const isXDomain = (url: URL) => {
    const host = url.hostname.toLowerCase();
    return X_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

export const FollowersFilter: React.FC = () => {
    const { t } = useTranslation();
    const [handleInput, setHandleInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [isWorking, setIsWorking] = useState(false);

    const canUseExtension = () => {
        const webext = getWebExt();
        return !!(webext?.runtime?.id && webext.tabs);
    };

    const openListPage = async (listType: ListType) => {
        const handle = sanitizeHandleInput(handleInput);
        if (!handle) {
            return;
        }

        const webext = getWebExt();
        if (!webext?.tabs) {
            setError(t('followers_filter.error.no_extension'));
            return;
        }

        setError(null);
        setStatus(null);
        const url = `https://x.com/${handle}/${listType}`;
        await webext.tabs.create({ url });
    };

    const runScript = async (action: 'inject' | 'remove') => {
        if (!canUseExtension()) {
            setError(t('followers_filter.error.no_extension'));
            return;
        }

        const webext = getWebExt();
        if (!webext?.tabs) {
            setError(t('followers_filter.error.no_extension'));
            return;
        }

        setIsWorking(true);
        setError(null);
        setStatus(null);

        try {
            const [tab] = await webext.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id || !tab.url) {
                setError(t('followers_filter.error.no_tab'));
                return;
            }

            let url: URL;
            try {
                url = new URL(tab.url);
            } catch {
                setError(t('followers_filter.error.invalid_url'));
                return;
            }

            if (!isXDomain(url)) {
                setError(t('followers_filter.error.not_x'));
                return;
            }

            const permissionResult = await ensureHostPermission(url.origin);
            if (!permissionResult.granted) {
                setError(
                    t(
                        'followers_filter.error.permission_denied',
                        permissionResult.origin || url.origin,
                    ),
                );
                return;
            }

            const panelCopy: PanelCopy = {
                title: t('followers_filter.panel.title'),
                filters: {
                    fans: t('followers_filter.panel.fans'),
                    notFollowing: t('followers_filter.panel.not_following'),
                    verified: t('followers_filter.panel.verified'),
                    unverified: t('followers_filter.panel.unverified'),
                },
                actions: {
                    apply: t('followers_filter.panel.apply'),
                    reset: t('followers_filter.panel.reset'),
                },
                hint: t('followers_filter.panel.hint'),
            };

            await webext.tabs.sendMessage(tab.id, {
                type: 'polypost:followers_filter',
                action,
                ...(action === 'inject' ? { copy: panelCopy } : {}),
            });

            setStatus(
                action === 'inject'
                    ? t('followers_filter.status.injected')
                    : t('followers_filter.status.removed'),
            );
        } catch (scriptError) {
            console.error('Followers filter action failed', scriptError);
            setError(t('followers_filter.error.failed'));
        } finally {
            setIsWorking(false);
        }
    };

    const capabilities = [
        {
            icon: <UserMinus size={13} className="text-accent shrink-0" />,
            title: t('followers_filter.cap.unfollowed'),
            sub: t('followers_filter.cap.unfollowed.sub'),
        },
        {
            icon: <UserPlus size={13} className="text-accent shrink-0" />,
            title: t('followers_filter.cap.fans'),
            sub: t('followers_filter.cap.fans.sub'),
        },
        {
            icon: <BadgeCheck size={13} className="text-accent shrink-0" />,
            title: t('followers_filter.cap.verified'),
            sub: t('followers_filter.cap.verified.sub'),
        },
        {
            icon: <RefreshCw size={13} className="text-accent shrink-0" />,
            title: t('followers_filter.cap.auto'),
            sub: t('followers_filter.cap.auto.sub'),
        },
    ];

    const hasHandle = Boolean(sanitizeHandleInput(handleInput));

    return (
        <div className="space-y-2.5 pb-4">
            {error && (
                <div className="px-3 py-2 bg-[#f4212e]/10 border border-[#f4212e]/30 rounded-xl text-[#f4212e] text-xs">
                    {error}
                </div>
            )}

            {status && (
                <div className="px-3 py-2 bg-status-posted/10 border border-status-posted/30 rounded-xl text-status-posted text-xs">
                    {status}
                </div>
            )}

            {/* Card 1: What It Does & 1-Click Toolbar Activation */}
            <Card className="p-3 space-y-2.5 rounded-xl">
                <div className="space-y-1">
                    <h2 className="text-[12.5px] font-bold text-text-primary">
                        {t('followers_filter.hero.title')}
                    </h2>
                    <p className="text-[11px] text-text-secondary leading-relaxed">
                        {t('followers_filter.hero.desc')}
                    </p>
                </div>

                {/* 4 Visual Capability Chips */}
                <div className="grid grid-cols-2 gap-1.5">
                    {capabilities.map((cap) => (
                        <div
                            key={cap.title}
                            className="p-2 rounded-lg bg-bg-primary border border-border-primary flex items-start gap-2 min-w-0"
                        >
                            <div className="mt-0.5">{cap.icon}</div>
                            <div className="min-w-0">
                                <div className="text-[11px] font-bold text-text-primary truncate">
                                    {cap.title}
                                </div>
                                <div className="text-[10px] text-text-muted truncate">
                                    {cap.sub}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Primary Controls */}
                <div className="flex items-center gap-2 pt-0.5">
                    <Button
                        size="md"
                        variant="accent"
                        className="flex-1"
                        leftIcon={<Power size={13} />}
                        onClick={() => void runScript('inject')}
                        isLoading={isWorking}
                    >
                        {t('followers_filter.inject')}
                    </Button>
                    <Button
                        size="md"
                        variant="secondary"
                        leftIcon={<PowerOff size={13} />}
                        onClick={() => void runScript('remove')}
                        disabled={isWorking}
                    >
                        {t('followers_filter.remove')}
                    </Button>
                </div>

                <div className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
                    <ExternalLink size={11} className="shrink-0" />
                    <span>{t('followers_filter.tip_link')}</span>
                </div>
            </Card>

            {/* Card 2: Quick Jump Helper */}
            <Card className="p-3 space-y-2 rounded-xl">
                <div className="space-y-0.5">
                    <h3 className="text-[12px] font-bold text-text-primary">
                        {t('followers_filter.jump.title')}
                    </h3>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                        {t('followers_filter.jump.desc')}
                    </p>
                </div>

                <div className="relative">
                    <AtSign
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                    />
                    <input
                        type="text"
                        value={handleInput}
                        onChange={(event) => setHandleInput(event.target.value)}
                        placeholder={t('followers_filter.handle.placeholder')}
                        className="w-full h-8 pl-8 pr-3 bg-bg-primary border border-border-primary rounded-lg text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                    />
                </div>

                <div className="flex flex-wrap gap-1.5">
                    <button
                        type="button"
                        onClick={() => void openListPage('following')}
                        disabled={!hasHandle}
                        className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-bg-primary border border-border-primary text-text-primary hover:border-border-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('followers_filter.open.following')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void openListPage('followers')}
                        disabled={!hasHandle}
                        className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-bg-primary border border-border-primary text-text-primary hover:border-border-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('followers_filter.open.followers')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void openListPage('verified_followers')}
                        disabled={!hasHandle}
                        className="h-7 px-2.5 rounded-full text-[11px] font-semibold bg-bg-primary border border-border-primary text-text-primary hover:border-border-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t('followers_filter.open.verified_followers')}
                    </button>
                </div>

                <p className="text-[10.5px] text-text-muted leading-relaxed">
                    {t('followers_filter.tip')}
                </p>
            </Card>
        </div>
    );
};
