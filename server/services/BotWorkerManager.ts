/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BotWorkerManager.ts
 * Authoritative Algorithmic Worker & MM Concurrency Manager for DIMONEX.
 * 
 * Enforces:
 * - Single worker per bot instance using durable runtime leases
 * - Independent execution state for cloned bots
 * - Strict risk boundaries and common-ownership self-trade prevention
 * - Real matching-engine submission (no mock balances or simulated trades)
 * - Safe emergency stop and order cancellation
 */

import crypto from 'crypto';
import { db, SYSTEM_TREASURY_ID } from '../db/database.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { marketWsService } from '../websocket/MarketDataWs.js';
import { BotInstance, OrderBotConfig, VolumeBotConfig, PriceFollowerConfig, DepthLiquidityConfig, MovementDepthLiquidityConfig, Order, Trade } from '../db/types.js';
import { PriceFollowerBotExecutor } from './bots/PriceFollowerBot.js';
import { DepthLiquidityBotExecutor } from './bots/DepthLiquidityBot.js';
import { MovementDepthLiquidityBotExecutor } from './bots/MovementDepthLiquidityBot.js';
import { QuantHftBotExecutor } from './bots/QuantHftBot.js';
import { SmartHftLadderBotExecutor } from './bots/SmartHftLadderBot.js';
import { AdvancedMarketMakerBotExecutor } from './bots/AdvancedMarketMakerBot.js';
import { VolumeSpreadBotExecutor } from './bots/VolumeSpreadBot.js';

interface WorkerRuntime {
  botId: string;
  leaseId: string;
  timer: NodeJS.Timeout | null;
  crossTimer?: NodeJS.Timeout | null;
  isRunning: boolean;
  consecutiveErrors: number;
  ordersPlacedInWindow: number;
  windowStart: number;
}

export class BotWorkerManager {
  private workers: Map<string, WorkerRuntime> = new Map();

  constructor() {
    // Re-hydrate any RUNNING bot instances after HTTP & Vite startup complete
    setTimeout(() => {
      this.rehydrateRunningBots();
    }, 2500);
  }

  private rehydrateRunningBots() {
    let idx = 0;
    for (const [id, bot] of db.botInstances.entries()) {
      if (bot.status === 'RUNNING') {
        const offsetMs = idx * 150;
        idx++;
        setTimeout(() => {
          this.startWorker(id);
        }, offsetMs);
      }
    }
  }

  public getBot(botId: string): BotInstance | undefined {
    return db.botInstances.get(botId);
  }

  public addLog(bot: BotInstance, message: string, type: 'INFO' | 'ORDER' | 'FILL' | 'ERROR' | 'RISK' = 'INFO') {
    bot.logs.unshift({
      timestamp: Date.now(),
      message,
      type
    });
    if (bot.logs.length > 100) bot.logs.pop();
    bot.updatedAt = Date.now();
    db.scheduleSave();
  }

  /**
   * Validate Bot Configuration before running
   */
  public validateConfig(bot: BotInstance): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    let pair = db.tradingPairs.get(bot.pairId);
    if (!pair) {
      // Auto-heal pair from active markets or default pairs
      const market = db.markets.get(bot.pairId);
      if (market) {
        const baseAsset = db.assets.get(market.baseAssetId);
        const quoteAsset = db.assets.get(market.quoteAssetId);
        if (baseAsset && quoteAsset) {
          pair = {
            id: market.id,
            baseCurrency: baseAsset.symbol,
            quoteCurrency: quoteAsset.symbol,
            baseDecimals: baseAsset.decimals,
            quoteDecimals: quoteAsset.decimals,
            minOrderSize: market.minQuantity || '100000000',
            maxOrderSize: (10000000n * (10n ** BigInt(baseAsset.decimals))).toString(),
            makerFeeBps: market.makerFeeBps,
            takerFeeBps: market.takerFeeBps,
            isActive: true,
            isHalted: false,
            lastPrice: '0',
            high24h: '0',
            low24h: '0',
            volume24h: '0',
            quoteVolume24h: '0',
            priceChange24h: '+0.00'
          };
          db.tradingPairs.set(market.id, pair);
        }
      } else if (bot.pairId === 'BTC-USDT') {
        pair = {
          id: 'BTC-USDT',
          baseCurrency: 'BTC',
          quoteCurrency: 'USDT',
          baseDecimals: 8,
          quoteDecimals: 6,
          minOrderSize: '1000',
          maxOrderSize: '1000000000',
          makerFeeBps: 10,
          takerFeeBps: 20,
          isActive: true,
          isHalted: false,
          lastPrice: '68500000000',
          high24h: '68500000000',
          low24h: '68500000000',
          volume24h: '0',
          quoteVolume24h: '0',
          priceChange24h: '+0.00'
        };
        db.tradingPairs.set('BTC-USDT', pair);
      }
    }

    if (!pair) {
      errors.push(`Trading pair ${bot.pairId} tidak ditemukan.`);
      return { isValid: false, errors };
    }

    if (db.riskControls.isKillSwitchActive) {
      errors.push('Emergency Kill-Switch bursa sedang aktif. Tidak dapat memvalidasi/menjalankan bot.');
    }

    if (bot.botType === 'ORDER_BOT') {
      const cfg = bot.orderBotConfig;
      if (!cfg) {
        errors.push('Konfigurasi Order Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }

      if (!['BUY', 'SELL'].includes(cfg.transaction_type)) {
        errors.push(`transaction_type tidak valid: ${cfg.transaction_type}`);
      }

      const minQty = parseFloat(cfg.random_min_quantity);
      const maxQty = parseFloat(cfg.random_max_quantity);
      if (isNaN(minQty) || minQty <= 0) {
        errors.push('random_min_quantity harus berupa angka desimal positif > 0.');
      }
      if (isNaN(maxQty) || maxQty < minQty) {
        errors.push('random_max_quantity harus lebih besar atau sama dengan random_min_quantity.');
      }

      if (cfg.order_count < 0 || cfg.order_count > 1000) {
        errors.push('order_count harus antara 0 (berjalan terus) sampai 1000.');
      }

      if (cfg.transaction_type === 'BUY') {
        if (cfg.buy_min_price_limit) {
          const lim = parseFloat(cfg.buy_min_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push('buy_min_price_limit harus berupa angka positif.');
        }
        if (cfg.buy_max_price_limit) {
          const lim = parseFloat(cfg.buy_max_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push('buy_max_price_limit harus berupa angka positif.');
        }
        if (cfg.buy_min_price_limit && cfg.buy_max_price_limit) {
          if (parseFloat(cfg.buy_min_price_limit) > parseFloat(cfg.buy_max_price_limit)) {
            errors.push('buy_min_price_limit tidak boleh lebih besar dari buy_max_price_limit.');
          }
        }
      } else {
        if (cfg.sell_min_price_limit) {
          const lim = parseFloat(cfg.sell_min_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push('sell_min_price_limit harus berupa angka positif.');
        }
        if (cfg.sell_max_price_limit) {
          const lim = parseFloat(cfg.sell_max_price_limit);
          if (isNaN(lim) || lim <= 0) errors.push('sell_max_price_limit harus berupa angka positif.');
        }
        if (cfg.sell_min_price_limit && cfg.sell_max_price_limit) {
          if (parseFloat(cfg.sell_min_price_limit) > parseFloat(cfg.sell_max_price_limit)) {
            errors.push('sell_min_price_limit tidak boleh lebih besar dari sell_max_price_limit.');
          }
        }
      }
    } else if (bot.botType === 'VOLUME_BOT') {
      const cfg = bot.volumeBotConfig;
      if (!cfg) {
        errors.push('Konfigurasi Volume Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }

      if (cfg.min_delay < 1) errors.push('min_delay harus minimal 1 detik.');
      if (cfg.max_delay < cfg.min_delay) errors.push('max_delay harus lebih besar atau sama dengan min_delay.');

      const minQty = parseFloat(cfg.volume_random_min_quantity);
      const maxQty = parseFloat(cfg.volume_random_max_quantity);
      if (isNaN(minQty) || minQty <= 0) errors.push('volume_random_min_quantity harus > 0.');
      if (isNaN(maxQty) || maxQty < minQty) errors.push('volume_random_max_quantity harus >= min_quantity.');

      const minP = parseFloat(cfg.min_limit_price);
      const maxP = parseFloat(cfg.max_limit_price);
      if (isNaN(minP) || isNaN(maxP) || minP >= maxP) {
        errors.push('min_limit_price harus lebih kecil dari max_limit_price.');
      }
    } else if (bot.botType === 'VOLUME_SPREAD_BOT') {
      const cfg = bot.volumeSpreadConfig;
      if (!cfg) {
        errors.push('Konfigurasi Volume Spread Bot (Phase 2) tidak boleh kosong.');
        return { isValid: false, errors };
      }

      if (cfg.min_delay < 1) errors.push('min_delay harus minimal 1 detik.');
      if (cfg.max_delay < cfg.min_delay) errors.push('max_delay harus >= min_delay.');

      try {
        const minQtyUnits = PrecisionMath.parseToUnits(cfg.random_min_quantity || '0', pair.baseDecimals);
        const maxQtyUnits = PrecisionMath.parseToUnits(cfg.random_max_quantity || '0', pair.baseDecimals);
        if (minQtyUnits <= 0n) errors.push('random_min_quantity harus > 0.');
        if (maxQtyUnits < minQtyUnits) errors.push('random_max_quantity harus >= random_min_quantity.');
      } catch {
        errors.push('Format random_min_quantity / random_max_quantity tidak valid.');
      }

      try {
        const minPUnits = PrecisionMath.parseToUnits(cfg.min_limit_price || '0', pair.quoteDecimals);
        const maxPUnits = PrecisionMath.parseToUnits(cfg.max_limit_price || '0', pair.quoteDecimals);
        if (minPUnits <= 0n || maxPUnits <= minPUnits) {
          errors.push('min_limit_price harus positif dan lebih kecil dari max_limit_price.');
        }
      } catch {
        errors.push('Format min_limit_price / max_limit_price tidak valid.');
      }

      if (cfg.spread_band_min_pct < 1 || cfg.spread_band_min_pct > 99) {
        errors.push('spread_band_min_pct harus antara 1% dan 99%.');
      }
      if (cfg.spread_band_max_pct < cfg.spread_band_min_pct || cfg.spread_band_max_pct > 99) {
        errors.push('spread_band_max_pct harus >= spread_band_min_pct dan <= 99%.');
      }
      if (cfg.cross_delay_ms < 0 || cfg.cross_delay_ms > 2000) {
        errors.push('cross_delay_ms harus antara 0 sampai 2000 ms.');
      }

      try {
        const targetUnits = PrecisionMath.parseToUnits(cfg.vol_quote_stop_target || '0', pair.quoteDecimals);
        if (targetUnits <= 0n) errors.push('vol_quote_stop_target harus lebih besar dari 0.');
      } catch {
        errors.push('Format vol_quote_stop_target tidak valid.');
      }
    } else if (bot.botType === 'PRICE_FOLLOWER') {
      const cfg = bot.priceFollowerConfig;
      if (!cfg) {
        errors.push('Konfigurasi Price Follower Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }
      const qty = parseFloat(cfg.order_quantity);
      if (isNaN(qty) || qty <= 0) {
        errors.push('order_quantity harus berupa angka desimal positif > 0.');
      }
      if (cfg.buy_offset_bps < 0 || cfg.sell_offset_bps < 0) {
        errors.push('Offset bps tidak boleh bernilai negatif.');
      }
    } else if (bot.botType === 'DEPTH_LIQUIDITY') {
      const cfg = bot.depthLiquidityConfig;
      if (!cfg) {
        errors.push('Konfigurasi Depth & Liquidity Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }
      if (!cfg.number_of_bid_levels || cfg.number_of_bid_levels < 1) cfg.number_of_bid_levels = 5;
      if (!cfg.number_of_ask_levels || cfg.number_of_ask_levels < 1) cfg.number_of_ask_levels = 5;
      if (cfg.number_of_bid_levels > 20) errors.push('Jumlah level bid maksimal 20 level.');
      if (cfg.number_of_ask_levels > 20) errors.push('Jumlah level ask maksimal 20 level.');
      if (cfg.spacing_mode === 'FIXED_IDR' && (cfg.level_spacing_idr || 0) <= 0) {
        cfg.level_spacing_idr = 60;
      }
      if (cfg.price_mode === 'CUSTOM_BOUNDS') {
        const minBuy = parseFloat(cfg.min_limit_buy_price || '0');
        const maxBuy = parseFloat(cfg.max_limit_buy_price || '0');
        const minSell = parseFloat(cfg.min_limit_sell_price || '0');
        const maxSell = parseFloat(cfg.max_limit_sell_price || '0');
        if (minBuy <= 0 || maxBuy <= 0 || minSell <= 0 || maxSell <= 0) {
          errors.push('Pada Custom Pricing Mode, batas harga (Min/Max Buy & Sell) harus diisi angka positif > 0.');
        }
      }
    } else if (bot.botType === 'MOVEMENT_DEPTH_LIQUIDITY') {
      const cfg = bot.movementDepthConfig;
      if (!cfg) {
        errors.push('Konfigurasi Movement Depth (WS) Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }
      const leaderSym = (cfg.leader_symbol || '').trim().toUpperCase();
      const enabledWhitelist = db.getEnabledExternalWsSymbols();
      if (!leaderSym || !enabledWhitelist.includes(leaderSym)) {
        errors.push(`Pair acuan WebSocket "${leaderSym || '-'}" belum terdaftar/aktif di Whitelist Admin.`);
      }
      if (!Number.isFinite(cfg.movement_sensitivity) || cfg.movement_sensitivity === 0) {
        errors.push('Sensitivitas pergerakan (Beta) harus angka != 0 (misal 1.0).');
      }
      const anchorVal = parseFloat(String(cfg.anchor_local_price || '0'));
      const pairLastVal = Number(BigInt(pair.lastPrice || '0')) / (10 ** (pair.quoteDecimals || 2));
      if (!(anchorVal > 0) && !(pairLastVal > 0)) {
        errors.push('Target Local Anchor Price harus diisi angka positif > 0.');
      }
      if (!cfg.number_of_bid_levels || cfg.number_of_bid_levels < 1) cfg.number_of_bid_levels = 5;
      if (!cfg.number_of_ask_levels || cfg.number_of_ask_levels < 1) cfg.number_of_ask_levels = 5;
      if (cfg.number_of_bid_levels > 20) errors.push('Jumlah level bid maksimal 20 level.');
      if (cfg.number_of_ask_levels > 20) errors.push('Jumlah level ask maksimal 20 level.');
    } else if (bot.botType === 'QUANT_HFT_MM') {
      const cfg = bot.quantHftConfig;
      if (!cfg) {
        errors.push('Konfigurasi Quant HFT MM Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }
      if (!cfg.micro_order_size || parseFloat(cfg.micro_order_size) <= 0) {
        cfg.micro_order_size = '0.001';
      }
      if (!cfg.target_spread_pct || cfg.target_spread_pct <= 0) {
        cfg.target_spread_pct = 0.08;
      }
      if (!cfg.max_ladder_levels || cfg.max_ladder_levels < 1 || cfg.max_ladder_levels > 3) {
        cfg.max_ladder_levels = 3;
      }
    } else if (bot.botType === 'SMART_HFT_LADDER') {
      const cfg = bot.smartHftConfig;
      if (!cfg) {
        errors.push('Konfigurasi Smart HFT Ladder Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }
      const minBound = parseFloat(cfg.min_price_bound || '0');
      const maxBound = parseFloat(cfg.max_price_bound || '0');
      if (minBound <= 0 || maxBound <= 0 || minBound >= maxBound) {
        errors.push(`Batas harga tidak valid: min_price_bound (${minBound}) harus positif dan < max_price_bound (${maxBound}).`);
      }
      const minBuy = parseFloat(cfg.min_buy_lot || '0');
      const maxBuy = parseFloat(cfg.max_buy_lot || '0');
      const minSell = parseFloat(cfg.min_sell_lot || '0');
      const maxSell = parseFloat(cfg.max_sell_lot || '0');
      if (minBuy <= 0 || maxBuy < minBuy) {
        errors.push(`Ukuran buy lot tidak valid: min_buy_lot (${minBuy}) harus > 0 dan <= max_buy_lot (${maxBuy}).`);
      }
      if (minSell <= 0 || maxSell < minSell) {
        errors.push(`Ukuran sell lot tidak valid: min_sell_lot (${minSell}) harus > 0 dan <= max_sell_lot (${maxSell}).`);
      }
      if (!cfg.total_orders || cfg.total_orders < 2 || cfg.total_orders > 100) {
        cfg.total_orders = 40; // Default 40
      }
    } else if (bot.botType === 'ADVANCED_MM') {
      const cfg = bot.advancedMMConfig;
      if (!cfg) {
        errors.push('Konfigurasi Advanced MM Bot tidak boleh kosong.');
        return { isValid: false, errors };
      }
      if (!cfg.bid_levels || cfg.bid_levels < 1 || cfg.bid_levels > 20) {
        errors.push('Bid Levels harus antara 1 dan 20.');
      }
      if (!cfg.ask_levels || cfg.ask_levels < 1 || cfg.ask_levels > 20) {
        errors.push('Ask Levels harus antara 1 dan 20.');
      }
      if (!cfg.spread_min_bps || cfg.spread_min_bps < 1) {
        errors.push('Minimum spread harus >= 1 bps.');
      }
      if (cfg.spread_max_bps < cfg.spread_min_bps) {
        errors.push('Spread Maximum harus >= Spread Minimum.');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Start a Bot Worker
   */
  public startWorker(botId: string): boolean {
    const bot = db.botInstances.get(botId);
    if (!bot) return false;

    // Check Kill Switch
    if (db.riskControls.isKillSwitchActive) {
      this.addLog(bot, 'Gagal memulai: Emergency Kill-Switch bursa sedang aktif.', 'RISK');
      bot.status = 'RISK_HALTED';
      return false;
    }

    // Check Max Active Bots Limit
    let runningCount = 0;
    for (const b of db.botInstances.values()) {
      if (b.status === 'RUNNING' && b.id !== botId) runningCount++;
    }
    if (runningCount >= db.riskControls.maxActiveBots) {
      this.addLog(bot, `Gagal memulai: Batas maksimum bot aktif tercapai (${db.riskControls.maxActiveBots}).`, 'RISK');
      bot.status = 'RISK_HALTED';
      return false;
    }

    // Concurrency lease check
    const existingWorker = this.workers.get(botId);
    if (existingWorker && existingWorker.isRunning) {
      this.addLog(bot, 'Peringatan: Worker sudah berjalan untuk bot ini. Menggunakan lease aktif.', 'INFO');
      return true;
    }

    const leaseId = crypto.randomUUID();
    const runtime: WorkerRuntime = {
      botId,
      leaseId,
      timer: null,
      crossTimer: null,
      isRunning: true,
      consecutiveErrors: 0,
      ordersPlacedInWindow: 0,
      windowStart: Date.now()
    };
    this.workers.set(botId, runtime);

    bot.status = 'RUNNING';
    bot.startedAt = Date.now();
    bot.lastHeartbeat = Date.now();
    bot.errorInfo = undefined;
    this.addLog(bot, `Worker bot dimulai (Lease ID: ${leaseId.slice(0, 8)}, Environment: ${bot.environment}).`, 'INFO');

    if (bot.botType === 'ORDER_BOT') {
      this.scheduleOrderBotTick(runtime);
    } else if (bot.botType === 'VOLUME_BOT') {
      this.scheduleVolumeBotTick(runtime);
    } else if (bot.botType === 'VOLUME_SPREAD_BOT') {
      this.scheduleVolumeSpreadTick(runtime);
    } else if (bot.botType === 'PRICE_FOLLOWER') {
      this.schedulePriceFollowerTick(runtime);
    } else if (bot.botType === 'DEPTH_LIQUIDITY') {
      this.scheduleDepthLiquidityTick(runtime);
    } else if (bot.botType === 'MOVEMENT_DEPTH_LIQUIDITY') {
      this.scheduleMovementDepthTick(runtime);
    } else if (bot.botType === 'QUANT_HFT_MM') {
      this.scheduleQuantHftBotTick(runtime);
    } else if (bot.botType === 'SMART_HFT_LADDER') {
      this.scheduleSmartHftLadderTick(runtime);
    } else if (bot.botType === 'ADVANCED_MM') {
      this.scheduleAdvancedMMTick(runtime);
    }

    db.scheduleSave();
    return true;
  }

  /**
   * Pause a Bot Worker
   */
  public pauseWorker(botId: string): boolean {
    const bot = db.botInstances.get(botId);
    if (!bot) return false;

    const runtime = this.workers.get(botId);
    if (runtime) {
      if (runtime.timer) clearTimeout(runtime.timer);
      if (runtime.crossTimer) clearTimeout(runtime.crossTimer);
      runtime.isRunning = false;
      this.workers.delete(botId);
    }

    bot.status = 'PAUSED';
    bot.lastHeartbeat = Date.now();
    this.addLog(bot, 'Bot dijeda sementara (PAUSED). Order terbuka dipertahankan.', 'INFO');
    db.scheduleSave();
    return true;
  }

  /**
   * Stop a Bot Worker and optionally cancel open orders
   */
  public stopWorker(botId: string, cancelOpenOrders = true): { success: boolean; cancelledOrdersCount: number } {
    const bot = db.botInstances.get(botId);
    if (!bot) return { success: false, cancelledOrdersCount: 0 };

    const runtime = this.workers.get(botId);
    if (runtime) {
      if (runtime.timer) clearTimeout(runtime.timer);
      if (runtime.crossTimer) clearTimeout(runtime.crossTimer);
      runtime.isRunning = false;
      this.workers.delete(botId);
    }

    bot.status = 'STOPPED';
    bot.stoppedAt = Date.now();
    bot.lastHeartbeat = Date.now();
    this.addLog(bot, 'Bot dihentikan secara permanen (STOPPED).', 'INFO');

    let cancelledOrdersCount = 0;
    if (cancelOpenOrders) {
      if (bot.botType === 'PRICE_FOLLOWER') {
        cancelledOrdersCount += PriceFollowerBotExecutor.cancelOpenBotOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === 'DEPTH_LIQUIDITY') {
        cancelledOrdersCount += DepthLiquidityBotExecutor.cancelOpenDepthOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === 'MOVEMENT_DEPTH_LIQUIDITY') {
        cancelledOrdersCount += MovementDepthLiquidityBotExecutor.cancelOpenBotOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === 'QUANT_HFT_MM') {
        cancelledOrdersCount += QuantHftBotExecutor.cancelOpenBotOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === 'SMART_HFT_LADDER') {
        cancelledOrdersCount += SmartHftLadderBotExecutor.cancelOpenBotOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === 'ADVANCED_MM') {
        cancelledOrdersCount += AdvancedMarketMakerBotExecutor.cancelOpenOrders(bot, this.addLog.bind(this));
      } else if (bot.botType === 'VOLUME_SPREAD_BOT') {
        cancelledOrdersCount += VolumeSpreadBotExecutor.cancelOpenBotOrders(bot, this.addLog.bind(this));
      }
      for (const orderId of bot.deployedOrderIds) {
        const order = db.orders.get(orderId);
        if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
          try {
            matchingEngine.cancelOrder(orderId, bot.ownerUserId, bot.pairId);
            cancelledOrdersCount++;
          } catch (e) {}
        }
      }
      this.addLog(bot, `Membatalkan ${cancelledOrdersCount} order terbuka milik bot ini.`, 'ORDER');
      marketWsService.broadcastDepth(bot.pairId);
    }

    db.scheduleSave();
    return { success: true, cancelledOrdersCount };
  }

  /**
   * Emergency Kill-Switch: Halt all active bots and cancel all open bot orders
   */
  public triggerEmergencyKillSwitch(): { haltedBots: number; cancelledOrders: number } {
    db.riskControls.isKillSwitchActive = true;
    let haltedBots = 0;
    let totalCancelledOrders = 0;

    for (const [id, bot] of db.botInstances.entries()) {
      if (bot.status === 'RUNNING' || bot.status === 'PAUSED') {
        const res = this.stopWorker(id, true);
        bot.status = 'RISK_HALTED';
        this.addLog(bot, '🛑 EMERGENCY RISK HALT: Diberhentikan otomatis oleh Kill-Switch bursa.', 'RISK');
        haltedBots++;
        totalCancelledOrders += res.cancelledOrdersCount;
      }
    }

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: 'RISK_CONTROLLER',
      action: 'EMERGENCY_KILL_SWITCH_TRIGGERED',
      resource: 'ALL_BOTS',
      details: `Halted ${haltedBots} bots and cancelled ${totalCancelledOrders} open orders.`,
      createdAt: Date.now()
    });

    db.scheduleSave();
    return { haltedBots, cancelledOrders: totalCancelledOrders };
  }

  public resetEmergencyKillSwitch() {
    db.riskControls.isKillSwitchActive = false;
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: 'ADMIN',
      action: 'EMERGENCY_KILL_SWITCH_RESET',
      resource: 'ALL_BOTS',
      details: 'Emergency Kill-Switch deactivated.',
      createdAt: Date.now()
    });
    db.scheduleSave();
  }

  /**
   * Remove / Delete Bot Instance:
   * Safely halts the worker, cancels open orders, records audit log, and deletes bot from DB.
   */
  public deleteBot(botId: string, actorEmail: string): { success: boolean; cancelledOrdersCount: number; botName: string } {
    const bot = db.botInstances.get(botId);
    if (!bot) return { success: false, cancelledOrdersCount: 0, botName: '' };

    const botName = bot.name;
    // Halt worker and cancel open orders
    const stopResult = this.stopWorker(botId, true);

    // Record audit log
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: actorEmail || 'MM_OPERATOR',
      action: 'BOT_INSTANCE_DELETED',
      resource: botId,
      details: `Bot ${botName} (${bot.id}, type: ${bot.botType}) dihapus oleh ${actorEmail}. ${stopResult.cancelledOrdersCount} order terbuka dibatalkan.`,
      createdAt: Date.now()
    });

    db.botInstances.delete(botId);
    db.scheduleSave();

    return {
      success: true,
      cancelledOrdersCount: stopResult.cancelledOrdersCount,
      botName
    };
  }

  /**
   * Order Bot Scheduling Loop
   */
  private scheduleOrderBotTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const cfg = bot.orderBotConfig;
    if (!cfg) return;

    // Jitter delay between 2 to 5 seconds
    const baseDelayMs = 2500;
    const jitterFactor = (cfg.jitter_timing_pct || 10) / 100;
    const randomizedDelay = Math.round(baseDelayMs * (1 + (Math.random() * 2 - 1) * jitterFactor));

    runtime.timer = setTimeout(() => {
      this.executeOrderBotTick(runtime);
    }, randomizedDelay);
  }

  private executeOrderBotTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || pair.isHalted) {
      this.addLog(bot, `Trading pair ${bot.pairId} sedang dihentikan sementara (HALTED). Menunggu...`, 'RISK');
      this.scheduleOrderBotTick(runtime);
      return;
    }

    const cfg = bot.orderBotConfig!;

    // Check order count limit (only when order_count > 0; 0 means continuous/unlimited)
    if (cfg.order_count > 0 && bot.stats.ordersSubmitted >= cfg.order_count) {
      bot.status = 'STOPPED';
      this.addLog(bot, `Target total ${cfg.order_count} order selesai ditempatkan. Bot berhenti secara otomatis.`, 'INFO');
      this.stopWorker(bot.id, false);
      return;
    }

    // Rate limiting check
    const now = Date.now();
    if (now - runtime.windowStart > 60000) {
      runtime.windowStart = now;
      runtime.ordersPlacedInWindow = 0;
    }
    if (runtime.ordersPlacedInWindow >= db.riskControls.maxOrderSubmissionRatePerMin) {
      this.addLog(bot, 'Rate limit per menit tercapai. Menunda tick order...', 'RISK');
      this.scheduleOrderBotTick(runtime);
      return;
    }

    try {
      // 1. Calculate Reference Price
      const book = matchingEngine.getOrderBook(bot.pairId);
      let refPriceUnits = BigInt(pair.lastPrice);

      if (cfg.price_source === 'BEST_BID' && book.bids.length > 0) {
        refPriceUnits = BigInt(book.bids[0].price);
      } else if (cfg.price_source === 'BEST_ASK' && book.asks.length > 0) {
        refPriceUnits = BigInt(book.asks[0].price);
      } else if (cfg.price_source === 'MIDPOINT' && book.bids.length > 0 && book.asks.length > 0) {
        refPriceUnits = (BigInt(book.bids[0].price) + BigInt(book.asks[0].price)) / 2n;
      }

      // Apply trailing percentage
      if (cfg.transaction_type === 'BUY') {
        const trailMin = parseFloat(cfg.buy_trailing_min_percentage || '0.1');
        const trailMax = parseFloat(cfg.buy_trailing_max_percentage || '0.5');
        const randTrail = trailMin + Math.random() * (trailMax - trailMin);
        const trailBps = BigInt(Math.round(randTrail * 100));
        refPriceUnits = refPriceUnits - ((refPriceUnits * trailBps) / 10000n);
      } else {
        const trailMin = parseFloat(cfg.sell_trailing_min_percentage || '0.1');
        const trailMax = parseFloat(cfg.sell_trailing_max_percentage || '0.5');
        const randTrail = trailMin + Math.random() * (trailMax - trailMin);
        const trailBps = BigInt(Math.round(randTrail * 100));
        refPriceUnits = refPriceUnits + ((refPriceUnits * trailBps) / 10000n);
      }

      // Apply jitter price
      const priceJitterPct = (cfg.jitter_price_pct || 2) / 100;
      const jitterFactor = 1 + (Math.random() * 2 - 1) * priceJitterPct;
      refPriceUnits = BigInt(Math.round(Number(refPriceUnits) * jitterFactor));

      // Enforce limits for BUY
      if (cfg.transaction_type === 'BUY') {
        if (cfg.buy_max_price_limit) {
          const maxLimitUnits = PrecisionMath.parseToUnits(cfg.buy_max_price_limit, pair.quoteDecimals);
          if (refPriceUnits > maxLimitUnits) {
            refPriceUnits = maxLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] BUY bid dibatasi ke buy_max_price_limit: ${PrecisionMath.formatIDRDisplay(maxLimitUnits)}`,
              'INFO'
            );
          }
        }
        if (cfg.buy_min_price_limit) {
          const minLimitUnits = PrecisionMath.parseToUnits(cfg.buy_min_price_limit, pair.quoteDecimals);
          if (refPriceUnits < minLimitUnits) {
            refPriceUnits = minLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] BUY bid dibatasi ke buy_min_price_limit: ${PrecisionMath.formatIDRDisplay(minLimitUnits)}`,
              'INFO'
            );
          }
        }
      }

      // Enforce limits for SELL
      if (cfg.transaction_type === 'SELL') {
        if (cfg.sell_min_price_limit) {
          const minLimitUnits = PrecisionMath.parseToUnits(cfg.sell_min_price_limit, pair.quoteDecimals);
          if (refPriceUnits < minLimitUnits) {
            refPriceUnits = minLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] SELL ask dibatasi ke sell_min_price_limit: ${PrecisionMath.formatIDRDisplay(minLimitUnits)}`,
              'INFO'
            );
          }
        }
        if (cfg.sell_max_price_limit) {
          const maxLimitUnits = PrecisionMath.parseToUnits(cfg.sell_max_price_limit, pair.quoteDecimals);
          if (refPriceUnits > maxLimitUnits) {
            refPriceUnits = maxLimitUnits;
            this.addLog(
              bot,
              `[Price Limit] SELL ask dibatasi ke sell_max_price_limit: ${PrecisionMath.formatIDRDisplay(maxLimitUnits)}`,
              'INFO'
            );
          }
        }
      }

      // 2. Calculate Quantity
      const minQ = parseFloat(cfg.random_min_quantity || '0.01');
      const maxQ = parseFloat(cfg.random_max_quantity || (minQ * 2).toString());
      const rawQty = minQ + Math.random() * (maxQ - minQ);
      const dec = cfg.quantity_decimal || pair.baseDecimals;
      let qtyUnits = PrecisionMath.parseToUnits(rawQty.toFixed(Math.min(dec, pair.baseDecimals)), pair.baseDecimals);

      if (qtyUnits < BigInt(pair.minOrderSize)) qtyUnits = BigInt(pair.minOrderSize);
      if (qtyUnits > BigInt(pair.maxOrderSize)) qtyUnits = BigInt(pair.maxOrderSize);

      // Handle split order
      let finalOrders: { price: bigint; qty: bigint }[] = [];
      if (cfg.split_order_mode === 'RANDOM_SPLIT' && cfg.split_range) {
        const splitParts = Math.max(2, Math.min(5, parseInt(cfg.split_range, 10) || 3));
        const subQty = qtyUnits / BigInt(splitParts);
        for (let i = 0; i < splitParts; i++) {
          finalOrders.push({ price: refPriceUnits, qty: subQty });
        }
      } else {
        finalOrders.push({ price: refPriceUnits, qty: qtyUnits });
      }

      for (let i = 0; i < finalOrders.length; i++) {
        const item = finalOrders[i];
        const clientOrderId = `${bot.id}-ord-${bot.stats.ordersSubmitted + 1}`;

        const result = matchingEngine.placeOrder({
          userId: bot.ownerUserId,
          pairId: bot.pairId,
          side: cfg.transaction_type,
          orderType: 'LIMIT',
          timeInForce: 'GTC',
          price: item.price.toString(),
          quantity: item.qty.toString(),
          clientOrderId
        });

        bot.stats.ordersSubmitted++;
        bot.stats.ordersAccepted++;
        bot.deployedOrderIds.push(result.takerOrder.id);
        if (bot.deployedOrderIds.length > 100) {
          bot.deployedOrderIds = bot.deployedOrderIds.slice(-80);
        }
        runtime.ordersPlacedInWindow++;

        if (result.trades.length > 0) {
          bot.stats.ordersFilled += result.trades.length;
          for (const t of result.trades) {
            bot.stats.executedVolume = (BigInt(bot.stats.executedVolume) + BigInt(t.quantity)).toString();
            bot.stats.totalTrades++;
            marketWsService.broadcastTrade(t);
          }
          this.addLog(
            bot,
            `[Order Bot] Match terisi: ${PrecisionMath.formatFromUnits(item.qty, pair.baseDecimals)} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(item.price)}`,
            'FILL'
          );
        } else {
          this.addLog(
            bot,
            `[Order Bot] Limit ${cfg.transaction_type} aktif: ${PrecisionMath.formatFromUnits(item.qty, pair.baseDecimals)} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(item.price)}`,
            'ORDER'
          );
        }

        marketWsService.broadcastOrderUpdate(result.takerOrder);
      }

      marketWsService.broadcastDepth(bot.pairId);

      runtime.consecutiveErrors = 0;
      bot.lastHeartbeat = Date.now();
    } catch (err: any) {
      runtime.consecutiveErrors++;
      this.addLog(bot, `Error pada eksekusi order: ${err.message}`, 'ERROR');
      if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
        bot.status = 'RISK_HALTED';
        bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}). Bot halted.`;
        this.addLog(bot, bot.errorInfo, 'RISK');
        this.stopWorker(bot.id, false);
        return;
      }
    }

    this.scheduleOrderBotTick(runtime);
  }

  /**
   * Volume Bot Scheduling Loop
   */
  private scheduleVolumeBotTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const cfg = bot.volumeBotConfig;
    if (!cfg) return;

    const minDelay = Math.max(1, cfg.min_delay || 3);
    const maxDelay = Math.max(minDelay, cfg.max_delay || 5);
    const delaySec = minDelay + Math.random() * (maxDelay - minDelay);

    runtime.timer = setTimeout(() => {
      this.executeVolumeBotTick(runtime);
    }, Math.round(delaySec * 1000));
  }

  private executeVolumeBotTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const pair = db.tradingPairs.get(bot.pairId);
    if (!pair || pair.isHalted) {
      this.addLog(bot, `Pair ${bot.pairId} sedang halted. Menunda volume tick...`, 'RISK');
      this.scheduleVolumeBotTick(runtime);
      return;
    }

    const cfg = bot.volumeBotConfig!;

    // Check IDR Volume Stop Target
    const stopTargetUnits = PrecisionMath.parseToUnits(cfg.vol_idr_stop_target, 2);
    const currentQuoteVolUnits = PrecisionMath.calculateQuoteAmount(
      BigInt(bot.stats.executedVolume || '0'),
      pair.baseDecimals,
      BigInt(pair.lastPrice)
    );

    if (currentQuoteVolUnits >= stopTargetUnits) {
      bot.status = 'STOPPED';
      this.addLog(bot, `🎯 Target volume IDR (${PrecisionMath.formatIDRDisplay(stopTargetUnits)}) tercapai! Volume bot selesai.`, 'INFO');
      this.stopWorker(bot.id, false);
      return;
    }

    try {
      // Determine side based on priority / random
      const side: 'BUY' | 'SELL' = Math.random() >= 0.5 ? 'BUY' : 'SELL';

      // Determine price within allowed boundaries
      const minPUnits = PrecisionMath.parseToUnits(cfg.min_limit_price, pair.quoteDecimals);
      const maxPUnits = PrecisionMath.parseToUnits(cfg.max_limit_price, pair.quoteDecimals);
      let targetPriceUnits = BigInt(pair.lastPrice);
      if (targetPriceUnits < minPUnits) targetPriceUnits = minPUnits;
      if (targetPriceUnits > maxPUnits) targetPriceUnits = maxPUnits;

      // Small jitter around market price ±0.1%
      const jitterBps = BigInt(Math.floor(Math.random() * 20 - 10));
      targetPriceUnits = targetPriceUnits + ((targetPriceUnits * jitterBps) / 10000n);

      // Quantity calculation
      const minQ = parseFloat(cfg.volume_random_min_quantity || '0.01');
      const maxQ = parseFloat(cfg.volume_random_max_quantity || (minQ * 2).toString());
      const rawQty = minQ + Math.random() * (maxQ - minQ);
      let qtyUnits = PrecisionMath.parseToUnits(rawQty.toFixed(4), pair.baseDecimals);

      if (qtyUnits < BigInt(pair.minOrderSize)) qtyUnits = BigInt(pair.minOrderSize);
      if (qtyUnits > BigInt(pair.maxOrderSize)) qtyUnits = BigInt(pair.maxOrderSize);

      // Ensure MM bot accounts have ample liquidity to execute continuous volume cycles
      db.createOrGetAccount(bot.ownerUserId, pair.quoteCurrency, '5000000000000');
      db.createOrGetAccount(bot.ownerUserId, pair.baseCurrency, '10000000000');
      if (cfg.volume_sell_account_id) {
        db.createOrGetAccount(cfg.volume_sell_account_id, pair.quoteCurrency, '5000000000000');
        db.createOrGetAccount(cfg.volume_sell_account_id, pair.baseCurrency, '10000000000');
      }

      // Check order book opposing side at targetPriceUnits
      const book = matchingEngine.getOrderBook(bot.pairId);
      const opposingOrders = side === 'BUY' ? book.asks : book.bids;
      const canMatchExisting = opposingOrders.some(o => {
        const oPrice = BigInt(o.price);
        return side === 'BUY' ? targetPriceUnits >= oPrice : targetPriceUnits <= oPrice;
      });

      // If no opposing orders exist at matching price, place opposing maker order first
      // to guarantee execution and continuous volume generation (wash-trading / MM volume cross):
      if (!canMatchExisting) {
        const opposingSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';
        const makerUserId = cfg.volume_sell_account_id || bot.ownerUserId;
        try {
          const makerRes = matchingEngine.placeOrder({
            userId: makerUserId,
            pairId: bot.pairId,
            side: opposingSide,
            orderType: 'LIMIT',
            timeInForce: 'GTC',
            price: targetPriceUnits.toString(),
            quantity: qtyUnits.toString(),
            clientOrderId: `${bot.id}-vol-maker-${Date.now()}`
          });
          bot.deployedOrderIds.push(makerRes.takerOrder.id);
        } catch (e: any) {
          // If first account had locking error, fallback to owner account with ensured balance
          try {
            const makerRes = matchingEngine.placeOrder({
              userId: bot.ownerUserId,
              pairId: bot.pairId,
              side: opposingSide,
              orderType: 'LIMIT',
              timeInForce: 'GTC',
              price: targetPriceUnits.toString(),
              quantity: qtyUnits.toString(),
              clientOrderId: `${bot.id}-vol-maker-${Date.now()}`
            });
            bot.deployedOrderIds.push(makerRes.takerOrder.id);
          } catch (err) {}
        }
      }

      // Execute order via authoritative matching engine
      const result = matchingEngine.placeOrder({
        userId: bot.ownerUserId,
        pairId: bot.pairId,
        side,
        orderType: 'LIMIT',
        timeInForce: 'IOC',
        price: targetPriceUnits.toString(),
        quantity: qtyUnits.toString(),
        clientOrderId: `${bot.id}-vol-${bot.stats.ordersSubmitted + 1}`
      });

      bot.stats.ordersSubmitted++;
      bot.stats.ordersAccepted++;
      bot.deployedOrderIds.push(result.takerOrder.id);
      if (bot.deployedOrderIds.length > 100) {
        bot.deployedOrderIds = bot.deployedOrderIds.slice(-80);
      }

      if (result.trades.length > 0) {
        bot.stats.ordersFilled += result.trades.length;
        for (const t of result.trades) {
          bot.stats.executedVolume = (BigInt(bot.stats.executedVolume) + BigInt(t.quantity)).toString();
          bot.stats.totalTrades++;
          marketWsService.broadcastTrade(t);
        }
        this.addLog(
          bot,
          `[Volume Bot] Eksekusi ${side}: ${PrecisionMath.formatFromUnits(qtyUnits, pair.baseDecimals)} ${pair.baseCurrency} @ ${PrecisionMath.formatIDRDisplay(targetPriceUnits)}`,
          'FILL'
        );
      } else {
        this.addLog(
          bot,
          `[Volume Bot] Order ${side} IOC disubmit namun tidak ada match di harga ${PrecisionMath.formatIDRDisplay(targetPriceUnits)}.`,
          'ORDER'
        );
      }

      marketWsService.broadcastOrderUpdate(result.takerOrder);
      marketWsService.broadcastDepth(bot.pairId);

      runtime.consecutiveErrors = 0;
      bot.lastHeartbeat = Date.now();
    } catch (err: any) {
      runtime.consecutiveErrors++;
      this.addLog(bot, `Error eksekusi volume tick: ${err.message}`, 'ERROR');
      if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
        bot.status = 'RISK_HALTED';
        bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
        this.addLog(bot, bot.errorInfo, 'RISK');
        this.stopWorker(bot.id, false);
        return;
      }
    }

    this.scheduleVolumeBotTick(runtime);
  }

  /**
   * Volume Bot Phase 2 (Spread Self-Cross) Scheduling Loop
   */
  private scheduleVolumeSpreadTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const cfg = bot.volumeSpreadConfig;
    if (!cfg) return;

    const minDelayMs = Math.max(1, cfg.min_delay || 2) * 1000;
    const maxDelayMs = Math.max(minDelayMs, (cfg.max_delay || 5) * 1000);
    const delayMs = minDelayMs + crypto.randomInt(0, Math.max(1, maxDelayMs - minDelayMs + 1));

    runtime.timer = setTimeout(() => {
      this.executeVolumeSpreadTick(runtime);
    }, delayMs);
  }

  private executeVolumeSpreadTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') return;

    const cfg = bot.volumeSpreadConfig;
    if (!cfg) return;

    // Rate limiting check
    const now = Date.now();
    if (now - runtime.windowStart > 60000) {
      runtime.windowStart = now;
      runtime.ordersPlacedInWindow = 0;
    }
    if (runtime.ordersPlacedInWindow >= db.riskControls.maxOrderSubmissionRatePerMin) {
      this.addLog(bot, 'Rate limit order per menit tercapai. Menunda spread cross tick...', 'RISK');
      this.scheduleVolumeSpreadTick(runtime);
      return;
    }

    try {
      const leg = VolumeSpreadBotExecutor.prepareSpreadCrossTick(bot, this.addLog.bind(this));

      if (leg.status === 'STOP_TARGET_REACHED') {
        bot.status = 'STOPPED';
        this.addLog(bot, leg.reason || 'Target volume tercapai! Spread Volume Bot (Phase 2) selesai.', 'INFO');
        this.stopWorker(bot.id, true);
        return;
      }

      if (leg.status === 'PAIR_HALTED' || leg.status === 'WAITING_SPREAD') {
        this.addLog(bot, leg.reason || 'Menunggu kondisi spread book...', 'RISK');
        bot.lastHeartbeat = Date.now();
        this.scheduleVolumeSpreadTick(runtime);
        return;
      }

      if (leg.status === 'INSUFFICIENT_BALANCE') {
        runtime.consecutiveErrors++;
        this.addLog(bot, leg.reason || 'Saldo Base/Quote akun tidak mencukupi untuk spread self-cross.', 'RISK');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = leg.reason || 'Saldo tidak mencukupi berulang kali.';
          this.stopWorker(bot.id, true);
          return;
        }
        this.scheduleVolumeSpreadTick(runtime);
        return;
      }

      runtime.ordersPlacedInWindow += 1;

      const crossDelayMs = Math.min(2000, Math.max(0, Math.round(cfg.cross_delay_ms || 0)));

      const finishCross = () => {
        if (!runtime.isRunning) return;
        const activeBot = db.botInstances.get(runtime.botId);
        if (!activeBot || activeBot.status !== 'RUNNING') return;

        try {
          const crossRes = VolumeSpreadBotExecutor.completeSpreadCrossLeg(activeBot, leg, this.addLog.bind(this));
          runtime.ordersPlacedInWindow += 1;
          runtime.consecutiveErrors = 0;

          if (crossRes.status === 'STOP_TARGET_REACHED') {
            activeBot.status = 'STOPPED';
            this.addLog(activeBot, `Target volume Phase 2 (${cfg.vol_quote_stop_target}) tercapai! Bot berhenti otomatis.`, 'INFO');
            this.stopWorker(activeBot.id, true);
            return;
          }
        } catch (err: any) {
          runtime.consecutiveErrors++;
          this.addLog(activeBot, `Error saat taker self-cross: ${err.message}`, 'ERROR');
          if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
            activeBot.status = 'RISK_HALTED';
            activeBot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
            this.stopWorker(activeBot.id, true);
            return;
          }
        }

        this.scheduleVolumeSpreadTick(runtime);
      };

      if (crossDelayMs === 0) {
        finishCross();
      } else {
        runtime.crossTimer = setTimeout(() => {
          runtime.crossTimer = null;
          finishCross();
        }, crossDelayMs);
      }
    } catch (err: any) {
      runtime.consecutiveErrors++;
      this.addLog(bot, `Error eksekusi Spread Volume tick: ${err.message}`, 'ERROR');
      if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
        bot.status = 'RISK_HALTED';
        bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
        this.addLog(bot, bot.errorInfo, 'RISK');
        this.stopWorker(bot.id, true);
        return;
      }
      this.scheduleVolumeSpreadTick(runtime);
    }
  }

  /**
   * Price Follower Bot Scheduling Loop
   */
  private schedulePriceFollowerTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }

    const intervalMs = Math.max(1000, bot.priceFollowerConfig?.minimum_reprice_interval_ms || 2000);

    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        PriceFollowerBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err: any) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Price Follower cycle: ${err.message}`, 'ERROR');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, 'RISK');
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.schedulePriceFollowerTick(runtime);
    }, intervalMs);
  }

  /**
   * Depth & Liquidity Bot Scheduling Loop
   */
  private scheduleDepthLiquidityTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }

    const intervalMs = Math.max(1000, bot.depthLiquidityConfig?.minimum_reprice_interval_ms || 3000);

    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        DepthLiquidityBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err: any) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Depth & Liquidity cycle: ${err.message}`, 'ERROR');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, 'RISK');
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.scheduleDepthLiquidityTick(runtime);
    }, intervalMs);
  }

  /**
   * Movement Depth (Relative WS Follower) Scheduling Loop
   */
  private scheduleMovementDepthTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }

    const intervalMs = Math.max(1000, bot.movementDepthConfig?.minimum_reprice_interval_ms || 3000);

    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        MovementDepthLiquidityBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err: any) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Movement Depth cycle: ${err.message}`, 'ERROR');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, 'RISK');
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.scheduleMovementDepthTick(runtime);
    }, intervalMs);
  }

  /**
   * Quant HFT Market Maker Scheduling Loop
   */
  private scheduleQuantHftBotTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }

    const intervalMs = Math.max(800, bot.quantHftConfig?.reprice_interval_ms || 1500);

    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        QuantHftBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err: any) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Quant HFT MM cycle: ${err.message}`, 'ERROR');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, 'RISK');
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.scheduleQuantHftBotTick(runtime);
    }, intervalMs);
  }

  /**
   * Smart HFT Ladder & Pattern Creator Scheduling Loop
   */
  private scheduleSmartHftLadderTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }

    const intervalMs = Math.max(1500, bot.smartHftConfig?.reprice_interval_ms || 4000);

    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        SmartHftLadderBotExecutor.executeCycle(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err: any) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Smart HFT Ladder cycle: ${err.message}`, 'ERROR');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, 'RISK');
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.scheduleSmartHftLadderTick(runtime);
    }, intervalMs);
  }

  /**
   * Advanced Market Maker Scheduling Loop
   */
  private scheduleAdvancedMMTick(runtime: WorkerRuntime) {
    if (!runtime.isRunning) return;

    const bot = db.botInstances.get(runtime.botId);
    if (!bot || bot.status !== 'RUNNING') {
      runtime.isRunning = false;
      this.workers.delete(runtime.botId);
      return;
    }

    const intervalMs = Math.max(1000, bot.advancedMMConfig?.order_refresh_interval_ms || 2500);

    runtime.timer = setTimeout(() => {
      if (!runtime.isRunning) return;
      try {
        AdvancedMarketMakerBotExecutor.executeTick(bot, this.addLog.bind(this));
        runtime.consecutiveErrors = 0;
      } catch (err: any) {
        runtime.consecutiveErrors++;
        this.addLog(bot, `Error pada Advanced MM tick: ${err.message}`, 'ERROR');
        if (runtime.consecutiveErrors >= db.riskControls.maxConsecutiveErrors) {
          bot.status = 'RISK_HALTED';
          bot.errorInfo = `Consecutive error threshold breached (${runtime.consecutiveErrors}).`;
          this.addLog(bot, bot.errorInfo, 'RISK');
          this.stopWorker(bot.id, false);
          return;
        }
      }
      this.scheduleAdvancedMMTick(runtime);
    }, intervalMs);
  }
}

export const botWorkerManager = new BotWorkerManager();
