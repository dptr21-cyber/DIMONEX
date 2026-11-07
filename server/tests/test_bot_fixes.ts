/**
 * test_bot_fixes.ts
 * Automated validation test for:
 * 1. Market Maker Depth & Liquidity Bot Order Refresh & Dynamic Price Levels
 * 2. Automated Quantitative Trading Bots Ledger Balance Reading
 */

import { db } from '../db/database.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { DepthLiquidityBotExecutor } from '../services/bots/DepthLiquidityBot.js';
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

async function runTests() {
  console.log('=== STARTING BOT OPERATIONAL VERIFICATION TESTS ===\n');

  // TEST 1: User Ledger Account Initialization & Balance Retrieval
  console.log('[Test 1] User Ledger Balance Reading for Bots');
  const testUserId = 'usr-user1-0000-0000-000000000001';
  const idrAccount = db.createOrGetAccount(testUserId, 'IDR');
  const btcAccount = db.createOrGetAccount(testUserId, 'BTC');

  assert(Boolean(idrAccount), 'User IDR account exists in immutable ledger');
  assert(BigInt(idrAccount.balanceAvailable) > 0n, `IDR balance is positive: ${idrAccount.balanceAvailable} units`);
  assert(Boolean(btcAccount), 'User BTC account exists in immutable ledger');
  assert(BigInt(btcAccount.balanceAvailable) > 0n, `BTC balance is positive: ${btcAccount.balanceAvailable} units`);

  // Verify accounts format from getUserAccounts
  const userAccounts = db.getUserAccounts(testUserId);
  assert(userAccounts.length >= 4, `getUserAccounts returns ${userAccounts.length} accounts for user`);
  const foundIdr = userAccounts.find(a => a.currency === 'IDR');
  assert(Boolean(foundIdr && BigInt(foundIdr.balanceAvailable) > 0n), 'User IDR account is retrieved correctly');

  // TEST 2: DepthLiquidityBot Initial Deployment & Order Placement
  console.log('\n[Test 2] Depth & Liquidity Bot Dynamic Deployment');
  const botId = `bot-dep-test-${Date.now()}`;
  const mockBot: BotInstance = {
    id: botId,
    name: 'Test Depth Bot',
    botType: 'DEPTH_LIQUIDITY',
    pairId: 'USDT-IDR',
    environment: 'DEMO',
    ownerUserId: 'usr-mm-0000-0000-000000000001',
    accountId: 'usr-mm-0000-0000-000000000001',
    version: 1,
    status: 'RUNNING',
    lastHeartbeat: Date.now(),
    depthLiquidityConfig: {
      account_id: 'usr-mm-0000-0000-000000000001',
      market_symbol: 'USDT-IDR',
      reference_price_source: 'AGGREGATED',
      spacing_mode: 'FIXED_IDR',
      level_spacing_idr: 60,
      number_of_bid_levels: 5,
      number_of_ask_levels: 5,
      bid_level_offsets_bps: [10, 25, 50, 80, 120],
      ask_level_offsets_bps: [10, 25, 50, 80, 120],
      bid_quantities: ['25.0', '50.0', '75.0', '100.0', '150.0'],
      ask_quantities: ['25.0', '50.0', '75.0', '100.0', '150.0'],
      quantity_randomization_enabled: false,
      random_min_quantity: '5.0',
      random_max_quantity: '25.0',
      minimum_reprice_interval_ms: 1000,
      minimum_price_change_bps: 5,
      maximum_open_orders: 20,
      maximum_total_bid_value_idr: '500000000',
      maximum_total_ask_quantity: '500.0',
      maximum_inventory: '1000.0',
      maximum_order_value_idr: '100000000',
      max_data_age_ms: 60000,
      tick_size: 1,
      lot_size: '0.0001',
      dry_run: false,
      enabled: true,
      activeOrderIds: []
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
    createdBy: 'test@dimonex.id',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const logs: string[] = [];
  const addLog = (b: BotInstance, msg: string) => {
    logs.push(msg);
  };

  // Run cycle 1
  const cycle1Success = DepthLiquidityBotExecutor.executeCycle(mockBot, addLog);
  assert(cycle1Success, 'Cycle 1 executed successfully');
  assert(mockBot.depthLiquidityConfig!.activeOrderIds!.length === 10, `Cycle 1 deployed 10 orders (got ${mockBot.depthLiquidityConfig!.activeOrderIds!.length})`);

  // Check order book depth
  const book1 = matchingEngine.getOrderBook('USDT-IDR');
  const botOrders1 = [...book1.bids, ...book1.asks].filter(o => o.clientOrderId?.startsWith(`bot-dp-${mockBot.id.slice(4, 10)}`));
  const activeOrderCount = botOrders1.length;
  const filledOrderCount = mockBot.depthLiquidityConfig!.activeOrderIds!.filter(id => db.orders.get(id)?.status === 'FILLED').length;
  assert(activeOrderCount + filledOrderCount === 10, `All 10 bot orders accounted for (${activeOrderCount} resting on book, ${filledOrderCount} filled)`);

  // Check no duplicate prices in cycle 1
  const bidPrices1 = book1.bids.filter(o => o.clientOrderId?.startsWith(`bot-dp-${mockBot.id.slice(4, 10)}`)).map(o => o.price);
  const askPrices1 = book1.asks.filter(o => o.clientOrderId?.startsWith(`bot-dp-${mockBot.id.slice(4, 10)}`)).map(o => o.price);
  const uniqueBidPrices1 = new Set(bidPrices1);
  const uniqueAskPrices1 = new Set(askPrices1);
  assert(uniqueBidPrices1.size === bidPrices1.length, `No duplicate bid prices placed (${uniqueBidPrices1.size}/${bidPrices1.length})`);
  assert(uniqueAskPrices1.size === askPrices1.length, `No duplicate ask prices placed (${uniqueAskPrices1.size}/${askPrices1.length})`);

  // TEST 3: DepthLiquidityBot Order Refresh & Stale Order Cleanup
  console.log('\n[Test 3] Dynamic Order Refresh & Cancel-and-Replace (No Stacking)');
  // Fast forward reprice and cooldown timestamps so refresh triggers
  mockBot.depthLiquidityConfig!.lastRepriceTimestamp = 0;
  mockBot.depthLiquidityConfig!.last_refresh_timestamp = 0;

  // Run cycle 2
  const cycle2Success = DepthLiquidityBotExecutor.executeCycle(mockBot, addLog);
  assert(cycle2Success, 'Cycle 2 executed successfully');

  // Verify order book has NOT stacked duplicate orders
  const book2 = matchingEngine.getOrderBook('USDT-IDR');
  const botOrders2 = [...book2.bids, ...book2.asks].filter(o => o.clientOrderId?.startsWith(`bot-dp-${mockBot.id.slice(4, 10)}`));
  const activeOrderCount2 = botOrders2.length;
  const filledOrderCount2 = mockBot.depthLiquidityConfig!.activeOrderIds!.filter(id => db.orders.get(id)?.status === 'FILLED').length;
  assert(activeOrderCount2 + filledOrderCount2 === 10, `Order book actively refreshed without stacking: exactly 10 total orders accounted for (${activeOrderCount2} resting, ${filledOrderCount2} filled)`);

  // Verify order IDs changed (proving refresh took place)
  const orderIds1 = new Set(botOrders1.map(o => o.id));
  const orderIds2 = botOrders2.map(o => o.id);
  const someIdsRefreshed = orderIds2.some(id => !orderIds1.has(id));
  assert(someIdsRefreshed, 'Active orders were refreshed with new orders rather than accumulating stale orders');

  // Clean up
  const cancelledCount = DepthLiquidityBotExecutor.cancelOpenDepthOrders(mockBot, addLog, 'Test Cleanup');
  assert(cancelledCount === activeOrderCount2, `cancelOpenDepthOrders cancelled all ${activeOrderCount2} remaining resting orders (got ${cancelledCount})`);

  const bookAfterClean = matchingEngine.getOrderBook('USDT-IDR');
  const botOrdersAfterClean = [...bookAfterClean.bids, ...bookAfterClean.asks].filter(o => o.clientOrderId?.startsWith(`bot-dp-${mockBot.id.slice(4, 10)}`));
  assert(botOrdersAfterClean.length === 0, `Order book is completely clean of bot orders (got ${botOrdersAfterClean.length})`);

  console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
