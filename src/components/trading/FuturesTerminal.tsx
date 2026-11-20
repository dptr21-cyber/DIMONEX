/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/trading/FuturesTerminal.tsx
 * Real Perpetual Futures Trading Terminal connected to /api/futures & live market feeds.
 * - Uses ALL real market pairs (both IDR & USDT quote pairs).
 * - Preserves exact per-pair quoteDecimals (2 for IDR vs 6 for USDT) and baseDecimals via BigInt.
 * - Zero hardcoded prices, fake positions, or mock balances.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Lock,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  FuturesMarketInfo,
  FuturesMarginMode,
  FuturesOrder,
  FuturesOrderType,
  FuturesPosition,
  FuturesSide,
  TradeItem,
  TradingPairItem,
  UserBalance,
  UserProfile,
} from '../../types/index.js';
import {
  formatCrypto,
  formatDateTime,
  formatPairVolume,
  formatQuotePrice,
  formatUnitsToDecimal,
  parseDecimalToUnits,
  safeBigInt,
} from '../../lib/formatters.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { useToast } from '../ui/Toast.js';
import { TradingChart } from './TradingChart.js';
import { OrderBookView } from './OrderBookView.js';

interface FuturesTerminalProps {
  pair: TradingPairItem;
  pairs: TradingPairItem[];
  onSelectPair: (pairId: string) => void;
  user: UserProfile | null;
  displayCurrency: 'USDT' | 'IDR';
  balances?: UserBalance[];
  depth?: { bids: [string, string, string][]; asks: [string, string, string][]; spread: string };
  recentTrades?: TradeItem[];
  onRefreshBalances?: () => void;
  onOpenAuthModal?: () => void;
}

function formatCountdown(targetTs: number): string {
  const diffSec = Math.max(0, Math.floor((targetTs - Date.now()) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const FuturesTerminal: React.FC<FuturesTerminalProps> = ({
  pair,
  pairs,
  onSelectPair,
  user,
  balances = [],
  depth = { bids: [], asks: [], spread: '0' },
  recentTrades = [],
  onRefreshBalances,
  onOpenAuthModal,
}) => {
  const { showToast } = useToast();

  const [markets, setMarkets] = useState<FuturesMarketInfo[]>([]);
  const [positions, setPositions] = useState<FuturesPosition[]>([]);
  const [openOrders, setOpenOrders] = useState<FuturesOrder[]>([]);
  const [history, setHistory] = useState<FuturesPosition[]>([]);
  const [futuresBalances, setFuturesBalances] = useState<
    { currency: string; balanceAvailable: string; balanceLocked: string }[]
  >([]);

  const [leverage, setLeverage] = useState<number>(20);
  const [marginMode, setMarginMode] = useState<FuturesMarginMode>('CROSS');
  const [side, setSide] = useState<FuturesSide>('LONG');
  const [orderType, setOrderType] = useState<FuturesOrderType>('LIMIT');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [allocationPct, setAllocationPct] = useState<number | null>(null);
  const [activeBottomTab, setActiveBottomTab] = useState<'POSITIONS' | 'ORDERS' | 'HISTORY'>('POSITIONS');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Pair Dropdown Picker
  const [isPairMenuOpen, setIsPairMenuOpen] = useState<boolean>(false);
  const [pairFilterQuote, setPairFilterQuote] = useState<'ALL' | 'IDR' | 'USDT'>('ALL');
  const [pairSearch, setPairSearch] = useState<string>('');
  const [countdownStr, setCountdownStr] = useState<string>('--:--:--');
  const prevPairIdRef = useRef<string | null>(null);

  const isQuoteIDR = (pair.quoteCurrency || 'IDR').toUpperCase() === 'IDR';
  const quoteDecimals =
    pair.quoteDecimals !== undefined && pair.quoteDecimals !== null
      ? pair.quoteDecimals
      : isQuoteIDR
      ? 2
      : 6;
  const baseDecimals = pair.baseDecimals ?? 8;

  const activeMarketInfo = useMemo(
    () => markets.find((m) => m.pairId === pair.id),
    [markets, pair.id]
  );

  // Live mark/last price in atomic quote units
  const lastPriceUnits = safeBigInt(activeMarketInfo?.lastPrice || pair.lastPrice || '0');
  const bestBidUnits = safeBigInt(
    depth.bids?.[0]?.[0] || activeMarketInfo?.bestBid || lastPriceUnits.toString()
  );
  const bestAskUnits = safeBigInt(
    depth.asks?.[0]?.[0] || activeMarketInfo?.bestAsk || lastPriceUnits.toString()
  );

  // Reset form inputs when switching pair so IDR vs USDT decimals never carry over!
  useEffect(() => {
    if (prevPairIdRef.current !== pair.id) {
      prevPairIdRef.current = pair.id;
      setQuantity('');
      setAllocationPct(null);
      if (lastPriceUnits > 0n) {
        setLimitPrice(formatUnitsToDecimal(lastPriceUnits, quoteDecimals, true));
      } else {
        setLimitPrice('');
      }
    }
  }, [pair.id, quoteDecimals, lastPriceUnits]);

  // Seed limit price if empty once market data loads
  useEffect(() => {
    if (!limitPrice && lastPriceUnits > 0n) {
      setLimitPrice(formatUnitsToDecimal(lastPriceUnits, quoteDecimals, true));
    }
  }, [lastPriceUnits, quoteDecimals, limitPrice]);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('dimonex_auth_token');
    return {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    };
  }, []);

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch('/api/futures/markets');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.markets)) {
          setMarkets(data.markets);
        }
      }
    } catch {}
  }, []);

  const fetchState = useCallback(async () => {
    if (!user) {
      setPositions([]);
      setOpenOrders([]);
      setHistory([]);
      setFuturesBalances([]);
      return;
    }
    try {
      const res = await fetch('/api/futures/state', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPositions(Array.isArray(data.positions) ? data.positions : []);
        setOpenOrders(Array.isArray(data.openOrders) ? data.openOrders : []);
        setHistory(Array.isArray(data.history) ? data.history : []);
        setFuturesBalances(Array.isArray(data.balances) ? data.balances : []);
      }
    } catch {}
  }, [user, getAuthHeaders]);

  useEffect(() => {
    fetchMarkets();
    fetchState();
    const timer = setInterval(() => {
      fetchMarkets();
      fetchState();
    }, 2000);
    return () => clearInterval(timer);
  }, [fetchMarkets, fetchState]);

  useEffect(() => {
    const nextTs = activeMarketInfo?.nextFundingTimestamp;
    if (!nextTs) return;
    setCountdownStr(formatCountdown(nextTs));
    const t = setInterval(() => {
      setCountdownStr(formatCountdown(nextTs));
    }, 1000);
    return () => clearInterval(t);
  }, [activeMarketInfo?.nextFundingTimestamp]);

  // Resolve available quote balance from futures state or prop balances
  const activeQuoteBalance = useMemo(() => {
    const fromFutures = futuresBalances.find((b) => b.currency === pair.quoteCurrency);
    if (fromFutures) return fromFutures;
    return balances.find((b) => b.currency === pair.quoteCurrency);
  }, [futuresBalances, balances, pair.quoteCurrency]);

  const availQuoteUnits = safeBigInt(activeQuoteBalance?.balanceAvailable || '0');
  const lockedQuoteUnits = safeBigInt(activeQuoteBalance?.balanceLocked || '0');

  // Decimal-exact BigInt order preview math
  const effectiveEntryPriceUnits = useMemo(() => {
    if (orderType === 'LIMIT') {
      const parsed = parseDecimalToUnits(limitPrice, quoteDecimals);
      return parsed > 0n ? parsed : lastPriceUnits;
    }
    return side === 'LONG'
      ? bestAskUnits > 0n
        ? bestAskUnits
        : lastPriceUnits
      : bestBidUnits > 0n
      ? bestBidUnits
      : lastPriceUnits;
  }, [orderType, limitPrice, quoteDecimals, lastPriceUnits, side, bestAskUnits, bestBidUnits]);

  const sizeUnits = useMemo(() => {
    return parseDecimalToUnits(quantity, baseDecimals);
  }, [quantity, baseDecimals]);

  const baseScale = 10n ** BigInt(Math.max(0, baseDecimals));
  const notionalQuoteUnits = useMemo(() => {
    if (sizeUnits <= 0n || effectiveEntryPriceUnits <= 0n) return 0n;
    return (sizeUnits * effectiveEntryPriceUnits) / baseScale;
  }, [sizeUnits, effectiveEntryPriceUnits, baseScale]);

  const levBig = BigInt(Math.max(1, leverage));
  const requiredMarginUnits =
    notionalQuoteUnits > 0n ? (notionalQuoteUnits + levBig - 1n) / levBig : 0n;

  const feeBps = BigInt(
    orderType === 'MARKET' ? pair.takerFeeBps ?? 20 : pair.makerFeeBps ?? 10
  );
  const estFeeUnits =
    notionalQuoteUnits > 0n ? (notionalQuoteUnits * feeBps) / 10000n : 0n;

  const estLiqPriceUnits = useMemo(() => {
    if (effectiveEntryPriceUnits <= 0n) return 0n;
    const maintBuffer = (effectiveEntryPriceUnits * 50n) / 10000n;
    if (side === 'LONG') {
      if (levBig <= 1n) return maintBuffer || 1n;
      const raw = (effectiveEntryPriceUnits * (levBig - 1n)) / levBig + maintBuffer;
      return raw >= effectiveEntryPriceUnits
        ? effectiveEntryPriceUnits > 1n
          ? effectiveEntryPriceUnits - 1n
          : 1n
        : raw > 0n
        ? raw
        : 1n;
    }
    const raw = (effectiveEntryPriceUnits * (levBig + 1n)) / levBig - maintBuffer;
    return raw > effectiveEntryPriceUnits ? raw : effectiveEntryPriceUnits + 1n;
  }, [effectiveEntryPriceUnits, side, levBig]);

  const handlePercentageClick = (pct: number) => {
    setAllocationPct(pct);
    if (!user) {
      onOpenAuthModal?.();
      return;
    }
    if (availQuoteUnits <= 0n || effectiveEntryPriceUnits <= 0n) {
      setQuantity('0');
      return;
    }
    // Allocate % of available quote margin accounting for fee bps
    const budgetUnits = (availQuoteUnits * BigInt(pct)) / 100n;
    // budget >= notional/lev + notional*feeBps/10000 => notional = budget / (1/lev + feeBps/10000)
    const denom = 10000n + feeBps * levBig;
    const maxNotionalUnits = (budgetUnits * 10000n * levBig) / denom;
    let calcSizeUnits = (maxNotionalUnits * baseScale) / effectiveEntryPriceUnits;
    const maxOrder = safeBigInt(pair.maxOrderSize || '0');
    if (maxOrder > 0n && calcSizeUnits > maxOrder) calcSizeUnits = maxOrder;
    setQuantity(formatUnitsToDecimal(calcSizeUnits, baseDecimals, true));
  };

  const handlePlaceOrder = async (targetSide: FuturesSide) => {
    if (!user) {
      onOpenAuthModal?.();
      return;
    }
    setSide(targetSide);

    if (sizeUnits <= 0n) {
      showToast('error', `Masukkan jumlah ${pair.baseCurrency} yang valid.`);
      return;
    }

    if (orderType === 'LIMIT') {
      const parsedLimit = parseDecimalToUnits(limitPrice, quoteDecimals);
      if (parsedLimit <= 0n) {
        showToast('error', `Harga limit (${pair.quoteCurrency}, ${quoteDecimals} desimal) tidak valid.`);
        return;
      }
      // Enforce quote decimals strictly so IDR (2 dec) vs USDT (6 dec) never sends truncated junk
      const decMatch = limitPrice.trim().split('.')[1];
      if (decMatch && decMatch.length > quoteDecimals) {
        showToast(
          'error',
          `Presisi harga ${pair.id} maksimal ${quoteDecimals} angka desimal (${pair.quoteCurrency}).`
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/futures/order', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          pairId: pair.id,
          side: targetSide,
          orderType,
          marginMode,
          leverage,
          quantity: formatUnitsToDecimal(sizeUnits, baseDecimals, true),
          limitPrice:
            orderType === 'LIMIT'
              ? formatUnitsToDecimal(parseDecimalToUnits(limitPrice, quoteDecimals), quoteDecimals, true)
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data.error || 'Gagal menempatkan order Futures.');
        return;
      }

      showToast('success', data.message || `Order ${targetSide} ${pair.id} berhasil diproses.`);
      setQuantity('');
      setAllocationPct(null);
      if (Array.isArray(data.positions)) setPositions(data.positions);
      if (Array.isArray(data.openOrders)) setOpenOrders(data.openOrders);
      if (Array.isArray(data.history)) setHistory(data.history);
      onRefreshBalances?.();
      fetchState();
      fetchMarkets();
      if (!data.executedImmediately) {
        setActiveBottomTab('ORDERS');
      } else {
        setActiveBottomTab('POSITIONS');
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Terjadi kesalahan koneksi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = async (positionId: string) => {
    setBusyId(positionId);
    try {
      const res = await fetch(`/api/futures/position/${positionId}/close`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data.error || 'Gagal menutup posisi.');
        return;
      }
      showToast('info', data.message || 'Posisi ditutup & PnL diselesaikan ke saldo.');
      if (Array.isArray(data.positions)) setPositions(data.positions);
      if (Array.isArray(data.history)) setHistory(data.history);
      onRefreshBalances?.();
      fetchState();
      fetchMarkets();
    } catch (err: any) {
      showToast('error', err?.message || 'Koneksi gagal.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    setBusyId(orderId);
    try {
      const res = await fetch(`/api/futures/order/${orderId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', data.error || 'Gagal membatalkan order.');
        return;
      }
      showToast('success', data.message || 'Order limit dibatalkan & margin dibuka.');
      if (Array.isArray(data.openOrders)) setOpenOrders(data.openOrders);
      onRefreshBalances?.();
      fetchState();
    } catch (err: any) {
      showToast('error', err?.message || 'Koneksi gagal.');
    } finally {
      setBusyId(null);
    }
  };

  const filteredPairs = useMemo(() => {
    const q = pairSearch.trim().toUpperCase();
    return pairs.filter((p) => {
      if (!p.isActive) return false;
      if (pairFilterQuote !== 'ALL' && p.quoteCurrency.toUpperCase() !== pairFilterQuote) {
        return false;
      }
      if (q && !p.id.toUpperCase().includes(q) && !p.baseCurrency.toUpperCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [pairs, pairFilterQuote, pairSearch]);

  const changePct = parseFloat(activeMarketInfo?.priceChangePercent24h || pair.priceChangePercent24h || pair.priceChange24h || '0');
  const isPositive = changePct >= 0;

  return (
    <div className="space-y-3">
      {/* Contract Ticker Header Bar + Real Pair Selector */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 relative">
        <div className="flex flex-wrap items-center gap-5">
          {/* Interactive Pair Picker */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsPairMenuOpen((v) => !v)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-[7px] bg-[#17212B] border border-[#2B3944] hover:border-[#8DA5B1] transition-colors cursor-pointer"
            >
              <AssetIcon symbol={pair.baseCurrency} logoUrl={pair.baseLogoUrl || undefined} size="sm" />
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-[#E4EBEF] font-mono">
                    {pair.baseCurrency}/{pair.quoteCurrency}
                  </span>
                  <StatusBadge tone="info">
                    PERP
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {quoteDecimals}d
                  </StatusBadge>
                </div>
                <span className="text-[10px] text-[#71818B] font-mono block">
                  {pair.baseName && pair.baseName !== pair.baseCurrency ? `${pair.baseName} · ` : ''}{pair.id} · Max {activeMarketInfo?.maxLeverage || 125}x
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-[#A1AFB8]" />
            </button>

            {isPairMenuOpen && (
              <div className="absolute left-0 top-full mt-2 w-80 sm:w-96 rounded-[10px] bg-[#111820] border border-[#2B3944] shadow-2xl z-50 p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={pairSearch}
                      onChange={(e) => setPairSearch(e.target.value)}
                      placeholder="Cari kontrak (BTC-IDR, ETH-USDT...)"
                      className="w-full h-8 pl-8 pr-2 bg-[#17212B] border border-[#2B3944] rounded-[6px] text-xs text-[#E4EBEF] focus:outline-none focus:border-[#8DA5B1]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPairMenuOpen(false)}
                    className="p-1.5 text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {(['ALL', 'IDR', 'USDT'] as const).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPairFilterQuote(q)}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-[5px] cursor-pointer ${
                        pairFilterQuote === q
                          ? 'bg-[#8DA5B1] text-[#090D12]'
                          : 'bg-[#17212B] text-[#A1AFB8] hover:text-[#E4EBEF]'
                      }`}
                    >
                      {q === 'ALL' ? 'Semua Pasar' : `Quote ${q}`}
                    </button>
                  ))}
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-[#202B34]">
                  {filteredPairs.map((p) => {
                    const pDec = p.quoteDecimals ?? (p.quoteCurrency === 'USDT' ? 6 : 2);
                    const chg = parseFloat(p.priceChangePercent24h || p.priceChange24h || '0');
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          onSelectPair(p.id);
                          setIsPairMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 text-xs hover:bg-[#17212B] transition-colors cursor-pointer ${
                          p.id === pair.id ? 'bg-[#1D2832]' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2 text-left">
                          <AssetIcon symbol={p.baseCurrency} logoUrl={p.baseLogoUrl || undefined} size="xs" />
                          <div>
                            <span className="font-mono font-semibold text-[#E4EBEF] block">
                              {p.id}
                            </span>
                            <span className="text-[10px] text-[#71818B] font-mono">
                              Base {p.baseDecimals}d · Quote {pDec}d
                            </span>
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <span className="text-[#E4EBEF] block">
                            {formatQuotePrice(p.lastPrice, p.quoteCurrency, pDec, true)}
                          </span>
                          <span className={`text-[10px] ${chg >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                            {chg >= 0 ? '+' : ''}
                            {chg.toFixed(2)}%
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Real Price Readouts */}
          <div className="flex flex-wrap items-center gap-6 text-xs font-mono tabular-nums">
            <div>
              <span className="text-[10px] font-sans text-[#71818B] block">Mark / Last Price</span>
              <span className={`text-sm font-semibold ${isPositive ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                {formatQuotePrice(lastPriceUnits, pair.quoteCurrency, quoteDecimals, true)}
              </span>
            </div>

            <div>
              <span className="text-[10px] font-sans text-[#71818B] block">24h Change</span>
              <span className={isPositive ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                {isPositive ? '+' : ''}
                {changePct.toFixed(2)}%
              </span>
            </div>

            <div>
              <span className="text-[10px] font-sans text-[#71818B] block">Funding (8h) / Countdown</span>
              <span className="text-[#D6A85C]">
                {(activeMarketInfo?.fundingRatePct ?? 0.01) >= 0 ? '+' : ''}
                {(activeMarketInfo?.fundingRatePct ?? 0.01).toFixed(4)}% · {countdownStr}
              </span>
            </div>

            <div className="hidden md:block">
              <span className="text-[10px] font-sans text-[#71818B] block">24h High / Low</span>
              <span className="text-[#E4EBEF]">
                {formatQuotePrice(activeMarketInfo?.high24h || pair.high24h, pair.quoteCurrency, quoteDecimals, false)}
                {' / '}
                {formatQuotePrice(activeMarketInfo?.low24h || pair.low24h, pair.quoteCurrency, quoteDecimals, false)}
              </span>
            </div>

            <div className="hidden lg:block">
              <span className="text-[10px] font-sans text-[#71818B] block">Open Interest</span>
              <span className="text-[#E4EBEF]">
                {formatPairVolume(
                  activeMarketInfo?.openInterestQuoteUnits || '0',
                  pair.quoteCurrency,
                  quoteDecimals
                )}
              </span>
            </div>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            fetchMarkets();
            fetchState();
          }}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Sync Live
        </Button>
      </div>

      {/* Main Trading Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
        {/* Left 8 Columns: Real Chart & Positions/Orders Table */}
        <div className="lg:col-span-8 space-y-3">
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <TradingChart pair={pair} recentTrades={recentTrades} />
          </div>

          {/* Positions / Open Orders / History */}
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#202B34] bg-[#111820]">
              <div className="flex items-center gap-2">
                {(
                  [
                    { id: 'POSITIONS', label: `Posisi Aktif (${positions.length})` },
                    { id: 'ORDERS', label: `Order Limit (${openOrders.length})` },
                    { id: 'HISTORY', label: `Riwayat Posisi (${history.length})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveBottomTab(tab.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] transition-colors cursor-pointer ${
                      activeBottomTab === tab.id
                        ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                        : 'text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {user && (
                <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8]">
                  Margin Terkunci ({pair.quoteCurrency}):{' '}
                  <span className="text-[#E4EBEF] font-semibold">
                    {formatQuotePrice(lockedQuoteUnits, pair.quoteCurrency, quoteDecimals, true)}
                  </span>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              {!user ? (
                <div className="p-8 text-center space-y-3">
                  <p className="text-xs text-[#A1AFB8]">
                    Masuk ke akun Anda untuk membuka posisi Perpetual Futures menggunakan saldo riil IDR maupun USDT.
                  </p>
                  <Button variant="primary" size="sm" onClick={onOpenAuthModal} icon={<Lock className="w-3.5 h-3.5" />}>
                    Masuk untuk Trading Futures
                  </Button>
                </div>
              ) : activeBottomTab === 'POSITIONS' ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#111820] text-[#71818B] font-mono text-[11px] uppercase border-b border-[#202B34]">
                    <tr>
                      <th className="py-2.5 px-4">Kontrak</th>
                      <th className="py-2.5 px-4">Size</th>
                      <th className="py-2.5 px-4">Entry Price</th>
                      <th className="py-2.5 px-4">Mark Price</th>
                      <th className="py-2.5 px-4">Liq. Price</th>
                      <th className="py-2.5 px-4">Margin ({pair.quoteCurrency})</th>
                      <th className="py-2.5 px-4">Unrealized PnL (ROE)</th>
                      <th className="py-2.5 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34] font-mono tabular-nums text-[#E4EBEF]">
                    {positions.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[#71818B] font-sans">
                          Tidak ada posisi Futures terbuka saat ini.
                        </td>
                      </tr>
                    ) : (
                      positions.map((pos) => {
                        const pnlBig = safeBigInt(pos.unrealizedPnlUnits);
                        const isPnlPos = pnlBig >= 0n;
                        return (
                          <tr key={pos.id} className="hover:bg-[#17212B]">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`font-bold ${
                                    pos.side === 'LONG' ? 'text-[#16A879]' : 'text-[#EA5B65]'
                                  }`}
                                >
                                  {pos.side}
                                </span>
                                <span className="font-semibold">{pos.pairId}</span>
                                <StatusBadge tone="neutral">
                                  {pos.marginMode} {pos.leverage}x
                                </StatusBadge>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {formatCrypto(pos.sizeUnits, pos.baseDecimals, pos.baseCurrency)}
                            </td>
                            <td className="py-3 px-4">
                              {formatQuotePrice(pos.entryPriceUnits, pos.quoteCurrency, pos.quoteDecimals, true)}
                            </td>
                            <td className="py-3 px-4">
                              {formatQuotePrice(pos.markPriceUnits, pos.quoteCurrency, pos.quoteDecimals, true)}
                            </td>
                            <td className="py-3 px-4 text-[#D6A85C]">
                              {formatQuotePrice(pos.liqPriceUnits, pos.quoteCurrency, pos.quoteDecimals, true)}
                            </td>
                            <td className="py-3 px-4">
                              {formatQuotePrice(pos.marginLockedUnits, pos.quoteCurrency, pos.quoteDecimals, true)}
                            </td>
                            <td className={`py-3 px-4 font-semibold ${isPnlPos ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                              {isPnlPos ? '+' : ''}
                              {formatQuotePrice(pnlBig, pos.quoteCurrency, pos.quoteDecimals, true)}{' '}
                              <span className="text-[11px] opacity-85">
                                ({isPnlPos ? '+' : ''}
                                {pos.roePct.toFixed(2)}%)
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-sans">
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                isLoading={busyId === pos.id}
                                onClick={() => handleClosePosition(pos.id)}
                              >
                                Close Market
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : activeBottomTab === 'ORDERS' ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#111820] text-[#71818B] font-mono text-[11px] uppercase border-b border-[#202B34]">
                    <tr>
                      <th className="py-2.5 px-4">Waktu</th>
                      <th className="py-2.5 px-4">Kontrak / Side</th>
                      <th className="py-2.5 px-4">Harga Limit</th>
                      <th className="py-2.5 px-4">Jumlah</th>
                      <th className="py-2.5 px-4">Margin Terkunci</th>
                      <th className="py-2.5 px-4 text-right">Batal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34] font-mono tabular-nums text-[#E4EBEF]">
                    {openOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[#71818B] font-sans">
                          Tidak ada order Limit Futures terbuka.
                        </td>
                      </tr>
                    ) : (
                      openOrders.map((ord) => (
                        <tr key={ord.id} className="hover:bg-[#17212B]">
                          <td className="py-2.5 px-4 text-[11px] text-[#A1AFB8]">
                            {formatDateTime(ord.createdAt)}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`font-bold mr-1.5 ${
                                ord.side === 'LONG' ? 'text-[#16A879]' : 'text-[#EA5B65]'
                              }`}
                            >
                              {ord.side}
                            </span>
                            {ord.pairId} ({ord.leverage}x)
                          </td>
                          <td className="py-2.5 px-4">
                            {formatQuotePrice(ord.limitPriceUnits, ord.quoteCurrency, ord.quoteDecimals, true)}
                          </td>
                          <td className="py-2.5 px-4">
                            {formatCrypto(ord.quantityUnits, ord.baseDecimals, ord.baseCurrency)}
                          </td>
                          <td className="py-2.5 px-4">
                            {formatQuotePrice(ord.marginRequiredUnits, ord.quoteCurrency, ord.quoteDecimals, true)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-sans">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              isLoading={busyId === ord.id}
                              onClick={() => handleCancelOrder(ord.id)}
                              icon={<Trash2 className="w-3 h-3" />}
                            >
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#111820] text-[#71818B] font-mono text-[11px] uppercase border-b border-[#202B34]">
                    <tr>
                      <th className="py-2.5 px-4">Ditutup</th>
                      <th className="py-2.5 px-4">Kontrak / Side</th>
                      <th className="py-2.5 px-4">Size</th>
                      <th className="py-2.5 px-4">Entry -&gt; Exit</th>
                      <th className="py-2.5 px-4">Realized PnL</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34] font-mono tabular-nums text-[#E4EBEF]">
                    {history.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[#71818B] font-sans">
                          Belum ada riwayat posisi Futures tertutup.
                        </td>
                      </tr>
                    ) : (
                      history.map((pos) => {
                        const rPnl = safeBigInt(pos.realizedPnlUnits);
                        const isPos = rPnl >= 0n;
                        return (
                          <tr key={pos.id} className="hover:bg-[#17212B]">
                            <td className="py-2.5 px-4 text-[11px] text-[#A1AFB8]">
                              {formatDateTime(pos.closedAt || pos.updatedAt)}
                            </td>
                            <td className="py-2.5 px-4">
                              <span
                                className={`font-bold mr-1.5 ${
                                  pos.side === 'LONG' ? 'text-[#16A879]' : 'text-[#EA5B65]'
                                }`}
                              >
                                {pos.side}
                              </span>
                              {pos.pairId} ({pos.leverage}x)
                            </td>
                            <td className="py-2.5 px-4">
                              {formatCrypto(pos.sizeUnits, pos.baseDecimals, pos.baseCurrency)}
                            </td>
                            <td className="py-2.5 px-4">
                              {formatQuotePrice(pos.entryPriceUnits, pos.quoteCurrency, pos.quoteDecimals, false)}
                              {' -> '}
                              {formatQuotePrice(pos.markPriceUnits, pos.quoteCurrency, pos.quoteDecimals, true)}
                            </td>
                            <td className={`py-2.5 px-4 font-semibold ${isPos ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                              {isPos ? '+' : ''}
                              {formatQuotePrice(rPnl, pos.quoteCurrency, pos.quoteDecimals, true)} ({pos.roePct.toFixed(2)}%)
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <StatusBadge tone={pos.status === 'LIQUIDATED' ? 'danger' : 'neutral'}>
                                {pos.status}
                              </StatusBadge>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right 4 Columns: Real Decimal-Accurate Order Form & Live Order Book */}
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 space-y-3.5">
            {/* Margin Mode & Leverage */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34]">
                {(['CROSS', 'ISOLATED'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMarginMode(m)}
                    className={`flex-1 py-1.5 text-[11px] font-semibold rounded-[5px] cursor-pointer transition-colors ${
                      marginMode === m
                        ? 'bg-[#1D2832] text-[#E4EBEF]'
                        : 'text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between px-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#202B34] font-mono text-xs">
                <span className="text-[#71818B]">Leverage</span>
                <span className="text-[#8DA5B1] font-bold">{leverage}x</span>
              </div>
            </div>

            {/* Leverage Presets + Slider */}
            <div className="space-y-1.5">
              <input
                type="range"
                min={1}
                max={125}
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full accent-[#8DA5B1] cursor-pointer"
              />
              <div className="grid grid-cols-5 gap-1">
                {[5, 10, 20, 50, 100].map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setLeverage(lv)}
                    className={`py-1 text-[11px] font-mono rounded-[5px] border cursor-pointer ${
                      leverage === lv
                        ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF] font-semibold'
                        : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {lv}x
                  </button>
                ))}
              </div>
            </div>

            {/* Order Type Tabs */}
            <div className="grid grid-cols-2 gap-1 bg-[#111820] p-1 rounded-[7px] border border-[#202B34]">
              {(['LIMIT', 'MARKET'] as const).map((ot) => (
                <button
                  key={ot}
                  type="button"
                  onClick={() => setOrderType(ot)}
                  className={`py-1.5 text-xs font-semibold rounded-[5px] cursor-pointer ${
                    orderType === ot
                      ? 'bg-[#1D2832] text-[#E4EBEF]'
                      : 'text-[#71818B] hover:text-[#E4EBEF]'
                  }`}
                >
                  {ot === 'LIMIT' ? 'Limit Order' : 'Market Order'}
                </button>
              ))}
            </div>

            {/* Available Real Balance Readout */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-[#71818B]">Saldo Tersedia ({pair.quoteCurrency})</span>
              <span className="font-mono tabular-nums text-[#E4EBEF] font-semibold">
                {user
                  ? formatQuotePrice(availQuoteUnits, pair.quoteCurrency, quoteDecimals, true)
                  : '--'}
              </span>
            </div>

            {/* Decimal-Accurate Price Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label className="text-[#A1AFB8] font-medium">
                  Harga ({pair.quoteCurrency} · {quoteDecimals} dec)
                </label>
                {orderType === 'LIMIT' && lastPriceUnits > 0n && (
                  <button
                    type="button"
                    onClick={() =>
                      setLimitPrice(formatUnitsToDecimal(lastPriceUnits, quoteDecimals, true))
                    }
                    className="text-[11px] font-mono text-[#8DA5B1] hover:text-[#E4EBEF] cursor-pointer"
                  >
                    Last Price
                  </button>
                )}
              </div>
              {orderType === 'LIMIT' ? (
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={limitPrice}
                    onChange={(e) => {
                      setLimitPrice(e.target.value);
                      setAllocationPct(null);
                    }}
                    placeholder={formatUnitsToDecimal(lastPriceUnits, quoteDecimals, true)}
                    className="w-full h-10 px-3 pr-16 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums text-sm focus:outline-none focus:border-[#8DA5B1]"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[#71818B]">
                    {pair.quoteCurrency}
                  </span>
                </div>
              ) : (
                <div className="h-10 px-3 bg-[#111820] border border-[#202B34] rounded-[7px] flex items-center justify-between text-xs font-mono text-[#A1AFB8]">
                  <span>Eksekusi Harga Pasar Live</span>
                  <span className="text-[#E4EBEF]">
                    {formatQuotePrice(lastPriceUnits, pair.quoteCurrency, quoteDecimals, true)}
                  </span>
                </div>
              )}
            </div>

            {/* Decimal-Accurate Quantity Input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label className="text-[#A1AFB8] font-medium">
                  Ukuran ({pair.baseCurrency} · {baseDecimals} dec)
                </label>
                <span className="text-[10px] font-mono text-[#71818B]">
                  Min {formatUnitsToDecimal(pair.minOrderSize, baseDecimals, true)}
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setAllocationPct(null);
                  }}
                  placeholder={`0.${'0'.repeat(Math.min(4, baseDecimals))}`}
                  className="w-full h-10 px-3 pr-16 bg-[#17212B] border border-[#2B3944] rounded-[7px] text-[#E4EBEF] font-mono tabular-nums text-sm focus:outline-none focus:border-[#8DA5B1]"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[#71818B]">
                  {pair.baseCurrency}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handlePercentageClick(pct)}
                    className={`py-1 text-[11px] font-mono rounded-[5px] border cursor-pointer transition-colors ${
                      allocationPct === pct
                        ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF] font-semibold'
                        : 'bg-[#111820] border-[#202B34] text-[#71818B] hover:text-[#E4EBEF]'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            {/* Real Order Telemetry */}
            <div className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="font-sans text-[#71818B]">Nilai Posisi (Notional)</span>
                <span className="text-[#E4EBEF]">
                  {formatQuotePrice(notionalQuoteUnits, pair.quoteCurrency, quoteDecimals, true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-[#71818B]">Margin Dibutuhkan ({leverage}x)</span>
                <span className="text-[#E4EBEF] font-semibold">
                  {formatQuotePrice(requiredMarginUnits, pair.quoteCurrency, quoteDecimals, true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-[#71818B]">Estimasi Fee</span>
                <span className="text-[#A1AFB8]">
                  {formatQuotePrice(estFeeUnits, pair.quoteCurrency, quoteDecimals, true)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-[#71818B]">Est. Harga Likuidasi</span>
                <span className="text-[#D6A85C]">
                  {estLiqPriceUnits > 0n
                    ? formatQuotePrice(estLiqPriceUnits, pair.quoteCurrency, quoteDecimals, true)
                    : '--'}
                </span>
              </div>
            </div>

            {/* Dual Action Submit Buttons */}
            {!user ? (
              <Button
                type="button"
                variant="primary"
                size="md"
                className="w-full"
                onClick={onOpenAuthModal}
                icon={<Lock className="w-3.5 h-3.5" />}
              >
                Masuk / Daftar untuk Trading Futures
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="profit"
                  size="md"
                  isLoading={isSubmitting && side === 'LONG'}
                  disabled={isSubmitting}
                  onClick={() => handlePlaceOrder('LONG')}
                  icon={<ArrowUpRight className="w-4 h-4" />}
                >
                  Open Long
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  isLoading={isSubmitting && side === 'SHORT'}
                  disabled={isSubmitting}
                  onClick={() => handlePlaceOrder('SHORT')}
                  icon={<ArrowDownRight className="w-4 h-4" />}
                >
                  Open Short
                </Button>
              </div>
            )}
          </div>

          {/* Live Order Book for Active Pair (click fills exact pair quoteDecimals price) */}
          <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
            <div className="px-3 py-2 border-b border-[#202B34] bg-[#111820] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#E4EBEF]">
                Live Order Book ({pair.id})
              </span>
              <span className="text-[10px] font-mono text-[#71818B]">
                Klik harga untuk isi Limit
              </span>
            </div>
            <div className="p-1.5">
              <OrderBookView
                pair={pair}
                depth={depth}
                onSelectPrice={(priceUnits) => {
                  const formatted = formatUnitsToDecimal(
                    safeBigInt(priceUnits),
                    quoteDecimals,
                    true
                  );
                  setOrderType('LIMIT');
                  setLimitPrice(formatted);
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
