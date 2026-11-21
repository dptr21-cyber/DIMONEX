/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/overview/OverviewView.tsx
 * DIMONEX Master Homepage & Exchange Overview — Obsidian Iridium Institutional Architecture
 */

import React, { useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Zap,
  ShieldCheck,
  ChevronRight,
  Globe,
  Layers,
  Clock,
  Activity,
  ArrowRight,
  Wallet,
} from 'lucide-react';
import { TradingPairItem, UserBalance, UserProfile } from '../../types/index.js';
import { formatQuotePrice, formatPairVolume, formatCrypto, formatIDR } from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import {
  DimonexIcon,
  DIMONEX_HERO_BANNER_SRC,
  DIMONEX_EXCHANGE_BANNER_SRC,
} from '../ui/DimonexBrand.js';
import { PercentageChange } from '../ui/PriceDisplay.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { LoadingState, EmptyState } from '../ui/StateViews.js';
import { NewsCarousel } from '../news/NewsCarousel.js';

interface OverviewProps {
  pairs: TradingPairItem[];
  balances: UserBalance[];
  user: UserProfile | null;
  onNavigate: (view: string, pairId?: string) => void;
  onOpenAuthModal: () => void;
  onOpenArticle?: (slug: string) => void;
}

export const OverviewView: React.FC<OverviewProps> = ({
  pairs,
  balances,
  user,
  onNavigate,
  onOpenAuthModal,
  onOpenArticle,
}) => {
  // Select up to 5 featured live pairs directly from authoritative exchange pairs
  const featuredTickers = useMemo(() => {
    const preferredOrder = ['BTC-IDR', 'ETH-IDR', 'SOL-IDR', 'BTC-USDT', 'ETH-USDT'];
    const map = new Map(pairs.map(p => [p.id, p]));
    const selected: TradingPairItem[] = [];

    for (const id of preferredOrder) {
      const found = map.get(id);
      if (found) selected.push(found);
    }
    for (const p of pairs) {
      if (selected.length >= 5) break;
      if (!selected.some(s => s.id === p.id)) selected.push(p);
    }
    return selected;
  }, [pairs]);

  const topGainers = useMemo(() => {
    return [...pairs]
      .sort((a, b) => {
        const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
        const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
        return chgB - chgA;
      })
      .slice(0, 5);
  }, [pairs]);

  const topLosers = useMemo(() => {
    return [...pairs]
      .sort((a, b) => {
        const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
        const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
        return chgA - chgB;
      })
      .slice(0, 5);
  }, [pairs]);

  const exchangeMetrics = useMemo(() => {
    const activeCount = pairs.filter(p => p.isActive && !p.isHalted).length;
    const idrCount = pairs.filter(p => p.quoteCurrency === 'IDR').length;
    const usdtCount = pairs.filter(p => p.quoteCurrency === 'USDT').length;
    const leadGainer = topGainers[0];
    const leadChg = leadGainer
      ? parseFloat(leadGainer.priceChangePercent24h || leadGainer.priceChange24h?.replace('+', '') || '0')
      : 0;

    return { activeCount, idrCount, usdtCount, leadGainer, leadChg };
  }, [pairs, topGainers]);

  // Real authenticated user available IDR + active asset count
  const userSummary = useMemo(() => {
    if (!user) return null;
    const idrBal = balances.find(b => b.currency === 'IDR');
    const usdtBal = balances.find(b => b.currency === 'USDT');
    const nonZeroAssets = balances.filter(b => {
      try {
        return (
          BigInt(b.balanceAvailable || b.available || '0') > 0n ||
          BigInt(b.balanceLocked || b.locked || '0') > 0n
        );
      } catch {
        return false;
      }
    }).length;
    return {
      idrAvailable: idrBal ? formatIDR(idrBal.balanceAvailable || idrBal.available || '0') : 'Rp 0',
      usdtAvailable: usdtBal ? formatCrypto(usdtBal.balanceAvailable || usdtBal.available || '0', 6) : '0.00',
      nonZeroAssets,
    };
  }, [user, balances]);

  // Deterministic 24h range SVG curve from low/high/last
  const renderRangeCurve = (pair: TradingPairItem, isPositive: boolean) => {
    const low = parseFloat(pair.low24h || pair.lastPrice || '0');
    const high = parseFloat(pair.high24h || pair.lastPrice || '1');
    const last = parseFloat(pair.lastPrice || '0');
    const mid = (low + high) / 2;
    const pts = isPositive
      ? [low || last * 0.98, mid * 0.99, mid, (mid + high) / 2, last]
      : [high || last * 1.02, (mid + high) / 2, mid, mid * 0.99, last];

    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const width = 76;
    const height = 22;

    const coords = pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * width;
        const y = height - ((p - min) / range) * (height - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke={isPositive ? '#16A879' : '#EA5B65'}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords}
        />
      </svg>
    );
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-6">
      {/* 1. HERO SECTION — Obsidian Iridium Matte Instrument with Official DIMONEX Banner */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden shadow-sm">
        {/* Official DIMONEX Brand Hero Banner */}
        <div className="relative w-full bg-[#070A0F] border-b border-[#202B34] overflow-hidden">
          <img
            src={DIMONEX_HERO_BANNER_SRC}
            alt="DIMONEX — Precision in Every Trade"
            className="w-full max-h-[210px] sm:max-h-[250px] lg:max-h-[280px] object-contain object-center mx-auto select-none"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#141C24]/70 to-transparent" />
        </div>

        <div className="p-6 lg:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[5px] bg-[#17212B] border border-[#2B3944] text-[11px] font-mono font-medium text-[#A5BAC4] uppercase tracking-wider">
                <DimonexIcon size="xs" />
                <span>DIMONEX OBSIDIAN IRIDIUM · SPOT & QUANT EXCHANGE</span>
              </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-[#E4EBEF] tracking-tight leading-[1.15]">
              Precision in Every Trade.
            </h1>

            <p className="text-sm text-[#A1AFB8] max-w-xl leading-relaxed">
              Institutional cryptocurrency spot exchange powered by a zero-float BigInt atomic ledger, price-time priority matching, and direct IDR & USDT settlement.
            </p>

            <div className="pt-1 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                icon={<TrendingUp className="w-4 h-4" />}
                onClick={() => onNavigate('TRADE')}
              >
                Start Trading
              </Button>
              <Button
                variant="secondary"
                size="lg"
                icon={<ArrowRight className="w-4 h-4" />}
                onClick={() => onNavigate('MARKETS')}
              >
                Explore Markets
              </Button>
              {!user && (
                <Button variant="outline" size="lg" onClick={onOpenAuthModal}>
                  Sign In / Register
                </Button>
              )}
            </div>

            {/* Architecture Specs */}
            <div className="pt-4 grid grid-cols-3 gap-4 border-t border-[#202B34] max-w-lg font-mono tabular-nums">
              <div>
                <span className="block text-[#E4EBEF] font-semibold text-sm">
                  {pairs.length > 0 ? `${pairs.length} Pairs` : 'Live'}
                </span>
                <span className="text-[11px] text-[#71818B] font-sans">Active Markets</span>
              </div>
              <div>
                <span className="block text-[#E4EBEF] font-semibold text-sm">FIFO BigInt</span>
                <span className="text-[11px] text-[#71818B] font-sans">Zero-Float Matching</span>
              </div>
              <div>
                <span className="block text-[#35B887] font-semibold text-sm">Double-Entry</span>
                <span className="text-[11px] text-[#71818B] font-sans">Immutable Ledger</span>
              </div>
            </div>
          </div>

          {/* Right Panel: Live Primary Pair + Session Summary */}
          <div className="lg:col-span-5">
            <div className="rounded-[10px] bg-[#111820] border border-[#2B3944] p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#202B34]">
                <div className="flex items-center gap-2.5">
                  <DimonexIcon size="md" />
                  <div>
                    <span className="text-xs font-semibold text-[#E4EBEF] block">DIMONEX Core</span>
                    <span className="text-[10px] font-mono text-[#71818B] uppercase tracking-wider">
                      IDR & USDT Execution
                    </span>
                  </div>
                </div>
                <StatusBadge tone="success" dot>
                  Operational
                </StatusBadge>
              </div>

              {userSummary ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#71818B] flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-[#8DA5B1]" />
                      Account Balances
                    </span>
                    <button
                      type="button"
                      onClick={() => onNavigate('WALLET')}
                      className="text-[11px] font-medium text-[#8DA5B1] hover:text-[#C1D0D6] cursor-pointer"
                    >
                      Open Wallet →
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 font-mono tabular-nums">
                    <div className="p-3 rounded-[7px] bg-[#141C24] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">IDR Available</span>
                      <span className="text-xs sm:text-sm font-semibold text-[#E4EBEF] mt-0.5 block truncate">
                        {userSummary.idrAvailable}
                      </span>
                    </div>
                    <div className="p-3 rounded-[7px] bg-[#141C24] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">USDT Available</span>
                      <span className="text-xs sm:text-sm font-semibold text-[#E4EBEF] mt-0.5 block truncate">
                        {userSummary.usdtAvailable} USDT
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono text-[#71818B] flex items-center justify-between">
                    <span>Funded Asset Balances</span>
                    <span className="text-[#E4EBEF] font-semibold">{userSummary.nonZeroAssets} Assets</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <span className="text-[11px] font-mono text-[#71818B] uppercase tracking-wider block">
                    Live Reference Markets
                  </span>
                  {featuredTickers.slice(0, 3).map(p => {
                    const chg = p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onNavigate('TRADE', p.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-[7px] bg-[#141C24] hover:bg-[#17212B] border border-[#202B34] hover:border-[#2B3944] transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <AssetIcon symbol={p.baseCurrency} size="xs" />
                          <span className="text-xs font-mono font-semibold text-[#E4EBEF]">
                            {p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`}
                          </span>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <span className="text-xs font-semibold text-[#E4EBEF] mr-2">
                            {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                          </span>
                          <PercentageChange value={chg} size="xs" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* 2. LIVE MARKET TICKER STRIP (REAL EXCHANGE PAIRS) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-[#E4EBEF] flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#8DA5B1]" />
            <span>Live Exchange Markets</span>
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('MARKETS')}
            className="text-xs font-medium text-[#8DA5B1] hover:text-[#C1D0D6] flex items-center gap-1 cursor-pointer"
          >
            <span>All Markets</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {featuredTickers.length === 0 ? (
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34]">
            <LoadingState label="Synchronizing live market pairs..." />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {featuredTickers.map(pair => {
              const sym = pair.symbol || `${pair.baseCurrency}/${pair.quoteCurrency}`;
              const chgStr = pair.priceChangePercent24h || pair.priceChange24h?.replace('+', '') || '0';
              const chgNum = parseFloat(chgStr);
              const isPositive = chgNum >= 0;

              return (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => onNavigate('TRADE', pair.id)}
                  className="text-left p-3.5 rounded-[10px] bg-[#141C24] hover:bg-[#17212B] border border-[#202B34] hover:border-[#2B3944] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AssetIcon symbol={pair.baseCurrency} size="sm" />
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-xs text-[#E4EBEF] block truncate">
                          {sym}
                        </span>
                        <span className="text-[10px] font-mono text-[#71818B]">{pair.quoteCurrency} Spot</span>
                      </div>
                    </div>
                    <PercentageChange value={chgNum} size="xs" />
                  </div>

                  <div className="flex items-end justify-between mt-2.5 pt-2.5 border-t border-[#202B34] font-mono tabular-nums">
                    <div>
                      <span className="text-[10px] text-[#71818B] block">Last Price</span>
                      <span className="text-sm font-semibold text-[#E4EBEF]">
                        {formatQuotePrice(pair.lastPrice, pair.quoteCurrency, pair.quoteDecimals, true)}
                      </span>
                    </div>
                    {renderRangeCurve(pair, isPositive)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2B. LATEST NEWS & ANNOUNCEMENTS CAROUSEL (Real Backend API, Pinned First, Published Only) */}
      <NewsCarousel onOpenArticle={slug => onOpenArticle?.(slug)} />

      {/* 3. AUTHORITATIVE EXCHANGE METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] block">Active Spot Markets</span>
          <span className="text-lg font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1 block">
            {exchangeMetrics.activeCount} / {pairs.length}
          </span>
          <span className="text-[10px] font-mono text-[#8DA5B1] mt-0.5 block">Verified Order Books</span>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] block">Quote Coverage</span>
          <span className="text-lg font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1 block">
            {exchangeMetrics.idrCount} IDR · {exchangeMetrics.usdtCount} USDT
          </span>
          <span className="text-[10px] font-mono text-[#A1AFB8] mt-0.5 block">Multi-Quote Settlement</span>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] block">24h Leading Gainer</span>
          <span className="text-lg font-mono tabular-nums font-semibold text-[#E4EBEF] mt-1 block truncate">
            {exchangeMetrics.leadGainer
              ? exchangeMetrics.leadGainer.symbol || exchangeMetrics.leadGainer.id
              : '—'}
          </span>
          {exchangeMetrics.leadGainer && (
            <PercentageChange value={exchangeMetrics.leadChg} size="xs" />
          )}
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] block">Accounting Engine</span>
          <span className="text-lg font-mono font-semibold text-[#35B887] mt-1 block">
            Zero-Float BigInt
          </span>
          <span className="text-[10px] font-mono text-[#71818B] mt-0.5 block">SHA-256 Audit Trail</span>
        </div>
      </div>

      {/* 4. TOP GAINERS & DIP OPPORTUNITIES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Gainers */}
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#202B34]">
            <h3 className="font-semibold text-sm text-[#E4EBEF] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#16A879]" />
              <span>Top Gainers (24h)</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('MARKETS')}
              className="text-xs text-[#8DA5B1] hover:text-[#C1D0D6] cursor-pointer"
            >
              View All
            </button>
          </div>

          {topGainers.length === 0 ? (
            <EmptyState title="No market data" description="Market feed will populate once pairs load." />
          ) : (
            <div className="divide-y divide-[#202B34]">
              {topGainers.map(p => {
                const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
                const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onNavigate('TRADE', p.id)}
                    className="w-full flex items-center justify-between py-2.5 px-2 rounded-[7px] hover:bg-[#17212B] transition-colors font-mono text-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <AssetIcon symbol={p.baseCurrency} size="sm" />
                      <div className="text-left">
                        <span className="font-semibold text-[#E4EBEF] block">{sym}</span>
                        <span className="text-[10px] text-[#71818B]">
                          Vol {formatPairVolume(p.quoteVolume24h || p.volume24h || '0', p.quoteCurrency, p.quoteDecimals)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right tabular-nums">
                      <span className="font-semibold text-[#E4EBEF] block">
                        {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                      </span>
                      <PercentageChange value={chg} size="xs" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Losers / Watchlist */}
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#202B34]">
            <h3 className="font-semibold text-sm text-[#E4EBEF] flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-[#EA5B65]" />
              <span>24h Market Pullbacks</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('MARKETS')}
              className="text-xs text-[#8DA5B1] hover:text-[#C1D0D6] cursor-pointer"
            >
              View All
            </button>
          </div>

          {topLosers.length === 0 ? (
            <EmptyState title="No market data" description="Market feed will populate once pairs load." />
          ) : (
            <div className="divide-y divide-[#202B34]">
              {topLosers.map(p => {
                const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
                const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onNavigate('TRADE', p.id)}
                    className="w-full flex items-center justify-between py-2.5 px-2 rounded-[7px] hover:bg-[#17212B] transition-colors font-mono text-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <AssetIcon symbol={p.baseCurrency} size="sm" />
                      <div className="text-left">
                        <span className="font-semibold text-[#E4EBEF] block">{sym}</span>
                        <span className="text-[10px] text-[#71818B]">
                          Vol {formatPairVolume(p.quoteVolume24h || p.volume24h || '0', p.quoteCurrency, p.quoteDecimals)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right tabular-nums">
                      <span className="font-semibold text-[#E4EBEF] block">
                        {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                      </span>
                      <PercentageChange value={chg} size="xs" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. INSTITUTIONAL INFRASTRUCTURE HIGHLIGHTS */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#202B34]">
          <div className="max-w-xl">
            <h2 className="font-semibold text-base sm:text-lg text-[#E4EBEF]">
              Institutional Infrastructure & Financial Integrity
            </h2>
            <p className="text-xs text-[#A1AFB8] mt-1 leading-relaxed">
              Engineered with double-entry ledger immutability, deterministic FIFO matching, and real-time market depth synchronization.
            </p>
          </div>
          <div className="shrink-0 w-full md:w-72 rounded-[8px] bg-[#070A0F] border border-[#2B3944] overflow-hidden">
            <img
              src={DIMONEX_EXCHANGE_BANNER_SRC}
              alt="DIMONEX Crypto Exchange"
              className="w-full h-24 object-cover object-center select-none"
              draggable={false}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#1D2832] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
              <Zap className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-sm text-[#E4EBEF]">FIFO Matching Engine</h4>
            <p className="text-xs text-[#71818B] leading-relaxed">
              Price-time priority order matching with WebSocket order book updates and strict tick/lot validation.
            </p>
          </div>

          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#12392F] border border-[#16A879]/30 flex items-center justify-center text-[#16A879]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-sm text-[#E4EBEF]">Double-Entry Atomic Ledger</h4>
            <p className="text-xs text-[#71818B] leading-relaxed">
              Every trade, deposit, and fee settlement balances identically to zero using fixed-precision BigInt math.
            </p>
          </div>

          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#162436] border border-[#6D9FE8]/30 flex items-center justify-center text-[#6D9FE8]">
              <Layers className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-sm text-[#E4EBEF]">Quantitative Market Making</h4>
            <p className="text-xs text-[#71818B] leading-relaxed">
              Built-in HFT ladder, external follow liquidity, portfolio rebalance, and ledger backtesting engines.
            </p>
          </div>

          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#1D2832] border border-[#2B3944] flex items-center justify-center text-[#A5BAC4]">
              <Globe className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-sm text-[#E4EBEF]">Dual IDR & USDT Pairs</h4>
            <p className="text-xs text-[#71818B] leading-relaxed">
              Seamlessly quote and settle across Indonesian Rupiah (2 decimals) and Tether USD (6 decimals).
            </p>
          </div>

          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#2C2415] border border-[#D6A85C]/30 flex items-center justify-center text-[#D6A85C]">
              <Activity className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-sm text-[#E4EBEF]">Maker-Checker Governance</h4>
            <p className="text-xs text-[#71818B] leading-relaxed">
              Role-isolated administrative workflows and automated AML compliance screening for token listings.
            </p>
          </div>

          <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] space-y-2">
            <div className="w-8 h-8 rounded-[7px] bg-[#1D2832] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
              <Clock className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-sm text-[#E4EBEF]">24/7 Telemetry & Audit</h4>
            <p className="text-xs text-[#71818B] leading-relaxed">
              Real-time execution latency telemetry, cryptographic log trails, and automated snapshot recovery.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
