/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * MovementDepthLiquidityBot.ts
 * Multi-Level Depth & Liquidity Market-Making Bot driven by RELATIVE % MOVEMENT
 * of an Admin-whitelisted Binance/Bybit WebSocket leader pair (e.g. BTCUSDT),
 * projected onto the target market's independent local anchor price.
 *
 * Key Differences from External Price Follower / Nominal Depth Bot:
 * - Does NOT copy external nominal token prices (ideal for newly listed or custom-priced tokens).
 * - Computes percentage return of the external leader since anchor capture:
 *     leaderReturn = (leaderCurrentPrice - leaderBaselinePrice) / leaderBaselinePrice
 * - Projects that relative % movement onto the local anchor price with configurable Beta sensitivity:
 *     projectedLocalPrice = anchorLocalPrice * (1 + leaderReturn * movementSensitivity)
 * - Deploys full multi-level Bid/Ask Depth Liquidity ladders with Anti-Stacking & Anti-Crossing.
 */

import { db } from '../../db/database.js';
import { matchingEngine } from '../../engine/MatchingEngine.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { priceAggregatorService } from '../external/PriceAggregatorService.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { BotInstance } from '../../db/types.js';

export class MovementDepthLiquidityBotExecutor {
  /**
   * Format floating point price/quantity safely without scientific notation
   */
  private static toFixedSafe(val: number, decimals: number): string {
    const clampedDec = Math.max(0, Math.min(8, decimals));
    return Number(val).toFixed(clampedDec);
  }

  /**
   * Determine market-compatible tick size, supporting micro-cap & sub-$1 USDT listings
   */
  public static getCompatibleTickSize(
    pairId: string,
    configuredTickSize?: number,
    refPriceHint?: number
  ): number {
    const pair = db.tradingPairs.get(pairId);
    const isUsdtQuote = pair?.quoteCurrency === 'USDT' || pairId.endsWith('-USDT');

    if (configuredTickSize && configuredTickSize > 0) {
      if (isUsdtQuote && configuredTickSize > 10) {
        return 0.0001;
      }
      if (pairId === 'USDT-IDR' && configuredTickSize > 60) {
        return 1;
      }
      return configuredTickSize;
    }

    const hint = refPriceHint && refPriceHint > 0 ? refPriceHint : 0;
    if (isUsdtQuote) {
      if (hint > 0 && hint < 0.01) return 0.00001;
      if (hint > 0 && hint < 1) return 0.0001;
      if (hint > 0 && hint < 20) return 0.001;
      return 0.01;
    }

    if (hint > 0 && hint < 500) return 1;
    if (hint > 0 && hint < 5000) return 10;
    if (hint > 0 && hint < 50000) return 100;
    return pairId === 'USDT-IDR' ? 1 : pairId === 'ETH-IDR' ? 100 : 1000;
  }

  private static formatDisplayPrice(priceUnits: bigint, pair: any): string {
    if (pair.quoteCurrency === 'IDR') {
      return PrecisionMath.formatIDRDisplay(priceUnits);
    }
    const dec = pair.quoteDecimals || 4;
    const val = Number(priceUnits) / (10 ** dec);
    return `${val.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, dec), maximumFractionDigits: dec })} ${pair.quoteCurrency}`;
  }

  /**
   * Capture/reset local anchor price and current WS leader baseline price
   */
  public static resetAnchor(
    bot: BotInstance,
    newAnchorLocalPrice?: string | number,
    addLog?: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): {
    success: boolean;
    error?: string;
    anchorLocalPrice?: string;
    leaderBaselinePrice?: number;
  } {
    const cfg = bot.movementDepthConfig;
    if (!cfg) return { success: false, error: 'Konfigurasi Movement Depth tidak ditemukan.' };

    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair) return { success: false, error: `Trading pair ${bot.pairId} tidak ditemukan.` };

    const snapshot = priceAggregatorService.getSymbolSnapshot(cfg.leader_symbol, cfg.leader_provider || 'AGGREGATED');
    if (!snapshot || !(snapshot.price > 0)) {
      return { success: false, error: `Feed harga WebSocket untuk ${cfg.leader_symbol} belum tersedia.` };
    }

    let resolvedAnchor = cfg.anchor_local_price;
    if (newAnchorLocalPrice !== undefined && newAnchorLocalPrice !== '' && Number(newAnchorLocalPrice) > 0) {
      resolvedAnchor = String(newAnchorLocalPrice);
    } else if (!(parseFloat(String(resolvedAnchor || '0')) > 0)) {
      const lastFloat = Number(BigInt(pair.lastPrice || '0')) / (10 ** (pair.quoteDecimals || 2));
      if (lastFloat > 0) resolvedAnchor = String(lastFloat);
    }

    if (!(parseFloat(String(resolvedAnchor || '0')) > 0)) {
      return { success: false, error: 'Harga anchor lokal target tidak valid (> 0).' };
    }

    cfg.anchor_local_price = resolvedAnchor;
    cfg.leader_baseline_price = snapshot.price;
    cfg.last_leader_price = snapshot.price;
    cfg.last_leader_return_pct = 0;
    cfg.last_projected_local_price = parseFloat(resolvedAnchor);
    cfg.last_refresh_timestamp = 0;
    (cfg as any).lastTargetPrice = 0;
    bot.updatedAt = Date.now();

    if (addLog) {
      addLog(
        bot,
        `[Reset Anchor] Acuan ${cfg.leader_symbol} dikunci di ${snapshot.price} <-> Harga Lokal Anchor ${resolvedAnchor} ${pair.quoteCurrency}.`,
        'INFO'
      );
    }

    db.scheduleSave();
    return {
      success: true,
      anchorLocalPrice: cfg.anchor_local_price,
      leaderBaselinePrice: cfg.leader_baseline_price
    };
  }

  /**
   * Execute a single Depth Movement (WS) market-making cycle
   */
  public static executeCycle(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void
  ): boolean {
    const cfg = bot.movementDepthConfig;
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

    const leaderSym = (cfg.leader_symbol || '').trim().toUpperCase();
    const wlEntry = db.externalWsWhitelist.get(leaderSym);
    if (!wlEntry || !wlEntry.enabled) {
      addLog(
        bot,
        `Pair acuan WS "${leaderSym}" tidak aktif atau belum di-whitelist oleh Admin. Bot menahan likuiditas.`,
        'RISK'
      );
      this.cancelOpenBotOrders(bot, addLog, 'Pair acuan WS dinonaktifkan dari whitelist');
      return false;
    }

    const now = Date.now();
    const snapshot = priceAggregatorService.getSymbolSnapshot(leaderSym, cfg.leader_provider || 'AGGREGATED');

    if (!snapshot || !(snapshot.price > 0)) {
      addLog(
        bot,
        `Harga WebSocket ${leaderSym} belum tersedia. Menunggu stream Binance/Bybit...`,
        'RISK'
      );
      this.cancelOpenBotOrders(bot, addLog, 'Harga WS acuan tidak tersedia');
      return false;
    }

    // Check staleness if WS connections are actively established
    const wsConnected =
      priceAggregatorService.binance.getConnectionStatus() === 'CONNECTED' ||
      priceAggregatorService.bybit.getConnectionStatus() === 'CONNECTED';
    const maxDataAge = Math.max(15000, cfg.max_data_age_ms || 30000);
    if (wsConnected && snapshot.updatedAt > 0 && (now - snapshot.updatedAt > maxDataAge)) {
      addLog(
        bot,
        `Feed WS ${leaderSym} stale (${Math.round((now - snapshot.updatedAt) / 1000)}s > ${Math.round(maxDataAge / 1000)}s). Order ditarik sementara.`,
        'RISK'
      );
      this.cancelOpenBotOrders(bot, addLog, 'Feed WS acuan stale');
      return false;
    }

    // Resolve Local Anchor Price
    const quoteDecimals = pair.quoteDecimals || 2;
    const baseDecimals = pair.baseDecimals;
    let anchorLocal = parseFloat(String(cfg.anchor_local_price || '0'));
    if (!(anchorLocal > 0)) {
      anchorLocal = Number(BigInt(pair.lastPrice || '0')) / (10 ** quoteDecimals);
      if (anchorLocal > 0) {
        cfg.anchor_local_price = String(anchorLocal);
      }
    }

    if (!(anchorLocal > 0)) {
      addLog(
        bot,
        `Anchor harga lokal ${bot.pairId} tidak valid (> 0). Harap isi Target Local Anchor Price.`,
        'RISK'
      );
      return false;
    }

    // Capture leader baseline automatically on first run if unset
    if (!cfg.leader_baseline_price || cfg.leader_baseline_price <= 0) {
      cfg.leader_baseline_price = snapshot.price;
      addLog(
        bot,
        `[Baseline Captured] Mengunci harga awal ${leaderSym} = ${snapshot.price} sebagai patokan 0.00% terhadap anchor lokal ${anchorLocal} ${pair.quoteCurrency}.`,
        'INFO'
      );
    }

    // Calculate relative percentage movement and project onto local anchor
    const leaderReturn = (snapshot.price - cfg.leader_baseline_price) / cfg.leader_baseline_price;
    const sensitivity = Number.isFinite(cfg.movement_sensitivity) && cfg.movement_sensitivity !== 0
      ? cfg.movement_sensitivity
      : 1.0;

    let projectedLocal = anchorLocal * (1 + leaderReturn * sensitivity);
    if (projectedLocal <= 0) {
      projectedLocal = anchorLocal * 0.01;
    }

    // Optional floor & ceiling guards
    const minGuard = cfg.min_price_guard ? parseFloat(String(cfg.min_price_guard)) : 0;
    const maxGuard = cfg.max_price_guard ? parseFloat(String(cfg.max_price_guard)) : 0;
    let clampedByGuard = false;
    if (minGuard > 0 && projectedLocal < minGuard) {
      projectedLocal = minGuard;
      clampedByGuard = true;
    }
    if (maxGuard > 0 && projectedLocal > maxGuard && (minGuard <= 0 || maxGuard >= minGuard)) {
      projectedLocal = maxGuard;
      clampedByGuard = true;
    }

    const tickSize = this.getCompatibleTickSize(bot.pairId, cfg.tick_size, projectedLocal);
    const roundedProjected = Math.max(tickSize, Math.round(projectedLocal / tickSize) * tickSize);

    // Update live telemetry on config
    cfg.last_leader_price = snapshot.price;
    cfg.last_leader_return_pct = Number((leaderReturn * 100).toFixed(4));
    cfg.last_projected_local_price = roundedProjected;

    // Refresh cooldown vs early rotation check
    const cooldownSec = Math.max(
      2,
      cfg.liquidity_refresh_cooldown_sec || Math.round((cfg.minimum_reprice_interval_ms || 3000) / 1000) || 10
    );
    const cooldownMs = cooldownSec * 1000;
    const lastRefresh = cfg.last_refresh_timestamp || cfg.lastRepriceTimestamp || 0;
    const isCooldownElapsed = (now - lastRefresh >= cooldownMs);

    const book = matchingEngine.getOrderBook(bot.pairId);
    const botPrefix = `bot-mv-${bot.id.slice(4, 10)}`;
    const currentLiveBotOrders = [...book.bids, ...book.asks].filter(
      o => (o.clientOrderId && o.clientOrderId.startsWith(botPrefix)) || (cfg?.activeOrderIds && cfg.activeOrderIds.includes(o.id))
    );
    const hasLiveOrders = currentLiveBotOrders.length > 0;

    const lastTarget = (cfg as any).lastTargetPrice || 0;
    const thresholdBps = Math.max(1, cfg.movement_threshold_bps ?? cfg.minimum_price_change_bps ?? 10);
    const moveBpsFromLast = lastTarget > 0 ? (Math.abs(roundedProjected - lastTarget) / lastTarget) * 10000 : 10000;
    const significantMove = moveBpsFromLast >= thresholdBps;

    if (!isCooldownElapsed && hasLiveOrders && !significantMove) {
      return true;
    }

    // Dynamic Micro-Jitter
    const isRandomizeEnabled = cfg.randomize_placement_enabled !== false;
    const maxJitterTicks = isRandomizeEnabled
      ? (cfg.price_randomization_ticks !== undefined ? Math.max(1, cfg.price_randomization_ticks) : 2)
      : 0;
    const jitterDirection = Math.random() >= 0.5 ? 1 : -1;
    const jitterAmount = isRandomizeEnabled ? Math.floor(Math.random() * (maxJitterTicks + 1)) : 0;
    const dynamicRef = Math.max(tickSize, roundedProjected + jitterDirection * jitterAmount * tickSize);

    // Ensure MM ledger accounts exist with decimal-scaled liquidity (supports 18-decimal new listings)
    const defaultQuoteUnits = PrecisionMath.parseToUnits(
      pair.quoteCurrency === 'IDR' ? '100000000000' : '1000000',
      quoteDecimals
    );
    const defaultBaseUnits = PrecisionMath.parseToUnits('1000000', baseDecimals);
    const quoteAccount = db.createOrGetAccount(bot.accountId, pair.quoteCurrency, defaultQuoteUnits.toString());
    const baseAccount = db.createOrGetAccount(bot.accountId, pair.baseCurrency, defaultBaseUnits.toString());

    const botOwner = db.users.get(bot.accountId);
    const ownerRole = (botOwner?.role || '').toUpperCase();
    const isOperatorAccount = ownerRole === 'MM' || ownerRole === 'ADMIN' || ownerRole === 'SUPERADMIN';
    if (isOperatorAccount) {
      const minBaseBuffer = PrecisionMath.parseToUnits('100', baseDecimals);
      if (BigInt(baseAccount.balanceAvailable) < minBaseBuffer && BigInt(baseAccount.balanceLocked) === 0n) {
        baseAccount.balanceAvailable = defaultBaseUnits.toString();
      }
    }

    let quoteAvailable = BigInt(quoteAccount.balanceAvailable);
    let baseAvailable = BigInt(baseAccount.balanceAvailable);

    // ANTI-STACKING: Cancel prior live orders before deploying fresh ladder
    if (!cfg.dry_run) {
      this.cancelOpenBotOrders(bot, addLog, 'Rotasi ladder mengikuti pergerakan WS');
    }

    const numBids = Math.min(20, Math.max(1, cfg.number_of_bid_levels || 5));
    const numAsks = Math.min(20, Math.max(1, cfg.number_of_ask_levels || 5));
    const spacingMode = cfg.spacing_mode || 'PERCENT_BPS';
    const spreadBps = Math.max(2, cfg.spread_bps || 20);
    const dynamicProportionalStep = Math.max(tickSize, Math.round((dynamicRef * 0.005) / tickSize) * tickSize);
    const spacingStep = Math.max(tickSize, cfg.level_spacing_idr || dynamicProportionalStep);

    const bidOffsets = (cfg.bid_level_offsets_bps && cfg.bid_level_offsets_bps.length > 0)
      ? cfg.bid_level_offsets_bps
      : [20, 45, 75, 110, 150];
    const askOffsets = (cfg.ask_level_offsets_bps && cfg.ask_level_offsets_bps.length > 0)
      ? cfg.ask_level_offsets_bps
      : [20, 45, 75, 110, 150];

    const minPairOrderFloat = Number(BigInt(pair.minOrderSize || '1000')) / (10 ** baseDecimals);
    const defaultTokenQty = Math.max(minPairOrderFloat, bot.pairId === 'USDT-IDR' ? 25.0 : bot.pairId.startsWith('BTC') ? 0.01 : 10.0);
    const defaultQtyStrings = [
      defaultTokenQty.toFixed(Math.min(4, baseDecimals)),
      (defaultTokenQty * 1.5).toFixed(Math.min(4, baseDecimals)),
      (defaultTokenQty * 2.0).toFixed(Math.min(4, baseDecimals)),
      (defaultTokenQty * 3.0).toFixed(Math.min(4, baseDecimals)),
      (defaultTokenQty * 5.0).toFixed(Math.min(4, baseDecimals))
    ];
    const bidQuantities = (cfg.bid_quantities && cfg.bid_quantities.length > 0) ? cfg.bid_quantities : defaultQtyStrings;
    const askQuantities = (cfg.ask_quantities && cfg.ask_quantities.length > 0) ? cfg.ask_quantities : defaultQtyStrings;

    const tickQuoteUnits = PrecisionMath.parseToUnits(this.toFixedSafe(tickSize, quoteDecimals), quoteDecimals);
    const safeTickUnits = tickQuoteUnits > 0n ? tickQuoteUnits : 1n;

    const newActiveOrderIds: string[] = [];
    const usedBidPriceUnits = new Set<string>();
    const usedAskPriceUnits = new Set<string>();

    const maxOpenOrders = cfg.maximum_open_orders || 40;
    const maxTotalBidValIdr = parseFloat(cfg.maximum_total_bid_value_idr || '500000000000');
    const maxTotalAskQty = parseFloat(cfg.maximum_total_ask_quantity || '10000000.0');
    let cumulativeBidValIdr = 0;
    let cumulativeAskQty = 0;

    let lastBidUnits: bigint | null = null;
    let highestBidUnits: bigint | null = null;

    const qtyDisplayDecimals = Math.min(4, baseDecimals);

    // =========================================================================
    // DEPLOY BID LADDER
    // =========================================================================
    for (let i = 0; i < numBids; i++) {
      if (newActiveOrderIds.length >= maxOpenOrders) {
        addLog(bot, `Mencapai batas maksimum open orders (${maxOpenOrders}). Menghentikan penambahan bid level.`, 'RISK');
        break;
      }

      const levelJitter = (isRandomizeEnabled && maxJitterTicks > 0)
        ? (Math.floor(Math.random() * (maxJitterTicks * 2 + 1)) - maxJitterTicks) * tickSize
        : 0;

      let rawBidPrice = 0;
      const topBidAnchor = dynamicRef * (1 - spreadBps / 10000);

      if (spacingMode === 'FIXED_IDR') {
        rawBidPrice = topBidAnchor - i * spacingStep;
      } else if (spacingMode === 'LINEAR') {
        rawBidPrice = cfg.level_spacing_idr && cfg.level_spacing_idr > 0
          ? topBidAnchor - i * cfg.level_spacing_idr
          : dynamicRef * (1 - (spreadBps + i * 25) / 10000);
      } else if (spacingMode === 'GEOMETRIC') {
        const bps = spreadBps + Math.round(15 * Math.pow(1.4, i) - 15);
        rawBidPrice = dynamicRef * (1 - bps / 10000);
      } else if (spacingMode === 'CONCENTRATED') {
        const bps = spreadBps + Math.round(10 * Math.pow(1.2, i) - 10);
        rawBidPrice = dynamicRef * (1 - bps / 10000);
      } else {
        const rawOffset = i < bidOffsets.length
          ? bidOffsets[i]
          : bidOffsets[bidOffsets.length - 1] + (i - bidOffsets.length + 1) * 20;
        const offsetBps = Math.max(spreadBps, rawOffset);
        rawBidPrice = dynamicRef * (1 - offsetBps / 10000);
      }

      rawBidPrice = Math.round((rawBidPrice + levelJitter) / tickSize) * tickSize;
      if (rawBidPrice <= 0) rawBidPrice = tickSize;

      let bidPriceUnits = PrecisionMath.parseToUnits(this.toFixedSafe(rawBidPrice, quoteDecimals), quoteDecimals);
      if (bidPriceUnits <= 0n) bidPriceUnits = safeTickUnits;

      if (lastBidUnits !== null && bidPriceUnits >= lastBidUnits) {
        bidPriceUnits = lastBidUnits - safeTickUnits;
      }
      if (bidPriceUnits <= 0n) bidPriceUnits = safeTickUnits;
      lastBidUnits = bidPriceUnits;

      if (i === 0 || highestBidUnits === null || bidPriceUnits > highestBidUnits) {
        highestBidUnits = bidPriceUnits;
      }

      if (usedBidPriceUnits.has(bidPriceUnits.toString())) continue;
      usedBidPriceUnits.add(bidPriceUnits.toString());

      const baseQtyStr = bidQuantities[i < bidQuantities.length ? i : bidQuantities.length - 1] || '10.0';
      let qtyStr = baseQtyStr;
      if (cfg.quantity_randomization_enabled) {
        const minQ = parseFloat(cfg.random_min_quantity || '5.0');
        const maxQ = parseFloat(cfg.random_max_quantity || '25.0');
        const randQ = minQ + Math.random() * Math.max(0, maxQ - minQ);
        qtyStr = randQ.toFixed(qtyDisplayDecimals);
      } else {
        const parsedBaseQ = parseFloat(baseQtyStr) || 10.0;
        qtyStr = parsedBaseQ.toFixed(qtyDisplayDecimals);
      }

      const parsedQtyNum = parseFloat(qtyStr);
      const estBidVal = rawBidPrice * parsedQtyNum;
      if (cumulativeBidValIdr + estBidVal > maxTotalBidValIdr) {
        addLog(bot, `Batas total nilai bid tercapai (${maxTotalBidValIdr}). Menghentikan level bid selanjutnya.`, 'RISK');
        break;
      }

      const qtyUnitsBig = PrecisionMath.parseToUnits(qtyStr, baseDecimals);
      const neededQuote = PrecisionMath.calculateQuoteAmount(qtyUnitsBig, baseDecimals, bidPriceUnits);

      if (quoteAvailable >= neededQuote && qtyUnitsBig > 0n) {
        const displayPrice = this.formatDisplayPrice(bidPriceUnits, pair);
        if (cfg.dry_run) {
          addLog(bot, `[DRY-RUN][Move] Bid Lvl ${i + 1}: ${displayPrice} (Qty: ${qtyStr} ${pair.baseCurrency})`, 'INFO');
        } else {
          const clientOrderId = `${botPrefix}-b${i + 1}-${Date.now()}`;
          try {
            const res = matchingEngine.placeOrder({
              userId: bot.accountId,
              pairId: bot.pairId,
              side: 'BUY',
              orderType: 'LIMIT',
              timeInForce: 'GTC',
              price: bidPriceUnits.toString(),
              quantity: qtyUnitsBig.toString(),
              clientOrderId
            });
            const placedBid = res?.takerOrder || (res as any)?.order;
            if (placedBid) {
              newActiveOrderIds.push(placedBid.id);
              bot.stats.ordersSubmitted++;
              bot.stats.ordersAccepted++;
              quoteAvailable -= neededQuote;
              cumulativeBidValIdr += estBidVal;
            }
          } catch (err: any) {
            addLog(bot, `Gagal memasang Bid Lvl ${i + 1} (${displayPrice}): ${err.message}`, 'ERROR');
          }
        }
      } else if (quoteAvailable < neededQuote && qtyUnitsBig > 0n) {
        addLog(bot, `Saldo ${pair.quoteCurrency} tidak cukup untuk Bid Lvl ${i + 1} (butuh ${PrecisionMath.formatFromUnits(neededQuote, quoteDecimals)} ${pair.quoteCurrency}).`, 'RISK');
        break;
      }
    }

    // =========================================================================
    // DEPLOY ASK LADDER
    // =========================================================================
    let lastAskUnits: bigint | null = null;

    for (let i = 0; i < numAsks; i++) {
      if (newActiveOrderIds.length >= maxOpenOrders) {
        addLog(bot, `Mencapai batas maksimum open orders (${maxOpenOrders}). Menghentikan penambahan ask level.`, 'RISK');
        break;
      }

      const levelJitter = (isRandomizeEnabled && maxJitterTicks > 0)
        ? (Math.floor(Math.random() * (maxJitterTicks * 2 + 1)) - maxJitterTicks) * tickSize
        : 0;

      let rawAskPrice = 0;
      const topAskAnchor = dynamicRef * (1 + spreadBps / 10000);

      if (spacingMode === 'FIXED_IDR') {
        rawAskPrice = topAskAnchor + i * spacingStep;
      } else if (spacingMode === 'LINEAR') {
        rawAskPrice = cfg.level_spacing_idr && cfg.level_spacing_idr > 0
          ? topAskAnchor + i * cfg.level_spacing_idr
          : dynamicRef * (1 + (spreadBps + i * 25) / 10000);
      } else if (spacingMode === 'GEOMETRIC') {
        const bps = spreadBps + Math.round(15 * Math.pow(1.4, i) - 15);
        rawAskPrice = dynamicRef * (1 + bps / 10000);
      } else if (spacingMode === 'CONCENTRATED') {
        const bps = spreadBps + Math.round(10 * Math.pow(1.2, i) - 10);
        rawAskPrice = dynamicRef * (1 + bps / 10000);
      } else {
        const rawOffset = i < askOffsets.length
          ? askOffsets[i]
          : askOffsets[askOffsets.length - 1] + (i - askOffsets.length + 1) * 20;
        const offsetBps = Math.max(spreadBps, rawOffset);
        rawAskPrice = dynamicRef * (1 + offsetBps / 10000);
      }

      rawAskPrice = Math.round((rawAskPrice + levelJitter) / tickSize) * tickSize;
      if (rawAskPrice <= 0) rawAskPrice = tickSize;

      let askPriceUnits = PrecisionMath.parseToUnits(this.toFixedSafe(rawAskPrice, quoteDecimals), quoteDecimals);
      if (askPriceUnits <= 0n) askPriceUnits = safeTickUnits;

      if (highestBidUnits !== null && askPriceUnits <= highestBidUnits) {
        askPriceUnits = highestBidUnits + safeTickUnits;
      }
      if (lastAskUnits !== null && askPriceUnits <= lastAskUnits) {
        askPriceUnits = lastAskUnits + safeTickUnits;
      }
      lastAskUnits = askPriceUnits;

      if (usedAskPriceUnits.has(askPriceUnits.toString())) continue;
      usedAskPriceUnits.add(askPriceUnits.toString());

      const baseQtyStr = askQuantities[i < askQuantities.length ? i : askQuantities.length - 1] || '10.0';
      let qtyStr = baseQtyStr;
      if (cfg.quantity_randomization_enabled) {
        const minQ = parseFloat(cfg.random_min_quantity || '5.0');
        const maxQ = parseFloat(cfg.random_max_quantity || '25.0');
        const randQ = minQ + Math.random() * Math.max(0, maxQ - minQ);
        qtyStr = randQ.toFixed(qtyDisplayDecimals);
      } else {
        const parsedBaseQ = parseFloat(baseQtyStr) || 10.0;
        qtyStr = parsedBaseQ.toFixed(qtyDisplayDecimals);
      }

      const parsedQtyNum = parseFloat(qtyStr);
      if (cumulativeAskQty + parsedQtyNum > maxTotalAskQty) {
        addLog(bot, `Batas total volume ask tercapai (${maxTotalAskQty}). Menghentikan level ask selanjutnya.`, 'RISK');
        break;
      }

      const qtyUnitsBig = PrecisionMath.parseToUnits(qtyStr, baseDecimals);

      if (baseAvailable >= qtyUnitsBig && qtyUnitsBig > 0n) {
        const displayPrice = this.formatDisplayPrice(askPriceUnits, pair);
        if (cfg.dry_run) {
          addLog(bot, `[DRY-RUN][Move] Ask Lvl ${i + 1}: ${displayPrice} (Qty: ${qtyStr} ${pair.baseCurrency})`, 'INFO');
        } else {
          const clientOrderId = `${botPrefix}-a${i + 1}-${Date.now()}`;
          try {
            const res = matchingEngine.placeOrder({
              userId: bot.accountId,
              pairId: bot.pairId,
              side: 'SELL',
              orderType: 'LIMIT',
              timeInForce: 'GTC',
              price: askPriceUnits.toString(),
              quantity: qtyUnitsBig.toString(),
              clientOrderId
            });
            const placedAsk = res?.takerOrder || (res as any)?.order;
            if (placedAsk) {
              newActiveOrderIds.push(placedAsk.id);
              bot.stats.ordersSubmitted++;
              bot.stats.ordersAccepted++;
              baseAvailable -= qtyUnitsBig;
              cumulativeAskQty += parsedQtyNum;
            }
          } catch (err: any) {
            addLog(bot, `Gagal memasang Ask Lvl ${i + 1} (${displayPrice}): ${err.message}`, 'ERROR');
          }
        }
      } else if (baseAvailable < qtyUnitsBig && qtyUnitsBig > 0n) {
        addLog(bot, `Saldo ${pair.baseCurrency} tidak cukup untuk Ask Lvl ${i + 1} (butuh ${qtyStr} ${pair.baseCurrency}).`, 'RISK');
        break;
      }
    }

    cfg.activeOrderIds = newActiveOrderIds;
    bot.deployedOrderIds = [...newActiveOrderIds];
    cfg.lastRepriceTimestamp = now;
    cfg.last_refresh_timestamp = now;
    cfg.next_refresh_timestamp = now + cooldownMs;
    (cfg as any).lastTargetPrice = roundedProjected;
    bot.lastHeartbeat = now;

    if (newActiveOrderIds.length > 0) {
      const sign = leaderReturn >= 0 ? '+' : '';
      const guardTag = clampedByGuard ? ' [Guard Clamped]' : '';
      addLog(
        bot,
        `[Depth Movement] ${newActiveOrderIds.length} order aktif | Acuan ${leaderSym}: ${sign}${(leaderReturn * 100).toFixed(2)}% (${snapshot.activeProvider.toUpperCase()}) × ${sensitivity}x -> Proyeksi ${roundedProjected} ${pair.quoteCurrency}${guardTag}.`,
        'ORDER'
      );
    }

    marketWsService.broadcastDepth(bot.pairId);
    marketWsService.broadcastTicker(pair);
    db.scheduleSave();
    return true;
  }

  /**
   * Cancel all open Movement Depth orders placed by this bot
   */
  public static cancelOpenBotOrders(
    bot: BotInstance,
    addLog: (bot: BotInstance, msg: string, type?: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK') => void,
    reason = 'Penghentian bot'
  ): number {
    const cfg = bot.movementDepthConfig;
    let count = 0;

    const book = matchingEngine.getOrderBook(bot.pairId);
    const botPrefix = `bot-mv-${bot.id.slice(4, 10)}`;

    const liveBookOrderIds = [...book.bids, ...book.asks]
      .filter(o => (o.clientOrderId && o.clientOrderId.startsWith(botPrefix)) || (cfg?.activeOrderIds && cfg.activeOrderIds.includes(o.id)))
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
        } catch (_) {}
      }
    }

    if (cfg) {
      cfg.activeOrderIds = [];
    }
    bot.deployedOrderIds = [];

    if (count > 0) {
      addLog(bot, `Membatalkan ${count} order Movement Depth terbuka (${reason}).`, 'INFO');
      marketWsService.broadcastDepth(bot.pairId);
    }
    return count;
  }
}
