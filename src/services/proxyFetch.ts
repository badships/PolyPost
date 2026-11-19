import { getWebExt } from '@/services/webext';

export type ProxyFetchInit = RequestInit & {
    timeoutMs?: number;
    deadlineAt?: number;
    forceDirect?: boolean;
};

type ProxyFetchRequest = {
    type: 'proxyFetch';
    requestId: string;
    url: string;
    init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        deadlineAt?: number;
    };
};

type ProxyFetchCancelRequest = {
    type: 'proxyFetchCancel';
    requestId: string;
};

const createAbortError = (message = 'The operation was aborted.'): Error => {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
};

const createRequestId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `pf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

type ProxyFetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    aborted?: boolean;
    timedOut?: boolean;
    headers: Record<string, string>;
    body: string;
};

const headersToObject = (headers?: HeadersInit): Record<string, string> => {
    if (!headers) {
        return {};
    }

    if (headers instanceof Headers) {
        const result: Record<string, string> = {};
        headers.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }

    if (Array.isArray(headers)) {
        return headers.reduce<Record<string, string>>((acc, [key, value]) => {
            acc[key] = value;
            return acc;
        }, {});
    }

    return { ...headers } as Record<string, string>;
};

const readBody = async (
    input: Request | string | URL,
    init?: RequestInit,
): Promise<string | undefined> => {
    if (init?.body) {
        if (typeof init.body === 'string') {
            return init.body;
        }

        if (init.body instanceof URLSearchParams) {
            return init.body.toString();
        }

        if (init.body instanceof ArrayBuffer) {
            return new TextDecoder().decode(init.body);
        }

        if (ArrayBuffer.isView(init.body)) {
            return new TextDecoder().decode(init.body);
        }
    }

    if (input instanceof Request) {
        try {
            return await input.clone().text();
        } catch {
            return undefined;
        }
    }

    return undefined;
};

const sendRuntimeMessage = <TResponse = unknown>(
    payload: ProxyFetchRequest | ProxyFetchCancelRequest,
): Promise<TResponse> => {
    const webext = getWebExt();
    if (!webext?.runtime?.sendMessage) {
        return Promise.reject(
            new Error('Proxy fetch is unavailable outside the extension runtime.'),
        );
    }

    const g = globalThis as any;
    if (g.browser?.runtime?.sendMessage) {
        return (g.browser.runtime.sendMessage(payload) as Promise<TResponse>).catch((error) =>
            Promise.reject(error),
        );
    }

    return new Promise((resolve, reject) => {
        try {
            webext.runtime.sendMessage(payload as any, (response) => {
                if (webext.runtime.lastError) {
                    reject(new Error(webext.runtime.lastError.message));
                    return;
                }

                resolve(response as TResponse);
            });
        } catch (error) {
            reject(error);
        }
    });
};

const sendProxyFetchCancel = (requestId: string): void => {
    void sendRuntimeMessage({
        type: 'proxyFetchCancel',
        requestId,
    }).catch(() => undefined);
};

const raceWithAbortAndDeadline = async <T>(
    workPromise: Promise<T>,
    options: {
        signal?: AbortSignal;
        deadlineAt?: number;
        timeoutBufferMs?: number;
        onAbort?: () => void;
        onTimeout?: () => void;
    },
): Promise<T> => {
    void workPromise.catch(() => undefined);

    const { signal, deadlineAt, timeoutBufferMs = 0, onAbort, onTimeout } = options;
    const racePromises: Promise<T>[] = [workPromise];
    let abortListener: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (signal) {
        racePromises.push(
            new Promise<T>((_resolve, reject) => {
                abortListener = () => {
                    onAbort?.();
                    reject(createAbortError());
                };
                signal.addEventListener('abort', abortListener, { once: true });
            }),
        );
    }

    if (deadlineAt !== undefined) {
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) {
            if (abortListener && signal) {
                signal.removeEventListener('abort', abortListener);
            }
            onTimeout?.();
            throw new Error('Request timed out');
        }
        racePromises.push(
            new Promise<T>((_resolve, reject) => {
                timeoutId = setTimeout(
                    () => {
                        onTimeout?.();
                        reject(new Error('Request timed out'));
                    },
                    Math.max(1, remainingMs + timeoutBufferMs),
                );
            }),
        );
    }

    try {
        return await Promise.race(racePromises);
    } finally {
        if (abortListener && signal) {
            signal.removeEventListener('abort', abortListener);
        }
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    }
};

export const proxyFetch = async (
    input: RequestInfo | URL,
    init?: ProxyFetchInit,
): Promise<Response> => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) {
        throw createAbortError();
    }

    const deadlineAt =
        typeof init?.deadlineAt === 'number' && Number.isFinite(init.deadlineAt)
            ? init.deadlineAt
            : typeof init?.timeoutMs === 'number' &&
                Number.isFinite(init.timeoutMs) &&
                init.timeoutMs > 0
              ? Date.now() + init.timeoutMs
              : undefined;

    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        throw new Error('Request timed out');
    }

    const webext = getWebExt();
    if (init?.forceDirect || !webext?.runtime?.sendMessage) {
        const controller = new AbortController();
        let timedOut = false;

        const {
            timeoutMs: _ignoredTimeout,
            deadlineAt: _ignoredDeadline,
            forceDirect: _ignoredForceDirect,
            redirect: _ignoredRedirect,
            ...fetchInit
        } = init ?? {};
        void _ignoredTimeout;
        void _ignoredDeadline;
        void _ignoredForceDirect;
        void _ignoredRedirect;

        const directWork = (async () => {
            const rawResponse = await fetch(input, {
                ...fetchInit,
                redirect: 'error',
                signal: controller.signal,
            });
            const bodyText = await rawResponse.text();
            const isNullBodyStatus =
                rawResponse.status === 204 ||
                rawResponse.status === 205 ||
                rawResponse.status === 304;
            return new Response(isNullBodyStatus ? null : bodyText, {
                status: rawResponse.status,
                statusText: rawResponse.statusText,
                headers: rawResponse.headers,
            });
        })();

        try {
            return await raceWithAbortAndDeadline(directWork, {
                signal,
                deadlineAt,
                timeoutBufferMs: 0,
                onAbort: () => controller.abort(),
                onTimeout: () => {
                    timedOut = true;
                    controller.abort();
                },
            });
        } catch (error) {
            if (timedOut) {
                throw new Error('Request timed out');
            }
            throw error;
        }
    }

    const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = headersToObject(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );

    const requestId = createRequestId();
    let rpcDispatched = false;

    const sendPromise = (async (): Promise<ProxyFetchResponse> => {
        const body = await readBody(input, init);
        if (signal?.aborted) {
            throw createAbortError();
        }
        if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
            throw new Error('Request timed out');
        }
        rpcDispatched = true;
        return sendRuntimeMessage<ProxyFetchResponse>({
            type: 'proxyFetch',
            requestId,
            url,
            init: {
                method,
                headers,
                body,
                ...(deadlineAt !== undefined ? { deadlineAt } : {}),
            },
        });
    })();

    const cancelIfDispatched = () => {
        if (rpcDispatched) {
            sendProxyFetchCancel(requestId);
        }
    };

    const response = await raceWithAbortAndDeadline(sendPromise, {
        signal,
        deadlineAt,
        timeoutBufferMs: 250,
        onAbort: cancelIfDispatched,
        onTimeout: cancelIfDispatched,
    });

    if (response?.aborted) {
        throw createAbortError(response.statusText || 'Aborted');
    }
    if (
        response?.timedOut ||
        (response?.status === 0 && response.statusText === 'Request timed out')
    ) {
        throw new Error('Request timed out');
    }

    if (!response || response.status < 200 || response.status > 599) {
        throw new TypeError(response?.statusText || 'Network error');
    }

    const isNullBodyStatus =
        response.status === 204 || response.status === 205 || response.status === 304;

    return new Response(isNullBodyStatus ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
};
