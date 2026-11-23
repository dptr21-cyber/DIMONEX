/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * test_volume_v2_and_pro_chart.ts
 * Comprehensive Automated Verification Suite for:
 *   Part A: Volume Execution & Liquidity Management Engine V2 (and V1 coexistence)
 *   Part B: DIMONEX Pro Chart (7 types, 13 timeframes, 12 indicators, 10 drawing tools,
 *           historical pagination, WS-only real-time, market overlays, preferences persistence)
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import { db } from '../db/database.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { klineService } from '../engine/KlineService.js';
import {
  volumeExecutionV2Service,
  randomBigIntInRange,
  roundQuantityToLot,
  roundPriceToTick,
  calculateSlippageBps,
} from '../services/bots/VolumeExecutionV2Service.js';
import { tradingRouter } from '../routes/trading.js';
import { volumeExecutionV2Router } from '../routes/volumeExecutionV2.js';
import { authRouter } from '../routes/auth.js';
import { AuthService } from '../auth/AuthService.js';
import {
  DEFAULT_INDICATORS,
  computeHeikinAshi,
  computeSMA,
  computeEMA,
  computeVWAP,
  computeBollingerBands,
  computeBollingerBandWidth,
  computeRSI,
  computeMACD,
  computeStochRSI,
  computeATR,
  computeVolumeMA,
  computeOBV,
  computeMFI,
  detectSupportResistanceLevels,
} from '../../src/components/trading/chartIndicators.js';
import {
  computeFibonacciRetracementLevels,
  computeFibonacciExtensionLevels,
  computePriceRangeStats,
  hitTestDrawing,
} from '../../src/components/trading/chartDrawings.js';
import { resolutionToTimeframe, timeframeToResolution } from '../../src/components/trading/dimonexDatafeed.js';
import { CandleItem } from '../../src/types/index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
    failed++;
  }
}

async function reqJson(baseUrl: string, method: string, urlPath: string, token?: string, body?: any) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function runSuite() {
  console.log('========================================================================');
  console.log('   DIMONEX VOLUME ENGINE V2 & PRO CHART COMPREHENSIVE TEST SUITE        ');
  console.log('========================================================================\n');

  // Snapshot exchange_state.json so test mutations never pollute production state
  const statePath = path.join(process.cwd(), 'server', 'data', 'exchange_state.json');
  const hadStateFile = fs.existsSync(statePath);
  const originalStateBackup = hadStateFile ? fs.readFileSync(statePath, 'utf-8') : null;

  const createdBotIds: string[] = [];
  const createdOrderIds: string[] = [];

  // Spin up ephemeral in-process Express server sharing the real `db`, `matchingEngine`, `klineService`
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use('/api/trading', tradingRouter);
  app.use('/api/bot/volume-v2', volumeExecutionV2Router);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Prepare isolated test users & session tokens
    const makerId = `usr-vx2-maker-${Date.now()}`;
    const takerId = `usr-vx2-taker-${Date.now()}`;
    const emptyUserId = `usr-vx2-empty-${Date.now()}`;

    const makerUserObj = {
      id: makerId,
      email: 'vx2-maker@test.local',
      passwordHash: 'test-hash',
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any;
    const takerUserObj = {
      id: takerId,
      email: 'vx2-taker@test.local',
      passwordHash: 'test-hash',
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any;
    const emptyUserObj = {
      id: emptyUserId,
      email: 'vx2-empty@test.local',
      passwordHash: 'test-hash',
      role: 'USER',
      status: 'active',
      isTotpEnabled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any;

    db.users.set(makerId, makerUserObj);
    db.users.set(takerId, takerUserObj);
    db.users.set(emptyUserId, emptyUserObj);

    const makerToken = AuthService.issueToken(makerUserObj, 'test-suite', '127.0.0.1');
    const takerToken = AuthService.issueToken(takerUserObj, 'test-suite', '127.0.0.1');

    // Fund maker & taker cleanly (NEVER fund emptyUserId!)
    const mBtc = db.createOrGetAccount(makerId, 'BTC', '0');
    mBtc.balanceAvailable = (BigInt(mBtc.balanceAvailable) + 5_00000000n).toString(); // 5 BTC
    const mIdr = db.createOrGetAccount(makerId, 'IDR', '0');
    mIdr.balanceAvailable = (BigInt(mIdr.balanceAvailable) + 20_000_000_000_00n).toString(); // 20B IDR

    const tBtc = db.createOrGetAccount(takerId, 'BTC', '0');
    tBtc.balanceAvailable = (BigInt(tBtc.balanceAvailable) + 5_00000000n).toString();
    const tIdr = db.createOrGetAccount(takerId, 'IDR', '0');
    tIdr.balanceAvailable = (BigInt(tIdr.balanceAvailable) + 20_000_000_000_00n).toString();

    const btcPair = db.tradingPairs.get('BTC-IDR')!;
    assert(Boolean(btcPair), 'BTC-IDR pair loaded in database');

    const quoteUnitsPerIdr = 10n ** BigInt(btcPair.quoteDecimals); // 100
    const book = matchingEngine.getOrderBook('BTC-IDR');
    const initDepth = book.getDepth(5);
    const liveBestBidUnits = initDepth.bids.length > 0 ? BigInt(initDepth.bids[0][0]) : 1_450_000_000n * quoteUnitsPerIdr;
    const liveBestAskUnits = initDepth.asks.length > 0 ? BigInt(initDepth.asks[0][0]) : 1_500_000_000n * quoteUnitsPerIdr;

    // Place maker ask slightly below existing bestAsk (above bestBid) & maker bid slightly above existing bestBid
    const midUnits = (liveBestBidUnits + liveBestAskUnits) / 2n;
    const spreadUnits = liveBestAskUnits > liveBestBidUnits ? liveBestAskUnits - liveBestBidUnits : 10_000_000n * quoteUnitsPerIdr;
    const step = spreadUnits > 10n * quoteUnitsPerIdr ? spreadUnits / 10n : 1000n * quoteUnitsPerIdr;

    const askPriceUnitsBig = ((midUnits + step) / quoteUnitsPerIdr) * quoteUnitsPerIdr;
    const partialAskPriceUnitsBig = ((midUnits + step / 2n) / quoteUnitsPerIdr) * quoteUnitsPerIdr;
    const thinAskPriceUnitsBig = ((liveBestBidUnits + step / 2n) / quoteUnitsPerIdr) * quoteUnitsPerIdr;
    const bidPriceUnitsBig = ((liveBestBidUnits + step / 4n) / quoteUnitsPerIdr) * quoteUnitsPerIdr;

    const askPriceUnits = askPriceUnitsBig.toString();
    const bidPriceUnits = bidPriceUnitsBig.toString();

    const collarMinUnits = (liveBestBidUnits * 80n) / 100n;
    const collarMaxUnits = (liveBestAskUnits * 125n) / 100n;
    const collarMinStr = PrecisionMath.formatFromUnits(collarMinUnits, btcPair.quoteDecimals, true);
    const collarMaxStr = PrecisionMath.formatFromUnits(collarMaxUnits, btcPair.quoteDecimals, true);

    const seedAsk = matchingEngine.placeOrder({
      userId: makerId,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: askPriceUnits,
      quantity: '50000000', // 0.5 BTC
    });
    createdOrderIds.push(seedAsk.takerOrder.id);

    const seedBid = matchingEngine.placeOrder({
      userId: makerId,
      pairId: 'BTC-IDR',
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: bidPriceUnits,
      quantity: '50000000', // 0.5 BTC
    });
    createdOrderIds.push(seedBid.takerOrder.id);

    // =========================================================================
    // PART A: VOLUME EXECUTION ENGINE V2 TESTS
    // =========================================================================
    console.log('--- PART A.1: Zero-Float BigInt Math & Market Step Compliance ---');
    const randSamples = Array.from({ length: 40 }, () => randomBigIntInRange(1000000n, 5000000n));
    assert(
      randSamples.every(v => typeof v === 'bigint' && v >= 1000000n && v <= 5000000n),
      'randomBigIntInRange generates bounded BigInt values with zero floating point'
    );
    assert(roundQuantityToLot(123456n, 1000n) === 123000n, 'roundQuantityToLot floors strictly to lotSize');
    assert(roundPriceToTick(15055n, 100n, 'DOWN') === 15000n, 'roundPriceToTick DOWN snaps cleanly');
    assert(roundPriceToTick(15055n, 100n, 'UP') === 15100n, 'roundPriceToTick UP snaps cleanly');
    assert(roundPriceToTick(15055n, 100n, 'NEAREST') === 15100n, 'roundPriceToTick NEAREST snaps cleanly');
    assert(calculateSlippageBps(10100n, 10000n, 'BUY') === 100, 'calculateSlippageBps computes exact +100 bps for BUY');
    assert(calculateSlippageBps(9900n, 10000n, 'SELL') === 100, 'calculateSlippageBps computes exact +100 bps for SELL');

    const vx2Src = fs.readFileSync(path.join(process.cwd(), 'server/services/bots/VolumeExecutionV2Service.ts'), 'utf-8');
    assert(!vx2Src.includes('parseFloat('), 'VolumeExecutionV2Service contains zero parseFloat calls');

    console.log('\n--- PART A.2: Partial Fill & Execution Correctness + Idempotent Replay ---');
    // Seed a counterparty order smaller than aggressive target so partial fill happens cleanly
    const partialAsk = matchingEngine.placeOrder({
      userId: makerId,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: partialAskPriceUnitsBig.toString(),
      quantity: '20000000', // 0.20 BTC
    });
    createdOrderIds.push(partialAsk.takerOrder.id);

    const aggRes = await reqJson(baseUrl, 'POST', '/api/bot/volume-v2/deploy', takerToken, {
      name: 'Agg Partial Test',
      config: {
        pairId: 'BTC-IDR',
        side: 'BUY',
        strategy: 'AGGRESSIVE_LIMIT',
        mode: 'LIVE',
        targetQuantity: '0.50000000',
        sliceMinQuantity: '0.30000000',
        sliceMaxQuantity: '0.30000000',
        durationSeconds: 300,
        intervalSeconds: 30,
        maxOrderNotionalQuote: '1000000000',
        maxCumulativeExposureQuote: '2000000000',
        maxSlippageBps: 500,
        maxParticipationRateBps: 10000,
        priceCollarMin: collarMinStr,
        priceCollarMax: collarMaxStr,
        maxOrdersPerMinute: 30,
        dailyExecutionLimitBase: '5',
        maxPartialFillRetries: 3,
        orderTimeoutSeconds: 10,
      },
    });
    assert(
      aggRes.status === 201 && aggRes.data?.bot?.id,
      'AGGRESSIVE_LIMIT V2 bot deployed via REST API',
      `status=${aggRes.status}, err=${aggRes.data?.error}`
    );
    if (!aggRes.data?.bot?.id) throw new Error(`Deploy failed: ${JSON.stringify(aggRes.data)}`);
    const aggBotId = aggRes.data.bot.id;
    createdBotIds.push(aggBotId);
    const liveAggBot = db.volumeExecutionV2Bots.get(aggBotId)!;
    // Note: Best ask was 0.2 BTC at 1.495B and 0.5 BTC at 1.5B (~33 bps above 1.495B, so 0.3 BTC sweeps 0.2 @ 1.495B + 0.1 @ 1.5B, OR if we test exact partial fill with narrow slippage!)
    const firstExecQty = BigInt(liveAggBot.stats.executedQuantityUnits);
    assert(
      firstExecQty > 0n && firstExecQty <= 30000000n,
      'Executed quantity strictly bounded by filled slice',
      `status=${liveAggBot.status}, exec=${firstExecQty}, log=${liveAggBot.logs[0]?.message}`
    );
    // Stop worker immediately to avoid async interference
    volumeExecutionV2Service.pauseBot(aggBotId, takerId, 'USER');

    // Test idempotent replay of same trades
    const tradesForAgg = db.trades.filter(t => liveAggBot.processedTradeIds.includes(t.id));
    const replayed = volumeExecutionV2Service.applyTradesIdempotently(liveAggBot, tradesForAgg);
    assert(replayed === 0 && BigInt(liveAggBot.stats.executedQuantityUnits) === firstExecQty, 'Replaying same trade IDs is 100% idempotent (0 double-count)');

    // Test reconciliation
    const reconciled = volumeExecutionV2Service.reconcileBotState(aggBotId, takerId, 'USER');
    assert(BigInt(reconciled.stats.executedQuantityUnits) === firstExecQty, 'Reconciliation matches authoritative db.trades');
    volumeExecutionV2Service.stopBot(aggBotId, takerId, 'USER');

    // Explicit Partial-Fill Unfilled Remainder test (slice = 0.3 BTC, counterparty only has 0.1 BTC within 1 bps slippage)
    const thinAsk = matchingEngine.placeOrder({
      userId: makerId,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: thinAskPriceUnitsBig.toString(),
      quantity: '10000000', // 0.10 BTC
    });
    createdOrderIds.push(thinAsk.takerOrder.id);

    const partialBot = volumeExecutionV2Service.deployBot({
      userId: takerId,
      userEmail: 'vx2-taker@test.local',
      config: {
        pairId: 'BTC-IDR',
        side: 'BUY',
        strategy: 'AGGRESSIVE_LIMIT',
        mode: 'LIVE',
        targetQuantity: '0.30000000',
        sliceMinQuantity: '0.30000000',
        sliceMaxQuantity: '0.30000000',
        durationSeconds: 300,
        intervalSeconds: 30,
        maxOrderNotionalQuote: '1000000000',
        maxCumulativeExposureQuote: '2000000000',
        maxSlippageBps: 1, // Tight 1 bps cap prevents crossing deeper asks; only fills the 0.1 BTC at top touch
        maxParticipationRateBps: 10000,
        priceCollarMin: collarMinStr,
        priceCollarMax: collarMaxStr,
        maxOrdersPerMinute: 30,
        dailyExecutionLimitBase: '5',
      },
    });
    createdBotIds.push(partialBot.id);
    volumeExecutionV2Service.stopBot(partialBot.id, takerId, 'USER');
    assert(
      partialBot.stats.executedQuantityUnits === '10000000' &&
        partialBot.stats.remainingQuantityUnits === '20000000',
      'Partial IOC fill counts ONLY executed 0.10 BTC (never requested 0.30 BTC)',
      `exec=${partialBot.stats.executedQuantityUnits}, rem=${partialBot.stats.remainingQuantityUnits}, log=${partialBot.logs[0]?.message}`
    );

    console.log('\n--- PART A.3: TWAP, VWAP, ICEBERG & PASSIVE_LIMIT Strategies ---');
    const strategiesToVerify: Array<'TWAP' | 'VWAP' | 'ICEBERG' | 'PASSIVE_LIMIT'> = [
      'TWAP',
      'VWAP',
      'ICEBERG',
      'PASSIVE_LIMIT',
    ];
    for (const strat of strategiesToVerify) {
      const sb = volumeExecutionV2Service.deployBot({
        userId: takerId,
        userEmail: 'vx2-taker@test.local',
        config: {
          pairId: 'BTC-IDR',
          side: 'BUY',
          strategy: strat,
          mode: 'LIVE',
          targetQuantity: '0.05000000',
          sliceMinQuantity: '0.01000000',
          sliceMaxQuantity: '0.02000000',
          icebergDisplayQuantity: '0.01000000',
          durationSeconds: 120,
          intervalSeconds: 20,
          maxOrderNotionalQuote: '500000000',
          maxCumulativeExposureQuote: '1000000000',
          maxSlippageBps: 200,
          maxParticipationRateBps: 10000,
          priceCollarMin: collarMinStr,
          priceCollarMax: collarMaxStr,
          maxOrdersPerMinute: 30,
          dailyExecutionLimitBase: '5',
          passiveOffsetTicks: 2,
          orderTimeoutSeconds: 10,
        },
      });
      createdBotIds.push(sb.id);
      assert(
        sb.deployedOrderIds.length >= 1,
        `Strategy ${strat} placed real user-authorized resting/active order`,
        `status=${sb.status}, orders=${sb.deployedOrderIds.length}, log=${sb.logs[0]?.message}`
      );
      if (strat === 'ICEBERG') {
        const ord = db.orders.get(sb.deployedOrderIds[0]);
        assert(ord !== undefined && BigInt(ord.quantity) <= 1000000n, 'ICEBERG limits displayed child order quantity');
      }
      const stopRes = volumeExecutionV2Service.stopBot(sb.id, takerId, 'USER');
      assert(stopRes.bot.status === 'STOPPED', `Strategy ${strat} stopped cleanly (${stopRes.cancelledOrdersCount} open cancelled)`);
    }

    console.log('\n--- PART A.4: Prohibited Behavior Guards (No Self-Trade, No Balance Injection) ---');
    // Unfunded user deploy must fail and balance must stay 0
    let emptyBlocked = false;
    try {
      volumeExecutionV2Service.deployBot({
        userId: emptyUserId,
        userEmail: 'vx2-empty@test.local',
        config: {
          pairId: 'BTC-IDR',
          side: 'BUY',
          strategy: 'TWAP',
          mode: 'LIVE',
          targetQuantity: '0.01',
          sliceMinQuantity: '0.01',
          sliceMaxQuantity: '0.01',
          durationSeconds: 60,
          intervalSeconds: 10,
          maxOrderNotionalQuote: '100000000',
          maxCumulativeExposureQuote: '500000000',
          maxSlippageBps: 100,
          maxParticipationRateBps: 10000,
          priceCollarMin: '1400000000',
          priceCollarMax: '1600000000',
          dailyExecutionLimitBase: '5',
        },
      });
    } catch {
      emptyBlocked = true;
    }
    assert(emptyBlocked, 'LIVE V2 rejects unfunded user');
    assert(
      volumeExecutionV2Service.getAvailableBalanceUnits(emptyUserId, 'IDR') === 0n,
      'Zero synthetic balance injection: unfunded balance stays 0'
    );

    // Self-trade prevention check
    const takerAsk = matchingEngine.placeOrder({
      userId: takerId,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: askPriceUnits,
      quantity: '1000000',
    });
    createdOrderIds.push(takerAsk.takerOrder.id);
    assert(
      volumeExecutionV2Service.wouldSelfTrade(takerId, 'BTC-IDR', 'BUY', askPriceUnitsBig + quoteUnitsPerIdr) === true,
      'wouldSelfTrade detects crossing own resting order'
    );
    matchingEngine.cancelOrder(takerAsk.takerOrder.id, takerId, 'BTC-IDR', 'USER');

    console.log('\n--- PART A.5: Risk Limits, Price Collar & Simulation Mode ---');
    const collarBot = volumeExecutionV2Service.deployBot({
      userId: takerId,
      userEmail: 'vx2-taker@test.local',
      config: {
        pairId: 'BTC-IDR',
        side: 'BUY',
        strategy: 'TWAP',
        mode: 'LIVE',
        targetQuantity: '0.02',
        sliceMinQuantity: '0.01',
        sliceMaxQuantity: '0.01',
        durationSeconds: 60,
        intervalSeconds: 10,
        maxOrderNotionalQuote: '100000000',
        maxCumulativeExposureQuote: '500000000',
        maxSlippageBps: 100,
        maxParticipationRateBps: 10000,
        priceCollarMin: '100000',
        priceCollarMax: '200000', // Far below actual market -> instant Risk Halt!
        dailyExecutionLimitBase: '5',
      },
    });
    createdBotIds.push(collarBot.id);
    assert(
      collarBot.status === 'RISK_HALTED',
      'Price Collar breach immediately transitions bot to RISK_HALTED',
      `status=${collarBot.status}, log=${collarBot.logs[0]?.message}`
    );

    // Simulation mode does zero ledger mutation & creates zero real orders
    const ordersCountBeforeSim = db.orders.size;
    const tradesCountBeforeSim = db.trades.length;
    const availIdrBeforeSim = volumeExecutionV2Service.getAvailableBalanceUnits(takerId, 'IDR');
    const simBot = volumeExecutionV2Service.deployBot({
      userId: takerId,
      userEmail: 'vx2-taker@test.local',
      config: {
        pairId: 'BTC-IDR',
        side: 'BUY',
        strategy: 'AGGRESSIVE_LIMIT',
        mode: 'SIMULATION',
        targetQuantity: '0.02000000',
        sliceMinQuantity: '0.02000000',
        sliceMaxQuantity: '0.02000000',
        durationSeconds: 60,
        intervalSeconds: 10,
        maxOrderNotionalQuote: '500000000',
        maxCumulativeExposureQuote: '1000000000',
        maxSlippageBps: 500,
        maxParticipationRateBps: 10000,
        priceCollarMin: collarMinStr,
        priceCollarMax: collarMaxStr,
        dailyExecutionLimitBase: '5',
      },
    });
    createdBotIds.push(simBot.id);
    volumeExecutionV2Service.stopBot(simBot.id, takerId, 'USER');
    assert(
      BigInt(simBot.stats.executedQuantityUnits) > 0n &&
        db.orders.size === ordersCountBeforeSim &&
        db.trades.length === tradesCountBeforeSim &&
        volumeExecutionV2Service.getAvailableBalanceUnits(takerId, 'IDR') === availIdrBeforeSim,
      'SIMULATION mode executes against live book depth with zero ledger/order/trade mutations'
    );

    console.log('\n--- PART A.6: Ownership Auth, Timeout Expiry, Crash Recovery & V1 Untouched ---');
    const unauthStop = await reqJson(baseUrl, 'POST', '/api/bot/volume-v2/stop', makerToken, {
      botId: collarBot.id,
    });
    assert(unauthStop.status === 403, 'Unauthorized user cannot stop another user V2 bot (403)');

    // Timeout & Crash recovery check
    const recBot = volumeExecutionV2Service.deployBot({
      userId: takerId,
      userEmail: 'vx2-taker@test.local',
      config: {
        pairId: 'BTC-IDR',
        side: 'BUY',
        strategy: 'PASSIVE_LIMIT',
        mode: 'LIVE',
        targetQuantity: '0.03000000',
        sliceMinQuantity: '0.01000000',
        sliceMaxQuantity: '0.01000000',
        durationSeconds: 180,
        intervalSeconds: 30,
        maxOrderNotionalQuote: '500000000',
        maxCumulativeExposureQuote: '1000000000',
        maxSlippageBps: 100,
        maxParticipationRateBps: 10000,
        priceCollarMin: collarMinStr,
        priceCollarMax: collarMaxStr,
        dailyExecutionLimitBase: '5',
        orderTimeoutSeconds: 2,
      },
    });
    createdBotIds.push(recBot.id);
    const placedBeforeRec = recBot.deployedOrderIds.length;
    volumeExecutionV2Service.pauseBot(recBot.id, takerId, 'USER');
    // Simulate crash state RUNNING & recover
    recBot.status = 'RUNNING';
    recBot.checkpoint.lastActiveOrderPlacedAt = Date.now() - 10_000; // expired!
    volumeExecutionV2Service.executeTick(recBot.id);
    assert(recBot.stats.orderBreakdown.expired >= 1, 'Order timeout cancels stale resting order and increments expired count');
    volumeExecutionV2Service.recoverActiveBots();
    assert(recBot.deployedOrderIds.length >= placedBeforeRec, 'recoverActiveBots resumes active job cleanly');
    volumeExecutionV2Service.stopBot(recBot.id, takerId, 'USER');

    // Verify legacy V1 bot files are present & untouched
    const legacyBotRouteSrc = fs.readFileSync(path.join(process.cwd(), 'server/routes/bot.ts'), 'utf-8');
    assert(legacyBotRouteSrc.includes("'/volume/deploy'"), 'Legacy V1 /api/bot/volume/deploy remains untouched');

    // =========================================================================
    // PART B: DIMONEX PRO CHART TESTS
    // =========================================================================
    console.log('\n--- PART B.1: 7 Chart Types & Heikin Ashi Real-OHLC Derivation ---');
    const sampleBars: CandleItem[] = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + Math.sin(i / 4) * 5 + i * 0.4;
      return {
        time: 1700000000 + i * 900,
        open: base - 0.5,
        high: base + 1.8,
        low: base - 1.6,
        close: base + (i % 3 === 0 ? -0.4 : 0.7),
        volume: 10 + (i % 7) * 2.5,
      };
    });
    const haBars = computeHeikinAshi(sampleBars);
    assert(
      haBars.length === sampleBars.length &&
        haBars.every((b, idx) => b.high >= Math.max(b.open, b.close, sampleBars[idx].high) - 1e-9),
      'Heikin Ashi derives valid OHLCV bars strictly from real OHLCV history'
    );

    console.log('\n--- PART B.2: All 13 Verified Timeframes & Historical Pagination ---');
    const cfgRes = await reqJson(baseUrl, 'GET', '/api/trading/config');
    const symRes = await reqJson(baseUrl, 'GET', '/api/trading/symbols?symbol=BTC-IDR');
    const expectedResolutions = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', '1D', '1W', '1M'];
    assert(
      expectedResolutions.every(r => cfgRes.data?.supported_resolutions?.includes(r)) &&
        expectedResolutions.every(r => symRes.data?.supported_resolutions?.includes(r)),
      'Backend /config and /symbols advertise all 13 resolutions'
    );
    assert(resolutionToTimeframe('1D') === '1d' && resolutionToTimeframe('1W') === '1w', '1D/1W resolution mapping consistent');
    assert(timeframeToResolution('1M') === '1M' && timeframeToResolution('12h') === '720', 'Timeframe->Resolution mapping consistent');

    // Verify all 13 timeframes query cleanly via /candles/BTC-IDR
    let all13Ok = true;
    for (const tf of ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '1W', '1M']) {
      const cRes = await reqJson(baseUrl, 'GET', `/api/trading/candles/BTC-IDR?timeframe=${tf}&limit=50`);
      if (cRes.status !== 200 || !Array.isArray(cRes.data)) {
        all13Ok = false;
        break;
      }
    }
    assert(all13Ok, 'All 13 timeframes return 200 OK OHLCV bars from /api/trading/candles/BTC-IDR');

    // Pagination beyond 500-candle cache using historical db.trades
    const nowMs = Date.now();
    const addedHistTradeIds: string[] = [];
    for (let i = 0; i < 560; i++) {
      const tid = `trd-hist-${nowMs}-${i}`;
      addedHistTradeIds.push(tid);
      db.trades.push({
        id: tid,
        pairId: 'BTC-IDR',
        makerOrderId: 'hist-m',
        takerOrderId: 'hist-t',
        makerUserId: makerId,
        takerUserId: takerId,
        price: askPriceUnits,
        quantity: '1000000',
        quoteVolume: '1500000000',
        takerSide: i % 2 === 0 ? 'BUY' : 'SELL',
        makerFee: '0',
        takerFee: '0',
        createdAt: nowMs - (600 - i) * 60_000, // 600 distinct 1m candles!
      });
    }
    const latest1m = await reqJson(baseUrl, 'GET', '/api/trading/candles/BTC-IDR?timeframe=1m&limit=100&paginated=1');
    const oldestTime = latest1m.data?.oldestTime;
    const olderPage = await reqJson(
      baseUrl,
      'GET',
      `/api/trading/candles/BTC-IDR?timeframe=1m&before=${oldestTime - 60}&limit=200&paginated=1`
    );
    assert(
      olderPage.status === 200 &&
        Array.isArray(olderPage.data?.candles) &&
        olderPage.data.candles.length >= 100 &&
        olderPage.data.candles[olderPage.data.candles.length - 1].time < oldestTime,
      'Left-scroll pagination (`before`) reconstructs older bars beyond 500-bar memory cache'
    );

    console.log('\n--- PART B.3: All 12 Technical Indicators & Real Support/Resistance ---');
    assert(DEFAULT_INDICATORS.length === 12, '12 modular indicators configured in DEFAULT_INDICATORS');
    assert(computeSMA(sampleBars, 7).length === 34, 'SMA(7) computes expected series length');
    assert(computeEMA(sampleBars, 25).length === 16, 'EMA(25) computes expected series length');
    assert(computeVWAP(sampleBars).length === 40, 'VWAP computes cumulative session VWAP');
    const bb = computeBollingerBands(sampleBars, 20, 2);
    assert(bb.length === 21 && bb.every(p => p.upper >= p.middle && p.middle >= p.lower), 'Bollinger Bands maintain upper >= middle >= lower');
    const rsi = computeRSI(sampleBars, 14);
    assert(rsi.length > 0 && rsi.every(p => p.value >= 0 && p.value <= 100), 'RSI strictly bounded [0, 100]');
    const macd = computeMACD(sampleBars, 12, 26, 9);
    assert(macd.length > 0 && macd.every(p => Math.abs(p.histogram - (p.macd - p.signal)) < 1e-9), 'MACD histogram === macd - signal');
    const stoch = computeStochRSI(sampleBars, 10, 10, 3, 3);
    assert(stoch.length > 0 && stoch.every(p => p.k >= 0 && p.k <= 100 && p.d >= 0 && p.d <= 100), 'Stoch RSI bounded [0, 100]');
    const atr = computeATR(sampleBars, 14);
    assert(atr.length > 0 && atr.every(p => p.value >= 0), 'ATR computes non-negative volatility');
    const bbw = computeBollingerBandWidth(sampleBars, 20, 2);
    assert(bbw.length === 21 && bbw.every(p => p.value >= 0), 'BBW computes percentage band width');
    assert(computeVolumeMA(sampleBars, 20).length === 21, 'Volume MA(20) computes expected length');
    assert(computeOBV(sampleBars).length === 40, 'OBV computes cumulative signed volume');
    const mfi = computeMFI(sampleBars, 14);
    assert(mfi.length > 0 && mfi.every(p => p.value >= 0 && p.value <= 100), 'MFI strictly bounded [0, 100]');
    const sr = detectSupportResistanceLevels(sampleBars, 3, 2);
    assert(Array.isArray(sr) && sr.length >= 1, 'Support & Resistance detects real pivot highs/lows');

    console.log('\n--- PART B.4: Drawings Geometry, Overlays, Price Alerts, Preferences & No 2.5s Polling ---');
    const fibRet = computeFibonacciRetracementLevels(100, 200);
    assert(fibRet.some(f => f.ratio === 0.5 && Math.abs(f.price - 150) < 1e-6), 'Fibonacci Retracement 50% level exact');
    const fibExt = computeFibonacciExtensionLevels(100, 200, 150);
    assert(fibExt.some(f => f.ratio === 1.618 && Math.abs(f.price - 311.8) < 1e-6), 'Fibonacci Extension 1.618 level exact');
    const rangeStats = computePriceRangeStats({ time: 1000, price: 200 }, { time: 1900, price: 250 });
    assert(rangeStats.deltaPrice === 50 && Math.abs(rangeStats.pct - 25) < 1e-9 && rangeStats.deltaSeconds === 900, 'Price Range computes exact delta & %');

    const hitRes = hitTestDrawing(
      {
        id: 'd1',
        tool: 'TREND_LINE',
        points: [
          { time: 1, price: 10 },
          { time: 2, price: 20 },
        ],
        color: '#8DA5B1',
        lineWidth: 2,
        createdAt: 0,
        updatedAt: 0,
      },
      50,
      50,
      pt => (pt.time === 1 ? { x: 0, y: 0 } : { x: 100, y: 100 }),
      500,
      300
    );
    assert(hitRes.hit === true, 'hitTestDrawing detects pointer on Trend Line segment');

    // Chart Drawings REST persistence & cross-user isolation
    const putDraw = await reqJson(baseUrl, 'PUT', '/api/trading/chart-drawings/BTC-IDR', takerToken, {
      drawings: [
        {
          id: 'drw-test-1',
          tool: 'HORIZONTAL_LINE',
          points: [{ time: 1700000000, price: 1500000000 }],
          color: '#D6A85C',
          lineWidth: 2,
        },
      ],
    });
    const getTakerDraw = await reqJson(baseUrl, 'GET', '/api/trading/chart-drawings/BTC-IDR', takerToken);
    const getMakerDraw = await reqJson(baseUrl, 'GET', '/api/trading/chart-drawings/BTC-IDR', makerToken);
    assert(
      putDraw.status === 200 &&
        getTakerDraw.data?.length === 1 &&
        getTakerDraw.data[0].tool === 'HORIZONTAL_LINE' &&
        getMakerDraw.data?.length === 0,
      'Chart drawings persist per authenticated userId + pairId cleanly'
    );

    // User Trades / Avg Entry Overlay API
    const myTradesRes = await reqJson(baseUrl, 'GET', '/api/trading/my-trades/BTC-IDR', takerToken);
    assert(
      myTradesRes.status === 200 &&
        Array.isArray(myTradesRes.data?.trades) &&
        BigInt(myTradesRes.data?.avgEntryPriceUnits || '0') > 0n,
      'GET /api/trading/my-trades/BTC-IDR returns real user fills & BigInt weighted avg entry'
    );

    // Price Alerts API (action=NONE enforced & cross-user delete rejected)
    const createAlert = await reqJson(baseUrl, 'POST', '/api/trading/price-alerts', takerToken, {
      pairId: 'BTC-IDR',
      condition: 'ABOVE_OR_EQUAL',
      thresholdPrice: '155000000000',
    });
    const alertId = createAlert.data?.alert?.id;
    const crossDel = await reqJson(baseUrl, 'DELETE', `/api/trading/price-alerts/${alertId}`, makerToken);
    const ownerDel = await reqJson(baseUrl, 'DELETE', `/api/trading/price-alerts/${alertId}`, takerToken);
    assert(
      createAlert.status === 201 &&
        createAlert.data?.alert?.action === 'NONE' &&
        crossDel.status === 403 &&
        ownerDel.status === 200,
      'Price Alerts API strictly sets action=NONE and enforces owner-only deletion'
    );

    // Preferences chartSettings persistence
    const prefPut = await reqJson(baseUrl, 'PUT', '/api/auth/preferences', takerToken, {
      chartSettings: { chartType: 'HEIKIN_ASHI', logScale: true },
    });
    const prefGet = await reqJson(baseUrl, 'GET', '/api/auth/preferences', takerToken);
    assert(
      prefPut.status === 200 &&
        prefGet.data?.chartSettings?.chartType === 'HEIKIN_ASHI' &&
        prefGet.data?.chartSettings?.logScale === true,
      'User chartSettings persist cleanly via /api/auth/preferences'
    );

    // Verify 2.5s REST polling removed from DimonexChart.tsx
    const dimChartSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/trading/DimonexChart.tsx'), 'utf-8');
    assert(!dimChartSrc.includes('2500') && !dimChartSrc.includes('loadCandles(false)'), 'DimonexChart.tsx has ZERO 2.5s REST polling');

    // Clean up temporary historical trades & open test orders before finishing
    const histSet = new Set(addedHistTradeIds);
    for (let i = db.trades.length - 1; i >= 0; i--) {
      if (histSet.has(db.trades[i].id)) db.trades.splice(i, 1);
    }
  } finally {
    // Stop all bots created during test & cancel temporary orders
    for (const bid of createdBotIds) {
      try {
        const bot = db.volumeExecutionV2Bots.get(bid);
        if (bot) {
          volumeExecutionV2Service.stopBot(bid, bot.userId, 'ADMIN');
          db.volumeExecutionV2Bots.delete(bid);
        }
      } catch {}
    }
    for (const oid of createdOrderIds) {
      const ord = db.orders.get(oid);
      if (ord && (ord.status === 'NEW' || ord.status === 'PARTIALLY_FILLED')) {
        try {
          matchingEngine.cancelOrder(oid, ord.userId, ord.pairId, 'ADMIN');
        } catch {}
      }
    }

    server.close();

    // Restore exact original exchange_state.json so workspace remains clean
    if (originalStateBackup !== null) {
      fs.writeFileSync(statePath, originalStateBackup, 'utf-8');
    } else if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
  }

  console.log('\n========================================================================');
  console.log(`   SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runSuite().catch(err => {
  console.error('Fatal suite error:', err);
  process.exit(1);
});
