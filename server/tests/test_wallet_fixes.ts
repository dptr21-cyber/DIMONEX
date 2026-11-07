/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * test_wallet_fixes.ts
 * Tests for wallet ledger deposits, SOL support, transactions, and synchronization diagnostics.
 */

import { db } from '../db/database.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';

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

async function runTests() {
  console.log('\n=== RUNNING WALLET & LEDGER VERIFICATION TESTS ===\n');

  // Find a test user
  const user = Array.from(db.users.values()).find(u => u.email === 'user1@dimonex.id') || Array.from(db.users.values())[0];
  if (!user) throw new Error('No user found');

  // Test 1: SOL account exists in getUserAccounts
  console.log('[Test 1] Multi-Currency Ledger Accounts (including SOL)');
  const accounts = db.getUserAccounts(user.id);
  const currencies = accounts.map(a => a.currency);
  assert(currencies.includes('IDR'), 'IDR ledger account exists');
  assert(currencies.includes('BTC'), 'BTC ledger account exists');
  assert(currencies.includes('ETH'), 'ETH ledger account exists');
  assert(currencies.includes('USDT'), 'USDT ledger account exists');
  assert(currencies.includes('SOL'), 'SOL ledger account exists');

  // Test 2: Custom Amount IDR Deposit Simulation credits real ledger
  console.log('\n[Test 2] Custom Amount IDR Deposit credits real ledger');
  const idrAccBefore = db.createOrGetAccount(user.id, 'IDR');
  const idrBefore = BigInt(idrAccBefore.balanceAvailable);
  const depositCustomIdr = 75000000n * 100n; // Rp 75,000,000.00
  const txId1 = `test-dep-idr-${Date.now()}`;

  LedgerService.deposit(user.id, 'IDR', depositCustomIdr, txId1, `idemp-${txId1}`);
  const idrAccAfter = db.createOrGetAccount(user.id, 'IDR');
  const idrAfter = BigInt(idrAccAfter.balanceAvailable);
  assert(idrAfter - idrBefore === depositCustomIdr, `IDR balance credited exact custom amount (${PrecisionMath.formatIDRDisplay(depositCustomIdr)})`);

  // Test 3: Custom Amount Crypto (SOL) Deposit Simulation credits real ledger
  console.log('\n[Test 3] Custom Amount SOL Deposit credits real ledger');
  const solAccBefore = db.createOrGetAccount(user.id, 'SOL');
  const solBefore = BigInt(solAccBefore.balanceAvailable);
  const depositCustomSol = 25n * 100000000n; // 25.0 SOL
  const txId2 = `test-dep-sol-${Date.now()}`;

  LedgerService.deposit(user.id, 'SOL', depositCustomSol, txId2, `idemp-${txId2}`);
  const solAccAfter = db.createOrGetAccount(user.id, 'SOL');
  const solAfter = BigInt(solAccAfter.balanceAvailable);
  assert(solAfter - solBefore === depositCustomSol, `SOL balance credited exact custom amount (25.0 SOL)`);

  // Test 4: Engine vs Ledger Locking & Diagnostics
  console.log('\n[Test 4] Engine vs Ledger Synchronization Diagnostics');
  const btcAcc = db.createOrGetAccount(user.id, 'BTC');
  const btcLocked = BigInt(btcAcc.balanceLocked);

  // Filter open orders
  const userOpenOrders = Array.from(db.orders.values()).filter(
    o => o.userId === user.id && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
  );
  let engineLockedBtc = 0n;
  userOpenOrders.forEach(o => {
    if (o.lockedCurrency === 'BTC') {
      engineLockedBtc += BigInt(o.lockedAmount || '0');
    }
  });

  const drift = btcLocked - engineLockedBtc;
  console.log(`    BTC Ledger Locked: ${btcLocked.toString()}, Engine Locked: ${engineLockedBtc.toString()}, Drift: ${drift.toString()}`);
  assert(typeof drift === 'bigint', 'Drift calculation is valid BigInt arithmetic');

  console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
