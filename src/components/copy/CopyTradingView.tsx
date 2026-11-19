/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/copy/CopyTradingView.tsx
 * DIMONEX Institutional Copy Trading Terminal — Obsidian Iridium Matte Design
 */

import React, { useMemo, useState } from 'react';
import { Users, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { SegmentedTabs } from '../ui/Tabs.js';
import { SearchInput, FilterBar } from '../ui/Controls.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { EmptyState } from '../ui/StateViews.js';
import { useToast } from '../ui/Toast.js';
import { UserProfile, UserBalance } from '../../types/index.js';

interface Props {
  user: UserProfile | null;
  balances: UserBalance[];
  onOpenAuthModal: () => void;
  displayCurrency: 'USDT' | 'IDR';
}

interface LeadTrader {
  id: string;
  name: string;
  handle: string;
  avatarInitial: string;
  badge: 'ELITE' | 'MASTER' | 'PRO';
  roi30d: number;
  roi90d: number;
  winRate: number;
  maxDrawdown: number;
  aum: string;
  followers: number;
  maxFollowers: number;
  riskScore: number;
  activeDays: number;
  profitSharePct: number;
  recentPairs: string[];
}

export const CopyTradingView: React.FC<Props> = ({
  user,
  balances,
  onOpenAuthModal,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'LEADERBOARD' | 'MY_COPIES'>('LEADERBOARD');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'roi30d' | 'winRate' | 'followers' | 'aum'>('roi30d');
  const [selectedTrader, setSelectedTrader] = useState<LeadTrader | null>(null);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

  const [copyAmount, setCopyAmount] = useState('500');
  const [stopLossPct, setStopLossPct] = useState('15');
  const [takeProfitPct, setTakeProfitPct] = useState('50');

  const [myCopies, setMyCopies] = useState([
    {
      id: 'copy-1',
      traderName: 'ApexQuant Macro',
      handle: '@apex_quant',
      allocatedUsdt: 1200,
      currentValue: 1386.40,
      pnlUsdt: 186.40,
      pnlPct: 15.53,
      startedDaysAgo: 14,
      status: 'ACTIVE',
      openTrades: [
        { pair: 'BTC/USDT', side: 'LONG', leverage: '10x', pnlPct: 18.2 },
        { pair: 'SOL/USDT', side: 'LONG', leverage: '5x', pnlPct: 12.8 },
      ]
    }
  ]);

  const availableUsdt = useMemo(() => {
    const b = balances.find(item => item.currency === 'USDT');
    if (!b) return '0.00';
    const val =
      parseFloat(b.displayAvailable) ||
      parseFloat(b.available as string) ||
      parseFloat(b.balanceAvailable) / 1_000_000 ||
      0;
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [balances]);

  const traders: LeadTrader[] = [
    {
      id: 't-1',
      name: 'ApexQuant Macro',
      handle: '@apex_quant',
      avatarInitial: 'AQ',
      badge: 'ELITE',
      roi30d: 142.85,
      roi90d: 318.40,
      winRate: 88.4,
      maxDrawdown: 6.2,
      aum: '$2.48M',
      followers: 488,
      maxFollowers: 500,
      riskScore: 3,
      activeDays: 340,
      profitSharePct: 10,
      recentPairs: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']
    },
    {
      id: 't-2',
      name: 'SatoshiAlpha Trend',
      handle: '@satoshi_alpha',
      avatarInitial: 'SA',
      badge: 'MASTER',
      roi30d: 96.40,
      roi90d: 224.15,
      winRate: 82.1,
      maxDrawdown: 8.5,
      aum: '$1.85M',
      followers: 412,
      maxFollowers: 500,
      riskScore: 4,
      activeDays: 280,
      profitSharePct: 10,
      recentPairs: ['BTC/USDT', 'SOL/USDT', 'AVAX/USDT']
    },
    {
      id: 't-3',
      name: 'Valkyrie Systematic',
      handle: '@valkyrie_sys',
      avatarInitial: 'VS',
      badge: 'ELITE',
      roi30d: 118.20,
      roi90d: 276.50,
      winRate: 85.7,
      maxDrawdown: 5.8,
      aum: '$3.12M',
      followers: 495,
      maxFollowers: 500,
      riskScore: 2,
      activeDays: 420,
      profitSharePct: 8,
      recentPairs: ['ETH/USDT', 'BNB/USDT', 'NEAR/USDT']
    },
    {
      id: 't-4',
      name: 'NovaMomentum Fund',
      handle: '@nova_mom',
      avatarInitial: 'NM',
      badge: 'PRO',
      roi30d: 78.50,
      roi90d: 184.20,
      winRate: 79.3,
      maxDrawdown: 9.4,
      aum: '$940K',
      followers: 320,
      maxFollowers: 400,
      riskScore: 5,
      activeDays: 195,
      profitSharePct: 10,
      recentPairs: ['SOL/USDT', 'SUI/USDT', 'DOGE/USDT']
    },
    {
      id: 't-5',
      name: 'Zenith Delta Neutral',
      handle: '@zenith_dn',
      avatarInitial: 'ZD',
      badge: 'MASTER',
      roi30d: 46.80,
      roi90d: 122.40,
      winRate: 94.2,
      maxDrawdown: 2.1,
      aum: '$4.60M',
      followers: 500,
      maxFollowers: 500,
      riskScore: 1,
      activeDays: 580,
      profitSharePct: 12,
      recentPairs: ['BTC/USDT', 'ETH/USDT']
    },
    {
      id: 't-6',
      name: 'Hyperion Breakout',
      handle: '@hyperion_fx',
      avatarInitial: 'HB',
      badge: 'PRO',
      roi30d: 84.10,
      roi90d: 198.70,
      winRate: 77.8,
      maxDrawdown: 11.2,
      aum: '$780K',
      followers: 240,
      maxFollowers: 350,
      riskScore: 6,
      activeDays: 160,
      profitSharePct: 10,
      recentPairs: ['PEPE/USDT', 'SOL/USDT', 'BTC/USDT']
    }
  ];

  const filteredTraders = traders
    .filter(
      t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.handle.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'aum') {
        const numA = parseFloat(a.aum.replace(/[^0-9.]/g, '')) * (a.aum.includes('M') ? 1000000 : 1000);
        const numB = parseFloat(b.aum.replace(/[^0-9.]/g, '')) * (b.aum.includes('M') ? 1000000 : 1000);
        return numB - numA;
      }
      return b[sortBy] - a[sortBy];
    });

  const handleOpenCopy = (trader: LeadTrader) => {
    if (!user) {
      onOpenAuthModal();
      return;
    }
    setSelectedTrader(trader);
    setIsCopyModalOpen(true);
  };

  const handleConfirmCopy = () => {
    if (!selectedTrader) return;
    const amountNum = parseFloat(copyAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('error', 'Invalid Amount', 'Please specify a valid USDT allocation.');
      return;
    }

    const newCopy = {
      id: `copy-${Date.now()}`,
      traderName: selectedTrader.name,
      handle: selectedTrader.handle,
      allocatedUsdt: amountNum,
      currentValue: amountNum,
      pnlUsdt: 0,
      pnlPct: 0,
      startedDaysAgo: 0,
      status: 'ACTIVE',
      openTrades: [{ pair: 'BTC/USDT', side: 'LONG', leverage: '10x', pnlPct: 0.2 }]
    };

    setMyCopies(prev => [newCopy, ...prev]);
    setIsCopyModalOpen(false);
    showToast(
      'success',
      'Copy Trading Activated',
      `Successfully started mirroring ${selectedTrader.name} with ${amountNum} USDT.`
    );
    setActiveTab('MY_COPIES');
  };

  const handleStopCopy = (id: string, name: string) => {
    setMyCopies(prev => prev.filter(c => c.id !== id));
    showToast(
      'info',
      'Copy Trading Terminated',
      `Positions closed and allocation returned to Spot wallet from ${name}.`
    );
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      <div className="max-w-7xl w-full mx-auto space-y-6">
        <PageHeader
          title="Institutional Copy Trading"
          subtitle="Automatically replicate audited positions from quantitative strategies with isolated margin and custom stop-loss guardrails."
          badge={<StatusBadge tone="brand" dot>DIMONEX Copy Desk</StatusBadge>}
          actions={
            <SegmentedTabs
              activeTab={activeTab}
              onChange={setActiveTab}
              tabs={[
                { id: 'LEADERBOARD', label: 'Trader Leaderboard' },
                { id: 'MY_COPIES', label: 'My Copied Traders', badge: myCopies.length },
              ]}
            />
          }
        />

        {activeTab === 'LEADERBOARD' && (
          <div className="space-y-4">
            <FilterBar>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search lead traders by name or handle..."
                className="w-full sm:w-80"
              />

              <div className="flex items-center gap-2 overflow-x-auto">
                <span className="text-[11px] text-[#71818B] shrink-0">Sort by:</span>
                <SegmentedTabs
                  size="sm"
                  activeTab={sortBy}
                  onChange={setSortBy}
                  tabs={[
                    { id: 'roi30d', label: '30D ROI' },
                    { id: 'winRate', label: 'Win Rate' },
                    { id: 'followers', label: 'Followers' },
                    { id: 'aum', label: 'AUM' },
                  ]}
                />
              </div>
            </FilterBar>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTraders.map(trader => {
                const isFull = trader.followers >= trader.maxFollowers;

                return (
                  <div
                    key={trader.id}
                    className="rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] p-5 flex flex-col justify-between transition-colors"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-[7px] bg-[#1D2832] border border-[#2B3944] flex items-center justify-center font-mono font-semibold text-[#C1D0D6] text-xs shrink-0">
                            {trader.avatarInitial}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-sm text-[#E4EBEF] truncate">
                                {trader.name}
                              </span>
                              <StatusBadge tone="brand">{trader.badge}</StatusBadge>
                            </div>
                            <span className="text-[11px] text-[#71818B] font-mono">{trader.handle}</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-[#71818B] block">Risk</span>
                          <span
                            className={`text-xs font-mono tabular-nums font-semibold ${
                              trader.riskScore <= 3
                                ? 'text-[#16A879]'
                                : trader.riskScore <= 6
                                ? 'text-[#D6A85C]'
                                : 'text-[#EA5B65]'
                            }`}
                          >
                            {trader.riskScore}/10
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 p-3 rounded-[7px] bg-[#111820] border border-[#202B34] mb-4">
                        <div>
                          <span className="text-[10px] text-[#71818B] block">30D ROI</span>
                          <span className="text-base font-mono tabular-nums font-semibold text-[#16A879]">
                            +{trader.roi30d.toFixed(2)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#71818B] block">90D ROI</span>
                          <span className="text-sm font-mono tabular-nums font-semibold text-[#16A879]">
                            +{trader.roi90d.toFixed(2)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#71818B] block">Win Rate</span>
                          <span className="text-xs font-mono tabular-nums font-semibold text-[#E4EBEF]">
                            {trader.winRate}%
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[#71818B] block">Max Drawdown</span>
                          <span className="text-xs font-mono tabular-nums font-semibold text-[#EA5B65]">
                            -{trader.maxDrawdown}%
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[#A1AFB8] mb-3 pb-2.5 border-b border-[#202B34]">
                        <span>
                          AUM: <strong className="text-[#E4EBEF] font-mono tabular-nums">{trader.aum}</strong>
                        </span>
                        <span>
                          Followers:{' '}
                          <strong className="text-[#E4EBEF] font-mono tabular-nums">
                            {trader.followers}/{trader.maxFollowers}
                          </strong>
                        </span>
                        <span>
                          Share: <strong className="text-[#E4EBEF] font-mono tabular-nums">{trader.profitSharePct}%</strong>
                        </span>
                      </div>

                      <div className="flex items-center flex-wrap gap-1.5 mb-4">
                        <span className="text-[10px] text-[#71818B]">Pairs:</span>
                        {trader.recentPairs.map(p => (
                          <span
                            key={p}
                            className="px-1.5 py-0.5 text-[10px] font-mono rounded-[5px] bg-[#17212B] text-[#A1AFB8] border border-[#202B34]"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>

                    <Button
                      variant={isFull ? 'secondary' : 'primary'}
                      size="sm"
                      className="w-full"
                      disabled={isFull}
                      onClick={() => handleOpenCopy(trader)}
                    >
                      {isFull ? 'Trader Capacity Full' : 'Copy Trader'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'MY_COPIES' && (
          <div className="space-y-4">
            {myCopies.length === 0 ? (
              <div className="rounded-[10px] bg-[#141C24] border border-[#202B34]">
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title="No Active Copy Trading Portfolios"
                  description="Explore the verified leaderboard to allocate capital to institutional-grade traders."
                  action={
                    <Button variant="primary" size="sm" onClick={() => setActiveTab('LEADERBOARD')}>
                      Browse Leaderboard
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="space-y-4">
                {myCopies.map(copy => (
                  <div key={copy.id} className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#202B34]">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-semibold text-[#E4EBEF]">{copy.traderName}</span>
                          <span className="text-xs font-mono text-[#71818B]">{copy.handle}</span>
                          <StatusBadge tone="buy" dot>{copy.status}</StatusBadge>
                        </div>
                        <span className="text-[11px] text-[#71818B]">Copied for {copy.startedDaysAgo} days</span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-[10px] text-[#71818B] block">Net Copied PnL</span>
                          <span className="text-sm font-mono tabular-nums font-semibold text-[#16A879]">
                            +${copy.pnlUsdt.toFixed(2)} (+{copy.pnlPct}%)
                          </span>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleStopCopy(copy.id, copy.traderName)}
                        >
                          Stop Copying
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[10px] text-[#71818B] block">Allocated Capital</span>
                        <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                          ${copy.allocatedUsdt.toFixed(2)} USDT
                        </span>
                      </div>
                      <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[10px] text-[#71818B] block">Current Valuation</span>
                        <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                          ${copy.currentValue.toFixed(2)} USDT
                        </span>
                      </div>
                      <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[10px] text-[#71818B] block">Active Positions</span>
                        <span className="font-mono tabular-nums font-semibold text-[#E4EBEF]">
                          {copy.openTrades.length} Trades
                        </span>
                      </div>
                      <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34]">
                        <span className="text-[10px] text-[#71818B] block">Risk Guard</span>
                        <span className="font-mono tabular-nums font-semibold text-[#16A879]">Max SL 15%</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-xs font-medium text-[#A1AFB8] block mb-2">Live Mirrored Trades</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {copy.openTrades.map((trade, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs font-mono tabular-nums"
                          >
                            <div className="flex items-center gap-2">
                              <StatusBadge tone={trade.side === 'LONG' ? 'buy' : 'sell'}>
                                {trade.side}
                              </StatusBadge>
                              <span className="text-[#E4EBEF] font-semibold">{trade.pair}</span>
                              <span className="text-[#71818B] text-[10px]">{trade.leverage}</span>
                            </div>
                            <span className="text-[#16A879] font-semibold">+{trade.pnlPct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Copy Configuration Modal */}
      <Modal
        isOpen={isCopyModalOpen && Boolean(selectedTrader)}
        onClose={() => setIsCopyModalOpen(false)}
        title={selectedTrader ? `Copy ${selectedTrader.name}` : 'Configure Copy'}
        subtitle={
          selectedTrader
            ? `${selectedTrader.handle} · Profit share: ${selectedTrader.profitSharePct}%`
            : undefined
        }
        maxWidth="max-w-md"
      >
        {selectedTrader && (
          <div className="space-y-4">
            <Input
              label="Copy Investment Amount (USDT)"
              value={copyAmount}
              onChange={e => setCopyAmount(e.target.value)}
              suffixText="USDT"
              actionText={`Spot Balance: ${availableUsdt} USDT`}
            />

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Stop Loss Protection (%)"
                value={stopLossPct}
                onChange={e => setStopLossPct(e.target.value)}
                suffixText="%"
              />
              <Input
                label="Take Profit Target (%)"
                value={takeProfitPct}
                onChange={e => setTakeProfitPct(e.target.value)}
                suffixText="%"
              />
            </div>

            <div className="p-3 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2 text-xs">
              <div className="flex justify-between text-[#A1AFB8]">
                <span>Execution Mode</span>
                <span className="text-[#E4EBEF] font-medium">Proportional Position Sizing</span>
              </div>
              <div className="flex justify-between text-[#A1AFB8]">
                <span>Slippage Tolerance</span>
                <span className="text-[#E4EBEF] font-mono tabular-nums">0.10%</span>
              </div>
              <div className="flex justify-between text-[#A1AFB8]">
                <span>High-Water Mark Fee</span>
                <span className="text-[#E4EBEF] font-mono tabular-nums">
                  {selectedTrader.profitSharePct}% of net profits
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-[7px] bg-[#2C2415]/60 border border-[#D6A85C]/30 text-[11px] text-[#D6A85C]">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Past performance does not guarantee future returns. Margin allocation remains isolated to this copy sleeve.
              </span>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" size="md" className="flex-1" onClick={() => setIsCopyModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="md" className="flex-1" onClick={handleConfirmCopy}>
                Confirm & Copy
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
