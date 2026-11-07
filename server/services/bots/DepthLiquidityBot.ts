/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DepthLiquidityBot.ts
 * Real Multi-Level Depth & Liquidity Market-Making Bot for DIMONEX.
 * Deploys multiple authentic bid and ask ladder levels directly into the single-threaded Matching Engine.
 * 
 * Capabilities:
 * - Dual Price Modes:
 *   1. EXTERNAL_REFERENCE: Follows real Binance / Bybit / CMC feeds with FX conversion.
 *   2. CUSTOM_BOUNDS (Autonomous): Set explicit Min/Max Buy and Min/Max Sell bounds without depending on external feeds. Perfect for new tokens, listing launches, or custom range market-making.
 * - Spacing Ladder Modes:
 *   - LINEAR: Evenly distributed ladder rungs from min to max range.
 *   - GEOMETRIC: Progressively widening rungs for deep book risk protection.
 *   - CONCENTRATED: Tight liquidity clustered near the spread.
 *   - FIXED_IDR / FIXED_STEP: Constant currency offset per rung.
 *   - PERCENT_BPS: Custom basis points ladder configuration.
 * - Anti-Numpuk / Anti-Stacking:
 *   - Strictly prevents order stacking at identical prices.
 *   - Clean cancel-and-replace sweep cleans previous cycles before placing new rungs.
 *   - Set-based deduplication and strictly monotonic ladder dispersion.
 *   - Anti-crossing guarantee (Max Buy strictly below Min Sell).
 * - Full Token & Multi-Pair Support:
 *   - Pair-aware quoting (IDR and USDT quote currencies).
 *   - Compatible with ALL active markets (BTC, ETH, SOL, DOGE, ADA, and newly listed tokens).
 */

import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { priceAggregatorService } from '../external/PriceAggregatorService.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { BotInstance, DepthLiquidityConfig, Order } from '../../db/types.js';

export class DepthLiquidityBotExecutor {
  /**
   * Determine market-compatible tick size based on trading pair and quote currency
   */
  public static getCompatibleTickSize(pairId: string, configuredTickSize?: number): number {
    const pair = db.tradingPairs.get(pairId);
    const isUsdtQuote = pair?.quoteCurrency === 'USDT' || pairId.endsWith('-USDT');

    if (configuredTickSize && configuredTickSize > 0) {
      if (isUsdtQuote && configuredTickSize > 10) {
        return 0.01;
      }
      if (pairId === 'USDT-IDR' && configuredTickSize > 60) {
        return 1;
      }
      return configuredTickSize;
    }

    if (isUsdtQuote) {
      return 0.01;
    }
    return pairId === 'USDT-IDR' ? 1 : pairId === 'ETH-IDR' ? 100 : 1000;
  }

  /**
   * Format display price according to pair's quote currency
   */
  private static formatDisplayPrice(priceUnits: bigint, pair: any): string {
    if (pair.quoteCurrency === 'IDR') {
      return PrecisionMath.formatIDRDisplay(priceUnits);
    }
    const val = Number(priceUnits) / (10 ** (pair.quoteDecimals || 2));
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: pair.quoteDecimals || 4 })} ${pair.quoteCurrency}`;
  }

  /**
   * Execute a single cycle for a Depth & Liquidity Bot
   */
  public static executeCycle(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): boolean {
    const cfg = bot.depthLiquidityConfig;
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
    const tickSize = this.getCompatibleTickSize(bot.pairId, cfg.tick_size);
    const numBids = Math.min(20, Math.max(1, cfg.number_of_bid_levels || 5));
    const numAsks = Math.min(20, Math.max(1, cfg.number_of_ask_levels || 5));
    const isRandomizeEnabled = cfg.randomize_placement_enabled !== false;
    const maxJitterTicks = isRandomizeEnabled
      ? (cfg.price_randomization_ticks !== undefined ? Math.max(1, cfg.price_randomization_ticks) : (bot.pairId === 'USDT-IDR' ? 2 : 2))
      : 0;

    // Check if Custom Bounds Mode is active (explicit or filled min/max bounds)
    const isCustomBounds = cfg.price_mode === 'CUSTOM_BOUNDS' ||
      cfg.reference_price_source === 'NONE' ||
      Boolean(
        cfg.min_limit_buy_price &&
        cfg.max_limit_buy_price &&
        cfg.min_limit_sell_price &&
        cfg.max_limit_sell_price
      );

    let baseRefPrice = 0;
    let minBuyPrice = 0;
    let maxBuyPrice = 0;
    let minSellPrice = 0;
    let maxSellPrice = 0;

    if (isCustomBounds) {
      // MODE 1: CUSTOM BOUNDS (Tidak mengikuti harga eksternal apapun - ideal untuk token baru)
      minBuyPrice = parseFloat(String(cfg.min_limit_buy_price || '0'));
      maxBuyPrice = parseFloat(String(cfg.max_limit_buy_price || '0'));
      minSellPrice = parseFloat(String(cfg.min_limit_sell_price || '0'));
      maxSellPrice = parseFloat(String(cfg.max_limit_sell_price || '0'));

      if (isNaN(minBuyPrice) || isNaN(maxBuyPrice) || isNaN(minSellPrice) || isNaN(maxSellPrice) ||
          minBuyPrice <= 0 || maxBuyPrice <= 0 || minSellPrice <= 0 || maxSellPrice <= 0) {
        addLog(
          bot,
          `Batas harga kustom tidak valid (MinBuy: ${minBuyPrice}, MaxBuy: ${maxBuyPrice}, MinSell: ${minSellPrice}, MaxSell: ${maxSellPrice}). Penyesuaian likuiditas ditangguhkan.`,
          'RISK'
        );
        return false;
      }

      if (minBuyPrice > maxBuyPrice) {
        const tmp = minBuyPrice; minBuyPrice = maxBuyPrice; maxBuyPrice = tmp;
      }
      if (minSellPrice > maxSellPrice) {
        const tmp = minSellPrice; minSellPrice = maxSellPrice; maxSellPrice = tmp;
      }

      // Anti-Crossing Protection: Ensure Max Buy is strictly lower than Min Sell
      if (maxBuyPrice >= minSellPrice) {
        maxBuyPrice = Math.max(minBuyPrice, minSellPrice - tickSize);
        addLog(
          bot,
          `[Anti-Crossing] Max Buy disesuaikan menjadi ${maxBuyPrice} agar berada di bawah Min Sell (${minSellPrice}).`,
          'INFO'
        );
      }

      baseRefPrice = (maxBuyPrice + minSellPrice) / 2;
    } else {
      // MODE 2: EXTERNAL REFERENCE (Binance / Bybit / CoinMarketCap / Aggregated)
      const refData = priceAggregatorService.getReferencePrice(bot.pairId);

      if (refData.status === 'REFERENCE_PRICE_UNAVAILABLE' || refData.isStale || refData.effectiveIdrPrice <= 0) {
        addLog(
          bot,
          `Harga referensi eksternal tidak valid atau STALE (${refData.rejectionReason || 'Stale data'}). Penyesuaian likuiditas ditangguhkan.`,
          'RISK'
        );
        this.cancelOpenDepthOrders(bot, addLog, 'Feed harga eksternal stale');
        return false;
      }

      baseRefPrice = refData.effectiveIdrPrice;
      if (cfg.reference_price_source === 'BINANCE' && refData.binancePrice) {
        baseRefPrice = Math.round(refData.binancePrice * refData.fxRateUsed);
      } else if (cfg.reference_price_source === 'BYBIT' && refData.bybitPrice) {
        baseRefPrice = Math.round(refData.bybitPrice * refData.fxRateUsed);
      } else if (cfg.reference_price_source === 'COINMARKETCAP' && refData.cmcPrice) {
        baseRefPrice = Math.round(refData.cmcPrice * refData.fxRateUsed);
      }
    }

    const roundedRefPrice = Math.round(baseRefPrice / tickSize) * tickSize;

    // Refresh Cooldown Logic
    const cooldownSec = Math.max(3, cfg.liquidity_refresh_cooldown_sec || Math.round((cfg.minimum_reprice_interval_ms || 3000) / 1000) || 10);
    const cooldownMs = cooldownSec * 1000;
    const lastRefresh = cfg.last_refresh_timestamp || cfg.lastRepriceTimestamp || 0;
    const isCooldownElapsed = (now - lastRefresh >= cooldownMs);

    // Dynamic Micro-Jitter (breathes naturally without static price placement)
    const jitterDirection = (Math.random() >= 0.5 ? 1 : -1);
    const jitterAmount = isRandomizeEnabled ? Math.floor(Math.random() * (maxJitterTicks + 1)) : 0;
    const dynamicPriceOffset = jitterDirection * jitterAmount * tickSize;
    const dynamicRef = roundedRefPrice + dynamicPriceOffset;

    // Check existing live orders on the order book
    const book = matchingEngine.getOrderBook(bot.pairId);
    const botPrefix = `bot-dp-${bot.id.slice(4, 10)}`;
    const currentLiveBotOrders = [...book.bids, ...book.asks].filter(
      o => o.userId === bot.accountId || (o.clientOrderId && o.clientOrderId.startsWith(botPrefix))
    );

    const hasLiveOrders = currentLiveBotOrders.length > 0;
    const lastTarget = (cfg as any).lastTargetPrice || roundedRefPrice;
    const priceDriftTicks = Math.abs(roundedRefPrice - lastTarget) / tickSize;
    const significantPriceMove = priceDriftTicks >= 4;

    if (!isCooldownElapsed && hasLiveOrders && !significantPriceMove) {
      return true;
    }

    // Provision sufficient test / MM accounts
    db.createOrGetAccount(bot.accountId, pair.quoteCurrency, '10000000000000');
    db.createOrGetAccount(bot.accountId, pair.baseCurrency, '1000000000000');
    const quoteAccount = db.createOrGetAccount(bot.accountId, pair.quoteCurrency);
    const baseAccount = db.createOrGetAccount(bot.accountId, pair.baseCurrency);
    let quoteAvailable = BigInt(quoteAccount.balanceAvailable);
    let baseAvailable = BigInt(baseAccount.balanceAvailable);
    const baseDecimals = pair.baseDecimals;
    const quoteDecimals = pair.quoteDecimals || 2;

    // ANTI-STACKING: Cleanly cancel all prior rungs from this bot before placing the new ladder
    if (!cfg.dry_run) {
      this.cancelOpenDepthOrders(bot, addLog, 'Rotasi & penyegaran ladder likuiditas anti-stacking');
    }

    const newActiveOrderIds: string[] = [];
    const usedBidPriceUnits = new Set<string>();
    const usedAskPriceUnits = new Set<string>();

    const spacingMode = cfg.spacing_mode || (isCustomBounds ? 'LINEAR' : (bot.pairId === 'USDT-IDR' ? 'FIXED_IDR' : 'PERCENT_BPS'));
    const defaultSpacingForPair = bot.pairId === 'USDT-IDR' ? 60 : bot.pairId === 'ETH-IDR' ? 100000 : 1000000;
    const spacingStep = Math.max(1, cfg.level_spacing_idr || defaultSpacingForPair);

    const bidOffsets = (cfg.bid_level_offsets_bps && cfg.bid_level_offsets_bps.length > 0)
      ? cfg.bid_level_offsets_bps
      : [10, 25, 50, 80, 120];

    const askOffsets = (cfg.ask_level_offsets_bps && cfg.ask_level_offsets_bps.length > 0)
      ? cfg.ask_level_offsets_bps
      : [10, 25, 50, 80, 120];

    const bidQuantities = (cfg.bid_quantities && cfg.bid_quantities.length > 0)
      ? cfg.bid_quantities
      : (bot.pairId === 'USDT-IDR' ? ['25.0', '50.0', '75.0', '100.0', '150.0'] : ['0.02', '0.05', '0.10', '0.15', '0.20']);

    const askQuantities = (cfg.ask_quantities && cfg.ask_quantities.length > 0)
      ? cfg.ask_quantities
      : (bot.pairId === 'USDT-IDR' ? ['25.0', '50.0', '75.0', '100.0', '150.0'] : ['0.02', '0.05', '0.10', '0.15', '0.20']);

    const tickQuoteUnits = PrecisionMath.parseToUnits(tickSize.toString(), quoteDecimals);
    let lastBidUnits: bigint | null = null;
    let highestBidUnits: bigint | null = null;

    const maxOpenOrders = cfg.maximum_open_orders || 40;
    const maxTotalBidValIdr = parseFloat(cfg.maximum_total_bid_value_idr || '500000000000');
    const maxTotalAskQty = parseFloat(cfg.maximum_total_ask_quantity || '1000000.0');
    let cumulativeBidValIdr = 0;
    let cumulativeAskQty = 0;

    // =========================================================================
    // DEPLOY BID LADDER (BUY ORDERS)
    // =========================================================================
    for (let i = 0; i < numBids; i++) {
      if (newActiveOrderIds.length >= maxOpenOrders) {
        addLog(bot, `Mencapai batas maksimum open orders (${maxOpenOrders}). Menghentikan penambahan bid level.`, 'RISK');
        break;
      }

      let rawBidPrice = 0;
      let levelJitter = 0;
      if (isRandomizeEnabled && maxJitterTicks > 0 && !isCustomBounds) {
        levelJitter = (Math.floor(Math.random() * (maxJitterTicks * 2 + 1)) - maxJitterTicks) * tickSize;
      }

      if (isCustomBounds) {
        // Compute price distributed from maxBuyPrice down to minBuyPrice
        const fraction = numBids > 1 ? i / (numBids - 1) : 0;
        if (spacingMode === 'GEOMETRIC') {
          const geoFrac = Math.pow(fraction, 1.6);
          rawBidPrice = maxBuyPrice - geoFrac * (maxBuyPrice - minBuyPrice);
        } else if (spacingMode === 'CONCENTRATED') {
          const concFrac = Math.pow(fraction, 0.65);
          rawBidPrice = maxBuyPrice - concFrac * (maxBuyPrice - minBuyPrice);
        } else if (spacingMode === 'FIXED_IDR') {
          rawBidPrice = maxBuyPrice - i * spacingStep;
        } else {
          // Default LINEAR
          rawBidPrice = maxBuyPrice - fraction * (maxBuyPrice - minBuyPrice);
        }

        // Clamp strictly to user defined bounds so orders match preview 100%
        rawBidPrice = Math.min(maxBuyPrice, Math.max(minBuyPrice, rawBidPrice));
      } else {
        // External reference ladder distribution
        if (spacingMode === 'FIXED_IDR') {
          rawBidPrice = dynamicRef - (i + 1) * spacingStep;
        } else if (spacingMode === 'GEOMETRIC') {
          const bps = Math.round(15 * Math.pow(1.35, i));
          rawBidPrice = dynamicRef * (1 - bps / 10000);
        } else if (spacingMode === 'CONCENTRATED') {
          const bps = Math.round(10 * Math.pow(1.2, i));
          rawBidPrice = dynamicRef * (1 - bps / 10000);
        } else {
          // PERCENT_BPS or LINEAR
          const offsetBps = i < bidOffsets.length
            ? bidOffsets[i]
            : bidOffsets[bidOffsets.length - 1] + (i - bidOffsets.length + 1) * 20;
          rawBidPrice = dynamicRef * (1 - offsetBps / 10000);
        }
      }

      rawBidPrice = Math.round((rawBidPrice + levelJitter) / tickSize) * tickSize;
      if (rawBidPrice <= 0) rawBidPrice = tickSize;

      let bidPriceUnits = PrecisionMath.parseToUnits(rawBidPrice.toString(), quoteDecimals);

      // Enforce strictly decreasing monotonic rungs (Anti-Stacking)
      if (lastBidUnits !== null && bidPriceUnits >= lastBidUnits) {
        bidPriceUnits = lastBidUnits - tickQuoteUnits;
      }
      if (bidPriceUnits <= 0n) {
        bidPriceUnits = tickQuoteUnits;
      }
      lastBidUnits = bidPriceUnits;

      if (i === 0 || highestBidUnits === null || bidPriceUnits > highestBidUnits) {
        highestBidUnits = bidPriceUnits;
      }

      if (usedBidPriceUnits.has(bidPriceUnits.toString())) {
        continue;
      }
      usedBidPriceUnits.add(bidPriceUnits.toString());

      // Determine Quantity (Exact when randomization disabled to match preview 100%)
      let baseQtyStr = bidQuantities[i < bidQuantities.length ? i : bidQuantities.length - 1] || '10.0';
      let qtyStr = baseQtyStr;

      if (cfg.quantity_randomization_enabled) {
        const minQ = parseFloat(cfg.random_min_quantity || '5.0');
        const maxQ = parseFloat(cfg.random_max_quantity || '25.0');
        const randQ = minQ + Math.random() * (maxQ - minQ);
        qtyStr = randQ.toFixed(bot.pairId === 'USDT-IDR' ? 2 : 4);
      } else {
        const parsedBaseQ = parseFloat(baseQtyStr) || 10.0;
        qtyStr = parsedBaseQ.toFixed(bot.pairId === 'USDT-IDR' ? 2 : 4);
      }

      const parsedQtyNum = parseFloat(qtyStr);
      const estBidValIdr = (Number(rawBidPrice) * parsedQtyNum);
      if (cumulativeBidValIdr + estBidValIdr > maxTotalBidValIdr) {
        addLog(bot, `Batas total nilai bid tercapai (Max: ${maxTotalBidValIdr}). Menghentikan level bid selanjutnya.`, 'RISK');
        break;
      }

      const qtyBaseUnits = (BigInt(Math.round(parseFloat(qtyStr) * (10 ** baseDecimals)))).toString();
      const neededQuote = PrecisionMath.calculateQuoteAmount(BigInt(qtyBaseUnits), baseDecimals, bidPriceUnits);

      if (quoteAvailable >= neededQuote) {
        const displayPrice = this.formatDisplayPrice(bidPriceUnits, pair);
        if (cfg.dry_run) {
          addLog(bot, `[DRY-RUN] Bid Lvl ${i + 1} (${spacingMode}): ${displayPrice} (Qty: ${qtyStr} ${pair.baseCurrency})`, 'INFO');
        } else {
          const clientOrderId = `bot-dp-${bot.id.slice(4, 10)}-b${i + 1}-${Date.now()}`;
          try {
            const res = matchingEngine.placeOrder({
              userId: bot.accountId,
              pairId: bot.pairId,
              side: 'BUY',
              orderType: 'LIMIT',
              timeInForce: 'GTC',
              price: bidPriceUnits.toString(),
              quantity: qtyBaseUnits,
              clientOrderId
            });

            const placedBid = res?.takerOrder || (res as any)?.order;
            if (placedBid) {
              newActiveOrderIds.push(placedBid.id);
              bot.stats.ordersSubmitted++;
              bot.stats.ordersAccepted++;
              quoteAvailable -= neededQuote;
              cumulativeBidValIdr += estBidValIdr;
            }
          } catch (err: any) {
            addLog(bot, `Gagal memasang Bid Lvl ${i + 1} (${displayPrice}): ${err.message}`, 'ERROR');
          }
        }
      }
    }

    // =========================================================================
    // DEPLOY ASK LADDER (SELL ORDERS)
    // =========================================================================
    let lastAskUnits: bigint | null = null;

    for (let i = 0; i < numAsks; i++) {
      if (newActiveOrderIds.length >= maxOpenOrders) {
        addLog(bot, `Mencapai batas maksimum open orders (${maxOpenOrders}). Menghentikan penambahan ask level.`, 'RISK');
        break;
      }

      let rawAskPrice = 0;
      let levelJitter = 0;
      if (isRandomizeEnabled && maxJitterTicks > 0 && !isCustomBounds) {
        levelJitter = (Math.floor(Math.random() * (maxJitterTicks * 2 + 1)) - maxJitterTicks) * tickSize;
      }

      if (isCustomBounds) {
        // Compute price distributed from minSellPrice up to maxSellPrice
        const fraction = numAsks > 1 ? i / (numAsks - 1) : 0;
        if (spacingMode === 'GEOMETRIC') {
          const geoFrac = Math.pow(fraction, 1.6);
          rawAskPrice = minSellPrice + geoFrac * (maxSellPrice - minSellPrice);
        } else if (spacingMode === 'CONCENTRATED') {
          const concFrac = Math.pow(fraction, 0.65);
          rawAskPrice = minSellPrice + concFrac * (maxSellPrice - minSellPrice);
        } else if (spacingMode === 'FIXED_IDR') {
          rawAskPrice = minSellPrice + i * spacingStep;
        } else {
          // Default LINEAR
          rawAskPrice = minSellPrice + fraction * (maxSellPrice - minSellPrice);
        }

        // Clamp strictly to user defined bounds so orders match preview 100%
        rawAskPrice = Math.max(minSellPrice, Math.min(maxSellPrice, rawAskPrice));
      } else {
        if (spacingMode === 'FIXED_IDR') {
          rawAskPrice = dynamicRef + (i + 1) * spacingStep;
        } else if (spacingMode === 'GEOMETRIC') {
          const bps = Math.round(15 * Math.pow(1.35, i));
          rawAskPrice = dynamicRef * (1 + bps / 10000);
        } else if (spacingMode === 'CONCENTRATED') {
          const bps = Math.round(10 * Math.pow(1.2, i));
          rawAskPrice = dynamicRef * (1 + bps / 10000);
        } else {
          const offsetBps = i < askOffsets.length
            ? askOffsets[i]
            : askOffsets[askOffsets.length - 1] + (i - askOffsets.length + 1) * 20;
          rawAskPrice = dynamicRef * (1 + offsetBps / 10000);
        }
      }

      rawAskPrice = Math.round((rawAskPrice + levelJitter) / tickSize) * tickSize;
      let askPriceUnits = PrecisionMath.parseToUnits(rawAskPrice.toString(), quoteDecimals);

      // Anti-Crossing & Monotonic Dispersion
      if (highestBidUnits !== null && askPriceUnits <= highestBidUnits) {
        askPriceUnits = highestBidUnits + tickQuoteUnits;
      }
      if (lastAskUnits !== null && askPriceUnits <= lastAskUnits) {
        askPriceUnits = lastAskUnits + tickQuoteUnits;
      }
      lastAskUnits = askPriceUnits;

      if (usedAskPriceUnits.has(askPriceUnits.toString())) {
        continue;
      }
      usedAskPriceUnits.add(askPriceUnits.toString());

      // Determine Quantity (Exact when randomization disabled to match preview 100%)
      let baseQtyStr = askQuantities[i < askQuantities.length ? i : askQuantities.length - 1] || '10.0';
      let qtyStr = baseQtyStr;

      if (cfg.quantity_randomization_enabled) {
        const minQ = parseFloat(cfg.random_min_quantity || '5.0');
        const maxQ = parseFloat(cfg.random_max_quantity || '25.0');
        const randQ = minQ + Math.random() * (maxQ - minQ);
        qtyStr = randQ.toFixed(bot.pairId === 'USDT-IDR' ? 2 : 4);
      } else {
        const parsedBaseQ = parseFloat(baseQtyStr) || 10.0;
        qtyStr = parsedBaseQ.toFixed(bot.pairId === 'USDT-IDR' ? 2 : 4);
      }

      const parsedQtyNum = parseFloat(qtyStr);
      if (cumulativeAskQty + parsedQtyNum > maxTotalAskQty) {
        addLog(bot, `Batas total volume ask tercapai (Max: ${maxTotalAskQty}). Menghentikan level ask selanjutnya.`, 'RISK');
        break;
      }

      const qtyBaseUnits = (BigInt(Math.round(parseFloat(qtyStr) * (10 ** baseDecimals)))).toString();

      if (baseAvailable >= BigInt(qtyBaseUnits)) {
        const displayPrice = this.formatDisplayPrice(askPriceUnits, pair);
        if (cfg.dry_run) {
          addLog(bot, `[DRY-RUN] Ask Lvl ${i + 1} (${spacingMode}): ${displayPrice} (Qty: ${qtyStr} ${pair.baseCurrency})`, 'INFO');
        } else {
          const clientOrderId = `bot-dp-${bot.id.slice(4, 10)}-a${i + 1}-${Date.now()}`;
          try {
            const res = matchingEngine.placeOrder({
              userId: bot.accountId,
              pairId: bot.pairId,
              side: 'SELL',
              orderType: 'LIMIT',
              timeInForce: 'GTC',
              price: askPriceUnits.toString(),
              quantity: qtyBaseUnits,
              clientOrderId
            });

            const placedAsk = res?.takerOrder || (res as any)?.order;
            if (placedAsk) {
              newActiveOrderIds.push(placedAsk.id);
              bot.stats.ordersSubmitted++;
              bot.stats.ordersAccepted++;
              baseAvailable -= BigInt(qtyBaseUnits);
            }
          } catch (err: any) {
            addLog(bot, `Gagal memasang Ask Lvl ${i + 1} (${displayPrice}): ${err.message}`, 'ERROR');
          }
        }
      }
    }

    // Update Bot Active State & Refresh Cooldown Timestamps
    cfg.activeOrderIds = newActiveOrderIds;
    bot.deployedOrderIds = [...newActiveOrderIds];
    cfg.lastRepriceTimestamp = now;
    cfg.last_refresh_timestamp = now;
    cfg.next_refresh_timestamp = now + cooldownMs;
    (cfg as any).lastTargetPrice = roundedRefPrice;
    bot.lastHeartbeat = now;

    if (newActiveOrderIds.length > 0) {
      const modeDesc = isCustomBounds
        ? `[Custom Bounds: Buy ${minBuyPrice}-${maxBuyPrice}, Sell ${minSellPrice}-${maxSellPrice}]`
        : `[External Ref: ${cfg.reference_price_source}]`;

      addLog(
        bot,
        `[Depth Ladder Refreshed] ${newActiveOrderIds.length} order aktif (${modeDesc}, Mode: ${spacingMode}, Jitter: ±${maxJitterTicks} ticks, Cooldown: ${cooldownSec}s, Anti-Stacking: OK).`,
        'ORDER'
      );
    }

    // Broadcast depth and ticker immediately so UI updates in real-time
    marketWsService.broadcastDepth(bot.pairId);
    marketWsService.broadcastTicker(pair);

    db.scheduleSave();
    return true;
  }

  /**
   * Cancel all open depth orders placed by this bot, reconciling both internal array and live order book.
   */
  public static cancelOpenDepthOrders(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void,
    reason = 'Penghentian bot'
  ): number {
    const cfg = bot.depthLiquidityConfig;
    let count = 0;

    const book = matchingEngine.getOrderBook(bot.pairId);
    const botPrefix = `bot-dp-${bot.id.slice(4, 10)}`;

    // Reconcile: Get ALL live order IDs on the book belonging to this bot/account
    const liveBookOrderIds = [...book.bids, ...book.asks]
      .filter(o => o.userId === bot.accountId || (o.clientOrderId && o.clientOrderId.startsWith(botPrefix)))
      .map(o => o.id);

    const idsToCancel = [...(cfg?.activeOrderIds || []), ...bot.deployedOrderIds, ...liveBookOrderIds];
    const uniqueIds = Array.from(new Set(idsToCancel));

    for (const orderId of uniqueIds) {
      const order = db.orders.get(orderId);
      if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        try {
          const res = matchingEngine.cancelOrder(orderId, bot.accountId, bot.pairId, 'MM');
          if (res && res.status === 'CANCELLED') {
            count++;
          }
        } catch (e) {}
      }
    }

    if (cfg) {
      cfg.activeOrderIds = [];
    }
    bot.deployedOrderIds = [];

    if (count > 0) {
      addLog(bot, `Membatalkan ${count} order depth terbuka (${reason}).`, 'INFO');
      marketWsService.broadcastDepth(bot.pairId);
    }
    return count;
  }
}
