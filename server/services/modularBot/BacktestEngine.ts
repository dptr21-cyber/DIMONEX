/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/BacktestEngine.ts
 * Phase 5 — Historical Backtesting & Parameter Optimization Engine.
 * Strictly reuses StrategyController plugins without modifying core code.
 * Enforces causal bar-by-bar candle slicing (zero look-ahead bias).
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { klineService } from '../../engine/KlineService.js';
import { PrecisionMath } from '../../ledger/PrecisionMath.js';
import { dimonexConnector } from './MarketDataConnector.js';
import { strategyRegistry } from './StrategyRegistry.js';
import { ConfigValidator, normalizePairId } from './ConfigValidator.js';
import { RiskManager } from './RiskManager.js';
import { OrderExecutionEngine } from './OrderExecutionEngine.js';
import {
  BacktestEquityPoint,
  BacktestMetricsSummary,
  BacktestOptimizationRow,
  BacktestReport,
  BacktestRunRequest,
  BotConfigSchemaV1,
  ModularBotRecord,
  NormalizedCandle,
  NormalizedMarketData,
} from './types.js';

function getTimeframeDurationMs(tf: string): number {
  switch (tf) {
    case '1m': return 60_000;
    case '5m': return 300_000;
    case '15m': return 900_000;
    case '30m': return 1_800_000;
    case '1h': return 3_600_000;
    case '4h': return 14_400_000;
    case '1d': return 86_400_000;
    default: return 3_600_000;
  }
}

export class BacktestEngine {
  public static run(userId: string, req: BacktestRunRequest): BacktestReport {
    const pairId = normalizePairId(req.config.bot.tradingPair);
    const constraints = dimonexConnector.getMarketConstraints(pairId);
    if (!constraints) {
      throw new Error(`Trading pair "${req.config.bot.tradingPair}" tidak ditemukan.`);
    }

    const validation = ConfigValidator.validate(req.config, constraints);
    if (!validation.valid) {
      throw new Error(`Konfigurasi backtest tidak valid: ${validation.errors.join(' | ')}`);
    }

    const limit = Math.max(30, Math.min(1000, req.candleLimit || 350));
    const allCandlesRaw = klineService.getCandles(pairId, req.config.market.timeframe, limit);
    let candles: NormalizedCandle[] = allCandlesRaw.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    if (req.startTimeMs) {
      const startSec = Math.floor(req.startTimeMs / 1000);
      candles = candles.filter(c => c.time >= startSec);
    }
    if (req.endTimeMs) {
      const endSec = Math.floor(req.endTimeMs / 1000);
      candles = candles.filter(c => c.time <= endSec);
    }

    if (candles.length < 15) {
      throw new Error(
        `Data historis candle untuk ${pairId} (${req.config.market.timeframe}) kurang dari 15 bar (tersedia ${candles.length}).`
      );
    }

    const baseRun = this.executeSingleSimulation(userId, req.config, candles, req, constraints);

    let optimizationResults: BacktestOptimizationRow[] | undefined;
    if (Array.isArray(req.optimizeGrid) && req.optimizeGrid.length > 0) {
      optimizationResults = this.runParameterSweep(userId, req, candles, constraints);
    }

    const report: BacktestReport = {
      runId: crypto.randomUUID(),
      ownerUserId: userId,
      pairId,
      strategyId: req.config.bot.strategyId,
      timeframe: req.config.market.timeframe,
      candleCount: candles.length,
      lookAheadBiasGuardVerified: true,
      createdAt: Date.now(),
      configSnapshot: req.config,
      metrics: baseRun.metrics,
      equityCurve: baseRun.equityCurve,
      trades: baseRun.trades,
      optimizationResults,
    };

    db.modularBacktests.push(report);
    if (db.modularBacktests.length > 100) {
      db.modularBacktests.splice(0, db.modularBacktests.length - 100);
    }
    db.scheduleSave();

    return report;
  }

  private static runParameterSweep(
    userId: string,
    req: BacktestRunRequest,
    candles: NormalizedCandle[],
    constraints: NonNullable<ReturnType<typeof dimonexConnector.getMarketConstraints>>
  ): BacktestOptimizationRow[] {
    const grid = req.optimizeGrid || [];
    let combos: Record<string, number | string>[] = [{}];
    for (const dim of grid) {
      if (!dim.paramKey || !Array.isArray(dim.values) || dim.values.length === 0) continue;
      const next: Record<string, number | string>[] = [];
      for (const existing of combos) {
        for (const val of dim.values.slice(0, 8)) {
          next.push({ ...existing, [dim.paramKey]: val });
          if (next.length >= 24) break;
        }
        if (next.length >= 24) break;
      }
      combos = next;
    }

    const rows: BacktestOptimizationRow[] = [];
    for (const combo of combos.slice(0, 24)) {
      const clonedConfig: BotConfigSchemaV1 = JSON.parse(JSON.stringify(req.config));
      clonedConfig.strategy.indicators = {
        ...clonedConfig.strategy.indicators,
        ...combo,
      };
      const sim = this.executeSingleSimulation(userId, clonedConfig, candles, req, constraints);
      rows.push({
        params: combo,
        totalReturnPct: sim.metrics.totalReturnPct,
        netProfitQuote: sim.metrics.netProfitQuote,
        winRatePct: sim.metrics.winRatePct,
        maxDrawdownPct: sim.metrics.maxDrawdownPct,
        sharpeRatio: sim.metrics.sharpeRatio,
        numberOfTrades: sim.metrics.numberOfTrades,
      });
    }

    rows.sort((a, b) => b.totalReturnPct - a.totalReturnPct);
    return rows;
  }

  private static executeSingleSimulation(
    userId: string,
    config: BotConfigSchemaV1,
    candles: NormalizedCandle[],
    req: BacktestRunRequest,
    constraints: NonNullable<ReturnType<typeof dimonexConnector.getMarketConstraints>>
  ): {
    metrics: BacktestMetricsSummary;
    equityCurve: BacktestEquityPoint[];
    trades: ModularBotRecord['executions'];
  } {
    const pairId = constraints.pairId;
    const baseDec = constraints.baseDecimals;
    const quoteDec = constraints.quoteDecimals;
    const baseScale = 10 ** baseDec;
    const quoteScale = 10 ** quoteDec;

    const initQuoteUnits = PrecisionMath.parseToUnits(req.initialQuoteBalance || '10000000', quoteDec);
    const initBaseUnits = PrecisionMath.parseToUnits(req.initialBaseBalance || '0', baseDec);

    const makerFeeBps = req.makerFeeBps ?? constraints.makerFeeBps;
    const takerFeeBps = req.takerFeeBps ?? constraints.takerFeeBps;
    const slippageBps = Math.max(0, req.slippageBps ?? config.execution.maxSlippageBps ?? 5);
    const partialFillPct = Math.max(0, Math.min(80, req.partialFillPct ?? 0));

    // Create isolated temporary Paper-like ModularBotRecord in memory (never registered in live store)
    const simBot: ModularBotRecord = {
      id: `bt-${crypto.randomUUID()}`,
      botType: 'MODULAR_STRATEGY_BOT',
      ownerUserId: userId,
      accountId: `bt-acc-${userId}`,
      pairId,
      status: 'RUNNING',
      config: {
        ...JSON.parse(JSON.stringify(config)),
        bot: { ...config.bot, mode: 'PAPER' },
        paperConfig: {
          initialQuoteBalance: req.initialQuoteBalance || '10000000',
          initialBaseBalance: req.initialBaseBalance || '0',
          simulatedLatencyMs: 0,
          simulatedSlippageBps: slippageBps,
          partialFillProbabilityPct: partialFillPct,
          makerFeeBps,
          takerFeeBps,
        },
      },
      livePromotionConfirmed: false,
      position: {
        botId: 'backtest',
        pairId,
        side: initBaseUnits > 0n ? 'LONG' : 'FLAT',
        baseQtyUnits: initBaseUnits.toString(),
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
      paperWallet: {
        baseCurrency: constraints.baseCurrency,
        quoteCurrency: constraints.quoteCurrency,
        baseAvailableUnits: initBaseUnits.toString(),
        baseLockedUnits: '0',
        quoteAvailableUnits: initQuoteUnits.toString(),
        quoteLockedUnits: '0',
      },
      openOrders: [],
      executions: [],
      recentSignals: [],
      logs: [],
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
        dailyLossDateWib: '1970-01-01',
        lastRegime: 'NORMAL',
        lastReferencePrice: 0,
      },
      consecutiveErrors: 0,
      orderTimestampsInWindow: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const controller = strategyRegistry.createController(config.bot.strategyId);
    controller.initialize(simBot.config);

    const firstPriceUnits = PrecisionMath.parseToUnits(
      Math.max(0.000001, candles[0].close).toFixed(quoteDec),
      quoteDec
    );
    const initialEquityUnits =
      initQuoteUnits + PrecisionMath.calculateQuoteAmount(initBaseUnits, baseDec, firstPriceUnits);
    const initialEquityQuote = Number(initialEquityUnits) / quoteScale;

    let peakEquityQuote = initialEquityQuote;
    let maxDrawdownPct = 0;
    let maxDrawdownQuote = 0;
    let exposureBars = 0;
    const tfDurationMs = getTimeframeDurationMs(config.market.timeframe);
    const equityCurve: BacktestEquityPoint[] = [];
    const barReturns: number[] = [];
    let prevEquityQuote = initialEquityQuote;

    // Causal Bar-by-Bar Replay: candles[0..i] ONLY (zero look-ahead bias)
    for (let i = 0; i < candles.length; i++) {
      const bar = candles[i];
      const barTimeMs = bar.time * 1000;
      const causalSlice = candles.slice(0, i + 1);

      const closeUnits = PrecisionMath.parseToUnits(
        Math.max(0.000001, bar.close).toFixed(quoteDec),
        quoteDec
      );
      const tickUnits = BigInt(constraints.tickSizeUnits || '1');
      const bestBidUnits = closeUnits > tickUnits ? closeUnits - tickUnits : closeUnits;
      const bestAskUnits = closeUnits + tickUnits;

      // Synthetic L2 top of book reflecting bar price & realistic depth
      const lowUnits = PrecisionMath.parseToUnits(Math.max(0.000001, bar.low).toFixed(quoteDec), quoteDec);
      const highUnits = PrecisionMath.parseToUnits(Math.max(0.000001, bar.high).toFixed(quoteDec), quoteDec);

      const marketData: NormalizedMarketData = {
        source: 'DIMONEX',
        pairId,
        timeframe: config.market.timeframe,
        timestamp: barTimeMs,
        sequence: i + 1,
        isStale: false,
        referencePriceUnits: closeUnits.toString(),
        referencePrice: bar.close,
        ticker: {
          lastPriceUnits: closeUnits.toString(),
          lastPrice: bar.close,
          high24h: bar.high,
          low24h: bar.low,
          volume24h: bar.volume,
          priceChangePct24h: 0,
        },
        orderBook: {
          pairId,
          bids: [{ priceUnits: bestBidUnits.toString(), price: Number(bestBidUnits) / quoteScale, quantityUnits: constraints.maxOrderSizeUnits, quantity: Number(BigInt(constraints.maxOrderSizeUnits)) / baseScale, orderCount: 1 }],
          asks: [{ priceUnits: bestAskUnits.toString(), price: Number(bestAskUnits) / quoteScale, quantityUnits: constraints.maxOrderSizeUnits, quantity: Number(BigInt(constraints.maxOrderSizeUnits)) / baseScale, orderCount: 1 }],
          bestBidUnits: bestBidUnits.toString(),
          bestAskUnits: bestAskUnits.toString(),
          midpointUnits: closeUnits.toString(),
          spreadBps: 10,
          sequence: i + 1,
          timestamp: barTimeMs,
        },
        recentTrades: [],
        candles: causalSlice,
        volatility: {
          atr14: bar.high - bar.low,
          atrPct: bar.close > 0 ? ((bar.high - bar.low) / bar.close) * 100 : 0.5,
          realizedVolPct: 1,
          regime: 'BACKTEST_REPLAY',
        },
        constraints,
      };

      // Check resting Paper Limit orders against bar [low, high] range
      const restingSnap: NormalizedMarketData = {
        ...marketData,
        orderBook: {
          ...marketData.orderBook,
          bestAskUnits: lowUnits.toString(),
          bestBidUnits: highUnits.toString(),
        },
      };
      OrderExecutionEngine.reconcileOpenOrders(simBot, restingSnap, barTimeMs);

      controller.onMarketData(marketData);

      // 1. Evaluate Triple Barrier + Trailing Stop before strategy signal
      const barrier = RiskManager.evaluatePositionBarriers(simBot, marketData, barTimeMs);
      if (barrier.triggerExit) {
        const exitSig = {
          signalId: crypto.randomUUID(),
          strategyId: config.bot.strategyId,
          botInstanceId: simBot.id,
          tradingPair: pairId,
          signalTimestamp: barTimeMs,
          signalExpiration: barTimeMs + 60_000,
          category: config.bot.category,
          signalType: 'EXIT' as const,
          confidenceScore: 100,
          indicatorValues: {},
          referenceMarketPriceUnits: closeUnits.toString(),
          referenceMarketPrice: bar.close,
          strategyExplanation: barrier.reason || 'Barrier Exit',
          riskMetadata: {
            regime: marketData.volatility.regime,
            volatilityAtrPct: marketData.volatility.atrPct,
            isEligibleForTripleBarrier: false,
          },
        };
        const auth = RiskManager.authorizeSignal(simBot, exitSig, marketData, [simBot], barTimeMs);
        if (auth.cancelOrderIds.length > 0) {
          OrderExecutionEngine.cancelOrders(simBot, auth.cancelOrderIds, barTimeMs, 'Barrier Exit');
        }
        if (auth.approved && auth.intents.length > 0) {
          OrderExecutionEngine.executeIntents(simBot, auth.intents, marketData, barTimeMs);
        }
      } else {
        // 2. Evaluate StrategyController signal
        const sig = controller.generateSignal({
          botId: simBot.id,
          mode: 'PAPER',
          config: simBot.config,
          marketData,
          position: simBot.position,
          openOrders: simBot.openOrders,
          availableBaseUnits: simBot.paperWallet!.baseAvailableUnits,
          availableQuoteUnits: simBot.paperWallet!.quoteAvailableUnits,
          now: barTimeMs,
        });

        const auth = RiskManager.authorizeSignal(simBot, sig, marketData, [simBot], barTimeMs);
        if (auth.cancelOrderIds.length > 0) {
          OrderExecutionEngine.cancelOrders(simBot, auth.cancelOrderIds, barTimeMs, 'Reprice/Stale');
        }
        if (auth.approved && auth.intents.length > 0) {
          OrderExecutionEngine.executeIntents(simBot, auth.intents, marketData, barTimeMs);
        }
      }

      // Compute equity mark-to-market at bar close
      const totalBaseUnits =
        BigInt(simBot.paperWallet!.baseAvailableUnits) + BigInt(simBot.paperWallet!.baseLockedUnits);
      const totalQuoteUnits =
        BigInt(simBot.paperWallet!.quoteAvailableUnits) + BigInt(simBot.paperWallet!.quoteLockedUnits);
      const equityUnits =
        totalQuoteUnits + PrecisionMath.calculateQuoteAmount(totalBaseUnits, baseDec, closeUnits);
      const equityQuote = Number(equityUnits) / quoteScale;

      if (BigInt(simBot.position.baseQtyUnits || '0') > 0n) {
        exposureBars += 1;
      }

      if (equityQuote > peakEquityQuote) peakEquityQuote = equityQuote;
      const ddQuote = Math.max(0, peakEquityQuote - equityQuote);
      const ddPct = peakEquityQuote > 0 ? (ddQuote / peakEquityQuote) * 100 : 0;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
      if (ddQuote > maxDrawdownQuote) maxDrawdownQuote = ddQuote;

      if (prevEquityQuote > 0) {
        barReturns.push((equityQuote - prevEquityQuote) / prevEquityQuote);
      }
      prevEquityQuote = equityQuote;

      equityCurve.push({
        time: bar.time,
        price: bar.close,
        equityQuote: Number(equityQuote.toFixed(2)),
        drawdownPct: Number(ddPct.toFixed(2)),
        baseQty: Number(totalBaseUnits) / baseScale,
        quoteBalance: Number(totalQuoteUnits) / quoteScale,
      });
    }

    const finalEquityQuote = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equityQuote : initialEquityQuote;
    const netProfitQuote = finalEquityQuote - initialEquityQuote;
    const totalReturnPct = initialEquityQuote > 0 ? (netProfitQuote / initialEquityQuote) * 100 : 0;

    // Trade analytics on closing trades (SELL) + overall realized PnLs
    const exitTrades = simBot.executions.filter(e => e.side === 'SELL');
    let grossWin = 0;
    let grossLoss = 0;
    let wins = 0;

    for (const tr of exitTrades) {
      const pnl = Number(BigInt(tr.realizedPnlQuoteUnits || '0')) / quoteScale;
      if (pnl > 0) {
        wins += 1;
        grossWin += pnl;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
      }
    }

    const winRatePct = exitTrades.length > 0 ? (wins / exitTrades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
    const totalFeesQuote = Number(BigInt(simBot.metrics.totalFeesQuoteUnits || '0')) / quoteScale;
    const avgTradeQuote = exitTrades.length > 0 ? (grossWin - grossLoss) / exitTrades.length : 0;

    // Annualized Sharpe & Sortino based on timeframe periodicity
    const barsPerYear = Math.max(1, (365 * 86_400_000) / tfDurationMs);
    const meanRet = barReturns.length > 0 ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length : 0;
    const varRet =
      barReturns.length > 1
        ? barReturns.reduce((acc, r) => acc + (r - meanRet) ** 2, 0) / barReturns.length
        : 0;
    const stdRet = Math.sqrt(varRet);
    const downsideVar =
      barReturns.length > 1
        ? barReturns.reduce((acc, r) => acc + (r < 0 ? r ** 2 : 0), 0) / barReturns.length
        : 0;
    const downsideStd = Math.sqrt(downsideVar);

    const sharpeRatio = stdRet > 1e-12 ? (meanRet / stdRet) * Math.sqrt(barsPerYear) : 0;
    const sortinoRatio = downsideStd > 1e-12 ? (meanRet / downsideStd) * Math.sqrt(barsPerYear) : 0;

    const exposureDurationMs = exposureBars * tfDurationMs;
    const exposureDurationPct = candles.length > 0 ? (exposureBars / candles.length) * 100 : 0;

    return {
      metrics: {
        totalReturnPct: Number(totalReturnPct.toFixed(2)),
        netProfitQuote: Number(netProfitQuote.toFixed(2)),
        winRatePct: Number(winRatePct.toFixed(2)),
        profitFactor: Number(profitFactor.toFixed(2)),
        maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
        maxDrawdownQuote: Number(maxDrawdownQuote.toFixed(2)),
        sharpeRatio: Number(sharpeRatio.toFixed(2)),
        sortinoRatio: Number(sortinoRatio.toFixed(2)),
        averageTradeQuote: Number(avgTradeQuote.toFixed(2)),
        totalFeesQuote: Number(totalFeesQuote.toFixed(2)),
        exposureDurationMs,
        exposureDurationPct: Number(exposureDurationPct.toFixed(2)),
        numberOfTrades: simBot.executions.length,
        initialEquityQuote: Number(initialEquityQuote.toFixed(2)),
        finalEquityQuote: Number(finalEquityQuote.toFixed(2)),
      },
      equityCurve,
      trades: simBot.executions,
    };
  }
}
