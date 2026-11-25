/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/tests/test_treasury_fees_and_staking_claim.ts
 * Automated Verification Suite for Exchange Fee Revenue Monitoring & Fee-Pool-Funded Staking Claims.
 */

import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import {
  db,
  SYSTEM_EARN_CUSTODY_ID,
  SYSTEM_FEE_ID,
  SYSTEM_TREASURY_ID,
} from '../db/database.js';
import { authRouter } from '../routes/auth.js';
import { earnRouter } from '../routes/earn.js';
import { adminRouter } from '../routes/admin.js';
import { earnService } from '../services/earn/EarnService.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { LedgerService } from '../ledger/LedgerService.js';
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
  console.log('===================================================================');
  console.log(' DIMONEX Exchange Fee Monitor & Fee-Funded Staking Earn Test Suite');
  console.log('===================================================================');

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/earn', earnRouter);
  app.use('/api/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdUserIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdPositionIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdOrderIds: string[] = [];

  const payoutStartLen = db.earnPayouts.length;
  const tradeStartLen = db.trades.length;
  const journalStartKeys = new Set(db.journalTransactions.keys());
  const ledgerEntryStartLen = db.ledgerEntries.length;
  const auditStartLen = db.auditLogs.length;

  const feeIdrBefore = db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable;
  const feeUsdtBefore = db.createOrGetAccount(SYSTEM_FEE_ID, 'USDT').balanceAvailable;
  const treasuryIdrBefore = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'IDR').balanceAvailable;
  const treasuryUsdtBefore = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable;
  const custodyIdrBefore = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, 'IDR').balanceAvailable;
  const custodyUsdtBefore = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, 'USDT').balanceAvailable;

  let passed = 0;
  const pass = (label: string) => {
    passed++;
    console.log(`  [PASS] ${passed}. ${label}`);
  };

  try {
    const createTestUser = (role: 'USER' | 'ADMIN', tag: string, idrUnits: string, btcUnits = '0', usdtUnits = '0') => {
      const id = `usr-test-fee-${tag}-${crypto.randomUUID().slice(0, 8)}`;
      const salt = db.generateSalt();
      db.users.set(id, {
        id,
        email: `${tag}-${Date.now()}@dimonex.id`,
        passwordSalt: salt,
        passwordHash: db.hashPassword('TestFee2026!', salt),
        role,
        status: 'active',
        isTotpEnabled: false,
        failedLoginAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      createdUserIds.push(id);
      if (BigInt(idrUnits) > 0n) createdAccountIds.push(db.createOrGetAccount(id, 'IDR', idrUnits).id);
      if (BigInt(btcUnits) > 0n) createdAccountIds.push(db.createOrGetAccount(id, 'BTC', btcUnits).id);
      if (BigInt(usdtUnits) > 0n) createdAccountIds.push(db.createOrGetAccount(id, 'USDT', usdtUnits).id);

      const tok = `tok-test-fee-${crypto.randomUUID()}`;
      db.sessions.set(tok, {
        userId: id,
        token: tok,
        device: 'test-runner',
        ip: '127.0.0.1',
        expiresAt: Date.now() + 3600_000,
      });
      createdSessionTokens.push(tok);
      return { id, token: tok };
    };

    const buyer = createTestUser(
      'USER',
      'buyer',
      PrecisionMath.parseToUnits('2000000000', 2).toString(), // 2B IDR
      '0',
      PrecisionMath.parseToUnits('20000', 6).toString()
    );
    const seller = createTestUser(
      'USER',
      'seller',
      PrecisionMath.parseToUnits('500000000', 2).toString(),
      PrecisionMath.parseToUnits('2', 8).toString(), // 2 BTC
      PrecisionMath.parseToUnits('1000', 6).toString()
    );
    const admin = createTestUser('ADMIN', 'admin', '0');

    // 1. Verify Admin RBAC guard on /api/admin/treasury-fees and /sweep
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/treasury-fees')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/admin/treasury-fees/sweep')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/treasury-fees', buyer.token)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/admin/treasury-fees/sweep', buyer.token)).status, 403);
    pass('Admin /api/admin/treasury-fees and /sweep reject 401 unauthenticated and 403 non-admin requests');

    // Capture baseline report before test trade
    const baselineRes = await reqJson(baseUrl, 'GET', '/api/admin/treasury-fees', admin.token);
    assert.strictEqual(baselineRes.status, 200);
    const baselineFeesIdr = baselineRes.data.summary.totalExchangeFeesIdr;
    const baselineUserFeesIdr = baselineRes.data.summary.userDirectFeesIdr;

    // 2. Execute genuine Spot trade between buyer & seller on isolated TESTFEE-IDR pair so real fees accrue in SYSTEM_FEE_ID (IDR)
    const testPairId = 'TESTFEE-IDR';
    db.tradingPairs.set(testPairId, {
      id: testPairId,
      baseCurrency: 'TESTFEE',
      quoteCurrency: 'IDR',
      baseDecimals: 8,
      quoteDecimals: 2,
      minOrderSize: '100000',
      maxOrderSize: '10000000000',
      makerFeeBps: 10,
      takerFeeBps: 20,
      isActive: true,
      isHalted: false,
      lastPrice: PrecisionMath.parseToUnits('1000000000', 2).toString(), // 1B IDR
      high24h: PrecisionMath.parseToUnits('1000000000', 2).toString(),
      low24h: PrecisionMath.parseToUnits('1000000000', 2).toString(),
      volume24h: '0',
      priceChange24h: '0.00',
    });

    const pair = db.tradingPairs.get(testPairId)!;
    const tradePriceUnits = pair.lastPrice;
    const qtyUnits = PrecisionMath.parseToUnits('1', pair.baseDecimals).toString();
    const sellerTestAcc = db.createOrGetAccount(seller.id, 'TESTFEE', PrecisionMath.parseToUnits('2', 8).toString());
    createdAccountIds.push(sellerTestAcc.id);

    const sellRes = matchingEngine.placeOrder({
      userId: seller.id,
      pairId: testPairId,
      side: 'SELL',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: tradePriceUnits,
      quantity: qtyUnits,
      clientOrderId: `test-sell-${Date.now()}`,
    });
    createdOrderIds.push(sellRes.takerOrder.id);

    const buyRes = matchingEngine.placeOrder({
      userId: buyer.id,
      pairId: testPairId,
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      price: tradePriceUnits,
      quantity: qtyUnits,
      clientOrderId: `test-buy-${Date.now()}`,
    });
    createdOrderIds.push(buyRes.takerOrder.id);

    assert.ok(buyRes.trades.length >= 1, 'Buyer and seller must match in MatchingEngine');
    let tradeFeeUnits = 0n;
    for (const tr of buyRes.trades) {
      tradeFeeUnits += BigInt(tr.makerFee || '0') + BigInt(tr.takerFee || '0');
    }
    assert.ok(tradeFeeUnits > 0n, 'Executed user trade must generate > 0 IDR trading fee');

    const feeAfterTradeIdr = BigInt(db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable);
    assert.strictEqual(
      feeAfterTradeIdr - BigInt(feeIdrBefore),
      tradeFeeUnits,
      'SYSTEM_FEE_ID IDR balance must increase by exact makerFee + takerFee'
    );

    const afterTradeRes = await reqJson(baseUrl, 'GET', '/api/admin/treasury-fees', admin.token);
    assert.strictEqual(afterTradeRes.status, 200);
    const feeDeltaIdr = Math.round(Number(tradeFeeUnits) / 100);
    assert.ok(
      afterTradeRes.data.summary.totalExchangeFeesIdr >= baselineFeesIdr + feeDeltaIdr - 1,
      'totalExchangeFeesIdr must reflect executed user trade fees'
    );
    assert.ok(
      afterTradeRes.data.summary.userDirectFeesIdr >= baselineUserFeesIdr + feeDeltaIdr - 1,
      'userDirectFeesIdr must attribute USER role transaction fees'
    );
    const testPairRow = afterTradeRes.data.byPair.find((p: any) => p.pairId === testPairId);
    assert.ok(testPairRow && BigInt(testPairRow.totalFeesUnits) >= tradeFeeUnits, 'byPair must include TESTFEE-IDR fees');

    const statsRes = await reqJson(baseUrl, 'GET', '/api/admin/stats', admin.token);
    assert.strictEqual(statsRes.status, 200);
    assert.ok(statsRes.data.treasuryFeeSummary, '/api/admin/stats must include treasuryFeeSummary');
    pass('Real Spot trade fees credited to SYSTEM_FEE_ID and surfaced accurately in Admin Monitor APIs');

    // 3. Subscribe buyer to IDR Flexible Staking Vault & claim yield -> MUST draw from SYSTEM_FEE_ID first!
    const idrSubRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', buyer.token, {
      vaultId: 'vault-idr-flex',
      amount: '10000000', // Rp 10,000,000
      autoCompound: false,
    });
    assert.strictEqual(idrSubRes.status, 201, `Subscribe failed: ${JSON.stringify(idrSubRes.data)}`);
    const idrPosId = idrSubRes.data.position.id;
    createdPositionIds.push(idrPosId);

    // Run 1 UTC day yield settlement so accruedYieldUnits > 0n (and < tradeFeeUnits)
    const idrPos = db.earnPositions.get(idrPosId)!;
    const nextDayMs = (idrPos.lastSettlementDayIndex + 1) * 86_400_000 + 60_000;
    earnService.runDailyYieldSettlement(nextDayMs);

    const claimableIdrUnits = BigInt(db.earnPositions.get(idrPosId)!.accruedYieldUnits);
    assert.ok(claimableIdrUnits > 0n, 'IDR staking position must accrue positive daily yield');
    assert.ok(claimableIdrUnits < feeAfterTradeIdr, 'Collected fee in SYS_FEES must cover this full claim');

    const sysFeeBeforeClaim = BigInt(db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable);
    const sysTreasuryBeforeClaim = BigInt(db.createOrGetAccount(SYSTEM_TREASURY_ID, 'IDR').balanceAvailable);

    const claimIdrRes = await reqJson(baseUrl, 'POST', `/api/earn/positions/${idrPosId}/claim`, buyer.token);
    assert.strictEqual(claimIdrRes.status, 200, `Claim failed: ${JSON.stringify(claimIdrRes.data)}`);
    assert.strictEqual(claimIdrRes.data.payout.fundingSource, 'EXCHANGE_FEE_POOL');
    assert.strictEqual(claimIdrRes.data.payout.feeFundedUnits, claimableIdrUnits.toString());
    assert.strictEqual(claimIdrRes.data.payout.treasuryFundedUnits, '0');

    const sysFeeAfterClaim = BigInt(db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable);
    const sysTreasuryAfterClaim = BigInt(db.createOrGetAccount(SYSTEM_TREASURY_ID, 'IDR').balanceAvailable);
    assert.strictEqual(
      sysFeeBeforeClaim - sysFeeAfterClaim,
      claimableIdrUnits,
      'Staking Earn claim must debit SYSTEM_FEE_ID IDR balance directly'
    );
    assert.strictEqual(
      sysTreasuryAfterClaim,
      sysTreasuryBeforeClaim,
      'SYSTEM_TREASURY_ID IDR must remain untouched when Exchange Fee Pool covers full claim'
    );
    pass('Staking Earn yield claim draws 100% from Exchange Fee Pool (SYSTEM_FEE_ID) with zero Treasury drain');

    // 4. Hybrid fallback test: Put a tiny fee balance in USDT SYS_FEES (< claimable USDT yield) and claim
    const usdtFeeSeed = 50_000n; // 0.05 USDT
    const usdtSubRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', buyer.token, {
      vaultId: 'vault-usdt-flex',
      amount: '1000', // 1000 USDT -> daily yield ~ 0.197260 USDT (197260 units)
      autoCompound: false,
    });
    assert.strictEqual(usdtSubRes.status, 201);
    const usdtPosId = usdtSubRes.data.position.id;
    createdPositionIds.push(usdtPosId);

    const usdtPos = db.earnPositions.get(usdtPosId)!;
    earnService.runDailyYieldSettlement((usdtPos.lastSettlementDayIndex + 1) * 86_400_000 + 60_000);
    const claimableUsdtUnits = BigInt(db.earnPositions.get(usdtPosId)!.accruedYieldUnits);
    assert.ok(claimableUsdtUnits > usdtFeeSeed);

    const sysUsdtFeeAcc = db.createOrGetAccount(SYSTEM_FEE_ID, 'USDT');
    sysUsdtFeeAcc.balanceAvailable = usdtFeeSeed.toString();
    const expectedFeeDraw = BigInt(sysUsdtFeeAcc.balanceAvailable);
    const sysUsdtTreasBefore = BigInt(db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable);

    const claimUsdtRes = await reqJson(baseUrl, 'POST', `/api/earn/positions/${usdtPosId}/claim`, buyer.token);
    assert.strictEqual(claimUsdtRes.status, 200);
    assert.strictEqual(claimUsdtRes.data.payout.fundingSource, 'HYBRID_FEE_AND_TREASURY');
    assert.strictEqual(claimUsdtRes.data.payout.feeFundedUnits, expectedFeeDraw.toString());
    assert.strictEqual(claimUsdtRes.data.payout.treasuryFundedUnits, (claimableUsdtUnits - expectedFeeDraw).toString());
    assert.strictEqual(db.createOrGetAccount(SYSTEM_FEE_ID, 'USDT').balanceAvailable, '0');
    assert.strictEqual(
      sysUsdtTreasBefore - BigInt(db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable),
      claimableUsdtUnits - expectedFeeDraw
    );
    pass('Hybrid Fee Pool + Treasury Reserve fallback handles partial fee pool balance safely without overdraft');

    // 5. Verify Sweep remaining Fee Collector balance -> Treasury Reserve preserves fee revenue totals & invariants
    const remainingFeeIdr = BigInt(db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable);
    assert.ok(remainingFeeIdr > 0n, 'Remaining IDR fees must exist before sweep');

    const sweepRes = await reqJson(baseUrl, 'POST', '/api/admin/treasury-fees/sweep', admin.token);
    assert.strictEqual(sweepRes.status, 200, `Sweep failed: ${JSON.stringify(sweepRes.data)}`);
    assert.ok(sweepRes.data.sweptCurrencies.some((c: any) => c.currency === 'IDR'));
    assert.strictEqual(db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable, '0');
    assert.strictEqual(sweepRes.data.overview.summary.feeCollectorLiveIdr, 0);
    assert.ok(
      sweepRes.data.overview.summary.totalExchangeFeesIdr >= afterTradeRes.data.summary.totalExchangeFeesIdr,
      'Historical exchange fee revenue must stay intact after Treasury sweep'
    );
    assert.ok(sweepRes.data.overview.recentStakingClaims.length >= 2, 'recentStakingClaims must record claimed yield payouts');

    const inv = LedgerService.verifyGlobalInvariants();
    assert.strictEqual(inv.isConsistent, true, `Global ledger invariants failed: ${inv.errors.join('; ')}`);
    pass('Admin Sweep Fee -> Treasury executes atomically and passes Global Double-Entry Ledger Invariants');

    console.log('\n-------------------------------------------------------------------');
    console.log(` ALL ${passed} TREASURY FEE & STAKING CLAIM TESTS PASSED!`);
    console.log('-------------------------------------------------------------------');
  } finally {
    server.close();
    db.tradingPairs.delete('TESTFEE-IDR');
    for (const pid of createdPositionIds) db.earnPositions.delete(pid);
    for (const oid of createdOrderIds) db.orders.delete(oid);
    if (db.earnPayouts.length > payoutStartLen) db.earnPayouts.length = payoutStartLen;
    if (db.trades.length > tradeStartLen) db.trades.length = tradeStartLen;
    for (const jid of Array.from(db.journalTransactions.keys())) {
      if (!journalStartKeys.has(jid)) {
        db.journalTransactions.delete(jid);
      }
    }
    for (const [k, v] of Array.from(db.journalIdempotencyIndex.entries())) {
      if (!journalStartKeys.has(v)) db.journalIdempotencyIndex.delete(k);
    }
    if (db.ledgerEntries.length > ledgerEntryStartLen) db.ledgerEntries.length = ledgerEntryStartLen;
    if (db.auditLogs.length > auditStartLen) db.auditLogs.length = auditStartLen;

    for (const uid of createdUserIds) db.users.delete(uid);
    for (const aid of createdAccountIds) db.ledgerAccounts.delete(aid);
    for (const tok of createdSessionTokens) db.sessions.delete(tok);

    db.createOrGetAccount(SYSTEM_FEE_ID, 'IDR').balanceAvailable = feeIdrBefore;
    db.createOrGetAccount(SYSTEM_FEE_ID, 'USDT').balanceAvailable = feeUsdtBefore;
    db.createOrGetAccount(SYSTEM_TREASURY_ID, 'IDR').balanceAvailable = treasuryIdrBefore;
    db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable = treasuryUsdtBefore;
    db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, 'IDR').balanceAvailable = custodyIdrBefore;
    db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, 'USDT').balanceAvailable = custodyUsdtBefore;
    db.saveToDisk();
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n[FAIL] Test Suite Error:', err);
    process.exit(1);
  });
