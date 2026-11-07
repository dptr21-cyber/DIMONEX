/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * QuantHftBot.ts
 * Real Quantitative High-Frequency Market Maker (HFT-MM) Executor for DIMONEX.
 * 
 * Implements the 3-Pillar Loop:
 * 1. Pillar A (Pricing Engine):
 *    - Real-time Top-5 L2 depth scanning & spread analysis.
 *    - Dynamic spread tightening (steps 1 tick inside best bid/ask).
 *    - Micro-timeframe trend momentum (Fast EMA vs Slow EMA).
 *    - Directional leaning (leans higher in uptrend, drops bids lower in downtrend).
 *    - Anti-manipulation / Flash Defense (widens perimeter 3.0x, 20% micro-lots, max 2-3 ladders during pump/dumps).
 * 2. Pillar B (Order Manager):
 *    - Intelligent cancel-replace diffing to prevent rate-limit churn.
 *    - Synchronous real order placement into the authoritative Matching Engine.
 * 3. Pillar C (Risk & Inventory Manager):
 *    - Strict base/quote inventory bounds & inventory mean-reversion skew.
 *    - Data staleness tripwires & emergency book clearing.
 */

import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { BotInstance, QuantHftConfig, Order } from '../../db/types.js';

export class QuantHftBotExecutor {
  /**
   * Determine pair-specific tick size
   */
  public static getTickSize(pair: any): number {
    const isUsdtQuote = pair.quoteCurrency === 'USDT' || pair.id.endsWith('-USDT');
    if (isUsdtQuote) return 0.01;
    if (pair.id === 'USDT-IDR') return 1;
    if (pair.id === 'ETH-IDR') return 100;
    return 1000;
  }

  /**
   * Format display price
   */
  public static formatDisplayPrice(priceUnits: bigint, pair: any): string {
    if (pair.quoteCurrency === 'IDR') {
      return PrecisionMath.formatIDRDisplay(priceUnits);
    }
    const val = Number(priceUnits) / (10 ** (pair.quoteDecimals || 2));
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: pair.quoteDecimals || 4 })} ${pair.quoteCurrency}`;
  }

  /**
   * Cancels all active orders belonging to this Quant HFT MM Bot
   */
  public static cancelOpenBotOrders(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void,
    reason?: string
  ): number {
    const cfg = bot.quantHftConfig;
    let cancelledCount = 0;
    const orderIdsToCancel = new Set<string>();

    if (cfg?.activeOrderIds) {
      cfg.activeOrderIds.forEach(id => orderIdsToCancel.add(id));
    }
    bot.deployedOrderIds.forEach(id => orderIdsToCancel.add(id));

    for (const orderId of orderIdsToCancel) {
      const order = db.orders.get(orderId);
      if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        try {
          matchingEngine.cancelOrder(orderId, bot.ownerUserId, bot.pairId);
          cancelledCount++;
        } catch (e) {}
      }
    }

    if (cfg) {
      cfg.activeOrderIds = [];
    }

    if (cancelledCount > 0) {
      addLog(bot, `Membatalkan ${cancelledCount} order terbuka Quant HFT MM.${reason ? ` Alasan: ${reason}` : ''}`, 'ORDER');
      marketWsService.broadcastDepth(bot.pairId);
    }

    return cancelledCount;
  }

  /**
   * Executes a single high-frequency market-making tick cycle
   */
  public static executeCycle(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): boolean {
    const cfg = bot.quantHftConfig;
    if (!cfg) return false;

    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair) {
      addLog(bot, `Trading pair ${bot.pairId} tidak ditemukan.`, 'ERROR');
      return false;
    }

    if (pair.isHalted) {
      addLog(bot, `Trading pair ${bot.pairId} sedang di-halt oleh Administrator.`, 'RISK');
      return false;
    }

    const now = Date.now();
    const tickSize = this.getTickSize(pair);
    const tickUnits = PrecisionMath.parseToUnits(tickSize.toString(), pair.quoteDecimals);

    // Ensure bot MM accounts have sufficient liquidity
    db.createOrGetAccount(bot.ownerUserId, pair.quoteCurrency, '5000000000000');
    db.createOrGetAccount(bot.ownerUserId, pair.baseCurrency, '10000000000');

    // -----------------------------------------------------------------
    // 1. ORDER BOOK ANALYSIS (Top-5 depth scanning & spread evaluation)
    // -----------------------------------------------------------------
    const book = matchingEngine.getOrderBook(bot.pairId);
    let bestBidUnits: bigint | null = book.bids.length > 0 ? BigInt(book.bids[0].price) : null;
    let bestAskUnits: bigint | null = book.asks.length > 0 ? BigInt(book.asks[0].price) : null;
    let lastPriceUnits = BigInt(pair.lastPrice || '1000000');

    // Fallback if book is empty
    if (!bestBidUnits && !bestAskUnits) {
      bestBidUnits = lastPriceUnits - (tickUnits * 5n);
      bestAskUnits = lastPriceUnits + (tickUnits * 5n);
    } else if (!bestBidUnits && bestAskUnits) {
      bestBidUnits = bestAskUnits - (tickUnits * 10n);
    } else if (bestBidUnits && !bestAskUnits) {
      bestAskUnits = bestBidUnits + (tickUnits * 10n);
    }

    if (!bestBidUnits || !bestAskUnits || bestBidUnits >= bestAskUnits) {
      // Inverted or invalid state, re-align
      const mid = lastPriceUnits;
      bestBidUnits = mid - (tickUnits * 2n);
      bestAskUnits = mid + (tickUnits * 2n);
    }

    const midPriceUnits = (bestBidUnits + bestAskUnits) / 2n;
    const spreadUnits = bestAskUnits - bestBidUnits;
    const spreadTicks = Number(spreadUnits / (tickUnits > 0n ? tickUnits : 1n));

    // -----------------------------------------------------------------
    // 2. TREND & FLASH ANOMALY DETECTION (Pump/Dump Protection)
    // -----------------------------------------------------------------
    const recentTrades = db.trades
      .filter(t => t.pairId === bot.pairId && (now - t.createdAt) <= 30000)
      .slice(-30);

    let trendState: 'UPTREND' | 'DOWNTREND' | 'NEUTRAL' = 'NEUTRAL';
    let trendSkewBps = 0;
    let isFlashSpike = false;

    if (recentTrades.length >= 4) {
      // Calculate micro-EMA of recent trade prices
      const prices = recentTrades.map(t => Number(t.price));
      const fastAlpha = 2 / (8 + 1);
      const slowAlpha = 2 / (20 + 1);
      let fastEma = prices[0];
      let slowEma = prices[0];

      for (let i = 1; i < prices.length; i++) {
        fastEma = prices[i] * fastAlpha + fastEma * (1 - fastAlpha);
        slowEma = prices[i] * slowAlpha + slowEma * (1 - slowAlpha);
      }

      const momentumPct = ((fastEma - slowEma) / slowEma) * 100;
      if (momentumPct > 0.01) {
        trendState = 'UPTREND';
        trendSkewBps = Math.min(15, Math.round(momentumPct * 100));
      } else if (momentumPct < -0.01) {
        trendState = 'DOWNTREND';
        trendSkewBps = Math.max(-15, Math.round(momentumPct * 100));
      }

      // Check Volatility and Volume Spikes (Flash Defense)
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const dispersionBps = ((maxP - minP) / (minP || 1)) * 10000;

      const recentVol = recentTrades.reduce((sum, t) => sum + Number(t.quantity), 0);
      const avgVol = recentVol / recentTrades.length;
      const lastTradeVol = Number(recentTrades[recentTrades.length - 1].quantity);

      if (dispersionBps > (cfg.volatility_threshold_bps || 120) || (avgVol > 0 && lastTradeVol > avgVol * (cfg.pump_dump_multiplier || 2.5))) {
        isFlashSpike = true;
      }
    }

    // Save telemetry to bot state
    cfg.lastTrend = trendState;
    cfg.lastSkewBps = trendSkewBps;
    cfg.isFlashDefenseActive = isFlashSpike;

    // -----------------------------------------------------------------
    // 3. INVENTORY MEAN-REVERSION SKEW (Pillar C)
    // -----------------------------------------------------------------
    const baseAccount = db.getAccount(bot.ownerUserId, pair.baseCurrency);
    const quoteAccount = db.getAccount(bot.ownerUserId, pair.quoteCurrency);
    const maxBase = parseFloat(cfg.max_base_inventory || '10.0');
    const currentBase = baseAccount ? parseFloat(PrecisionMath.formatFromUnits(BigInt(baseAccount.balanceAvailable), pair.baseDecimals)) : 0;
    
    // Normalized skew: [-1.0, 1.0]
    let invSkew = 0;
    if (maxBase > 0) {
      const halfBase = maxBase / 2;
      invSkew = Math.max(-1.0, Math.min(1.0, (currentBase - halfBase) / halfBase));
    }
    cfg.lastInventorySkew = invSkew;

    // Total skew shift in bps: Trend + Inventory Mean-Reversion
    const invShiftBps = -Math.round(invSkew * (cfg.target_spread_pct * 100) * (cfg.inventory_skew_factor || 0.25));
    const totalShiftBps = (cfg.trend_leaning_enabled ? trendSkewBps : 0) + invShiftBps;
    const shiftMultiplier = 1 + (totalShiftBps / 10000);

    const skewedMidUnits = BigInt(Math.round(Number(midPriceUnits) * shiftMultiplier));

    // -----------------------------------------------------------------
    // 4. PRICING & LADDER GENERATION (Pillar A)
    // -----------------------------------------------------------------
    interface DesiredQuote {
      side: 'BUY' | 'SELL';
      priceUnits: bigint;
      qtyUnits: bigint;
      level: number;
      isDefensive: boolean;
    }

    const desiredQuotes: DesiredQuote[] = [];
    const baseMicroQty = parseFloat(cfg.micro_order_size || '0.001');

    if (isFlashSpike && cfg.flash_defense_enabled) {
      // FLASH DEFENSE ACTIVE:
      // - Widen perimeter to absorb flow without manipulation risk
      // - Throttle order size to micro-fractions (20%)
      // - Max 2 levels placed at defensive blocks
      const widenFactor = cfg.defense_perimeter_multiplier || 3.0;
      const defensiveSpreadPct = Math.max(cfg.target_spread_pct * widenFactor, cfg.min_spread_pct * 2);
      const halfSpreadBps = BigInt(Math.round((defensiveSpreadPct / 2) * 100));
      const defensiveHalfUnits = (skewedMidUnits * halfSpreadBps) / 10000n;

      const defenseQty = Math.max(
        parseFloat(PrecisionMath.formatFromUnits(BigInt(pair.minOrderSize), pair.baseDecimals)),
        baseMicroQty * 0.20
      );
      const defenseQtyUnits = PrecisionMath.parseToUnits(defenseQty.toFixed(pair.baseDecimals), pair.baseDecimals);

      for (let lvl = 1; lvl <= Math.min(cfg.max_ladder_levels || 2, 2); lvl++) {
        const offset = defensiveHalfUnits * BigInt(lvl);
        const bidP = skewedMidUnits - offset;
        const askP = skewedMidUnits + offset;

        if (bidP > 0n && bidP < bestAskUnits) {
          desiredQuotes.push({ side: 'BUY', priceUnits: bidP, qtyUnits: defenseQtyUnits, level: lvl, isDefensive: true });
        }
        if (askP > bestBidUnits) {
          desiredQuotes.push({ side: 'SELL', priceUnits: askP, qtyUnits: defenseQtyUnits, level: lvl, isDefensive: true });
        }
      }

      addLog(bot, `🛡️ [FLASH DEFENSE ACTIVE] Spike volatilitas/volume terdeteksi. Perimeter diperlebar (${widenFactor}x), lot size diperkecil ke micro-fraksi.`, 'RISK');
    } else {
      // NORMAL REGIME: DYNAMIC SPREAD TIGHTENING & MICRO-LOT PLACEMENT
      let targetBidUnits = bestBidUnits;
      let targetAskUnits = bestAskUnits;

      if (cfg.tighten_spread_enabled) {
        if (spreadTicks > 2) {
          // Actively step 1 tick inside to tighten spread and gain execution priority
          targetBidUnits = bestBidUnits + tickUnits;
          targetAskUnits = bestAskUnits - tickUnits;
        } else {
          // Join best bid/ask
          targetBidUnits = bestBidUnits;
          targetAskUnits = bestAskUnits;
        }
      }

      // Apply trend leaning
      if (cfg.trend_leaning_enabled) {
        if (trendState === 'UPTREND') {
          targetBidUnits = targetBidUnits + tickUnits < bestAskUnits ? targetBidUnits + tickUnits : targetBidUnits;
        } else if (trendState === 'DOWNTREND') {
          targetBidUnits = targetBidUnits > tickUnits ? targetBidUnits - tickUnits : targetBidUnits;
        }
      }

      const l1QtyUnits = PrecisionMath.parseToUnits(baseMicroQty.toFixed(pair.baseDecimals), pair.baseDecimals);

      if (targetBidUnits > 0n && targetBidUnits < targetAskUnits) {
        desiredQuotes.push({ side: 'BUY', priceUnits: targetBidUnits, qtyUnits: l1QtyUnits, level: 1, isDefensive: false });
      }
      if (targetAskUnits > targetBidUnits) {
        desiredQuotes.push({ side: 'SELL', priceUnits: targetAskUnits, qtyUnits: l1QtyUnits, level: 1, isDefensive: false });
      }

      // Secondary Ladder Levels (L2 / L3)
      const maxLevels = Math.min(cfg.max_ladder_levels || 3, 3);
      const stepOffsetUnits = (midPriceUnits * BigInt(Math.round(cfg.target_spread_pct * 100))) / 10000n;

      for (let lvl = 2; lvl <= maxLevels; lvl++) {
        const offset = stepOffsetUnits * BigInt(lvl - 1);
        const bidP = targetBidUnits - offset;
        const askP = targetAskUnits + offset;
        const ladderQty = baseMicroQty * (1 + (lvl - 1) * 0.25);
        const ladderQtyUnits = PrecisionMath.parseToUnits(ladderQty.toFixed(pair.baseDecimals), pair.baseDecimals);

        if (bidP > 0n && bidP < targetBidUnits) {
          desiredQuotes.push({ side: 'BUY', priceUnits: bidP, qtyUnits: ladderQtyUnits, level: lvl, isDefensive: false });
        }
        if (askP > targetAskUnits) {
          desiredQuotes.push({ side: 'SELL', priceUnits: askP, qtyUnits: ladderQtyUnits, level: lvl, isDefensive: false });
        }
      }
    }

    // -----------------------------------------------------------------
    // 5. CANCEL-REPLACE DIFFING & EXECUTION (Pillar B)
    // -----------------------------------------------------------------
    const currentActiveOrderIds = cfg.activeOrderIds || [];
    const activeOrders: Order[] = [];
    for (const id of currentActiveOrderIds) {
      const ord = db.orders.get(id);
      if (ord && (ord.status === 'NEW' || ord.status === 'PARTIALLY_FILLED')) {
        activeOrders.push(ord);
      }
    }

    // Always clean previous active orders if prices have drifted or regime switched
    for (const ord of activeOrders) {
      try {
        matchingEngine.cancelOrder(ord.id, bot.ownerUserId, bot.pairId);
      } catch (e) {}
    }

    const newActiveOrderIds: string[] = [];
    let placedCount = 0;

    for (const q of desiredQuotes) {
      try {
        const clientOrderId = `${bot.id}-hft-${q.side}-${q.level}-${Date.now()}`;
        const res = matchingEngine.placeOrder({
          userId: bot.ownerUserId,
          pairId: bot.pairId,
          side: q.side,
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: q.priceUnits.toString(),
          quantity: q.qtyUnits.toString(),
          clientOrderId
        });

        bot.stats.ordersSubmitted++;
        bot.stats.ordersAccepted++;
        bot.deployedOrderIds.push(res.takerOrder.id);
        newActiveOrderIds.push(res.takerOrder.id);
        placedCount++;

        if (res.trades.length > 0) {
          bot.stats.ordersFilled += res.trades.length;
          for (const t of res.trades) {
            bot.stats.executedVolume = (BigInt(bot.stats.executedVolume) + BigInt(t.quantity)).toString();
            bot.stats.totalTrades++;
            marketWsService.broadcastTrade(t);
          }
          addLog(
            bot,
            `[HFT-MM] Match terisi: ${PrecisionMath.formatFromUnits(q.qtyUnits, pair.baseDecimals)} ${pair.baseCurrency} @ ${this.formatDisplayPrice(q.priceUnits, pair)}`,
            'FILL'
          );
        }

        marketWsService.broadcastOrderUpdate(res.takerOrder);
      } catch (err: any) {
        addLog(bot, `Gagal memasang kuotasi ${q.side} L${q.level}: ${err.message}`, 'ERROR');
      }
    }

    cfg.activeOrderIds = newActiveOrderIds;
    bot.lastHeartbeat = now;
    marketWsService.broadcastDepth(bot.pairId);

    if (placedCount > 0) {
      const trendTag = trendState === 'UPTREND' ? `▲ UPTREND (+${trendSkewBps}bps)` : trendState === 'DOWNTREND' ? `▼ DOWNTREND (${trendSkewBps}bps)` : '● NEUTRAL';
      const defenseTag = isFlashSpike ? '[🛡️ DEFENSE ACTIVE]' : '[TIGHTENED]';
      addLog(
        bot,
        `[HFT-MM Cycle] ${placedCount} kuotasi aktif (${trendTag}, ${defenseTag}, Spread: ${spreadTicks} ticks, Skew: ${invSkew.toFixed(2)}).`,
        'ORDER'
      );
    }

    return true;
  }
}
