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

export const tradingRouter = Router();

// Get All Active Trading Pairs
tradingRouter.get('/pairs', (req, res) => {
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

  // Authoritatively compute rolling 24h stats from actual executed trades
  db.recalculatePair24hStats();

  const enrichedPairs = Array.from(db.tradingPairs.values()).map(pair => {
    const market = db.markets.get(pair.id);
    const listing = market
      ? db.listingRequests.get(market.listingRequestId)
      : Array.from(db.listingRequests.values()).find(l => {
          const base = db.assets.get(l.assetId);
          return base && base.symbol === pair.baseCurrency;
        });

    const baseAsset = Array.from(db.assets.values()).find(a => a.symbol === pair.baseCurrency);
    const isNew = pair.baseCurrency === 'SOL' || (listing !== undefined);

    return {
      ...pair,
      isNewListing: isNew,
      listingStatus: listing?.status || (pair.isActive ? 'ACTIVE' : 'PREPARING'),
      depositEnabled: baseAsset?.depositEnabled ?? true,
      withdrawalEnabled: baseAsset?.withdrawalEnabled ?? true,
      depositOpenedAt: baseAsset?.depositOpenedAt || listing?.depositOpenedAt,
      withdrawalOpenedAt: baseAsset?.withdrawalOpenedAt || listing?.withdrawalOpenedAt,
      scheduledAt: listing?.scheduledAt
    };
  });

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

// Get Recent Trades for a pair
tradingRouter.get('/trades/:pairId', (req, res) => {
  const pairTrades = db.trades
    .filter(t => t.pairId === req.params.pairId)
    .slice(-50)
    .reverse();
  res.json(pairTrades);
});

// Get Real Candlestick (OHLCV) History for a pair (supports standard array & Datafeed)
tradingRouter.get('/candles/:pairId', (req, res) => {
  try {
    const pairId = req.params.pairId;
    const resOrTf = (req.query.timeframe as string) || (req.query.resolution as string) || '15m';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : (req.query.countback ? parseInt(req.query.countback as string, 10) : 300);
    const fromSec = req.query.from ? parseInt(req.query.from as string, 10) : undefined;
    const toSec = req.query.to ? parseInt(req.query.to as string, 10) : undefined;

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
    supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W']
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
  const priceScale = pair.quoteCurrency === 'IDR' ? 1 : 100;

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
    supported_resolutions: ['1', '5', '15', '60', '240', '1D', '1W'],
    intraday_multipliers: ['1', '5', '15', '60', '240'],
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

  const userOpenOrders = Array.from(db.orders.values())
    .filter(o => {
      const isOwner = o.userId === user.id;
      const isMMBotOrder = isMMOrAdmin && (o.clientOrderId?.startsWith('bot-') || o.clientOrderId?.includes('-ord-') || o.clientOrderId?.includes('-vol-'));
      return (isOwner || isMMBotOrder) && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED');
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  res.json(userOpenOrders);
});

// Get Order History for Authenticated User
tradingRouter.get('/orders/history', requireAuth, (req, res) => {
  const user = (req as any).user;
  const userOrders = Array.from(db.orders.values())
    .filter(o => o.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);

  res.json(userOrders);
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

