/**
 * test_volume_spread_bot.ts
 * Automated verification suite for Volume Bot Phase 2 (VOLUME_SPREAD_BOT — Antar Spread / Self-Cross):
 * - HTTP endpoints (/volume-spread-bot/create, /instance/clone, /instance/:id/update)
 * - Strictly inside-spread Maker + Taker self-cross ("makan order sendiri") without sweeping external orders
 * - Self-trade execution even when global selfTradePreventionPolicy === 'REJECT_BOTH' (while non-bot self-trade stays blocked)
 * - Side pattern alternation (ALTERNATE)
 * - Insufficient balance protection (zero synthetic balance injection)
 * - Quote volume stop-target detection & double-entry ledger invariant verification
 */

import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { db } from '../db/database.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { AuthService } from '../auth/AuthService.js';
import { mmConsoleRouter } from '../routes/mmConsole.js';
import { botWorkerManager } from '../services/BotWorkerManager.js';
import { VolumeSpreadBotExecutor } from '../services/bots/VolumeSpreadBot.js';
import { BotInstance } from '../db/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function httpJson(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function runTests() {
  console.log('=== STARTING VOLUME BOT PHASE 2 (SPREAD SELF-CROSS) TESTS ===\n');

  const mmUser = db.users.get('usr-mm-0000-0000-000000000001') || Array.from(db.users.values()).find(u => u.role === 'MM' || u.role === 'admin' || u.role === 'superadmin');
  if (!mmUser) {
    throw new Error('Seeded MM/Admin user not found for tests.');
  }

  // Ensure MM account has ample BTC & IDR for testing without fake injection inside the bot executor
  db.createOrGetAccount(mmUser.id, 'IDR', '5000000000000');
  db.createOrGetAccount(mmUser.id, 'BTC', '10000000000');

  const mmToken = AuthService.issueToken(mmUser);

  const app = express();
  app.use(express.json());
  app.use('/api/mm', mmConsoleRouter);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const createdBotIds: string[] = [];
  const originalStp = db.riskControls.selfTradePreventionPolicy;
  const externalOrderIds: { id: string; userId: string }[] = [];

  try {
    // TEST 1: HTTP Create, Clone, Update Validation & Legacy VOLUME_BOT preservation
    console.log('[Test 1] HTTP API Creation, Validation, Cloning, Update & Legacy V1 Preservation');
    const badRes = await httpJson(baseUrl, 'POST', '/api/mm/volume-spread-bot/create', mmToken, {
      name: 'Invalid Spread Bot',
      pairId: 'BTC-IDR',
      random_min_quantity: '0.05',
      random_max_quantity: '0.01', // invalid max < min
      vol_quote_stop_target: '1000000000'
    });
    assert(badRes.status === 400, `Invalid min/max qty rejected with 400 (got ${badRes.status})`);

    const createRes = await httpJson(baseUrl, 'POST', '/api/mm/volume-spread-bot/create', mmToken, {
      name: 'Spread Bot Phase 2 HTTP Test',
      pairId: 'BTC-IDR',
      environment: 'DEMO',
      spread_mode: 'INSIDE_SPREAD',
      side_pattern: 'ALTERNATE',
      random_min_quantity: '0.005',
      random_max_quantity: '0.010',
      min_delay: 2,
      max_delay: 4,
      spread_band_min_pct: 20,
      spread_band_max_pct: 80,
      min_spread_bps: 2,
      fallback_half_spread_bps: 15,
      require_two_sided_book: true,
      cross_delay_ms: 0,
      min_limit_price: '1400000000',
      max_limit_price: '1500000000',
      vol_quote_stop_target: '250000000'
    });
    assert(createRes.status === 200 && createRes.data?.bot?.botType === 'VOLUME_SPREAD_BOT', 'Created VOLUME_SPREAD_BOT successfully via HTTP');
    const createdBotId = createRes.data.bot.id;
    createdBotIds.push(createdBotId);

    // Clone check resets runtime execution counters
    const clonedRes = await httpJson(baseUrl, 'POST', '/api/mm/instance/clone', mmToken, {
      sourceBotId: createdBotId,
      newName: 'Spread Bot Clone Test'
    });
    assert(clonedRes.status === 200 && clonedRes.data?.bot?.botType === 'VOLUME_SPREAD_BOT', 'Cloned VOLUME_SPREAD_BOT successfully');
    createdBotIds.push(clonedRes.data.bot.id);
    assert(clonedRes.data.bot.volumeSpreadConfig?.executedQuoteVolumeUnits === '0', 'Cloned bot starts with 0 executedQuoteVolumeUnits');

    // Update check
    const updateRes = await httpJson(baseUrl, 'POST', `/api/mm/instance/${createdBotId}/update`, mmToken, {
      name: 'Spread Bot Phase 2 Updated',
      volumeSpreadConfig: {
        spread_mode: 'PING_PONG_EDGE',
        cross_delay_ms: 50
      }
    });
    assert(updateRes.status === 200 && updateRes.data?.bot?.volumeSpreadConfig?.spread_mode === 'PING_PONG_EDGE', 'Updated VOLUME_SPREAD_BOT config cleanly');

    // Legacy VOLUME_BOT still creates normally without interference
    const v1Res = await httpJson(baseUrl, 'POST', '/api/mm/volume-bot/create', mmToken, {
      name: 'Legacy Volume Bot V1 Preservation Check',
      pairId: 'BTC-IDR',
      environment: 'DEMO',
      volume_random_min_quantity: '0.01',
      volume_random_max_quantity: '0.02',
      min_delay: 2,
      max_delay: 5,
      min_limit_price: '1400000000',
      max_limit_price: '1550000000',
      vol_idr_stop_target: '500000000'
    });
    assert(v1Res.status === 200 && v1Res.data?.bot?.botType === 'VOLUME_BOT', 'Legacy Phase 9 VOLUME_BOT creation remains intact');
    createdBotIds.push(v1Res.data.bot.id);

    // TEST 2: Prepare wide external book spread on BTC-IDR & verify strictly inside-spread self-cross
    console.log('\n[Test 2] Inside-Spread Execution & External Order Preservation');
    const extBidUser = `usr-test-ext-bid-${Date.now()}`;
    const extAskUser = `usr-test-ext-ask-${Date.now()}`;
    const botExecUser = `usr-test-vsp-exec-${Date.now()}`;

    LedgerService.deposit(extBidUser, 'IDR', 500000000000n, 'test-dep-1', `dep-${extBidUser}-idr`);
    LedgerService.deposit(extAskUser, 'BTC', 200000000n, 'test-dep-2', `dep-${extAskUser}-btc`);
    LedgerService.deposit(botExecUser, 'IDR', 5000000000000n, 'test-dep-3', `dep-${botExecUser}-idr`);
    LedgerService.deposit(botExecUser, 'BTC', 500000000n, 'test-dep-4', `dep-${botExecUser}-btc`);

    const book = matchingEngine.getOrderBook('BTC-IDR');
    const curBid = book.bids.length > 0 ? BigInt(book.bids[0].price) : 144000000000n;
    const curAsk = book.asks.length > 0 ? BigInt(book.asks[0].price) : 146000000000n;

    // Place external top-of-book orders slightly inside current spread to guarantee clean window
    const topBidRes = matchingEngine.placeOrder({
      userId: extBidUser,
      pairId: 'BTC-IDR',
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: (curBid + 1000000n).toString(),
      quantity: '10000000',
      clientOrderId: 'ext-test-bid'
    });
    externalOrderIds.push({ id: topBidRes.takerOrder.id, userId: extBidUser });

    const topAskRes = matchingEngine.placeOrder({
      userId: extAskUser,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: (curAsk - 1000000n).toString(),
      quantity: '10000000',
      clientOrderId: 'ext-test-ask'
    });
    externalOrderIds.push({ id: topAskRes.takerOrder.id, userId: extAskUser });

    const activeBid = BigInt(matchingEngine.getOrderBook('BTC-IDR').bids[0].price);
    const activeAsk = BigInt(matchingEngine.getOrderBook('BTC-IDR').asks[0].price);
    assert(activeAsk > activeBid, `Live order book has two-sided spread (${activeBid} .. ${activeAsk})`);

    const pairBtc = db.tradingPairs.get('BTC-IDR')!;
    const dynamicMinFloor = PrecisionMath.formatFromUnits((activeBid * 70n) / 100n, pairBtc.quoteDecimals);
    const dynamicMaxCeil = PrecisionMath.formatFromUnits((activeAsk * 130n) / 100n, pairBtc.quoteDecimals);

    // Force strict REJECT_BOTH STP policy to prove Phase 2 bot still crosses its own -vol- order while regular users get blocked
    db.riskControls.selfTradePreventionPolicy = 'REJECT_BOTH';

    const spreadBot: BotInstance = {
      id: `bot-vsp-unit-${crypto.randomUUID().slice(0, 6)}`,
      name: 'Direct Spread Self-Cross Test',
      botType: 'VOLUME_SPREAD_BOT',
      pairId: 'BTC-IDR',
      environment: 'DEMO',
      ownerUserId: botExecUser,
      accountId: botExecUser,
      version: 1,
      status: 'RUNNING',
      lastHeartbeat: Date.now(),
      volumeSpreadConfig: {
        account_id: botExecUser,
        spread_mode: 'INSIDE_SPREAD',
        side_pattern: 'ALTERNATE',
        random_min_quantity: '0.005',
        random_max_quantity: '0.015',
        min_delay: 1,
        max_delay: 2,
        spread_band_min_pct: 20,
        spread_band_max_pct: 80,
        min_spread_bps: 1,
        fallback_half_spread_bps: 10,
        require_two_sided_book: true,
        cross_delay_ms: 0,
        min_limit_price: dynamicMinFloor,
        max_limit_price: dynamicMaxCeil,
        vol_quote_stop_target: '1000000000',
        executedQuoteVolumeUnits: '0',
        spreadSelfTradesCount: 0
      },
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [],
      createdBy: mmUser.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const logs: string[] = [];
    const addLog = (_b: BotInstance, m: string) => logs.push(m);

    // Tick 1 (expected BUY taker because lastSideExecuted undefined -> BUY)
    const leg1 = VolumeSpreadBotExecutor.prepareSpreadCrossTick(spreadBot, addLog);
    assert(leg1.status === 'READY_FOR_CROSS', `Tick 1 prepared successfully (status=${leg1.status}${leg1.reason ? `, reason=${leg1.reason}` : ''})`);
    assert(leg1.takerSide === 'BUY' && leg1.makerSide === 'SELL', `Tick 1 taker=BUY eats maker=SELL`);
    assert(
      leg1.execPriceUnits! > activeBid && leg1.execPriceUnits! < activeAsk,
      `Tick 1 execution price ${leg1.execPriceUnits} strictly inside (${activeBid}, ${activeAsk})`
    );

    const cross1 = VolumeSpreadBotExecutor.completeSpreadCrossLeg(spreadBot, leg1, addLog);
    assert(cross1.status === 'EXECUTED' && cross1.tradesCount >= 1, `Tick 1 self-cross executed ${cross1.tradesCount} trade(s) even under REJECT_BOTH`);
    assert(cross1.executedBaseUnits > 0n && cross1.executedQuoteUnits > 0n, 'Tick 1 recorded real BigInt base & quote execution units');

    // Verify external orders remained 100% untouched!
    const bidAfter1 = db.orders.get(topBidRes.takerOrder.id)!;
    const askAfter1 = db.orders.get(topAskRes.takerOrder.id)!;
    assert(bidAfter1.filledQuantity === '0' && askAfter1.filledQuantity === '0', 'External Bid & Ask orders remained 100% untouched (0 external fill)');

    // Tick 2 (ALTERNATE -> expected SELL taker eats BUY maker)
    const leg2 = VolumeSpreadBotExecutor.prepareSpreadCrossTick(spreadBot, addLog);
    assert(leg2.status === 'READY_FOR_CROSS' && leg2.takerSide === 'SELL' && leg2.makerSide === 'BUY', 'Tick 2 alternated cleanly to taker=SELL eating maker=BUY');
    const cross2 = VolumeSpreadBotExecutor.completeSpreadCrossLeg(spreadBot, leg2, addLog);
    assert(cross2.status === 'EXECUTED' && cross2.tradesCount >= 1, 'Tick 2 opposing self-cross executed cleanly');
    assert(BigInt(spreadBot.stats.executedVolume) === cross1.executedBaseUnits + cross2.executedBaseUnits, 'Bot stats.executedVolume equals exact BigInt sum of filled trades');

    // TEST 3: Non-bot regular user self-trade is STILL prevented by REJECT_BOTH
    console.log('\n[Test 3] Non-Bot Self-Trade Prevention Remains Active');
    LedgerService.deposit(extBidUser, 'BTC', 100000000n, 'test-dep-5', `dep-${extBidUser}-btc-stp`);
    const userMaker = matchingEngine.placeOrder({
      userId: extBidUser,
      pairId: 'BTC-IDR',
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: (activeBid + 500000n).toString(),
      quantity: '500000',
      clientOrderId: 'normal-user-maker'
    });
    externalOrderIds.push({ id: userMaker.takerOrder.id, userId: extBidUser });

    const userTaker = matchingEngine.placeOrder({
      userId: extBidUser,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'IOC',
      price: (activeBid + 500000n).toString(),
      quantity: '500000',
      clientOrderId: 'normal-user-taker'
    });
    assert(userTaker.trades.length === 0, 'Non-bot same-user trade is still blocked under REJECT_BOTH STP policy');

    // TEST 4: Insufficient Balance Rejection (NO Fake Balance Injection)
    console.log('\n[Test 4] Insufficient Balance Rejection (Zero Synthetic Balance Injection)');
    const brokeUserId = `usr-broke-${Date.now()}`;
    const brokeBot: BotInstance = {
      ...spreadBot,
      id: `bot-vsp-broke-${crypto.randomUUID().slice(0, 6)}`,
      ownerUserId: brokeUserId,
      accountId: brokeUserId,
      volumeSpreadConfig: {
        ...spreadBot.volumeSpreadConfig!,
        account_id: brokeUserId,
        require_two_sided_book: false
      }
    };
    const brokeLeg = VolumeSpreadBotExecutor.prepareSpreadCrossTick(brokeBot, addLog);
    assert(brokeLeg.status === 'INSUFFICIENT_BALANCE', `Zero-balance account rejected cleanly (${brokeLeg.status})`);
    const brokeIdrAcc = db.ledgerAccounts.get(`${brokeUserId}_IDR`);
    const brokeBtcAcc = db.ledgerAccounts.get(`${brokeUserId}_BTC`);
    assert(
      (!brokeIdrAcc || brokeIdrAcc.balanceAvailable === '0') && (!brokeBtcAcc || brokeBtcAcc.balanceAvailable === '0'),
      'Zero fake balance injected into broke user accounts'
    );

    // TEST 5: Quote Stop Target Auto-Stop & Cleanup
    console.log('\n[Test 5] Stop Target Detection & No Dangling Maker Orders');
    spreadBot.volumeSpreadConfig!.vol_quote_stop_target = '100'; // far below already executed volume
    const stopLeg = VolumeSpreadBotExecutor.prepareSpreadCrossTick(spreadBot, addLog);
    assert(stopLeg.status === 'STOP_TARGET_REACHED', `Stop target reached triggers STOP_TARGET_REACHED (${stopLeg.status})`);
    const openBotOrders = spreadBot.deployedOrderIds.filter(oid => {
      const o = db.orders.get(oid);
      return o && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED');
    });
    assert(openBotOrders.length === 0, `Zero dangling open maker orders left behind (found ${openBotOrders.length})`);

    // TEST 6: Global Ledger Double-Entry Invariant Check
    console.log('\n[Test 6] Global Double-Entry Ledger Invariant');
    const invariants = LedgerService.verifyGlobalInvariants();
    assert(invariants.isConsistent, `Ledger global invariants hold true (errors=${invariants.errors.length})`);
  } finally {
    // Cleanup temporary external orders & created test bots
    db.riskControls.selfTradePreventionPolicy = originalStp;
    for (const o of externalOrderIds) {
      const existing = db.orders.get(o.id);
      if (existing && (existing.status === 'NEW' || existing.status === 'PARTIALLY_FILLED')) {
        try {
          matchingEngine.cancelOrder(o.id, o.userId, existing.pairId);
        } catch {
          // ignore
        }
      }
    }
    for (const bId of createdBotIds) {
      botWorkerManager.stopWorker(bId, true);
      db.botInstances.delete(bId);
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  console.log(`\n=== TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
