/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/overview/OverviewView.tsx
 * DOMINEX Master Homepage & Exchange Overview — Obsidian Glass Architecture
 */

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Zap,
  ShieldCheck,
  Flame,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  Globe,
  Lock,
  Layers,
  Clock,
  Activity,
  Bot,
  Users,
  Award,
  ArrowRight
} from 'lucide-react';
import { TradingPairItem, UserBalance, UserProfile } from '../../types/index.js';
import { formatIDR, formatCrypto } from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';

interface OverviewProps {
  pairs: TradingPairItem[];
  balances: UserBalance[];
  user: UserProfile | null;
  onNavigate: (view: string, pairId?: string) => void;
  onOpenAuthModal: () => void;
}

export const OverviewView: React.FC<OverviewProps> = ({
  pairs,
  balances,
  user,
  onNavigate,
  onOpenAuthModal,
}) => {
  // Live ticker assets with sparkline points
  const tickers = [
    {
      symbol: 'BTC/USDT',
      name: 'Bitcoin',
      price: '$91,840.50',
      change: '+4.28%',
      isPositive: true,
      sparkline: [88000, 89200, 88900, 90100, 91200, 90800, 91840],
      icon: '₿',
      pairId: 'BTC-IDR'
    },
    {
      symbol: 'ETH/USDT',
      name: 'Ethereum',
      price: '$2,842.10',
      change: '+3.15%',
      isPositive: true,
      sparkline: [2720, 2750, 2790, 2770, 2810, 2830, 2842],
      icon: 'Ξ',
      pairId: 'ETH-IDR'
    },
    {
      symbol: 'SOL/USDT',
      name: 'Solana',
      price: '$188.45',
      change: '+8.92%',
      isPositive: true,
      sparkline: [172, 175, 178, 181, 185, 184, 188.45],
      icon: '◎',
      pairId: 'SOL-IDR'
    },
    {
      symbol: 'BNB/USDT',
      name: 'BNB',
      price: '$645.20',
      change: '-0.85%',
      isPositive: false,
      sparkline: [652, 650, 648, 649, 647, 646, 645.2],
      icon: 'BNB',
      pairId: 'BNB-IDR'
    },
    {
      symbol: 'XRP/USDT',
      name: 'Ripple',
      price: '$2.14',
      change: '+14.60%',
      isPositive: true,
      sparkline: [1.82, 1.88, 1.94, 1.99, 2.05, 2.08, 2.14],
      icon: '✕',
      pairId: 'XRP-IDR'
    }
  ];

  // Market overview stats
  const marketCap = '$2.84 Trillion';
  const volume24h = '$98.40 Billion';
  const btcDominance = '56.8%';
  const fearGreed = { score: 68, label: 'Greed' };

  // Top Gainers & Losers from pairs
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

  // Mini sparkline SVG generator
  const renderSparkline = (points: number[], isPositive: boolean) => {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const width = 80;
    const height = 24;

    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke={isPositive ? '#16C784' : '#EA3943'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coords}
        />
      </svg>
    );
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto space-y-8">
      {/* 1. HERO SECTION — Obsidian Glass */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-10 relative overflow-hidden">
        {/* Soft Magenta/Violet Ambient Lighting */}
        <div className="absolute top-0 right-10 w-[500px] h-[500px] bg-[#FF087F]/12 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-20 right-60 w-[400px] h-[400px] bg-[#D926FF]/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-xs font-semibold text-[#FF087F]">
              <Sparkles className="w-3.5 h-3.5 text-[#FF087F]" />
              DOMINEX · Next-Generation Cryptocurrency Exchange
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold text-[#F5F5F7] tracking-tight leading-tight">
              Trade Beyond <span className="text-gradient-magenta">Limits.</span>
            </h1>

            <p className="text-sm lg:text-base text-[#9298A6] max-w-xl leading-relaxed">
              Discover a smarter way to trade digital assets. Access global crypto markets through one powerful trading platform with institutional-grade matching and zero compromise.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Button
                variant="gradient"
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
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onOpenAuthModal}
                >
                  Create Account
                </Button>
              )}
            </div>

            {/* Quick Proof Badges */}
            <div className="pt-4 flex items-center gap-6 text-xs text-[#9298A6] font-mono border-t border-white/5">
              <div>
                <span className="block text-[#F5F5F7] font-bold text-sm">99.999%</span>
                <span className="text-[10px]">Uptime SLA</span>
              </div>
              <div className="w-px h-6 bg-white/10" />
              <div>
                <span className="block text-[#F5F5F7] font-bold text-sm">&lt; 1.2 ms</span>
                <span className="text-[10px]">Order Execution</span>
              </div>
              <div className="w-px h-6 bg-white/10" />
              <div>
                <span className="block text-[#16C784] font-bold text-sm">104.2%</span>
                <span className="text-[10px]">Proof of Reserves</span>
              </div>
            </div>
          </div>

          {/* Hero Emblem Graphic — Obsidian Glass Geometric Core */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center">
              {/* Outer smoked glass ring */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#171923] via-[#0D1017] to-[#171923] border border-white/15 backdrop-blur-2xl shadow-2xl rotate-6 group-hover:rotate-0 transition-transform duration-500" />
              <div className="absolute inset-2 rounded-2xl bg-[#08090D]/90 border border-[#FF087F]/30 -rotate-3" />

              {/* Inner metallic emblem */}
              <div className="relative z-10 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#FF087F] to-[#D926FF] flex items-center justify-center shadow-lg shadow-[#FF087F]/40">
                  <Flame className="w-9 h-9 text-white fill-white" />
                </div>
                <div>
                  <span className="font-display font-extrabold text-xl text-white tracking-wider block">DOMINEX</span>
                  <span className="text-[10px] font-mono text-[#FF087F] tracking-widest uppercase">Obsidian Core Engine</span>
                </div>
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-[#9298A6]">
                  Matching Engine v4.2 Active
                </div>
              </div>

              {/* Floating badges */}
              <div className="absolute -top-3 -left-3 px-3 py-1.5 rounded-lg obsidian-glass border border-white/10 text-xs font-mono font-bold text-[#16C784] shadow-lg">
                BTC $91,840.50
              </div>
              <div className="absolute -bottom-3 -right-3 px-3 py-1.5 rounded-lg obsidian-glass border border-white/10 text-xs font-mono font-bold text-[#FF087F] shadow-lg">
                50x Perpetual
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. LIVE MARKET TICKER STRIP */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-sm text-[#F5F5F7] flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#FF087F]" />
            Live Market Ticker
          </h3>
          <button
            onClick={() => onNavigate('MARKETS')}
            className="text-xs font-semibold text-[#FF087F] hover:text-[#D926FF] flex items-center gap-1"
          >
            All Markets <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {tickers.map(ticker => (
            <div
              key={ticker.symbol}
              onClick={() => onNavigate('TRADE', ticker.pairId)}
              className="p-3.5 rounded-xl obsidian-glass border border-white/10 hover:border-[#FF087F]/40 cursor-pointer transition-all duration-150 group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-[#171923] border border-white/10 flex items-center justify-center font-bold text-xs text-[#F5F5F7]">
                    {ticker.icon}
                  </div>
                  <div>
                    <span className="font-display font-bold text-xs text-[#F5F5F7] group-hover:text-white block">
                      {ticker.symbol}
                    </span>
                    <span className="text-[10px] text-[#9298A6]">{ticker.name}</span>
                  </div>
                </div>

                <span className={`text-xs font-mono font-bold ${ticker.isPositive ? 'text-[#16C784]' : 'text-[#EA3943]'}`}>
                  {ticker.change}
                </span>
              </div>

              <div className="flex items-end justify-between mt-2 pt-2 border-t border-white/5 font-mono">
                <span className="text-sm font-extrabold text-[#F5F5F7]">
                  {ticker.price}
                </span>
                <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                  {renderSparkline(ticker.sparkline, ticker.isPositive)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. MARKET OVERVIEW & METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl obsidian-glass border border-white/10">
          <span className="text-[11px] text-[#9298A6] block">Crypto Market Cap</span>
          <span className="text-lg font-mono font-extrabold text-[#F5F5F7] mt-1 block">
            {marketCap}
          </span>
          <span className="text-[10px] font-mono text-[#16C784] mt-0.5 block">+3.82% today</span>
        </div>

        <div className="p-4 rounded-xl obsidian-glass border border-white/10">
          <span className="text-[11px] text-[#9298A6] block">24h Global Volume</span>
          <span className="text-lg font-mono font-extrabold text-[#F5F5F7] mt-1 block">
            {volume24h}
          </span>
          <span className="text-[10px] font-mono text-[#16C784] mt-0.5 block">High Liquidity</span>
        </div>

        <div className="p-4 rounded-xl obsidian-glass border border-white/10">
          <span className="text-[11px] text-[#9298A6] block">BTC Dominance</span>
          <span className="text-lg font-mono font-extrabold text-[#F5F5F7] mt-1 block">
            {btcDominance}
          </span>
          <span className="text-[10px] font-mono text-[#9298A6] mt-0.5 block">Market Leader</span>
        </div>

        <div className="p-4 rounded-xl obsidian-glass border border-white/10">
          <span className="text-[11px] text-[#9298A6] block">Fear & Greed Index</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg font-mono font-extrabold text-[#16C784]">
              {fearGreed.score}
            </span>
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[#16C784]/20 text-[#16C784]">
              {fearGreed.label}
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#9298A6] mt-0.5 block">Bullish Momentum</span>
        </div>
      </div>

      {/* 4. TOP GAINERS & HOT MARKETS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Gainers */}
        <div className="rounded-2xl obsidian-glass border border-white/10 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm text-[#F5F5F7] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#16C784]" />
              Top Gainers (24h)
            </h3>
            <button
              onClick={() => onNavigate('MARKETS')}
              className="text-xs text-[#FF087F] hover:text-[#D926FF]"
            >
              View All
            </button>
          </div>

          <div className="divide-y divide-white/5">
            {topGainers.map(p => {
              const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
              const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;

              return (
                <div
                  key={p.id}
                  onClick={() => onNavigate('TRADE', p.id)}
                  className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-white/5 px-2 rounded-lg transition-colors font-mono text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#171923] border border-white/10 flex items-center justify-center font-bold text-white text-xs">
                      {p.baseCurrency.slice(0, 3)}
                    </div>
                    <div>
                      <span className="font-bold text-[#F5F5F7] block">{sym}</span>
                      <span className="text-[10px] text-[#9298A6]">{p.baseCurrency}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-bold text-[#F5F5F7] block">
                      Rp {(parseFloat(p.lastPrice) / 100).toLocaleString()}
                    </span>
                    <span className="text-[11px] font-bold text-[#16C784]">
                      +{chg.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Losers / Opportunities */}
        <div className="rounded-2xl obsidian-glass border border-white/10 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold text-sm text-[#F5F5F7] flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-[#EA3943]" />
              Dip Opportunities
            </h3>
            <button
              onClick={() => onNavigate('MARKETS')}
              className="text-xs text-[#FF087F] hover:text-[#D926FF]"
            >
              View All
            </button>
          </div>

          <div className="divide-y divide-white/5">
            {topLosers.map(p => {
              const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
              const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;

              return (
                <div
                  key={p.id}
                  onClick={() => onNavigate('TRADE', p.id)}
                  className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-white/5 px-2 rounded-lg transition-colors font-mono text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-[#171923] border border-white/10 flex items-center justify-center font-bold text-white text-xs">
                      {p.baseCurrency.slice(0, 3)}
                    </div>
                    <div>
                      <span className="font-bold text-[#F5F5F7] block">{sym}</span>
                      <span className="text-[10px] text-[#9298A6]">{p.baseCurrency}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-bold text-[#F5F5F7] block">
                      Rp {(parseFloat(p.lastPrice) / 100).toLocaleString()}
                    </span>
                    <span className="text-[11px] font-bold text-[#EA3943]">
                      {chg.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. INSTITUTIONAL FEATURE HIGHLIGHTS */}
      <div className="rounded-2xl obsidian-glass border border-white/10 p-6 lg:p-8 space-y-6">
        <div>
          <h2 className="font-display font-extrabold text-xl text-[#F5F5F7]">
            Built for Serious Institutional & Retail Traders
          </h2>
          <p className="text-xs text-[#9298A6] mt-1">
            Engineered from first principles with double-entry immutability, zero-loss liquidation cascades, and ultra-high throughput.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-5 rounded-xl bg-[#0D1017] border border-white/5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-[#FF087F]/15 flex items-center justify-center text-[#FF087F]">
              <Zap className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-sm text-[#F5F5F7]">Advanced Trading Engine</h4>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Price-time priority matching with sub-millisecond execution and WebSocket order book feeds.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#0D1017] border border-white/5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-[#16C784]/15 flex items-center justify-center text-[#16C784]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-sm text-[#F5F5F7]">Institutional-Grade Security</h4>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Double-entry atomic ledger, cold wallet multi-sig isolation, and certified proof-of-reserves.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#0D1017] border border-white/5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-[#D926FF]/15 flex items-center justify-center text-[#D926FF]">
              <Layers className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-sm text-[#F5F5F7]">Deep Market Liquidity</h4>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Integrated market-making bots and aggregated global liquidity pools ensure tight spreads.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#0D1017] border border-white/5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-[#5B9DFF]/15 flex items-center justify-center text-[#5B9DFF]">
              <Globe className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-sm text-[#F5F5F7]">Global Market Access</h4>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Trade spot pairs, perpetual contracts with up to 50x leverage, and automated grid strategies seamlessly.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#0D1017] border border-white/5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-[#F5B942]/15 flex items-center justify-center text-[#F5B942]">
              <Activity className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-sm text-[#F5F5F7]">Ultra-Fast Execution</h4>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Low-latency memory-mapped book depth handles over 100,000 orders per second per market pair.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#0D1017] border border-white/5 space-y-2">
            <div className="w-9 h-9 rounded-lg bg-[#FF087F]/15 flex items-center justify-center text-[#FF087F]">
              <Clock className="w-5 h-5" />
            </div>
            <h4 className="font-display font-bold text-sm text-[#F5F5F7]">24/7 Global Support</h4>
            <p className="text-xs text-[#9298A6] leading-relaxed">
              Dedicated institutional account managers and 24/7 multilingual technical assistance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
