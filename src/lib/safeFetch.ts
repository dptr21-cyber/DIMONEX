/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * safeFetch.ts
 * Robust network fetch utilities to prevent "SyntaxError: Unexpected token '<'"
 * when endpoints return HTML (such as SPA fallbacks or 404 pages).
 */

export interface SafeFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  aborted?: boolean;
}

export interface SafeFetchOptions {
  retries?: number;
  retryDelayMs?: number;
}

function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: SafeFetchOptions
): Promise<SafeFetchResult<T>> {
  const maxRetries = Math.max(0, options?.retries ?? 0);
  const retryDelayMs = Math.max(50, options?.retryDelayMs ?? 250);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (init?.signal?.aborted) {
      return { ok: false, status: 0, data: null, error: 'Request aborted', aborted: true };
    }

    try {
      const res = await fetch(input, init);
      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        if (isJson) {
          try {
            const errBody = await res.json();
            errMsg = errBody.error || errBody.message || errMsg;
          } catch {
            // ignore parsing error for error bodies
          }
        }
        // Retry transient 502/503/504 gateway errors if retries remain
        if (attempt < maxRetries && (res.status === 502 || res.status === 503 || res.status === 504)) {
          await sleepWithSignal(retryDelayMs * (attempt + 1), init?.signal);
          continue;
        }
        return { ok: false, status: res.status, data: null, error: errMsg };
      }

      if (!isJson) {
        return {
          ok: false,
          status: res.status,
          data: null,
          error: `Expected application/json but received ${contentType || 'non-json'}`
        };
      }

      const data = await res.json();
      return { ok: true, status: res.status, data };
    } catch (err: any) {
      const isAbort =
        init?.signal?.aborted ||
        err?.name === 'AbortError' ||
        (typeof err?.message === 'string' && err.message.toLowerCase().includes('aborted'));
      if (isAbort) {
        return { ok: false, status: 0, data: null, error: 'Request aborted', aborted: true };
      }
      if (attempt < maxRetries) {
        await sleepWithSignal(retryDelayMs * (attempt + 1), init?.signal);
        continue;
      }
      return {
        ok: false,
        status: 0,
        data: null,
        error: err?.message || 'Network error'
      };
    }
  }

  return { ok: false, status: 0, data: null, error: 'Network error' };
}

/**
 * Runs async task factories with a bounded concurrency limit to avoid saturating
 * HTTP/1.1 browser connection pools or preview proxy sockets, preserving tuple types.
 */
export async function runConcurrentTasks<const T extends readonly (() => Promise<any>)[]>(
  tasks: T,
  concurrency = 4
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (tasks.length === 0) return [] as any;
  const limit = Math.max(1, Math.min(concurrency, tasks.length));
  const results = new Array<any>(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

const inFlightRequests = new Map<string, Promise<any>>();

/**
 * Deduplicates concurrent/polling requests sharing the same key so that
 * a new poll tick never queues up behind an already-pending request.
 */
export function runSingleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = task().finally(() => {
    if (inFlightRequests.get(key) === promise) {
      inFlightRequests.delete(key);
    }
  });
  inFlightRequests.set(key, promise);
  return promise;
}

