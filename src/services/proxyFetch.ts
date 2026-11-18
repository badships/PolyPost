import { getWebExt } from '@/services/webext';

export type ProxyFetchInit = RequestInit & {
    timeoutMs?: number;
};

type ProxyFetchRequest = {
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

const createAbortError = (message = 'The operation was aborted.'): Error => {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
};

type ProxyFetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
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

const sendProxyFetch = (payload: ProxyFetchRequest): Promise<ProxyFetchResponse> => {
    const webext = getWebExt();
    if (!webext?.runtime?.sendMessage) {
        return Promise.reject(
            new Error('Proxy fetch is unavailable outside the extension runtime.'),
        );
    }

    const g = globalThis as any;
    if (g.browser?.runtime?.sendMessage) {
        return (g.browser.runtime.sendMessage(payload) as Promise<ProxyFetchResponse>).catch(
            (error) => Promise.reject(error),
        );
    }

    return new Promise((resolve, reject) => {
        try {
            webext.runtime.sendMessage(payload as any, (response) => {
                if (webext.runtime.lastError) {
                    reject(new Error(webext.runtime.lastError.message));
                    return;
                }

                resolve(response as ProxyFetchResponse);
            });
        } catch (error) {
            reject(error);
        }
    });
};

export const proxyFetch = async (
    input: RequestInfo | URL,
    init?: ProxyFetchInit,
): Promise<Response> => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) {
        throw createAbortError();
    }

    const timeoutMs =
        typeof init?.timeoutMs === 'number' && init.timeoutMs > 0 ? init.timeoutMs : undefined;
    const redirect: RequestRedirect = init?.redirect ?? 'error';

    const webext = getWebExt();
    if (!webext?.runtime?.sendMessage) {
        const controller = new AbortController();
        let timedOut = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => controller.abort();

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }
        if (timeoutMs !== undefined) {
            timeoutId = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
        }

        try {
            const { timeoutMs: _ignoredTimeout, ...fetchInit } = init ?? {};
            void _ignoredTimeout;
            const rawResponse = await fetch(input, {
                ...fetchInit,
                redirect,
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
        } catch (error) {
            if (timedOut) {
                throw new Error('Request timed out');
            }
            throw error;
        } finally {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
            signal?.removeEventListener('abort', onAbort);
        }
    }

    const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = headersToObject(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const body = await readBody(input, init);

    let abortListener: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const sendPromise = sendProxyFetch({
        type: 'proxyFetch',
        url,
        init: {
            method,
            headers,
            body,
            redirect,
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        },
    });

    const racePromises: Promise<ProxyFetchResponse>[] = [sendPromise];
    if (signal) {
        racePromises.push(
            new Promise<ProxyFetchResponse>((_resolve, reject) => {
                abortListener = () => reject(createAbortError());
                signal.addEventListener('abort', abortListener, { once: true });
            }),
        );
    }
    if (timeoutMs !== undefined) {
        racePromises.push(
            new Promise<ProxyFetchResponse>((_resolve, reject) => {
                timeoutId = setTimeout(
                    () => reject(new Error('Request timed out')),
                    timeoutMs + 250,
                );
            }),
        );
    }

    let response: ProxyFetchResponse;
    try {
        response = await Promise.race(racePromises);
    } finally {
        if (abortListener && signal) {
            signal.removeEventListener('abort', abortListener);
        }
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
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
