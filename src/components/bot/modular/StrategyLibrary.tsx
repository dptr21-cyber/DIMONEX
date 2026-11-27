/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/modular/StrategyLibrary.tsx
 * Strategy Plugin Catalog displaying registered DIMONEX StrategyController plugins.
 */

import React, { useState } from 'react';
import { BookOpen, Play, ShieldCheck, Sliders, TrendingUp, Layers } from 'lucide-react';
import { ModularBotCategory, ModularStrategyMetadata } from '../../../types/index.js';
import { Button } from '../../ui/Button.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { SegmentedTabs } from '../../ui/Tabs.js';

interface Props {
  strategies: ModularStrategyMetadata[];
  onSelectStrategy: (strategy: ModularStrategyMetadata) => void;
  onBacktestStrategy: (strategy: ModularStrategyMetadata) => void;
}

export const StrategyLibrary: React.FC<Props> = ({
  strategies,
  onSelectStrategy,
  onBacktestStrategy,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ModularBotCategory>('ALL');

  const filtered = strategies.filter(
    s => categoryFilter === 'ALL' || s.category === categoryFilter
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#141C24] border border-[#202B34] rounded-[10px] p-4">
        <div>
          <h3 className="text-sm font-semibold text-[#E4EBEF] flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#8DA5B1]" />
            <span>Katalog Plugin Strategi Modular</span>
          </h3>
          <p className="text-xs text-[#A1AFB8] mt-1">
            Setiap plugin mengimplementasikan kontrak <span className="font-mono text-[#E4EBEF]">StrategyController</span> terisolasi tanpa akses langsung ke ledger atau order placement.
          </p>
        </div>

        <SegmentedTabs
          size="sm"
          activeTab={categoryFilter}
          onChange={setCategoryFilter}
          tabs={[
            { id: 'ALL', label: 'Semua', badge: strategies.length },
            { id: 'DIRECTIONAL', label: 'Directional' },
            { id: 'MARKET_MAKING', label: 'Market Making' },
            { id: 'HYBRID', label: 'Hybrid Grid' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map(strategy => (
          <div
            key={strategy.strategyId}
            className="bg-[#141C24] border border-[#202B34] hover:border-[#2B3944] rounded-[10px] p-4 flex flex-col justify-between gap-4 transition-colors"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {strategy.category === 'DIRECTIONAL' ? (
                      <TrendingUp className="w-4 h-4 text-[#16A879] shrink-0" />
                    ) : (
                      <Layers className="w-4 h-4 text-[#8DA5B1] shrink-0" />
                    )}
                    <h4 className="text-sm font-semibold text-[#E4EBEF] truncate">
                      {strategy.name}
                    </h4>
                  </div>
                  <div className="text-[11px] font-mono text-[#71818B] mt-1">
                    {strategy.category} · v{strategy.version} · {strategy.supportedMarketTypes.join('/')}
                  </div>
                </div>
                <StatusBadge tone={strategy.status === 'ACTIVE' ? 'success' : 'warning'}>
                  {strategy.status}
                </StatusBadge>
              </div>

              <p className="text-xs text-[#A1AFB8] leading-relaxed">
                {strategy.description}
              </p>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#202B34] text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#71818B] mb-1">
                    Indikator & Timeframe
                  </div>
                  <div className="text-[#E4EBEF] font-mono text-[11px]">
                    {strategy.requiredIndicators.slice(0, 4).join(' · ')}
                    {strategy.requiredIndicators.length > 4
                      ? ` (+${strategy.requiredIndicators.length - 4})`
                      : ''}
                  </div>
                  <div className="text-[#71818B] font-mono text-[11px] mt-0.5">
                    TF: {strategy.supportedTimeframes.join(' / ')}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#71818B] mb-1">
                    Kompatibilitas Risiko
                  </div>
                  <div className="space-y-0.5 text-[11px] text-[#A1AFB8]">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#8DA5B1] shrink-0" />
                      <span>
                        {strategy.riskCompatibility.supportsTripleBarrier
                          ? 'Triple Barrier + Trailing Stop'
                          : 'Quote-Level & Inventory Guard'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[#8DA5B1] shrink-0" />
                      <span className="font-mono tabular-nums">
                        {strategy.configurationSchema.length} Parameter Terkonfigurasi
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#202B34]">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onBacktestStrategy(strategy)}
              >
                Uji Backtest
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Play className="w-3.5 h-3.5" />}
                onClick={() => onSelectStrategy(strategy)}
              >
                Konfigurasi Bot
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
