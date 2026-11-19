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
    requestId?: string;
    url: string;
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        deadlineAt?: number;
        timeoutMs?: number;
    };
};

type ProxyFetchCancelMessage = {
    type: 'proxyFetchCancel';
    requestId: string;
};

const MAX_CANCELED_REQUEST_IDS = 200;
const activeProxyControllers = new Map<
    string,
    { controller: AbortController; markAborted: () => void }
>();
const canceledRequestIds = new Set<string>();

const recordCanceledRequestId = (requestId: string): void => {
    if (canceledRequestIds.has(requestId)) {
        canceledRequestIds.delete(requestId);
    } else if (canceledRequestIds.size >= MAX_CANCELED_REQUEST_IDS) {
        const oldest = canceledRequestIds.values().next().value;
        if (oldest !== undefined) {
            canceledRequestIds.delete(oldest);
        }
    }
    canceledRequestIds.add(requestId);
};

const isProxyFetchMessage = (message: unknown): message is ProxyFetchMessage => {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as ProxyFetchMessage;
    return candidate.type === 'proxyFetch' && typeof candidate.url === 'string';
};

const isProxyFetchCancelMessage = (message: unknown): message is ProxyFetchCancelMessage => {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as ProxyFetchCancelMessage;
    return (
        candidate.type === 'proxyFetchCancel' &&
        typeof candidate.requestId === 'string' &&
        candidate.requestId.length > 0
    );
};

webext?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    const rpcHandled = handleStorageRpcMessage(message, sender, sendResponse);
    if (rpcHandled !== undefined) {
        return rpcHandled;
    }

    const extBaseUrl = webext?.runtime?.getURL?.('');
    const isUnauthorizedSender = Boolean(
        extBaseUrl && sender?.url && !sender.url.startsWith(extBaseUrl),
    );

    if (isProxyFetchCancelMessage(message)) {
        if (isUnauthorizedSender) {
            return false;
        }
        const active = activeProxyControllers.get(message.requestId);
        if (active) {
            active.markAborted();
            active.controller.abort();
            activeProxyControllers.delete(message.requestId);
        } else {
            recordCanceledRequestId(message.requestId);
        }
        return false;
    }

    if (!isProxyFetchMessage(message)) {
        return undefined;
    }

    if (isUnauthorizedSender) {
        sendResponse({
            ok: false,
            status: 0,
            statusText: 'Unauthorized sender',
            headers: {},
            body: '',
        });
        return false;
    }

    const { url, init } = message;
    const requestId =
        typeof message.requestId === 'string' && message.requestId.length > 0
            ? message.requestId
            : undefined;

    if (requestId && canceledRequestIds.has(requestId)) {
        canceledRequestIds.delete(requestId);
        sendResponse({
            ok: false,
            status: 0,
            statusText: 'Aborted',
            aborted: true,
            headers: {},
            body: '',
        });
        return false;
    }

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

    const deadlineAt =
        typeof init?.deadlineAt === 'number' && Number.isFinite(init.deadlineAt)
            ? init.deadlineAt
            : typeof init?.timeoutMs === 'number' &&
                Number.isFinite(init.timeoutMs) &&
                init.timeoutMs > 0
              ? Date.now() + init.timeoutMs
              : undefined;

    if (deadlineAt !== undefined && deadlineAt <= Date.now()) {
        sendResponse({
            ok: false,
            status: 0,
            statusText: 'Request timed out',
            timedOut: true,
            headers: {},
            body: '',
        });
        return false;
    }

    const controller = new AbortController();
    let timedOut = false;
    let abortedByCaller = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (deadlineAt !== undefined) {
        timeoutId = setTimeout(
            () => {
                timedOut = true;
                controller.abort();
            },
            Math.max(1, deadlineAt - Date.now()),
        );
    }

    const activeEntry = requestId
        ? {
              controller,
              markAborted: () => {
                  abortedByCaller = true;
              },
          }
        : undefined;
    if (requestId && activeEntry) {
        activeProxyControllers.set(requestId, activeEntry);
    }

    const requestInit: RequestInit = {
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
        redirect: 'error',
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
                    : abortedByCaller
                      ? 'Aborted'
                      : error instanceof Error
                        ? error.message
                        : 'Network error',
                ...(timedOut ? { timedOut: true } : {}),
                ...(abortedByCaller ? { aborted: true } : {}),
                headers: {},
                body: '',
            });
        })
        .finally(() => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
            if (requestId && activeProxyControllers.get(requestId) === activeEntry) {
                activeProxyControllers.delete(requestId);
            }
        });

    return true;
});

export {};
