/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/tests/test_vip_and_rewards.ts
 * Automated End-to-End & Financial Integrity Verification Suite for
 * DIMONEX Institutional VIP, Trader Rewards & Referral Commission System.
 */

import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { db } from '../db/database.js';
import { authRouter } from '../routes/auth.js';
import { rewardsRouter } from '../routes/rewards.js';
import { vipRewardsService } from '../services/rewards/VipRewardsService.js';

async function reqJson(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
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
  console.log(' DIMONEX Institutional VIP & Rewards — Automated Verification');
  console.log('===================================================================');

  const createdUserIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdTradeIds: string[] = [];
  const createdJournalIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdClaimKeys: string[] = [];
  const createdPayoutIds: string[] = [];

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/rewards', rewardsRouter);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  const pass = (label: string) => {
    passed++;
    console.log(`  [PASS] ${passed}. ${label}`);
  };

  try {
    // 1. Public schedule accessible without auth
    const sched = await reqJson(baseUrl, 'GET', '/api/rewards/schedule');
    assert.strictEqual(sched.status, 200);
    assert.strictEqual(sched.data.vipTiers.length, 7);
    assert.strictEqual(sched.data.taskCatalog.length, 6);
    pass('Public /api/rewards/schedule returns 7 VIP tiers and 6 real tasks without auth');

    // 2. Unauthenticated summary rejected (401)
    const unauth = await reqJson(baseUrl, 'GET', '/api/rewards/summary');
    assert.strictEqual(unauth.status, 401);
    pass('Unauthenticated /api/rewards/summary returns 401');

    // 3. Register fresh User A -> verify zero mock numbers
    const suffix = crypto.randomUUID().slice(0, 8);
    const emailA = `vip-test-a-${suffix}@dimonex.test`;
    const regA = await reqJson(baseUrl, 'POST', '/api/auth/register', undefined, {
      email: emailA,
      password: 'Password123!'
    });
    assert.strictEqual(regA.status, 200);
    const userAId = regA.data.user.id;
    const tokenA = regA.data.token;
    createdUserIds.push(userAId);
    createdSessionTokens.push(tokenA);

    const sumA0 = await reqJson(baseUrl, 'GET', '/api/rewards/summary', tokenA);
    assert.strictEqual(sumA0.status, 200);
    assert.strictEqual(sumA0.data.vip.currentTier.level, 0);
    assert.strictEqual(sumA0.data.vip.volume30dUsdt, 0);
    assert.strictEqual(sumA0.data.referral.totalReferees, 0);
    assert.strictEqual(sumA0.data.referral.claimableCommissionUsdt, 0);
    assert.ok(/^DMX-[A-Z0-9]{6}$/.test(sumA0.data.referral.referralCode));
    pass('Fresh user starts at Regular (V0) with $0 real volume, 0 referees, and unique DMX code');

    // 4. Reject claiming ineligible task
    const badClaim = await reqJson(baseUrl, 'POST', '/api/rewards/tasks/SECURITY_2FA/claim', tokenA);
    assert.strictEqual(badClaim.status, 400);
    pass('Claiming uncompleted SECURITY_2FA task is strictly rejected (400)');

    // 5. Enable 2FA on User A -> task becomes READY -> claim credits real 10 USDT to ledger
    const dbUserA = db.users.get(userAId)!;
    dbUserA.isTotpEnabled = true;

    const usdtBefore = BigInt(db.createOrGetAccount(userAId, 'USDT').balanceAvailable);
    const claimRes = await reqJson(baseUrl, 'POST', '/api/rewards/tasks/SECURITY_2FA/claim', tokenA);
    assert.strictEqual(claimRes.status, 200);
    assert.strictEqual(claimRes.data.success, true);
    createdClaimKeys.push(`${userAId}:SECURITY_2FA`);
    createdJournalIds.push(claimRes.data.claim.journalId);

    const usdtAfter = BigInt(db.createOrGetAccount(userAId, 'USDT').balanceAvailable);
    assert.strictEqual(usdtAfter - usdtBefore, 10_000_000n, 'Must credit exact 10.000000 USDT');

    // Verify double-entry journal balances to zero
    const jEntries = db.ledgerEntries.filter(e => e.journalId === claimRes.data.claim.journalId);
    const sumDeb = jEntries.filter(e => e.entryType === 'DEBIT').reduce((s, e) => s + BigInt(e.amount), 0n);
    const sumCred = jEntries.filter(e => e.entryType === 'CREDIT').reduce((s, e) => s + BigInt(e.amount), 0n);
    assert.strictEqual(sumDeb, 10_000_000n);
    assert.strictEqual(sumCred, 10_000_000n);
    pass('Eligible SECURITY_2FA claim atomically credits +10 USDT with balanced double-entry journal');

    // 6. Double-claim blocked
    const dupClaim = await reqJson(baseUrl, 'POST', '/api/rewards/tasks/SECURITY_2FA/claim', tokenA);
    assert.strictEqual(dupClaim.status, 400);
    assert.strictEqual(BigInt(db.createOrGetAccount(userAId, 'USDT').balanceAvailable), usdtAfter);
    pass('Duplicate claim on already-claimed task is blocked without double crediting');

    // 7. Self-referral & invalid code on registration rejected without orphan user
    const selfRef = await reqJson(baseUrl, 'POST', '/api/rewards/referral/apply', tokenA, {
      referralCode: sumA0.data.referral.referralCode
    });
    assert.strictEqual(selfRef.status, 400);

    const badRefEmail = `vip-badref-${suffix}@dimonex.test`;
    const badReg = await reqJson(baseUrl, 'POST', '/api/auth/register', undefined, {
      email: badRefEmail,
      password: 'Password123!',
      referralCode: 'DMX-NOTREAL'
    });
    assert.strictEqual(badReg.status, 400);
    assert.strictEqual(
      Array.from(db.users.values()).some(u => u.email === badRefEmail),
      false,
      'Failed registration with invalid referral code must not create orphan user'
    );
    pass('Self-referral and invalid referral codes rejected cleanly with zero orphan accounts');

    // 8. Register Referee User B with User A's real referral code & verify circular referral block
    const emailB = `vip-test-b-${suffix}@dimonex.test`;
    const regB = await reqJson(baseUrl, 'POST', '/api/auth/register', undefined, {
      email: emailB,
      password: 'Password123!',
      referralCode: sumA0.data.referral.referralCode
    });
    assert.strictEqual(regB.status, 200);
    const userBId = regB.data.user.id;
    const tokenB = regB.data.token;
    createdUserIds.push(userBId);
    createdSessionTokens.push(tokenB);

    const codeB = vipRewardsService.ensureUserReferralCode(userBId);
    const circularRes = await reqJson(baseUrl, 'POST', '/api/rewards/referral/apply', tokenA, {
      referralCode: codeB
    });
    assert.strictEqual(circularRes.status, 400);
    pass('Referee registration binds referral attribution and blocks circular A->B->A loops');

    // 9. Record a real $60,000 BTC-USDT trade for Referee B -> upgrades B to VIP 1 & accrues 20% commission for A
    const syntheticTradeId = `test-trd-${crypto.randomUUID()}`;
    db.trades.push({
      id: syntheticTradeId,
      pairId: 'BTC-USDT',
      makerOrderId: 'test-maker-ord',
      takerOrderId: 'test-taker-ord',
      makerUserId: 'sys-mm-counterparty',
      takerUserId: userBId,
      price: '60000000000', // $60,000.000000
      quantity: '100000000', // 1.0 BTC
      quoteVolume: '60000000000', // 60,000 USDT (6 decimals)
      makerFee: '60000000', // 60 USDT
      takerFee: '120000000', // 120 USDT (0.20% taker fee paid by User B)
      takerSide: 'BUY',
      createdAt: Date.now()
    });
    createdTradeIds.push(syntheticTradeId);

    const sumB = await reqJson(baseUrl, 'GET', '/api/rewards/summary', tokenB);
    assert.strictEqual(sumB.status, 200);
    assert.strictEqual(sumB.data.vip.currentTier.level, 1, 'User B with $60k 30d volume must unlock VIP 1');
    assert.strictEqual(sumB.data.vip.volume30dUsdt, 60000);
    const spotTaskB = sumB.data.tasks.items.find((t: any) => t.id === 'FIRST_SPOT_TRADE');
    const vip1TaskB = sumB.data.tasks.items.find((t: any) => t.id === 'SPOT_VOLUME_50K');
    assert.strictEqual(spotTaskB.status, 'READY');
    assert.strictEqual(vip1TaskB.status, 'READY');

    // User A (Regular, 20% rebate) earns 20% of $120 fee = $24.0000 USDT
    const sumA1 = await reqJson(baseUrl, 'GET', '/api/rewards/summary', tokenA);
    assert.strictEqual(sumA1.status, 200);
    assert.strictEqual(sumA1.data.referral.totalReferees, 1);
    assert.strictEqual(sumA1.data.referral.activeReferees, 1);
    assert.strictEqual(sumA1.data.referral.totalCommissionEarnedUsdt, 24);
    assert.strictEqual(sumA1.data.referral.claimableCommissionUsdt, 24);
    pass('Real trade upgrades Referee to VIP 1 and accrues exact 20% ($24 USDT) commission for Referrer');

    // 10. User A claims $24 USDT referral commission -> credited to real USDT ledger & claimable drops to 0
    const beforeRefClaim = BigInt(db.createOrGetAccount(userAId, 'USDT').balanceAvailable);
    const refClaimRes = await reqJson(baseUrl, 'POST', '/api/rewards/referral/claim', tokenA);
    assert.strictEqual(refClaimRes.status, 200);
    createdPayoutIds.push(refClaimRes.data.payout.id);
    createdJournalIds.push(refClaimRes.data.payout.journalId);

    const afterRefClaim = BigInt(db.createOrGetAccount(userAId, 'USDT').balanceAvailable);
    assert.strictEqual(afterRefClaim - beforeRefClaim, 24_000_000n, 'Must credit exact 24.000000 USDT');
    assert.strictEqual(refClaimRes.data.summary.referral.claimableCommissionUsdt, 0);

    // Immediate second claim must fail (0 claimable)
    const dupRefClaim = await reqJson(baseUrl, 'POST', '/api/rewards/referral/claim', tokenA);
    assert.strictEqual(dupRefClaim.status, 400);
    pass('Referral commission payout settles atomically to USDT wallet and prevents duplicate payout');

    console.log('-------------------------------------------------------------------');
    console.log(` ALL ${passed} VIP & REWARDS TESTS PASSED SUCCESSFULLY!`);
    console.log('-------------------------------------------------------------------');
  } finally {
    // Clean up all synthetic test records so disk snapshot remains completely pristine
    const tradeIdSet = new Set(createdTradeIds);
    const journalIdSet = new Set(createdJournalIds);
    const userIdSet = new Set(createdUserIds);

    db.trades = db.trades.filter(t => !tradeIdSet.has(t.id));
    for (const k of createdClaimKeys) db.rewardClaims.delete(k);
    for (const pid of createdPayoutIds) db.referralPayouts.delete(pid);
    for (const uid of createdUserIds) {
      db.referralRelations.delete(uid);
      for (const acc of db.getUserAccounts(uid)) {
        createdAccountIds.push(acc.id);
      }
      db.users.delete(uid);
    }
    for (const accId of createdAccountIds) {
      const acc = db.ledgerAccounts.get(accId);
      if (acc) {
        db.accountIndex.delete(`${acc.userId}:${acc.currency}`);
        db.ledgerAccounts.delete(accId);
      }
    }
    for (const jid of createdJournalIds) {
      const j = db.journalTransactions.get(jid);
      if (j) db.journalIdempotencyIndex.delete(j.idempotencyKey);
      db.journalTransactions.delete(jid);
    }
    db.ledgerEntries = db.ledgerEntries.filter(e => !journalIdSet.has(e.journalId));
    for (const tok of createdSessionTokens) db.sessions.delete(tok);
    db.auditLogs = db.auditLogs.filter(l => !userIdSet.has(l.actorId));
    db.saveToDisk();

    await new Promise<void>(resolve => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('VIP & REWARDS TEST SUITE FAILED:', err);
    process.exit(1);
  });
