/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/wallet/LivePnLView.tsx
 * Live Real-Time PnL Tracker & Equity Performance Analytics.
 * Strictly calculates realized & unrealized PnL from authentic user trades & ledger balances.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  RefreshCw,
  DollarSign,
  ShieldCheck,
  CheckCircle2,
  Calendar as CalendarIcon,
  PieChart,
  BarChart3,
  Layers,
  Percent,
  Award,
  AlertCircle
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
}

export const LivePnLView: React.FC<Props> = ({ onNavigateTrade, hideBalance = false }) => {
  const [currency, setCurrency] = useState<'IDR' | 'USDT'>('IDR');
  const [timeframe, setTimeframe] = useState<'7D' | '14D' | '30D' | 'ALL'>('30D');
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const [summary, setSummary] = useState<PnLSummary | null>(null);
  const [cumulativeSeries, setCumulativeSeries] = useState<CumulativePoint[]>([]);
  const [assetBreakdown, setAssetBreakdown] = useState<AssetPnLItem[]>([]);

  // Fetch PnL Analytics from backend
  const fetchPnLData = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsLoading(true);
      const res = await fetch(`/api/wallet/pnl-analytics?currency=${currency}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          setSummary(data.summary);
          setCumulativeSeries(data.cumulativeSeries || []);
          setAssetBreakdown(data.assetBreakdown || []);
          setLastUpdated(new Date());
        }
      }
    } catch (e) {
      console.warn('Failed to load PnL analytics:', e);
    } finally {
      setIsLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    fetchPnLData();
    // Live update interval: poll every 5 seconds
    const interval = setInterval(fetchPnLData, 5000);
    return () => clearInterval(interval);
  }, [fetchPnLData]);

  // Filter series according to timeframe
  const filteredSeries = useMemo(() => {
    if (cumulativeSeries.length === 0) return [];
    if (timeframe === 'ALL') return cumulativeSeries;

    const daysCount = timeframe === '7D' ? 7 : timeframe === '14D' ? 14 : 30;
    return cumulativeSeries.slice(-daysCount);
  }, [cumulativeSeries, timeframe]);

  // Format Helper based on active currency
  const formatValue = (valIdr: number, valUsdt: number, showSign = true): string => {
    if (hideBalance) return '••••••';
    const isIdr = currency === 'IDR';
    const val = isIdr ? valIdr : valUsdt;
    const sign = showSign && val > 0 ? '+' : '';

    if (isIdr) {
      return `${sign}${formatIDR(String(Math.round(val)))}`;
    }
    return `${sign}$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
  };

  const isNetProfit = (summary?.netPnlIdr ?? 0) >= 0;
  const isTodayProfit = (summary?.todayPnlIdr ?? 0) >= 0;
  const isRealizedProfit = (summary?.totalRealizedPnlIdr ?? 0) >= 0;
  const isUnrealizedProfit = (summary?.totalUnrealizedPnlIdr ?? 0) >= 0;

  // Recharts Custom Tooltip
  const CustomChartTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: CumulativePoint = payload[0].payload;
      const dayPnl = currency === 'IDR' ? data.dailyPnlIdr : data.dailyPnlUsdt;
      const cumPnl = currency === 'IDR' ? data.cumulativePnlIdr : data.cumulativePnlUsdt;
      const isUp = dayPnl >= 0;

      return (
        <div className="rounded-xl bg-[#0E1016] border border-[#292C38] p-3 shadow-2xl text-xs font-mono">
          <div className="text-[#9298A6] mb-1 font-semibold">{data.date}</div>
          <div className="flex justify-between gap-4 py-0.5">
            <span className="text-[#686D7A]">PnL Harian:</span>
            <span className={`font-bold ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {formatValue(data.dailyPnlIdr, data.dailyPnlUsdt)}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-0.5">
            <span className="text-[#686D7A]">Akumulasi PnL:</span>
            <span className="font-bold text-[#F5F5F7]">
              {formatValue(data.cumulativePnlIdr, data.cumulativePnlUsdt)}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-0.5 border-t border-[#292C38]/60 mt-1 pt-1">
            <span className="text-[#686D7A]">Return %:</span>
            <span className={`font-bold ${data.returnPct >= 0 ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {data.returnPct >= 0 ? '+' : ''}{data.returnPct}%
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Top Control Bar: Live Status & Currency Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#15171F] border border-[#292C38]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00C087] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00C087]" />
            </span>
            <span className="text-xs font-bold text-[#F5F5F7] font-display">Live PnL Engine</span>
          </div>
          <span className="text-[#686D7A]">·</span>
          <span className="text-[11px] text-[#9298A6] font-mono">
            Sinkronisasi Real-Time (WIB): {lastUpdated.toLocaleTimeString('id-ID')}
          </span>
        </div>

        {/* Currency Switcher & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#0E1016] p-0.5 rounded-lg border border-[#292C38] text-xs font-mono">
            <button
              type="button"
              onClick={() => setCurrency('IDR')}
              className={`px-3 py-1 rounded font-bold transition-all ${
                currency === 'IDR'
                  ? 'bg-[#1C1F29] text-[#FF087F] border border-[#FF087F]/40 shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7]'
              }`}
            >
              IDR (Rp)
            </button>
            <button
              type="button"
              onClick={() => setCurrency('USDT')}
              className={`px-3 py-1 rounded font-bold transition-all ${
                currency === 'USDT'
                  ? 'bg-[#1C1F29] text-[#00C087] border border-[#00C087]/40 shadow-sm'
                  : 'text-[#9298A6] hover:text-[#F5F5F7]'
              }`}
            >
              USDT ($)
            </button>
          </div>

          <button
            onClick={fetchPnLData}
            title="Segarkan data PnL sekarang"
            className="p-1.5 rounded-lg bg-[#0E1016] border border-[#292C38] hover:border-[#FF087F]/40 text-[#9298A6] hover:text-[#F5F5F7] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#FF087F]' : ''}`} />
          </button>
        </div>
      </div>

      {/* 6 Key Financial Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {/* Card 1: Net Cumulative PnL */}
        <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9298A6] mb-1">
            <span className="font-semibold">Total Net PnL (Akumulasi)</span>
            <span className="text-[10px] text-[#686D7A] font-mono">Realized + Unrealized</span>
          </div>
          <div className="my-1.5">
            <div className={`text-2xl font-extrabold font-mono tracking-tight ${isNetProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {formatValue(summary?.netPnlIdr ?? 0, summary?.netPnlUsdt ?? 0)}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs font-mono">
              <span className={`inline-flex items-center font-bold ${isNetProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                {isNetProfit ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                {summary && summary.totalPortfolioEstIdr > 0
                  ? `${isNetProfit ? '+' : ''}${((summary.netPnlIdr / summary.totalPortfolioEstIdr) * 100).toFixed(2)}%`
                  : '+0.00%'}
              </span>
              <span className="text-[#686D7A]">total modal</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[#292C38]/60 text-[10px] text-[#9298A6] font-mono flex justify-between">
            <span>Estimasi Portofolio:</span>
            <span className="text-[#F5F5F7] font-bold">
              {formatValue(summary?.totalPortfolioEstIdr ?? 0, (summary?.totalPortfolioEstIdr ?? 0) / (summary?.usdtRate || 16450), false)}
            </span>
          </div>
        </div>

        {/* Card 2: Today's Live PnL */}
        <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9298A6] mb-1">
            <span className="font-semibold">Live PnL Hari Ini</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#00C087]/15 text-[#00C087] border border-[#00C087]/30">
              HARI INI
            </span>
          </div>
          <div className="my-1.5">
            <div className={`text-2xl font-extrabold font-mono tracking-tight ${isTodayProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {formatValue(summary?.todayPnlIdr ?? 0, summary?.todayPnlUsdt ?? 0)}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs font-mono">
              <span className={`inline-flex items-center font-bold ${isTodayProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                {isTodayProfit ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                {summary ? `${(summary.todayPnlPercent >= 0 ? '+' : '')}${summary.todayPnlPercent.toFixed(2)}%` : '+0.00%'}
              </span>
              <span className="text-[#686D7A]">return harian</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[#292C38]/60 text-[10px] text-[#9298A6] font-mono flex justify-between">
            <span>Status Pasar:</span>
            <span className="text-[#00C087] font-semibold">24/7 Bursa Aktif</span>
          </div>
        </div>

        {/* Card 3: Realized PnL (Closed Orders) */}
        <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9298A6] mb-1">
            <span className="font-semibold">Realized PnL (Terealisasi)</span>
            <span className="text-[10px] text-[#686D7A] font-mono">{summary?.totalTrades ?? 0} Order Selesai</span>
          </div>
          <div className="my-1.5">
            <div className={`text-2xl font-extrabold font-mono tracking-tight ${isRealizedProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {formatValue(summary?.totalRealizedPnlIdr ?? 0, summary?.totalRealizedPnlUsdt ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-[#9298A6] font-mono">
              Keuntungan bersih dari matched trade order
            </div>
          </div>
          <div className="pt-2 border-t border-[#292C38]/60 text-[10px] text-[#9298A6] font-mono flex justify-between">
            <span>Biaya Trading (Fee):</span>
            <span className="text-[#EB3458] font-bold">
              -{formatValue(summary?.totalFeesIdr ?? 0, summary?.totalFeesUsdt ?? 0, false)}
            </span>
          </div>
        </div>

        {/* Card 4: Unrealized PnL (Portfolio Positions) */}
        <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9298A6] mb-1">
            <span className="font-semibold">Unrealized PnL (Posisi Berjalan)</span>
            <span className="text-[10px] text-[#686D7A] font-mono">{assetBreakdown.length} Aset Koin</span>
          </div>
          <div className="my-1.5">
            <div className={`text-2xl font-extrabold font-mono tracking-tight ${isUnrealizedProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {formatValue(summary?.totalUnrealizedPnlIdr ?? 0, summary?.totalUnrealizedPnlUsdt ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-[#9298A6] font-mono">
              Valuasi terkini vs harga beli rata-rata aset
            </div>
          </div>
          <div className="pt-2 border-t border-[#292C38]/60 text-[10px] text-[#9298A6] font-mono flex justify-between">
            <span>Metode:</span>
            <span className="text-[#F5F5F7] font-semibold">Mark-to-Market Real-Time</span>
          </div>
        </div>

        {/* Card 5: Win Rate & Profit Factor */}
        <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9298A6] mb-1">
            <span className="font-semibold">Win Rate & Profit Factor</span>
            <Award className="w-4 h-4 text-[#FF087F]" />
          </div>
          <div className="my-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold font-mono text-[#00C087] tracking-tight">
                {summary?.winRateDaysPct ?? 0}%
              </span>
              <span className="text-xs text-[#9298A6] font-mono">Hari Untung</span>
            </div>
            <div className="mt-1 text-xs text-[#9298A6] font-mono flex items-center gap-2">
              <span>Profit Factor:</span>
              <span className="font-bold text-[#F5F5F7]">{summary?.profitFactor ?? 1.0}x</span>
              <span className="text-[#686D7A]">·</span>
              <span className="text-[#00C087]">{summary?.winningDaysCount ?? 0}W</span>
              <span className="text-[#686D7A]">/</span>
              <span className="text-[#EB3458]">{summary?.losingDaysCount ?? 0}L</span>
            </div>
          </div>
          <div className="pt-2 border-t border-[#292C38]/60 text-[10px] text-[#9298A6] font-mono flex justify-between">
            <span>Akurasi Order:</span>
            <span className="text-[#F5F5F7] font-bold">{summary?.winRateTradesPct ?? 0}% Menang</span>
          </div>
        </div>

        {/* Card 6: Trading Volume & High Marks */}
        <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-[#9298A6] mb-1">
            <span className="font-semibold">Total Volume Transaksi</span>
            <BarChart3 className="w-4 h-4 text-[#9298A6]" />
          </div>
          <div className="my-1.5">
            <div className="text-2xl font-extrabold font-mono text-[#F5F5F7] tracking-tight">
              {formatValue(summary?.totalVolumeIdr ?? 0, summary?.totalVolumeUsdt ?? 0, false)}
            </div>
            <div className="mt-1 text-xs text-[#9298A6] font-mono">
              Total turnover transaksi terverifikasi ledger
            </div>
          </div>
          <div className="pt-2 border-t border-[#292C38]/60 text-[10px] text-[#9298A6] font-mono flex justify-between">
            <span>Hari Terbaik:</span>
            <span className="text-[#00C087] font-bold">
              {summary?.bestDay ? `${formatValue(summary.bestDay.pnlIdr, summary.bestDay.pnlUsdt)}` : '-'}
            </span>
          </div>
        </div>
      </div>

      {/* Cumulative Equity Curve Chart Section */}
      <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-5 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#292C38]/80">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-[#00C087]" />
              <h3 className="text-sm font-bold text-[#F5F5F7]">Grafik Kurva Akumulasi PnL (Equity Curve)</h3>
            </div>
            <p className="text-xs text-[#9298A6]">
              Perkembangan hasil perdagangan harian dan kumulatif berdasarkan transaksi riil
            </p>
          </div>

          {/* Timeframe Filter Tabs */}
          <div className="flex items-center bg-[#0E1016] p-0.5 rounded-lg border border-[#292C38] text-xs font-mono self-start sm:self-auto">
            {(['7D', '14D', '30D', 'ALL'] as const).map(tf => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded font-bold transition-all ${
                  timeframe === tf
                    ? 'bg-[#1C1F29] text-[#F5F5F7] border border-[#292C38] shadow-sm'
                    : 'text-[#686D7A] hover:text-[#9298A6]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Chart Area */}
        <div className="h-64 sm:h-72 w-full pt-4 select-none">
          {filteredSeries.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[#9298A6] font-mono">
              Memuat data grafik performa...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredSeries} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="livePnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isNetProfit ? '#00C087' : '#EB3458'} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={isNetProfit ? '#00C087' : '#EB3458'} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#292C38" opacity={0.5} vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: '#292C38' }}
                  tick={{ fill: '#686D7A', fontSize: 10, fontFamily: 'monospace' }}
                  tickFormatter={val => val.slice(5)} // MM-DD
                />
                <YAxis
                  hide
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<CustomChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey={currency === 'IDR' ? 'cumulativePnlIdr' : 'cumulativePnlUsdt'}
                  stroke={isNetProfit ? '#00C087' : '#EB3458'}
                  strokeWidth={2.5}
                  fill="url(#livePnlGrad)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Asset-by-Asset PnL Breakdown Table */}
      <div className="rounded-xl bg-[#15171F] border border-[#292C38] overflow-hidden shadow-2xl">
        <div className="p-4 lg:p-5 border-b border-[#292C38] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#F5F5F7]">Rincian PnL Posisi Berjalan per Koin</h3>
            <p className="text-[11px] text-[#9298A6]">Perbandingan harga beli rata-rata dengan harga pasar saat ini</p>
          </div>
          <span className="text-xs font-mono text-[#9298A6]">
            {assetBreakdown.length} Posisi Koin
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0E1016] text-[#686D7A] text-[11px] border-b border-[#292C38]">
              <tr>
                <th className="py-3 px-4 font-sans">Aset / Koin</th>
                <th className="py-3 px-4 text-right">Saldo Saat Ini</th>
                <th className="py-3 px-4 text-right">Harga Beli Rata-Rata</th>
                <th className="py-3 px-4 text-right">Harga Pasar Sekarang</th>
                <th className="py-3 px-4 text-right">Unrealized PnL ({currency})</th>
                <th className="py-3 px-4 text-right">Return %</th>
                <th className="py-3 px-4 text-right font-sans">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#292C38]/40">
              {assetBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#9298A6] font-sans">
                    <p className="font-semibold text-xs text-[#F5F5F7] mb-1">Belum Ada Aset Terdaftar</p>
                    <p className="text-[11px]">Lakukan transaksi beli di pasar spot untuk memulai posisi trading.</p>
                  </td>
                </tr>
              ) : (
                assetBreakdown.map(item => {
                  const isUp = item.unrealizedPnlIdr >= 0;
                  const avgPrice = currency === 'IDR' ? formatIDR(String(item.avgBuyPriceIdr * 100)) : `$${item.avgBuyPriceUsdt.toLocaleString()}`;
                  const curPrice = currency === 'IDR' ? formatIDR(String(item.currentPriceIdr * 100)) : `$${item.currentPriceUsdt.toLocaleString()}`;
                  const pnlDisplay = formatValue(item.unrealizedPnlIdr, item.unrealizedPnlUsdt);

                  return (
                    <tr key={item.symbol} className="hover:bg-[#1C1F29]/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-[#0E1016] border border-[#292C38] flex items-center justify-center font-bold text-xs text-[#FF087F]">
                            {item.symbol.slice(0, 3)}
                          </div>
                          <div>
                            <span className="font-bold text-[#F5F5F7] block">{item.symbol}</span>
                            <span className="text-[10px] text-[#686D7A]">
                              Total Beli: {item.totalBought} {item.symbol}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#F5F5F7]">
                        {hideBalance ? '••••' : `${item.holding} ${item.symbol}`}
                      </td>
                      <td className="py-3 px-4 text-right text-[#9298A6]">
                        {avgPrice}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[#F5F5F7]">
                        {curPrice}
                      </td>
                      <td className={`py-3 px-4 text-right font-bold ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                        {pnlDisplay}
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={`inline-flex items-center ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                          {isUp ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                          {isUp ? '+' : ''}{item.returnPct}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-sans">
                        {onNavigateTrade && item.symbol !== 'IDR' && (
                          <button
                            onClick={() => onNavigateTrade(`${item.symbol}-IDR`)}
                            className="px-2.5 py-1 text-xs font-semibold text-[#FF087F] hover:text-white bg-[#0E1016] hover:bg-[#FF087F]/20 border border-[#FF087F]/30 rounded-lg transition-colors"
                          >
                            Trade
                          </button>
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
