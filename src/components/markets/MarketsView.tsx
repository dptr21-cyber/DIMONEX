/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/markets/MarketsView.tsx
 * Comprehensive cryptocurrency markets explorer with search, sorting, gainers/losers, and favorites.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Search, Star, ArrowUpDown, TrendingUp, TrendingDown, ChevronRight, Zap, Rocket, Sparkles, Clock, ArrowRight, ShieldCheck } from 'lucide-react';
import { TradingPairItem } from '../../types/index.js';
import { formatIDR, formatCrypto, formatQuotePrice, formatPairVolume } from '../../lib/formatters.js';
import { safeFetchJson } from '../../lib/safeFetch.js';

interface MarketsViewProps {
  pairs: TradingPairItem[];
  selectedPairId: string;
  onSelectPair: (pairId: string) => void;
  onNavigateTrade: (pairId: string, mode?: 'SPOT' | 'FUTURES') => void;
  displayCurrency: 'USDT' | 'IDR';
}

type MarketCategory = 'ALL' | 'IDR' | 'USDT' | 'SPOT' | 'NEW_LISTINGS' | 'UPCOMING' | 'FUTURES' | 'FAVORITES' | 'GAINERS' | 'LOSERS';
type SortField = 'symbol' | 'lastPrice' | 'change' | 'volume';
type SortOrder = 'asc' | 'desc';

export const MarketsView: React.FC<MarketsViewProps> = ({
  pairs,
  selectedPairId,
  onSelectPair,
  onNavigateTrade,
  displayCurrency,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<MarketCategory>('ALL');
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [newListings, setNewListings] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('dimonex_favorites');
      return saved ? new Set(JSON.parse(saved)) : new Set(['BTC-IDR', 'ETH-IDR', 'SOL-IDR']);
    } catch {
      return new Set(['BTC-IDR', 'ETH-IDR', 'SOL-IDR']);
    }
  });

  useEffect(() => {
    safeFetchJson<any>('/api/markets').then(res => {
      if (res.ok && res.data?.newListings) {
        setNewListings(res.data.newListings);
      }
    }).catch(() => {});
  }, []);

  const toggleFavorite = (e: React.MouseEvent, pairId: string) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(pairId)) next.delete(pairId);
      else next.add(pairId);
      localStorage.setItem('dimonex_favorites', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const filteredAndSortedPairs = useMemo(() => {
    return pairs
      .filter(p => {
        const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
        const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
        const matchesSearch =
          sym.toLowerCase().includes(search.toLowerCase()) ||
          p.baseCurrency.toLowerCase().includes(search.toLowerCase());

        if (!matchesSearch) return false;

        if (category === 'FAVORITES') return favorites.has(p.id);
        if (category === 'NEW_LISTINGS') return p.isNewListing || p.baseCurrency === 'SOL' || p.baseCurrency === 'TON';
        if (category === 'IDR') return p.quoteCurrency === 'IDR';
        if (category === 'USDT') return p.quoteCurrency === 'USDT';
        if (category === 'SPOT') return true;
        if (category === 'GAINERS') return chg > 0;
        if (category === 'LOSERS') return chg < 0;
        return true;
      })
      .sort((a, b) => {
        const symA = a.symbol || `${a.baseCurrency}/${a.quoteCurrency}`;
        const symB = b.symbol || `${b.baseCurrency}/${b.quoteCurrency}`;
        const chgA = parseFloat(a.priceChangePercent24h || a.priceChange24h?.replace('+', '') || '0');
        const chgB = parseFloat(b.priceChangePercent24h || b.priceChange24h?.replace('+', '') || '0');
        const volA = parseFloat(a.quoteVolume24h || a.volume24h || '0');
        const volB = parseFloat(b.quoteVolume24h || b.volume24h || '0');

        let diff = 0;
        if (sortField === 'symbol') diff = symA.localeCompare(symB);
        else if (sortField === 'lastPrice') diff = parseFloat(a.lastPrice) - parseFloat(b.lastPrice);
        else if (sortField === 'change') diff = chgA - chgB;
        else if (sortField === 'volume') diff = volA - volB;
        return sortOrder === 'asc' ? diff : -diff;
      });
  }, [pairs, search, category, sortField, sortOrder, favorites]);

  // Mini sparkline SVG generator
  const renderSparkline = (changePct: number) => {
    const isUp = changePct >= 0;
    const points = isUp
      ? '0,18 15,16 30,12 45,14 60,8 75,5 90,2'
      : '0,4 15,6 30,10 45,8 60,14 75,15 90,18';

    return (
      <svg className="w-20 h-6 overflow-visible" viewBox="0 0 90 20">
        <polyline
          fill="none"
          stroke={isUp ? '#16C784' : '#EA3943'}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  const upcomingListings = newListings.filter(l => l.status === 'SCHEDULED' || l.status === 'PENDING_REVIEW');
  const activeNewListings = newListings.filter(l => l.status === 'ACTIVE');

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#08090D] overflow-y-auto">
      {/* Top Banner: DOMINEX Market Intelligence */}
      <div className="mb-6 rounded-2xl obsidian-glass border border-white/10 p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF087F]/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-[#FF087F] text-xs font-semibold mb-2">
              <Rocket className="w-3.5 h-3.5" />
              <span>DOMINEX Global Market Explorer</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-display font-extrabold text-[#F5F5F7] tracking-tight">
              Cryptocurrency Markets & New Token Listings
            </h1>
            <p className="text-xs text-[#9298A6] mt-1 max-w-xl">
              Track real-time prices, 24-hour liquidity depth, trading volume, and institutional market structure across all pairs.
            </p>
          </div>

          {/* Quick Highlight Cards */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Live New Listing Card */}
            <div className="flex-1 sm:flex-initial p-3 rounded-xl bg-[#0E1016]/80 border border-[#00C087]/30 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#00C087]/15 border border-[#00C087]/30 flex items-center justify-center font-bold text-xs text-[#00C087]">
                SOL
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-[#F5F5F7]">SOL/IDR</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#00C087]/20 text-[#00C087] font-semibold">
                    SPOT LIVE
                  </span>
                </div>
                <div className="text-[11px] font-mono text-[#969BA8]">
                  Rp 2,850,000 <span className="text-[#00C087] font-bold">+4.12%</span>
                </div>
              </div>
              <button
                onClick={() => onNavigateTrade('SOL-IDR', 'SPOT')}
                className="ml-auto px-2.5 py-1 text-[11px] font-bold rounded bg-[#00C087] hover:bg-[#00D097] text-black transition-colors"
              >
                Trade
              </button>
            </div>

            {/* Upcoming Listing Card */}
            <div className="flex-1 sm:flex-initial p-3 rounded-xl bg-[#0E1016]/80 border border-[#F5B942]/30 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#F5B942]/15 border border-[#F5B942]/30 flex items-center justify-center font-bold text-xs text-[#F5B942]">
                TON
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-[#F5F5F7]">TON/IDR</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#F5B942]/20 text-[#F5B942] font-semibold">
                    SEGERA HADIR
                  </span>
                </div>
                <div className="text-[10px] text-[#969BA8] flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[#F5B942]" />
                  <span>Deposit Dibuka</span>
                </div>
              </div>
              <button
                onClick={() => setCategory('UPCOMING')}
                className="ml-auto px-2.5 py-1 text-[11px] font-semibold rounded bg-[#1C1F29] border border-[#292C38] text-[#F5F5F7] hover:text-white transition-colors"
              >
                Detail
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Control Bar: Search & Category Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-white/10">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: 'All Markets' },
            { id: 'IDR', label: 'IDR Pairs (Rupiah)', badge: 'IDR' },
            { id: 'USDT', label: 'USDT Pairs (Tether)', badge: 'USDT' },
            { id: 'SPOT', label: 'All Spot Pairs' },
            { id: 'NEW_LISTINGS', label: 'New Listings', badge: 'NEW' },
            { id: 'UPCOMING', label: 'Upcoming', count: upcomingListings.length },
            { id: 'FUTURES', label: 'Futures Perpetual' },
            { id: 'FAVORITES', label: 'Favorites' },
            { id: 'GAINERS', label: 'Top Gainers' },
            { id: 'LOSERS', label: 'Top Losers' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setCategory(tab.id as MarketCategory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl transition-all whitespace-nowrap ${
                category === tab.id
                  ? 'bg-gradient-to-r from-[#FF087F]/20 to-[#D926FF]/15 text-white font-bold border border-[#FF087F]/40 shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7] hover:bg-[#171923]'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="text-[9px] px-1 rounded bg-[#FF087F]/20 text-[#FF087F] font-bold">
                  {tab.badge}
                </span>
              )}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[9px] px-1.5 rounded-full bg-white/10 text-[#F5B942] font-mono">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#9298A6]" />
          <input
            placeholder="Search coin, symbol, or market..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0D1017] border border-white/10 rounded-lg text-[#F5F5F7] placeholder-[#686D7A] outline-none focus:border-[#FF087F]"
          />
        </div>
      </div>

      {/* Markets Table */}
      <div className="rounded-2xl obsidian-glass border border-white/10 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0D1017]/90 text-[#9298A6] text-[11px] font-sans font-medium border-b border-white/10">
              <tr>
                <th className="py-3 px-4 w-10 text-center">Fav</th>
                <th
                  onClick={() => handleSort('symbol')}
                  className="py-3 px-4 cursor-pointer hover:text-[#F5F5F7] select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Pair</span>
                    <ArrowUpDown className="w-3 h-3 text-[#686D7A]" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('lastPrice')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-[#F5F5F7] select-none"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Last Price</span>
                    <ArrowUpDown className="w-3 h-3 text-[#686D7A]" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('change')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-[#F5F5F7] select-none"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>24h Change</span>
                    <ArrowUpDown className="w-3 h-3 text-[#686D7A]" />
                  </div>
                </th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">24h High</th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">24h Low</th>
                <th
                  onClick={() => handleSort('volume')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-[#F5F5F7] select-none hidden md:table-cell"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>24h Volume</span>
                    <ArrowUpDown className="w-3 h-3 text-[#686D7A]" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center hidden lg:table-cell">24h Trend</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292C38]/40">
              {category === 'UPCOMING' ? (
                upcomingListings.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-xs text-[#686D7A]">
                      Belum ada jadwal token listing baru yang akan datang.
                    </td>
                  </tr>
                ) : (
                  upcomingListings.map(item => (
                    <tr
                      key={item.id}
                      className="hover:bg-[#1C1F29]/60 transition-colors"
                    >
                      <td className="py-3 px-4 text-center">
                        <Clock className="w-3.5 h-3.5 mx-auto text-[#F5B942]" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#F5F5F7] font-mono text-xs">
                            {item.symbol}
                          </span>
                          <span className="text-[10px] text-[#686D7A]">{item.tokenName}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#F5B942]/20 text-[#F5B942] font-semibold border border-[#F5B942]/30">
                            SEGERA TRADING
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8]">
                        Estimasi Awal
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#0E1016] text-[#00C087] font-semibold border border-[#00C087]/30">
                          DEP: {item.depositStatus === 'OPEN' ? 'DIBUKA' : 'DITUTUP'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8] hidden sm:table-cell">
                        {item.network}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8] hidden sm:table-cell">
                        {item.scheduledAt ? new Date(item.scheduledAt).toLocaleDateString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Segera'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8] hidden md:table-cell">
                        Likuiditas MM Siap
                      </td>
                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        <span className="text-[10px] text-[#5B9DFF]">Maker-Checker OK</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.depositStatus === 'OPEN' && (
                            <button
                              onClick={() => onNavigateTrade(item.pairId, 'SPOT')}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded bg-[#00C087] hover:bg-[#00D097] text-black transition-colors"
                            >
                              Deposit
                            </button>
                          )}
                          <button
                            onClick={() => onNavigateTrade(item.pairId, 'SPOT')}
                            className="px-2 py-1 text-[11px] rounded bg-[#1C1F29] border border-[#292C38] text-[#969BA8] hover:text-white transition-colors"
                          >
                            Detail
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )
              ) : filteredAndSortedPairs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-xs text-[#686D7A]">
                    Tidak ada pasangan pasar yang sesuai kriteria pencarian.
                  </td>
                </tr>
              ) : (
                filteredAndSortedPairs.map(p => {
                  const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
                  const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
                  const isPositive = chg >= 0;
                  const isFav = favorites.has(p.id);

                  return (
                    <tr
                      key={p.id}
                      onClick={() => onNavigateTrade(p.id, 'SPOT')}
                      className="hover:bg-[#1C1F29]/60 transition-colors cursor-pointer group"
                    >
                      {/* Favorite Button */}
                      <td className="py-3 px-4 text-center" onClick={e => toggleFavorite(e, p.id)}>
                        <Star
                          className={`w-3.5 h-3.5 mx-auto transition-colors ${
                            isFav ? 'text-[#F5B942] fill-[#F5B942]' : 'text-[#686D7A] hover:text-[#969BA8]'
                          }`}
                        />
                      </td>

                      {/* Pair Symbol */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#F5F5F7] font-mono group-hover:text-[#EB3458] transition-colors">
                            {sym}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold font-mono border ${
                            p.quoteCurrency === 'USDT'
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          }`}>
                            {p.quoteCurrency}
                          </span>
                          {(p.isNewListing || p.baseCurrency === 'SOL') && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#EB3458]/20 text-[#EB3458] font-bold border border-[#EB3458]/30">
                              BARU
                            </span>
                          )}
                          {p.depositEnabled && (
                            <span className="hidden sm:inline-block text-[9px] px-1 py-0.2 rounded bg-[#00C087]/15 text-[#00C087] font-semibold">
                              DEP BUKA
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Last Price */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#F5F5F7]">
                        {formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>

                      {/* 24h Change (Anti-pill text) */}
                      <td className="py-3 px-4 text-right font-mono font-semibold">
                        <span className={`inline-flex items-center gap-0.5 ${isPositive ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                          {isPositive ? '+' : ''}{chg.toFixed(2)}%
                        </span>
                      </td>

                      {/* 24h High */}
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8] hidden sm:table-cell">
                        {formatQuotePrice(p.high24h, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>

                      {/* 24h Low */}
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8] hidden sm:table-cell">
                        {formatQuotePrice(p.low24h, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>

                      {/* 24h Volume */}
                      <td className="py-3 px-4 text-right font-mono text-[#969BA8] hidden md:table-cell">
                        {formatPairVolume(p.quoteVolume24h || p.volume24h || '0', p.quoteCurrency, p.quoteDecimals)}
                      </td>

                      {/* Trend Sparkline */}
                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        <div className="flex justify-center">
                          {renderSparkline(chg)}
                        </div>
                      </td>

                      {/* Trade Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => onNavigateTrade(p.id, 'SPOT')}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-[#EB3458] hover:bg-[#FF496B] text-white transition-colors"
                          >
                            Trade
                          </button>
                          <button
                            onClick={() => onNavigateTrade(p.id, 'FUTURES')}
                            title="Trade Futures"
                            className="p-1 text-[11px] font-semibold rounded bg-[#1C1F29] border border-[#292C38] text-[#969BA8] hover:text-white transition-colors"
                          >
                            <Zap className="w-3.5 h-3.5 text-[#EB3458]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
