/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * EngineTelemetry.ts
 * High-Resolution Real-Time Telemetry Collector for the DIMONEX HFT Matching Engine.
 * Tracks per-second Orders-Per-Second (OPS), sub-millisecond Execution Latency (Avg/P50/P95/P99),
 * and authoritative Maker/Taker Fee Generation grounded 100% in settled trades.
 */

import { db } from '../db/database.js';
import { Trade } from '../db/types.js';
import { fxConversionService } from '../services/external/FxConversionService.js';

export interface TelemetryBucket {
  bucketSec: number; // Epoch ms floored to second
  ordersPlaced: number;
  ordersCancelled: number;
  tradesMatched: number;
  latencySamplesMs: number[];
  makerFeesIdr: number;
  takerFeesIdr: number;
  volumeIdr: number;
}

export interface EngineTelemetrySeriesPoint {
  timestamp: number;
  ordersPerSecond: number;
  cancellationsPerSecond: number;
  tradesPerSecond: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  feeGeneratedIdr: number;
  makerFeeIdr: number;
  takerFeeIdr: number;
  cumulativeFeeIdr: number;
}

export interface PairFeeBreakdown {
  pairId: string;
  baseCurrency: string;
  quoteCurrency: string;
  tradesCount: number;
  makerFeesNative: string;
  takerFeesNative: string;
  totalFeesIdr: number;
  volumeIdr: number;
}

export interface EngineTelemetrySnapshot {
  timestamp: number;
  windowSeconds: number;
  pairFilter: string;
  summary: {
    currentOps: number;
    avgOps: number;
    peakOps: number;
    currentTradesPerSec: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
    totalFeesIdr: number;
    makerFeesIdr: number;
    takerFeesIdr: number;
    windowFeesIdr: number;
    feeRatePerMinIdr: number;
    totalOrdersProcessed: number;
    totalOrdersCancelled: number;
    totalTradesExecuted: number;
    openOrdersCount: number;
    activeBotsCount: number;
  };
  pairBreakdown: PairFeeBreakdown[];
  series: EngineTelemetrySeriesPoint[];
}

class EngineTelemetryCollector {
  private readonly MAX_RETENTION_SEC = 180;
  private buckets: Map<number, TelemetryBucket> = new Map();
  private pairBuckets: Map<string, Map<number, TelemetryBucket>> = new Map();

  // Cumulative counters
  private totalOrdersProcessedSession = 0;
  private totalOrdersCancelledSession = 0;
  private isHydrated = false;

  // Incremental trade scanner state for exact fee totals
  private lastScannedTradeCount = 0;
  private cumulativeMakerFeesIdr = 0;
  private cumulativeTakerFeesIdr = 0;
  private perPairStats: Map<string, {
    tradesCount: number;
    makerFeesUnits: bigint;
    takerFeesUnits: bigint;
    makerFeesIdr: number;
    takerFeesIdr: number;
    volumeIdr: number;
  }> = new Map();

  private floorSecond(tsMs: number): number {
    return Math.floor(tsMs / 1000) * 1000;
  }

  private getOrCreateBucket(map: Map<number, TelemetryBucket>, bucketSec: number): TelemetryBucket {
    let b = map.get(bucketSec);
    if (!b) {
      b = {
        bucketSec,
        ordersPlaced: 0,
        ordersCancelled: 0,
        tradesMatched: 0,
        latencySamplesMs: [],
        makerFeesIdr: 0,
        takerFeesIdr: 0,
        volumeIdr: 0
      };
      map.set(bucketSec, b);
    }
    return b;
  }

  private pruneOldBuckets(nowMs: number) {
    const cutoff = this.floorSecond(nowMs) - this.MAX_RETENTION_SEC * 1000;
    for (const key of this.buckets.keys()) {
      if (key < cutoff) this.buckets.delete(key);
    }
    for (const pairMap of this.pairBuckets.values()) {
      for (const key of pairMap.keys()) {
        if (key < cutoff) pairMap.delete(key);
      }
    }
  }

  private tradeAmountToIdr(pairId: string, quoteUnitsStr: string): number {
    const pair = db.tradingPairs.get(pairId);
    const quoteDec = pair ? pair.quoteDecimals : (pairId.endsWith('-USDT') ? 6 : 2);
    const quoteAmount = Number(BigInt(quoteUnitsStr || '0')) / (10 ** quoteDec);
    if (pair?.quoteCurrency === 'USDT' || pairId.endsWith('-USDT')) {
      const fxRate = fxConversionService.getCurrentRate()?.rate || 16350;
      return quoteAmount * fxRate;
    }
    return quoteAmount;
  }

  /**
   * Synchronize historical trades incrementally so Total Fee Generation
   * always matches 100% of db.trades ledger settlements without double counting.
   */
  private syncTradesIncremental() {
    if (!this.isHydrated) {
      this.isHydrated = true;
      // Seed recent order counts from db.orders within retention window
      const cutoff = Date.now() - this.MAX_RETENTION_SEC * 1000;
      for (const order of db.orders.values()) {
        if (order.createdAt >= cutoff) {
          const sec = this.floorSecond(order.createdAt);
          this.getOrCreateBucket(this.buckets, sec).ordersPlaced += 1;
          let pMap = this.pairBuckets.get(order.pairId);
          if (!pMap) {
            pMap = new Map();
            this.pairBuckets.set(order.pairId, pMap);
          }
          this.getOrCreateBucket(pMap, sec).ordersPlaced += 1;
        }
      }
    }

    // Handle array truncation if db.saveToDisk sliced db.trades
    if (db.trades.length < this.lastScannedTradeCount) {
      this.lastScannedTradeCount = 0;
      this.cumulativeMakerFeesIdr = 0;
      this.cumulativeTakerFeesIdr = 0;
      this.perPairStats.clear();
    }

    const now = Date.now();
    const cutoff = this.floorSecond(now) - this.MAX_RETENTION_SEC * 1000;

    for (let i = this.lastScannedTradeCount; i < db.trades.length; i++) {
      const trade: Trade = db.trades[i];
      const makerUnits = BigInt(trade.makerFee || '0');
      const takerUnits = BigInt(trade.takerFee || '0');
      const makerIdr = this.tradeAmountToIdr(trade.pairId, trade.makerFee || '0');
      const takerIdr = this.tradeAmountToIdr(trade.pairId, trade.takerFee || '0');
      const volIdr = this.tradeAmountToIdr(trade.pairId, trade.quoteVolume || '0');

      this.cumulativeMakerFeesIdr += makerIdr;
      this.cumulativeTakerFeesIdr += takerIdr;

      let pStat = this.perPairStats.get(trade.pairId);
      if (!pStat) {
        pStat = {
          tradesCount: 0,
          makerFeesUnits: 0n,
          takerFeesUnits: 0n,
          makerFeesIdr: 0,
          takerFeesIdr: 0,
          volumeIdr: 0
        };
        this.perPairStats.set(trade.pairId, pStat);
      }
      pStat.tradesCount += 1;
      pStat.makerFeesUnits += makerUnits;
      pStat.takerFeesUnits += takerUnits;
      pStat.makerFeesIdr += makerIdr;
      pStat.takerFeesIdr += takerIdr;
      pStat.volumeIdr += volIdr;

      // Also populate recent 1s bucket for trades/fees if within retention window
      const sec = this.floorSecond(trade.createdAt);
      if (sec >= cutoff) {
        const gb = this.getOrCreateBucket(this.buckets, sec);
        gb.tradesMatched += 1;
        gb.makerFeesIdr += makerIdr;
        gb.takerFeesIdr += takerIdr;
        gb.volumeIdr += volIdr;

        let pMap = this.pairBuckets.get(trade.pairId);
        if (!pMap) {
          pMap = new Map();
          this.pairBuckets.set(trade.pairId, pMap);
        }
        const pb = this.getOrCreateBucket(pMap, sec);
        pb.tradesMatched += 1;
        pb.makerFeesIdr += makerIdr;
        pb.takerFeesIdr += takerIdr;
        pb.volumeIdr += volIdr;
      }
    }

    this.lastScannedTradeCount = db.trades.length;
  }

  /**
   * Called directly from MatchingEngine.placeOrder()
   */
  public recordOrderPlaced(pairId: string, latencyMs: number) {
    const now = Date.now();
    const sec = this.floorSecond(now);
    const safeLatency = Math.max(0.01, Math.round(latencyMs * 1000) / 1000);

    this.totalOrdersProcessedSession += 1;

    const gb = this.getOrCreateBucket(this.buckets, sec);
    gb.ordersPlaced += 1;
    if (gb.latencySamplesMs.length < 500) {
      gb.latencySamplesMs.push(safeLatency);
    }

    let pMap = this.pairBuckets.get(pairId);
    if (!pMap) {
      pMap = new Map();
      this.pairBuckets.set(pairId, pMap);
    }
    const pb = this.getOrCreateBucket(pMap, sec);
    pb.ordersPlaced += 1;
    if (pb.latencySamplesMs.length < 500) {
      pb.latencySamplesMs.push(safeLatency);
    }

    // Sync any newly matched trades immediately
    this.syncTradesIncremental();

    if (this.buckets.size > this.MAX_RETENTION_SEC + 15) {
      this.pruneOldBuckets(now);
    }
  }

  /**
   * Called directly from MatchingEngine.cancelOrder()
   */
  public recordOrderCancelled(pairId: string, latencyMs: number) {
    const now = Date.now();
    const sec = this.floorSecond(now);
    const safeLatency = Math.max(0.01, Math.round(latencyMs * 1000) / 1000);

    this.totalOrdersCancelledSession += 1;

    const gb = this.getOrCreateBucket(this.buckets, sec);
    gb.ordersCancelled += 1;
    if (gb.latencySamplesMs.length < 500) {
      gb.latencySamplesMs.push(safeLatency);
    }

    let pMap = this.pairBuckets.get(pairId);
    if (!pMap) {
      pMap = new Map();
      this.pairBuckets.set(pairId, pMap);
    }
    const pb = this.getOrCreateBucket(pMap, sec);
    pb.ordersCancelled += 1;
    if (pb.latencySamplesMs.length < 500) {
      pb.latencySamplesMs.push(safeLatency);
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  public getTelemetry(windowSeconds = 60, pairFilter = 'ALL'): EngineTelemetrySnapshot {
    this.syncTradesIncremental();

    const now = Date.now();
    this.pruneOldBuckets(now);

    const clampedWindow = Math.min(180, Math.max(15, windowSeconds));
    const currentSec = this.floorSecond(now);
    const startSec = currentSec - (clampedWindow - 1) * 1000;

    const sourceMap = pairFilter !== 'ALL'
      ? (this.pairBuckets.get(pairFilter) || new Map<number, TelemetryBucket>())
      : this.buckets;

    const series: EngineTelemetrySeriesPoint[] = [];
    const allWindowLatencies: number[] = [];

    let sumOps = 0;
    let peakOps = 0;
    let activeOpsSeconds = 0;
    let windowFeesIdr = 0;
    let runningCumulativeWindowFee = 0;

    for (let ts = startSec; ts <= currentSec; ts += 1000) {
      const b = sourceMap.get(ts);
      const ops = b ? (b.ordersPlaced + b.ordersCancelled) : 0;
      const cancels = b ? b.ordersCancelled : 0;
      const tradesPerSec = b ? b.tradesMatched : 0;
      const makerFee = b ? b.makerFeesIdr : 0;
      const takerFee = b ? b.takerFeesIdr : 0;
      const feeGen = makerFee + takerFee;

      sumOps += ops;
      if (ops > peakOps) peakOps = ops;
      if (ops > 0) activeOpsSeconds += 1;

      windowFeesIdr += feeGen;
      runningCumulativeWindowFee += feeGen;

      let avgLat = 0;
      let p95Lat = 0;
      let maxLat = 0;

      if (b && b.latencySamplesMs.length > 0) {
        const sorted = [...b.latencySamplesMs].sort((a, c) => a - c);
        const total = sorted.reduce((acc, v) => acc + v, 0);
        avgLat = Math.round((total / sorted.length) * 1000) / 1000;
        p95Lat = Math.round(this.percentile(sorted, 95) * 1000) / 1000;
        maxLat = Math.round(sorted[sorted.length - 1] * 1000) / 1000;
        allWindowLatencies.push(...sorted);
      }

      series.push({
        timestamp: ts,
        ordersPerSecond: ops,
        cancellationsPerSecond: cancels,
        tradesPerSecond: tradesPerSec,
        avgLatencyMs: avgLat,
        p95LatencyMs: p95Lat,
        maxLatencyMs: maxLat,
        feeGeneratedIdr: Math.round(feeGen * 100) / 100,
        makerFeeIdr: Math.round(makerFee * 100) / 100,
        takerFeeIdr: Math.round(takerFee * 100) / 100,
        cumulativeFeeIdr: Math.round(runningCumulativeWindowFee * 100) / 100
      });
    }

    // Current OPS uses most recent completed second (or active second if higher)
    const lastCompleted = series.length >= 2 ? series[series.length - 2] : series[series.length - 1];
    const currentBucketPt = series[series.length - 1];
    const currentOps = currentBucketPt && currentBucketPt.ordersPerSecond > (lastCompleted?.ordersPerSecond || 0)
      ? currentBucketPt.ordersPerSecond
      : (lastCompleted?.ordersPerSecond || 0);

    const currentTradesPerSec = currentBucketPt && currentBucketPt.tradesPerSecond > (lastCompleted?.tradesPerSecond || 0)
      ? currentBucketPt.tradesPerSecond
      : (lastCompleted?.tradesPerSecond || 0);

    const avgOps = Math.round((sumOps / clampedWindow) * 100) / 100;

    allWindowLatencies.sort((a, b) => a - b);
    const avgLatencyMs = allWindowLatencies.length > 0
      ? Math.round((allWindowLatencies.reduce((a, b) => a + b, 0) / allWindowLatencies.length) * 1000) / 1000
      : 0;
    const p50LatencyMs = Math.round(this.percentile(allWindowLatencies, 50) * 1000) / 1000;
    const p95LatencyMs = Math.round(this.percentile(allWindowLatencies, 95) * 1000) / 1000;
    const p99LatencyMs = Math.round(this.percentile(allWindowLatencies, 99) * 1000) / 1000;
    const maxLatencyMs = allWindowLatencies.length > 0
      ? Math.round(allWindowLatencies[allWindowLatencies.length - 1] * 1000) / 1000
      : 0;

    const feeRatePerMinIdr = Math.round((windowFeesIdr * (60 / clampedWindow)) * 100) / 100;

    // Pair breakdown from authoritative cumulative stats
    const pairBreakdown: PairFeeBreakdown[] = [];
    for (const [pId, stat] of this.perPairStats.entries()) {
      if (pairFilter !== 'ALL' && pId !== pairFilter) continue;
      const pair = db.tradingPairs.get(pId);
      const quoteDec = pair ? pair.quoteDecimals : (pId.endsWith('-USDT') ? 6 : 2);
      const mNative = (Number(stat.makerFeesUnits) / (10 ** quoteDec)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.min(quoteDec, 4)
      });
      const tNative = (Number(stat.takerFeesUnits) / (10 ** quoteDec)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.min(quoteDec, 4)
      });
      pairBreakdown.push({
        pairId: pId,
        baseCurrency: pair?.baseCurrency || pId.split('-')[0],
        quoteCurrency: pair?.quoteCurrency || pId.split('-')[1] || 'IDR',
        tradesCount: stat.tradesCount,
        makerFeesNative: mNative,
        takerFeesNative: tNative,
        totalFeesIdr: Math.round((stat.makerFeesIdr + stat.takerFeesIdr) * 100) / 100,
        volumeIdr: Math.round(stat.volumeIdr)
      });
    }
    pairBreakdown.sort((a, b) => b.totalFeesIdr - a.totalFeesIdr);

    const openOrdersCount = Array.from(db.orders.values()).filter(
      o => (pairFilter === 'ALL' || o.pairId === pairFilter) && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
    ).length;

    const activeBotsCount = Array.from(db.botInstances.values()).filter(
      b => (pairFilter === 'ALL' || b.pairId === pairFilter) && b.status === 'RUNNING'
    ).length;

    const totalMakerIdr = pairFilter === 'ALL'
      ? this.cumulativeMakerFeesIdr
      : (this.perPairStats.get(pairFilter)?.makerFeesIdr || 0);
    const totalTakerIdr = pairFilter === 'ALL'
      ? this.cumulativeTakerFeesIdr
      : (this.perPairStats.get(pairFilter)?.takerFeesIdr || 0);

    return {
      timestamp: now,
      windowSeconds: clampedWindow,
      pairFilter,
      summary: {
        currentOps,
        avgOps,
        peakOps,
        currentTradesPerSec,
        avgLatencyMs,
        p50LatencyMs,
        p95LatencyMs,
        p99LatencyMs,
        maxLatencyMs,
        totalFeesIdr: Math.round((totalMakerIdr + totalTakerIdr) * 100) / 100,
        makerFeesIdr: Math.round(totalMakerIdr * 100) / 100,
        takerFeesIdr: Math.round(totalTakerIdr * 100) / 100,
        windowFeesIdr: Math.round(windowFeesIdr * 100) / 100,
        feeRatePerMinIdr,
        totalOrdersProcessed: Math.max(this.totalOrdersProcessedSession, db.orders.size),
        totalOrdersCancelled: this.totalOrdersCancelledSession,
        totalTradesExecuted: pairFilter === 'ALL'
          ? db.trades.length
          : (this.perPairStats.get(pairFilter)?.tradesCount || 0),
        openOrdersCount,
        activeBotsCount
      },
      pairBreakdown,
      series
    };
  }
}

export const engineTelemetry = new EngineTelemetryCollector();
