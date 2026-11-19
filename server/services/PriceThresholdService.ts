/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PriceThresholdService.ts
 * Real-time Market Maker Price Threshold Monitor & Automated Ladder Adjustment Engine.
 * Evaluates authoritative pair.lastPrice in exact BigInt quote units, emits WebSocket alerts
 * (triggering client-side Web Audio notifications), and executes automated ladder adjustments
 * across targeted or pair-matched MM/Ladder bots.
 */

import crypto from 'crypto';
import { db } from '../db/database.js';
import {
  BotInstance,
  Environment,
  PriceThresholdAction,
  PriceThresholdCondition,
  PriceThresholdEvent,
  PriceThresholdSoundTone,
  PriceThresholdTrigger,
} from '../db/types.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { marketWsService } from '../websocket/MarketDataWs.js';
import { botWorkerManager } from './BotWorkerManager.js';
import { SmartHftLadderBotExecutor } from './bots/SmartHftLadderBot.js';
import { DepthLiquidityBotExecutor } from './bots/DepthLiquidityBot.js';
import { MovementDepthLiquidityBotExecutor } from './bots/MovementDepthLiquidityBot.js';
import { QuantHftBotExecutor } from './bots/QuantHftBot.js';
import { AdvancedMarketMakerBotExecutor } from './bots/AdvancedMarketMakerBot.js';

export const LADDER_CAPABLE_BOT_TYPES = new Set([
  'SMART_HFT_LADDER',
  'DEPTH_LIQUIDITY',
  'MOVEMENT_DEPTH_LIQUIDITY',
  'QUANT_HFT_MM',
  'ADVANCED_MM',
]);

class PriceThresholdService {
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.evaluateAll();
    }, 1000);
    console.log('[DIMONEX PriceThresholdService] Monitor threshold harga MM aktif (interval 1000ms).');
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public createTrigger(input: {
    name: string;
    pairId: string;
    environment: Environment;
    condition: PriceThresholdCondition;
    thresholdPrice: string;
    soundEnabled: boolean;
    soundTone: PriceThresholdSoundTone;
    action: PriceThresholdAction;
    targetBotId?: string;
    adjustStepPct?: number;
    cooldownSec?: number;
    autoResetAfterCooldown?: boolean;
    createdBy: string;
  }): PriceThresholdTrigger {
    const pair = db.tradingPairs.get(input.pairId);
    if (!pair) {
      throw new Error(`Trading pair ${input.pairId} tidak ditemukan.`);
    }

    const quoteDecimals =
      pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
        ? pair.quoteDecimals
        : pair.quoteCurrency === 'USDT'
        ? 6
        : 2;

    const thresholdPriceUnits = PrecisionMath.parseToUnits(input.thresholdPrice, quoteDecimals);
    if (thresholdPriceUnits <= 0n) {
      throw new Error('Harga threshold harus lebih besar dari 0.');
    }

    if (input.targetBotId) {
      const targetBot = db.botInstances.get(input.targetBotId);
      if (!targetBot) {
        throw new Error(`Target bot ${input.targetBotId} tidak ditemukan.`);
      }
    }

    const now = Date.now();
    const trigger: PriceThresholdTrigger = {
      id: `pt-${crypto.randomUUID().slice(0, 8)}`,
      name: (input.name || `${input.pairId} ${input.condition}`).trim(),
      pairId: pair.id,
      environment: input.environment || 'DEMO',
      condition: input.condition || 'ABOVE_OR_EQUAL',
      thresholdPrice: PrecisionMath.formatFromUnits(thresholdPriceUnits, quoteDecimals),
      thresholdPriceUnits: thresholdPriceUnits.toString(),
      quoteCurrency: pair.quoteCurrency,
      quoteDecimals,
      soundEnabled: input.soundEnabled !== false && input.soundTone !== 'NONE',
      soundTone: input.soundTone || 'CHIME',
      action: input.action || 'NONE',
      targetBotId: input.targetBotId || undefined,
      adjustStepPct: Math.max(0.1, Math.min(25, Number(input.adjustStepPct ?? 1.5))),
      cooldownSec: Math.max(5, Math.min(86400, Math.round(Number(input.cooldownSec ?? 30)))),
      autoResetAfterCooldown: input.autoResetAfterCooldown !== false,
      enabled: true,
      status: 'ARMED',
      triggerCount: 0,
      lastObservedPriceUnits: pair.lastPrice || '0',
      createdBy: input.createdBy || 'MM_OPERATOR',
      createdAt: now,
      updatedAt: now,
    };

    db.priceThresholdTriggers.set(trigger.id, trigger);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: trigger.createdBy,
      action: 'PRICE_THRESHOLD_CREATED',
      resource: trigger.id,
      details: `Threshold "${trigger.name}" pada ${trigger.pairId} (${trigger.condition} @ ${trigger.thresholdPrice} ${trigger.quoteCurrency}, aksi: ${trigger.action}).`,
      createdAt: now,
    });
    db.scheduleSave();
    return trigger;
  }

  public updateTrigger(
    id: string,
    patch: Partial<{
      name: string;
      condition: PriceThresholdCondition;
      thresholdPrice: string;
      soundEnabled: boolean;
      soundTone: PriceThresholdSoundTone;
      action: PriceThresholdAction;
      targetBotId: string;
      adjustStepPct: number;
      cooldownSec: number;
      autoResetAfterCooldown: boolean;
      enabled: boolean;
      rearm: boolean;
    }>
  ): PriceThresholdTrigger {
    const existing = db.priceThresholdTriggers.get(id);
    if (!existing) {
      throw new Error('Aturan price threshold tidak ditemukan.');
    }

    const pair = db.tradingPairs.get(existing.pairId);
    const quoteDecimals = pair?.quoteDecimals ?? existing.quoteDecimals;

    if (patch.name !== undefined) existing.name = patch.name.trim() || existing.name;
    if (patch.condition !== undefined) existing.condition = patch.condition;
    if (patch.thresholdPrice !== undefined) {
      const units = PrecisionMath.parseToUnits(patch.thresholdPrice, quoteDecimals);
      if (units <= 0n) throw new Error('Harga threshold harus lebih besar dari 0.');
      existing.thresholdPrice = PrecisionMath.formatFromUnits(units, quoteDecimals);
      existing.thresholdPriceUnits = units.toString();
      existing.quoteDecimals = quoteDecimals;
    }
    if (patch.soundEnabled !== undefined) existing.soundEnabled = Boolean(patch.soundEnabled);
    if (patch.soundTone !== undefined) existing.soundTone = patch.soundTone;
    if (patch.action !== undefined) existing.action = patch.action;
    if (patch.targetBotId !== undefined) existing.targetBotId = patch.targetBotId || undefined;
    if (patch.adjustStepPct !== undefined) {
      existing.adjustStepPct = Math.max(0.1, Math.min(25, Number(patch.adjustStepPct)));
    }
    if (patch.cooldownSec !== undefined) {
      existing.cooldownSec = Math.max(5, Math.min(86400, Math.round(Number(patch.cooldownSec))));
    }
    if (patch.autoResetAfterCooldown !== undefined) {
      existing.autoResetAfterCooldown = Boolean(patch.autoResetAfterCooldown);
    }
    if (patch.enabled !== undefined) {
      existing.enabled = Boolean(patch.enabled);
      if (existing.enabled && existing.status === 'TRIGGERED') {
        existing.status = 'ARMED';
      }
    }
    if (patch.rearm) {
      existing.enabled = true;
      existing.status = 'ARMED';
      if (pair?.lastPrice) {
        existing.lastObservedPriceUnits = pair.lastPrice;
      }
    }

    existing.updatedAt = Date.now();
    db.priceThresholdTriggers.set(existing.id, existing);
    db.scheduleSave();
    return existing;
  }

  public deleteTrigger(id: string): boolean {
    const deleted = db.priceThresholdTriggers.delete(id);
    if (deleted) db.scheduleSave();
    return deleted;
  }

  public listTriggers(environment?: Environment, pairId?: string): PriceThresholdTrigger[] {
    let items = Array.from(db.priceThresholdTriggers.values());
    if (environment) items = items.filter((t) => t.environment === environment);
    if (pairId) items = items.filter((t) => t.pairId === pairId);
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  public listEvents(environment?: Environment, limit = 60): PriceThresholdEvent[] {
    let items = db.priceThresholdEvents;
    if (environment) items = items.filter((e) => e.environment === environment);
    return items.slice(-limit).reverse();
  }

  public triggerManualTest(id: string, executeBotAdjustment = true): PriceThresholdEvent {
    const trigger = db.priceThresholdTriggers.get(id);
    if (!trigger) {
      throw new Error('Aturan price threshold tidak ditemukan.');
    }
    const pair = db.tradingPairs.get(trigger.pairId);
    const liveUnits = pair?.lastPrice || trigger.thresholdPriceUnits;

    let adjustmentSummary = 'Notifikasi suara uji coba dipicu (tanpa modifikasi bot).';
    if (executeBotAdjustment && trigger.action !== 'NONE') {
      adjustmentSummary = this.executeLadderAction(trigger, BigInt(liveUnits), true);
    }

    const event: PriceThresholdEvent = {
      id: `pte-${crypto.randomUUID().slice(0, 8)}`,
      triggerId: trigger.id,
      triggerName: trigger.name,
      pairId: trigger.pairId,
      environment: trigger.environment,
      condition: trigger.condition,
      thresholdPriceUnits: trigger.thresholdPriceUnits,
      breachedPriceUnits: liveUnits,
      quoteCurrency: trigger.quoteCurrency,
      quoteDecimals: trigger.quoteDecimals,
      soundEnabled: trigger.soundEnabled,
      soundTone: trigger.soundTone,
      action: trigger.action,
      targetBotId: trigger.targetBotId,
      adjustmentSummary,
      timestamp: Date.now(),
      isTest: true,
    };

    this.recordEvent(event);
    return event;
  }

  public evaluateAll() {
    if (this.isTickRunning) return;
    this.isTickRunning = true;
    try {
      const now = Date.now();
      for (const trigger of db.priceThresholdTriggers.values()) {
        const pair = db.tradingPairs.get(trigger.pairId);
        if (!pair || !pair.lastPrice) continue;

        const currentUnits = BigInt(pair.lastPrice);
        const thresholdUnits = BigInt(trigger.thresholdPriceUnits);

        // Handle cooldown expiry
        if (trigger.status === 'COOLDOWN' && trigger.lastTriggeredAt) {
          const elapsedMs = now - trigger.lastTriggeredAt;
          if (elapsedMs >= trigger.cooldownSec * 1000) {
            if (trigger.autoResetAfterCooldown && trigger.enabled) {
              trigger.status = 'ARMED';
              trigger.updatedAt = now;
              db.priceThresholdTriggers.set(trigger.id, trigger);
            }
          } else {
            trigger.lastObservedPriceUnits = currentUnits.toString();
            continue;
          }
        }

        if (!trigger.enabled || trigger.status !== 'ARMED') {
          trigger.lastObservedPriceUnits = currentUnits.toString();
          continue;
        }

        const prevUnits = trigger.lastObservedPriceUnits
          ? BigInt(trigger.lastObservedPriceUnits)
          : currentUnits;

        let breached = false;
        if (trigger.condition === 'ABOVE_OR_EQUAL') {
          breached = currentUnits >= thresholdUnits;
        } else if (trigger.condition === 'BELOW_OR_EQUAL') {
          breached = currentUnits <= thresholdUnits;
        } else if (trigger.condition === 'CROSS_EITHER') {
          const crossedUp = prevUnits < thresholdUnits && currentUnits >= thresholdUnits;
          const crossedDown = prevUnits > thresholdUnits && currentUnits <= thresholdUnits;
          breached = crossedUp || crossedDown || currentUnits === thresholdUnits;
        }

        trigger.lastObservedPriceUnits = currentUnits.toString();

        if (breached) {
          this.fireTrigger(trigger, currentUnits, now);
        }
      }
    } catch (err) {
      console.error('[PriceThresholdService] Evaluation loop error:', err);
    } finally {
      this.isTickRunning = false;
    }
  }

  private fireTrigger(trigger: PriceThresholdTrigger, currentUnits: bigint, now: number) {
    const adjustmentSummary =
      trigger.action !== 'NONE'
        ? this.executeLadderAction(trigger, currentUnits, false)
        : `Alert threshold tercapai pada ${trigger.pairId} (Suara: ${trigger.soundEnabled ? trigger.soundTone : 'OFF'}).`;

    trigger.triggerCount += 1;
    trigger.lastTriggeredAt = now;
    trigger.updatedAt = now;

    if (trigger.autoResetAfterCooldown) {
      trigger.status = 'COOLDOWN';
    } else {
      trigger.status = 'TRIGGERED';
      trigger.enabled = false;
    }

    db.priceThresholdTriggers.set(trigger.id, trigger);

    const event: PriceThresholdEvent = {
      id: `pte-${crypto.randomUUID().slice(0, 8)}`,
      triggerId: trigger.id,
      triggerName: trigger.name,
      pairId: trigger.pairId,
      environment: trigger.environment,
      condition: trigger.condition,
      thresholdPriceUnits: trigger.thresholdPriceUnits,
      breachedPriceUnits: currentUnits.toString(),
      quoteCurrency: trigger.quoteCurrency,
      quoteDecimals: trigger.quoteDecimals,
      soundEnabled: trigger.soundEnabled,
      soundTone: trigger.soundTone,
      action: trigger.action,
      targetBotId: trigger.targetBotId,
      adjustmentSummary,
      timestamp: now,
    };

    this.recordEvent(event);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: 'PRICE_THRESHOLD_ENGINE',
      action: 'PRICE_THRESHOLD_TRIGGERED',
      resource: trigger.id,
      details: `${trigger.name} (${trigger.pairId}): ${adjustmentSummary}`,
      createdAt: now,
    });
    db.scheduleSave();
  }

  private recordEvent(event: PriceThresholdEvent) {
    db.priceThresholdEvents.push(event);
    if (db.priceThresholdEvents.length > 500) {
      db.priceThresholdEvents = db.priceThresholdEvents.slice(-500);
    }
    marketWsService.broadcast('ticker', {
      type: 'price_threshold_triggered',
      event,
    });
  }

  private resolveTargetBots(trigger: PriceThresholdTrigger): BotInstance[] {
    if (trigger.targetBotId) {
      const bot = db.botInstances.get(trigger.targetBotId);
      return bot ? [bot] : [];
    }
    return Array.from(db.botInstances.values()).filter(
      (b) =>
        b.pairId === trigger.pairId &&
        b.environment === trigger.environment &&
        LADDER_CAPABLE_BOT_TYPES.has(b.botType) &&
        (b.status === 'RUNNING' || b.status === 'PAUSED' || b.status === 'READY')
    );
  }

  private executeLadderAction(
    trigger: PriceThresholdTrigger,
    currentPriceUnits: bigint,
    isTest: boolean
  ): string {
    const bots = this.resolveTargetBots(trigger);
    if (bots.length === 0) {
      return `Tidak ada bot ladder/MM aktif pada ${trigger.pairId} (${trigger.environment}) untuk disesuaikan.`;
    }

    const pair = db.tradingPairs.get(trigger.pairId);
    const quoteDec = pair?.quoteDecimals ?? trigger.quoteDecimals;
    const currentPriceFloat = Number(currentPriceUnits) / 10 ** quoteDec;
    const stepRatio = Math.max(0.001, trigger.adjustStepPct / 100);
    const tag = isTest ? '[TEST THRESHOLD]' : '[PRICE THRESHOLD]';

    let adjustedCount = 0;
    const adjustedNames: string[] = [];

    for (const bot of bots) {
      const addLog = botWorkerManager.addLog.bind(botWorkerManager);

      if (trigger.action === 'PAUSE_BOT') {
        if (bot.status === 'RUNNING') {
          botWorkerManager.pauseWorker(bot.id);
          addLog(bot, `${tag} Bot dijeda otomatis oleh trigger "${trigger.name}".`, 'RISK');
          adjustedCount++;
          adjustedNames.push(bot.name);
        }
        continue;
      }

      if (bot.botType === 'SMART_HFT_LADDER' && bot.smartHftConfig) {
        const cfg = bot.smartHftConfig;
        const oldMin = parseFloat(String(cfg.min_price_bound || currentPriceFloat * 0.96));
        const oldMax = parseFloat(String(cfg.max_price_bound || currentPriceFloat * 1.04));
        const halfBandRatio =
          oldMin > 0 && oldMax > oldMin
            ? Math.min(0.15, Math.max(0.01, (oldMax - oldMin) / (2 * Math.max(1e-8, (oldMax + oldMin) / 2))))
            : 0.04;

        if (trigger.action === 'LADDER_RECENTER') {
          cfg.bound_percentage = undefined;
          cfg.min_price_bound = (currentPriceFloat * (1 - halfBandRatio)).toFixed(quoteDec);
          cfg.max_price_bound = (currentPriceFloat * (1 + halfBandRatio)).toFixed(quoteDec);
          cfg.lastAnchorPrice = currentPriceFloat.toFixed(quoteDec);
        } else if (trigger.action === 'LADDER_WIDEN_SPREAD') {
          const newHalf = Math.min(0.15, halfBandRatio * (1 + stepRatio * 4));
          cfg.min_price_bound = (currentPriceFloat * (1 - newHalf)).toFixed(quoteDec);
          cfg.max_price_bound = (currentPriceFloat * (1 + newHalf)).toFixed(quoteDec);
          cfg.min_spread_bps = Math.min(500, Math.round((cfg.min_spread_bps || 20) * (1 + stepRatio * 2)));
          cfg.spread_percentage = Number(((cfg.spread_percentage || 0.2) * (1 + stepRatio * 2)).toFixed(3));
        } else if (trigger.action === 'LADDER_SHIFT_UP') {
          cfg.bound_percentage = undefined;
          cfg.min_price_bound = (oldMin * (1 + stepRatio)).toFixed(quoteDec);
          cfg.max_price_bound = (oldMax * (1 + stepRatio)).toFixed(quoteDec);
        } else if (trigger.action === 'LADDER_SHIFT_DOWN') {
          cfg.bound_percentage = undefined;
          cfg.min_price_bound = Math.max(1 / 10 ** quoteDec, oldMin * (1 - stepRatio)).toFixed(quoteDec);
          cfg.max_price_bound = Math.max(2 / 10 ** quoteDec, oldMax * (1 - stepRatio)).toFixed(quoteDec);
        }

        cfg.lastRepriceTimestamp = 0;
        addLog(
          bot,
          `${tag} Penyesuaian Smart HFT Ladder (${trigger.action}, step ${trigger.adjustStepPct}%) -> Bounds [${cfg.min_price_bound} .. ${cfg.max_price_bound}]`,
          'ORDER'
        );
        if (bot.status === 'RUNNING') {
          SmartHftLadderBotExecutor.executeCycle(bot, addLog);
        }
        adjustedCount++;
        adjustedNames.push(bot.name);
      } else if (bot.botType === 'DEPTH_LIQUIDITY' && bot.depthLiquidityConfig) {
        const cfg = bot.depthLiquidityConfig;
        if (trigger.action === 'LADDER_RECENTER') {
          cfg.min_limit_buy_price = (currentPriceFloat * (1 - stepRatio * 3)).toFixed(quoteDec);
          cfg.max_limit_buy_price = (currentPriceFloat * (1 - stepRatio * 0.4)).toFixed(quoteDec);
          cfg.min_limit_sell_price = (currentPriceFloat * (1 + stepRatio * 0.4)).toFixed(quoteDec);
          cfg.max_limit_sell_price = (currentPriceFloat * (1 + stepRatio * 3)).toFixed(quoteDec);
        } else if (trigger.action === 'LADDER_WIDEN_SPREAD') {
          cfg.bid_level_offsets_bps = cfg.bid_level_offsets_bps.map((b) => Math.round(b * (1 + stepRatio * 2)));
          cfg.ask_level_offsets_bps = cfg.ask_level_offsets_bps.map((a) => Math.round(a * (1 + stepRatio * 2)));
          if (cfg.min_limit_buy_price) cfg.min_limit_buy_price = (parseFloat(cfg.min_limit_buy_price) * (1 - stepRatio)).toFixed(quoteDec);
          if (cfg.max_limit_sell_price) cfg.max_limit_sell_price = (parseFloat(cfg.max_limit_sell_price) * (1 + stepRatio)).toFixed(quoteDec);
        } else if (trigger.action === 'LADDER_SHIFT_UP' || trigger.action === 'LADDER_SHIFT_DOWN') {
          const factor = trigger.action === 'LADDER_SHIFT_UP' ? 1 + stepRatio : Math.max(0.1, 1 - stepRatio);
          if (cfg.min_limit_buy_price) cfg.min_limit_buy_price = (parseFloat(cfg.min_limit_buy_price) * factor).toFixed(quoteDec);
          if (cfg.max_limit_buy_price) cfg.max_limit_buy_price = (parseFloat(cfg.max_limit_buy_price) * factor).toFixed(quoteDec);
          if (cfg.min_limit_sell_price) cfg.min_limit_sell_price = (parseFloat(cfg.min_limit_sell_price) * factor).toFixed(quoteDec);
          if (cfg.max_limit_sell_price) cfg.max_limit_sell_price = (parseFloat(cfg.max_limit_sell_price) * factor).toFixed(quoteDec);
        }
        cfg.last_refresh_timestamp = 0;
        cfg.next_refresh_timestamp = 0;
        addLog(
          bot,
          `${tag} Penyesuaian Depth Ladder (${trigger.action}, step ${trigger.adjustStepPct}%) diterapkan.`,
          'ORDER'
        );
        if (bot.status === 'RUNNING') {
          DepthLiquidityBotExecutor.cancelOpenDepthOrders(bot, addLog, `${tag} ${trigger.action}`);
          DepthLiquidityBotExecutor.executeCycle(bot, addLog);
        }
        adjustedCount++;
        adjustedNames.push(bot.name);
      } else if (bot.botType === 'MOVEMENT_DEPTH_LIQUIDITY' && bot.movementDepthConfig) {
        const cfg = bot.movementDepthConfig;
        if (trigger.action === 'LADDER_RECENTER') {
          MovementDepthLiquidityBotExecutor.resetAnchor(bot, currentPriceFloat.toFixed(quoteDec), addLog);
        } else if (trigger.action === 'LADDER_WIDEN_SPREAD') {
          cfg.spread_bps = Math.min(500, Math.round((cfg.spread_bps || 20) * (1 + stepRatio * 2)));
          cfg.bid_level_offsets_bps = cfg.bid_level_offsets_bps.map((b) => Math.round(b * (1 + stepRatio * 2)));
          cfg.ask_level_offsets_bps = cfg.ask_level_offsets_bps.map((a) => Math.round(a * (1 + stepRatio * 2)));
        } else if (trigger.action === 'LADDER_SHIFT_UP' || trigger.action === 'LADDER_SHIFT_DOWN') {
          const factor = trigger.action === 'LADDER_SHIFT_UP' ? 1 + stepRatio : Math.max(0.1, 1 - stepRatio);
          const nextAnchor = (parseFloat(cfg.anchor_local_price || String(currentPriceFloat)) * factor).toFixed(quoteDec);
          MovementDepthLiquidityBotExecutor.resetAnchor(bot, nextAnchor, addLog);
        }
        cfg.last_refresh_timestamp = 0;
        cfg.next_refresh_timestamp = 0;
        addLog(
          bot,
          `${tag} Penyesuaian Movement Depth (${trigger.action}, step ${trigger.adjustStepPct}%) diterapkan.`,
          'ORDER'
        );
        if (bot.status === 'RUNNING') {
          MovementDepthLiquidityBotExecutor.cancelOpenBotOrders(bot, addLog, `${tag} ${trigger.action}`);
          MovementDepthLiquidityBotExecutor.executeCycle(bot, addLog);
        }
        adjustedCount++;
        adjustedNames.push(bot.name);
      } else if (bot.botType === 'QUANT_HFT_MM' && bot.quantHftConfig) {
        const cfg = bot.quantHftConfig;
        if (trigger.action === 'LADDER_WIDEN_SPREAD') {
          cfg.target_spread_pct = Number((cfg.target_spread_pct * (1 + stepRatio * 2)).toFixed(4));
          cfg.max_spread_pct = Number(Math.max(cfg.target_spread_pct * 2, cfg.max_spread_pct * (1 + stepRatio)).toFixed(4));
        } else if (trigger.action === 'LADDER_SHIFT_UP') {
          cfg.inventory_skew_factor = Math.min(1.0, Number((cfg.inventory_skew_factor + 0.15).toFixed(2)));
        } else if (trigger.action === 'LADDER_SHIFT_DOWN') {
          cfg.inventory_skew_factor = Math.max(-1.0, Number((cfg.inventory_skew_factor - 0.15).toFixed(2)));
        }
        addLog(bot, `${tag} Parameter Quant HFT disesuaikan (${trigger.action}).`, 'ORDER');
        if (bot.status === 'RUNNING') {
          QuantHftBotExecutor.executeCycle(bot, addLog);
        }
        adjustedCount++;
        adjustedNames.push(bot.name);
      } else if (bot.botType === 'ADVANCED_MM' && bot.advancedMMConfig) {
        const cfg = bot.advancedMMConfig;
        if (trigger.action === 'LADDER_WIDEN_SPREAD') {
          cfg.spread_min_bps = Math.min(500, Math.round(cfg.spread_min_bps * (1 + stepRatio * 2)));
          cfg.spread_max_bps = Math.min(1000, Math.round(cfg.spread_max_bps * (1 + stepRatio * 2)));
        } else if (trigger.action === 'LADDER_SHIFT_UP') {
          cfg.price_offset_bps = Math.min(500, Math.round((cfg.price_offset_bps || 0) + trigger.adjustStepPct * 100));
        } else if (trigger.action === 'LADDER_SHIFT_DOWN') {
          cfg.price_offset_bps = Math.max(-500, Math.round((cfg.price_offset_bps || 0) - trigger.adjustStepPct * 100));
        } else if (trigger.action === 'LADDER_RECENTER') {
          cfg.price_offset_bps = 0;
        }
        cfg.lastRepriceTimestamp = 0;
        addLog(bot, `${tag} Parameter Advanced MM disesuaikan (${trigger.action}).`, 'ORDER');
        if (bot.status === 'RUNNING') {
          AdvancedMarketMakerBotExecutor.executeTick(bot, addLog);
        }
        adjustedCount++;
        adjustedNames.push(bot.name);
      }

      bot.updatedAt = Date.now();
      db.botInstances.set(bot.id, bot);
      marketWsService.broadcastBotUpdate(bot);
    }

    if (adjustedCount === 0) {
      return `Bot ditemukan (${bots.length}) tetapi tidak memerlukan perubahan status saat ini.`;
    }
    return `${trigger.action} (${trigger.adjustStepPct}%) dieksekusi pada ${adjustedCount} bot: ${adjustedNames.join(', ')}.`;
  }
}

export const priceThresholdService = new PriceThresholdService();
