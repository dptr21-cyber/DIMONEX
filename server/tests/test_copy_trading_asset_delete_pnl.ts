/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/tests/test_copy_trading_asset_delete_pnl.ts
 * Automated End-to-End Verification Suite for:
 * 1. Real Copy Trading Engine (Master Apply/Approve, Atomic Ledger Follow, Real Spot Signal Mirroring, Profit Share & Stop Settlement)
 * 2. Admin Delete Asset/Token (IDR Guard, Dependency 409 Guard, Force Cleanup, Non-Resurrection)
 * 3. Real-Data LivePnLView Accuracy (Zero Fake Seeding, Exact Avg Buy & Market Price, Deposit Cost-Basis Flag)
 * 4. Persistent Daily PnL Calendar (Survives db.trades pruning & disk reload)
 */

import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import {
  db,
  SYSTEM_COPY_CUSTODY_ID,
  SYSTEM_FEE_ID,
  SYSTEM_TREASURY_ID,
} from '../db/database.js';
import { authRouter } from '../routes/auth.js';
import { adminRouter } from '../routes/admin.js';
import { walletRouter } from '../routes/wallet.js';
import { copyTradingRouter } from '../routes/copyTrading.js';
import { copyTradingService } from '../services/copy/CopyTradingService.js';
import { pnlService } from '../services/pnl/PnLService.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';

async function reqJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  token?: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  console.log('=======================================================================');
  console.log(' DIMONEX Real Copy Trading + Asset Delete + Real PnL & Calendar Suite');
  console.log('=======================================================================');

  // Snapshot exchange_state.json on disk so disk reload tests leave zero footprint
  const stateCandidates = [
    path.join(process.cwd(), 'server', 'data', 'exchange_state.json'),
    path.join('/tmp', 'dimonex_data', 'exchange_state.json'),
  ];
  const diskBackup = new Map<string, Buffer | null>();
  for (const p of stateCandidates) {
    diskBackup.set(p, fs.existsSync(p) ? fs.readFileSync(p) : null);
  }

  // Ensure service listener is active
  copyTradingService.start();

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/copy-trading', copyTradingRouter);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdUserIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdAccountIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdMasterIds: string[] = [];
  const createdRelIds: string[] = [];
  const createdAssetIds: string[] = [];
  const createdPairIds: string[] = [];
  const createdDailyKeys: string[] = [];

  const tradeStartLen = db.trades.length;
  const mirroredStartLen = db.copyMirroredOrders.length;
  const journalStartKeys = new Set(db.journalTransactions.keys());
  const ledgerEntryStartLen = db.ledgerEntries.length;
  const auditStartLen = db.auditLogs.length;

  let passed = 0;
  const pass = (label: string) => {
    passed++;
    console.log(`  [PASS] ${passed}. ${label}`);
  };

  const btcIdrPair = db.tradingPairs.get('BTC-IDR');
  const origBtcLastPrice = btcIdrPair?.lastPrice || '150000000000';

  try {
    const createTestUser = (
      role: 'USER' | 'ADMIN',
      tag: string,
      balances: Record<string, string>
    ) => {
      const id = `usr-test-suite-${tag}-${crypto.randomUUID().slice(0, 8)}`;
      const salt = db.generateSalt();
      db.users.set(id, {
        id,
        email: `${tag}-${Date.now()}@dimonex.id`,
        fullName: `Test ${tag.toUpperCase()}`,
        passwordSalt: salt,
        passwordHash: db.hashPassword('TestSuite2026!', salt),
        role,
        status: 'active',
        isTotpEnabled: false,
        failedLoginAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      createdUserIds.push(id);
      for (const [curr, units] of Object.entries(balances)) {
        const acc = db.createOrGetAccount(id, curr, units);
        createdAccountIds.push(acc.id);
      }

      const tok = `tok-test-suite-${crypto.randomUUID()}`;
      db.sessions.set(tok, {
        userId: id,
        token: tok,
        device: 'test-runner',
        ip: '127.0.0.1',
        expiresAt: Date.now() + 3600_000,
        lastActive: Date.now(),
        createdAt: Date.now(),
      });
      createdSessionTokens.push(tok);
      return { id, tok };
    };

    // Ensure Treasury has reserve balance for settlement deltas in tests
    db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT', PrecisionMath.parseToUnits('1000000', 6).toString());
    db.createOrGetAccount(SYSTEM_TREASURY_ID, 'IDR', PrecisionMath.parseToUnits('10000000000', 2).toString());
    db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, 'USDT', '0');
    db.createOrGetAccount(SYSTEM_COPY_CUSTODY_ID, 'IDR', '0');

    const admin = createTestUser('ADMIN', 'adm', { IDR: PrecisionMath.parseToUnits('10000000', 2).toString() });
    const lpMaker = createTestUser('USER', 'lp', {
      IDR: PrecisionMath.parseToUnits('5000000000', 2).toString(),
      BTC: PrecisionMath.parseToUnits('5', 8).toString(),
      USDT: PrecisionMath.parseToUnits('500000', 6).toString(),
    });
    const traderUser = createTestUser('USER', 'pnl', {
      IDR: PrecisionMath.parseToUnits('2000000000', 2).toString(),
      BTC: PrecisionMath.parseToUnits('0.2', 8).toString(), // Pre-existing deposit (no buy cost basis)
    });
    const masterCandidate = createTestUser('USER', 'master', {
      IDR: PrecisionMath.parseToUnits('2000000000', 2).toString(),
      BTC: PrecisionMath.parseToUnits('1', 8).toString(),
      USDT: PrecisionMath.parseToUnits('10000', 6).toString(),
    });
    const followerUser = createTestUser('USER', 'follower', {
      IDR: PrecisionMath.parseToUnits('100000000', 2).toString(),
      USDT: PrecisionMath.parseToUnits('1000', 6).toString(),
    });

    // =========================================================================
    // TEST 1: ADMIN ASSET DELETE (IDR Guard, 409 Dependency Check, Force Cleanup)
    // =========================================================================
    const idrAsset = Array.from(db.assets.values()).find(a => a.symbol === 'IDR');
    assert(idrAsset, 'IDR base asset must exist');
    const delIdrRes = await reqJson(baseUrl, 'DELETE', `/api/admin/assets/${idrAsset!.id}`, admin.tok);
    assert.strictEqual(delIdrRes.status, 400, 'Deleting base fiat IDR must fail with 400');
    pass('Admin Delete Token rejects deleting base currency IDR (400)');

    // Create custom test token
    const createAssetRes = await reqJson(baseUrl, 'POST', '/api/admin/assets', admin.tok, {
      symbol: 'ZDEL',
      name: 'Zero Delete Coin',
      network: 'ERC20',
      decimals: 8,
      minDeposit: '1',
      minWithdraw: '1',
      withdrawFee: '0.1',
    });
    assert.strictEqual(createAssetRes.status, 201, `Create ZDEL failed: ${JSON.stringify(createAssetRes.data)}`);
    const createdAssetId = createAssetRes.data.asset.id;
    createdAssetIds.push(createdAssetId);

    // Create linked pair ZDEL-IDR
    db.tradingPairs.set('ZDEL-IDR', {
      id: 'ZDEL-IDR',
      baseCurrency: 'ZDEL',
      quoteCurrency: 'IDR',
      baseDecimals: 8,
      quoteDecimals: 2,
      minOrderSize: '10000000',
      maxOrderSize: '10000000000000',
      priceTickSize: '100',
      lotSize: '1000000',
      makerFeeBps: 10,
      takerFeeBps: 20,
      lastPrice: '1000000',
      isActive: true,
      isHalted: false,
      createdAt: Date.now(),
    });
    createdPairIds.push('ZDEL-IDR');

    const delWithoutForce = await reqJson(
      baseUrl,
      'DELETE',
      `/api/admin/assets/${createdAssetId}`,
      admin.tok
    );
    assert.strictEqual(delWithoutForce.status, 409, 'Expected 409 dependency guard when pair exists');
    assert.strictEqual(delWithoutForce.data.requiresForce, true, 'Expected requiresForce: true');
    pass('Admin Delete Token returns 409 dependency warning when trading pair exists');

    const delWithForce = await reqJson(
      baseUrl,
      'DELETE',
      `/api/admin/assets/${createdAssetId}?force=1`,
      admin.tok
    );
    assert.strictEqual(delWithForce.status, 200, `Force delete failed: ${JSON.stringify(delWithForce.data)}`);
    assert(!db.assets.has(createdAssetId), 'ZDEL asset must be removed from db.assets');
    assert(!db.tradingPairs.has('ZDEL-IDR'), 'ZDEL-IDR pair must be removed on force delete');
    assert(db.deletedAssetSymbols.has('ZDEL'), 'ZDEL must be added to deletedAssetSymbols');

    // Ensure startup guards cannot resurrect deleted asset
    db.ensureAssetsForTradingPairs();
    db.ensureInitialListingData();
    const resurrected = Array.from(db.assets.values()).find(a => a.symbol === 'ZDEL');
    assert(!resurrected, 'Deleted token ZDEL must not resurrect after ensureAssetsForTradingPairs / ensureInitialListingData');
    pass('Admin Force Delete removes token + pair permanently and prevents auto-resurrection');

    // =========================================================================
    // TEST 2: LIVE PNL REAL DATA ACCURACY + PERSISTENT DAILY PNL CALENDAR
    // =========================================================================
    // A) Fresh user with zero trades must NOT receive fake usr-seed-* trades, and deposited BTC shows hasCostBasis: false
    const freshPnlRes = await reqJson(baseUrl, 'GET', '/api/wallet/pnl-analytics', traderUser.tok);
    assert.strictEqual(freshPnlRes.status, 200);
    assert.strictEqual(freshPnlRes.data.summary.totalTrades, 0, 'Fresh user must have 0 trades (no fake seed trades)');
    const freshBtcAsset = (freshPnlRes.data.assetBreakdown || []).find((a: any) => a.symbol === 'BTC');
    assert(freshBtcAsset, 'BTC holding must appear in assetBreakdown');
    assert.strictEqual(freshBtcAsset.hasCostBasis, false, 'Deposited BTC without buy trades must have hasCostBasis=false');
    assert.strictEqual(freshBtcAsset.avgBuyPriceIdr, 0, 'Deposited BTC without buy trades must not invent fake avgBuyPriceIdr');
    assert(freshBtcAsset.currentPriceIdr > 0, 'Current BTC IDR price must come from real market feed');
    pass('LivePnLView rejects fake trade seeding and flags deposit-only holdings honestly');

    // Isolate BTC-IDR in-memory OrderBook levels for deterministic test pricing
    const btcBook = matchingEngine.getOrderBook('BTC-IDR');
    const savedBids = btcBook.bids.splice(0, btcBook.bids.length);
    const savedAsks = btcBook.asks.splice(0, btcBook.asks.length);

    try {
      // B) Execute genuine Spot BUY & profitable SELL for traderUser
      const buyAskPriceUnits = PrecisionMath.parseToUnits('1500000000', 2).toString();
      const qtyPointOneUnits = PrecisionMath.parseToUnits('0.1', 8).toString();

      const askOrder = matchingEngine.placeOrder({
        userId: lpMaker.id,
        pairId: 'BTC-IDR',
        side: 'SELL',
        orderType: 'LIMIT',
        price: buyAskPriceUnits,
        quantity: qtyPointOneUnits,
      });
      createdOrderIds.push(askOrder.takerOrder.id);

      const buyOrder = matchingEngine.placeOrder({
        userId: traderUser.id,
        pairId: 'BTC-IDR',
        side: 'BUY',
        orderType: 'MARKET',
        quantity: qtyPointOneUnits,
      });
      createdOrderIds.push(buyOrder.takerOrder.id);
      assert(buyOrder.trades.length > 0, 'Real BTC BUY order must match against LP resting ask');

      const afterBuyPnlRes = await reqJson(baseUrl, 'GET', '/api/wallet/pnl-analytics', traderUser.tok);
      assert.strictEqual(afterBuyPnlRes.status, 200);
      assert.strictEqual(afterBuyPnlRes.data.summary.totalTrades, 1);
      const boughtBtc = afterBuyPnlRes.data.assetBreakdown.find((a: any) => a.symbol === 'BTC');
      assert.strictEqual(boughtBtc.hasCostBasis, true, 'After real BUY, BTC must have hasCostBasis=true');
      assert.strictEqual(
        boughtBtc.avgBuyPriceIdr,
        1500000000,
        `avgBuyPriceIdr (${boughtBtc.avgBuyPriceIdr}) must match exact historical execution price 1500000000`
      );
      assert.strictEqual(boughtBtc.openLotsCount, 1, 'Expected 1 open FIFO lot');
      assert.strictEqual(boughtBtc.recentFills?.[0]?.priceIdr, 1500000000, 'Expected recentFills[0].priceIdr === 1500000000');
      assert.strictEqual(boughtBtc.currentPriceIdr, 1500000000, 'currentPriceIdr must equal real BTC-IDR lastPrice');

      // Test closed FuturesPosition BigInt safety (must never throw Cannot convert undefined to a BigInt)
      const futId = `fut-test-${crypto.randomUUID().slice(0, 8)}`;
      db.futuresPositions.set(futId, {
        id: futId,
        userId: traderUser.id,
        pairId: 'BTC-USDT',
        baseCurrency: 'BTC',
        quoteCurrency: 'USDT',
        baseDecimals: 8,
        quoteDecimals: 6,
        side: 'LONG',
        marginMode: 'ISOLATED',
        leverage: 10,
        sizeUnits: PrecisionMath.parseToUnits('0.01', 8).toString(),
        entryPriceUnits: PrecisionMath.parseToUnits('90000', 6).toString(),
        markPriceUnits: PrecisionMath.parseToUnits('91000', 6).toString(),
        liqPriceUnits: PrecisionMath.parseToUnits('82000', 6).toString(),
        marginLockedUnits: PrecisionMath.parseToUnits('90', 6).toString(),
        openFeeUnits: PrecisionMath.parseToUnits('0.45', 6).toString(),
        closeFeeUnits: PrecisionMath.parseToUnits('0.45', 6).toString(),
        unrealizedPnlUnits: '0',
        realizedPnlUnits: PrecisionMath.parseToUnits('10', 6).toString(),
        roePct: 11.11,
        status: 'CLOSED',
        openedAt: Date.now() - 60_000,
        closedAt: Date.now(),
        updatedAt: Date.now(),
      });
      try {
        const afterFutPnlRes = await reqJson(baseUrl, 'GET', '/api/wallet/pnl-analytics', traderUser.tok);
        assert.strictEqual(afterFutPnlRes.status, 200, 'PnL analytics with closed FuturesPosition must return 200 without BigInt error');
        const todayKeyFut = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
        assert(
          afterFutPnlRes.data.calendarData[todayKeyFut]?.trades?.some((x: any) => x.id === `fut-${futId}`),
          'Closed FuturesPosition must be tracked cleanly in daily calendar'
        );
      } finally {
        db.futuresPositions.delete(futId);
      }

      // Verify exact FIFO historical recovery even after db.trades is pruned
      const savedTradesSnapshot = db.trades.splice(0, db.trades.length);
      try {
        const prunedRecoveryRes = await reqJson(baseUrl, 'GET', '/api/wallet/pnl-analytics', traderUser.tok);
        assert.strictEqual(prunedRecoveryRes.status, 200);
        const recoveredBtc = prunedRecoveryRes.data.assetBreakdown.find((a: any) => a.symbol === 'BTC');
        assert.strictEqual(
          recoveredBtc.avgBuyPriceIdr,
          1500000000,
          'FIFO avgBuyPriceIdr must remain exact 1500000000 even after db.trades pruning'
        );
      } finally {
        db.trades.push(...savedTradesSnapshot);
      }
      pass('LivePnLView computes exact FIFO execution avgBuyPrice, recovers after pruning & handles Futures safely');

      // Profitable SELL at Rp 1.650.000.000 (+10%)
      const bidHighOrder = matchingEngine.placeOrder({
        userId: lpMaker.id,
        pairId: 'BTC-IDR',
        side: 'BUY',
        orderType: 'LIMIT',
        price: PrecisionMath.parseToUnits('1650000000', 2).toString(),
        quantity: qtyPointOneUnits,
      });
      createdOrderIds.push(bidHighOrder.takerOrder.id);

      const sellWinOrder = matchingEngine.placeOrder({
        userId: traderUser.id,
        pairId: 'BTC-IDR',
        side: 'SELL',
        orderType: 'MARKET',
        quantity: qtyPointOneUnits,
      });
      createdOrderIds.push(sellWinOrder.takerOrder.id);
      assert(sellWinOrder.trades.length > 0, 'Real BTC SELL order must match at higher price');

    const afterSellPnlRes = await reqJson(baseUrl, 'GET', '/api/wallet/pnl-analytics', traderUser.tok);
    assert.strictEqual(afterSellPnlRes.status, 200);
    assert(afterSellPnlRes.data.summary.totalRealizedPnlIdr > 0, 'Realized PnL must be positive after +10% exit');
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    assert(
      afterSellPnlRes.data.calendarData[todayKey]?.pnlIdr > 0,
      'Today WIB calendar cell must contain positive realized PnL'
    );

    // C) Persistence test: Add historical daily snapshot (5 days ago), save to disk, clear db.trades, reload from disk
    const pastTs = Date.now() - 5 * 86400_000;
    const pastDateKey = new Date(pastTs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    const pastSnapKey = `${traderUser.id}:${pastDateKey}`;
    createdDailyKeys.push(pastSnapKey);
    db.dailyPnlSnapshots.set(pastSnapKey, {
      userId: traderUser.id,
      date: pastDateKey,
      timestamp: pastTs,
      pnlIdr: 2500000,
      pnlUsdt: 151.98,
      returnPct: 2.5,
      tradesCount: 3,
      winCount: 2,
      lossCount: 1,
      volumeIdr: 100000000,
      volumeUsdt: 6079.03,
      feesIdr: 200000,
      feesUsdt: 12.16,
      trades: [
        {
          id: 'hist-tx-1',
          pairId: 'BTC-IDR',
          side: 'SELL',
          source: 'SPOT',
          qty: 0.05,
          priceIdr: 1500000000,
          pnlIdr: 2500000,
          pnlUsdt: 151.98,
          feeIdr: 200000,
          timeStr: '10:30',
        },
      ],
      updatedAt: pastTs,
    });
    assert(db.saveToDisk(), 'Saving state with dailyPnlSnapshots must succeed');

    // Prune all trades from RAM to prove calendar does NOT lose history when db.trades trims
    db.trades.length = 0;
    assert(db.loadFromDisk(), 'Reloading state from disk must succeed');

    const pastMonth = pastDateKey.slice(0, 7);
    const reloadedRes = await reqJson(
      baseUrl,
      'GET',
      `/api/wallet/pnl-analytics?month=${pastMonth}`,
      traderUser.tok
    );
    assert.strictEqual(reloadedRes.status, 200);
    assert.strictEqual(
      reloadedRes.data.calendarData[pastDateKey]?.pnlIdr,
      2500000,
      'Historical daily calendar snapshot must persist across db.trades pruning & disk restart'
    );
    pass('Daily PnL Calendar snapshots persist permanently on disk across trade buffer pruning & restarts');

    // =========================================================================
    // TEST 3: REAL COPY TRADING ENGINE (Apply -> Admin Approve -> Follow -> Mirror -> Profit Share & Stop)
    // =========================================================================
    const publicMastersBefore = await reqJson(baseUrl, 'GET', '/api/copy-trading/masters');
    assert.strictEqual(publicMastersBefore.status, 200);
    assert(publicMastersBefore.data.masters.length >= 4, 'Default real Masters must be loaded');

    // Master candidate applies -> status PENDING
    const applyRes = await reqJson(baseUrl, 'POST', '/api/copy-trading/apply-master', masterCandidate.tok, {
      name: 'Nusantara Quant Test',
      handle: '@nq_test',
      strategySummary: 'Strategi spot terukur untuk pengujian Copy Trading riil.',
      primaryPair: 'BTC-IDR',
      profitSharePct: 10,
      minCopyUsdt: 25,
    });
    assert.strictEqual(applyRes.status, 201, `Apply master failed: ${JSON.stringify(applyRes.data)}`);
    const newMasterId = applyRes.data.master.id;
    createdMasterIds.push(newMasterId);
    assert.strictEqual(applyRes.data.master.status, 'PENDING');

    // Admin approves new Master
    const approveRes = await reqJson(
      baseUrl,
      'POST',
      '/api/admin/copy-trading/masters/update',
      admin.tok,
      { masterId: newMasterId, status: 'APPROVED' }
    );
    assert.strictEqual(approveRes.status, 200);
    const publicMastersAfter = await reqJson(baseUrl, 'GET', '/api/copy-trading/masters');
    assert(
      publicMastersAfter.data.masters.some((m: any) => m.id === newMasterId && m.status === 'APPROVED'),
      'Approved Master must appear on public leaderboard'
    );
    pass('Master Trader application & Admin approval flow works cleanly');

    // Follower allocates 100 USDT to copy the new Master
    const feeUsdtBefore = BigInt(db.createOrGetAccount(SYSTEM_FEE_ID, 'USDT').balanceAvailable);
    const masterUsdtBefore = BigInt(db.createOrGetAccount(masterCandidate.id, 'USDT').balanceAvailable);
    const followerUsdtBefore = BigInt(db.createOrGetAccount(followerUser.id, 'USDT').balanceAvailable);

    const followRes = await reqJson(baseUrl, 'POST', '/api/copy-trading/follow', followerUser.tok, {
      masterId: newMasterId,
      allocationCurrency: 'USDT',
      amount: '100',
      stopLossPct: 20,
      takeProfitPct: 100,
      maxPerTradePct: 25,
    });
    assert.strictEqual(followRes.status, 201, `Follow failed: ${JSON.stringify(followRes.data)}`);
    const relId = followRes.data.relationship.id;
    createdRelIds.push(relId);

    const followerUsdtAfterFollow = BigInt(db.createOrGetAccount(followerUser.id, 'USDT').balanceAvailable);
    assert.strictEqual(
      followerUsdtBefore - followerUsdtAfterFollow,
      PrecisionMath.parseToUnits('100', 6),
      'Follower Spot balance must decrease by exact 100 USDT atomically'
    );
    pass('Follower allocation atomically transfers 100 USDT into Copy Custody Ledger');

    // Ensure OrderBook has resting Ask at 1,500,000,000 IDR so Master BUY signal fills
    const lpAskForMaster = matchingEngine.placeOrder({
      userId: lpMaker.id,
      pairId: 'BTC-IDR',
      side: 'SELL',
      orderType: 'LIMIT',
      price: PrecisionMath.parseToUnits('1500000000', 2).toString(),
      quantity: PrecisionMath.parseToUnits('0.2', 8).toString(),
    });
    createdOrderIds.push(lpAskForMaster.takerOrder.id);

    // Master executes real BUY signal
    const buySigRes = await reqJson(
      baseUrl,
      'POST',
      '/api/copy-trading/master/signal',
      masterCandidate.tok,
      {
        pairId: 'BTC-IDR',
        side: 'BUY',
        quantity: '0.1',
        orderType: 'MARKET',
      }
    );
    assert.strictEqual(buySigRes.status, 200, `Master BUY signal failed: ${JSON.stringify(buySigRes.data)}`);
    assert(buySigRes.data.mirroredOrdersCount >= 1, 'Follower must receive mirrored BUY execution');

    const myCopiesAfterBuy = await reqJson(baseUrl, 'GET', '/api/copy-trading/my-copies', followerUser.tok);
    assert.strictEqual(myCopiesAfterBuy.status, 200);
    const activeRelView = myCopiesAfterBuy.data.copies.find((c: any) => c.id === relId);
    assert(activeRelView, 'Active relationship must appear in my-copies');
    assert(activeRelView.positions.length > 0, 'Follower copy sleeve must hold open BTC spot position');
    assert(activeRelView.mirroredOrders.some((o: any) => o.side === 'BUY' && o.status === 'FILLED'));
    pass('Master real BUY trade automatically mirrors proportionally to active Follower sleeve');

    // Market price rises +20% (LP places higher bid at 1,800,000,000 IDR) & Master executes SELL signal
    const lpBidHigher = matchingEngine.placeOrder({
      userId: lpMaker.id,
      pairId: 'BTC-IDR',
      side: 'BUY',
      orderType: 'LIMIT',
      price: PrecisionMath.parseToUnits('1800000000', 2).toString(),
      quantity: PrecisionMath.parseToUnits('0.2', 8).toString(),
    });
    createdOrderIds.push(lpBidHigher.takerOrder.id);

    const sellSigRes = await reqJson(
      baseUrl,
      'POST',
      '/api/copy-trading/master/signal',
      masterCandidate.tok,
      {
        pairId: 'BTC-IDR',
        side: 'SELL',
        quantity: '0.1',
        orderType: 'MARKET',
      }
    );
    assert.strictEqual(sellSigRes.status, 200, `Master SELL signal failed: ${JSON.stringify(sellSigRes.data)}`);

    // Stop Copy -> triggers High-Water Mark Profit Share & return to Follower Spot wallet
    const stopRes = await reqJson(baseUrl, 'POST', '/api/copy-trading/stop', followerUser.tok, {
      relationshipId: relId,
    });
    assert.strictEqual(stopRes.status, 200, `Stop copy failed: ${JSON.stringify(stopRes.data)}`);
    const returnedBig = BigInt(stopRes.data.returnedUnits);
    const profitShareBig = BigInt(stopRes.data.profitSharePaidUnits);

    assert(profitShareBig > 0n, 'Master must earn High-Water Mark profit share on profitable exit');
    assert(
      returnedBig > PrecisionMath.parseToUnits('100', 6),
      'Follower must receive back principal + net profit (> 100 USDT)'
    );

    const masterUsdtAfter = BigInt(db.createOrGetAccount(masterCandidate.id, 'USDT').balanceAvailable);
    const feeUsdtAfter = BigInt(db.createOrGetAccount(SYSTEM_FEE_ID, 'USDT').balanceAvailable);
    assert.strictEqual(
      masterUsdtAfter - masterUsdtBefore,
      profitShareBig,
      'Master USDT Spot account must receive exact High-Water Mark profit share'
    );
    assert(feeUsdtAfter > feeUsdtBefore, 'System Fee Pool must receive Copy Trading execution fees');
    pass('Stopping profitable Copy sleeve settles High-Water Mark share to Master, fees to System Fee Pool & returns net profit to Follower');

    // Verify double-entry accounting invariant on every new journal created during tests
    for (const [jId, journal] of db.journalTransactions.entries()) {
      if (journalStartKeys.has(jId)) continue;
      const entries = db.ledgerEntries.filter(e => e.journalTransactionId === jId);
      let debits = 0n;
      let credits = 0n;
      for (const e of entries) {
        if (e.entryType === 'DEBIT') debits += BigInt(e.amount);
        else credits += BigInt(e.amount);
      }
      assert.strictEqual(
        debits,
        credits,
        `Journal ${jId} (${journal.txType}) must satisfy Sum(Debit) === Sum(Credit)`
      );
    }
    pass('Double-entry ledger invariant Sum(Debit) === Sum(Credit) verified across all journals');

    console.log(`\nALL ${passed} TESTS PASSED SUCCESSFULLY!`);
    } finally {
      btcBook.bids.length = 0;
      btcBook.asks.length = 0;
      btcBook.bids.push(...savedBids);
      btcBook.asks.push(...savedAsks);
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));

    // Clean up in-memory test artifacts
    for (const oId of createdOrderIds) db.orders.delete(oId);
    for (const rId of createdRelIds) db.copyRelationships.delete(rId);
    for (const mId of createdMasterIds) db.copyMasters.delete(mId);
    for (const aId of createdAssetIds) db.assets.delete(aId);
    for (const pId of createdPairIds) {
      db.tradingPairs.delete(pId);
      db.markets.delete(pId);
    }
    db.deletedAssetSymbols.delete('ZDEL');
    for (const dk of createdDailyKeys) db.dailyPnlSnapshots.delete(dk);
    for (const tok of createdSessionTokens) db.sessions.delete(tok);
    for (const uId of createdUserIds) {
      db.users.delete(uId);
      // Clean daily snapshots created during test for ephemeral users
      for (const k of Array.from(db.dailyPnlSnapshots.keys())) {
        if (k.startsWith(`${uId}:`)) db.dailyPnlSnapshots.delete(k);
      }
    }
    for (const accId of createdAccountIds) {
      const acc = db.ledgerAccounts.get(accId);
      if (acc) db.accountIndex.delete(`${acc.userId}:${acc.currency}`);
      db.ledgerAccounts.delete(accId);
    }
    for (const jId of Array.from(db.journalTransactions.keys())) {
      if (!journalStartKeys.has(jId)) db.journalTransactions.delete(jId);
    }
    db.ledgerEntries.length = ledgerEntryStartLen;
    db.trades.length = tradeStartLen;
    db.copyMirroredOrders.length = mirroredStartLen;
    db.auditLogs.length = auditStartLen;

    if (btcIdrPair) {
      btcIdrPair.lastPrice = origBtcLastPrice;
      db.tradingPairs.set('BTC-IDR', btcIdrPair);
    }

    // Restore exact original exchange_state.json files on disk
    for (const [p, buf] of diskBackup.entries()) {
      if (buf) {
        fs.writeFileSync(p, buf);
      } else if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
    db.loadFromDisk();
    copyTradingService.stop();
    pnlService.stopScheduler();
  }
}

main().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
