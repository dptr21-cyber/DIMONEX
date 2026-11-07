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
}

export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<SafeFetchResult<T>> {
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
    return {
      ok: false,
      status: 0,
      data: null,
      error: err?.message || 'Network error'
    };
  }
}
