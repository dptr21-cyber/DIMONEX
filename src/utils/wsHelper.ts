/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * wsHelper.ts
 * Intelligent WebSocket environment detector and safe connection manager.
 * 
 * Detects serverless hosting platforms (like Vercel) where persistent WebSockets
 * cannot be hosted, and coordinates clean, silent fallback to high-frequency REST polling
 * without generating browser console handshake errors.
 */

let consecutiveWsFailures = 0;
const MAX_WS_FAILURES = 2;

export function isWebSocketSupported(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Detect Vercel serverless environments
  const hostname = (window.location.hostname || '').toLowerCase();
  if (hostname.endsWith('.vercel.app') || hostname === 'vercel.app') {
    return false;
  }

  // 2. Detect session disable flag
  try {
    if (window.sessionStorage && window.sessionStorage.getItem('dimonex_ws_disabled') === 'true') {
      return false;
    }
  } catch {}

  // 3. Consecutive failure threshold
  if (consecutiveWsFailures >= MAX_WS_FAILURES) {
    return false;
  }

  return true;
}

export function reportWebSocketSuccess(): void {
  consecutiveWsFailures = 0;
}

export function reportWebSocketFailure(): void {
  consecutiveWsFailures++;
  if (consecutiveWsFailures >= MAX_WS_FAILURES && typeof window !== 'undefined') {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem('dimonex_ws_disabled', 'true');
      }
    } catch {}
  }
}
