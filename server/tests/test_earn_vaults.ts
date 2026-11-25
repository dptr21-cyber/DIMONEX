/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/tests/test_earn_vaults.ts
 * Comprehensive Automated Verification Suite for DIMONEX Institutional Earn & Staking Vaults.
 */

import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { db, SYSTEM_EARN_CUSTODY_ID, SYSTEM_TREASURY_ID, getExchangeDataDirectory } from '../db/database.js';
import { authRouter } from '../routes/auth.js';
import { earnRouter } from '../routes/earn.js';
import { adminRouter } from '../routes/admin.js';
import { earnService } from '../services/earn/EarnService.js';
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
  console.log(' DIMONEX Institutional Earn & Staking Vaults — Verification Suite');
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
  const createdVaultIds: string[] = [];
  const createdAccountIds: string[] = [];
  const payoutStartLen = db.earnPayouts.length;
  const custodyBeforeUsdt = db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, 'USDT').balanceAvailable;
  const treasuryBeforeUsdt = db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable;

  let passed = 0;
  const pass = (label: string) => {
    passed++;
    console.log(`  [PASS] ${passed}. ${label}`);
  };

  try {
    // 1. Default Vaults strictly backed by real ACTIVE assets in db.assets
    const pub = await reqJson(baseUrl, 'GET', '/api/earn/vaults');
    assert.strictEqual(pub.status, 200);
    assert.ok(Array.isArray(pub.data.vaults) && pub.data.vaults.length >= 5, 'Should have seeded real vaults');
    const activeSymbols = new Set(Array.from(db.assets.values()).filter(a => a.status === 'ACTIVE').map(a => a.symbol));
    for (const v of pub.data.vaults) {
      assert.ok(activeSymbols.has(v.asset), `Vault asset ${v.asset} must be ACTIVE in db.assets`);
      assert.notStrictEqual(v.asset, 'DMX', 'Fake token DMX must not exist');
      assert.notStrictEqual(v.asset, 'BNB', 'Unlisted token BNB must not exist');
    }
    pass('Public catalog vaults strictly match ACTIVE assets in db.assets (zero fake assets)');

    // 2. Auth guards (401 unauth & 403 non-admin)
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/earn/summary')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/earn/subscribe', undefined, { vaultId: 'vault-usdt-flex', amount: '10' })).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/earn/pools')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/earn/assets')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/earn/payouts')).status, 401);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/admin/earn/positions/pos-fake/unlock')).status, 401);
    pass('Auth guards enforce 401 on unauthenticated private/admin Earn endpoints');

    // Create two test users + admin session
    const makeTestUser = (emailPrefix: string, usdtUnits: string) => {
      const id = `usr-test-earn-${crypto.randomUUID().slice(0, 8)}`;
      const salt = db.generateSalt();
      db.users.set(id, {
        id,
        email: `${emailPrefix}-${Date.now()}@dimonex.id`,
        passwordSalt: salt,
        passwordHash: db.hashPassword('TestEarn2026!', salt),
        role: 'USER',
        status: 'active',
        isTotpEnabled: false,
        failedLoginAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      createdUserIds.push(id);
      const acc = db.createOrGetAccount(id, 'USDT', usdtUnits);
      createdAccountIds.push(acc.id);

      const token = `tok-earn-${crypto.randomUUID()}`;
      db.sessions.set(token, {
        token,
        userId: id,
        device: 'test-suite',
        ip: '127.0.0.1',
        expiresAt: Date.now() + 3600_000,
      });
      createdSessionTokens.push(token);
      return { id, token };
    };

    const userA = makeTestUser('earna', PrecisionMath.parseToUnits('2500', 6).toString()); // 2,500 USDT
    const userB = makeTestUser('earnb', PrecisionMath.parseToUnits('50', 6).toString());   // 50 USDT

    const adminToken = `tok-admin-earn-${crypto.randomUUID()}`;
    db.sessions.set(adminToken, {
      token: adminToken,
      userId: 'usr-admin-0000-0000-000000000001',
      device: 'test-suite',
      ip: '127.0.0.1',
      expiresAt: Date.now() + 3600_000,
    });
    createdSessionTokens.push(adminToken);

    // Non-admin blocked from admin earn endpoints
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/earn/pools', userA.token)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/earn/assets', userA.token)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/earn/payouts', userA.token)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', '/api/admin/earn/positions/pos-fake/unlock', userA.token)).status, 403);
    pass('RBAC rejects regular USER on /api/admin/earn/* with 403');

    // 3. Insufficient Spot balance rejection (no fake balance credit)
    const lowRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', userB.token, {
      vaultId: 'vault-usdt-flex',
      amount: '500',
    });
    assert.strictEqual(lowRes.status, 400);
    assert.strictEqual(
      db.getAccount(userB.id, 'USDT')!.balanceAvailable,
      PrecisionMath.parseToUnits('50', 6).toString(),
      'Balance must stay untouched after rejected subscription'
    );
    pass('Insufficient balance subscription is rejected without injecting balance');

    // 4. Atomic Subscription + Idempotency + Live TVL
    const subIdem = `idem-earn-${crypto.randomUUID()}`;
    const subRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', userA.token, {
      vaultId: 'vault-usdt-flex',
      amount: '1000',
      autoCompound: true,
      idempotencyKey: subIdem,
    });
    assert.strictEqual(subRes.status, 201, `Subscribe failed: ${JSON.stringify(subRes.data)}`);
    const pos1Id = subRes.data.position.id;
    createdPositionIds.push(pos1Id);

    // Spot debited by 1,000 USDT, Custody credited by 1,000 USDT
    assert.strictEqual(
      db.getAccount(userA.id, 'USDT')!.balanceAvailable,
      PrecisionMath.parseToUnits('1500', 6).toString()
    );
    assert.strictEqual(
      BigInt(db.getAccount(SYSTEM_EARN_CUSTODY_ID, 'USDT')!.balanceAvailable) - BigInt(custodyBeforeUsdt),
      PrecisionMath.parseToUnits('1000', 6)
    );

    // Replay same idempotencyKey -> must NOT double-debit
    const replayRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', userA.token, {
      vaultId: 'vault-usdt-flex',
      amount: '1000',
      autoCompound: true,
      idempotencyKey: subIdem,
    });
    assert.strictEqual(replayRes.status, 201);
    assert.strictEqual(replayRes.data.position.id, pos1Id);
    assert.strictEqual(
      db.getAccount(userA.id, 'USDT')!.balanceAvailable,
      PrecisionMath.parseToUnits('1500', 6).toString(),
      'Idempotent replay must not debit Spot again'
    );
    pass('Atomic double-entry stake debit & idempotency replay verified');

    // 5. Subscribe non-compound fixed-term position + enforce pool cap via admin-created capped vault
    const createVaultRes = await reqJson(baseUrl, 'POST', '/api/admin/earn/pools', adminToken, {
      asset: 'USDT',
      name: 'Test Capped Fixed 30D',
      type: 'FIXED',
      durationDays: 30,
      apyPct: 14.6, // 1460 bps -> clean exact daily rate: 1460 / 3650000 = 0.0004/day!
      minStakeTokens: '100',
      maxStakeTokens: '600',
      totalCapTokens: '700',
      earlyRedeemAllowed: true,
      earlyRedeemPenaltyPct: 2.0,
      autoCompoundSupported: false,
      isFeatured: false,
    });
    assert.strictEqual(createVaultRes.status, 201, `Create vault failed: ${JSON.stringify(createVaultRes.data)}`);
    const customVaultId = createVaultRes.data.pool.id;
    createdVaultIds.push(customVaultId);

    // Subscribe 500 USDT into custom vault
    const subFixedRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', userA.token, {
      vaultId: customVaultId,
      amount: '500',
      autoCompound: false,
    });
    assert.strictEqual(subFixedRes.status, 201);
    const pos2Id = subFixedRes.data.position.id;
    createdPositionIds.push(pos2Id);

    // Attempting 300 USDT exceeds 700 totalCap (only 200 left)
    const capOverflowRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', userA.token, {
      vaultId: customVaultId,
      amount: '300',
    });
    assert.strictEqual(capOverflowRes.status, 400);
    pass('Admin vault creation & pool capacity cap enforcement verified');

    // 6. Daily UTC Yield Settlement (Auto-Compound vs Standard Accrual + Idempotency)
    const now = Date.now();
    const nextUtcDayMs = now + 86_400_000;
    const settle1 = earnService.runDailyYieldSettlement(nextUtcDayMs);
    assert.ok(settle1.settledPositions >= 2, 'Both active positions should settle 1 UTC day');

    // Check pos2 (500 USDT @ 14.60% APY = 1460 bps -> daily = 500_000_000 * 1460 / 3650000 = 200_000 units = 0.20 USDT!)
    const pos2AfterSettle = db.earnPositions.get(pos2Id)!;
    assert.strictEqual(pos2AfterSettle.accruedYieldUnits, '200000', 'Exact zero-float daily yield should be 0.20 USDT (200000 units)');

    // Re-running on same day must be strictly idempotent
    const settleDup = earnService.runDailyYieldSettlement(nextUtcDayMs);
    assert.strictEqual(settleDup.payoutsCreated, 0, 'Duplicate settlement same UTC day must create 0 payouts');

    // Auto-compound position (pos1) must have grown principalUnits > 1000 USDT
    const pos1AfterSettle = db.earnPositions.get(pos1Id)!;
    assert.ok(BigInt(pos1AfterSettle.principalUnits) > PrecisionMath.parseToUnits('1000', 6), 'Auto-compound must grow principal');
    pass('UTC daily yield settlement zero-float accuracy, auto-compound & replay idempotency verified');

    // 7. Ownership check & Manual Yield Claim
    const stealClaim = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos2Id}/claim`, userB.token);
    assert.strictEqual(stealClaim.status, 400);

    const claimRes = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos2Id}/claim`, userA.token);
    assert.strictEqual(claimRes.status, 200, `Claim failed: ${JSON.stringify(claimRes.data)}`);
    assert.strictEqual(claimRes.data.payout.amountUnits, '200000');
    assert.strictEqual(
      db.getAccount(userA.id, 'USDT')!.balanceAvailable,
      (PrecisionMath.parseToUnits('1000', 6) + 200000n).toString()
    );
    pass('Manual yield claim transfers exact BigInt yield from Treasury & rejects cross-user access');

    // 8. Flexible Partial Redemption & Early Fixed Redemption Penalty
    const partialFlexRes = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos1Id}/redeem`, userA.token, {
      amount: '400',
    });
    assert.strictEqual(partialFlexRes.status, 200, `Partial flexible redeem failed: ${JSON.stringify(partialFlexRes.data)}`);
    assert.strictEqual(partialFlexRes.data.position.status, 'ACTIVE');

    // Redeem remaining flexible principal
    const fullFlexRes = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos1Id}/redeem`, userA.token, {});
    assert.strictEqual(fullFlexRes.status, 200);
    assert.strictEqual(fullFlexRes.data.position.status, 'REDEEMED');

    // Fixed position before maturity rejected without confirmEarlyRedeem
    const fixedNoConfirm = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos2Id}/redeem`, userA.token, {});
    assert.strictEqual(fixedNoConfirm.status, 400);

    // Fixed early redeem WITH confirmEarlyRedeem -> 2% penalty on 500 USDT = 10 USDT penalty, 490 USDT returned
    const fixedEarly = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos2Id}/redeem`, userA.token, {
      confirmEarlyRedeem: true,
    });
    assert.strictEqual(fixedEarly.status, 200, `Fixed early redeem failed: ${JSON.stringify(fixedEarly.data)}`);
    assert.strictEqual(fixedEarly.data.earlyRedemption, true);
    assert.strictEqual(fixedEarly.data.penaltyUnits, PrecisionMath.parseToUnits('10', 6).toString());
    assert.strictEqual(fixedEarly.data.returnedPrincipalUnits, PrecisionMath.parseToUnits('490', 6).toString());
    assert.strictEqual(fixedEarly.data.position.status, 'REDEEMED');
    pass('Flexible partial/full redemption & fixed-term lockup/early-penalty enforcement verified');

    // 9. Admin APY/maxStake/custodyNote update + Assets + Payouts + Compliance Unlock (0% penalty)
    const assetsRes = await reqJson(baseUrl, 'GET', '/api/admin/earn/assets', adminToken);
    assert.strictEqual(assetsRes.status, 200);
    assert.ok(Array.isArray(assetsRes.data.assets) && assetsRes.data.assets.some((a: any) => a.symbol === 'USDT'));

    const updateVaultRes = await reqJson(baseUrl, 'POST', '/api/admin/earn/pools/update', adminToken, {
      poolId: customVaultId,
      apyPct: 9.25,
      maxStakeTokens: '650',
      custodyNote: 'Segregated Audit Verified Vault',
      status: 'ACTIVE',
    });
    assert.strictEqual(updateVaultRes.status, 200);
    assert.strictEqual(updateVaultRes.data.pool.apyBps, 925);
    assert.strictEqual(updateVaultRes.data.pool.maxStakeUnits, PrecisionMath.parseToUnits('650', 6).toString());
    assert.strictEqual(updateVaultRes.data.pool.custodyNote, 'Segregated Audit Verified Vault');

    // Subscribe another fixed position and waive lockup via admin unlock -> verify 0% penalty redemption
    const subFixedUnlockRes = await reqJson(baseUrl, 'POST', '/api/earn/subscribe', userA.token, {
      vaultId: customVaultId,
      amount: '150',
      autoCompound: false,
    });
    assert.strictEqual(subFixedUnlockRes.status, 201);
    const pos3Id = subFixedUnlockRes.data.position.id;
    createdPositionIds.push(pos3Id);

    const unlockRes = await reqJson(baseUrl, 'POST', `/api/admin/earn/positions/${pos3Id}/unlock`, adminToken, {
      reason: 'Institutional audit waiver',
    });
    assert.strictEqual(unlockRes.status, 200, `Unlock failed: ${JSON.stringify(unlockRes.data)}`);
    assert.strictEqual(unlockRes.data.position.status, 'MATURED');
    assert.ok(unlockRes.data.position.maturesAt <= Date.now());

    const zeroPenaltyRedeem = await reqJson(baseUrl, 'POST', `/api/earn/positions/${pos3Id}/redeem`, userA.token, {});
    assert.strictEqual(zeroPenaltyRedeem.status, 200, `Unlocked redeem failed: ${JSON.stringify(zeroPenaltyRedeem.data)}`);
    assert.strictEqual(zeroPenaltyRedeem.data.earlyRedemption, false);
    assert.strictEqual(zeroPenaltyRedeem.data.penaltyUnits, '0');
    assert.strictEqual(zeroPenaltyRedeem.data.returnedPrincipalUnits, PrecisionMath.parseToUnits('150', 6).toString());

    const pauseVaultRes = await reqJson(baseUrl, 'POST', '/api/admin/earn/pools/update', adminToken, {
      poolId: customVaultId,
      status: 'PAUSED',
    });
    assert.strictEqual(pauseVaultRes.status, 200);
    assert.strictEqual(pauseVaultRes.data.pool.status, 'PAUSED');

    const payoutsRes = await reqJson(baseUrl, 'GET', '/api/admin/earn/payouts?limit=50', adminToken);
    assert.strictEqual(payoutsRes.status, 200);
    assert.ok(Array.isArray(payoutsRes.data.payouts) && payoutsRes.data.payouts.length > 0);
    assert.ok(payoutsRes.data.payouts[0].userEmail, 'Admin payouts must include userEmail');
    assert.ok(payoutsRes.data.payouts[0].vaultName, 'Admin payouts must include vaultName');

    const solvRes = await reqJson(baseUrl, 'GET', '/api/admin/earn/solvency', adminToken);
    assert.strictEqual(solvRes.status, 200);
    assert.strictEqual(solvRes.data.isFullySolvent, true, `Earn Custody solvency failed: ${JSON.stringify(solvRes.data)}`);

    const inv = LedgerService.verifyGlobalInvariants();
    assert.strictEqual(inv.isConsistent, true, `Global ledger invariants failed: ${inv.errors.join('; ')}`);
    pass('Admin assets/payouts/update, compliance unlock (0% penalty), 1:1 solvency, and ledger invariants verified');

    // 10. Disk persistence check
    const flushed = db.saveToDisk();
    assert.ok(flushed, 'Database saveToDisk should succeed');
    const dbFile = path.join(getExchangeDataDirectory(), 'exchange_state.json');
    const rawJson = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.ok(Array.isArray(rawJson.earnVaults) && rawJson.earnVaults.length >= 5, 'Persisted snapshot must include earnVaults');
    assert.ok(Array.isArray(rawJson.earnPositions), 'Persisted snapshot must include earnPositions');
    assert.ok(Array.isArray(rawJson.earnPayouts), 'Persisted snapshot must include earnPayouts');
    pass('Disk persistence snapshot round-trip verified for Earn state');

    console.log('\n-------------------------------------------------------------------');
    console.log(` ALL ${passed} EARN & STAKING VAULT TESTS PASSED!`);
    console.log('-------------------------------------------------------------------');
  } finally {
    server.close();
    // Clean up temporary test artifacts so production state stays spotless
    for (const pid of createdPositionIds) db.earnPositions.delete(pid);
    for (const vid of createdVaultIds) db.earnVaults.delete(vid);
    if (db.earnPayouts.length > payoutStartLen) {
      db.earnPayouts.length = payoutStartLen;
    }
    for (const uid of createdUserIds) db.users.delete(uid);
    for (const aid of createdAccountIds) db.ledgerAccounts.delete(aid);
    for (const tok of createdSessionTokens) db.sessions.delete(tok);
    db.createOrGetAccount(SYSTEM_EARN_CUSTODY_ID, 'USDT').balanceAvailable = custodyBeforeUsdt;
    db.createOrGetAccount(SYSTEM_TREASURY_ID, 'USDT').balanceAvailable = treasuryBeforeUsdt;
    db.saveToDisk();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error('\n[FAIL] Test Suite Error:', err);
    process.exit(1);
  });
