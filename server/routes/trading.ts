/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * trading.ts
 * Core trading REST endpoints: order placement, cancellation, depth, trades, and pairs.
 */

import { Router } from 'express';
import { requireAuth } from './auth.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { db } from '../db/database.js';
import { marketWsService } from '../websocket/MarketDataWs.js';
import { klineService } from '../engine/KlineService.js';
import { ensureScheduledPairEntry } from '../services/MarketLifecycleScheduler.js';
import { priceThresholdService } from '../services/PriceThresholdService.js';
import { ChartDrawingRecord } from '../db/types.js';

export const tradingRouter = Router();

let cachedPairsPayload: { data: any[]; sig: string; expiresAt: number } | null = null;

// Get All Active Trading Pairs
tradingRouter.get('/pairs', (req, res) => {
  const latestTrade = db.trades.length > 0 ? db.trades[db.trades.length - 1] : null;
  const sig = `${db.tradingPairs.size}:${db.markets.size}:${db.listingRequests.size}:${db.assets.size}:${db.trades.length}:${latestTrade?.id || ''}`;
  const now = Date.now();
  if (cachedPairsPayload && cachedPairsPayload.sig === sig && now < cachedPairsPayload.expiresAt) {
    return res.json(cachedPairsPayload.data);
  }
  // Sync active markets from db.markets into db.tradingPairs if not already present
  for (const market of db.markets.values()) {
    if (market.status === 'ACTIVE' && !db.tradingPairs.has(market.id)) {
      const baseAsset = db.assets.get(market.baseAssetId);
      const quoteAsset = db.assets.get(market.quoteAssetId);
      if (baseAsset && quoteAsset) {
        const pair = {
          id: market.id,
          baseCurrency: baseAsset.symbol,
          quoteCurrency: quoteAsset.symbol,
          baseDecimals: baseAsset.decimals,
          quoteDecimals: quoteAsset.decimals,
          minOrderSize: market.minQuantity || '100000000',
          maxOrderSize: (10000000n * (10n ** BigInt(baseAsset.decimals))).toString(), // 10,000,000 tokens
          makerFeeBps: market.makerFeeBps,
          takerFeeBps: market.takerFeeBps,
          isActive: true,
          isHalted: false,
          lastPrice: '0',
          high24h: '0',
          low24h: '0',
          volume24h: '0',
          quoteVolume24h: '0',
          priceChange24h: '+0.00',
          priceChangePercent24h: '0.00'
        };
        db.tradingPairs.set(market.id, pair);
      }
    }
  }

  // Sync SCHEDULED initial listings so pre-launch pairs appear in Markets & Chart with Countdown Timer
  for (const listing of db.listingRequests.values()) {
    if (listing.status === 'SCHEDULED') {
      ensureScheduledPairEntry(listing);
    }
  }

  // Authoritatively compute rolling 24h stats from actual executed trades
  db.ensureAssetsForTradingPairs();
  db.recalculatePair24hStats();

  const assetsBySymbol = new Map(
    Array.from(db.assets.values()).map(a => [a.symbol.toUpperCase(), a])
  );

  const enrichedPairs = Array.from(db.tradingPairs.values()).map(pair => {
    const market = db.markets.get(pair.id);
    const listing = market
      ? db.listingRequests.get(market.listingRequestId)
      : Array.from(db.listingRequests.values()).find(l => {
          const base = db.assets.get(l.assetId);
          const quote = db.assets.get(l.quoteAssetId);
          return base && base.symbol === pair.baseCurrency && (!quote || quote.symbol === pair.quoteCurrency);
        });

    const baseAsset = assetsBySymbol.get(pair.baseCurrency.toUpperCase());
    const quoteAsset = assetsBySymbol.get(pair.quoteCurrency.toUpperCase());
    const isNew = pair.baseCurrency === 'SOL' || (listing !== undefined);
    const resolvedScheduledAt = listing?.status === 'SCHEDULED'
      ? (listing.scheduledAt || pair.scheduledAt)
      : pair.scheduledAt;

    const resolvedListingStatus = pair.isDelisted
      ? 'DELISTED'
      : listing?.status === 'SCHEDULED' && !pair.isActive
      ? 'SCHEDULED'
      : (listing?.status || (pair.isActive ? 'ACTIVE' : 'PREPARING'));

    return {
      ...pair,
      baseName: baseAsset?.name || pair.baseCurrency,
      baseLogoUrl: baseAsset?.logoUrl || '',
      quoteLogoUrl: quoteAsset?.logoUrl || '',
      isNewListing: isNew,
      listingStatus: resolvedListingStatus,
      depositEnabled: baseAsset?.depositEnabled ?? true,
      withdrawalEnabled: baseAsset?.withdrawalEnabled ?? true,
      depositOpenedAt: baseAsset?.depositOpenedAt || listing?.depositOpenedAt,
      withdrawalOpenedAt: baseAsset?.withdrawalOpenedAt || listing?.withdrawalOpenedAt,
      scheduledAt: resolvedScheduledAt,
      isDelisted: Boolean(pair.isDelisted),
      delistedAt: pair.delistedAt,
      delistScheduledAt: pair.delistScheduledAt,
      delistReason: pair.delistReason
    };
  });

  cachedPairsPayload = {
    data: enrichedPairs,
    sig,
    expiresAt: now + 1500,
  };

  res.json(enrichedPairs);
});

// Get Ticker for a pair
tradingRouter.get('/ticker/:pairId', (req, res) => {
  db.recalculatePair24hStats(req.params.pairId);
  const pair = db.tradingPairs.get(req.params.pairId);
  if (!pair) return res.status(404).json({ error: 'Pair tidak ditemukan' });
  res.json(pair);
});

// Get L2 Order Book Depth
tradingRouter.get('/depth/:pairId', (req, res) => {
  try {
    const book = matchingEngine.getOrderBook(req.params.pairId);
    const depth = book.getDepth(100);
    res.json(depth);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// Get Recent Trades for a pair (reverse scan for O(recent) performance)
tradingRouter.get('/trades/:pairId', (req, res) => {
  const pairId = req.params.pairId;
  const pairTrades = [];
  for (let i = db.trades.length - 1; i >= 0; i--) {
    const t = db.trades[i];
    if (t && t.pairId === pairId) {
      pairTrades.push(t);
      if (pairTrades.length >= 50) break;
    }
  }
  res.json(pairTrades);
});

// Get Real Candlestick (OHLCV) History for a pair (supports standard array, pagination & Datafeed)
tradingRouter.get('/candles/:pairId', (req, res) => {
  try {
    const pairId = req.params.pairId;
    const resOrTf = (req.query.timeframe as string) || (req.query.resolution as string) || '15m';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : (req.query.countback ? parseInt(req.query.countback as string, 10) : 300);
    const fromSec = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
    const rawTo = req.query.to || req.query.before;
    const toSec = rawTo ? parseInt(rawTo as string, 10) : undefined;

    const candles = klineService.getBars(pairId, resOrTf, fromSec, toSec, limit);

    if (req.query.format === 'udf') {
      if (!candles || candles.length === 0) {
        return res.json({ s: 'no_data', nextTime: undefined });
      }
      return res.json({
        s: 'ok',
        t: candles.map(c => c.time),
        o: candles.map(c => c.open),
        h: candles.map(c => c.high),
        l: candles.map(c => c.low),
        c: candles.map(c => c.close),
        v: candles.map(c => c.volume)
      });
    }

    if (req.query.paginated === '1' || req.query.paginated === 'true') {
      return res.json({
        candles,
        oldestTime: candles.length > 0 ? candles[0].time : null,
        newestTime: candles.length > 0 ? candles[candles.length - 1].time : null,
        hasMore: candles.length >= limit,
      });
    }

    res.json(candles);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// TradingView UDF Server Time
tradingRouter.get('/time', (_req, res) => {
  res.send(Math.floor(Date.now() / 1000).toString());
});

// TradingView UDF Configuration
tradingRouter.get('/config', (_req, res) => {
  res.json({
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [
      { value: 'DIMONEX', name: 'DIMONEX Exchange', desc: 'DIMONEX Centralized Exchange' }
    ],
    symbols_types: [
      { name: 'crypto', value: 'crypto' }
    ],
    supported_resolutions: ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', '1D', '1W', '1M']
  });
});

// Helper to resolve pair from symbol string
function resolvePairFromSymbol(sym: string) {
  let clean = (sym || '').replace(/^DIMONEX:/i, '').trim();
  let pair = db.tradingPairs.get(clean);
  if (pair) return pair;

  // Try replacing / with - or _
  clean = clean.replace('/', '-').replace('_', '-');
  pair = db.tradingPairs.get(clean);
  if (pair) return pair;

  // Search by base/quote
  for (const p of db.tradingPairs.values()) {
    if (
      p.id.toLowerCase() === clean.toLowerCase() ||
      `${p.baseCurrency}/${p.quoteCurrency}`.toLowerCase() === sym.toLowerCase() ||
      `${p.baseCurrency}${p.quoteCurrency}`.toLowerCase() === sym.toLowerCase()
    ) {
      return p;
    }
  }
  return db.tradingPairs.get('BTC-IDR') || Array.from(db.tradingPairs.values())[0];
}

// TradingView UDF Symbol Search
tradingRouter.get('/search', (req, res) => {
  const query = ((req.query.query as string) || '').toLowerCase();
  const results = Array.from(db.tradingPairs.values())
    .filter(p => !query || p.id.toLowerCase().includes(query) || p.baseCurrency.toLowerCase().includes(query))
    .map(p => ({
      symbol: p.id,
      full_name: `DIMONEX:${p.id}`,
      description: `${p.baseCurrency}/${p.quoteCurrency} Spot`,
      exchange: 'DIMONEX',
      ticker: p.id,
      type: 'crypto'
    }));
  res.json(results);
});

// TradingView UDF Symbol Resolve
tradingRouter.get('/symbols', (req, res) => {
  const symbol = req.query.symbol as string;
  const pair = resolvePairFromSymbol(symbol);
  if (!pair) {
    return res.status(404).json({ s: 'error', errmsg: 'Unknown symbol' });
  }

  const baseAsset = db.assets.get(pair.baseCurrency) || Array.from(db.assets.values()).find(a => a.symbol === pair.baseCurrency);
  const minMov = 1;
  const quoteDec = pair.quoteDecimals !== undefined && pair.quoteDecimals !== null ? pair.quoteDecimals : (pair.quoteCurrency === 'IDR' ? 2 : 6);
  const priceScale = pair.quoteCurrency === 'IDR' ? 1 : Math.pow(10, Math.min(8, Math.max(2, quoteDec)));

  res.json({
    name: pair.id,
    ticker: pair.id,
    description: `${pair.baseCurrency}/${pair.quoteCurrency} Spot Market`,
    type: 'crypto',
    session: '24x7',
    exchange: 'DIMONEX',
    listed_exchange: 'DIMONEX',
    timezone: 'Asia/Jakarta',
    minmov: minMov,
    pricescale: priceScale,
    minmov2: 0,
    fractional: false,
    has_intraday: true,
    supported_resolutions: ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', '1D', '1W', '1M'],
    intraday_multipliers: ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720'],
    has_empty_bars: true,
    has_no_volume: false,
    volume_precision: baseAsset?.decimals || 4,
    data_status: 'streaming',
    currency_code: pair.quoteCurrency
  });
});

// TradingView UDF History
tradingRouter.get('/history', (req, res) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-IDR';
    const pair = resolvePairFromSymbol(symbol);
    if (!pair) {
      return res.json({ s: 'no_data' });
    }

    const resolution = (req.query.resolution as string) || '15';
    const fromSec = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
    const toSec = req.query.to ? parseInt(req.query.to as string, 10) : undefined;
    const countback = req.query.countback ? parseInt(req.query.countback as string, 10) : 300;

    const candles = klineService.getBars(pair.id, resolution, fromSec, toSec, countback);

    if (!candles || candles.length === 0) {
      return res.json({ s: 'no_data' });
    }

    res.json({
      s: 'ok',
      t: candles.map(c => c.time),
      o: candles.map(c => c.open),
      h: candles.map(c => c.high),
      l: candles.map(c => c.low),
      c: candles.map(c => c.close),
      v: candles.map(c => c.volume)
    });
  } catch (err: any) {
    res.status(500).json({ s: 'error', errmsg: err.message });
  }
});

// Place New Order
tradingRouter.post('/order', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { pairId, side, orderType, timeInForce, price, quantity, clientOrderId } = req.body;

    if (!pairId || !side || !orderType || !quantity) {
      return res.status(400).json({ error: 'Parameter order tidak lengkap' });
    }

    const targetPair = db.tradingPairs.get(pairId);
    if (targetPair?.isDelisted) {
      return res.status(400).json({
        error: `Market ${pairId} telah di-delisting dari bursa dan tidak lagi menerima order baru.`
      });
    }
    if (targetPair && !targetPair.isActive && targetPair.scheduledAt && targetPair.scheduledAt > Date.now()) {
      return res.status(400).json({
        error: `Market ${pairId} dijadwalkan listing pada ${new Date(targetPair.scheduledAt).toLocaleString('id-ID')}. Trading akan dibuka otomatis setelah countdown selesai.`
      });
    }

    const result = matchingEngine.placeOrder({
      userId: user.id,
      pairId,
      side,
      orderType,
      timeInForce: timeInForce || 'GTC',
      price: price ? String(price) : undefined,
      quantity: String(quantity),
      clientOrderId
    });

    // Broadcast trades via WebSocket
    for (const trade of result.trades) {
      marketWsService.broadcastTrade(trade);
    }

    // Broadcast user order status
    marketWsService.broadcastOrderUpdate(result.takerOrder);
    for (const maker of result.makerOrdersUpdated) {
      marketWsService.broadcastOrderUpdate(maker);
    }

    // Immediately broadcast updated depth to all subscribers
    marketWsService.broadcastDepth(pairId);

    db.scheduleSave();

    res.json({
      success: true,
      order: result.takerOrder,
      trades: result.trades,
      cancelledOrders: result.cancelledOrders
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Helper for cancelling an order
function performCancelOrder(orderId: string, user: any, pairId?: string) {
  const existingOrder = db.orders.get(orderId);
  const resolvedPairId = existingOrder?.pairId || pairId;

  if (!resolvedPairId) {
    throw new Error('orderId tidak ditemukan atau pairId tidak tersedia');
  }

  const cancelledOrder = matchingEngine.cancelOrder(orderId, user.id, resolvedPairId, user.role);
  marketWsService.broadcastOrderUpdate(cancelledOrder);

  // Immediately broadcast updated depth to all subscribers
  marketWsService.broadcastDepth(resolvedPairId);

  db.scheduleSave();
  return cancelledOrder;
}

// Cancel Order via DELETE /order/:orderId
tradingRouter.delete('/order/:orderId', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const orderId = req.params.orderId;
    const pairId = (req.query.pairId as string) || (req.body?.pairId as string);

    const cancelledOrder = performCancelOrder(orderId, user, pairId);

    res.json({
      success: true,
      message: 'Order berhasil dibatalkan',
      order: cancelledOrder
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Cancel Order via POST /order/cancel
tradingRouter.post('/order/cancel', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { orderId, pairId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId wajib diisi' });
    }

    const cancelledOrder = performCancelOrder(orderId, user, pairId);

    res.json({
      success: true,
      message: 'Order berhasil dibatalkan',
      order: cancelledOrder
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get Open Orders for Authenticated User
tradingRouter.get('/orders/open', requireAuth, (req, res) => {
  const user = (req as any).user;
  const role = (user.role || '').toUpperCase();
  const isMMOrAdmin = role === 'MM' || role === 'ADMIN' || role === 'SUPERADMIN';
  const limit = Math.min(500, Math.max(20, parseInt(String(req.query.limit || '200'), 10) || 200));

  const userOpenOrders = [];
  for (const o of db.orders.values()) {
    if (o.status !== 'NEW' && o.status !== 'PARTIALLY_FILLED') continue;
    const isOwner = o.userId === user.id;
    const isMMBotOrder = isMMOrAdmin && Boolean(o.clientOrderId && (o.clientOrderId.startsWith('bot-') || o.clientOrderId.includes('-ord-') || o.clientOrderId.includes('-vol-')));
    if (isOwner || isMMBotOrder) {
      userOpenOrders.push(o);
    }
  }
  userOpenOrders.sort((a, b) => b.createdAt - a.createdAt);

  res.json(userOpenOrders.length > limit ? userOpenOrders.slice(0, limit) : userOpenOrders);
});

// Get Order History for Authenticated User
tradingRouter.get('/orders/history', requireAuth, (req, res) => {
  const user = (req as any).user;
  const limit = Math.min(200, Math.max(10, parseInt(String(req.query.limit || '100'), 10) || 100));
  const userOrders = [];
  for (const o of db.orders.values()) {
    if (o.userId === user.id) {
      userOrders.push(o);
    }
  }
  userOrders.sort((a, b) => b.createdAt - a.createdAt);

  res.json(userOrders.slice(0, limit));
});

// Get Public External Reference Price for Chart Benchmark Overlay
tradingRouter.get('/reference-price/:pairId', async (req, res) => {
  try {
    const { priceAggregatorService } = await import('../services/external/PriceAggregatorService.js');
    const ref = priceAggregatorService.getReferencePrice(req.params.pairId);
    res.json(ref);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Authenticated User's Executed Trades & Real Average Entry Position on a Pair (for Chart Overlays)
tradingRouter.get('/my-trades/:pairId', requireAuth, (req, res) => {
  const user = (req as any).user;
  const pairId = req.params.pairId;
  const pair = db.tradingPairs.get(pairId);
  if (!pair) return res.status(404).json({ error: 'Pair tidak ditemukan' });

  const myTrades = db.trades
    .filter(t => t.pairId === pairId && (t.makerUserId === user.id || t.takerUserId === user.id))
    .slice(-150);

  // Compute exact BigInt weighted average BUY entry & net base position from user's fills
  let buyQtyUnits = 0n;
  let buyQuoteUnits = 0n;
  let sellQtyUnits = 0n;

  const formattedTrades = myTrades.map(t => {
    const isTaker = t.takerUserId === user.id;
    const side: 'BUY' | 'SELL' = isTaker
      ? t.takerSide
      : t.takerSide === 'BUY'
      ? 'SELL'
      : 'BUY';
    const qty = BigInt(t.quantity || '0');
    const qVol = BigInt(t.quoteVolume || '0');
    if (side === 'BUY') {
      buyQtyUnits += qty;
      buyQuoteUnits += qVol;
    } else {
      sellQtyUnits += qty;
    }
    return {
      id: t.id,
      pairId: t.pairId,
      side,
      price: t.price,
      quantity: t.quantity,
      quoteVolume: t.quoteVolume,
      createdAt: t.createdAt,
    };
  });

  const scale = 10n ** BigInt(pair.baseDecimals || 8);
  const avgEntryPriceUnits = buyQtyUnits > 0n ? ((buyQuoteUnits * scale) / buyQtyUnits).toString() : '0';
  const netPositionUnits = (buyQtyUnits - sellQtyUnits).toString();

  res.json({
    pairId,
    trades: formattedTrades,
    avgEntryPriceUnits,
    netPositionUnits,
  });
});

// Chart Drawings Persistence per Authenticated User + Pair
const VALID_DRAWING_TOOLS = new Set([
  'TREND_LINE',
  'HORIZONTAL_LINE',
  'VERTICAL_LINE',
  'RAY',
  'RECTANGLE',
  'BRUSH',
  'TEXT',
  'FIB_RETRACEMENT',
  'FIB_EXTENSION',
  'PRICE_RANGE',
]);

tradingRouter.get('/chart-drawings/:pairId', requireAuth, (req, res) => {
  const user = (req as any).user;
  const key = `${user.id}:${req.params.pairId}`;
  res.json(db.chartDrawings.get(key) || []);
});

tradingRouter.put('/chart-drawings/:pairId', requireAuth, (req, res) => {
  const user = (req as any).user;
  const pairId = req.params.pairId;
  const items = Array.isArray(req.body?.drawings) ? req.body.drawings : Array.isArray(req.body) ? req.body : null;
  if (!items) {
    return res.status(400).json({ error: 'Payload drawings harus berupa array.' });
  }
  if (items.length > 200) {
    return res.status(400).json({ error: 'Maksimal 200 drawing per pair.' });
  }

  const now = Date.now();
  const sanitized: ChartDrawingRecord[] = [];
  for (const raw of items) {
    if (!raw || !VALID_DRAWING_TOOLS.has(raw.tool) || !Array.isArray(raw.points) || raw.points.length === 0) {
      continue;
    }
    const cleanPoints = raw.points
      .slice(0, 500)
      .filter((pt: any) => typeof pt?.time === 'number' && Number.isFinite(pt.time) && typeof pt?.price === 'number' && Number.isFinite(pt.price))
      .map((pt: any) => ({ time: Math.round(pt.time), price: pt.price }));
    if (cleanPoints.length === 0) continue;

    sanitized.push({
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, 64) : `drw-${now}-${sanitized.length}`,
      userId: user.id,
      pairId,
      tool: raw.tool,
      points: cleanPoints,
      color: typeof raw.color === 'string' ? raw.color.slice(0, 24) : '#8DA5B1',
      lineWidth: typeof raw.lineWidth === 'number' ? Math.max(1, Math.min(6, raw.lineWidth)) : 2,
      text: typeof raw.text === 'string' ? raw.text.slice(0, 120) : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
      updatedAt: now,
    });
  }

  db.chartDrawings.set(`${user.id}:${pairId}`, sanitized);
  db.scheduleSave();
  res.json({ success: true, drawings: sanitized });
});

tradingRouter.delete('/chart-drawings/:pairId', requireAuth, (req, res) => {
  const user = (req as any).user;
  db.chartDrawings.delete(`${user.id}:${req.params.pairId}`);
  db.scheduleSave();
  res.json({ success: true, drawings: [] });
});

// User Chart Price Alerts (Strictly ALERT-ONLY action='NONE', Scoped by userId)
tradingRouter.get('/price-alerts/:pairId', requireAuth, (req, res) => {
  const user = (req as any).user;
  const list = priceThresholdService
    .listTriggers(undefined, req.params.pairId)
    .filter(t => t.createdBy === user.id && t.action === 'NONE');
  res.json(list);
});

tradingRouter.post('/price-alerts', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { pairId, condition, thresholdPrice, name } = req.body || {};
    if (!pairId || !thresholdPrice) {
      return res.status(400).json({ error: 'pairId dan thresholdPrice wajib diisi.' });
    }
    const trigger = priceThresholdService.createTrigger({
      name: name || `Alert ${pairId} @ ${thresholdPrice}`,
      pairId,
      environment: 'PRODUCTION',
      condition: condition === 'BELOW_OR_EQUAL' || condition === 'CROSS_DOWN' || condition === 'CROSS_UP' ? condition : 'ABOVE_OR_EQUAL',
      thresholdPrice: String(thresholdPrice),
      soundEnabled: true,
      soundTone: 'CHIME',
      action: 'NONE', // Regular user alerts NEVER manipulate MM bots
      autoResetAfterCooldown: false,
      createdBy: user.id,
    });
    res.status(201).json({ success: true, alert: trigger });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal membuat price alert' });
  }
});

tradingRouter.delete('/price-alerts/:id', requireAuth, (req, res) => {
  const user = (req as any).user;
  const existing = priceThresholdService.listTriggers().find(t => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Alert tidak ditemukan.' });
  if (existing.createdBy !== user.id) {
    return res.status(403).json({ error: 'Tidak diizinkan menghapus alert pengguna lain.' });
  }
  priceThresholdService.deleteTrigger(req.params.id);
  res.json({ success: true });
});


