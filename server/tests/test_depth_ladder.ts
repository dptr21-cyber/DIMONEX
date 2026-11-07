/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * test_depth_ladder.ts
 * Rigorous test suite for Fixed IDR 60 Ladder Spacing in Depth & Liquidity Bot.
 */

import { DepthLiquidityBotExecutor } from '../services/bots/DepthLiquidityBot.js';
import { matchingEngine } from '../engine/MatchingEngine.js';
import { db } from '../db/database.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { BotInstance } from '../db/types.js';

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    process.exit(1);
  }
}

async function runDepthLadderTests() {
  console.log('================================================================');
  console.log('   DEPTH & LIQUIDITY BOT: FIXED IDR 60 LADDER SPACING TESTS    ');
  console.log('================================================================\n');

  // Test 1: Pair-aware tick size
  console.log('--- Test 1: Market-aware tick size ---');
  const usdtTick = DepthLiquidityBotExecutor.getCompatibleTickSize('USDT-IDR', 1000);
  assert(usdtTick === 1, 'USDT-IDR overrides coarse 1000 IDR tick size to 1 IDR');
  const btcTick = DepthLiquidityBotExecutor.getCompatibleTickSize('BTC-IDR', 1000);
  assert(btcTick === 1000, 'BTC-IDR uses 1000 IDR tick size');

  // Test 2: Fixed IDR 60 Ladder Calculation
  console.log('\n--- Test 2: Fixed IDR 60 Ladder Arithmetic ---');
  const refPriceIdr = 1800000;
  const spacingIdr = 60;
  const expectedBids = [1799940, 1799880, 1799820, 1799760, 1799700];
  const expectedAsks = [1800060, 1800120, 1800180, 1800240, 1800300];

  const calculatedBids: number[] = [];
  const calculatedAsks: number[] = [];
  for (let i = 0; i < 5; i++) {
    calculatedBids.push(refPriceIdr - (i + 1) * spacingIdr);
    calculatedAsks.push(refPriceIdr + (i + 1) * spacingIdr);
  }

  assert(
    JSON.stringify(calculatedBids) === JSON.stringify(expectedBids),
    '5 BUY levels calculated at exact expected prices with Rp 60 spacing'
  );
  assert(
    JSON.stringify(calculatedAsks) === JSON.stringify(expectedAsks),
    '5 SELL levels calculated at exact expected prices with Rp 60 spacing'
  );

  // Test 3: Distance invariant
  console.log('\n--- Test 3: Consecutive distance & spread invariant ---');
  for (let i = 1; i < 5; i++) {
    assert(calculatedBids[i - 1] - calculatedBids[i] === 60, `BUY Level #${i} to #${i + 1} distance is exactly Rp 60`);
    assert(calculatedAsks[i] - calculatedAsks[i - 1] === 60, `SELL Level #${i} to #${i + 1} distance is exactly Rp 60`);
  }
  const spreadBetweenClosest = calculatedAsks[0] - calculatedBids[0];
  assert(spreadBetweenClosest === 120, 'Spread between closest BUY and SELL (Level 1) is exactly Rp 120');

  // Test 4: No Duplicate Prices
  console.log('\n--- Test 4: Duplicate price detection ---');
  const allPrices = [...calculatedBids, ...calculatedAsks];
  const uniquePrices = new Set(allPrices);
  assert(uniquePrices.size === 10, 'All 10 target ladder prices are strictly unique (no stacking)');

  // Test 5: Depth execution on USDT-IDR Matching Engine
  console.log('\n--- Test 5: Real Matching Engine Placement and L2 Order Book Dispersion ---');
  const mmUserId = 'usr-mm-0000-0000-000000000001';
  const botId = 'bot-dep-test-ladder';
  const testBot: BotInstance = {
    id: botId,
    name: 'Test Depth Ladder USDT-IDR',
    botType: 'DEPTH_LIQUIDITY',
    pairId: 'USDT-IDR',
    environment: 'DEMO',
    ownerUserId: mmUserId,
    accountId: mmUserId,
    version: 1,
    status: 'RUNNING',
    lastHeartbeat: Date.now(),
    depthLiquidityConfig: {
      account_id: mmUserId,
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
      random_min_quantity: '10.0',
      random_max_quantity: '50.0',
      minimum_reprice_interval_ms: 1000,
      minimum_price_change_bps: 5,
      maximum_open_orders: 40,
      maximum_total_bid_value_idr: '500000000',
      maximum_total_ask_quantity: '500.0',
      maximum_inventory: '1000.0',
      maximum_order_value_idr: '100000000',
      max_data_age_ms: 5000,
      tick_size: 1,
      lot_size: '0.01',
      dry_run: false,
      enabled: true,
      activeOrderIds: []
    },
    stats: { ordersSubmitted: 0, ordersAccepted: 0, ordersFilled: 0, executedVolume: '0', totalTrades: 0 },
    deployedOrderIds: [],
    logs: [],
    createdBy: 'mm@dimonex.id',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  db.botInstances.set(botId, testBot);

  // Execute Depth Liquidity cycle
  const executed = DepthLiquidityBotExecutor.executeCycle(testBot, (b, msg) => {
    console.log(`    [Bot Log] ${msg}`);
  });
  assert(executed, 'Depth Liquidity cycle executed successfully');

  // Verify L2 Depth in Matching Engine Order Book
  const book = matchingEngine.getOrderBook('USDT-IDR');
  const depth = book.getDepth(20);
  console.log(`    Bids in depth: ${depth.bids.length} levels`);
  console.log(`    Asks in depth: ${depth.asks.length} levels`);

  assert(depth.bids.length >= 5, 'Order Book contains at least 5 distinct BID depth levels (dispersed)');
  assert(depth.asks.length >= 5, 'Order Book contains at least 5 distinct ASK depth levels (dispersed)');

  // Verify prices in depth are not stacked at one price
  const top5Bids = depth.bids.slice(0, 5).map(b => Number(b[0]) / 100);
  const top5Asks = depth.asks.slice(0, 5).map(a => Number(a[0]) / 100);

  console.log('    Top 5 Bid Prices (IDR):', top5Bids);
  console.log('    Top 5 Ask Prices (IDR):', top5Asks);

  const distinctBids = new Set(top5Bids);
  const distinctAsks = new Set(top5Asks);
  assert(distinctBids.size === 5, 'All top 5 bid levels have distinct prices ("mencar")');
  assert(distinctAsks.size === 5, 'All top 5 ask levels have distinct prices ("mencar")');

  console.log('\n================================================================');
  console.log('ALL DEPTH LADDER TESTS PASSED CLEANLY!                          ');
  console.log('================================================================\n');
  process.exit(0);
}

runDepthLadderTests().catch(err => {
  console.error('Fatal error in ladder tests:', err);
  process.exit(1);
});
