/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/mobile/MobileHomeView.tsx
 * Dedicated Mobile Home dashboard with quick actions, favorites carousel, top gainers/losers, and market overview.
 */

import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Star,
  Eye,
  EyeOff,
  ChevronRight,
  Flame,
  Zap,
  ArrowRightLeft,
  Rocket
} from 'lucide-react';
import { TradingPairItem, UserBalance } from '../../types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice, formatPairVolume } from '../../lib/formatters.js';

interface MobileHomeViewProps {
  pairs: TradingPairItem[];
  balances: UserBalance[];
  onSelectPair: (pairId: string) => void;
  onNavigate: (view: string) => void;
}

export const MobileHomeView: React.FC<MobileHomeViewProps> = ({
  pairs,
  balances,
  onSelectPair,
  onNavigate,
}) => {
  const [hideBalance, setHideBalance] = useState(false);
  const [activeTab, setActiveTab] = useState<'GAINERS' | 'LOSERS' | 'VOLUME'>('GAINERS');

  const topGainers = [...pairs].sort((a, b) => {
    const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
    const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
    return chgB - chgA;
  }).slice(0, 5);

  const topLosers = [...pairs].sort((a, b) => {
    const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
    const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
    return chgA - chgB;
  }).slice(0, 5);

  const topVolume = [...pairs].sort((a, b) => {
    const volA = parseFloat(a.quoteVolume24h || a.volume24h || '0');
    const volB = parseFloat(b.quoteVolume24h || b.volume24h || '0');
    return volB - volA;
  }).slice(0, 5);

  const activeMarketList = activeTab === 'GAINERS' ? topGainers : activeTab === 'LOSERS' ? topLosers : topVolume;

  return (
    <div className="flex-1 flex flex-col p-4 pb-20 bg-[#08090D] overflow-y-auto select-none">
      {/* Mobile Balance Card */}
      <div className="rounded-2xl bg-gradient-to-b from-[#1C1F29] to-[#15171F] border border-[#292C38] p-4 shadow-xl mb-4">
        <div className="flex items-center justify-between text-[#969BA8] mb-1">
          <span className="text-xs font-medium">Total Assets (IDR)</span>
          <button
            onClick={() => setHideBalance(!hideBalance)}
            className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 text-[#686D7A]"
          >
            {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-2xl font-black text-[#F5F5F7] font-mono">
            {hideBalance ? 'Rp ••••••••' : 'Rp 28.450.000'}
          </h2>
          <span className="text-[11px] font-mono text-[#969BA8]">≈ $1,750.76</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-[#00C087] font-mono font-semibold mb-4">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>+$142.80 (+8.16%) Today</span>
        </div>

        {/* Quick Action Touch Targets (>= 44px) */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-[#292C38]/60 text-center">
          <button
            onClick={() => onNavigate('DEPOSIT')}
            className="min-h-[44px] flex flex-col items-center justify-center gap-1 text-[#F5F5F7] active:scale-95 transition-transform"
          >
            <div className="w-10 h-10 rounded-xl bg-[#EB3458]/15 border border-[#EB3458]/30 flex items-center justify-center text-[#EB3458]">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Deposit</span>
          </button>

          <button
            onClick={() => onNavigate('WITHDRAW')}
            className="min-h-[44px] flex flex-col items-center justify-center gap-1 text-[#F5F5F7] active:scale-95 transition-transform"
          >
            <div className="w-10 h-10 rounded-xl bg-[#1C1F29] border border-[#292C38] flex items-center justify-center text-[#F5F5F7]">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Withdraw</span>
          </button>

          <button
            onClick={() => onNavigate('FUTURES')}
            className="min-h-[44px] flex flex-col items-center justify-center gap-1 text-[#F5F5F7] active:scale-95 transition-transform"
          >
            <div className="w-10 h-10 rounded-xl bg-[#1C1F29] border border-[#292C38] flex items-center justify-center text-[#F5B942]">
              <Zap className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Futures</span>
          </button>

          <button
            onClick={() => onNavigate('EARN')}
            className="min-h-[44px] flex flex-col items-center justify-center gap-1 text-[#F5F5F7] active:scale-95 transition-transform"
          >
            <div className="w-10 h-10 rounded-xl bg-[#1C1F29] border border-[#292C38] flex items-center justify-center text-[#00C087]">
              <Flame className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Earn</span>
          </button>
        </div>
      </div>

      {/* Favorite Markets Horizontal Scroller */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-[#F5F5F7]">Favorite Markets</span>
          <button
            onClick={() => onNavigate('MARKETS')}
            className="text-[11px] font-semibold text-[#EB3458] flex items-center"
          >
            View All <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {pairs.slice(0, 4).map(p => {
            const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
            const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
            const isUp = chg >= 0;

            return (
              <button
                key={p.id}
                onClick={() => { onSelectPair(p.id); onNavigate('TRADE'); }}
                className="shrink-0 w-32 p-3 rounded-xl bg-[#15171F] border border-[#292C38] text-left active:border-[#EB3458] transition-all"
              >
                <div className="text-[11px] font-bold text-[#969BA8] font-mono">{sym}</div>
                <div className="text-xs font-extrabold text-[#F5F5F7] font-mono mt-0.5 truncate">
                  {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                </div>
                <div className={`text-[10px] font-mono font-bold mt-1 ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                  {isUp ? '+' : ''}{chg.toFixed(2)}%
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Listing Portal Mobile CTA Banner */}
      <button
        onClick={() => onNavigate('LISTING')}
        className="w-full mb-4 p-3.5 rounded-2xl bg-gradient-to-r from-[#15171F] via-[#1C1F29] to-[#15171F] border border-[#EB3458]/40 flex items-center justify-between text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EB3458]/15 border border-[#EB3458]/30 flex items-center justify-center text-[#EB3458]">
            <Rocket className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-[#F5F5F7] flex items-center gap-1.5">
              <span>Token Listing Portal</span>
              <span className="text-[9px] px-1 py-0.2 rounded bg-[#EB3458]/20 text-[#EB3458] font-bold">PORTAL</span>
            </div>
            <p className="text-[10px] text-[#969BA8]">Ajukan listing token baru atau lacak status review</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[#EB3458]" />
      </button>

      {/* Market Leaderboard Tabs */}
      <div className="rounded-2xl bg-[#15171F] border border-[#292C38] p-3 shadow-xl mb-4">
        <div className="flex items-center justify-between border-b border-[#292C38] pb-2 mb-2">
          <div className="flex items-center gap-4 text-xs font-semibold">
            <button
              onClick={() => setActiveTab('GAINERS')}
              className={`pb-1 transition-colors ${
                activeTab === 'GAINERS' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#686D7A]'
              }`}
            >
              Top Gainers
            </button>
            <button
              onClick={() => setActiveTab('LOSERS')}
              className={`pb-1 transition-colors ${
                activeTab === 'LOSERS' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#686D7A]'
              }`}
            >
              Top Losers
            </button>
            <button
              onClick={() => setActiveTab('VOLUME')}
              className={`pb-1 transition-colors ${
                activeTab === 'VOLUME' ? 'text-[#EB3458] border-b-2 border-[#EB3458]' : 'text-[#686D7A]'
              }`}
            >
              24h Volume
            </button>
          </div>
        </div>

        {/* List Items (Touch target >= 44px) */}
        <div className="divide-y divide-[#292C38]/40">
          {activeMarketList.map(p => {
            const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
            const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
            const isUp = chg >= 0;

            return (
              <button
                key={p.id}
                onClick={() => { onSelectPair(p.id); onNavigate('TRADE'); }}
                className="w-full min-h-[48px] py-2.5 flex items-center justify-between text-left active:bg-[#1C1F29]/60 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[#F5F5F7] font-mono block">{sym}</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-bold font-mono border ${
                      p.quoteCurrency === 'USDT'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    }`}>
                      {p.quoteCurrency}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#686D7A]">Vol: {formatPairVolume(p.quoteVolume24h || p.volume24h || '0', p.quoteCurrency, p.quoteDecimals)}</span>
                </div>

                <div className="text-right">
                  <span className="text-xs font-mono font-bold text-[#F5F5F7] block">
                    {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                  </span>
                  <span className={`text-[11px] font-mono font-semibold ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                    {isUp ? '+' : ''}{chg.toFixed(2)}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
