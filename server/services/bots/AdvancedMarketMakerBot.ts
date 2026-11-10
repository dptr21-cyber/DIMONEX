/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AdvancedMarketMakerBot.ts
 * DIMONEX Advanced Market Maker & Multi-Level Liquidity Engine.
 * 
 * Implements:
 * - Dynamic Bid/Ask Management & Multi-Level Order Book Placement
 * - Adaptive Spread Management (Volatility & Regime-Aware)
 * - Avellaneda-Stoikov Inventory Management & Auto-Rebalancing Skew
 * - Real-Time Timeframe Analytics Integration (13 Timeframes & 8 Market Regimes)
 * - Strict Financial Risk Boundaries (Max Inventory, Exposure, Dev Limits, Emergency Stop)
 * - Clean Order Rotation (Anti-Stacking & Idempotent Matching Engine Placement)
 * - Grounded 100% in Authoritative Double-Entry Ledger (Zero Mock/Synthetic Trades)
 */

import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { BotInstance, AdvancedMarketMakerConfig, Order, Trade } from '../../db/types.js';
import { timeframeAnalyticsService, MarketRegimeReport } from '../analytics/TimeframeAnalyticsService.js';

export interface CalculatedLevel {
  level: number;
  side: 'BUY' | 'SELL';
  priceUnits: bigint;
  priceDisplay: string;
  quantityUnits: bigint;
  quantityDisplay: string;
  orderValueQuoteUnits: bigint;
}

export class AdvancedMarketMakerBotExecutor {
  /**
   * Determine pair-specific tick size dynamically based on price magnitude and quote currency
   * to prevent price quantization clustering and duplicate ladder levels.
   */
  public static getTickSize(pair: any, currentPriceNum?: number): number {
    const isUsdtQuote = pair.quoteCurrency === 'USDT' || pair.id?.endsWith('-USDT');
    const quoteDec = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (isUsdtQuote ? 6 : 2);
    const minUnitTick = 1 / (10 ** quoteDec);

    let price = currentPriceNum;
    if (price === undefined || price <= 0) {
      price = pair.lastPrice ? Number(BigInt(pair.lastPrice)) / (10 ** quoteDec) : 10000;
    }

    if (isUsdtQuote) {
      if (price >= 10000) return 0.50;
      if (price >= 1000) return 0.10;
      if (price >= 10) return 0.01;
      if (price >= 1) return 0.001;
      return Math.max(minUnitTick, 0.0001);
    }

    // IDR quote currency
    if (price >= 100000000) return 1000; // e.g. BTC-IDR
    if (price >= 1000000) return 100;    // e.g. ETH-IDR
    if (price >= 50000) return 10;       // e.g. SOL-IDR, ADA-IDR
    if (price >= 100) return 1;          // e.g. USDT-IDR, DOGE-IDR
    if (price >= 1) return 0.1;
    return Math.max(minUnitTick, 0.01);
  }

  /**
   * Safe cancellation of all active orders placed by this bot instance.
   */
  public static cancelOpenOrders(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void,
    reason: string = 'Rotasi Order Siklus MM'
  ): number {
    const cfg = bot.advancedMMConfig;
    let cancelledCount = 0;
    const botUser = bot.accountId || bot.ownerUserId;

    // 1. Cancel known tracked active orders
    const trackedIds = new Set<string>(cfg?.activeOrderIds || []);
    for (const orderId of trackedIds) {
      const order = db.orders.get(orderId);
      if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        try {
          const res = matchingEngine.cancelOrder(orderId, botUser, bot.pairId);
          if (res && res.status === 'CANCELLED') {
            cancelledCount++;
          }
        } catch (e) {}
      }
    }

    // 2. Scan memory book for any orphaned open orders placed by this bot
    for (const order of db.orders.values()) {
      if (
        order.pairId === bot.pairId &&
        order.userId === botUser &&
        (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED') &&
        (order.clientOrderId?.startsWith(`amm-${bot.id.slice(4, 9)}`) || trackedIds.has(order.id))
      ) {
        try {
          const res = matchingEngine.cancelOrder(order.id, botUser, bot.pairId);
          if (res && res.status === 'CANCELLED') {
            cancelledCount++;
          }
        } catch (e) {}
      }
    }

    if (cfg) {
      cfg.activeOrderIds = [];
    }

    if (cancelledCount > 0) {
      addLog(bot, `Membatalkan ${cancelledCount} open limit order (${reason}).`, 'ORDER');
    }

    return cancelledCount;
  }

  /**
   * Main Execution Tick for Advanced Market Maker Bot
   */
  public static executeTick(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): void {
    const cfg = bot.advancedMMConfig;
    if (!cfg) {
      addLog(bot, 'Konfigurasi Advanced MM tidak ditemukan. Melewati siklus.', 'ERROR');
      return;
    }

    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || !pair.isActive || pair.isHalted) {
      addLog(bot, `Trading pair ${bot.pairId} tidak aktif atau sedang di-halt. Menunggu siklus berikutnya...`, 'RISK');
      return;
    }

    // Check emergency stop
    if (cfg.emergency_stop) {
      this.cancelOpenOrders(bot, addLog, 'Emergency Stop Aktif');
      addLog(bot, 'Peringatan: Emergency Stop aktif. Bot dijeda dan seluruh order ditarik.', 'RISK');
      bot.status = 'PAUSED';
      db.scheduleSave();
      return;
    }

    const baseDec = pair.baseDecimals !== undefined ? pair.baseDecimals : 8;
    const quoteDec = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const botUser = bot.accountId || bot.ownerUserId;

    // 1. Fetch live balances for risk & inventory management from authoritative ledger accounts
    const baseAcc = db.createOrGetAccount(botUser, pair.baseCurrency);
    const quoteAcc = db.createOrGetAccount(botUser, pair.quoteCurrency);

    const baseAvailable = Number(BigInt(baseAcc.balanceAvailable || '0')) / (10 ** baseDec);
    const quoteAvailable = Number(BigInt(quoteAcc.balanceAvailable || '0')) / (10 ** quoteDec);

    cfg.lastInventoryBase = baseAvailable.toFixed(baseDec > 4 ? 4 : baseDec);
    cfg.lastInventoryQuote = quoteAvailable.toFixed(pair.quoteCurrency === 'IDR' ? 0 : 2);
    cfg.riskWarnings = [];

    // Check Minimum Available Quote Balance Buffer
    const minQuoteBuffer = parseFloat(cfg.minimum_available_balance_quote || '0');
    if (minQuoteBuffer > 0 && quoteAvailable < minQuoteBuffer) {
      cfg.riskWarnings.push(`Saldo quote tersedia (${quoteAvailable.toFixed(2)}) di bawah batas aman (${minQuoteBuffer.toFixed(2)}). Menahan order beli baru.`);
      addLog(bot, `Saldo quote tersedia (${quoteAvailable.toFixed(2)}) di bawah batas aman (${minQuoteBuffer.toFixed(2)}). Menahan order beli baru.`, 'RISK');
    }

    // 2. Perform Timeframe Analytics & Market Regime Detection
    const analysisTf = cfg.timeframe || '15m';
    const report: MarketRegimeReport = timeframeAnalyticsService.analyze(bot.pairId, analysisTf);
    cfg.lastDetectedRegime = report.regime;
    cfg.lastVolatilityAtrPct = report.indicators.atr14.pctOfPrice;

    // 3. Determine Anchor Reference Price
    // Priority: Orderbook Midpoint -> VWAP -> Last Executed Price
    const depth = matchingEngine.getOrderBook(bot.pairId);
    let referencePrice = report.indicators.currentPrice;

    if (depth && depth.bids.length > 0 && depth.asks.length > 0) {
      const bestBidNum = Number(BigInt(depth.bids[0].price)) / (10 ** quoteDec);
      const bestAskNum = Number(BigInt(depth.asks[0].price)) / (10 ** quoteDec);
      if (bestBidNum > 0 && bestAskNum > bestBidNum) {
        referencePrice = (bestBidNum + bestAskNum) / 2;
      }
    } else if (report.indicators.vwap > 0) {
      referencePrice = report.indicators.vwap;
    }

    if (referencePrice <= 0) {
      referencePrice = pair.lastPrice ? Number(BigInt(pair.lastPrice)) / (10 ** quoteDec) : 10000;
    }

    cfg.lastReferencePrice = referencePrice.toFixed(quoteDec);

    // 4. Calculate Adaptive Spread
    let effectiveSpreadBps = cfg.spread_min_bps || 10; // Default 10 bps (0.10%)
    if (cfg.dynamic_spread_enabled) {
      const minBps = cfg.spread_min_bps || 10;
      const maxBps = cfg.spread_max_bps || 150;

      switch (report.regime) {
        case 'LOW_VOLATILITY':
        case 'SIDEWAYS':
          // Tightest spread to capture maker flow
          effectiveSpreadBps = minBps;
          break;
        case 'CONSOLIDATION':
          effectiveSpreadBps = minBps * 1.25;
          break;
        case 'BULLISH_TREND':
        case 'BEARISH_TREND':
          // Moderate widening along trend
          effectiveSpreadBps = Math.min(maxBps, minBps * 1.5);
          break;
        case 'HIGH_VOLATILITY':
          // Defensive widening
          effectiveSpreadBps = Math.min(maxBps, minBps * 2.2);
          break;
        case 'BREAKOUT':
        case 'REVERSAL':
          // Maximum defensive widening to prevent toxic fills
          effectiveSpreadBps = maxBps;
          break;
        default:
          effectiveSpreadBps = (minBps + maxBps) / 2;
      }
    }
    cfg.lastSpreadBps = Math.round(effectiveSpreadBps);

    // 5. Avellaneda-Stoikov Inventory Skewing
    // If holding too much base inventory compared to maximum_inventory, shift quotes down to encourage fills on Asks (selling)
    // If low on base inventory, shift quotes up to encourage fills on Bids (buying)
    let inventorySkewBps = 0;
    if (cfg.inventory_rebalancing_enabled) {
      const maxInv = parseFloat(cfg.maximum_inventory || '0');
      if (maxInv > 0) {
        const inventoryRatio = baseAvailable / maxInv; // 0.0 to 1.0+
        const targetRatio = 0.50; // Optimal balanced midpoint
        const delta = inventoryRatio - targetRatio; // e.g. +0.3 means over-inventoried
        
        // Skew up to 40 bps
        inventorySkewBps = Math.max(-40, Math.min(40, -delta * 80));
      }
    }

    // Total quote center adjustment in basis points
    const netOffsetBps = (cfg.price_offset_bps || 0) + inventorySkewBps;
    const adjustedCenterPrice = referencePrice * (1 + netOffsetBps / 10000);

    // 6. Build Multi-Level Ladder Quotes
    const tickSize = this.getTickSize(pair, adjustedCenterPrice);
    const bidLevelsCount = Math.min(20, Math.max(1, cfg.bid_levels || 5));
    const askLevelsCount = Math.min(20, Math.max(1, cfg.ask_levels || 5));

    const halfSpreadPct = (effectiveSpreadBps / 2) / 10000;
    const initialBidPrice = Math.floor((adjustedCenterPrice * (1 - halfSpreadPct)) / tickSize) * tickSize;
    const initialAskPrice = Math.ceil((adjustedCenterPrice * (1 + halfSpreadPct)) / tickSize) * tickSize;

    // Spacing delta calculation
    let baseSpacingQuote = tickSize * 2;
    if (cfg.spacing_mode === 'VOLATILITY_ADAPTIVE') {
      const atrVal = report.indicators.atr14.value || (adjustedCenterPrice * 0.005);
      baseSpacingQuote = Math.max(tickSize, (atrVal / 10));
    } else if (cfg.spacing_mode === 'GEOMETRIC') {
      baseSpacingQuote = tickSize * 3;
    } else {
      // LINEAR: spread evenly across a safe 1.5% channel
      baseSpacingQuote = Math.max(tickSize, (adjustedCenterPrice * 0.002));
    }

    const calculatedBids: CalculatedLevel[] = [];
    const calculatedAsks: CalculatedLevel[] = [];

    const baseBidQtyNum = parseFloat(cfg.bid_base_quantity || '0.01');
    const baseAskQtyNum = parseFloat(cfg.ask_base_quantity || '0.01');
    const maxOrderValQuote = parseFloat(cfg.maximum_order_value_quote || '0');
    const maxInventoryNum = parseFloat(cfg.maximum_inventory || '0');

    // Generate Bids (Downwards from initialBidPrice)
    // Check if base inventory is already saturated
    const canPlaceBids = !(cfg.risk_protection_enabled && maxInventoryNum > 0 && baseAvailable >= maxInventoryNum) &&
                         !(minQuoteBuffer > 0 && quoteAvailable < minQuoteBuffer);

    if (canPlaceBids) {
      let prevBidPrice = initialBidPrice;
      for (let i = 1; i <= bidLevelsCount; i++) {
        let levelSpacing = baseSpacingQuote;
        if (cfg.spacing_mode === 'GEOMETRIC') {
          levelSpacing = baseSpacingQuote * (1.15 ** (i - 1));
        }

        const rawPrice = i === 1 ? initialBidPrice : prevBidPrice - levelSpacing;
        const levelPrice = Math.floor(rawPrice / tickSize) * tickSize;
        if (levelPrice <= 0) break;

        // Anti-stacking strictly enforced: ensure strictly decreasing bid prices
        if (i > 1 && levelPrice >= prevBidPrice) {
          continue;
        }
        prevBidPrice = levelPrice;

        // Quantity calculation
        let levelQty = baseBidQtyNum;
        if (cfg.quantity_distribution === 'LINEAR') {
          levelQty = baseBidQtyNum * (1 + (i - 1) * 0.25);
        } else if (cfg.quantity_distribution === 'GEOMETRIC') {
          levelQty = baseBidQtyNum * (1.20 ** (i - 1));
        } else if (cfg.quantity_distribution === 'EXPONENTIAL') {
          levelQty = baseBidQtyNum * (1.40 ** (i - 1));
        }

        // Cap quantity if max_order_value_quote is set
        if (maxOrderValQuote > 0) {
          const orderVal = levelPrice * levelQty;
          if (orderVal > maxOrderValQuote) {
            levelQty = maxOrderValQuote / levelPrice;
          }
        }

        // Check price deviation guard
        if (cfg.maximum_price_deviation_pct && cfg.maximum_price_deviation_pct > 0) {
          const dev = ((referencePrice - levelPrice) / referencePrice) * 100;
          if (dev > cfg.maximum_price_deviation_pct) {
            continue; // Exceeds safe deviation
          }
        }

        const priceUnits = PrecisionMath.parseToUnits(levelPrice.toFixed(quoteDec), quoteDec);
        const qtyUnits = PrecisionMath.parseToUnits(levelQty.toFixed(baseDec), baseDec);
        const orderValQuoteUnits = (priceUnits * qtyUnits) / (10n ** BigInt(baseDec));

        calculatedBids.push({
          level: i,
          side: 'BUY',
          priceUnits,
          priceDisplay: levelPrice.toFixed(quoteDec),
          quantityUnits: qtyUnits,
          quantityDisplay: levelQty.toFixed(baseDec),
          orderValueQuoteUnits: orderValQuoteUnits
        });
      }
    } else {
      cfg.riskWarnings.push(`Batas risiko inventori/saldo tercapai: Order beli ditangguhkan sementara.`);
    }

    // Generate Asks (Upwards from initialAskPrice)
    let prevAskPrice = initialAskPrice;
    for (let i = 1; i <= askLevelsCount; i++) {
      let levelSpacing = baseSpacingQuote;
      if (cfg.spacing_mode === 'GEOMETRIC') {
        levelSpacing = baseSpacingQuote * (1.15 ** (i - 1));
      }

      const rawPrice = i === 1 ? initialAskPrice : prevAskPrice + levelSpacing;
      const levelPrice = Math.ceil(rawPrice / tickSize) * tickSize;
      if (levelPrice <= 0) break;

      // Anti-stacking strictly enforced: ensure strictly increasing ask prices
      if (i > 1 && levelPrice <= prevAskPrice) {
        continue;
      }
      prevAskPrice = levelPrice;

      // Quantity calculation
      let levelQty = baseAskQtyNum;
      if (cfg.quantity_distribution === 'LINEAR') {
        levelQty = baseAskQtyNum * (1 + (i - 1) * 0.25);
      } else if (cfg.quantity_distribution === 'GEOMETRIC') {
        levelQty = baseAskQtyNum * (1.20 ** (i - 1));
      } else if (cfg.quantity_distribution === 'EXPONENTIAL') {
        levelQty = baseAskQtyNum * (1.40 ** (i - 1));
      }

      // Cap single order value
      if (maxOrderValQuote > 0) {
        const orderVal = levelPrice * levelQty;
        if (orderVal > maxOrderValQuote) {
          levelQty = maxOrderValQuote / levelPrice;
        }
      }

      // Check price deviation guard
      if (cfg.maximum_price_deviation_pct && cfg.maximum_price_deviation_pct > 0) {
        const dev = ((levelPrice - referencePrice) / referencePrice) * 100;
        if (dev > cfg.maximum_price_deviation_pct) {
          continue; // Exceeds safe deviation
        }
      }

      const priceUnits = PrecisionMath.parseToUnits(levelPrice.toFixed(quoteDec), quoteDec);
      const qtyUnits = PrecisionMath.parseToUnits(levelQty.toFixed(baseDec), baseDec);
      const orderValQuoteUnits = (priceUnits * qtyUnits) / (10n ** BigInt(baseDec));

      calculatedAsks.push({
        level: i,
        side: 'SELL',
        priceUnits,
        priceDisplay: levelPrice.toFixed(quoteDec),
        quantityUnits: qtyUnits,
        quantityDisplay: levelQty.toFixed(baseDec),
        orderValueQuoteUnits: orderValQuoteUnits
      });
    }

    // 7. Check Total Exposure Cap
    const maxExposureQuote = parseFloat(cfg.maximum_exposure_quote || '0');
    let totalBidLiquidity = 0n;
    let totalAskLiquidity = 0n;

    calculatedBids.forEach(b => { totalBidLiquidity += b.orderValueQuoteUnits; });
    calculatedAsks.forEach(a => { totalAskLiquidity += a.orderValueQuoteUnits; });

    cfg.totalBidLiquidityQuote = (Number(totalBidLiquidity) / (10 ** quoteDec)).toFixed(2);
    cfg.totalAskLiquidityQuote = (Number(totalAskLiquidity) / (10 ** quoteDec)).toFixed(2);

    if (maxExposureQuote > 0) {
      const maxExposureUnits = PrecisionMath.parseToUnits(maxExposureQuote.toString(), quoteDec);
      const combinedTotal = totalBidLiquidity + totalAskLiquidity;
      if (combinedTotal > maxExposureUnits) {
        // Prune outermost levels to stay within exposure cap
        while (calculatedBids.length > 2 && (totalBidLiquidity + totalAskLiquidity) > maxExposureUnits) {
          const removed = calculatedBids.pop();
          if (removed) totalBidLiquidity -= removed.orderValueQuoteUnits;
        }
        while (calculatedAsks.length > 2 && (totalBidLiquidity + totalAskLiquidity) > maxExposureUnits) {
          const removed = calculatedAsks.pop();
          if (removed) totalAskLiquidity -= removed.orderValueQuoteUnits;
        }
      }
    }

    // 8. Order Lifecycle: Cancel stale orders & deploy recalculated ladder
    this.cancelOpenOrders(bot, addLog, `Refresh Siklus (${report.regime}, Spread: ${cfg.lastSpreadBps}bps)`);

    const newOrderIds: string[] = [];
    const botSnippet = bot.id.slice(4, 9);
    const timestamp = Date.now();
    let placedBuys = 0;
    let placedSells = 0;

    // Deploy Bids
    for (const b of calculatedBids) {
      try {
        const clientOrderId = `amm-b${b.level}-${botSnippet}-${timestamp}`;
        const matchRes = matchingEngine.placeOrder({
          userId: botUser,
          pairId: bot.pairId,
          side: 'BUY',
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: b.priceUnits.toString(),
          quantity: b.quantityUnits.toString(),
          clientOrderId
        });

        const orderId = matchRes.takerOrder?.id || (matchRes as any)?.order?.id;
        if (orderId) {
          newOrderIds.push(orderId);
          placedBuys++;
          bot.stats.ordersSubmitted++;
          bot.stats.ordersAccepted++;
          if (!bot.deployedOrderIds.includes(orderId)) {
            bot.deployedOrderIds.push(orderId);
          }
        }
      } catch (err: any) {
        addLog(bot, `Gagal menempatkan Bid L${b.level} @ ${b.priceDisplay}: ${err.message}`, 'ERROR');
      }
    }

    // Deploy Asks
    for (const a of calculatedAsks) {
      try {
        const clientOrderId = `amm-a${a.level}-${botSnippet}-${timestamp}`;
        const matchRes = matchingEngine.placeOrder({
          userId: botUser,
          pairId: bot.pairId,
          side: 'SELL',
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: a.priceUnits.toString(),
          quantity: a.quantityUnits.toString(),
          clientOrderId
        });

        const orderId = matchRes.takerOrder?.id || (matchRes as any)?.order?.id;
        if (orderId) {
          newOrderIds.push(orderId);
          placedSells++;
          bot.stats.ordersSubmitted++;
          bot.stats.ordersAccepted++;
          if (!bot.deployedOrderIds.includes(orderId)) {
            bot.deployedOrderIds.push(orderId);
          }
        }
      } catch (err: any) {
        addLog(bot, `Gagal menempatkan Ask L${a.level} @ ${a.priceDisplay}: ${err.message}`, 'ERROR');
      }
    }

    cfg.activeOrderIds = newOrderIds;
    cfg.lastRepriceTimestamp = Date.now();
    bot.lastHeartbeat = Date.now();

    const summaryMsg = `Siklus MM Sukses: ${placedBuys} Bids [${calculatedBids[0]?.priceDisplay || '-'} .. ${calculatedBids[calculatedBids.length - 1]?.priceDisplay || '-'}] & ${placedSells} Asks [${calculatedAsks[0]?.priceDisplay || '-'} .. ${calculatedAsks[calculatedAsks.length - 1]?.priceDisplay || '-'}] | Ref: ${referencePrice.toFixed(quoteDec)} | Regime: ${report.regime} (${report.confidenceScorePct}%) | Spread: ${cfg.lastSpreadBps}bps | Skew: ${inventorySkewBps >= 0 ? '+' : ''}${inventorySkewBps}bps`;
    
    addLog(bot, summaryMsg, 'INFO');
    db.scheduleSave();
  }

  /**
   * Return comprehensive monitoring payload for the MM Admin Dashboard
   */
  public static getMonitoringState(bot: BotInstance) {
    const cfg = bot.advancedMMConfig;
    const pair = db.tradingPairs.get(bot.pairId);
    const quoteDec = pair ? (pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2)) : 2;
    const baseDec = pair ? pair.baseDecimals : 8;

    const depth = matchingEngine.getOrderBook(bot.pairId);
    let bestBid = '-';
    let bestAsk = '-';
    let currentSpread = '-';
    let currentSpreadBps = 0;

    if (depth && depth.bids.length > 0) {
      bestBid = (Number(BigInt(depth.bids[0].price)) / (10 ** quoteDec)).toFixed(quoteDec);
    }
    if (depth && depth.asks.length > 0) {
      bestAsk = (Number(BigInt(depth.asks[0].price)) / (10 ** quoteDec)).toFixed(quoteDec);
    }
    if (depth && depth.bids.length > 0 && depth.asks.length > 0) {
      const bidNum = Number(BigInt(depth.bids[0].price)) / (10 ** quoteDec);
      const askNum = Number(BigInt(depth.asks[0].price)) / (10 ** quoteDec);
      const spreadVal = askNum - bidNum;
      currentSpread = spreadVal.toFixed(quoteDec);
      if (bidNum > 0) {
        currentSpreadBps = Math.round((spreadVal / bidNum) * 10000);
      }
    }

    // Active orders details
    const activeOrdersList: any[] = [];
    if (cfg?.activeOrderIds) {
      for (const orderId of cfg.activeOrderIds) {
        const ord = db.orders.get(orderId);
        if (ord && (ord.status === 'NEW' || ord.status === 'PARTIALLY_FILLED')) {
          activeOrdersList.push({
            id: ord.id,
            side: ord.side,
            price: (Number(BigInt(ord.price)) / (10 ** quoteDec)).toFixed(quoteDec),
            quantity: (Number(BigInt(ord.quantity)) / (10 ** baseDec)).toFixed(baseDec),
            filled: (Number(BigInt(ord.filledQuantity || '0')) / (10 ** baseDec)).toFixed(baseDec),
            status: ord.status,
            createdAt: ord.createdAt
          });
        }
      }
    }

    const analysis = timeframeAnalyticsService.analyze(bot.pairId, cfg?.timeframe || '15m');

    return {
      botId: bot.id,
      name: bot.name,
      pairId: bot.pairId,
      status: bot.status,
      currentMarketPrice: (Number(BigInt(pair?.lastPrice || '0')) / (10 ** quoteDec)).toFixed(quoteDec),
      bestBid,
      bestAsk,
      currentSpread,
      currentSpreadBps,
      totalBidLiquidity: cfg?.totalBidLiquidityQuote || '0',
      totalAskLiquidity: cfg?.totalAskLiquidityQuote || '0',
      activeOrdersCount: activeOrdersList.length,
      activeOrders: activeOrdersList,
      filledOrdersCount: bot.stats.ordersFilled,
      availableInventoryBase: cfg?.lastInventoryBase || '0',
      availableInventoryQuote: cfg?.lastInventoryQuote || '0',
      currentVolatilityAtr: analysis.indicators.atr14.value.toFixed(quoteDec),
      currentVolatilityPct: analysis.indicators.atr14.pctOfPrice.toFixed(2),
      detectedMarketRegime: analysis.regime,
      regimeConfidence: analysis.confidenceScorePct,
      regimeSummary: analysis.summary,
      lastExecutionTimestamp: cfg?.lastRepriceTimestamp || 0,
      riskWarnings: cfg?.riskWarnings || [],
      indicators: analysis.indicators,
      stats: bot.stats,
      logs: bot.logs.slice(0, 30)
    };
  }
}
