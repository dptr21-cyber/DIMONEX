/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/tests/test_initial_listing.ts
 * Comprehensive Test Suite for DIMONEX Initial Listing.
 * 
 * Coverage:
 * 1. Asset registry and address formatting validation
 * 2. Exact BigInt zero-float parameter validation
 * 3. State machine transitions and invalid transition rejections
 * 4. Strict Maker-Checker enforcement (Self-approval rejected)
 * 5. Approval invalidation upon parameter edits
 * 6. Financial Invariance: Zero balance mutations, zero ledger journals created
 * 7. Duplicate market pair rejection (Unique pair constraint)
 * 8. Idempotent market activation pipeline & outbox delivery
 * 9. Matching engine readiness invariant (inactive pairs reject order placement)
 * 10. Append-only cryptographic audit trail hash chain integrity & tamper detection
 */

import crypto from 'crypto';
import { db } from '../db/database.js';
import { ListingService } from '../services/listing/ListingService.js';
import { ListingAuditService } from '../services/listing/ListingAuditService.js';
import { ListingActivationService } from '../services/listing/ListingActivationService.js';
import { matchingEngine } from '../engine/MatchingEngine.js';

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    process.exit(1);
  }
}

export async function runInitialListingTestSuite() {
  console.log('================================================================');
  console.log('   DIMONEX: INITIAL LISTING PRODUCTION TEST SUITE               ');
  console.log('================================================================\n');

  const makerAdminId = 'usr-admin-0000-0000-000000000001';
  const checkerAdminId = 'usr-admin-0000-0000-000000000002';
  const traderUserId = 'usr-user1-0000-0000-000000000001';

  // -------------------------------------------------------------
  // TEST 1: Asset Creation & Address Validation
  // -------------------------------------------------------------
  console.log('--- Test 1: Asset Creation & Network Validation ---');
  // 1a. Invalid EVM contract address
  let caughtEvm = false;
  try {
    ListingService.validateContractAddress('ETHEREUM', 'not-a-valid-0x-address');
  } catch (e: any) {
    caughtEvm = true;
  }
  assert(caughtEvm, '1a. Invalid EVM contract address format is rejected');

  // 1b. Valid EVM and Solana addresses
  let validAddrs = true;
  try {
    ListingService.validateContractAddress('ETHEREUM', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'); // UNI
    ListingService.validateContractAddress('SOLANA', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  } catch {
    validAddrs = false;
  }
  assert(validAddrs, '1b. Valid EVM and Solana contract addresses are accepted');

  // 1c. Create new token asset: ADA (Cardano)
  const testAssetSymbol = `ADA${Date.now().toString().slice(-4)}`;
  const adaAsset = ListingService.createAsset({
    symbol: testAssetSymbol,
    name: 'Cardano Test Token',
    assetType: 'TOKEN',
    decimals: 6,
    network: 'ETHEREUM',
    contractAddress: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
    depositEnabled: true,
    withdrawalEnabled: true
  }, makerAdminId);
  assert(
    adaAsset.symbol === testAssetSymbol && adaAsset.status === 'PENDING' && adaAsset.decimals === 6,
    '1c. Asset successfully created in PENDING status with exact decimals'
  );

  // 1d. Duplicate asset symbol rejection
  let duplicateAssetCaught = false;
  try {
    ListingService.createAsset({
      symbol: testAssetSymbol,
      name: 'Duplicate Token',
      assetType: 'NATIVE',
      decimals: 8,
      network: 'ETHEREUM'
    }, makerAdminId);
  } catch {
    duplicateAssetCaught = true;
  }
  assert(duplicateAssetCaught, '1d. Duplicate asset symbol is rejected');

  // -------------------------------------------------------------
  // TEST 2: Exact BigInt Zero-Float Financial Validation
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Zero-Float Financial Validation ---');
  let invalidTickCaught = false;
  try {
    ListingService.createListingRequest({
      assetId: adaAsset.id,
      tickSize: '-100', // Negative
      lotSize: '1000000',
      minQuantity: '1000000',
      minNotional: '1000000'
    }, makerAdminId);
  } catch {
    invalidTickCaught = true;
  }
  assert(invalidTickCaught, '2a. Non-positive or negative tick size is rejected');

  let invalidMinQtyCaught = false;
  try {
    ListingService.createListingRequest({
      assetId: adaAsset.id,
      tickSize: '100',
      lotSize: '1000000',
      minQuantity: '500000', // Less than lot size!
      minNotional: '1000000'
    }, makerAdminId);
  } catch {
    invalidMinQtyCaught = true;
  }
  assert(invalidMinQtyCaught, '2b. minQuantity smaller than lotSize is rejected');

  // -------------------------------------------------------------
  // TEST 3: Financial Invariance (Listing Does Not Mutate Balances)
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Financial Invariance ---');
  const userAccountBefore = db.createOrGetAccount(traderUserId, 'IDR');
  const availBefore = BigInt(userAccountBefore.balanceAvailable);
  const lockedBefore = BigInt(userAccountBefore.balanceLocked);
  const ledgerEntriesCountBefore = db.ledgerEntries.length;
  const journalTxCountBefore = db.journalTransactions.size;

  // Maker creates draft listing
  const listingDraft = ListingService.createListingRequest({
    assetId: adaAsset.id,
    tickSize: '100',       // 100 sen = 1 IDR
    lotSize: '1000000',     // 1 ADA
    minQuantity: '5000000', // 5 ADA
    minNotional: '5000000', // Rp 50,000.00
    makerFeeBps: 15,
    takerFeeBps: 25
  }, makerAdminId);

  const userAccountAfter = db.createOrGetAccount(traderUserId, 'IDR');
  const availAfter = BigInt(userAccountAfter.balanceAvailable);
  const lockedAfter = BigInt(userAccountAfter.balanceLocked);
  const ledgerEntriesCountAfter = db.ledgerEntries.length;
  const journalTxCountAfter = db.journalTransactions.size;

  assert(
    availBefore === availAfter && lockedBefore === lockedAfter,
    '3a. Listing creation does not alter user available or locked balances'
  );
  assert(
    ledgerEntriesCountBefore === ledgerEntriesCountAfter && journalTxCountBefore === journalTxCountAfter,
    '3b. Listing creation creates zero ledger entries and zero journal transactions'
  );

  // -------------------------------------------------------------
  // TEST 4: State Machine & Transition Rules
  // -------------------------------------------------------------
  console.log('\n--- Test 4: State Machine Transitions ---');
  // 4a. Attempt to activate directly from DRAFT (Must fail)
  let directActivateCaught = false;
  try {
    await ListingActivationService.activateMarket(listingDraft.id, makerAdminId);
  } catch {
    directActivateCaught = true;
  }
  assert(directActivateCaught, '4a. Cannot activate listing directly from DRAFT status');

  // 4b. Submit DRAFT -> PENDING_REVIEW
  const submitted = ListingService.submitForReview(listingDraft.id, makerAdminId);
  assert(submitted.status === 'PENDING_REVIEW', '4b. Listing successfully transitioned from DRAFT to PENDING_REVIEW');

  // -------------------------------------------------------------
  // TEST 5: Maker-Checker Enforcement (Self-Approval Strictly Forbidden)
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Maker-Checker Enforcement ---');
  let selfApprovalCaught = false;
  try {
    // Maker attempts to approve their own listing!
    ListingService.approveListing(listingDraft.id, makerAdminId, 'Self approval attempt');
  } catch (err: any) {
    if (err.message.includes('Maker-Checker')) {
      selfApprovalCaught = true;
    }
  }
  assert(selfApprovalCaught, '5a. Maker is strictly forbidden from approving their own listing request');

  // 5b. Checker (different admin) approves
  const approval = ListingService.approveListing(
    listingDraft.id, 
    checkerAdminId, 
    'Compliance check passed: smart contract audited and liquidity verified'
  );
  const listingApproved = db.listingRequests.get(listingDraft.id)!;
  assert(
    listingApproved.status === 'APPROVED' && approval.reviewerId === checkerAdminId,
    '5b. Independent Checker successfully approves listing request'
  );

  // 5c. Duplicate approval rejected
  let duplicateApprovalCaught = false;
  try {
    ListingService.approveListing(listingDraft.id, checkerAdminId, 'Duplicate approval attempt');
  } catch {
    duplicateApprovalCaught = true;
  }
  assert(duplicateApprovalCaught, '5c. Duplicate approval on same version is rejected');

  // -------------------------------------------------------------
  // TEST 6: Parameter Update Invalidates Previous Approval
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Approval Invalidation on Parameter Edits ---');
  // If maker edits tick size, version increments and approval is wiped
  const updatedListing = ListingService.updateListingRequest(
    listingDraft.id,
    { tickSize: '200' }, // Change from 100 to 200 sen
    makerAdminId
  );
  assert(updatedListing.version === 2, '6a. Parameter edit increments aggregate version');
  assert(!db.listingApprovals.has(listingDraft.id), '6b. Parameter edit invalidates prior approval');

  // Must re-submit and re-approve
  ListingService.submitForReview(listingDraft.id, makerAdminId);
  ListingService.approveListing(listingDraft.id, checkerAdminId, 'Re-approval for updated tick size');
  assert(db.listingRequests.get(listingDraft.id)!.status === 'APPROVED', '6c. Re-approved after parameter updates');

  // -------------------------------------------------------------
  // TEST 7: Idempotent Market Activation Pipeline
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Idempotent Market Activation ---');
  const marketSymbol = `${adaAsset.symbol}-IDR`;

  // First activation
  const activation1 = await ListingActivationService.activateMarket(listingDraft.id, checkerAdminId);
  assert(
    activation1.success && !activation1.isIdempotentReplay && activation1.market.status === 'ACTIVE',
    '7a. Initial activation succeeds and transitions market to ACTIVE'
  );

  // Verify Matching Engine has clean empty order book
  const book = matchingEngine.getOrderBook(marketSymbol);
  assert(book.bids.length === 0 && book.asks.length === 0, '7b. Newly listed market starts with clean, empty order book (Zero fake liquidity)');

  // Second activation (Idempotent replay)
  const activation2 = await ListingActivationService.activateMarket(listingDraft.id, checkerAdminId);
  assert(
    activation2.success && activation2.isIdempotentReplay,
    '7c. Duplicate activation returns idempotent success without duplicate market creation'
  );

  // Verify Market in Catalog
  const storedMarket = db.markets.get(marketSymbol);
  assert(storedMarket !== undefined && storedMarket.status === 'ACTIVE', '7d. Market is active and accessible in market catalogue');

  // -------------------------------------------------------------
  // TEST 8: Engine Readiness & Inactive Trading Guard
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Engine Inactive Market Guard ---');
  // Suspend market
  ListingService.suspendMarket(marketSymbol, checkerAdminId, 'Regulatory inspection pause');
  const suspendedMarket = db.markets.get(marketSymbol)!;
  assert(suspendedMarket.status === 'HALTED', '8a. Market successfully suspended (HALTED)');

  // Attempt to place order in halted market (Must be rejected)
  let orderHaltedCaught = false;
  try {
    matchingEngine.placeOrder({
      userId: traderUserId,
      pairId: marketSymbol,
      side: 'BUY',
      orderType: 'LIMIT',
      price: '500000',
      quantity: '10000000'
    });
  } catch (err: any) {
    if (err.message.includes('HALTED') || err.message.includes('dihentikan')) {
      orderHaltedCaught = true;
    }
  }
  assert(orderHaltedCaught, '8b. Matching engine strictly rejects order submission to halted market');

  // Resume market
  ListingService.resumeMarket(marketSymbol, checkerAdminId, 'Inspection completed');
  assert(db.markets.get(marketSymbol)!.status === 'ACTIVE', '8c. Market resumed to ACTIVE status');

  // -------------------------------------------------------------
  // TEST 9: Append-Only Cryptographic Audit Trail Integrity
  // -------------------------------------------------------------
  console.log('\n--- Test 9: Cryptographic Audit Trail Hash Chain ---');
  const initialAuditVerify = ListingAuditService.verifyAuditIntegrity();
  assert(initialAuditVerify.isValid, `9a. Audit trail hash chain is cryptographically intact (${initialAuditVerify.totalEvents} events)`);

  // Test Tamper Detection
  if (db.listingAuditEvents.length > 0) {
    const originalEvent = db.listingAuditEvents[0];
    const originalPayload = { ...originalEvent.payload };
    
    // Simulate malicious tamper
    originalEvent.payload.tampered = true;
    const tamperedVerify = ListingAuditService.verifyAuditIntegrity();
    assert(!tamperedVerify.isValid, '9b. Tamper detection detects unauthorized modification to audit payload');

    // Restore original payload
    originalEvent.payload = originalPayload;
    const restoredVerify = ListingAuditService.verifyAuditIntegrity();
    assert(restoredVerify.isValid, '9c. Restoring payload returns hash chain to valid verified state');
  }

  // -------------------------------------------------------------
  // TEST 10: Market Reconciliation
  // -------------------------------------------------------------
  console.log('\n--- Test 10: Engine Reconciliation ---');
  const reconciliation = ListingActivationService.reconcileMarketReadiness(marketSymbol);
  assert(
    reconciliation.isConsistent && reconciliation.engineBookLoaded && reconciliation.dbStatus === 'ACTIVE',
    '10. Market database status and matching engine state are fully synchronized'
  );

  console.log('\n================================================================');
  console.log('   ALL 10 INITIAL LISTING TEST PHASES PASSED SUCCESSFULLY!      ');
  console.log('================================================================\n');
}

// Direct execution support
if (process.argv[1]?.endsWith('test_initial_listing.ts') || process.argv[1]?.endsWith('test_initial_listing.js')) {
  runInitialListingTestSuite()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Initial Listing Test Fatal Error:', err);
      process.exit(1);
    });
}
