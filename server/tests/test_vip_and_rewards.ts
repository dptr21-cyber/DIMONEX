/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/tests/test_vip_and_rewards.ts
 * Automated End-to-End & Financial Integrity Verification Suite for
 * DIMONEX Institutional VIP, Dynamic Trader Task Center, Redeemable Vouchers,
 * Dedicated Rewards History API, Admin Management Console & Referral System.
 */

import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { db, SYSTEM_TREASURY_ID } from '../db/database.js';
import { authRouter } from '../routes/auth.js';
import { rewardsRouter } from '../routes/rewards.js';
import { rewardsAdminRouter } from '../routes/rewardsAdmin.js';
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
  console.log(' DIMONEX Institutional VIP, Tasks, Vouchers & History — Test Suite');
  console.log('===================================================================');

  const treasuryUsdtBefore = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable;
  const createdUserIds: string[] = [];
  const createdSessionTokens: string[] = [];
  const createdTradeIds: string[] = [];
  const createdJournalIds: string[] = [];
  const createdAccountIds: string[] = [];
  const createdClaimKeys: string[] = [];
  const createdPayoutIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdVoucherIds: string[] = [];
  const createdRedemptionKeys: string[] = [];

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/rewards', rewardsRouter);
  app.use('/api/admin/rewards', rewardsAdminRouter);

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
    assert.ok(sched.data.taskCatalog.length >= 6);
    pass('Public /api/rewards/schedule returns 7 VIP tiers and active dynamic tasks without auth');

    // 2. Unauthenticated summary, history, and admin routes rejected (401)
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/rewards/summary')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/rewards/history')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/rewards/overview')).status, 401);
    pass('Unauthenticated summary, history, and admin rewards endpoints strictly return 401');

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

    // 4. Reject claiming ineligible task & non-admin access to admin endpoints
    const badClaim = await reqJson(baseUrl, 'POST', '/api/rewards/tasks/SECURITY_2FA/claim', tokenA);
    assert.strictEqual(badClaim.status, 400);

    const nonAdminBlock = await reqJson(baseUrl, 'GET', '/api/admin/rewards/overview', tokenA);
    assert.strictEqual(nonAdminBlock.status, 403);
    pass('Ineligible task claim rejected (400) and non-admin blocked from /api/admin/rewards/* (403)');

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
      price: '60000000000',
      quantity: '100000000',
      quoteVolume: '60000000000', // 60,000 USDT
      makerFee: '60000000',
      takerFee: '120000000', // 120 USDT fee paid by User B
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

    const sumA1 = await reqJson(baseUrl, 'GET', '/api/rewards/summary', tokenA);
    assert.strictEqual(sumA1.status, 200);
    assert.strictEqual(sumA1.data.referral.totalReferees, 1);
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
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/rewards/referral/claim', tokenA)).status, 400);
    pass('Referral commission payout settles atomically to USDT wallet and prevents duplicate payout');

    // 11. Admin Task Center CRUD + Dynamic Evaluation + Audit-Preserving Delete
    const adminEmail = `vip-admin-${suffix}@dimonex.test`;
    const regAdmin = await reqJson(baseUrl, 'POST', '/api/auth/register', undefined, {
      email: adminEmail,
      password: 'Password123!'
    });
    assert.strictEqual(regAdmin.status, 200);
    const adminUserId = regAdmin.data.user.id;
    const adminToken = regAdmin.data.token;
    createdUserIds.push(adminUserId);
    createdSessionTokens.push(adminToken);
    db.users.get(adminUserId)!.role = 'ADMIN';

    const customTaskId = `CUSTOM_SPOT_${suffix.toUpperCase()}`;
    const createTaskRes = await reqJson(baseUrl, 'POST', '/api/admin/rewards/tasks', adminToken, {
      id: customTaskId,
      title: 'Trade $10,000 Cumulative Spot',
      description: 'Execute $10,000 cumulative spot volume for instant USDT rebate.',
      category: 'TRADING',
      ruleType: 'SPOT_VOLUME_USDT',
      targetValue: 10000,
      rewardAmountUsdt: 35,
      actionLabel: 'Trade Spot',
      actionView: 'TRADE',
      isActive: true
    });
    assert.strictEqual(createTaskRes.status, 201);
    createdTaskIds.push(customTaskId);

    // Update reward from 35 -> 40 USDT
    const patchTaskRes = await reqJson(
      baseUrl,
      'PATCH',
      `/api/admin/rewards/tasks/${customTaskId}`,
      adminToken,
      { rewardAmountUsdt: 40 }
    );
    assert.strictEqual(patchTaskRes.status, 200);
    assert.strictEqual(patchTaskRes.data.task.rewardAmountUsdt, 40);

    // User B ($60k spot volume) claims dynamic custom task -> +40 USDT
    const bUsdtBeforeTask = BigInt(db.createOrGetAccount(userBId, 'USDT').balanceAvailable);
    const claimCustomRes = await reqJson(
      baseUrl,
      'POST',
      `/api/rewards/tasks/${customTaskId}/claim`,
      tokenB
    );
    assert.strictEqual(claimCustomRes.status, 200);
    createdClaimKeys.push(`${userBId}:${customTaskId}`);
    createdJournalIds.push(claimCustomRes.data.claim.journalId);
    const bUsdtAfterTask = BigInt(db.createOrGetAccount(userBId, 'USDT').balanceAvailable);
    assert.strictEqual(bUsdtAfterTask - bUsdtBeforeTask, 40_000_000n);

    // Deleting a task with existing claims must preserve audit trail (archive/pause instead of hard delete)
    const delUsedTask = await reqJson(
      baseUrl,
      'DELETE',
      `/api/admin/rewards/tasks/${customTaskId}`,
      adminToken
    );
    assert.strictEqual(delUsedTask.status, 200);
    assert.strictEqual(delUsedTask.data.archived, true);
    assert.strictEqual(delUsedTask.data.deleted, false);
    pass('Admin Task CRUD creates, updates, settles dynamic task (+40 USDT), and preserves claimed task audit');

    // 12. Admin Voucher CRUD + VIP-Gated Atomic Redemption + Anti-Abuse Checks
    const voucherCode = `VIP1_${suffix.toUpperCase()}`;
    const createVoucherRes = await reqJson(baseUrl, 'POST', '/api/admin/rewards/vouchers', adminToken, {
      code: voucherCode,
      title: 'VIP 1 Exclusive Bonus Voucher',
      description: 'Exclusive 50 USDT bonus for VIP 1+ institutional traders.',
      voucherType: 'USDT_BONUS',
      rewardAmountUsdt: 50,
      minVipLevel: 1,
      maxRedemptions: 1,
      expiresAt: Date.now() + 86_400_000,
      isActive: true
    });
    assert.strictEqual(createVoucherRes.status, 201);
    const voucherId = createVoucherRes.data.voucher.id;
    createdVoucherIds.push(voucherId);

    // User A (V0) must be blocked by minVipLevel = 1
    const v0Redeem = await reqJson(baseUrl, 'POST', '/api/rewards/vouchers/redeem', tokenA, {
      code: voucherCode
    });
    assert.strictEqual(v0Redeem.status, 400);

    // User B (VIP 1) redeems voucher -> +50 USDT settled atomically
    const bUsdtBeforeVoucher = BigInt(db.createOrGetAccount(userBId, 'USDT').balanceAvailable);
    const vip1Redeem = await reqJson(baseUrl, 'POST', '/api/rewards/vouchers/redeem', tokenB, {
      code: voucherCode
    });
    assert.strictEqual(vip1Redeem.status, 200);
    assert.strictEqual(vip1Redeem.data.redemption.status, 'SETTLED');
    createdRedemptionKeys.push(`${userBId}:${voucherId}`);
    createdJournalIds.push(vip1Redeem.data.redemption.journalId);

    const bUsdtAfterVoucher = BigInt(db.createOrGetAccount(userBId, 'USDT').balanceAvailable);
    assert.strictEqual(bUsdtAfterVoucher - bUsdtBeforeVoucher, 50_000_000n);

    // Double redemption by User B blocked (400)
    const dupRedeem = await reqJson(baseUrl, 'POST', '/api/rewards/vouchers/redeem', tokenB, {
      code: voucherCode
    });
    assert.strictEqual(dupRedeem.status, 400);

    // Verify voucher journal balances
    const vEntries = db.ledgerEntries.filter(e => e.journalId === vip1Redeem.data.redemption.journalId);
    const vDeb = vEntries.filter(e => e.entryType === 'DEBIT').reduce((s, e) => s + BigInt(e.amount), 0n);
    const vCred = vEntries.filter(e => e.entryType === 'CREDIT').reduce((s, e) => s + BigInt(e.amount), 0n);
    assert.strictEqual(vDeb, 50_000_000n);
    assert.strictEqual(vCred, 50_000_000n);

    // Unused voucher hard-deletes cleanly
    const unusedCode = `UNUSED_${suffix.toUpperCase()}`;
    const createUnused = await reqJson(baseUrl, 'POST', '/api/admin/rewards/vouchers', adminToken, {
      code: unusedCode,
      title: 'Temporary Test Voucher',
      voucherType: 'FEE_REBATE',
      rewardAmountUsdt: 5,
      minVipLevel: 0,
      maxRedemptions: 10
    });
    assert.strictEqual(createUnused.status, 201);
    const delUnused = await reqJson(
      baseUrl,
      'DELETE',
      `/api/admin/rewards/vouchers/${createUnused.data.voucher.id}`,
      adminToken
    );
    assert.strictEqual(delUnused.status, 200);
    assert.strictEqual(delUnused.data.deleted, true);
    pass('Admin Voucher CRUD enforces VIP tier gate, settles +50 USDT atomically, and blocks duplicate redemptions');

    // 13. Dedicated GET /api/rewards/history API with filtering, pagination & strict IDOR isolation
    const histA = await reqJson(baseUrl, 'GET', '/api/rewards/history?type=ALL&page=1&limit=10', tokenA);
    assert.strictEqual(histA.status, 200);
    assert.strictEqual(histA.data.summary.totalCount, 2, 'User A must have 1 task + 1 referral payout');
    assert.strictEqual(histA.data.summary.voucherCount, 0, 'User A must never see User B voucher redemption');
    assert.strictEqual(histA.data.summary.totalSettledUsdt, 34);
    assert.ok(histA.data.items.every((i: any) => i.status === 'SETTLED' && typeof i.claimedAt === 'number'));

    const histB = await reqJson(
      baseUrl,
      'GET',
      '/api/rewards/history?type=VOUCHER_REDEMPTION&page=1&limit=10',
      tokenB
    );
    assert.strictEqual(histB.status, 200);
    assert.strictEqual(histB.data.items.length, 1);
    assert.strictEqual(histB.data.items[0].code, voucherCode);
    assert.strictEqual(histB.data.items[0].amountUsdt, 50);
    assert.strictEqual(histB.data.summary.totalCount, 2, 'User B has 1 custom task + 1 voucher');
    pass('GET /api/rewards/history returns filtered, paginated, SETTLED records with strict per-user isolation');

    // 14. Admin Global Overview & Searchable Settlement Ledger
    const adminOv = await reqJson(baseUrl, 'GET', '/api/admin/rewards/overview', adminToken);
    assert.strictEqual(adminOv.status, 200);
    assert.ok(adminOv.data.totals.totalSettlements >= 4);

    const adminHistSearch = await reqJson(
      baseUrl,
      'GET',
      `/api/admin/rewards/history?search=${encodeURIComponent(voucherCode)}`,
      adminToken
    );
    assert.strictEqual(adminHistSearch.status, 200);
    assert.strictEqual(adminHistSearch.data.items.length, 1);
    assert.strictEqual(adminHistSearch.data.items[0].userEmail, emailB);
    pass('Admin /api/admin/rewards/overview & /history return live global totals and searchable payout ledger');

    console.log('-------------------------------------------------------------------');
    console.log(` ALL ${passed} VIP, TASK CENTER, VOUCHER & HISTORY TESTS PASSED!`);
    console.log('-------------------------------------------------------------------');
  } finally {
    // Clean up all synthetic test records so disk snapshot & ledger invariants remain pristine
    const tradeIdSet = new Set(createdTradeIds);
    const journalIdSet = new Set(createdJournalIds);
    const userIdSet = new Set(createdUserIds);

    db.trades = db.trades.filter(t => !tradeIdSet.has(t.id));
    for (const k of createdClaimKeys) db.rewardClaims.delete(k);
    for (const k of createdRedemptionKeys) db.voucherRedemptions.delete(k);
    for (const pid of createdPayoutIds) db.referralPayouts.delete(pid);
    for (const tid of createdTaskIds) db.rewardTasks.delete(tid);
    for (const vid of createdVoucherIds) db.rewardVouchers.delete(vid);
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
    db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable = treasuryUsdtBefore;
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
