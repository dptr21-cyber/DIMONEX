/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/mobile/MobileHomeView.tsx
 * Dedicated Mobile Home dashboard with real portfolio totals, quick actions, favorites carousel, and market overview.
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  ChevronRight,
  Flame,
  Zap,
  Rocket,
  Wallet
} from 'lucide-react';
import { TradingPairItem, UserBalance } from '../../types/index.js';
import { formatQuotePrice, formatPairVolume, safeBigInt } from '../../lib/formatters.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { DIMONEX_HERO_BANNER_SRC } from '../ui/DimonexBrand.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { SegmentedTabs } from '../ui/Tabs.js';

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

  const usdtIdrRate = useMemo(() => {
    const usdtIdr = pairs.find(p => p.baseCurrency === 'USDT' && p.quoteCurrency === 'IDR');
    if (usdtIdr && usdtIdr.lastPrice) {
      const dec = usdtIdr.quoteDecimals ?? 2;
      const rate = Number(safeBigInt(usdtIdr.lastPrice)) / (10 ** dec);
      if (rate > 0) return rate;
    }
    return 16350;
  }, [pairs]);

  const { totalIdr, totalUsdt, activeBalanceCount } = useMemo(() => {
    let sumIdr = 0;
    let nonZeroAssets = 0;

    balances.forEach(b => {
      const curr = (b.currency || '').toUpperCase();
      const dec = curr === 'IDR' ? 2 : curr === 'USDT' ? 6 : 8;
      const divisor = 10 ** dec;
      const avail =
        parseFloat(b.displayAvailable) ||
        parseFloat(b.available as string) ||
        parseFloat(b.balanceAvailable) / divisor ||
        0;
      const locked =
        parseFloat(b.displayLocked) ||
        parseFloat(b.locked as string) ||
        parseFloat(b.balanceLocked) / divisor ||
        0;
      const qty = avail + locked;
      if (qty <= 0) return;

      nonZeroAssets += 1;

      if (curr === 'IDR') {
        sumIdr += qty;
        return;
      }

      if (curr === 'USDT') {
        sumIdr += qty * usdtIdrRate;
        return;
      }

      const idrPair = pairs.find(p => p.baseCurrency === curr && p.quoteCurrency === 'IDR');
      if (idrPair && idrPair.lastPrice) {
        const pDec = idrPair.quoteDecimals ?? 2;
        const pxIdr = Number(safeBigInt(idrPair.lastPrice)) / (10 ** pDec);
        if (pxIdr > 0) {
          sumIdr += qty * pxIdr;
          return;
        }
      }

      const usdtPair = pairs.find(p => p.baseCurrency === curr && p.quoteCurrency === 'USDT');
      if (usdtPair && usdtPair.lastPrice) {
        const pDec = usdtPair.quoteDecimals ?? 6;
        const pxUsdt = Number(safeBigInt(usdtPair.lastPrice)) / (10 ** pDec);
        if (pxUsdt > 0) {
          sumIdr += qty * pxUsdt * usdtIdrRate;
        }
      }
    });

    return {
      totalIdr: sumIdr,
      totalUsdt: usdtIdrRate > 0 ? sumIdr / usdtIdrRate : 0,
      activeBalanceCount: nonZeroAssets,
    };
  }, [balances, pairs, usdtIdrRate]);

  const topGainers = useMemo(
    () =>
      [...pairs]
        .sort((a, b) => {
          const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
          const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
          return chgB - chgA;
        })
        .slice(0, 5),
    [pairs]
  );

  const topLosers = useMemo(
    () =>
      [...pairs]
        .sort((a, b) => {
          const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
          const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
          return chgA - chgB;
        })
        .slice(0, 5),
    [pairs]
  );

  const topVolume = useMemo(
    () =>
      [...pairs]
        .sort((a, b) => {
          const volA = parseFloat(a.quoteVolume24h || a.volume24h || '0');
          const volB = parseFloat(b.quoteVolume24h || b.volume24h || '0');
          return volB - volA;
        })
        .slice(0, 5),
    [pairs]
  );

  const activeMarketList = activeTab === 'GAINERS' ? topGainers : activeTab === 'LOSERS' ? topLosers : topVolume;

  const formattedTotalIdr = `Rp ${Math.round(totalIdr).toLocaleString('id-ID')}`;
  const formattedTotalUsdt = totalUsdt.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="flex-1 flex flex-col p-4 pb-20 bg-[#090D12] overflow-y-auto select-none space-y-4">
      {/* Official DIMONEX Mobile Brand Banner */}
      <div className="rounded-[10px] bg-[#070A0F] border border-[#202B34] overflow-hidden px-3 py-2.5 shadow-sm">
        <img
          src={DIMONEX_HERO_BANNER_SRC}
          alt="DIMONEX — Precision in Every Trade"
          className="w-full max-h-[96px] object-contain object-center mx-auto select-none"
          draggable={false}
        />
      </div>

      {/* Mobile Balance Card */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 shadow-sm">
        <div className="flex items-center justify-between text-[#A1AFB8] mb-1">
          <div className="flex items-center gap-2">
            <Wallet className="w-3.5 h-3.5 text-[#8DA5B1]" />
            <span className="text-xs font-medium">Total Assets (IDR)</span>
          </div>
          <button
            type="button"
            onClick={() => setHideBalance(!hideBalance)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center -mr-2 text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
            aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
          >
            {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
          <h2 className="text-2xl font-semibold text-[#E4EBEF] font-mono tabular-nums tracking-tight">
            {hideBalance ? 'Rp ••••••••' : formattedTotalIdr}
          </h2>
          <span className="text-[11px] font-mono tabular-nums text-[#71818B]">
            {hideBalance ? '≈ $•••• USDT' : `≈ $${formattedTotalUsdt} USDT`}
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-[#71818B] mb-4">
          <StatusBadge tone="brand" dot>
            {activeBalanceCount} Active {activeBalanceCount === 1 ? 'Asset' : 'Assets'}
          </StatusBadge>
          <span className="font-mono tabular-nums">1 USDT ≈ Rp {usdtIdrRate.toLocaleString('id-ID')}</span>
        </div>

        {/* Quick Action Touch Targets (>= 44px) */}
        <div className="grid grid-cols-4 gap-2 pt-3 border-t border-[#202B34] text-center">
          <button
            type="button"
            onClick={() => onNavigate('DEPOSIT')}
            className="min-h-[48px] py-1.5 flex flex-col items-center justify-center gap-1 text-[#E4EBEF] hover:bg-[#17212B] rounded-[7px] transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-[7px] bg-[#12392F] border border-[#16A879]/30 flex items-center justify-center text-[#16A879]">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Deposit</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('WITHDRAW')}
            className="min-h-[48px] py-1.5 flex flex-col items-center justify-center gap-1 text-[#E4EBEF] hover:bg-[#17212B] rounded-[7px] transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Withdraw</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('FUTURES')}
            className="min-h-[48px] py-1.5 flex flex-col items-center justify-center gap-1 text-[#E4EBEF] hover:bg-[#17212B] rounded-[7px] transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#D6A85C]">
              <Zap className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Futures</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('EARN')}
            className="min-h-[48px] py-1.5 flex flex-col items-center justify-center gap-1 text-[#E4EBEF] hover:bg-[#17212B] rounded-[7px] transition-colors cursor-pointer"
          >
            <div className="w-10 h-10 rounded-[7px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#35B887]">
              <Flame className="w-5 h-5" />
            </div>
            <span className="text-[11px] font-medium">Earn</span>
          </button>
        </div>
      </div>

      {/* Featured Markets Horizontal Scroller */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#E4EBEF]">Active Markets</span>
          <button
            type="button"
            onClick={() => onNavigate('MARKETS')}
            className="min-h-[36px] px-1 text-[11px] font-medium text-[#8DA5B1] hover:text-[#C1D0D6] flex items-center gap-0.5 cursor-pointer"
          >
            View All <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
          {pairs.slice(0, 5).map(p => {
            const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
            const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
            const isUp = chg >= 0;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelectPair(p.id);
                  onNavigate('TRADE');
                }}
                className="shrink-0 w-36 min-h-[44px] p-3 rounded-[10px] bg-[#141C24] border border-[#202B34] hover:border-[#40515D] text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <AssetIcon symbol={p.baseCurrency} size="xs" />
                  <span className="text-[11px] font-semibold text-[#A1AFB8] font-mono truncate">{sym}</span>
                </div>
                <div className="text-xs font-semibold text-[#E4EBEF] font-mono tabular-nums truncate">
                  {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                </div>
                <div className={`text-[10px] font-mono tabular-nums font-medium mt-1 ${isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                  {isUp ? '+' : ''}{chg.toFixed(2)}%
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Listing Portal Mobile CTA Banner */}
      <button
        type="button"
        onClick={() => onNavigate('LISTING')}
        className="w-full min-h-[56px] p-3.5 rounded-[10px] bg-[#141C24] border border-[#2B3944] hover:border-[#40515D] flex items-center justify-between text-left transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-[7px] bg-[#1D2832] border border-[#40515D] flex items-center justify-center text-[#8DA5B1] shrink-0">
            <Rocket className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-1.5">
              <span className="truncate">Token Listing Portal</span>
              <StatusBadge tone="brand">PORTAL</StatusBadge>
            </div>
            <p className="text-[11px] text-[#71818B] truncate">Ajukan listing token baru atau lacak status review</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-[#8DA5B1] shrink-0" />
      </button>

      {/* Market Leaderboard Tabs */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-3">
        <div className="mb-3">
          <SegmentedTabs
            fullWidth
            size="sm"
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'GAINERS', label: 'Top Gainers' },
              { id: 'LOSERS', label: 'Top Losers' },
              { id: 'VOLUME', label: '24h Volume' },
            ]}
          />
        </div>

        {/* List Items (Touch target >= 48px) */}
        <div className="divide-y divide-[#202B34]">
          {activeMarketList.map(p => {
            const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
            const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
            const isUp = chg >= 0;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelectPair(p.id);
                  onNavigate('TRADE');
                }}
                className="w-full min-h-[52px] py-2.5 px-1 flex items-center justify-between text-left hover:bg-[#17212B] rounded-[7px] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <AssetIcon symbol={p.baseCurrency} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-[#E4EBEF] font-mono">{sym}</span>
                      <StatusBadge tone={p.quoteCurrency === 'USDT' ? 'buy' : 'info'}>
                        {p.quoteCurrency}
                      </StatusBadge>
                    </div>
                    <span className="text-[10px] text-[#71818B] font-mono tabular-nums block">
                      Vol: {formatPairVolume(p.quoteVolume24h || p.volume24h || '0', p.quoteCurrency, p.quoteDecimals)}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0 ml-2">
                  <span className="text-xs font-mono tabular-nums font-semibold text-[#E4EBEF] block">
                    {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                  </span>
                  <span className={`text-[11px] font-mono tabular-nums font-medium ${isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
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
