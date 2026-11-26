/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/wallet/LivePnLView.tsx
 * Live Real-Time PnL Tracker & Equity Performance Analytics in Obsidian Iridium matte theme.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  BarChart3,
  Award
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  YAxis,
  XAxis,
  CartesianGrid
} from 'recharts';
import { formatIDR } from '../../lib/formatters.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { Button } from '../ui/Button.js';

interface Props {
  onNavigateTrade?: (pairId: string) => void;
  hideBalance?: boolean;
}

export interface PnLSummary {
  totalRealizedPnlIdr: number;
  totalRealizedPnlUsdt: number;
  totalUnrealizedPnlIdr: number;
  totalUnrealizedPnlUsdt: number;
  netPnlIdr: number;
  netPnlUsdt: number;
  todayPnlIdr: number;
  todayPnlUsdt: number;
  todayPnlPercent: number;
  winRateDaysPct: number;
  winRateTradesPct: number;
  profitFactor: number;
  totalTradingDays: number;
  winningDaysCount: number;
  losingDaysCount: number;
  breakevenDaysCount: number;
  totalTrades: number;
  totalVolumeIdr: number;
  totalVolumeUsdt: number;
  totalFeesIdr: number;
  totalFeesUsdt: number;
  bestDay: { date: string; pnlIdr: number; pnlUsdt: number; returnPct: number } | null;
  worstDay: { date: string; pnlIdr: number; pnlUsdt: number; returnPct: number } | null;
  totalPortfolioEstIdr: number;
  usdtRate: number;
}

export interface CumulativePoint {
  date: string;
  timestamp: number;
  dailyPnlIdr: number;
  dailyPnlUsdt: number;
  cumulativePnlIdr: number;
  cumulativePnlUsdt: number;
  returnPct: number;
}

export interface AssetPnLItem {
  symbol: string;
  holding: number;
  avgBuyPriceIdr: number;
  currentPriceIdr: number;
  avgBuyPriceUsdt: number;
  currentPriceUsdt: number;
  unrealizedPnlIdr: number;
  unrealizedPnlUsdt: number;
  returnPct: number;
  totalBought: number;
  totalSold: number;
  hasCostBasis?: boolean;
  priceSource?: 'PAIR_IDR' | 'PAIR_USDT' | 'EXTERNAL_WS' | 'NONE';
}

export const LivePnLView: React.FC<Props> = ({ onNavigateTrade, hideBalance = false }) => {
  const [currency, setCurrency] = useState<'IDR' | 'USDT'>('IDR');
  const [timeframe, setTimeframe] = useState<'7D' | '14D' | '30D' | 'ALL'>('30D');
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const [summary, setSummary] = useState<PnLSummary | null>(null);
  const [cumulativeSeries, setCumulativeSeries] = useState<CumulativePoint[]>([]);
  const [assetBreakdown, setAssetBreakdown] = useState<AssetPnLItem[]>([]);

  const fetchPnLData = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsLoading(true);
      const res = await safeFetchJson<any>(
        `/api/wallet/pnl-analytics?currency=${currency}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        { retries: 1, retryDelayMs: 250 }
      );
      if (res.ok && res.data?.summary) {
        setSummary(res.data.summary);
        setCumulativeSeries(res.data.cumulativeSeries || []);
        setAssetBreakdown(res.data.assetBreakdown || []);
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.warn('Failed to load PnL analytics:', e);
    } finally {
      setIsLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    fetchPnLData();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchPnLData();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchPnLData]);

  const filteredSeries = useMemo(() => {
    if (cumulativeSeries.length === 0) return [];
    if (timeframe === 'ALL') return cumulativeSeries;
    const daysCount = timeframe === '7D' ? 7 : timeframe === '14D' ? 14 : 30;
    return cumulativeSeries.slice(-daysCount);
  }, [cumulativeSeries, timeframe]);

  const formatValue = (valIdr: number, valUsdt: number, showSign = true): string => {
    if (hideBalance) return '••••••';
    const isIdr = currency === 'IDR';
    const val = isIdr ? valIdr : valUsdt;
    const sign = showSign && val > 0 ? '+' : '';

    if (isIdr) {
      return `${sign}${formatIDR(String(Math.round(val)))}`;
    }
    const maxDigits = Math.abs(val) > 0 && Math.abs(val) < 1 ? 4 : 2;
    return `${sign}$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxDigits })} USDT`;
  };

  const formatMarketPrice = (valIdr: number, valUsdt: number): string => {
    if (currency === 'IDR') {
      if (!(valIdr > 0)) return '-';
      const maxFrac = valIdr >= 1000 ? (valIdr % 1 === 0 ? 0 : 2) : valIdr >= 1 ? 4 : 8;
      return `Rp ${valIdr.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: maxFrac })}`;
    }
    if (!(valUsdt > 0)) return '-';
    const maxFrac = valUsdt >= 100 ? 2 : valUsdt >= 1 ? 4 : valUsdt >= 0.001 ? 6 : 8;
    return `$${valUsdt.toLocaleString('en-US', { minimumFractionDigits: valUsdt >= 1 ? 2 : 4, maximumFractionDigits: maxFrac })}`;
  };

  const isNetProfit = (summary?.netPnlIdr ?? 0) >= 0;
  const isTodayProfit = (summary?.todayPnlIdr ?? 0) >= 0;
  const isRealizedProfit = (summary?.totalRealizedPnlIdr ?? 0) >= 0;
  const isUnrealizedProfit = (summary?.totalUnrealizedPnlIdr ?? 0) >= 0;

  const CustomChartTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: CumulativePoint = payload[0].payload;
      const dayPnl = currency === 'IDR' ? data.dailyPnlIdr : data.dailyPnlUsdt;
      const isUp = dayPnl >= 0;

      return (
        <div className="rounded-[7px] bg-[#1D2832] border border-[#2B3944] p-3 shadow-lg text-xs font-mono tabular-nums">
          <div className="text-[#A1AFB8] mb-1 font-semibold">{data.date}</div>
          <div className="flex justify-between gap-4 py-0.5">
            <span className="text-[#71818B] font-sans">PnL Harian:</span>
            <span className={`font-semibold ${isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatValue(data.dailyPnlIdr, data.dailyPnlUsdt)}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-0.5">
            <span className="text-[#71818B] font-sans">Akumulasi PnL:</span>
            <span className="font-semibold text-[#E4EBEF]">
              {formatValue(data.cumulativePnlIdr, data.cumulativePnlUsdt)}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-0.5 border-t border-[#202B34] mt-1 pt-1">
            <span className="text-[#71818B] font-sans">Return %:</span>
            <span className={`font-semibold ${data.returnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {data.returnPct >= 0 ? '+' : ''}
              {data.returnPct}%
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#16A879]" />
            <span className="text-xs font-semibold text-[#E4EBEF]">Live PnL Engine</span>
          </div>
          <span className="text-[#40515D]">·</span>
          <span className="text-[11px] text-[#A1AFB8] font-mono tabular-nums">
            Sinkronisasi Real-Time (WIB): {lastUpdated.toLocaleTimeString('id-ID')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34] text-xs font-mono">
            <button
              type="button"
              onClick={() => setCurrency('IDR')}
              className={`px-3 py-1 rounded-[5px] font-medium transition-colors cursor-pointer ${
                currency === 'IDR'
                  ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                  : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
              }`}
            >
              IDR (Rp)
            </button>
            <button
              type="button"
              onClick={() => setCurrency('USDT')}
              className={`px-3 py-1 rounded-[5px] font-medium transition-colors cursor-pointer ${
                currency === 'USDT'
                  ? 'bg-[#1D2832] text-[#16A879] border border-[#16A879]/30'
                  : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
              }`}
            >
              USDT ($)
            </button>
          </div>

          <Button variant="secondary" size="sm" onClick={fetchPnLData} title="Segarkan data PnL sekarang">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1AFB8] mb-1">
            <span className="font-medium">Total Net PnL (Akumulasi)</span>
            <span className="text-[10px] text-[#71818B] font-mono">Realized + Unrealized</span>
          </div>
          <div className="my-1.5 font-mono tabular-nums">
            <div className={`text-2xl font-semibold tracking-tight ${isNetProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatValue(summary?.netPnlIdr ?? 0, summary?.netPnlUsdt ?? 0)}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className={`inline-flex items-center font-semibold ${isNetProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                {isNetProfit ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                {summary && summary.totalPortfolioEstIdr > 0
                  ? `${isNetProfit ? '+' : ''}${((summary.netPnlIdr / summary.totalPortfolioEstIdr) * 100).toFixed(2)}%`
                  : '+0.00%'}
              </span>
              <span className="text-[#71818B] font-sans">total modal</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono tabular-nums flex justify-between">
            <span className="font-sans">Estimasi Portofolio:</span>
            <span className="text-[#E4EBEF] font-semibold">
              {formatValue(summary?.totalPortfolioEstIdr ?? 0, (summary?.totalPortfolioEstIdr ?? 0) / (summary?.usdtRate || 16450), false)}
            </span>
          </div>
        </div>

        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1AFB8] mb-1">
            <span className="font-medium">Live PnL Hari Ini</span>
            <StatusBadge tone="buy">HARI INI</StatusBadge>
          </div>
          <div className="my-1.5 font-mono tabular-nums">
            <div className={`text-2xl font-semibold tracking-tight ${isTodayProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatValue(summary?.todayPnlIdr ?? 0, summary?.todayPnlUsdt ?? 0)}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className={`inline-flex items-center font-semibold ${isTodayProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                {isTodayProfit ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                {summary ? `${summary.todayPnlPercent >= 0 ? '+' : ''}${summary.todayPnlPercent.toFixed(2)}%` : '+0.00%'}
              </span>
              <span className="text-[#71818B] font-sans">return harian</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono flex justify-between">
            <span className="font-sans">Status Pasar:</span>
            <span className="text-[#16A879] font-medium">24/7 Bursa Aktif</span>
          </div>
        </div>

        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1AFB8] mb-1">
            <span className="font-medium">Realized PnL (Terealisasi)</span>
            <span className="text-[10px] text-[#71818B] font-mono">{summary?.totalTrades ?? 0} Order Selesai</span>
          </div>
          <div className="my-1.5 font-mono tabular-nums">
            <div className={`text-2xl font-semibold tracking-tight ${isRealizedProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatValue(summary?.totalRealizedPnlIdr ?? 0, summary?.totalRealizedPnlUsdt ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-[#71818B] font-sans">
              Keuntungan bersih dari matched trade order
            </div>
          </div>
          <div className="pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono tabular-nums flex justify-between">
            <span className="font-sans">Biaya Trading (Fee):</span>
            <span className="text-[#EA5B65] font-semibold">
              -{formatValue(summary?.totalFeesIdr ?? 0, summary?.totalFeesUsdt ?? 0, false)}
            </span>
          </div>
        </div>

        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1AFB8] mb-1">
            <span className="font-medium">Unrealized PnL (Posisi Berjalan)</span>
            <span className="text-[10px] text-[#71818B] font-mono">{assetBreakdown.length} Aset Koin</span>
          </div>
          <div className="my-1.5 font-mono tabular-nums">
            <div className={`text-2xl font-semibold tracking-tight ${isUnrealizedProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatValue(summary?.totalUnrealizedPnlIdr ?? 0, summary?.totalUnrealizedPnlUsdt ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-[#71818B] font-sans">
              Valuasi terkini vs harga beli rata-rata aset
            </div>
          </div>
          <div className="pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono flex justify-between">
            <span className="font-sans">Metode:</span>
            <span className="text-[#E4EBEF] font-medium">Mark-to-Market Real-Time</span>
          </div>
        </div>

        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1AFB8] mb-1">
            <span className="font-medium">Win Rate &amp; Profit Factor</span>
            <Award className="w-4 h-4 text-[#8DA5B1]" />
          </div>
          <div className="my-1.5 font-mono tabular-nums">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[#16A879] tracking-tight">
                {summary?.winRateDaysPct ?? 0}%
              </span>
              <span className="text-xs text-[#A1AFB8] font-sans">Hari Untung</span>
            </div>
            <div className="mt-1 text-xs text-[#A1AFB8] flex items-center gap-2">
              <span>Profit Factor:</span>
              <span className="font-semibold text-[#E4EBEF]">{summary?.profitFactor ?? 1.0}x</span>
              <span className="text-[#40515D]">·</span>
              <span className="text-[#16A879]">{summary?.winningDaysCount ?? 0}W</span>
              <span className="text-[#40515D]">/</span>
              <span className="text-[#EA5B65]">{summary?.losingDaysCount ?? 0}L</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono tabular-nums flex justify-between">
            <span className="font-sans">Akurasi Order:</span>
            <span className="text-[#E4EBEF] font-semibold">{summary?.winRateTradesPct ?? 0}% Menang</span>
          </div>
        </div>

        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#A1AFB8] mb-1">
            <span className="font-medium">Total Volume Transaksi</span>
            <BarChart3 className="w-4 h-4 text-[#8DA5B1]" />
          </div>
          <div className="my-1.5 font-mono tabular-nums">
            <div className="text-2xl font-semibold text-[#E4EBEF] tracking-tight">
              {formatValue(summary?.totalVolumeIdr ?? 0, summary?.totalVolumeUsdt ?? 0, false)}
            </div>
            <div className="mt-1 text-xs text-[#71818B] font-sans">
              Total turnover transaksi terverifikasi ledger
            </div>
          </div>
          <div className="pt-2 border-t border-[#202B34] text-[10px] text-[#71818B] font-mono tabular-nums flex justify-between">
            <span className="font-sans">Hari Terbaik:</span>
            <span className="text-[#16A879] font-semibold">
              {summary?.bestDay ? `${formatValue(summary.bestDay.pnlIdr, summary.bestDay.pnlUsdt)}` : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#202B34]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-[#16A879]" />
              <h3 className="text-sm font-semibold text-[#E4EBEF]">Grafik Kurva Akumulasi PnL (Equity Curve)</h3>
            </div>
            <p className="text-xs text-[#71818B]">
              Perkembangan hasil perdagangan harian dan kumulatif berdasarkan transaksi riil
            </p>
          </div>

          <div className="flex items-center bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34] text-xs font-mono self-start sm:self-auto">
            {(['7D', '14D', '30D', 'ALL'] as const).map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded-[5px] font-medium transition-colors cursor-pointer ${
                  timeframe === tf
                    ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                    : 'text-[#71818B] hover:text-[#A1AFB8] border border-transparent'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="h-64 sm:h-72 w-full pt-4 select-none">
          {filteredSeries.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#71818B] font-mono">
              Memuat data grafik performa...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredSeries} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="livePnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isNetProfit ? '#16A879' : '#EA5B65'} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={isNetProfit ? '#16A879' : '#EA5B65'} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#202B34" opacity={0.7} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: '#2B3944' }}
                  tick={{ fill: '#71818B', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
                  tickFormatter={val => val.slice(5)}
                />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip content={<CustomChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey={currency === 'IDR' ? 'cumulativePnlIdr' : 'cumulativePnlUsdt'}
                  stroke={isNetProfit ? '#16A879' : '#EA5B65'}
                  strokeWidth={2}
                  fill="url(#livePnlGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Asset-by-Asset Breakdown */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
        <div className="p-4 lg:p-5 border-b border-[#202B34] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">Rincian PnL Posisi Berjalan per Koin</h3>
            <p className="text-[11px] text-[#71818B]">Perbandingan harga beli rata-rata dengan harga pasar saat ini</p>
          </div>
          <span className="text-xs font-mono text-[#A1AFB8]">{assetBreakdown.length} Posisi Koin</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead className="bg-[#111820] text-[#71818B] text-[11px] uppercase tracking-wider border-b border-[#202B34]">
              <tr>
                <th className="py-3 px-4 font-sans font-medium">Aset / Koin</th>
                <th className="py-3 px-4 text-right font-sans font-medium">Saldo Saat Ini</th>
                <th className="py-3 px-4 text-right font-sans font-medium">Harga Beli Rata-Rata</th>
                <th className="py-3 px-4 text-right font-sans font-medium">Harga Pasar Sekarang</th>
                <th className="py-3 px-4 text-right font-sans font-medium">Unrealized PnL ({currency})</th>
                <th className="py-3 px-4 text-right font-sans font-medium">Return %</th>
                <th className="py-3 px-4 text-right font-sans font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {assetBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#71818B] font-sans">
                    <p className="font-semibold text-xs text-[#E4EBEF] mb-1">Belum Ada Aset Terdaftar</p>
                    <p className="text-[11px]">Lakukan transaksi beli di pasar spot untuk memulai posisi trading.</p>
                  </td>
                </tr>
              ) : (
                assetBreakdown.map(item => {
                  const hasBasis = item.hasCostBasis !== false && (currency === 'IDR' ? item.avgBuyPriceIdr > 0 : item.avgBuyPriceUsdt > 0);
                  const isUp = item.unrealizedPnlIdr >= 0;
                  const avgPrice = hasBasis
                    ? formatMarketPrice(item.avgBuyPriceIdr, item.avgBuyPriceUsdt)
                    : 'Deposit / Non-Trade';
                  const curPrice = formatMarketPrice(item.currentPriceIdr, item.currentPriceUsdt);
                  const pnlDisplay = hasBasis ? formatValue(item.unrealizedPnlIdr, item.unrealizedPnlUsdt) : '—';

                  return (
                    <tr key={item.symbol} className="hover:bg-[#17212B] transition-colors">
                      <td className="py-3 px-4 font-sans">
                        <div className="flex items-center gap-2.5">
                          <AssetIcon symbol={item.symbol} size="sm" />
                          <div>
                            <span className="font-semibold text-[#E4EBEF] block">{item.symbol}</span>
                            <span className="text-[10px] text-[#71818B] font-mono">
                              {hasBasis
                                ? `Total Beli: ${item.totalBought} ${item.symbol}`
                                : 'Saldo awal / deposit'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#E4EBEF]">
                        {hideBalance ? '••••' : `${item.holding} ${item.symbol}`}
                      </td>
                      <td className={`py-3 px-4 text-right ${hasBasis ? 'text-[#A1AFB8]' : 'text-[#71818B] font-sans text-[11px]'}`}>
                        {avgPrice}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#E4EBEF]">{curPrice}</td>
                      <td className={`py-3 px-4 text-right font-semibold ${!hasBasis ? 'text-[#71818B]' : isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                        {pnlDisplay}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold">
                        {hasBasis ? (
                          <span className={`inline-flex items-center ${isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                            {isUp ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                            {isUp ? '+' : ''}
                            {item.returnPct}%
                          </span>
                        ) : (
                          <span className="text-[#71818B]">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        {onNavigateTrade && item.symbol !== 'IDR' && (
                          <Button variant="secondary" size="sm" onClick={() => onNavigateTrade(`${item.symbol}-IDR`)}>
                            Trade
                          </Button>
                        )}
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
