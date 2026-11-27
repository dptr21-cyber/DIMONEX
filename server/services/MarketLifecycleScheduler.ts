/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/MarketLifecycleScheduler.ts
 * Authoritative market lifecycle manager & background scheduler for DIMONEX:
 * 1. Ensures SCHEDULED Initial Listings have a pre-launch TradingPair entry so users can open
 *    the Market Chart and watch the live Launch Countdown Timer before trading opens.
 * 2. Automatically activates SCHEDULED listings when `Date.now() >= listing.scheduledAt`.
 * 3. Manages Market Delisting (Scheduled Delisting with live chart countdown, Immediate Delisting
 *    with atomic order cancellation & ledger refund, Cancel Delist, and Relist).
 */

import crypto from 'crypto';
import { db } from '../db/database.js';
import { ListingRequest, TradingPair } from '../db/types.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { marketWsService } from '../websocket/MarketDataWs.js';
import { ListingActivationService } from './listing/ListingActivationService.js';
import { earnService } from './earn/EarnService.js';

export interface DelistExecutionResult {
  pair: TradingPair;
  cancelledOrdersCount: number;
  stoppedBotsCount: number;
}

/**
 * Ensures a SCHEDULED initial listing has a pre-launch TradingPair entry in `db.tradingPairs`
 * (isActive=false, isHalted=true, scheduledAt=listing.scheduledAt) so the Market & Chart UI
 * can display the pair with a live countdown timer prior to launch.
 */
export function ensureScheduledPairEntry(listing: ListingRequest): TradingPair | null {
  if (listing.status !== 'SCHEDULED') return null;

  const baseAsset = db.assets.get(listing.assetId);
  const quoteAsset = db.assets.get(listing.quoteAssetId);
  if (!baseAsset || !quoteAsset) return null;

  const pairId = `${baseAsset.symbol}-${quoteAsset.symbol}`;
  const existing = db.tradingPairs.get(pairId);

  if (existing) {
    existing.scheduledAt = listing.scheduledAt;
    if (!existing.isActive) {
      existing.isHalted = true;
    }
    db.tradingPairs.set(pairId, existing);
    return existing;
  }

  const pair: TradingPair = {
    id: pairId,
    baseCurrency: baseAsset.symbol,
    quoteCurrency: quoteAsset.symbol,
    baseDecimals: baseAsset.decimals,
    quoteDecimals: quoteAsset.decimals,
    minOrderSize: listing.minQuantity || '100000000',
    maxOrderSize: listing.maxQuantity || (10000000n * (10n ** BigInt(baseAsset.decimals))).toString(),
    makerFeeBps: listing.makerFeeBps ?? 10,
    takerFeeBps: listing.takerFeeBps ?? 20,
    isActive: false,
    isHalted: true,
    isDelisted: false,
    scheduledAt: listing.scheduledAt,
    lastPrice: '0',
    high24h: '0',
    low24h: '0',
    volume24h: '0',
    quoteVolume24h: '0',
    priceChange24h: '+0.00',
    priceChangePercent24h: '0.00'
  };

  db.tradingPairs.set(pairId, pair);
  return pair;
}

/**
 * Schedule a future delisting timestamp for an active market.
 * Displays a live delisting countdown banner in the Market & Chart UI.
 */
export function scheduleDelistMarket(
  pairId: string,
  delistScheduledAt: number,
  actorId: string,
  actorEmail?: string,
  reason?: string
): TradingPair {
  const pair = db.tradingPairs.get(pairId);
  if (!pair) {
    throw new Error(`Trading pair ${pairId} tidak ditemukan.`);
  }
  if (pair.isDelisted) {
    throw new Error(`Trading pair ${pairId} sudah dalam status DELISTED.`);
  }
  if (!Number.isFinite(delistScheduledAt) || delistScheduledAt <= Date.now() + 5000) {
    throw new Error('Waktu jadwal delisting harus berada di masa depan (minimal 5 detik dari sekarang).');
  }

  const cleanReason = String(reason || 'Peninjauan berkala likuiditas & kepatuhan bursa').trim().slice(0, 300);
  pair.delistScheduledAt = Math.floor(delistScheduledAt);
  pair.delistReason = cleanReason;
  db.tradingPairs.set(pair.id, pair);

  db.auditLogs.push({
    id: crypto.randomUUID(),
    actorId,
    action: 'MARKET_DELIST_SCHEDULED',
    resource: `pair:${pair.id}`,
    details: `Delisting pair ${pair.id} dijadwalkan pada ${new Date(pair.delistScheduledAt).toISOString()} oleh ${actorEmail || actorId}. Alasan: ${cleanReason}`,
    createdAt: Date.now()
  });

  db.saveToDisk();
  marketWsService.broadcastTickerSnapshot();
  return pair;
}

/**
 * Cancel a scheduled delisting before it executes.
 */
export function cancelScheduledDelistMarket(
  pairId: string,
  actorId: string,
  actorEmail?: string
): TradingPair {
  const pair = db.tradingPairs.get(pairId);
  if (!pair) {
    throw new Error(`Trading pair ${pairId} tidak ditemukan.`);
  }
  if (pair.isDelisted) {
    throw new Error(`Pair ${pairId} sudah terlanjur DELISTED. Gunakan tombol Relist Market untuk mengaktifkan kembali.`);
  }
  if (!pair.delistScheduledAt) {
    throw new Error(`Pair ${pairId} tidak memiliki jadwal delisting aktif.`);
  }

  pair.delistScheduledAt = undefined;
  pair.delistReason = undefined;
  db.tradingPairs.set(pair.id, pair);

  db.auditLogs.push({
    id: crypto.randomUUID(),
    actorId,
    action: 'MARKET_DELIST_CANCELLED',
    resource: `pair:${pair.id}`,
    details: `Jadwal delisting pair ${pair.id} dibatalkan oleh ${actorEmail || actorId}`,
    createdAt: Date.now()
  });

  db.saveToDisk();
  marketWsService.broadcastTickerSnapshot();
  return pair;
}

/**
 * Execute Market Delisting immediately:
 * 1. Cancel & atomically refund ALL open/partially-filled orders on the pair via MatchingEngine + Ledger.
 * 2. Stop any running automated bots targeting this pair.
 * 3. Mark TradingPair as isDelisted=true, isActive=false, isHalted=true, and Market as CLOSED.
 */
export function executeDelistMarket(
  pairId: string,
  actorId: string,
  actorEmail?: string,
  reason?: string
): DelistExecutionResult {
  const pair = db.tradingPairs.get(pairId);
  if (!pair) {
    throw new Error(`Trading pair ${pairId} tidak ditemukan.`);
  }

  const now = Date.now();
  const cleanReason = String(reason || pair.delistReason || 'Market di-delisting oleh operator bursa').trim().slice(0, 300);

  // 1. Atomically cancel and refund every open resting order on this pair
  let cancelledOrdersCount = 0;
  const openOrdersOnPair = Array.from(db.orders.values()).filter(
    o => o.pairId === pairId && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
  );

  for (const order of openOrdersOnPair) {
    try {
      matchingEngine.cancelOrder(order.id, order.userId, pairId, 'ADMIN');
      cancelledOrdersCount += 1;
    } catch (err: any) {
      // Fallback: if order remained in db.orders with an inconsistent book/pair state, safely mark CANCELLED & unlock
      try {
        const lockedAmt = BigInt(order.lockedAmount || '0');
        const unlockCurr = order.side === 'BUY' ? pair.quoteCurrency : pair.baseCurrency;
        order.status = 'CANCELLED';
        order.lockedAmount = '0';
        order.updatedAt = now;
        db.orders.set(order.id, order);
        if (lockedAmt > 0n) {
          LedgerService.unlockBalanceUpToLocked(order.userId, unlockCurr, lockedAmt);
        }
        cancelledOrdersCount += 1;
      } catch (fallbackErr: any) {
        console.warn(`[MarketLifecycle] Failed to cancel order ${order.id} during delisting of ${pairId}:`, err?.message || err);
      }
    }
  }

  // 2. Stop any running/paused bots on this pair
  let stoppedBotsCount = 0;
  if (db.botInstances && typeof db.botInstances.values === 'function') {
    for (const bot of db.botInstances.values()) {
      if (bot.pairId === pairId && (bot.status === 'RUNNING' || bot.status === 'PAUSED' || bot.status === 'READY')) {
        bot.status = 'STOPPED';
        bot.stoppedAt = now;
        bot.updatedAt = now;
        bot.lastExecutionResult = `Auto-stopped because market ${pairId} was delisted`;
        db.botInstances.set(bot.id, bot);
        stoppedBotsCount += 1;
      }
    }
  }

  // 3. Mark TradingPair as DELISTED
  pair.isActive = false;
  pair.isHalted = true;
  pair.isDelisted = true;
  pair.delistedAt = now;
  pair.delistScheduledAt = undefined;
  pair.delistReason = cleanReason;
  db.tradingPairs.set(pair.id, pair);

  // 4. Close matching Market entity if present
  const market = db.markets.get(pair.id);
  if (market) {
    market.status = 'CLOSED';
    market.updatedAt = now;
    db.markets.set(market.id, market);
  }

  // 4b. Auto-pause Earn vaults if all market pairs for this base asset are now delisted
  const hasRemainingNonDelistedPair = Array.from(db.tradingPairs.values()).some(
    p => p.baseCurrency.toUpperCase() === pair.baseCurrency.toUpperCase() && !p.isDelisted
  );
  if (!hasRemainingNonDelistedPair) {
    earnService.pauseVaultsForAsset(
      pair.baseCurrency,
      actorId,
      `Market ${pair.id} di-delisting`
    );
  }

  // 5. Audit log + persist + broadcast
  db.auditLogs.push({
    id: crypto.randomUUID(),
    actorId,
    action: 'MARKET_DELISTED',
    resource: `pair:${pair.id}`,
    details: `Market ${pair.id} di-DELISTING oleh ${actorEmail || actorId}. Order dibatalkan & direfund: ${cancelledOrdersCount}, Bot dihentikan: ${stoppedBotsCount}. Alasan: ${cleanReason}`,
    createdAt: now
  });

  db.saveToDisk();
  marketWsService.broadcastDepth(pair.id);
  marketWsService.broadcastTickerSnapshot();
  marketWsService.broadcast({
    type: 'MARKET_STATUS_CHANGED',
    data: {
      symbol: pair.id,
      status: 'DELISTED',
      isDelisted: true,
      isHalted: true
    }
  });

  return {
    pair,
    cancelledOrdersCount,
    stoppedBotsCount
  };
}

/**
 * Restore (relist) a previously delisted market back to active trading.
 */
export function relistMarket(
  pairId: string,
  actorId: string,
  actorEmail?: string
): TradingPair {
  const pair = db.tradingPairs.get(pairId);
  if (!pair) {
    throw new Error(`Trading pair ${pairId} tidak ditemukan.`);
  }

  const now = Date.now();
  pair.isDelisted = false;
  pair.delistedAt = undefined;
  pair.delistScheduledAt = undefined;
  pair.delistReason = undefined;
  pair.isActive = true;
  pair.isHalted = false;
  db.tradingPairs.set(pair.id, pair);

  const market = db.markets.get(pair.id);
  if (market) {
    market.status = 'ACTIVE';
    market.updatedAt = now;
    db.markets.set(market.id, market);
  }

  db.auditLogs.push({
    id: crypto.randomUUID(),
    actorId,
    action: 'MARKET_RELISTED',
    resource: `pair:${pair.id}`,
    details: `Market ${pair.id} diaktifkan kembali (RELISTED) oleh ${actorEmail || actorId}`,
    createdAt: now
  });

  db.saveToDisk();
  marketWsService.broadcastTickerSnapshot();
  return pair;
}

class MarketLifecycleScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;

  start() {
    if (this.timer) return;

    // Hydrate pre-launch TradingPair entries for any existing SCHEDULED listings on boot
    for (const listing of db.listingRequests.values()) {
      if (listing.status === 'SCHEDULED') {
        ensureScheduledPairEntry(listing);
      }
    }

    this.timer = setInterval(() => {
      this.tick().catch(err => {
        console.error('[MarketLifecycleScheduler] Tick error:', err?.message || err);
      });
    }, 3000);

    console.log('[DIMONEX] MarketLifecycleScheduler started (3s interval for scheduled listings & delistings)');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const now = Date.now();

      // 1. Auto-activate SCHEDULED initial listings whose countdown reached zero
      for (const listing of db.listingRequests.values()) {
        if (listing.status === 'SCHEDULED' && listing.scheduledAt && now >= listing.scheduledAt) {
          try {
            const idempKey = `sched-auto-act:${listing.id}:v${listing.version}:${listing.scheduledAt}`;
            const result = await ListingActivationService.activateMarket(
              listing.id,
              'SYSTEM_SCHEDULER',
              idempKey,
              { ip: '127.0.0.1', userAgent: 'MarketLifecycleScheduler', authRole: 'SYSTEM' }
            );
            // Clear pre-launch scheduledAt flag on active pair & notify clients
            const pair = db.tradingPairs.get(result.market.symbol);
            if (pair) {
              pair.isActive = true;
              pair.isHalted = false;
              pair.scheduledAt = undefined;
              db.tradingPairs.set(pair.id, pair);
            }
            db.saveToDisk();
            marketWsService.broadcastTickerSnapshot();
            console.log(`[MarketLifecycleScheduler] Auto-activated scheduled listing ${result.market.symbol}`);
          } catch (err: any) {
            console.warn(`[MarketLifecycleScheduler] Auto-activation skipped for ${listing.id}:`, err?.message || err);
          }
        }
      }

      // 2. Auto-execute SCHEDULED market delistings whose countdown reached zero
      for (const pair of db.tradingPairs.values()) {
        if (!pair.isDelisted && pair.delistScheduledAt && now >= pair.delistScheduledAt) {
          try {
            const res = executeDelistMarket(
              pair.id,
              'SYSTEM_SCHEDULER',
              'system-scheduler@dimonex.id',
              pair.delistReason || 'Jadwal delisting otomatis tercapai'
            );
            console.log(
              `[MarketLifecycleScheduler] Auto-delisted ${pair.id} (cancelled ${res.cancelledOrdersCount} orders, stopped ${res.stoppedBotsCount} bots)`
            );
          } catch (err: any) {
            console.warn(`[MarketLifecycleScheduler] Auto-delist failed for ${pair.id}:`, err?.message || err);
          }
        }
      }
    } finally {
      this.isTicking = false;
    }
  }
}

export const marketLifecycleScheduler = new MarketLifecycleScheduler();
