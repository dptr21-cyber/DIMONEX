/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PriceAggregatorService.ts
 * Multi-Exchange Price Aggregator (Binance & Bybit) with deviation check,
 * staleness detection, automatic failover, and USDT/IDR FX conversion.
 */

import { BinancePublicFeed } from './BinancePublicFeed.js';
import { BybitPublicFeed } from './BybitPublicFeed.js';
import { CoinMarketCapFeed } from './CoinMarketCapFeed.js';
import { fxConversionService } from './FxConversionService.js';
import { 
  AggregatorConfig, 
  AggregatedReferencePrice, 
  ProviderId, 
  ExternalPriceTick 
} from './ExternalFeedTypes.js';

export interface ExternalCatalogPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  providers: ('binance' | 'bybit')[];
  binancePrice: number | null;
  bybitPrice: number | null;
}

export interface ExternalSymbolSnapshot {
  symbol: string;
  price: number;
  bestBid: number;
  bestAsk: number;
  binancePrice: number | null;
  bybitPrice: number | null;
  binanceFresh: boolean;
  bybitFresh: boolean;
  activeProvider: 'binance' | 'bybit' | 'aggregated';
  isFresh: boolean;
  updatedAt: number;
}

const KNOWN_QUOTES = ['USDT', 'FDUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'] as const;

export function parseExternalPairSymbol(symbol: string): { baseAsset: string; quoteAsset: string } {
  const sym = symbol.trim().toUpperCase();
  for (const quote of KNOWN_QUOTES) {
    if (sym.endsWith(quote) && sym.length > quote.length) {
      return {
        baseAsset: sym.slice(0, sym.length - quote.length),
        quoteAsset: quote
      };
    }
  }
  return { baseAsset: sym, quoteAsset: 'USDT' };
}

const FALLBACK_CATALOG_SYMBOLS: string[] = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'TONUSDT', 'SUIUSDT',
  'PEPEUSDT', 'SHIBUSDT', 'TRXUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT',
  'OPUSDT', 'INJUSDT', 'RENDERUSDT', 'WIFUSDT', 'LTCUSDT', 'BCHUSDT',
  'UNIUSDT', 'AAVEUSDT', 'MATICUSDT', 'ATOMUSDT', 'ETHBTC', 'SOLBTC'
];

export class PriceAggregatorService {
  public readonly binance: BinancePublicFeed;
  public readonly bybit: BybitPublicFeed;
  public readonly cmc: CoinMarketCapFeed;

  private catalogCache: { items: ExternalCatalogPair[]; fetchedAt: number } | null = null;
  private readonly CATALOG_TTL_MS = 5 * 60 * 1000;

  private config: AggregatorConfig = {
    primaryProvider: 'binance',
    secondaryProvider: 'bybit',
    maxDataAgeMs: 15000,           // 15 seconds max age
    maxAllowedDeviationBps: 200,   // 2.00% max difference between exchanges
    maxSpreadBps: 300,             // 3.00% max spread
    minValidProviders: 1,
    failoverBehavior: 'AUTOMATIC',
    outlierRejectionPolicy: 'STRICT'
  };

  constructor() {
    this.binance = new BinancePublicFeed();
    this.bybit = new BybitPublicFeed();
    this.cmc = new CoinMarketCapFeed();

    // Start background connections (non-blocking)
    this.binance.connect().catch(() => {});
    this.bybit.connect().catch(() => {});
    this.cmc.connect().catch(() => {});
  }

  public getConfig(): AggregatorConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<AggregatorConfig>): AggregatorConfig {
    this.config = {
      ...this.config,
      ...newConfig
    };
    return this.getConfig();
  }

  /**
   * Synchronize Binance & Bybit public WebSocket subscriptions strictly to the Admin whitelist
   * so bandwidth and stream counts stay minimal.
   */
  public syncWhitelistSymbols(binanceSymbols: string[], bybitSymbols?: string[]): void {
    const binList = Array.from(new Set(binanceSymbols.map(s => s.trim().toUpperCase()).filter(Boolean)));
    const bybList = Array.from(new Set((bybitSymbols ?? binanceSymbols).map(s => s.trim().toUpperCase()).filter(Boolean)));
    this.binance.syncSymbols(binList);
    this.bybit.syncSymbols(bybList);
  }

  /**
   * Resolve live WS snapshot for any whitelisted symbol across Binance & Bybit
   */
  public getSymbolSnapshot(
    symbol: string,
    preferredProvider: 'AGGREGATED' | 'BINANCE' | 'BYBIT' = 'AGGREGATED'
  ): ExternalSymbolSnapshot {
    const sym = symbol.trim().toUpperCase();
    const now = Date.now();
    const binTick = this.binance.getTick(sym);
    const bybTick = this.bybit.getTick(sym);

    const bPrice = binTick && binTick.lastPrice > 0 ? binTick.lastPrice : null;
    const yPrice = bybTick && bybTick.lastPrice > 0 ? bybTick.lastPrice : null;

    const bFresh = Boolean(binTick && bPrice !== null && (now - binTick.receivedAt <= this.config.maxDataAgeMs));
    const yFresh = Boolean(bybTick && yPrice !== null && (now - bybTick.receivedAt <= this.config.maxDataAgeMs));

    let price = 0;
    let bestBid = 0;
    let bestAsk = 0;
    let activeProvider: 'binance' | 'bybit' | 'aggregated' = 'aggregated';
    let isFresh = false;
    let updatedAt = 0;

    if (preferredProvider === 'BINANCE') {
      if (binTick && bPrice !== null && (bFresh || !yFresh || this.config.failoverBehavior !== 'AUTOMATIC')) {
        price = bPrice;
        bestBid = binTick.bestBid || bPrice;
        bestAsk = binTick.bestAsk || bPrice;
        activeProvider = 'binance';
        isFresh = bFresh;
        updatedAt = binTick.receivedAt;
      } else if (bybTick && yPrice !== null && this.config.failoverBehavior === 'AUTOMATIC') {
        price = yPrice;
        bestBid = bybTick.bestBid || yPrice;
        bestAsk = bybTick.bestAsk || yPrice;
        activeProvider = 'bybit';
        isFresh = yFresh;
        updatedAt = bybTick.receivedAt;
      }
    } else if (preferredProvider === 'BYBIT') {
      if (bybTick && yPrice !== null && (yFresh || !bFresh || this.config.failoverBehavior !== 'AUTOMATIC')) {
        price = yPrice;
        bestBid = bybTick.bestBid || yPrice;
        bestAsk = bybTick.bestAsk || yPrice;
        activeProvider = 'bybit';
        isFresh = yFresh;
        updatedAt = bybTick.receivedAt;
      } else if (binTick && bPrice !== null && this.config.failoverBehavior === 'AUTOMATIC') {
        price = bPrice;
        bestBid = binTick.bestBid || bPrice;
        bestAsk = binTick.bestAsk || bPrice;
        activeProvider = 'binance';
        isFresh = bFresh;
        updatedAt = binTick.receivedAt;
      }
    } else {
      // AGGREGATED
      if (bFresh && yFresh && bPrice !== null && yPrice !== null && binTick && bybTick) {
        const avg = (bPrice + yPrice) / 2;
        const devBps = Math.round((Math.abs(bPrice - yPrice) / avg) * 10000);
        if (devBps <= this.config.maxAllowedDeviationBps) {
          price = avg;
          bestBid = (binTick.bestBid + bybTick.bestBid) / 2;
          bestAsk = (binTick.bestAsk + bybTick.bestAsk) / 2;
          activeProvider = 'aggregated';
          isFresh = true;
          updatedAt = Math.max(binTick.receivedAt, bybTick.receivedAt);
        } else {
          const primaryTick = this.config.primaryProvider === 'bybit' ? bybTick : binTick;
          price = primaryTick.lastPrice;
          bestBid = primaryTick.bestBid;
          bestAsk = primaryTick.bestAsk;
          activeProvider = primaryTick.provider === 'bybit' ? 'bybit' : 'binance';
          isFresh = true;
          updatedAt = primaryTick.receivedAt;
        }
      } else if (bFresh && bPrice !== null && binTick) {
        price = bPrice;
        bestBid = binTick.bestBid || bPrice;
        bestAsk = binTick.bestAsk || bPrice;
        activeProvider = 'binance';
        isFresh = true;
        updatedAt = binTick.receivedAt;
      } else if (yFresh && yPrice !== null && bybTick) {
        price = yPrice;
        bestBid = bybTick.bestBid || yPrice;
        bestAsk = bybTick.bestAsk || yPrice;
        activeProvider = 'bybit';
        isFresh = true;
        updatedAt = bybTick.receivedAt;
      } else if (bPrice !== null && binTick) {
        price = bPrice;
        bestBid = binTick.bestBid || bPrice;
        bestAsk = binTick.bestAsk || bPrice;
        activeProvider = 'binance';
        isFresh = false;
        updatedAt = binTick.receivedAt;
      } else if (yPrice !== null && bybTick) {
        price = yPrice;
        bestBid = bybTick.bestBid || yPrice;
        bestAsk = bybTick.bestAsk || yPrice;
        activeProvider = 'bybit';
        isFresh = false;
        updatedAt = bybTick.receivedAt;
      }
    }

    return {
      symbol: sym,
      price,
      bestBid,
      bestAsk,
      binancePrice: bPrice,
      bybitPrice: yPrice,
      binanceFresh: bFresh,
      bybitFresh: yFresh,
      activeProvider,
      isFresh,
      updatedAt
    };
  }

  /**
   * Fetch live available Spot pairs & prices from Binance & Bybit REST tickers (cached 5 min)
   * with graceful fallback directory so Admin can curate a minimal WS whitelist.
   */
  public async fetchAvailableCatalog(forceRefresh = false): Promise<{
    items: ExternalCatalogPair[];
    source: 'LIVE' | 'CACHED' | 'FALLBACK';
    fetchedAt: number;
  }> {
    const now = Date.now();
    if (!forceRefresh && this.catalogCache && (now - this.catalogCache.fetchedAt < this.CATALOG_TTL_MS)) {
      return {
        items: this.catalogCache.items,
        source: 'CACHED',
        fetchedAt: this.catalogCache.fetchedAt
      };
    }

    const catalogMap = new Map<string, ExternalCatalogPair>();
    const isLeveragedJunk = (sym: string) =>
      /(UP|DOWN|BULL|BEAR|[235][LS])(USDT|USDC|FDUSD|BTC|ETH)$/.test(sym);

    const fetchWithTimeout = async (url: string, ms = 4000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };

    const [binRes, bybRes] = await Promise.allSettled([
      fetchWithTimeout('https://api.binance.com/api/v3/ticker/price', 4000),
      fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=spot', 4000)
    ]);

    let liveCount = 0;

    if (binRes.status === 'fulfilled' && Array.isArray(binRes.value)) {
      for (const row of binRes.value) {
        const sym = String(row?.symbol || '').toUpperCase();
        const price = parseFloat(row?.price || '0');
        if (!sym || !(price > 0) || isLeveragedJunk(sym)) continue;
        const { baseAsset, quoteAsset } = parseExternalPairSymbol(sym);
        if (!KNOWN_QUOTES.includes(quoteAsset as any)) continue;

        liveCount++;
        const existing = catalogMap.get(sym);
        if (existing) {
          if (!existing.providers.includes('binance')) existing.providers.push('binance');
          existing.binancePrice = price;
        } else {
          catalogMap.set(sym, {
            symbol: sym,
            baseAsset,
            quoteAsset,
            providers: ['binance'],
            binancePrice: price,
            bybitPrice: null
          });
        }
      }
    }

    if (bybRes.status === 'fulfilled' && Array.isArray(bybRes.value?.result?.list)) {
      for (const row of bybRes.value.result.list) {
        const sym = String(row?.symbol || '').toUpperCase();
        const price = parseFloat(row?.lastPrice || '0');
        if (!sym || !(price > 0) || isLeveragedJunk(sym)) continue;
        const { baseAsset, quoteAsset } = parseExternalPairSymbol(sym);
        if (!KNOWN_QUOTES.includes(quoteAsset as any)) continue;

        liveCount++;
        const existing = catalogMap.get(sym);
        if (existing) {
          if (!existing.providers.includes('bybit')) existing.providers.push('bybit');
          existing.bybitPrice = price;
        } else {
          catalogMap.set(sym, {
            symbol: sym,
            baseAsset,
            quoteAsset,
            providers: ['bybit'],
            binancePrice: null,
            bybitPrice: price
          });
        }
      }
    }

    if (catalogMap.size > 0) {
      const items = Array.from(catalogMap.values()).sort((a, b) => {
        // Prioritize USDT pairs & common majors, then alphabetical
        const aUsdt = a.quoteAsset === 'USDT' ? 0 : 1;
        const bUsdt = b.quoteAsset === 'USDT' ? 0 : 1;
        if (aUsdt !== bUsdt) return aUsdt - bUsdt;
        const aBoth = b.providers.length - a.providers.length;
        if (aBoth !== 0) return aBoth;
        return a.symbol.localeCompare(b.symbol);
      });
      this.catalogCache = { items, fetchedAt: now };
      return { items, source: liveCount > 0 ? 'LIVE' : 'FALLBACK', fetchedAt: now };
    }

    // Fallback catalog if external REST calls are unreachable
    const fallbackItems: ExternalCatalogPair[] = FALLBACK_CATALOG_SYMBOLS.map(sym => {
      const { baseAsset, quoteAsset } = parseExternalPairSymbol(sym);
      const binTick = this.binance.getTick(sym);
      const bybTick = this.bybit.getTick(sym);
      return {
        symbol: sym,
        baseAsset,
        quoteAsset,
        providers: ['binance', 'bybit'],
        binancePrice: binTick?.lastPrice ?? null,
        bybitPrice: bybTick?.lastPrice ?? null
      };
    });
    return { items: fallbackItems, source: 'FALLBACK', fetchedAt: now };
  }

  /**
   * Seed initial price tick for a newly whitelisted symbol from cached/live REST catalog
   * so bots have immediate reference price while WebSocket streams settle.
   */
  public async seedSymbolFromCatalog(symbol: string, providers: ('binance' | 'bybit')[] = ['binance', 'bybit']): Promise<void> {
    const sym = symbol.trim().toUpperCase();
    try {
      const { items } = await this.fetchAvailableCatalog(false);
      const match = items.find(i => i.symbol === sym);
      if (match) {
        if (providers.includes('binance') && match.binancePrice && match.binancePrice > 0) {
          this.binance.seedInitialTick(sym, match.binancePrice);
        } else if (providers.includes('binance') && match.bybitPrice && match.bybitPrice > 0) {
          this.binance.seedInitialTick(sym, match.bybitPrice);
        }
        if (providers.includes('bybit') && match.bybitPrice && match.bybitPrice > 0) {
          this.bybit.seedInitialTick(sym, match.bybitPrice);
        } else if (providers.includes('bybit') && match.binancePrice && match.binancePrice > 0) {
          this.bybit.seedInitialTick(sym, match.binancePrice);
        }
      }
    } catch (_) {}
  }

  /**
   * Get aggregated reference price for a DIMONEX trading pair (e.g. 'BTC-IDR', 'ETH-IDR', 'USDT-IDR')
   */
  public getReferencePrice(pairId: string): AggregatedReferencePrice {
    const now = Date.now();
    const upperPair = pairId.toUpperCase();

    // Special case for USDT-IDR: purely driven by FX rate
    if (upperPair === 'USDT-IDR') {
      const fx = fxConversionService.getCurrentRate();
      const isStale = fx.isStale;
      return {
        symbol: 'USDTUSDT',
        pairId: 'USDT-IDR',
        effectiveUsdtPrice: 1.0,
        effectiveIdrPrice: fx.rate,
        primaryProvider: 'binance',
        activeProvider: 'binance',
        deviationBps: 0,
        isStale,
        isAbnormal: false,
        status: isStale ? 'REFERENCE_PRICE_UNAVAILABLE' : 'ACTIVE',
        binancePrice: 1.0,
        bybitPrice: 1.0,
        cmcPrice: 1.0,
        fxRateUsed: fx.rate,
        fxTimestamp: fx.updatedAt,
        updatedAt: now
      };
    }

    const extSymbol = fxConversionService.getExternalSymbolForPair(upperPair) || 'BTCUSDT';
    const binanceTick = this.binance.getTick(extSymbol);
    const bybitTick = this.bybit.getTick(extSymbol);
    const cmcTick = this.cmc.getTick(extSymbol);

    const bPrice = binanceTick?.lastPrice ?? null;
    const yPrice = bybitTick?.lastPrice ?? null;
    const cPrice = cmcTick?.lastPrice ?? null;

    // Check freshness
    const bFresh = binanceTick ? (now - binanceTick.receivedAt <= this.config.maxDataAgeMs) : false;
    const yFresh = bybitTick ? (now - bybitTick.receivedAt <= this.config.maxDataAgeMs) : false;
    const cFresh = cmcTick ? (now - cmcTick.receivedAt <= this.config.maxDataAgeMs) : false;

    // Calculate cross-exchange deviation if both ticks are present
    let deviationBps = 0;
    let isAbnormal = false;
    let rejectionReason: string | undefined;

    if (bPrice !== null && yPrice !== null && bPrice > 0 && yPrice > 0) {
      const avg = (bPrice + yPrice) / 2;
      deviationBps = Math.round((Math.abs(bPrice - yPrice) / avg) * 10000);
      if (deviationBps > this.config.maxAllowedDeviationBps) {
        isAbnormal = true;
        rejectionReason = `Deviasi antar-exchange (${(deviationBps / 100).toFixed(2)}%) melampaui batas maksimum (${(this.config.maxAllowedDeviationBps / 100).toFixed(2)}%).`;
      }
    }

    // Determine active provider according to primary/secondary and failover policy
    let activeProvider: ProviderId = this.config.primaryProvider;
    let effectiveUsdtPrice = 0;
    let isStale = false;

    const getTickFor = (prov: ProviderId) => {
      if (prov === 'binance') return { tick: binanceTick, fresh: bFresh };
      if (prov === 'bybit') return { tick: bybitTick, fresh: yFresh };
      return { tick: cmcTick, fresh: cFresh };
    };

    const primaryData = getTickFor(this.config.primaryProvider);
    const secondaryData = getTickFor(this.config.secondaryProvider);

    if (primaryData.tick && primaryData.fresh && (!isAbnormal || this.config.outlierRejectionPolicy === 'LOG_ONLY')) {
      activeProvider = this.config.primaryProvider;
      effectiveUsdtPrice = primaryData.tick.lastPrice;
    } else if (this.config.failoverBehavior === 'AUTOMATIC' && secondaryData.tick && secondaryData.fresh && (!isAbnormal || this.config.outlierRejectionPolicy === 'LOG_ONLY')) {
      activeProvider = this.config.secondaryProvider;
      effectiveUsdtPrice = secondaryData.tick.lastPrice;
    } else if (primaryData.tick && primaryData.tick.lastPrice > 0) {
      activeProvider = this.config.primaryProvider;
      effectiveUsdtPrice = primaryData.tick.lastPrice;
      isStale = true;
      rejectionReason = rejectionReason || 'Feed harga eksternal melebihi batas freshness (stale data).';
    } else {
      isStale = true;
      rejectionReason = rejectionReason || 'Tidak ada provider harga eksternal yang tersedia.';
    }

    // FX Conversion to IDR
    const fx = fxConversionService.getCurrentRate();
    if (fx.isStale) {
      isStale = true;
      rejectionReason = rejectionReason ? `${rejectionReason}; ${fx.notes}` : 'Kurs USDT/IDR telah kedaluwarsa.';
    }

    const effectiveIdrPrice = Math.round(effectiveUsdtPrice * fx.rate);

    let status: 'ACTIVE' | 'DEGRADED' | 'REFERENCE_PRICE_UNAVAILABLE' = 'ACTIVE';
    if (isAbnormal && this.config.outlierRejectionPolicy === 'STRICT') {
      status = 'REFERENCE_PRICE_UNAVAILABLE';
    } else if (isStale) {
      status = 'REFERENCE_PRICE_UNAVAILABLE';
    } else if (isAbnormal || (!bFresh && yFresh) || (bFresh && !yFresh)) {
      status = 'DEGRADED';
    }

    return {
      symbol: extSymbol,
      pairId: upperPair,
      effectiveUsdtPrice,
      effectiveIdrPrice,
      primaryProvider: this.config.primaryProvider,
      activeProvider,
      deviationBps,
      isStale,
      isAbnormal,
      status,
      rejectionReason,
      binancePrice: bPrice,
      bybitPrice: yPrice,
      cmcPrice: cPrice,
      fxRateUsed: fx.rate,
      fxTimestamp: fx.updatedAt,
      updatedAt: now
    };
  }

  /**
   * Get snapshot of all available providers and health
   */
  public getProvidersStatus() {
    return {
      binance: {
        id: this.binance.id,
        name: this.binance.name,
        status: this.binance.getConnectionStatus(),
        subscribedSymbols: this.binance.getSubscribedSymbols(),
        metrics: this.binance.getMetrics(),
        btcTick: this.binance.getTick('BTCUSDT'),
        ethTick: this.binance.getTick('ETHUSDT')
      },
      bybit: {
        id: this.bybit.id,
        name: this.bybit.name,
        status: this.bybit.getConnectionStatus(),
        subscribedSymbols: this.bybit.getSubscribedSymbols(),
        metrics: this.bybit.getMetrics(),
        btcTick: this.bybit.getTick('BTCUSDT'),
        ethTick: this.bybit.getTick('ETHUSDT')
      },
      cmc: {
        id: this.cmc.id,
        name: this.cmc.name,
        status: this.cmc.getConnectionStatus(),
        metrics: this.cmc.getMetrics(),
        btcTick: this.cmc.getTick('BTCUSDT'),
        ethTick: this.cmc.getTick('ETHUSDT'),
        usdtTick: this.cmc.getTick('USDTIDR')
      },
      config: this.config,
      fxRate: fxConversionService.getCurrentRate()
    };
  }
}

export const priceAggregatorService = new PriceAggregatorService();
