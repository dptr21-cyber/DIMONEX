/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * dimonexDatafeed.ts
 * Official TradingView Datafeed API implementation grounded exclusively
 * in DIMONEX matching engine trades and authoritative OHLCV candles.
 * 
 * Features:
 * - Implements TradingView IBasicDataFeed interface
 * - Real trade execution pipeline (Zero mock/synthetic candles)
 * - Exchange timezone: Asia/Jakarta
 * - Quote currency: IDR (or USDT)
 * - WebSocket real-time incremental candle updates with duplicate event protection
 * - Historical pagination & gap-free continuity
 */

import {
  IBasicDataFeed,
  DatafeedConfiguration,
  LibrarySymbolInfo,
  Bar,
  PeriodParams,
  ResolutionString,
  Timeframe,
  OnReadyCallback,
  SearchSymbolsCallback,
  ResolveCallback,
  ErrorCallback,
  HistoryCallback,
  SubscribeBarsCallback
} from './chartTypes.js';

// Configuration constants
export const SUPPORTED_RESOLUTIONS: ResolutionString[] = ['1', '5', '15', '60', '240', '1D', '1W'];

export const RESOLUTION_TO_SECONDS: Record<string, number> = {
  '1': 60,
  '5': 300,
  '15': 900,
  '60': 3600,
  '240': 14400,
  '1D': 86400,
  'D': 86400,
  '1W': 604800,
  'W': 604800
};

export function resolutionToTimeframe(res: string): Timeframe {
  switch (res) {
    case '1': return '1m';
    case '5': return '5m';
    case '15': return '15m';
    case '60': return '1h';
    case '240': return '4h';
    case '1D':
    case 'D': return '1d';
    case '1W':
    case 'W': return '1w';
    default: return '15m';
  }
}

export function timeframeToResolution(tf: Timeframe): ResolutionString {
  switch (tf) {
    case '1m': return '1';
    case '5m': return '5';
    case '15m': return '15';
    case '1h': return '60';
    case '4h': return '240';
    case '1d': return '1D';
    case '1w': return '1W';
    default: return '15';
  }
}

export function parseSymbolPairId(symbol: string): string {
  let clean = (symbol || '').replace(/^DIMONEX:/i, '').trim();
  clean = clean.replace('/', '-').replace('_', '-');
  return clean || 'BTC-IDR';
}

interface ActiveSubscription {
  id: string;
  symbolInfo: LibrarySymbolInfo;
  resolution: string;
  intervalSec: number;
  lastBar: Bar | null;
  callback: SubscribeBarsCallback;
}

export class DimonexDatafeed implements IBasicDataFeed {
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private subscriptions: Map<string, ActiveSubscription> = new Map();
  private processedTradeIds: Set<string> = new Set();
  private lastBarsCache: Map<string, Bar> = new Map(); // key: `${pairId}:${resolution}`

  constructor() {
    this.initWebSocket();
  }

  private initWebSocket() {
    if (typeof window === 'undefined') return;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.wsConnected = true;
        // Re-subscribe any existing subscriptions
        for (const sub of this.subscriptions.values()) {
          const pairId = parseSymbolPairId(sub.symbolInfo.ticker || sub.symbolInfo.name);
          this.ws?.send(JSON.stringify({ action: 'subscribe', channel: `trades:${pairId}` }));
          this.ws?.send(JSON.stringify({ action: 'subscribe', channel: `kline:${pairId}` }));
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'trade' && payload.data) {
            this.handleRealtimeTrade(payload.data);
          }
        } catch (e) {
          // ignore parsing error
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        setTimeout(() => this.initWebSocket(), 3000);
      };

      this.ws.onerror = () => {
        this.wsConnected = false;
      };
    } catch (e) {
      // Offline or SSR safe
    }
  }

  /**
   * Process a matched trade event into active candle subscriptions.
   * Enforces deduplication and accurate incremental OHLCV aggregation.
   */
  public handleRealtimeTrade(trade: {
    id: string;
    pairId: string;
    price: string;
    quantity: string;
    createdAt: number;
  }) {
    // 1. Duplicate event protection
    if (this.processedTradeIds.has(trade.id)) {
      return;
    }
    this.processedTradeIds.add(trade.id);
    if (this.processedTradeIds.size > 2000) {
      const arr = Array.from(this.processedTradeIds);
      this.processedTradeIds = new Set(arr.slice(-1000));
    }

    const isUSDT = trade.pairId.endsWith('USDT') || trade.pairId.includes('-USDT');
    const quoteDec = isUSDT ? 6 : 2;
    const tradePrice = Number(BigInt(trade.price)) / (10 ** quoteDec);
    const tradeQty = Number(trade.quantity) / 1e8; // Default 8 decimal precision base
    const tradeSec = Math.floor(trade.createdAt / 1000);

    for (const sub of this.subscriptions.values()) {
      const subPairId = parseSymbolPairId(sub.symbolInfo.ticker || sub.symbolInfo.name);
      if (subPairId !== trade.pairId) continue;

      const intervalSec = sub.intervalSec || 900;
      const candleTimeSec = Math.floor(tradeSec / intervalSec) * intervalSec;
      const candleTimeMs = candleTimeSec * 1000;

      let currentBar = sub.lastBar;
      if (!currentBar || candleTimeMs > currentBar.time) {
        // New candle interval
        const openPrice = currentBar ? currentBar.close : tradePrice;
        currentBar = {
          time: candleTimeMs,
          open: openPrice,
          high: Math.max(openPrice, tradePrice),
          low: Math.min(openPrice, tradePrice),
          close: tradePrice,
          volume: tradeQty
        };
      } else if (candleTimeMs === currentBar.time) {
        // Update active candle
        currentBar = {
          ...currentBar,
          high: Math.max(currentBar.high, tradePrice),
          low: Math.min(currentBar.low, tradePrice),
          close: tradePrice,
          volume: Number(((currentBar.volume || 0) + tradeQty).toFixed(6))
        };
      } else {
        // Historical or past trade, do not mutate forward timeline
        continue;
      }

      sub.lastBar = currentBar;
      this.lastBarsCache.set(`${subPairId}:${sub.resolution}`, currentBar);
      sub.callback(currentBar);
    }
  }

  // 1. onReady callback
  onReady(callback: OnReadyCallback): void {
    setTimeout(() => {
      const config: DatafeedConfiguration = {
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_search: true,
        supports_group_request: false,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [
          { value: 'DIMONEX', name: 'DIMONEX', desc: 'DIMONEX Centralized Exchange' }
        ],
        symbols_types: [
          { name: 'crypto', value: 'crypto' }
        ]
      };
      callback(config);
    }, 0);
  }

  // 2. searchSymbols
  searchSymbols(
    userInput: string,
    _exchange: string,
    _symbolType: string,
    onResultReadyCallback: SearchSymbolsCallback
  ): void {
    fetch(`/api/trading/search?query=${encodeURIComponent(userInput || '')}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          onResultReadyCallback(data);
        } else {
          onResultReadyCallback([]);
        }
      })
      .catch(() => onResultReadyCallback([]));
  }

  // 3. resolveSymbol
  resolveSymbol(
    symbolName: string,
    onSymbolResolvedCallback: ResolveCallback,
    onResolveErrorCallback: ErrorCallback
  ): void {
    const pairId = parseSymbolPairId(symbolName);
    fetch(`/api/trading/symbols?symbol=${encodeURIComponent(pairId)}`)
      .then(res => {
        if (!res.ok) throw new Error(`Symbol resolution failed: ${res.statusText}`);
        return res.json();
      })
      .then(info => {
        const symbolInfo: LibrarySymbolInfo = {
          name: info.name || pairId,
          ticker: info.ticker || pairId,
          description: info.description || `${pairId} Spot Market`,
          type: 'crypto',
          session: '24x7',
          exchange: 'DIMONEX',
          listed_exchange: 'DIMONEX',
          timezone: 'Asia/Jakarta',
          pricescale: info.pricescale || 1,
          minmov: info.minmov || 1,
          minmove2: 0,
          fractional: false,
          has_intraday: true,
          supported_resolutions: SUPPORTED_RESOLUTIONS,
          intraday_multipliers: ['1', '5', '15', '60', '240'],
          has_empty_bars: true,
          has_no_volume: false,
          volume_precision: info.volume_precision || 4,
          data_status: 'streaming',
          currency_code: info.currency_code || 'IDR',
          original_currency_code: info.currency_code || 'IDR'
        };
        onSymbolResolvedCallback(symbolInfo);
      })
      .catch(err => {
        onResolveErrorCallback(err.message || 'Symbol not found');
      });
  }

  // 4. getBars
  getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onHistoryCallback: HistoryCallback,
    onErrorCallback: ErrorCallback
  ): void {
    const pairId = parseSymbolPairId(symbolInfo.ticker || symbolInfo.name);
    const { from, to, countBack, firstDataRequest } = periodParams;

    const url = `/api/trading/candles/${pairId}?resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}&countback=${countBack || 300}`;

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        return res.json();
      })
      .then(candles => {
        if (!Array.isArray(candles) || candles.length === 0) {
          onHistoryCallback([], { noData: true });
          return;
        }

        // Contract: TradingView getBars expects bars sorted ascending by time in milliseconds
        const bars: Bar[] = candles.map(c => ({
          time: c.time > 1e11 ? c.time : c.time * 1000,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume || 0)
        })).sort((a, b) => a.time - b.time);

        if (firstDataRequest && bars.length > 0) {
          const lastBar = bars[bars.length - 1];
          this.lastBarsCache.set(`${pairId}:${resolution}`, lastBar);
        }

        onHistoryCallback(bars, { noData: false });
      })
      .catch(err => {
        onErrorCallback(err.message || 'Failed to fetch bars');
      });
  }

  // 5. subscribeBars
  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onRealtimeCallback: SubscribeBarsCallback,
    subscriberUID: string,
    _onResetCacheNeededCallback: () => void
  ): void {
    const pairId = parseSymbolPairId(symbolInfo.ticker || symbolInfo.name);
    const intervalSec = RESOLUTION_TO_SECONDS[resolution] || 900;
    const cachedBar = this.lastBarsCache.get(`${pairId}:${resolution}`) || null;

    const sub: ActiveSubscription = {
      id: subscriberUID,
      symbolInfo,
      resolution,
      intervalSec,
      lastBar: cachedBar,
      callback: onRealtimeCallback
    };

    this.subscriptions.set(subscriberUID, sub);

    // Subscribe WebSocket channels
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'subscribe', channel: `trades:${pairId}` }));
      this.ws.send(JSON.stringify({ action: 'subscribe', channel: `kline:${pairId}` }));
    }
  }

  // 6. unsubscribeBars
  unsubscribeBars(subscriberUID: string): void {
    const sub = this.subscriptions.get(subscriberUID);
    if (!sub) return;

    const pairId = parseSymbolPairId(sub.symbolInfo.ticker || sub.symbolInfo.name);
    this.subscriptions.delete(subscriberUID);

    // Check if any remaining subscribers for this pair
    let pairHasSubscribers = false;
    for (const remaining of this.subscriptions.values()) {
      if (parseSymbolPairId(remaining.symbolInfo.ticker || remaining.symbolInfo.name) === pairId) {
        pairHasSubscribers = true;
        break;
      }
    }

    if (!pairHasSubscribers && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'unsubscribe', channel: `trades:${pairId}` }));
      this.ws.send(JSON.stringify({ action: 'unsubscribe', channel: `kline:${pairId}` }));
    }
  }

  // 7. getServerTime
  getServerTime(callback: (serverTime: number) => void): void {
    fetch('/api/trading/time')
      .then(res => res.text())
      .then(txt => {
        const timeSec = parseInt(txt, 10);
        callback(!isNaN(timeSec) ? timeSec : Math.floor(Date.now() / 1000));
      })
      .catch(() => callback(Math.floor(Date.now() / 1000)));
  }

  // Cleanup helper
  public destroy() {
    this.subscriptions.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const dimonexDatafeed = new DimonexDatafeed();
