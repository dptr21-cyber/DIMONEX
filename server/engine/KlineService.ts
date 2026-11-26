/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * KlineService.ts
 * Authoritative Candlestick (OHLCV) Aggregator & Persistent Kline Engine for DIMONEX.
 * 
 * Guarantees:
 * - 100% Real Trade-Grounded: No mock candles, no fake bars, no synthetic sine-wave candles.
 * - Candles are produced strictly from actual executed trades matched by the exchange engine.
 * - Gap Policy: Intervals with no trades create zero-volume continuation candles bounded only between real trades.
 * - Idempotent replay: Replaying the same trade event updates existing intervals accurately without duplicate volume.
 * - Persistent to disk across server restarts and timeframe switches.
 */

import fs from 'fs';
import path from 'path';
import { Trade, TradingPair } from '../db/types.js';
import { db, getExchangeDataDirectory } from '../db/database.js';

export interface Candle {
  time: number; // Unix timestamp in seconds (aligned to timeframe interval)
  open: number; // In Rupiah (or quote unit)
  high: number;
  low: number;
  close: number;
  volume: number; // In Base currency unit
}

export type Timeframe = 
  | '1m' 
  | '3m' 
  | '5m' 
  | '15m' 
  | '30m' 
  | '1h' 
  | '2h' 
  | '4h' 
  | '6h' 
  | '12h' 
  | '1D' 
  | '1W' 
  | '1M';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '6h': 21600,
  '12h': 43200,
  '1D': 86400,
  '1W': 604800,
  '1M': 2592000,
};

export class KlineService {
  // key: `${pairId}:${timeframe}` -> Candle[]
  private klineStore: Map<string, Candle[]> = new Map();
  private processedTradeIds: Set<string> = new Set();
  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private isSavingAsync = false;

  constructor() {
    const loaded = this.loadFromDisk();
    if (!loaded) {
      this.rebuildFromDbTrades();
      this.saveToDisk();
    }
  }

  private fastStringify(obj: unknown): string {
    try {
      return JSON.stringify(obj);
    } catch {
      return JSON.stringify(obj, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );
    }
  }

  private buildPayloadObject(): Record<string, Candle[]> {
    const obj: Record<string, Candle[]> = {};
    for (const [k, v] of this.klineStore.entries()) {
      // Keep maximum 1,000 candles per timeframe series to keep file compact
      obj[k] = v.length > 1000 ? v.slice(-1000) : v;
    }
    return obj;
  }

  private getTargetFilePaths(): string[] {
    const dir = getExchangeDataDirectory();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const primary = path.join(dir, 'klines_state.json');
    const targetFiles = [primary];

    const bundledDir = path.resolve(process.cwd(), 'server', 'data');
    if (path.resolve(dir) !== path.resolve(bundledDir) && fs.existsSync(bundledDir)) {
      const mirror = path.join(bundledDir, 'klines_state.json');
      if (mirror !== primary) {
        targetFiles.push(mirror);
      }
    }
    return targetFiles;
  }

  public scheduleSave() {
    this.isDirty = true;
    if (process.env.VERCEL === '1') {
      this.saveToDisk();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveToDiskAsync();
    }, 15_000);
    if (typeof this.saveTimer.unref === 'function') {
      this.saveTimer.unref();
    }
  }

  public async saveToDiskAsync(): Promise<boolean> {
    if (!this.isDirty && this.klineStore.size > 0) return true;
    if (this.isSavingAsync) return false;
    this.isSavingAsync = true;
    this.isDirty = false;
    try {
      const jsonStr = this.fastStringify(this.buildPayloadObject());
      const targetFiles = this.getTargetFilePaths();
      for (const filePath of targetFiles) {
        try {
          const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
          await fs.promises.writeFile(tempFile, jsonStr, 'utf-8');
          try {
            await fs.promises.rename(tempFile, filePath);
          } catch {
            await fs.promises.copyFile(tempFile, filePath);
            try { await fs.promises.unlink(tempFile); } catch {}
          }
        } catch {
          // Continue to next path
        }
      }
      return true;
    } catch (e) {
      console.error('[KlineService] Gagal menyimpan klines secara asinkron:', e);
      return false;
    } finally {
      this.isSavingAsync = false;
      if (this.isDirty && !this.saveTimer) {
        this.scheduleSave();
      }
    }
  }

  public saveToDisk(): boolean {
    try {
      this.isDirty = false;
      const jsonStr = this.fastStringify(this.buildPayloadObject());
      const targetFiles = this.getTargetFilePaths();

      for (const filePath of targetFiles) {
        try {
          const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
          fs.writeFileSync(tempFile, jsonStr, 'utf-8');
          try {
            fs.renameSync(tempFile, filePath);
          } catch {
            fs.copyFileSync(tempFile, filePath);
            try { fs.unlinkSync(tempFile); } catch {}
          }
        } catch {
          // Continue to next path
        }
      }
      return true;
    } catch (e) {
      console.error('[KlineService] Gagal menyimpan klines ke disk:', e);
      return false;
    }
  }

  public loadFromDisk(): boolean {
    try {
      const dir = getExchangeDataDirectory();
      const bundledDir = path.resolve(process.cwd(), 'server', 'data');
      const candidatePaths = [
        path.join(dir, 'klines_state.json'),
        path.join(bundledDir, 'klines_state.json')
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          try {
            const raw = fs.readFileSync(p, 'utf-8');
            if (!raw || raw.trim().length === 0) continue;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') continue;
            this.klineStore.clear();
            let totalCandles = 0;
            for (const [k, v] of Object.entries(obj)) {
              if (Array.isArray(v)) {
                const candles = v.length > 1000 ? (v as Candle[]).slice(-1000) : (v as Candle[]);
                this.klineStore.set(k, candles);
                totalCandles += candles.length;
              }
            }
            console.log(`[KlineService] Memuat ${this.klineStore.size} timeframe candle riil dari disk (${totalCandles} candle total dari ${p})`);
            return true;
          } catch (readErr) {
            console.warn(`[KlineService] Gagal membaca ${p}:`, readErr);
          }
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  private getKey(pairId: string, timeframe: string): string {
    return `${pairId}:${timeframe}`;
  }

  /**
   * Rebuild all timeframe candles from actual trades stored in the database.
   * Completely replaces any in-memory state with authoritative historical trades.
   */
  public rebuildFromDbTrades(customTrades?: Trade[]) {
    this.klineStore.clear();
    this.processedTradeIds.clear();

    const tradesToProcess = customTrades || db.trades || [];
    const sortedTrades = [...tradesToProcess].sort((a, b) => a.createdAt - b.createdAt);

    for (const trade of sortedTrades) {
      this.processTrade(trade);
    }
  }

  /**
   * Process an incoming executed Trade into all timeframe candles.
   * Strictly aggregates real executed volume and price action.
   */
  public processTrade(trade: Trade) {
    const pair = db.tradingPairs.get(trade.pairId);
    if (!pair) return;

    const timeframes: Timeframe[] = [
      '1m', '3m', '5m', '15m', '30m', 
      '1h', '2h', '4h', '6h', '12h', 
      '1D', '1W', '1M'
    ];
    const quoteDec = pair.quoteDecimals !== undefined && pair.quoteDecimals !== null ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const tradePrice = Number(BigInt(trade.price || '0')) / (10 ** quoteDec);
    const tradeQty = Number(trade.quantity || '0') / (10 ** pair.baseDecimals);
    const tradeSec = Math.floor(trade.createdAt / 1000);

    const isDuplicate = this.processedTradeIds.has(trade.id);
    this.processedTradeIds.add(trade.id);
    if (this.processedTradeIds.size > 5000) {
      const arr = Array.from(this.processedTradeIds);
      this.processedTradeIds = new Set(arr.slice(-2500));
    }

    for (const tf of timeframes) {
      const interval = TIMEFRAME_SECONDS[tf];
      const candleTime = Math.floor(tradeSec / interval) * interval;
      const key = this.getKey(trade.pairId, tf);

      let candles = this.klineStore.get(key);
      if (!candles) {
        candles = [];
        this.klineStore.set(key, candles);
      }

      const lastCandle = candles[candles.length - 1];

      if (!lastCandle) {
        // First real trade candle
        candles.push({
          time: candleTime,
          open: tradePrice,
          high: tradePrice,
          low: tradePrice,
          close: tradePrice,
          volume: isDuplicate ? 0 : tradeQty
        });
      } else if (lastCandle.time === candleTime) {
        // Update current candle bounds
        lastCandle.high = Math.max(lastCandle.high, tradePrice);
        lastCandle.low = Math.min(lastCandle.low, tradePrice);
        lastCandle.close = tradePrice;
        if (!isDuplicate) {
          lastCandle.volume = Number((lastCandle.volume + tradeQty).toFixed(6));
        }
      } else if (candleTime > lastCandle.time) {
        // Gap filling between trades: flat continuation with 0 volume
        const maxGapBars = 50;
        let gapCount = 0;
        for (let t = lastCandle.time + interval; t < candleTime && gapCount < maxGapBars; t += interval) {
          candles.push({
            time: t,
            open: lastCandle.close,
            high: lastCandle.close,
            low: lastCandle.close,
            close: lastCandle.close,
            volume: 0
          });
          gapCount++;
        }

        // New active candle with trade execution
        candles.push({
          time: candleTime,
          open: lastCandle.close,
          high: Math.max(lastCandle.close, tradePrice),
          low: Math.min(lastCandle.close, tradePrice),
          close: tradePrice,
          volume: isDuplicate ? 0 : tradeQty
        });

        // Limit memory footprint to last 500 candles per timeframe
        if (candles.length > 500) {
          candles.splice(0, candles.length - 500);
        }
      } else {
        // Historical / late trade inserted into older candle
        const existing = candles.find(c => c.time === candleTime);
        if (existing) {
          existing.high = Math.max(existing.high, tradePrice);
          existing.low = Math.min(existing.low, tradePrice);
          if (!isDuplicate) {
            existing.volume = Number((existing.volume + tradeQty).toFixed(6));
          }
        }
      }
    }
    this.scheduleSave();
  }

  /**
   * Build exact historical candles for a single timeframe on-demand from db.trades
   * (supports deep left-scroll pagination even when klineStore tail is capped).
   */
  private buildCandlesForTimeframeFromTrades(pairId: string, tf: Timeframe): Candle[] {
    const pair = db.tradingPairs.get(pairId);
    if (!pair) return [];
    const pairTrades = (db.trades || [])
      .filter(t => t.pairId === pairId)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (pairTrades.length === 0) return [];

    const quoteDec =
      pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
        ? pair.quoteDecimals
        : pair.quoteCurrency === 'USDT'
        ? 6
        : 2;
    const interval = TIMEFRAME_SECONDS[tf];
    const map = new Map<number, Candle>();
    const seenIds = new Set<string>();
    let prevClose: number | null = null;

    for (const trade of pairTrades) {
      if (seenIds.has(trade.id)) continue;
      seenIds.add(trade.id);
      const price = Number(BigInt(trade.price || '0')) / (10 ** quoteDec);
      const qty = Number(trade.quantity || '0') / (10 ** pair.baseDecimals);
      const tradeSec = Math.floor(trade.createdAt / 1000);
      const candleTime = Math.floor(tradeSec / interval) * interval;

      let existing = map.get(candleTime);
      if (!existing) {
        const open: number = prevClose !== null ? prevClose : price;
        existing = {
          time: candleTime,
          open,
          high: Math.max(open, price),
          low: Math.min(open, price),
          close: price,
          volume: qty,
        };
        map.set(candleTime, existing);
      } else {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
        existing.volume = Number((existing.volume + qty).toFixed(6));
      }
      prevClose = existing.close;
    }

    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Get historical and current candles for a pair and timeframe.
   * Returns empty array if no trades have executed yet for this pair.
   */
  public getCandles(pairId: string, tfStr: string = '15m', limit = 150): Candle[] {
    const tf = this.normalizeResolution(tfStr);
    const key = this.getKey(pairId, tf);
    let candles = this.klineStore.get(key);

    if (!candles || candles.length === 0) {
      // Check if db has trades for this pair that haven't been ingested yet
      const pairTrades = db.trades.filter(t => t.pairId === pairId);
      if (pairTrades.length > 0) {
        this.rebuildFromDbTrades();
        candles = this.klineStore.get(key) || [];
      } else {
        return [];
      }
    }

    return candles.slice(-limit);
  }

  /**
   * Maps TradingView standard resolutions ('1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M')
   * to internal Timeframe enum.
   */
  public normalizeResolution(res: string): Timeframe {
    if (!res) return '15m';
    const clean = res.trim();
    switch (clean) {
      case '1':
      case '1m':
        return '1m';
      case '3':
      case '3m':
        return '3m';
      case '5':
      case '5m':
        return '5m';
      case '15':
      case '15m':
        return '15m';
      case '30':
      case '30m':
        return '30m';
      case '60':
      case '1h':
      case '60m':
        return '1h';
      case '120':
      case '2h':
      case '120m':
        return '2h';
      case '240':
      case '4h':
      case '240m':
        return '4h';
      case '360':
      case '6h':
      case '360m':
        return '6h';
      case '720':
      case '12h':
      case '720m':
        return '12h';
      case 'D':
      case '1D':
      case '1d':
      case '86400':
        return '1D';
      case 'W':
      case '1W':
      case '1w':
      case '604800':
        return '1W';
      case 'M':
      case '1M':
      case '1mth':
      case '1mo':
      case '2592000':
        return '1M';
      default:
        return '15m';
    }
  }

  /**
   * TradingView Datafeed & Pro Chart compliant getBars method.
   * Supports filtering by from/to Unix seconds, left-scroll pagination from full db.trades history, and limit.
   */
  public getBars(pairId: string, resolution: string = '15m', fromSec?: number, toSec?: number, limit = 300): Candle[] {
    const tf = this.normalizeResolution(resolution);
    const key = this.getKey(pairId, tf);
    let candles = this.klineStore.get(key);

    if (!candles || candles.length === 0) {
      const pairTrades = db.trades.filter(t => t.pairId === pairId);
      if (pairTrades.length > 0) {
        this.rebuildFromDbTrades();
        candles = this.klineStore.get(key) || [];
      } else {
        return [];
      }
    }

    // If caller requests earlier history than what is cached in memory tail, query full db.trades history
    let source = candles;
    if (
      candles.length > 0 &&
      ((toSec !== undefined && toSec < candles[0].time) ||
        (fromSec !== undefined && fromSec < candles[0].time))
    ) {
      const historicalAll = this.buildCandlesForTimeframeFromTrades(pairId, tf);
      if (historicalAll.length > 0) {
        const merged = new Map<number, Candle>();
        for (const c of historicalAll) merged.set(c.time, c);
        for (const c of candles) merged.set(c.time, c);
        source = Array.from(merged.values()).sort((a, b) => a.time - b.time);
      }
    }

    let result = source;
    if (fromSec !== undefined && toSec !== undefined) {
      result = source.filter(c => c.time >= fromSec && c.time <= toSec);
    } else if (fromSec !== undefined) {
      result = source.filter(c => c.time >= fromSec);
    } else if (toSec !== undefined) {
      result = source.filter(c => c.time <= toSec);
    }

    if (limit && limit > 0 && result.length > limit) {
      return result.slice(-limit);
    }

    return result;
  }
}

export const klineService = new KlineService();
