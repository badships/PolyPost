// Background service worker for PolyPost WebExtension (Chrome/Firefox/Safari)

import { getActiveTab, getWebExt, openPolyPostWindow } from '@/services/webext';
import { handleStorageRpcMessage } from '@/services/storage';

const webext = getWebExt();
const X_HOSTS = ['x.com', 'twitter.com'];

type FloatingAppActionMessage = {
    type: 'polypost:floating_app';
    action: 'toggle' | 'remove';
};

type FloatingAppActionResponse = {
    ok: boolean;
    visible?: boolean;
    reason?: 'embed_unavailable' | 'not_supported';
};

const isXPage = (url?: string): boolean => {
    if (!url) {
        return false;
    }

    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return X_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return false;
    }
};

const isFirefoxExtension = (): boolean => {
    const baseUrl = webext?.runtime?.getURL?.('') || '';
    return baseUrl.startsWith('moz-extension://');
};

const getSidebarActionApi = () => {
    return (webext as any)?.sidebarAction as { open?: () => Promise<void> } | undefined;
};

const toggleFloatingAppInTab = async (tabId: number): Promise<FloatingAppActionResponse | null> => {
    if (!webext?.tabs?.sendMessage) {
        return null;
    }

    const message: FloatingAppActionMessage = {
        type: 'polypost:floating_app',
        action: 'toggle',
    };

    try {
        const response = (await webext.tabs.sendMessage(tabId, message)) as
            | FloatingAppActionResponse
            | undefined;
        return response || null;
    } catch {
        return null;
    }
};

const handleActionClick = async (clickedTab?: chrome.tabs.Tab) => {
    const sidebarAction = getSidebarActionApi();
    if (isFirefoxExtension() && sidebarAction?.open) {
        try {
            await sidebarAction.open();
            return;
        } catch (error) {
            console.warn('Failed to open Firefox sidebar, falling back to window.', error);
        }
    }

    const tab = clickedTab?.id ? clickedTab : await getActiveTab();
    if (tab?.id && isXPage(tab.url)) {
        const response = await toggleFloatingAppInTab(tab.id);
        if (response?.ok) {
            return;
        }

        if (response?.reason === 'embed_unavailable') {
            await openPolyPostWindow();
            return;
        }
    }

    await openPolyPostWindow();
};

// Open app UI on extension icon click (popup may suppress this if configured).
webext?.action?.onClicked?.addListener((tab) => {
    handleActionClick(tab).catch((error) => {
        console.error('Failed to open PolyPost UI', error);
    });
});

// Chrome side panel behavior (no-op on browsers without sidePanel API).
const sidePanel = (webext as any)?.sidePanel as
    | { setPanelBehavior?: (options: any) => Promise<void> }
    | undefined;
sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {
    // Ignore unsupported errors.
});

// Initialize extension
webext?.runtime?.onInstalled?.addListener((details) => {
    if (details.reason === 'install') {
        console.log('PolyPost extension installed');
    }
});

type ProxyFetchMessage = {
    type: 'proxyFetch';
    url: string;
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        redirect?: RequestRedirect;
        timeoutMs?: number;
    };
};

const isProxyFetchMessage = (message: unknown): message is ProxyFetchMessage => {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as ProxyFetchMessage;
    return candidate.type === 'proxyFetch' && typeof candidate.url === 'string';
};

webext?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    const rpcHandled = handleStorageRpcMessage(message, sender, sendResponse);
    if (rpcHandled !== undefined) {
        return rpcHandled;
    }

    if (!isProxyFetchMessage(message)) {
        return undefined;
    }

    const { url, init } = message;
    if (!/^https?:\/\//i.test(url)) {
        sendResponse({
            ok: false,
            status: 0,
            statusText: 'Invalid URL',
            headers: {},
            body: '',
        });
        return false;
    }

    const controller = new AbortController();
    const timeoutMs =
        typeof init?.timeoutMs === 'number' && init.timeoutMs > 0 ? init.timeoutMs : 60000;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    const requestInit: RequestInit = {
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
        redirect: init?.redirect ?? 'error',
        signal: controller.signal,
    };

    fetch(url, requestInit)
        .then(async (response) => {
            const body = await response.text();
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });

            sendResponse({
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers,
                body,
            });
        })
        .catch((error) => {
            sendResponse({
                ok: false,
                status: 0,
                statusText: timedOut
                    ? 'Request timed out'
                    : error instanceof Error
                      ? error.message
                      : 'Network error',
                headers: {},
                body: '',
            });
        })
        .finally(() => {
            clearTimeout(timeoutId);
        });

    return true;
});

export {};
