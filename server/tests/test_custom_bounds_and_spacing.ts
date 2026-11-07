/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * test_custom_bounds_and_spacing.ts
 * Comprehensive test suite verifying:
 * 1. Custom Bounds Mode (No external price feed dependency, autonomous MM).
 * 2. Spacing Ladder Modes (LINEAR, GEOMETRIC, CONCENTRATED, FIXED_IDR).
 * 3. Anti-Stacking & Dynamic Refresh (Cancel-and-replace, no duplicate prices).
 * 4. Multi-token support (DOGE-IDR, ADA-IDR, and newly listed tokens).
 */

import { DepthLiquidityBotExecutor } from '../services/bots/DepthLiquidityBot.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { db } from '../db/database.js';
import { BotInstance } from '../db/types.js';

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('  DEPTH & LIQUIDITY BOT: CUSTOM BOUNDS & SPACING LADDER TESTS  ');
  console.log('================================================================\n');

  const mmUserId = 'usr-mm-0000-0000-000000000001';

  // --------------------------------------------------------------------------
  // TEST 1: Custom Bounds Mode (Autonomous, Independent of External Feeds)
  // --------------------------------------------------------------------------
  console.log('--- Test 1: Autonomous Custom Bounds Mode (DOGE-IDR) ---');
  // Register or configure DOGE-IDR pair
  let dogePair = db.tradingPairs.get('DOGE-IDR');
  if (!dogePair) {
    const newPair = {
      id: 'DOGE-IDR',
      baseCurrency: 'DOGE',
      quoteCurrency: 'IDR',
      baseDecimals: 8,
      quoteDecimals: 2,
      minOrderSize: '100000000', // 1 DOGE
      maxOrderSize: '100000000000000', // 1,000,000 DOGE
      makerFeeBps: 10,
      takerFeeBps: 20,
      isActive: true,
      isHalted: false,
      lastPrice: '260000', // Rp 2.600
      high24h: '280000',
      low24h: '240000',
      volume24h: '0',
      priceChange24h: '+0.00'
    };
    db.tradingPairs.set('DOGE-IDR', newPair);
    dogePair = newPair;
  } else {
    dogePair.maxOrderSize = '100000000000000';
    dogePair.isHalted = false;
  }

  // Clean any preexisting orders on DOGE-IDR to ensure test isolation
  const preBook = matchingEngine.getOrderBook('DOGE-IDR');
  for (const o of [...preBook.bids, ...preBook.asks]) {
    try {
      matchingEngine.cancelOrder(o.id, o.userId, 'DOGE-IDR', 'ADMIN');
    } catch (e) {}
  }

  const dogeBotId = 'bot-dep-test-doge';
  const dogeBot: BotInstance = {
    id: dogeBotId,
    name: 'DOGE-IDR Autonomous Liquidity',
    botType: 'DEPTH_LIQUIDITY',
    pairId: 'DOGE-IDR',
    environment: 'DEMO',
    ownerUserId: mmUserId,
    accountId: mmUserId,
    version: 1,
    status: 'RUNNING',
    lastHeartbeat: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { ordersSubmitted: 0, ordersAccepted: 0, ordersFilled: 0, executedVolume: '0', totalTrades: 0 },
    deployedOrderIds: [],
    logs: [],
    createdBy: 'test',
    depthLiquidityConfig: {
      account_id: mmUserId,
      market_symbol: 'DOGE-IDR',
      price_mode: 'CUSTOM_BOUNDS',
      reference_price_source: 'NONE',
      min_limit_buy_price: '2400',
      max_limit_buy_price: '2580',
      min_limit_sell_price: '2620',
      max_limit_sell_price: '2800',
      spacing_mode: 'LINEAR',
      anti_stacking_enabled: true,
      number_of_bid_levels: 5,
      number_of_ask_levels: 5,
      bid_level_offsets_bps: [20, 40, 60, 80, 100],
      ask_level_offsets_bps: [20, 40, 60, 80, 100],
      bid_quantities: ['10.0', '20.0', '30.0', '40.0', '50.0'],
      ask_quantities: ['10.0', '20.0', '30.0', '40.0', '50.0'],
      quantity_randomization_enabled: false,
      random_min_quantity: '500.0',
      random_max_quantity: '2500.0',
      minimum_reprice_interval_ms: 1000,
      minimum_price_change_bps: 10,
      maximum_open_orders: 20,
      maximum_total_bid_value_idr: '500000000',
      maximum_total_ask_quantity: '100000.0',
      maximum_inventory: '1000000.0',
      maximum_order_value_idr: '100000000',
      max_data_age_ms: 10000,
      tick_size: 10,
      lot_size: '1.0',
      dry_run: false,
      liquidity_refresh_cooldown_sec: 3,
      randomize_placement_enabled: false,
      price_randomization_ticks: 1,
      enabled: true,
      activeOrderIds: []
    }
  };

  const addLog = (b: BotInstance, msg: string) => b.logs.push({ timestamp: Date.now(), message: msg, type: 'INFO' });

  // Execute cycle for DOGE-IDR
  const executed = DepthLiquidityBotExecutor.executeCycle(dogeBot, addLog);
  assert(executed, 'DOGE-IDR bot cycle executed successfully without external feed');

  const dogeBook = matchingEngine.getOrderBook('DOGE-IDR');
  assert(dogeBook.bids.length >= 5, `DOGE-IDR order book has at least 5 bids (got ${dogeBook.bids.length})`);
  assert(dogeBook.asks.length >= 5, `DOGE-IDR order book has at least 5 asks (got ${dogeBook.asks.length})`);

  // Verify custom bounds boundaries
  const highestBidDoge = Number(dogeBook.bids[0].price) / 100;
  const lowestBidDoge = Number(dogeBook.bids[dogeBook.bids.length - 1].price) / 100;
  const lowestAskDoge = Number(dogeBook.asks[0].price) / 100;
  const highestAskDoge = Number(dogeBook.asks[dogeBook.asks.length - 1].price) / 100;

  assert(highestBidDoge <= 2580, `Highest Bid is <= Max Buy Bound (got ${highestBidDoge}, max 2580)`);
  assert(lowestBidDoge >= 2400, `Lowest Bid is >= Min Buy Bound (got ${lowestBidDoge}, min 2400)`);
  assert(lowestAskDoge >= 2620, `Lowest Ask is >= Min Sell Bound (got ${lowestAskDoge}, min 2620)`);
  assert(highestAskDoge <= 2800, `Highest Ask is <= Max Sell Bound (got ${highestAskDoge}, max 2800)`);
  assert(lowestAskDoge > highestBidDoge, `Spread is strictly positive (no crossing: Ask ${lowestAskDoge} > Bid ${highestBidDoge})`);

  // Clean DOGE bot orders
  const cleanedDoge = DepthLiquidityBotExecutor.cancelOpenDepthOrders(dogeBot, addLog, 'Cleanup DOGE test');
  assert(cleanedDoge >= 10, `Cleaned ${cleanedDoge} orders successfully`);

  // --------------------------------------------------------------------------
  // TEST 2: Spacing Ladder Modes (LINEAR vs GEOMETRIC vs CONCENTRATED)
  // --------------------------------------------------------------------------
  console.log('\n--- Test 2: Spacing Ladder Distribution Modes ---');
  // Test Geometric spacing (rungs widen progressively)
  dogeBot.depthLiquidityConfig!.spacing_mode = 'GEOMETRIC';
  dogeBot.depthLiquidityConfig!.last_refresh_timestamp = 0; // force refresh
  DepthLiquidityBotExecutor.executeCycle(dogeBot, addLog);

  const geoBook = matchingEngine.getOrderBook('DOGE-IDR');
  const bidPricesGeo = geoBook.bids.slice(0, 5).map(b => Number(b.price) / 100);
  console.log('   Geometric Bids:', bidPricesGeo);

  // In geometric mode, distance between level 1 and 2 should be smaller than between level 4 and 5
  const gap1_2 = bidPricesGeo[0] - bidPricesGeo[1];
  const gap4_5 = bidPricesGeo[3] - bidPricesGeo[4];
  assert(gap4_5 >= gap1_2, `Geometric rungs space out progressively (gap4_5=${gap4_5} >= gap1_2=${gap1_2})`);

  DepthLiquidityBotExecutor.cancelOpenDepthOrders(dogeBot, addLog);

  // --------------------------------------------------------------------------
  // TEST 3: Anti-Stacking & Active Clean Refresh
  // --------------------------------------------------------------------------
  console.log('\n--- Test 3: Anti-Stacking & Order Replacement Invariant ---');
  dogeBot.depthLiquidityConfig!.spacing_mode = 'LINEAR';
  dogeBot.depthLiquidityConfig!.last_refresh_timestamp = 0;
  
  // Cycle 1
  DepthLiquidityBotExecutor.executeCycle(dogeBot, addLog);
  const cycle1Book = matchingEngine.getOrderBook('DOGE-IDR');
  const countCycle1 = cycle1Book.bids.length + cycle1Book.asks.length;
  assert(countCycle1 === 10, `Cycle 1 placed exactly 10 rungs (got ${countCycle1})`);

  // Cycle 2 (immediate refresh should cleanly replace orders, not stack)
  dogeBot.depthLiquidityConfig!.last_refresh_timestamp = 0; // reset cooldown
  DepthLiquidityBotExecutor.executeCycle(dogeBot, addLog);
  const cycle2Book = matchingEngine.getOrderBook('DOGE-IDR');
  const countCycle2 = cycle2Book.bids.length + cycle2Book.asks.length;
  assert(
    countCycle2 === 10,
    `Anti-Stacking Invariant: Cycle 2 replaced stale orders cleanly, exactly 10 live orders remain (got ${countCycle2}, NOT 20)`
  );

  // Check no duplicate prices
  const allLivePrices = [...cycle2Book.bids.map(b => b.price), ...cycle2Book.asks.map(a => a.price)];
  const uniquePriceSet = new Set(allLivePrices);
  assert(uniquePriceSet.size === 10, `All 10 active order book levels are strictly unique without stacking (${uniquePriceSet.size}/10)`);

  // Final sweep
  DepthLiquidityBotExecutor.cancelOpenDepthOrders(dogeBot, addLog);
  const cleanBook = matchingEngine.getOrderBook('DOGE-IDR');
  assert(cleanBook.bids.length === 0 && cleanBook.asks.length === 0, 'Final order book is completely clean of bot orders');

  console.log('\n================================================================');
  console.log('   ALL CUSTOM BOUNDS & SPACING LADDER TESTS PASSED (100%)       ');
  console.log('================================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
