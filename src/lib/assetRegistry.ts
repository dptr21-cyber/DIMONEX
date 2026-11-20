/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/lib/assetRegistry.ts
 * Global reactive store for exchange crypto/fiat asset metadata (custom logos, names, decimals, networks).
 * Hydrated from GET /api/markets/assets and updated live via WebSocket `assets_updated` events
 * or immediately when Admin saves changes in Asset Management.
 */

import { useEffect, useState } from 'react';
import { AssetItem } from '../types/index.js';
import { safeFetchJson } from './safeFetch.js';

const assetMap = new Map<string, AssetItem>();
const listeners = new Set<() => void>();

let hasLoadedOnce = false;
let inFlightFetch: Promise<void> | null = null;
let versionCounter = 0;

function notifyListeners() {
  versionCounter += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function hydrateAssetRegistryFromList(assets: AssetItem[]) {
  if (!Array.isArray(assets)) return;
  for (const item of assets) {
    if (item && item.symbol) {
      assetMap.set(item.symbol.toUpperCase(), item);
    }
  }
  hasLoadedOnce = true;
  notifyListeners();
}

export function updateLocalAssetCache(asset: AssetItem) {
  if (!asset || !asset.symbol) return;
  assetMap.set(asset.symbol.toUpperCase(), asset);
  hasLoadedOnce = true;
  notifyListeners();
}

export async function loadAssetRegistry(force = false): Promise<void> {
  if (!force && hasLoadedOnce) return;
  if (inFlightFetch) return inFlightFetch;

  inFlightFetch = (async () => {
    try {
      const res = await safeFetchJson<{ success?: boolean; assets?: AssetItem[] }>('/api/markets/assets');
      if (res.ok && Array.isArray(res.data?.assets)) {
        hydrateAssetRegistryFromList(res.data.assets);
      }
    } catch {
      // keep existing cache on transient network errors
    } finally {
      inFlightFetch = null;
    }
  })();

  return inFlightFetch;
}

export function getAssetMeta(symbol?: string): AssetItem | undefined {
  if (!symbol) return undefined;
  return assetMap.get(symbol.toUpperCase().trim());
}

export function useAssetMeta(symbol?: string): AssetItem | undefined {
  const clean = (symbol || '').toUpperCase().trim();
  const [, setTick] = useState(versionCounter);

  useEffect(() => {
    const onUpdate = () => setTick(versionCounter);
    listeners.add(onUpdate);
    if (!hasLoadedOnce) {
      loadAssetRegistry();
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  return clean ? assetMap.get(clean) : undefined;
}

export function useAssetRegistry(): {
  assets: AssetItem[];
  bySymbol: Map<string, AssetItem>;
  refresh: () => Promise<void>;
} {
  const [, setTick] = useState(versionCounter);

  useEffect(() => {
    const onUpdate = () => setTick(versionCounter);
    listeners.add(onUpdate);
    if (!hasLoadedOnce) {
      loadAssetRegistry();
    }
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  return {
    assets: Array.from(assetMap.values()),
    bySymbol: assetMap,
    refresh: () => loadAssetRegistry(true)
  };
}
