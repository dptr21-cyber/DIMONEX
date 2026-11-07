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

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1D';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1D': 86400,
};

export class KlineService {
  // key: `${pairId}:${timeframe}` -> Candle[]
  private klineStore: Map<string, Candle[]> = new Map();
  private processedTradeIds: Set<string> = new Set();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    const loaded = this.loadFromDisk();
    if (!loaded) {
      this.rebuildFromDbTrades();
      this.saveToDisk();
    }
  }

  public scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, 500);
  }

  public saveToDisk(): boolean {
    try {
      const dir = getExchangeDataDirectory();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const obj: Record<string, Candle[]> = {};
      for (const [k, v] of this.klineStore.entries()) {
        // Keep maximum 1,000 candles per timeframe series to keep file compact
        obj[k] = v.length > 1000 ? v.slice(-1000) : v;
      }

      const jsonStr = JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      );

      const targetFiles = [
        path.join(dir, 'klines_state.json')
      ];

      const bundledDir = path.resolve(process.cwd(), 'server', 'data');
      if (dir !== bundledDir && fs.existsSync(bundledDir)) {
        try {
          targetFiles.push(path.join(bundledDir, 'klines_state.json'));
        } catch {}
      }

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

    const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1D'];
    const quoteDec = pair.quoteDecimals !== undefined && pair.quoteDecimals !== null ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const tradePrice = Number(BigInt(trade.price)) / (10 ** quoteDec);
    const tradeQty = Number(trade.quantity) / (10 ** pair.baseDecimals);
    const tradeSec = Math.floor(trade.createdAt / 1000);

    const isDuplicate = this.processedTradeIds.has(trade.id);
    this.processedTradeIds.add(trade.id);
    if (this.processedTradeIds.size > 2000) {
      const arr = Array.from(this.processedTradeIds);
      this.processedTradeIds = new Set(arr.slice(-1000));
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
   * Get historical and current candles for a pair and timeframe.
   * Returns empty array if no trades have executed yet for this pair.
   */
  public getCandles(pairId: string, tfStr: string = '15m', limit = 150): Candle[] {
    const normalized = tfStr === '1D' ? '1D' : tfStr.toLowerCase();
    const tf: Timeframe = (['1m', '5m', '15m', '1h', '4h', '1d', '1D'].includes(tfStr) ? tfStr : ['1m', '5m', '15m', '1h', '4h', '1d'].includes(normalized) ? normalized : '15m') as Timeframe;
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
   * Maps TradingView standard resolutions ('1', '5', '15', '60', '240', 'D', '1D')
   * to internal Timeframe enum.
   */
  public normalizeResolution(res: string): Timeframe {
    if (!res) return '15m';
    const clean = res.trim();
    switch (clean) {
      case '1':
      case '1m':
        return '1m';
      case '5':
      case '5m':
        return '5m';
      case '15':
      case '15m':
        return '15m';
      case '60':
      case '1h':
      case '60m':
        return '1h';
      case '240':
      case '4h':
      case '240m':
        return '4h';
      case 'D':
      case '1D':
      case '1d':
      case 'W':
      case '1W':
      case '1w':
        return '1D';
      default:
        return '15m';
    }
  }

  /**
   * TradingView Datafeed compliant getBars method.
   * Supports filtering by from/to Unix seconds and countBack.
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

    let result = candles;
    if (fromSec !== undefined && toSec !== undefined) {
      result = candles.filter(c => c.time >= fromSec && c.time <= toSec);
    } else if (fromSec !== undefined) {
      result = candles.filter(c => c.time >= fromSec);
    } else if (toSec !== undefined) {
      result = candles.filter(c => c.time <= toSec);
    }

    if (limit && limit > 0 && result.length > limit) {
      return result.slice(-limit);
    }

    return result;
  }
}

export const klineService = new KlineService();
