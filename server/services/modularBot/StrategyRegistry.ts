/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/services/modularBot/StrategyRegistry.ts
 * Dynamic Strategy Plugin Registry for DIMONEX MODULAR_STRATEGY_BOT.
 * New StrategyController plugins register here without modifying core execution or risk engines.
 */

import { StrategyController, StrategyMetadata } from './types.js';

export type StrategyFactory = () => StrategyController;

interface RegisteredPlugin {
  metadata: StrategyMetadata;
  factory: StrategyFactory;
}

export class StrategyRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map();

  public register(factory: StrategyFactory): void {
    const sample = factory();
    const meta = sample.getMetadata();
    if (!meta || !meta.strategyId) {
      throw new Error('Cannot register strategy plugin without a valid strategyId');
    }
    this.plugins.set(meta.strategyId, { metadata: meta, factory });
  }

  public has(strategyId: string): boolean {
    return this.plugins.has(strategyId);
  }

  public createController(strategyId: string): StrategyController {
    const entry = this.plugins.get(strategyId);
    if (!entry) {
      throw new Error(`Strategy plugin "${strategyId}" tidak terdaftar pada StrategyRegistry.`);
    }
    return entry.factory();
  }

  public getMetadata(strategyId: string): StrategyMetadata | null {
    return this.plugins.get(strategyId)?.metadata || null;
  }

  public listStrategies(): StrategyMetadata[] {
    return Array.from(this.plugins.values()).map(p => p.metadata);
  }
}

export const strategyRegistry = new StrategyRegistry();
