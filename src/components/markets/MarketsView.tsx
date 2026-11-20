/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/markets/MarketsView.tsx
 * Comprehensive cryptocurrency markets explorer with search, sorting, gainers/losers, and favorites.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Star, ArrowUpDown, Zap, Clock, BarChart3, AlertTriangle } from 'lucide-react';
import { TradingPairItem } from '../../types/index.js';
import { formatQuotePrice, formatPairVolume } from '../../lib/formatters.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { PageHeader } from '../ui/PanelHeader.js';
import { SearchInput } from '../ui/Controls.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { PercentageChange } from '../ui/PriceDisplay.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';
import { EmptyState } from '../ui/StateViews.js';
import { formatCountdownCompact } from '../trading/MarketCountdownOverlay.js';

interface MarketsViewProps {
  pairs: TradingPairItem[];
  selectedPairId: string;
  onSelectPair: (pairId: string) => void;
  onNavigateTrade: (pairId: string, mode?: 'SPOT' | 'FUTURES') => void;
  displayCurrency: 'USDT' | 'IDR';
}

type MarketCategory =
  | 'ALL'
  | 'IDR'
  | 'USDT'
  | 'SPOT'
  | 'NEW_LISTINGS'
  | 'UPCOMING'
  | 'DELISTING'
  | 'FUTURES'
  | 'FAVORITES'
  | 'GAINERS'
  | 'LOSERS';
type SortField = 'symbol' | 'lastPrice' | 'change' | 'volume';
type SortOrder = 'asc' | 'desc';

export const MarketsView: React.FC<MarketsViewProps> = ({
  pairs,
  onNavigateTrade,
}) => {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<MarketCategory>('ALL');
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [newListings, setNewListings] = useState<any[]>([]);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('dimonex_favorites');
      return saved ? new Set(JSON.parse(saved)) : new Set(['BTC-IDR', 'ETH-IDR', 'SOL-IDR']);
    } catch {
      return new Set(['BTC-IDR', 'ETH-IDR', 'SOL-IDR']);
    }
  });

  useEffect(() => {
    safeFetchJson<any>('/api/markets')
      .then(res => {
        if (res.ok && res.data?.newListings) {
          setNewListings(res.data.newListings);
          setMarketsError(null);
        } else if (!res.ok) {
          setMarketsError(res.error || 'Failed to sync listing schedule');
        }
      })
      .catch(err => {
        setMarketsError(err?.message || 'Network error');
      });
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

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const hasLiveCountdown = useMemo(() => {
    const pairCountdown = pairs.some(
      p =>
        (p.delistScheduledAt && p.delistScheduledAt > nowMs) ||
        (!p.isActive && p.scheduledAt && p.scheduledAt > nowMs)
    );
    const listingCountdown = newListings.some(
      l => l.scheduledAt && l.scheduledAt > nowMs
    );
    return pairCountdown || listingCountdown;
  }, [pairs, newListings, nowMs]);

  useEffect(() => {
    if (!hasLiveCountdown) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveCountdown]);

  const delistingPairsCount = useMemo(
    () =>
      pairs.filter(
        p => p.isDelisted || Boolean(p.delistScheduledAt && p.delistScheduledAt > nowMs)
      ).length,
    [pairs, nowMs]
  );

  const filteredAndSortedPairs = useMemo(() => {
    return pairs
      .filter(p => {
        const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
        const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0');
        const matchesSearch =
          sym.toLowerCase().includes(search.toLowerCase()) ||
          p.baseCurrency.toLowerCase().includes(search.toLowerCase());

        if (!matchesSearch) return false;

        if (category === 'DELISTING') {
          return Boolean(p.isDelisted || (p.delistScheduledAt && p.delistScheduledAt > nowMs));
        }

        // Exclude permanently delisted pairs from active market categories
        if (p.isDelisted) return false;

        if (category === 'FAVORITES') return favorites.has(p.id);
        if (category === 'NEW_LISTINGS')
          return (
            p.isNewListing ||
            p.listingStatus === 'SCHEDULED' ||
            Boolean(!p.isActive && p.scheduledAt && p.scheduledAt > nowMs) ||
            p.baseCurrency === 'SOL' ||
            p.baseCurrency === 'TON'
          );
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
  }, [pairs, search, category, sortField, sortOrder, favorites, nowMs]);

  const upcomingListings = useMemo(
    () => newListings.filter(l => l.status === 'SCHEDULED' || l.status === 'PENDING_REVIEW'),
    [newListings]
  );

  // Featured live pair from authoritative pairs list (no hardcoded prices)
  const featuredPair = useMemo(() => {
    const activePairs = pairs.filter(p => !p.isDelisted && p.isActive !== false);
    return (
      activePairs.find(p => p.isNewListing) ||
      activePairs.find(p => p.id === 'SOL-IDR') ||
      activePairs[0] ||
      null
    );
  }, [pairs]);

  const nextUpcoming = upcomingListings[0] || null;

  const renderRangeTrend = (p: TradingPairItem, chgPct: number) => {
    const isUp = chgPct >= 0;
    const low = parseFloat(p.low24h || p.lastPrice || '0');
    const high = parseFloat(p.high24h || p.lastPrice || '1');
    const last = parseFloat(p.lastPrice || '0');
    const mid = (low + high) / 2;
    const pts = isUp ? [low, mid * 0.99, mid, (mid + high) / 2, last] : [high, (mid + high) / 2, mid, mid * 0.99, last];
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const w = 72;
    const h = 20;
    const d = pts
      .map((val, idx) => `${((idx / (pts.length - 1)) * w).toFixed(1)},${(h - ((val - min) / range) * (h - 4) - 2).toFixed(1)}`)
      .join(' ');

    return (
      <svg className="w-[72px] h-5 overflow-visible" viewBox={`0 0 ${w} ${h}`}>
        <polyline
          fill="none"
          stroke={isUp ? '#16A879' : '#EA5B65'}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={d}
        />
      </svg>
    );
  };

  return (
    <div className="flex-1 flex flex-col p-4 lg:p-6 bg-[#090D12] overflow-y-auto space-y-5">
      {/* Header Banner */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[5px] bg-[#17212B] border border-[#2B3944] text-[#8DA5B1] text-[11px] font-mono font-medium mb-2">
              <BarChart3 className="w-3.5 h-3.5" />
              <span>DIMONEX GLOBAL MARKET EXPLORER</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-semibold text-[#E4EBEF] tracking-tight">
              Cryptocurrency Markets & New Listings
            </h1>
            <p className="text-xs text-[#A1AFB8] mt-1 max-w-xl">
              Track real-time prices, 24-hour trading range, and liquidity depth across all IDR and USDT order books.
            </p>
          </div>

          {/* Dynamic Live Highlights (Derived Strictly From Exchange Data) */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {featuredPair && (
              <div className="flex-1 sm:flex-initial p-3 rounded-[10px] bg-[#111820] border border-[#2B3944] flex items-center gap-3 min-w-[230px]">
                <AssetIcon symbol={featuredPair.baseCurrency} size="md" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-xs text-[#E4EBEF]">
                      {featuredPair.symbol || `${featuredPair.baseCurrency}/${featuredPair.quoteCurrency}`}
                    </span>
                    <StatusBadge tone="buy">SPOT LIVE</StatusBadge>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8] mt-0.5 flex items-center gap-1.5">
                    <span>
                      {formatQuotePrice(
                        featuredPair.lastPrice,
                        featuredPair.quoteCurrency,
                        featuredPair.quoteDecimals,
                        true
                      )}
                    </span>
                    <PercentageChange
                      value={
                        featuredPair.priceChangePercent24h ||
                        featuredPair.priceChange24h?.replace('+', '') ||
                        '0'
                      }
                    />
                  </div>
                </div>
                <Button
                  variant="profit"
                  size="sm"
                  onClick={() => onNavigateTrade(featuredPair.id, 'SPOT')}
                  className="ml-auto"
                >
                  Trade
                </Button>
              </div>
            )}

            {nextUpcoming && (
              <div className="flex-1 sm:flex-initial p-3 rounded-[10px] bg-[#111820] border border-[#2B3944] flex items-center gap-3 min-w-[250px]">
                <AssetIcon
                  symbol={nextUpcoming.baseCurrency || nextUpcoming.tokenSymbol || nextUpcoming.symbol?.split(/[-/]/)[0] || 'NEW'}
                  logoUrl={nextUpcoming.logoUrl || undefined}
                  size="md"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-xs text-[#E4EBEF]">
                      {nextUpcoming.symbol}
                    </span>
                    <StatusBadge tone="warning">UPCOMING</StatusBadge>
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-[#D6A85C] flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 text-[#D6A85C] shrink-0" />
                    <span>
                      {nextUpcoming.scheduledAt && nextUpcoming.scheduledAt > nowMs
                        ? `Launch T-${formatCountdownCompact(nextUpcoming.scheduledAt, nowMs)}`
                        : `Deposit ${nextUpcoming.depositStatus === 'OPEN' ? 'Open' : 'Scheduled'}`}
                    </span>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onNavigateTrade(nextUpcoming.pairId, 'SPOT')}
                  className="ml-auto"
                >
                  Chart
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {marketsError && (
        <div className="text-[11px] font-mono text-[#D6A85C] bg-[#2C2415]/40 border border-[#D6A85C]/30 rounded-[7px] px-3 py-2">
          Listing schedule notice: {marketsError}
        </div>
      )}

      {/* Control Bar: Category Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#202B34]">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
          {[
            { id: 'ALL', label: 'All Markets' },
            { id: 'IDR', label: 'IDR Pairs', badge: 'IDR' },
            { id: 'USDT', label: 'USDT Pairs', badge: 'USDT' },
            { id: 'SPOT', label: 'Spot' },
            { id: 'NEW_LISTINGS', label: 'New Listings', badge: 'NEW' },
            { id: 'UPCOMING', label: 'Upcoming', count: upcomingListings.length },
            { id: 'DELISTING', label: 'Delisting', count: delistingPairsCount, tone: 'danger' as const },
            { id: 'FUTURES', label: 'Futures' },
            { id: 'FAVORITES', label: 'Favorites' },
            { id: 'GAINERS', label: 'Gainers' },
            { id: 'LOSERS', label: 'Losers' },
          ].map(tab => {
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id as MarketCategory)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[7px] border transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border-[#2B3944]'
                    : 'text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#141C24] border-transparent'
                }`}
              >
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className="text-[9px] px-1 py-0.2 rounded-[4px] bg-[#141C24] text-[#8DA5B1] border border-[#202B34] font-mono">
                    {tab.badge}
                  </span>
                )}
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`text-[9px] px-1.5 rounded-[4px] font-mono ${
                      tab.tone === 'danger'
                        ? 'bg-[#401F27] text-[#EA5B65]'
                        : 'bg-[#2C2415] text-[#D6A85C]'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search coin, symbol, or market..."
          className="w-full sm:w-64"
        />
      </div>

      {/* Markets Table */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead className="bg-[#111820] text-[#71818B] text-[11px] font-sans font-medium uppercase tracking-wider border-b border-[#202B34]">
              <tr>
                <th className="py-3 px-4 w-10 text-center">Fav</th>
                <th
                  onClick={() => handleSort('symbol')}
                  className="py-3 px-4 cursor-pointer hover:text-[#E4EBEF] select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Pair</span>
                    <ArrowUpDown className="w-3 h-3 text-[#53616A]" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('lastPrice')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-[#E4EBEF] select-none"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Last Price</span>
                    <ArrowUpDown className="w-3 h-3 text-[#53616A]" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('change')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-[#E4EBEF] select-none"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>24h Change</span>
                    <ArrowUpDown className="w-3 h-3 text-[#53616A]" />
                  </div>
                </th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">24h High</th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">24h Low</th>
                <th
                  onClick={() => handleSort('volume')}
                  className="py-3 px-4 text-right cursor-pointer hover:text-[#E4EBEF] select-none hidden md:table-cell"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>24h Volume</span>
                    <ArrowUpDown className="w-3 h-3 text-[#53616A]" />
                  </div>
                </th>
                <th className="py-3 px-4 text-center hidden lg:table-cell">24h Range</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {category === 'UPCOMING' ? (
                upcomingListings.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        title="No Upcoming Token Listings"
                        description="Belum ada jadwal token listing baru yang sedang menunggu aktivasi."
                      />
                    </td>
                  </tr>
                ) : (
                  upcomingListings.map(item => (
                    <tr
                      key={item.id}
                      onClick={() => onNavigateTrade(item.pairId, 'SPOT')}
                      className="hover:bg-[#17212B] transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4 text-center">
                        <Clock className="w-3.5 h-3.5 mx-auto text-[#D6A85C]" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <AssetIcon
                            symbol={item.baseCurrency || item.symbol?.split(/[-/]/)[0] || 'NEW'}
                            logoUrl={item.logoUrl || undefined}
                            size="sm"
                          />
                          <span className="font-semibold text-[#E4EBEF]">{item.symbol}</span>
                          <span className="text-[11px] font-sans text-[#71818B]">{item.tokenName}</span>
                          <StatusBadge tone="warning">Scheduled</StatusBadge>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {item.scheduledAt && item.scheduledAt > nowMs ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] bg-[#2C2415]/60 border border-[#D6A85C]/30 text-[#D6A85C] text-[11px] font-mono font-semibold tabular-nums">
                            <Clock className="w-3 h-3" />
                            T-{formatCountdownCompact(item.scheduledAt, nowMs)}
                          </span>
                        ) : (
                          <span className="text-[#A1AFB8]">Initial Phase</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <StatusBadge tone={item.depositStatus === 'OPEN' ? 'buy' : 'neutral'}>
                          DEP: {item.depositStatus === 'OPEN' ? 'OPEN' : 'CLOSED'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 px-4 text-right text-[#A1AFB8] hidden sm:table-cell">
                        {item.network}
                      </td>
                      <td className="py-3 px-4 text-right text-[#A1AFB8] hidden sm:table-cell">
                        {item.scheduledAt
                          ? new Date(item.scheduledAt).toLocaleDateString('id-ID', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'TBA'}
                      </td>
                      <td className="py-3 px-4 text-right text-[#A1AFB8] hidden md:table-cell">
                        MM Ready
                      </td>
                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        <StatusBadge tone="info">Countdown Live</StatusBadge>
                      </td>
                      <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onNavigateTrade(item.pairId, 'SPOT')}
                          >
                            Open Chart
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )
              ) : filteredAndSortedPairs.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No Matching Markets"
                      description="Tidak ada pasangan pasar yang sesuai dengan filter atau kata kunci pencarian."
                    />
                  </td>
                </tr>
              ) : (
                filteredAndSortedPairs.map(p => {
                  const sym = p.symbol || `${p.baseCurrency}/${p.quoteCurrency}`;
                  const chg = parseFloat(
                    p.priceChangePercent24h || p.priceChange24h?.replace('+', '') || '0'
                  );
                  const isFav = favorites.has(p.id);
                  const isScheduledDelist = Boolean(!p.isDelisted && p.delistScheduledAt && p.delistScheduledAt > nowMs);
                  const isPreLaunch = Boolean(!p.isDelisted && p.isActive === false && p.scheduledAt && p.scheduledAt > nowMs);

                  return (
                    <tr
                      key={p.id}
                      onClick={() => onNavigateTrade(p.id, 'SPOT')}
                      className="hover:bg-[#17212B] transition-colors cursor-pointer group"
                    >
                      <td
                        className="py-3 px-4 text-center"
                        onClick={e => toggleFavorite(e, p.id)}
                      >
                        <Star
                          className={`w-3.5 h-3.5 mx-auto transition-colors ${
                            isFav
                              ? 'text-[#D6A85C] fill-[#D6A85C]'
                              : 'text-[#53616A] hover:text-[#A1AFB8]'
                          }`}
                        />
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <AssetIcon symbol={p.baseCurrency} logoUrl={p.baseLogoUrl || undefined} size="sm" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-[#E4EBEF] group-hover:text-white">
                                {sym}
                              </span>
                              <StatusBadge tone={p.quoteCurrency === 'USDT' ? 'buy' : 'info'}>
                                {p.quoteCurrency}
                              </StatusBadge>
                              {(p.isNewListing || p.baseCurrency === 'SOL') && !p.isDelisted && (
                                <StatusBadge tone="brand">NEW</StatusBadge>
                              )}
                              {p.isDelisted ? (
                                <StatusBadge tone="danger">DELISTED</StatusBadge>
                              ) : isScheduledDelist && p.delistScheduledAt ? (
                                <StatusBadge tone="danger">
                                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    DELISTING · {formatCountdownCompact(p.delistScheduledAt, nowMs)}
                                  </span>
                                </StatusBadge>
                              ) : isPreLaunch && p.scheduledAt ? (
                                <StatusBadge tone="warning">
                                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                                    <Clock className="w-2.5 h-2.5" />
                                    SOON · {formatCountdownCompact(p.scheduledAt, nowMs)}
                                  </span>
                                </StatusBadge>
                              ) : p.isHalted ? (
                                <StatusBadge tone="danger">HALTED</StatusBadge>
                              ) : null}
                            </div>
                            {(p.isDelisted || isScheduledDelist) && p.delistReason ? (
                              <span className="text-[10px] font-sans text-[#EA5B65]/90 block truncate max-w-[240px]">
                                {p.delistReason}
                              </span>
                            ) : p.baseName && p.baseName !== p.baseCurrency ? (
                              <span className="text-[10px] font-sans text-[#71818B] block truncate max-w-[180px]">
                                {p.baseName}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-semibold text-[#E4EBEF]">
                        {isPreLaunch
                          ? <span className="text-[#D6A85C] text-[11px]">Pre-Launch</span>
                          : formatQuotePrice(p.lastPrice, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>

                      <td className="py-3 px-4 text-right font-semibold">
                        {isPreLaunch ? (
                          <span className="text-[#71818B] text-[11px]">—</span>
                        ) : (
                          <PercentageChange value={chg} size="sm" />
                        )}
                      </td>

                      <td className="py-3 px-4 text-right text-[#A1AFB8] hidden sm:table-cell">
                        {isPreLaunch ? '—' : formatQuotePrice(p.high24h, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>

                      <td className="py-3 px-4 text-right text-[#A1AFB8] hidden sm:table-cell">
                        {isPreLaunch ? '—' : formatQuotePrice(p.low24h, p.quoteCurrency, p.quoteDecimals, true)}
                      </td>

                      <td className="py-3 px-4 text-right text-[#A1AFB8] hidden md:table-cell">
                        {isPreLaunch
                          ? '—'
                          : formatPairVolume(
                              p.quoteVolume24h || p.volume24h || '0',
                              p.quoteCurrency,
                              p.quoteDecimals
                            )}
                      </td>

                      <td className="py-3 px-4 text-center hidden lg:table-cell">
                        <div className="flex justify-center">
                          {isPreLaunch ? (
                            <span className="text-[10px] text-[#71818B]">Countdown</span>
                          ) : (
                            renderRangeTrend(p, chg)
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={e => e.stopPropagation()}
                        >
                          {p.isDelisted ? (
                            <button
                              type="button"
                              onClick={() => onNavigateTrade(p.id, 'SPOT')}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-[6px] bg-[#17212B] hover:bg-[#1D2832] text-[#A1AFB8] border border-[#2B3944] transition-colors cursor-pointer"
                            >
                              Chart
                            </button>
                          ) : isPreLaunch ? (
                            <button
                              type="button"
                              onClick={() => onNavigateTrade(p.id, 'SPOT')}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-[6px] bg-[#2C2415] hover:bg-[#3A2F1B] text-[#D6A85C] border border-[#D6A85C]/40 transition-colors cursor-pointer"
                            >
                              Countdown
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => onNavigateTrade(p.id, 'SPOT')}
                                className="px-2.5 py-1 text-[11px] font-semibold rounded-[6px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] transition-colors cursor-pointer"
                              >
                                Trade
                              </button>
                              <button
                                type="button"
                                onClick={() => onNavigateTrade(p.id, 'FUTURES')}
                                title="Trade Futures"
                                className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] text-[#8DA5B1] hover:text-[#E4EBEF] hover:bg-[#1D2832] transition-colors cursor-pointer"
                              >
                                <Zap className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
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
