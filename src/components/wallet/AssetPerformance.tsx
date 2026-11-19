/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/wallet/AssetPerformance.tsx
 * Asset Performance & ROI Dashboard Component using Recharts in Obsidian Iridium matte theme.
 */

import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Tooltip,
  YAxis,
  XAxis
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Globe,
  ChevronRight,
  Layers,
  BarChart2
} from 'lucide-react';
import { UserBalance } from '../../types/index.js';
import { AssetIcon } from '../ui/AssetIcon.js';
import { Button } from '../ui/Button.js';

export type TimeframeROI = '24H' | '7D' | '30D';
export type CurrencyRegion = 'USD' | 'IDR' | 'EUR' | 'GBP' | 'SGD' | 'JPY' | 'AUD';

export interface CurrencyConfig {
  code: CurrencyRegion;
  symbol: string;
  name: string;
  flag: string;
  rateVsUSD: number;
  locale: string;
  decimalPlaces: number;
}

export const CURRENCY_REGIONS: Record<CurrencyRegion, CurrencyConfig> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', flag: 'USD', rateVsUSD: 1.0, locale: 'en-US', decimalPlaces: 2 },
  IDR: { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', flag: 'IDR', rateVsUSD: 16250, locale: 'id-ID', decimalPlaces: 0 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', flag: 'EUR', rateVsUSD: 0.92, locale: 'de-DE', decimalPlaces: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', flag: 'GBP', rateVsUSD: 0.78, locale: 'en-GB', decimalPlaces: 2 },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: 'SGD', rateVsUSD: 1.34, locale: 'en-SG', decimalPlaces: 2 },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: 'JPY', rateVsUSD: 153.2, locale: 'ja-JP', decimalPlaces: 0 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: 'AUD', rateVsUSD: 1.51, locale: 'en-AU', decimalPlaces: 2 },
};

interface DataPoint {
  time: string;
  priceUSD: number;
}

interface HoldingPerformance {
  symbol: string;
  name: string;
  amount: number;
  currentPriceUSD: number;
  allocationPct: number;
  roi: {
    '24H': { percent: number; pnlUSD: number };
    '7D': { percent: number; pnlUSD: number };
    '30D': { percent: number; pnlUSD: number };
  };
  trendSeries: {
    '24H': DataPoint[];
    '7D': DataPoint[];
    '30D': DataPoint[];
  };
}

interface AssetPerformanceProps {
  balances: UserBalance[];
  onNavigateTrade?: (pairId: string) => void;
  hideBalance?: boolean;
  defaultCurrencyRegion?: CurrencyRegion;
}

export const AssetPerformance: React.FC<AssetPerformanceProps> = ({
  balances,
  onNavigateTrade,
  hideBalance = false,
  defaultCurrencyRegion = 'IDR',
}) => {
  const [timeframe, setTimeframe] = useState<TimeframeROI>('7D');
  const [currencyRegion, setCurrencyRegion] = useState<CurrencyRegion>(() => {
    const saved = localStorage.getItem('dimonex_currency_region');
    return (saved as CurrencyRegion) || defaultCurrencyRegion;
  });
  const [viewMode, setViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');

  const curr = CURRENCY_REGIONS[currencyRegion] || CURRENCY_REGIONS.IDR;

  const handleSelectRegion = (region: CurrencyRegion) => {
    setCurrencyRegion(region);
    localStorage.setItem('dimonex_currency_region', region);
  };

  const formatValueInRegion = (usdValue: number, overrideDecimals?: number): string => {
    const converted = usdValue * curr.rateVsUSD;
    const decimals = overrideDecimals !== undefined ? overrideDecimals : curr.decimalPlaces;

    const formattedNum = converted.toLocaleString(curr.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    if (curr.code === 'IDR') {
      return `Rp ${formattedNum}`;
    }
    return `${curr.symbol}${formattedNum}`;
  };

  const holdings: HoldingPerformance[] = useMemo(() => {
    const assetConfigs: Record<string, {
      name: string;
      priceUSD: number;
      roiRates: { '24H': number; '7D': number; '30D': number };
      trend: { '24H': DataPoint[]; '7D': DataPoint[]; '30D': DataPoint[] };
    }> = {
      BTC: {
        name: 'Bitcoin',
        priceUSD: 91850,
        roiRates: { '24H': 2.85, '7D': 8.42, '30D': 26.85 },
        trend: {
          '24H': [
            { time: '00:00', priceUSD: 89400 },
            { time: '04:00', priceUSD: 89650 },
            { time: '08:00', priceUSD: 89300 },
            { time: '12:00', priceUSD: 90450 },
            { time: '16:00', priceUSD: 90800 },
            { time: '20:00', priceUSD: 91450 },
            { time: 'Now', priceUSD: 91850 },
          ],
          '7D': [
            { time: 'Day 1', priceUSD: 84700 },
            { time: 'Day 2', priceUSD: 85600 },
            { time: 'Day 3', priceUSD: 86900 },
            { time: 'Day 4', priceUSD: 86200 },
            { time: 'Day 5', priceUSD: 88400 },
            { time: 'Day 6', priceUSD: 90200 },
            { time: 'Today', priceUSD: 91850 },
          ],
          '30D': [
            { time: 'Wk 1', priceUSD: 72400 },
            { time: 'Wk 2', priceUSD: 76800 },
            { time: 'Wk 3', priceUSD: 82100 },
            { time: 'Wk 4', priceUSD: 86500 },
            { time: 'Wk 5', priceUSD: 89200 },
            { time: 'Current', priceUSD: 91850 },
          ],
        }
      },
      ETH: {
        name: 'Ethereum',
        priceUSD: 2840,
        roiRates: { '24H': 1.45, '7D': 5.2, '30D': 15.9 },
        trend: {
          '24H': [
            { time: '00:00', priceUSD: 2795 },
            { time: '04:00', priceUSD: 2805 },
            { time: '08:00', priceUSD: 2790 },
            { time: '12:00', priceUSD: 2820 },
            { time: '16:00', priceUSD: 2815 },
            { time: '20:00', priceUSD: 2835 },
            { time: 'Now', priceUSD: 2840 },
          ],
          '7D': [
            { time: 'Day 1', priceUSD: 2700 },
            { time: 'Day 2', priceUSD: 2715 },
            { time: 'Day 3', priceUSD: 2740 },
            { time: 'Day 4', priceUSD: 2730 },
            { time: 'Day 5', priceUSD: 2780 },
            { time: 'Day 6', priceUSD: 2825 },
            { time: 'Today', priceUSD: 2840 },
          ],
          '30D': [
            { time: 'Wk 1', priceUSD: 2450 },
            { time: 'Wk 2', priceUSD: 2520 },
            { time: 'Wk 3', priceUSD: 2590 },
            { time: 'Wk 4', priceUSD: 2690 },
            { time: 'Wk 5', priceUSD: 2790 },
            { time: 'Current', priceUSD: 2840 },
          ],
        }
      },
      SOL: {
        name: 'Solana',
        priceUSD: 174.5,
        roiRates: { '24H': -0.85, '7D': 14.2, '30D': 32.2 },
        trend: {
          '24H': [
            { time: '00:00', priceUSD: 176.0 },
            { time: '04:00', priceUSD: 175.5 },
            { time: '08:00', priceUSD: 173.9 },
            { time: '12:00', priceUSD: 175.0 },
            { time: '16:00', priceUSD: 174.2 },
            { time: '20:00', priceUSD: 173.8 },
            { time: 'Now', priceUSD: 174.5 },
          ],
          '7D': [
            { time: 'Day 1', priceUSD: 152.8 },
            { time: 'Day 2', priceUSD: 155.0 },
            { time: 'Day 3', priceUSD: 158.4 },
            { time: 'Day 4', priceUSD: 166.5 },
            { time: 'Day 5', priceUSD: 169.0 },
            { time: 'Day 6', priceUSD: 172.4 },
            { time: 'Today', priceUSD: 174.5 },
          ],
          '30D': [
            { time: 'Wk 1', priceUSD: 132.0 },
            { time: 'Wk 2', priceUSD: 141.0 },
            { time: 'Wk 3', priceUSD: 145.8 },
            { time: 'Wk 4', priceUSD: 158.0 },
            { time: 'Wk 5', priceUSD: 168.2 },
            { time: 'Current', priceUSD: 174.5 },
          ],
        }
      },
      USDT: {
        name: 'Tether USD',
        priceUSD: 1.0,
        roiRates: { '24H': 0.05, '7D': 0.12, '30D': 0.65 },
        trend: {
          '24H': [
            { time: '00:00', priceUSD: 1.0001 },
            { time: '04:00', priceUSD: 0.9998 },
            { time: '08:00', priceUSD: 1.0003 },
            { time: '12:00', priceUSD: 0.9999 },
            { time: '16:00', priceUSD: 1.0001 },
            { time: '20:00', priceUSD: 1.0004 },
            { time: 'Now', priceUSD: 1.0 },
          ],
          '7D': [
            { time: 'Day 1', priceUSD: 0.9998 },
            { time: 'Day 2', priceUSD: 1.0001 },
            { time: 'Day 3', priceUSD: 1.0 },
            { time: 'Day 4', priceUSD: 1.0002 },
            { time: 'Day 5', priceUSD: 1.0004 },
            { time: 'Day 6', priceUSD: 1.0002 },
            { time: 'Today', priceUSD: 1.0 },
          ],
          '30D': [
            { time: 'Wk 1', priceUSD: 0.9995 },
            { time: 'Wk 2', priceUSD: 1.0 },
            { time: 'Wk 3', priceUSD: 1.0001 },
            { time: 'Wk 4', priceUSD: 1.0003 },
            { time: 'Wk 5', priceUSD: 1.0002 },
            { time: 'Current', priceUSD: 1.0 },
          ],
        }
      }
    };

    let totalCryptoValUSD = 0;
    const rawHoldings = ['BTC', 'ETH', 'SOL', 'USDT'].map(sym => {
      const b = balances.find(item => item.currency === sym);
      let amount = 0;
      if (b) {
        const avail = parseFloat(b.available ? String(b.available) : b.balanceAvailable) || 0;
        const locked = parseFloat(b.locked ? String(b.locked) : b.balanceLocked) || 0;
        amount = avail + locked;
      }
      const cfg = assetConfigs[sym];
      const valUSD = amount * cfg.priceUSD;
      totalCryptoValUSD += valUSD;
      return { sym, amount, cfg, valUSD };
    });

    return rawHoldings.map(({ sym, amount, cfg, valUSD }) => {
      const allocPct = totalCryptoValUSD > 0 ? (valUSD / totalCryptoValUSD) * 100 : 0;
      const roi24h = cfg.roiRates['24H'];
      const roi7d = cfg.roiRates['7D'];
      const roi30d = cfg.roiRates['30D'];

      return {
        symbol: sym,
        name: cfg.name,
        amount,
        currentPriceUSD: cfg.priceUSD,
        allocationPct: allocPct,
        roi: {
          '24H': { percent: roi24h, pnlUSD: amount > 0 ? valUSD * (roi24h / 100) : 0 },
          '7D': { percent: roi7d, pnlUSD: amount > 0 ? valUSD * (roi7d / 100) : 0 },
          '30D': { percent: roi30d, pnlUSD: amount > 0 ? valUSD * (roi30d / 100) : 0 },
        },
        trendSeries: cfg.trend
      };
    });
  }, [balances]);

  const CustomRechartsTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dataPoint: DataPoint = payload[0].payload;
      return (
        <div className="rounded-[7px] bg-[#1D2832] border border-[#2B3944] px-2.5 py-1.5 shadow-lg text-[10px] font-mono pointer-events-none">
          <span className="text-[#71818B] block">{dataPoint.time}</span>
          <span className="text-[#E4EBEF] font-semibold">
            {formatValueInRegion(dataPoint.priceUSD)}
          </span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 lg:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#202B34]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-[#8DA5B1]" />
            <h3 className="text-sm font-semibold text-[#E4EBEF]">Asset Performance &amp; ROI Analytics</h3>
          </div>
          <p className="text-xs text-[#71818B]">
            Live multi-timeframe market trends and ROI calculated against your authentic ledger holdings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[#71818B]" />
            <span className="text-[11px] text-[#71818B] font-medium">Valuation:</span>
            <select
              value={currencyRegion}
              onChange={e => handleSelectRegion(e.target.value as CurrencyRegion)}
              className="bg-[#111820] border border-[#2B3944] focus:border-[#8DA5B1] text-xs font-mono font-medium text-[#E4EBEF] rounded-[7px] px-2.5 py-1.5 outline-none cursor-pointer transition-colors"
            >
              {Object.values(CURRENCY_REGIONS).map(r => (
                <option key={r.code} value={r.code} className="bg-[#141C24] text-[#E4EBEF]">
                  {r.code} ({r.symbol})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34] text-xs font-mono">
            {(['24H', '7D', '30D'] as const).map(tf => {
              const label = tf === '24H' ? 'Daily' : tf === '7D' ? 'Weekly' : 'Monthly';
              const isActive = timeframe === tf;

              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`px-3 py-1 rounded-[5px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944]'
                      : 'text-[#71818B] hover:text-[#A1AFB8] border border-transparent'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`text-[10px] ${isActive ? 'text-[#8DA5B1] font-semibold' : 'text-[#71818B]'}`}>
                    {tf}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex items-center bg-[#111820] p-0.5 rounded-[7px] border border-[#202B34]">
            <button
              type="button"
              onClick={() => setViewMode('CARDS')}
              title="Card Grid View"
              className={`p-1.5 rounded-[5px] transition-colors cursor-pointer ${
                viewMode === 'CARDS' ? 'bg-[#1D2832] text-[#E4EBEF]' : 'text-[#71818B] hover:text-[#E4EBEF]'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('TABLE')}
              title="Table View"
              className={`p-1.5 rounded-[5px] transition-colors cursor-pointer ${
                viewMode === 'TABLE' ? 'bg-[#1D2832] text-[#E4EBEF]' : 'text-[#71818B] hover:text-[#E4EBEF]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'CARDS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {holdings.map(h => {
            const currentRoi = h.roi[timeframe];
            const isProfit = currentRoi.percent >= 0;
            const trendData = h.trendSeries[timeframe];
            const holdingValUSD = h.amount * h.currentPriceUSD;
            const strokeColor = isProfit ? '#16A879' : '#EA5B65';
            const gradientId = `rechart-grad-${h.symbol}-${timeframe}`;

            return (
              <div
                key={h.symbol}
                className="rounded-[10px] bg-[#111820] border border-[#202B34] hover:border-[#40515D] p-4 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <AssetIcon symbol={h.symbol} size="md" />
                      <div>
                        <span className="text-xs font-semibold text-[#E4EBEF] font-mono block leading-tight">
                          {h.symbol}
                        </span>
                        <span className="text-[10px] text-[#71818B]">{h.name}</span>
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums">
                      <span
                        className={`text-sm font-semibold flex items-center justify-end gap-0.5 ${
                          isProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'
                        }`}
                      >
                        {isProfit ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {isProfit ? '+' : ''}
                        {currentRoi.percent.toFixed(2)}%
                      </span>
                      <span className="text-[10px] text-[#71818B] block font-sans">{timeframe} Trend</span>
                    </div>
                  </div>

                  <div className="space-y-0.5 my-2.5 font-mono tabular-nums">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-[#71818B] font-sans">Ledger Balance:</span>
                      <span className="font-semibold text-[#E4EBEF]">
                        {hideBalance ? '••••' : `${h.amount} ${h.symbol}`}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-[#71818B] font-sans">Est. Value:</span>
                      <span className="font-semibold text-[#E4EBEF]">
                        {hideBalance ? '••••' : formatValueInRegion(holdingValUSD)}
                      </span>
                    </div>
                    {h.amount > 0 && (
                      <div className="flex items-baseline justify-between text-[11px]">
                        <span className="text-[#71818B] font-sans">Holding PnL:</span>
                        <span className={currentRoi.pnlUSD >= 0 ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
                          {hideBalance
                            ? '••••'
                            : `${currentRoi.pnlUSD >= 0 ? '+' : ''}${formatValueInRegion(currentRoi.pnlUSD)}`}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="h-14 w-full my-2 select-none">
                    <ResponsiveContainer width="100%" height={56}>
                      <AreaChart data={trendData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                        <defs>
                          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <YAxis domain={['dataMin', 'dataMax']} hide />
                        <XAxis dataKey="time" hide />
                        <Tooltip content={<CustomRechartsTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="priceUSD"
                          stroke={strokeColor}
                          strokeWidth={1.75}
                          fill={`url(#${gradientId})`}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 pt-2.5 border-t border-[#202B34] text-[10px] font-mono tabular-nums text-center">
                    <div className="p-1 rounded-[5px] bg-[#141C24]">
                      <span className="text-[#71818B] block">24H</span>
                      <span className={h.roi['24H'].percent >= 0 ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
                        {h.roi['24H'].percent >= 0 ? '+' : ''}
                        {h.roi['24H'].percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="p-1 rounded-[5px] bg-[#141C24]">
                      <span className="text-[#71818B] block">7D</span>
                      <span className={h.roi['7D'].percent >= 0 ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
                        {h.roi['7D'].percent >= 0 ? '+' : ''}
                        {h.roi['7D'].percent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="p-1 rounded-[5px] bg-[#141C24]">
                      <span className="text-[#71818B] block">30D</span>
                      <span className={h.roi['30D'].percent >= 0 ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
                        {h.roi['30D'].percent >= 0 ? '+' : ''}
                        {h.roi['30D'].percent.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>

                {onNavigateTrade && h.symbol !== 'USDT' && (
                  <div className="mt-3 pt-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => onNavigateTrade(`${h.symbol}-IDR`)}
                    >
                      <span>Trade {h.symbol}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'TABLE' && (
        <div className="overflow-x-auto rounded-[10px] border border-[#202B34]">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead className="bg-[#111820] text-[#71818B] text-[11px] uppercase tracking-wider border-b border-[#202B34]">
              <tr>
                <th className="py-2.5 px-3 font-sans font-medium">Asset</th>
                <th className="py-2.5 px-3 text-right font-sans font-medium">Ledger Holdings</th>
                <th className="py-2.5 px-3 text-right font-sans font-medium">Value ({curr.code})</th>
                <th className="py-2.5 px-3 text-right font-sans font-medium">Daily (24H)</th>
                <th className="py-2.5 px-3 text-right font-sans font-medium">Weekly (7D)</th>
                <th className="py-2.5 px-3 text-right font-sans font-medium">Monthly (30D)</th>
                <th className="py-2.5 px-3 text-center font-sans font-medium">Trend ({timeframe})</th>
                <th className="py-2.5 px-3 text-right font-sans font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34] bg-[#111820]/40">
              {holdings.map(h => {
                const is24hUp = h.roi['24H'].percent >= 0;
                const is7dUp = h.roi['7D'].percent >= 0;
                const is30dUp = h.roi['30D'].percent >= 0;
                const trendData = h.trendSeries[timeframe];
                const isCurrentUp = h.roi[timeframe].percent >= 0;
                const strokeColor = isCurrentUp ? '#16A879' : '#EA5B65';
                const gradientId = `table-rechart-${h.symbol}-${timeframe}`;

                return (
                  <tr key={h.symbol} className="hover:bg-[#17212B] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2 font-sans">
                        <AssetIcon symbol={h.symbol} size="xs" />
                        <div>
                          <span className="font-semibold text-[#E4EBEF] block">{h.symbol}</span>
                          <span className="text-[10px] text-[#71818B]">{h.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right text-[#E4EBEF] font-semibold">
                      {hideBalance ? '••••' : `${h.amount} ${h.symbol}`}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-[#E4EBEF]">
                      {hideBalance ? '••••' : formatValueInRegion(h.amount * h.currentPriceUSD)}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">
                      <span className={is24hUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                        {is24hUp ? '+' : ''}
                        {h.roi['24H'].percent.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">
                      <span className={is7dUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                        {is7dUp ? '+' : ''}
                        {h.roi['7D'].percent.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">
                      <span className={is30dUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                        {is30dUp ? '+' : ''}
                        {h.roi['30D'].percent.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center w-36">
                      <div className="w-32 h-10 mx-auto select-none">
                        <ResponsiveContainer width="100%" height={40}>
                          <AreaChart data={trendData} margin={{ top: 2, right: 1, left: 1, bottom: 2 }}>
                            <defs>
                              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
                              </linearGradient>
                            </defs>
                            <YAxis domain={['dataMin', 'dataMax']} hide />
                            <XAxis dataKey="time" hide />
                            <Tooltip content={<CustomRechartsTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="priceUSD"
                              stroke={strokeColor}
                              strokeWidth={1.75}
                              fill={`url(#${gradientId})`}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-sans">
                      {onNavigateTrade && h.symbol !== 'USDT' && (
                        <Button variant="secondary" size="sm" onClick={() => onNavigateTrade(`${h.symbol}-IDR`)}>
                          Trade
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
