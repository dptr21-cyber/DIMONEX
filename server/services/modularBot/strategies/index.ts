/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/strategies/index.ts
 * Registers all built-in StrategyController plugins with the central StrategyRegistry.
 */

import { strategyRegistry } from '../StrategyRegistry.js';
import { BollingerRsiStrategy } from './BollingerRsiStrategy.js';
import { EmaMacdStrategy } from './EmaMacdStrategy.js';
import { SupertrendStrategy } from './SupertrendStrategy.js';
import { CustomRuleBuilderStrategy } from './CustomRuleBuilderStrategy.js';
import { DirectionalMarketMakerStrategy } from './DirectionalMarketMakerStrategy.js';
import { DynamicGridDcaStrategy } from './DynamicGridDcaStrategy.js';

let initialized = false;

export function ensureStrategiesRegistered(): void {
  if (initialized) return;
  initialized = true;
  strategyRegistry.register(() => new BollingerRsiStrategy());
  strategyRegistry.register(() => new EmaMacdStrategy());
  strategyRegistry.register(() => new SupertrendStrategy());
  strategyRegistry.register(() => new CustomRuleBuilderStrategy());
  strategyRegistry.register(() => new DirectionalMarketMakerStrategy());
  strategyRegistry.register(() => new DynamicGridDcaStrategy());
}

ensureStrategiesRegistered();
