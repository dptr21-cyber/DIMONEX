/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/copy/CopyTradingView.tsx
 * DOMINEX Institutional Copy Trading Terminal — Obsidian Glass Design
 */

import React, { useState } from 'react';
import {
  TrendingUp,
  Users,
  ShieldAlert,
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  CheckCircle2,
  Clock,
  Sparkles,
  ChevronRight,
  X,
  AlertCircle
} from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
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
  displayCurrency,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'LEADERBOARD' | 'MY_COPIES' | 'BECOME_TRADER'>('LEADERBOARD');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'roi30d' | 'winRate' | 'followers' | 'aum'>('roi30d');
  const [selectedTrader, setSelectedTrader] = useState<LeadTrader | null>(null);
  const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

  // Copy modal form
  const [copyAmount, setCopyAmount] = useState('500');
  const [stopLossPct, setStopLossPct] = useState('15');
  const [takeProfitPct, setTakeProfitPct] = useState('50');
  const [copyMode, setCopyMode] = useState<'FIXED_RATIO' | 'FIXED_AMOUNT'>('FIXED_RATIO');

  // Active copies state
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
    .filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || t.handle.toLowerCase().includes(search.toLowerCase()))
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
      openTrades: [
        { pair: 'BTC/USDT', side: 'LONG', leverage: '10x', pnlPct: 0.2 }
      ]
    };

    setMyCopies(prev => [newCopy, ...prev]);
    setIsCopyModalOpen(false);
    showToast('success', 'Copy Trading Activated', `Successfully started mirroring ${selectedTrader.name} with ${amountNum} USDT.`);
    setActiveTab('MY_COPIES');
  };

  const handleStopCopy = (id: string, name: string) => {
    setMyCopies(prev => prev.filter(c => c.id !== id));
    showToast('info', 'Copy Trading Terminated', `Positions closed and allocation returned to Spot wallet from ${name}.`);
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF087F]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-32 w-80 h-80 bg-[#D926FF]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-3xl relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-[#FF087F] mb-3">
            <Sparkles className="w-3.5 h-3.5 text-[#FF087F]" />
            DOMINEX Institutional Copy Trading
          </div>
          <h1 className="text-2xl lg:text-3xl font-display font-extrabold text-[#F5F5F7] tracking-tight">
            Mirror Top Global Traders in Real-Time
          </h1>
          <p className="text-xs lg:text-sm text-[#9298A6] mt-2 leading-relaxed">
            Automatically replicate audited positions from elite quantitative algorithms and institutional macro traders. Fully isolated margin with customizable stop-loss controls.
          </p>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => setActiveTab('LEADERBOARD')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all ${
                activeTab === 'LEADERBOARD'
                  ? 'bg-[#FF087F] text-white shadow-lg shadow-[#FF087F]/25 font-semibold'
                  : 'bg-[#171923] text-[#9298A6] hover:text-white border border-white/10'
              }`}
            >
              Trader Leaderboard
            </button>
            <button
              onClick={() => setActiveTab('MY_COPIES')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${
                activeTab === 'MY_COPIES'
                  ? 'bg-[#FF087F] text-white shadow-lg shadow-[#FF087F]/25 font-semibold'
                  : 'bg-[#171923] text-[#9298A6] hover:text-white border border-white/10'
              }`}
            >
              My Copied Traders
              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/10 text-white">
                {myCopies.length}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Tab: Leaderboard */}
      {activeTab === 'LEADERBOARD' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl obsidian-glass border border-white/10">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#9298A6] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search lead traders by name or handle..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#0D1017] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#F5F5F7] placeholder-[#686D7A] focus:outline-none focus:border-[#FF087F]"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs overflow-x-auto">
              <span className="text-[#9298A6] text-[11px] mr-1 shrink-0">Sort by:</span>
              <button
                onClick={() => setSortBy('roi30d')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  sortBy === 'roi30d' ? 'bg-[#FF087F]/20 text-[#FF087F] border border-[#FF087F]/40' : 'text-[#9298A6] hover:text-white'
                }`}
              >
                30D ROI
              </button>
              <button
                onClick={() => setSortBy('winRate')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  sortBy === 'winRate' ? 'bg-[#FF087F]/20 text-[#FF087F] border border-[#FF087F]/40' : 'text-[#9298A6] hover:text-white'
                }`}
              >
                Win Rate
              </button>
              <button
                onClick={() => setSortBy('followers')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  sortBy === 'followers' ? 'bg-[#FF087F]/20 text-[#FF087F] border border-[#FF087F]/40' : 'text-[#9298A6] hover:text-white'
                }`}
              >
                Followers
              </button>
              <button
                onClick={() => setSortBy('aum')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  sortBy === 'aum' ? 'bg-[#FF087F]/20 text-[#FF087F] border border-[#FF087F]/40' : 'text-[#9298A6] hover:text-white'
                }`}
              >
                AUM
              </button>
            </div>
          </div>

          {/* Traders Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTraders.map(trader => {
              const isFull = trader.followers >= trader.maxFollowers;

              return (
                <div
                  key={trader.id}
                  className="rounded-xl obsidian-glass border border-white/10 p-5 flex flex-col justify-between hover:border-[#FF087F]/40 transition-all duration-200 group"
                >
                  <div>
                    {/* Trader Header */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#171923] to-[#202433] border border-white/10 flex items-center justify-center font-display font-bold text-white text-sm shadow-md group-hover:border-[#FF087F]/50 transition-colors">
                          {trader.avatarInitial}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-display font-bold text-sm text-[#F5F5F7] group-hover:text-white">
                              {trader.name}
                            </span>
                            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-[#FF087F]/15 text-[#FF087F] border border-[#FF087F]/30">
                              {trader.badge}
                            </span>
                          </div>
                          <span className="text-[11px] text-[#9298A6]">{trader.handle}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-[#9298A6] block">Risk Score</span>
                        <span className={`text-xs font-mono font-bold ${
                          trader.riskScore <= 3 ? 'text-[#16C784]' : trader.riskScore <= 6 ? 'text-[#F5B942]' : 'text-[#EA3943]'
                        }`}>
                          {trader.riskScore}/10
                        </span>
                      </div>
                    </div>

                    {/* Performance Metrics */}
                    <div className="grid grid-cols-2 gap-2.5 p-3 rounded-lg bg-[#0D1017]/80 border border-white/5 mb-4">
                      <div>
                        <span className="text-[10px] text-[#9298A6] block">30D ROI</span>
                        <span className="text-base font-mono font-extrabold text-[#16C784]">
                          +{trader.roi30d.toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#9298A6] block">90D ROI</span>
                        <span className="text-sm font-mono font-bold text-[#16C784]">
                          +{trader.roi90d.toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#9298A6] block">Win Rate</span>
                        <span className="text-xs font-mono font-bold text-[#F5F5F7]">
                          {trader.winRate}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#9298A6] block">Max Drawdown</span>
                        <span className="text-xs font-mono font-bold text-[#EA3943]">
                          -{trader.maxDrawdown}%
                        </span>
                      </div>
                    </div>

                    {/* Metadata strip */}
                    <div className="flex items-center justify-between text-[11px] text-[#9298A6] mb-4 pb-2 border-b border-white/5">
                      <span>AUM: <strong className="text-[#F5F5F7] font-mono">{trader.aum}</strong></span>
                      <span>Followers: <strong className="text-[#F5F5F7] font-mono">{trader.followers}/{trader.maxFollowers}</strong></span>
                      <span>Profit Share: <strong className="text-[#F5F5F7] font-mono">{trader.profitSharePct}%</strong></span>
                    </div>

                    {/* Traded pairs */}
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-[10px] text-[#9298A6]">Pairs:</span>
                      {trader.recentPairs.map(p => (
                        <span key={p} className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-white/5 text-[#C5C9D4] border border-white/5">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>

                  <Button
                    variant={isFull ? 'secondary' : 'gradient'}
                    size="sm"
                    className="w-full"
                    disabled={isFull}
                    onClick={() => handleOpenCopy(trader)}
                  >
                    {isFull ? 'Trader Full' : 'Copy Trader'}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: My Copied Positions */}
      {activeTab === 'MY_COPIES' && (
        <div className="space-y-4">
          {myCopies.length === 0 ? (
            <div className="p-12 text-center rounded-xl obsidian-glass border border-white/10 space-y-3">
              <Users className="w-12 h-12 text-[#9298A6] mx-auto opacity-50" />
              <h3 className="text-base font-bold text-[#F5F5F7]">No Active Copy Trading Portfolios</h3>
              <p className="text-xs text-[#9298A6] max-w-md mx-auto">
                Explore the verified leaderboard to allocate capital to institutional-grade traders.
              </p>
              <Button variant="primary" size="sm" onClick={() => setActiveTab('LEADERBOARD')}>
                Browse Leaderboard
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {myCopies.map(copy => (
                <div key={copy.id} className="rounded-xl obsidian-glass border border-white/10 p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-display font-bold text-[#F5F5F7]">{copy.traderName}</span>
                        <span className="text-xs text-[#9298A6]">{copy.handle}</span>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-[#16C784]/15 text-[#16C784] border border-[#16C784]/30">
                          {copy.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#9298A6]">Copied for {copy.startedDaysAgo} days</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-[10px] text-[#9298A6] block">Net Copied PnL</span>
                        <span className="text-sm font-mono font-extrabold text-[#16C784]">
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
                    <div className="p-2.5 rounded-lg bg-[#0D1017]">
                      <span className="text-[10px] text-[#9298A6] block">Allocated Capital</span>
                      <span className="font-mono font-bold text-[#F5F5F7]">${copy.allocatedUsdt.toFixed(2)} USDT</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0D1017]">
                      <span className="text-[10px] text-[#9298A6] block">Current Valuation</span>
                      <span className="font-mono font-bold text-[#F5F5F7]">${copy.currentValue.toFixed(2)} USDT</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0D1017]">
                      <span className="text-[10px] text-[#9298A6] block">Active Positions</span>
                      <span className="font-mono font-bold text-[#F5F5F7]">{copy.openTrades.length} Trades</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0D1017]">
                      <span className="text-[10px] text-[#9298A6] block">Risk Guard</span>
                      <span className="font-mono font-bold text-[#16C784]">Max SL 15%</span>
                    </div>
                  </div>

                  {/* Open Mirrored Trades */}
                  <div>
                    <span className="text-xs font-semibold text-[#9298A6] block mb-2">Live Mirrored Trades</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {copy.openTrades.map((trade, idx) => (
                        <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-[#0D1017]/80 border border-white/5 text-xs font-mono">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#16C784]/20 text-[#16C784] font-bold">
                              {trade.side}
                            </span>
                            <span className="text-[#F5F5F7] font-semibold">{trade.pair}</span>
                            <span className="text-[#9298A6] text-[10px]">{trade.leverage}</span>
                          </div>
                          <span className="text-[#16C784] font-bold">+{trade.pnlPct}%</span>
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

      {/* Copy Configuration Modal */}
      {isCopyModalOpen && selectedTrader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md rounded-2xl obsidian-glass border border-white/10 p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setIsCopyModalOpen(false)}
              className="absolute top-4 right-4 text-[#9298A6] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF087F] to-[#D926FF] flex items-center justify-center font-display font-bold text-white text-sm">
                  {selectedTrader.avatarInitial}
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-[#F5F5F7]">
                    Copy {selectedTrader.name}
                  </h3>
                  <span className="text-xs text-[#9298A6]">{selectedTrader.handle} · Profit share: {selectedTrader.profitSharePct}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <Input
                label="Copy Investment Amount (USDT)"
                value={copyAmount}
                onChange={e => setCopyAmount(e.target.value)}
                suffixText="USDT"
                actionText="Available: 5,420 USDT"
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

              <div className="p-3 rounded-lg bg-[#0D1017] border border-white/5 space-y-2 text-xs">
                <div className="flex justify-between text-[#9298A6]">
                  <span>Execution Mode</span>
                  <span className="text-[#F5F5F7] font-semibold">Proportional Position Sizing</span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>Slippage Tolerance</span>
                  <span className="text-[#F5F5F7] font-mono">0.10%</span>
                </div>
                <div className="flex justify-between text-[#9298A6]">
                  <span>High-Water Mark Fee</span>
                  <span className="text-[#F5F5F7] font-mono">{selectedTrader.profitSharePct}% of net profits only</span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#FF087F]/10 border border-[#FF087F]/20 text-[11px] text-[#FF087F]">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Past performance is audited but does not guarantee future returns. Position sizing is strictly isolated.</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setIsCopyModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="gradient"
                size="md"
                className="flex-1"
                onClick={handleConfirmCopy}
              >
                Confirm & Copy
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
