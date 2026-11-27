/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/ModularBotOrchestrator.ts
 * Multi-Bot Orchestrator & Server-Side Execution Worker Pool.
 * Pipeline per tick:
 *   Connector.getMarketSnapshot -> Reconcile Open Orders ->
 *   RiskManager.evaluatePositionBarriers (Triple Barrier + Trailing Stop) ->
 *   StrategyController.onMarketData & generateSignal ->
 *   RiskManager.authorizeSignal ->
 *   OrderExecutionEngine.cancelOrders / executeIntents ->
 *   Drawdown / Equity Metrics -> Persist & Broadcast WS
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { marketWsService } from '../../websocket/MarketDataWs.js';
import { dimonexConnector } from './MarketDataConnector.js';
import { strategyRegistry } from './StrategyRegistry.js';
import './strategies/index.js';
import { ConfigValidator, normalizePairId } from './ConfigValidator.js';
import { RiskManager } from './RiskManager.js';
import { OrderExecutionEngine } from './OrderExecutionEngine.js';
import {
  AccountPortfolioRiskSnapshot,
  BotConfigSchemaV1,
  ModularBotRecord,
  NormalizedMarketData,
  StrategyController,
  StrategySignal,
} from './types.js';

function getTodayWib(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export class ModularBotOrchestrator {
  private controllers: Map<string, StrategyController> = new Map();
  private workerTimers: Map<string, NodeJS.Timeout> = new Map();
  private inFlightTicks: Set<string> = new Set();
  private started = false;

  public startRecovery(): void {
    if (this.started) return;
    this.started = true;

    marketWsService.setModularBotsProvider((userId: string) => this.listBotsForUser(userId));

    let recoveredCount = 0;
    for (const bot of db.modularBots.values()) {
      if (bot.status === 'RUNNING') {
        try {
          this.initControllerForBot(bot);
          this.scheduleWorker(bot);
          recoveredCount += 1;
        } catch (err: any) {
          bot.status = 'ERROR';
          bot.errorInfo = `Recovery error: ${err?.message}`;
        }
      }
    }
    if (recoveredCount > 0) {
      console.log(`[MODULAR_STRATEGY_BOT] Berhasil memulihkan ${recoveredCount} bot worker aktif dari disk.`);
    }
  }

  private initControllerForBot(bot: ModularBotRecord): StrategyController {
    const ctrl = strategyRegistry.createController(bot.config.bot.strategyId);
    ctrl.initialize(bot.config);
    this.controllers.set(bot.id, ctrl);
    return ctrl;
  }

  private getController(bot: ModularBotRecord): StrategyController {
    let ctrl = this.controllers.get(bot.id);
    if (!ctrl) {
      ctrl = this.initControllerForBot(bot);
    }
    return ctrl;
  }

  public listBotsForUser(userId: string): ModularBotRecord[] {
    return Array.from(db.modularBots.values())
      .filter(b => b.ownerUserId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getBotForUser(userId: string, botId: string, isAdmin = false): ModularBotRecord {
    const bot = db.modularBots.get(botId);
    if (!bot) throw new Error(`Modular bot ${botId} tidak ditemukan.`);
    if (!isAdmin && bot.ownerUserId !== userId) {
      throw new Error('Anda tidak memiliki akses ke instance bot ini.');
    }
    return bot;
  }

  public getPortfolioRisk(userId: string): AccountPortfolioRiskSnapshot {
    return RiskManager.getAccountPortfolioRisk(userId, db.modularBots.values());
  }

  public createBot(
    userId: string,
    rawConfig: BotConfigSchemaV1,
    options?: { startImmediately?: boolean; confirmLiveDeployment?: boolean }
  ): ModularBotRecord {
    const pairId = normalizePairId(rawConfig?.bot?.tradingPair || '');
    const constraints = dimonexConnector.getMarketConstraints(pairId);
    const validation = ConfigValidator.validate(rawConfig, constraints);
    if (!validation.valid || !constraints) {
      throw new Error(`Validasi konfigurasi gagal: ${validation.errors.join(' | ')}`);
    }

    const mode = rawConfig.bot.mode;
    if (mode === 'BACKTEST') {
      throw new Error('Gunakan endpoint /api/modular-bots/backtest untuk menjalankan mode BACKTEST.');
    }

    // Strict guard: LIVE bots require explicit user confirmation
    if (mode === 'LIVE' && options?.startImmediately && !options?.confirmLiveDeployment) {
      throw new Error(
        'Deployment mode LIVE memerlukan konfirmasi eksplisit (confirmLiveDeployment: true) untuk mencegah risiko eksekusi tidak disengaja.'
      );
    }

    const activeUserBots = this.listBotsForUser(userId).filter(b => b.status === 'RUNNING').length;
    if (options?.startImmediately && activeUserBots >= (db.riskControls.maxActiveBots || 50)) {
      throw new Error(`Batas maksimum bot aktif (${db.riskControls.maxActiveBots}) tercapai.`);
    }

    const botId = `mbot-${crypto.randomUUID()}`;
    const now = Date.now();
    const clonedConfig: BotConfigSchemaV1 = JSON.parse(JSON.stringify(rawConfig));
    clonedConfig.bot.tradingPair = pairId;

    const initPaperQuote = clonedConfig.paperConfig?.initialQuoteBalance || (constraints.quoteCurrency === 'IDR' ? '25000000' : '5000');
    const initPaperBase = clonedConfig.paperConfig?.initialBaseBalance || '0';

    const bot: ModularBotRecord = {
      id: botId,
      botType: 'MODULAR_STRATEGY_BOT',
      ownerUserId: userId,
      accountId: `spot-${userId}`,
      pairId,
      status: 'READY',
      config: clonedConfig,
      livePromotionConfirmed: mode === 'LIVE' ? Boolean(options?.confirmLiveDeployment) : false,
      livePromotionConfirmedAt: mode === 'LIVE' && options?.confirmLiveDeployment ? now : undefined,
      position: {
        botId,
        pairId,
        side: 'FLAT',
        baseQtyUnits: '0',
        quoteCostBasisUnits: '0',
        avgEntryPriceUnits: '0',
        openedAt: null,
        highWaterMarkPriceUnits: '0',
        breakEvenArmed: false,
        trailingStopActive: false,
        activeStopLossPriceUnits: null,
        activeTakeProfitPriceUnits: null,
        unrealizedPnlQuoteUnits: '0',
        realizedPnlQuoteUnits: '0',
      },
      paperWallet:
        mode === 'PAPER'
          ? {
              baseCurrency: constraints.baseCurrency,
              quoteCurrency: constraints.quoteCurrency,
              baseAvailableUnits: PrecisionMath.parseToUnits(initPaperBase, constraints.baseDecimals).toString(),
              baseLockedUnits: '0',
              quoteAvailableUnits: PrecisionMath.parseToUnits(initPaperQuote, constraints.quoteDecimals).toString(),
              quoteLockedUnits: '0',
            }
          : undefined,
      openOrders: [],
      executions: [],
      recentSignals: [],
      logs: [
        {
          timestamp: now,
          type: 'INFO',
          message: `Bot ${clonedConfig.bot.name} (${clonedConfig.bot.strategyId}) dibuat pada mode ${mode} untuk ${pairId}.`,
        },
      ],
      metrics: {
        ordersSubmitted: 0,
        ordersCancelled: 0,
        ordersFilled: 0,
        totalTrades: 0,
        totalVolumeBaseUnits: '0',
        totalVolumeQuoteUnits: '0',
        totalFeesQuoteUnits: '0',
        realizedPnlQuoteUnits: '0',
        unrealizedPnlQuoteUnits: '0',
        peakEquityQuoteUnits: '0',
        maxDrawdownPct: 0,
        dailyLossQuoteUnits: '0',
        dailyLossDateWib: getTodayWib(),
        lastRegime: 'NORMAL',
        lastReferencePrice: 0,
      },
      consecutiveErrors: 0,
      orderTimestampsInWindow: [],
      createdAt: now,
      updatedAt: now,
    };

    db.modularBots.set(bot.id, bot);
    this.initControllerForBot(bot);
    db.scheduleSave();
    marketWsService.broadcastModularBotUpdate(bot);

    if (options?.startImmediately) {
      return this.startBot(userId, bot.id);
    }
    return bot;
  }

  public updateBotConfig(userId: string, botId: string, rawConfig: BotConfigSchemaV1): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    if (bot.status === 'RUNNING') {
      throw new Error('Hentikan atau jeda bot terlebih dahulu sebelum mengubah konfigurasi.');
    }

    const pairId = normalizePairId(rawConfig?.bot?.tradingPair || bot.pairId);
    const constraints = dimonexConnector.getMarketConstraints(pairId);
    const validation = ConfigValidator.validate(rawConfig, constraints);
    if (!validation.valid || !constraints) {
      throw new Error(`Validasi konfigurasi gagal: ${validation.errors.join(' | ')}`);
    }

    if (bot.config.bot.mode !== rawConfig.bot.mode) {
      throw new Error('Gunakan endpoint promote-live untuk memindahkan bot PAPER ke LIVE.');
    }

    bot.config = JSON.parse(JSON.stringify(rawConfig));
    bot.config.bot.tradingPair = pairId;
    bot.pairId = pairId;
    bot.updatedAt = Date.now();
    bot.logs.push({
      timestamp: bot.updatedAt,
      type: 'INFO',
      message: 'Konfigurasi bot diperbarui dan divalidasi ulang.',
    });

    this.initControllerForBot(bot);
    db.scheduleSave();
    marketWsService.broadcastModularBotUpdate(bot);
    return bot;
  }

  public promotePaperToLive(
    userId: string,
    botId: string,
    confirmLiveDeployment: boolean,
    acknowledgeRisk: boolean
  ): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    if (!confirmLiveDeployment || !acknowledgeRisk) {
      throw new Error(
        'Promosi PAPER -> LIVE membutuhkan confirmLiveDeployment=true dan acknowledgeRisk=true.'
      );
    }
    if (bot.status === 'RUNNING') {
      throw new Error('Hentikan bot Paper terlebih dahulu sebelum mempromosikan ke LIVE.');
    }
    if (bot.config.bot.mode === 'LIVE' && bot.livePromotionConfirmed) {
      return bot;
    }

    // Safely clear any Paper open orders and reset simulated paper position before live binding
    OrderExecutionEngine.cancelAllBotOrders(bot, Date.now(), 'Promoted to LIVE');
    bot.config.bot.mode = 'LIVE';
    bot.paperWallet = undefined;
    bot.livePromotionConfirmed = true;
    bot.livePromotionConfirmedAt = Date.now();
    bot.status = 'READY';
    bot.position = {
      botId: bot.id,
      pairId: bot.pairId,
      side: 'FLAT',
      baseQtyUnits: '0',
      quoteCostBasisUnits: '0',
      avgEntryPriceUnits: '0',
      openedAt: null,
      highWaterMarkPriceUnits: '0',
      breakEvenArmed: false,
      trailingStopActive: false,
      activeStopLossPriceUnits: null,
      activeTakeProfitPriceUnits: null,
      unrealizedPnlQuoteUnits: '0',
      realizedPnlQuoteUnits: '0',
    };
    bot.openOrders = [];
    bot.executions = [];
    bot.recentSignals = [];
    bot.metrics.realizedPnlQuoteUnits = '0';
    bot.metrics.unrealizedPnlQuoteUnits = '0';
    bot.metrics.dailyLossQuoteUnits = '0';
    bot.metrics.maxDrawdownPct = 0;
    bot.updatedAt = Date.now();
    bot.logs.push({
      timestamp: bot.updatedAt,
      type: 'INFO',
      message: 'Bot dipromosikan dari PAPER ke LIVE dengan konfirmasi pengguna eksplisit.',
    });

    this.initControllerForBot(bot);
    db.scheduleSave();
    marketWsService.broadcastModularBotUpdate(bot);
    return bot;
  }

  public startBot(userId: string, botId: string): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    if (bot.status === 'RUNNING') return bot;

    if (bot.config.bot.mode === 'LIVE' && !bot.livePromotionConfirmed) {
      throw new Error(
        'Bot LIVE harus melalui konfirmasi eksplisit terlebih dahulu sebelum dapat dijalankan.'
      );
    }

    if (bot.config.bot.mode === 'LIVE' && db.riskControls.isKillSwitchActive) {
      throw new Error('Tidak dapat menjalankan bot LIVE saat Global Kill-Switch aktif.');
    }

    const constraints = dimonexConnector.getMarketConstraints(bot.pairId);
    if (!constraints || !constraints.isActive || constraints.isHalted) {
      throw new Error(`Market ${bot.pairId} tidak aktif atau sedang di-halt.`);
    }

    bot.config.risk.limits.emergencyStop = false;
    bot.status = 'RUNNING';
    bot.consecutiveErrors = 0;
    bot.errorInfo = undefined;
    bot.updatedAt = Date.now();
    bot.logs.push({
      timestamp: bot.updatedAt,
      type: 'INFO',
      message: `Bot diaktifkan pada mode ${bot.config.bot.mode}.`,
    });

    this.initControllerForBot(bot);
    this.scheduleWorker(bot);
    // Execute immediate initial tick synchronously-safe
    void this.executeTick(bot.id);

    db.scheduleSave();
    marketWsService.broadcastModularBotUpdate(bot);
    return bot;
  }

  public pauseBot(userId: string, botId: string): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    this.clearWorker(bot.id);
    if (bot.status === 'RUNNING') {
      bot.status = 'PAUSED';
      bot.updatedAt = Date.now();
      bot.logs.push({
        timestamp: bot.updatedAt,
        type: 'INFO',
        message: 'Bot dijeda; order aktif tetap terpantau hingga dihentikan/dibatalkan.',
      });
      db.scheduleSave();
      marketWsService.broadcastModularBotUpdate(bot);
    }
    return bot;
  }

  public resumeBot(userId: string, botId: string): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    if (bot.status !== 'PAUSED' && bot.status !== 'STOPPED' && bot.status !== 'READY') {
      throw new Error(`Bot dalam status ${bot.status} tidak dapat dilanjutkan langsung.`);
    }
    return this.startBot(userId, bot.id);
  }

  public stopBot(userId: string, botId: string, reason = 'Dihentikan oleh pengguna'): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    this.clearWorker(bot.id);
    const now = Date.now();
    const cancelled = OrderExecutionEngine.cancelAllBotOrders(bot, now, reason);
    bot.status = 'STOPPED';
    bot.updatedAt = now;
    bot.logs.push({
      timestamp: now,
      type: 'INFO',
      message: `Bot dihentikan (${reason}). ${cancelled.length} order milik bot dibatalkan dengan aman.`,
    });
    db.scheduleSave();
    marketWsService.broadcastModularBotUpdate(bot);
    return bot;
  }

  public emergencyStopBot(userId: string, botId: string): ModularBotRecord {
    const bot = this.getBotForUser(userId, botId);
    this.clearWorker(bot.id);
    const now = Date.now();
    bot.config.risk.limits.emergencyStop = true;
    const cancelled = OrderExecutionEngine.cancelAllBotOrders(bot, now, 'EMERGENCY_STOP');

    // Attempt safe liquidation of any open spot position if market liquid
    const heldBase = BigInt(bot.position.baseQtyUnits || '0');
    if (heldBase > 0n) {
      try {
        const mkt = dimonexConnector.getMarketSnapshot(
          bot.pairId,
          bot.config.market.timeframe,
          bot.config.market.priceReference
        );
        if (!mkt.isStale && heldBase >= BigInt(mkt.constraints.minOrderSizeUnits)) {
          OrderExecutionEngine.executeIntents(
            bot,
            [
              {
                side: 'SELL',
                priceUnits: mkt.orderBook.bestBidUnits || mkt.referencePriceUnits,
                quantityUnits: heldBase.toString(),
                postOnly: false,
                clientTag: 'emergency-liq',
                isBarrierExit: true,
              },
            ],
            mkt,
            now
          );
        }
      } catch (err: any) {
        bot.logs.push({
          timestamp: now,
          type: 'ERROR',
          message: `Likuidasi darurat tertunda: ${err?.message}`,
        });
      }
    }

    bot.status = 'RISK_HALTED';
    bot.updatedAt = now;
    bot.logs.push({
      timestamp: now,
      type: 'RISK',
      message: `EMERGENCY STOP dieksekusi. ${cancelled.length} order aktif dibatalkan.`,
    });

    db.scheduleSave();
    marketWsService.broadcastModularBotUpdate(bot);
    return bot;
  }

  public deleteBot(userId: string, botId: string): void {
    const bot = this.getBotForUser(userId, botId);
    this.clearWorker(bot.id);
    OrderExecutionEngine.cancelAllBotOrders(bot, Date.now(), 'Bot Deleted');
    this.controllers.delete(bot.id);
    db.modularBots.delete(bot.id);
    db.scheduleSave();
  }

  private clearWorker(botId: string): void {
    const t = this.workerTimers.get(botId);
    if (t) {
      clearInterval(t);
      this.workerTimers.delete(botId);
    }
  }

  private scheduleWorker(bot: ModularBotRecord): void {
    this.clearWorker(bot.id);
    const intervalMs = Math.max(1500, Math.min(60_000, bot.config.execution.tickIntervalMs || 3000));
    const timer = setInterval(() => {
      void this.executeTick(bot.id);
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.workerTimers.set(bot.id, timer);
  }

  /**
   * Executes one deterministic cycle for a RUNNING bot instance.
   */
  public async executeTick(botId: string): Promise<void> {
    const bot = db.modularBots.get(botId);
    if (!bot || bot.status !== 'RUNNING') {
      this.clearWorker(botId);
      return;
    }
    if (this.inFlightTicks.has(botId)) return;
    this.inFlightTicks.add(botId);

    const now = Date.now();
    try {
      const marketData: NormalizedMarketData = dimonexConnector.getMarketSnapshot(
        bot.pairId,
        bot.config.market.timeframe,
        bot.config.market.priceReference,
        220,
        bot.config.market.maxDataAgeMs ?? 60_000
      );

      bot.lastTickAt = now;
      bot.metrics.lastRegime = marketData.volatility.regime;
      bot.metrics.lastReferencePrice = marketData.referencePrice;

      // 1. Reconcile fills, partial fills, and timeouts
      const reconciled = OrderExecutionEngine.reconcileOpenOrders(bot, marketData, now);
      const ctrl = this.getController(bot);
      for (const rec of reconciled) {
        ctrl.onExecutionUpdate(rec);
        ctrl.onPositionUpdate(bot.position);
        marketWsService.broadcastModularExecution(bot.ownerUserId, rec);
      }

      // 2. Evaluate Triple Barrier & Trailing Stop before strategy signal
      const barrier = RiskManager.evaluatePositionBarriers(bot, marketData, now);
      let activeSignal: StrategySignal;

      if (barrier.triggerExit) {
        activeSignal = {
          signalId: crypto.randomUUID(),
          strategyId: bot.config.bot.strategyId,
          botInstanceId: bot.id,
          tradingPair: bot.pairId,
          signalTimestamp: now,
          signalExpiration: now + 30_000,
          category: bot.config.bot.category,
          signalType: 'EXIT',
          confidenceScore: 100,
          indicatorValues: {},
          referenceMarketPriceUnits: marketData.referencePriceUnits,
          referenceMarketPrice: marketData.referencePrice,
          strategyExplanation: barrier.reason || 'Triple Barrier / Trailing Stop Exit',
          riskMetadata: {
            regime: marketData.volatility.regime,
            volatilityAtrPct: marketData.volatility.atrPct,
            isEligibleForTripleBarrier: false,
          },
        };
        bot.logs.push({ timestamp: now, type: 'RISK', message: activeSignal.strategyExplanation });
      } else {
        // 3. Feed normalized data into StrategyController & generate standardized signal
        ctrl.onMarketData(marketData);
        const { baseAvailableUnits, quoteAvailableUnits } = RiskManager.getSpendableBalances(
          bot,
          marketData.constraints.baseCurrency,
          marketData.constraints.quoteCurrency
        );
        activeSignal = ctrl.generateSignal({
          botId: bot.id,
          mode: bot.config.bot.mode,
          config: bot.config,
          marketData,
          position: bot.position,
          openOrders: bot.openOrders,
          availableBaseUnits: baseAvailableUnits.toString(),
          availableQuoteUnits: quoteAvailableUnits.toString(),
          now,
        });
      }

      bot.recentSignals.unshift(activeSignal);
      if (bot.recentSignals.length > 40) bot.recentSignals.length = 40;
      if (activeSignal.signalType !== 'HOLD' && activeSignal.signalType !== 'NEUTRAL') {
        marketWsService.broadcastModularSignal(bot.ownerUserId, activeSignal);
      }

      // 4. Route signal through RiskManager
      const auth = RiskManager.authorizeSignal(bot, activeSignal, marketData, db.modularBots.values(), now);

      if (auth.haltBot) {
        OrderExecutionEngine.cancelOrders(bot, auth.cancelOrderIds, now, auth.reason || 'Risk Halt');
        this.clearWorker(bot.id);
        bot.status = 'RISK_HALTED';
        bot.errorInfo = auth.reason;
        bot.logs.push({ timestamp: now, type: 'RISK', message: `BOT HALTED: ${auth.reason}` });
        db.scheduleSave();
        marketWsService.broadcastModularBotUpdate(bot);
        return;
      }

      if (auth.cancelOrderIds.length > 0) {
        OrderExecutionEngine.cancelOrders(bot, auth.cancelOrderIds, now, 'Stale/Signal Replacement');
      }

      if (!auth.approved && activeSignal.signalType !== 'HOLD' && activeSignal.signalType !== 'NEUTRAL') {
        bot.logs.push({
          timestamp: now,
          type: 'RISK',
          message: `Sinyal ${activeSignal.signalType} ditahan RiskManager: ${auth.reason}`,
        });
      } else if (auth.approved && auth.intents.length > 0) {
        const batch = OrderExecutionEngine.executeIntents(bot, auth.intents, marketData, now);
        for (const exec of batch.executions) {
          ctrl.onExecutionUpdate(exec);
          ctrl.onPositionUpdate(bot.position);
          marketWsService.broadcastModularExecution(bot.ownerUserId, exec);
        }
      }

      // 5. Update Unrealized PnL & Max Drawdown metrics
      this.updateEquityAndDrawdownMetrics(bot, marketData);

      bot.consecutiveErrors = 0;
      bot.updatedAt = now;
      if (bot.logs.length > 200) {
        bot.logs.splice(0, bot.logs.length - 200);
      }
      db.scheduleSave();
      marketWsService.broadcastModularBotUpdate(bot);
    } catch (err: any) {
      bot.consecutiveErrors += 1;
      bot.errorInfo = err?.message || 'Tick execution error';
      bot.logs.push({
        timestamp: now,
        type: 'ERROR',
        message: `Error tick (${bot.consecutiveErrors}): ${bot.errorInfo}`,
      });
      if (bot.consecutiveErrors >= (db.riskControls.maxConsecutiveErrors || 10)) {
        OrderExecutionEngine.cancelAllBotOrders(bot, now, 'Max Consecutive Errors');
        this.clearWorker(bot.id);
        bot.status = 'ERROR';
      }
      db.scheduleSave();
      marketWsService.broadcastModularBotUpdate(bot);
    } finally {
      this.inFlightTicks.delete(botId);
    }
  }

  private updateEquityAndDrawdownMetrics(bot: ModularBotRecord, marketData: NormalizedMarketData): void {
    const heldBase = BigInt(bot.position.baseQtyUnits || '0');
    const refUnits = BigInt(marketData.referencePriceUnits || '0');
    if (heldBase > 0n && refUnits > 0n) {
      const currVal = PrecisionMath.calculateQuoteAmount(
        heldBase,
        marketData.constraints.baseDecimals,
        refUnits
      );
      const costBasis = BigInt(bot.position.quoteCostBasisUnits || '0');
      bot.position.unrealizedPnlQuoteUnits = (currVal - costBasis).toString();
    } else {
      bot.position.unrealizedPnlQuoteUnits = '0';
    }
    bot.metrics.unrealizedPnlQuoteUnits = bot.position.unrealizedPnlQuoteUnits;

    // Drawdown tracked relative to peak cumulative PnL + initial baseline
    const realized = BigInt(bot.metrics.realizedPnlQuoteUnits || '0');
    const unrealized = BigInt(bot.metrics.unrealizedPnlQuoteUnits || '0');
    const maxNotional = PrecisionMath.parseToUnits(
      bot.config.risk.limits.maxNotional,
      marketData.constraints.quoteDecimals
    );
    const baseline =
      bot.config.bot.mode === 'PAPER' && bot.paperWallet
        ? PrecisionMath.parseToUnits(
            bot.config.paperConfig?.initialQuoteBalance || '10000000',
            marketData.constraints.quoteDecimals
          )
        : maxNotional;
    const totalEq = baseline + realized + unrealized;
    const prevPeak = BigInt(bot.metrics.peakEquityQuoteUnits || '0');
    const effectivePeak = totalEq > prevPeak ? totalEq : prevPeak > 0n ? prevPeak : baseline;
    bot.metrics.peakEquityQuoteUnits = effectivePeak.toString();

    if (effectivePeak > 0n && totalEq < effectivePeak) {
      const ddBps = Number(((effectivePeak - totalEq) * 10000n) / effectivePeak);
      const ddPct = Number((ddBps / 100).toFixed(2));
      if (ddPct > bot.metrics.maxDrawdownPct) {
        bot.metrics.maxDrawdownPct = ddPct;
      }
    }
  }
}

export const modularBotOrchestrator = new ModularBotOrchestrator();
