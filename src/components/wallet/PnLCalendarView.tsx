/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/wallet/PnLCalendarView.tsx
 * Interactive PnL Calendar Heatmap & Daily Profit/Loss Inspector.
 * Strictly calculated from real user trade executions and ledger double-entry settlements.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Award,
  Layers,
  Clock,
  ExternalLink,
  X,
  Filter,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { formatIDR } from '../../lib/formatters.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';

interface Props {
  onNavigateTrade?: (pairId: string) => void;
  hideBalance?: boolean;
}

export interface DayTradeDetail {
  id: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  price: string;
  rawPrice: string;
  quantity: string;
  rawQuantity: string;
  quoteVolume: string;
  rawQuoteVolume: string;
  pnlIdr: number;
  pnlUsdt: number;
  feeIdr: number;
  feeUsdt: number;
  time: string;
  timestamp: number;
}

export interface DayPnLRecord {
  date: string; // 'YYYY-MM-DD'
  timestamp: number;
  pnlIdr: number;
  pnlUsdt: number;
  volumeIdr: number;
  volumeUsdt: number;
  feesIdr: number;
  feesUsdt: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
  returnPct: number;
  trades: DayTradeDetail[];
}

export const PnLCalendarView: React.FC<Props> = ({ onNavigateTrade, hideBalance = false }) => {
  const [currency, setCurrency] = useState<'IDR' | 'USDT'>('IDR');
  const [isLoading, setIsLoading] = useState(false);
  const [calendarMap, setCalendarMap] = useState<Record<string, DayPnLRecord>>({});
  const [selectedDayRecord, setSelectedDayRecord] = useState<DayPnLRecord | null>(null);

  // Month navigation: year and month index (0 = Jan, 10 = Nov, 11 = Dec)
  // Default to November 2026
  const [currentYear, setCurrentYear] = useState<number>(2026);
  const [currentMonth, setCurrentMonth] = useState<number>(10); // 0-indexed: 10 = November

  const monthNamesID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const dayNamesID = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  // Format month string YYYY-MM
  const currentMonthKey = useMemo(() => {
    const mStr = String(currentMonth + 1).padStart(2, '0');
    return `${currentYear}-${mStr}`;
  }, [currentYear, currentMonth]);

  // Fetch PnL Analytics for calendar
  const fetchCalendarData = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsLoading(true);
      const res = await fetch(`/api/wallet/pnl-analytics?currency=${currency}&month=${currentMonthKey}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.calendarData) {
          setCalendarMap(data.calendarData);
        }
      }
    } catch (e) {
      console.warn('Failed to load PnL calendar data:', e);
    } finally {
      setIsLoading(false);
    }
  }, [currency, currentMonthKey]);

  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);

  // Navigate months
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const handleJumpToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
  };

  // Format Value helper
  const formatVal = (valIdr: number, valUsdt: number, showSign = true): string => {
    if (hideBalance) return '••••••';
    const isIdr = currency === 'IDR';
    const val = isIdr ? valIdr : valUsdt;
    const sign = showSign && val > 0 ? '+' : '';

    if (isIdr) {
      return `${sign}${formatIDR(String(Math.round(val)))}`;
    }
    return `${sign}$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
  };

  // Compute Calendar Grid Days
  const calendarGrid = useMemo(() => {
    // Number of days in current month
    const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Day of the week for the 1st of the month (0 = Sun, 1 = Mon ... 6 = Sat)
    const firstDayIndexSunday = new Date(currentYear, currentMonth, 1).getDay();
    // Convert to Monday-first (0 = Mon ... 6 = Sun)
    const startOffset = (firstDayIndexSunday + 6) % 7;

    const days = [];

    // Preceding empty slots
    for (let i = 0; i < startOffset; i++) {
      days.push({ isSpacer: true, dayNum: 0, dateKey: '' });
    }

    // Actual calendar days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dStr = String(d).padStart(2, '0');
      const dateKey = `${currentMonthKey}-${dStr}`;
      const record = calendarMap[dateKey] || null;
      days.push({
        isSpacer: false,
        dayNum: d,
        dateKey,
        record
      });
    }

    return days;
  }, [currentYear, currentMonth, currentMonthKey, calendarMap]);

  // Compute Monthly Summary Aggregates
  interface MonthSummaryData {
    totalPnlIdr: number;
    totalPnlUsdt: number;
    totalVolumeIdr: number;
    totalVolumeUsdt: number;
    totalTrades: number;
    winDays: number;
    lossDays: number;
    activeDays: number;
    winRate: number;
    isProfit: boolean;
    bestDay: { date: string; pnlIdr: number; pnlUsdt: number; returnPct: number } | null;
  }

  const monthSummary: MonthSummaryData = useMemo(() => {
    let totalPnlIdr = 0;
    let totalPnlUsdt = 0;
    let totalVolumeIdr = 0;
    let totalVolumeUsdt = 0;
    let totalTrades = 0;
    let winDays = 0;
    let lossDays = 0;
    let activeDays = 0;
    let bestDay: { date: string; pnlIdr: number; pnlUsdt: number; returnPct: number } | null = null;

    Object.entries(calendarMap).forEach(([key, rec]) => {
      if (key.startsWith(currentMonthKey) && rec.tradesCount > 0) {
        activeDays++;
        totalPnlIdr += rec.pnlIdr;
        totalPnlUsdt += rec.pnlUsdt;
        totalVolumeIdr += rec.volumeIdr;
        totalVolumeUsdt += rec.volumeUsdt;
        totalTrades += rec.tradesCount;

        if (rec.pnlIdr > 0) winDays++;
        else if (rec.pnlIdr < 0) lossDays++;

        if (!bestDay || rec.pnlIdr > bestDay.pnlIdr) {
          bestDay = { date: rec.date, pnlIdr: rec.pnlIdr, pnlUsdt: rec.pnlUsdt, returnPct: rec.returnPct };
        }
      }
    });

    const isProfit = totalPnlIdr >= 0;
    const winRate = activeDays > 0 ? Number(((winDays / activeDays) * 100).toFixed(1)) : 0;

    return {
      totalPnlIdr,
      totalPnlUsdt,
      totalVolumeIdr,
      totalVolumeUsdt,
      totalTrades,
      winDays,
      lossDays,
      activeDays,
      winRate,
      isProfit,
      bestDay
    };
  }, [calendarMap, currentMonthKey]);

  const todayDateKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

  return (
    <div className="space-y-6">
      {/* Top Header: Month Navigation & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-[#15171F] border border-[#292C38]">
        {/* Month Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#0E1016] p-1 rounded-lg border border-[#292C38]">
            <button
              onClick={handlePrevMonth}
              title="Bulan Sebelumnya"
              className="p-1 rounded text-[#9298A6] hover:text-[#F5F5F7] hover:bg-[#1C1F29] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-2 font-display font-bold text-sm text-[#F5F5F7] min-w-[140px] text-center">
              {monthNamesID[currentMonth]} {currentYear}
            </div>
            <button
              onClick={handleNextMonth}
              title="Bulan Berikutnya"
              className="p-1 rounded text-[#9298A6] hover:text-[#F5F5F7] hover:bg-[#1C1F29] transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={handleJumpToday}
            className="px-2.5 py-1 text-xs font-mono font-semibold rounded-lg bg-[#1C1F29] text-[#9298A6] hover:text-[#F5F5F7] border border-[#292C38] transition-colors"
          >
            Hari Ini
          </button>
        </div>

        {/* Currency Toggle & Quick Refresh */}
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
            onClick={fetchCalendarData}
            title="Segarkan kalender"
            className="p-1.5 rounded-lg bg-[#0E1016] border border-[#292C38] hover:border-[#FF087F]/40 text-[#9298A6] hover:text-[#F5F5F7] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#FF087F]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Monthly Performance Aggregates Banner */}
      <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-5 shadow-2xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Monthly PnL */}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#9298A6] block">Total PnL Bulan Ini</span>
            <div className={`text-xl font-extrabold font-mono tracking-tight ${monthSummary.isProfit ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
              {formatVal(monthSummary.totalPnlIdr, monthSummary.totalPnlUsdt)}
            </div>
            <span className="text-[11px] text-[#686D7A] font-mono block">
              {monthNamesID[currentMonth]} {currentYear}
            </span>
          </div>

          {/* Win Rate & Days */}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#9298A6] block">Rasio Kemenangan (Win Rate)</span>
            <div className="text-xl font-extrabold font-mono text-[#00C087] tracking-tight">
              {monthSummary.winRate}%
            </div>
            <div className="text-[11px] text-[#9298A6] font-mono">
              <span className="text-[#00C087] font-bold">{monthSummary.winDays} Hari Untung</span>
              <span className="text-[#686D7A]"> · </span>
              <span className="text-[#EB3458] font-bold">{monthSummary.lossDays} Rugi</span>
            </div>
          </div>

          {/* Total Monthly Trades */}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#9298A6] block">Aktivitas Transaksi</span>
            <div className="text-xl font-extrabold font-mono text-[#F5F5F7] tracking-tight">
              {monthSummary.totalTrades} Order
            </div>
            <span className="text-[11px] text-[#9298A6] font-mono block">
              Vol: {formatVal(monthSummary.totalVolumeIdr, monthSummary.totalVolumeUsdt, false)}
            </span>
          </div>

          {/* Best Day */}
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#9298A6] block">Hari Terbaik Bulan Ini</span>
            <div className="text-xl font-extrabold font-mono text-[#00C087] tracking-tight">
              {monthSummary.bestDay != null ? formatVal(monthSummary.bestDay.pnlIdr, monthSummary.bestDay.pnlUsdt) : '-'}
            </div>
            <span className="text-[11px] text-[#9298A6] font-mono block">
              {monthSummary.bestDay != null ? monthSummary.bestDay.date : 'Belum ada'}
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Calendar 7-Column Grid */}
      <div className="rounded-xl bg-[#15171F] border border-[#292C38] p-4 lg:p-6 shadow-2xl">
        {/* Day of Week Headers */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2 text-center text-xs font-bold text-[#686D7A] font-mono">
          {dayNamesID.map(day => (
            <div key={day} className="py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {calendarGrid.map((cell, idx) => {
            if (cell.isSpacer) {
              return (
                <div
                  key={`spacer-${idx}`}
                  className="h-20 sm:h-24 rounded-lg bg-[#0E1016]/30 border border-transparent opacity-30 pointer-events-none"
                />
              );
            }

            const rec = cell.record;
            const hasActivity = rec && rec.tradesCount > 0;
            const isProfit = rec && rec.pnlIdr > 0;
            const isLoss = rec && rec.pnlIdr < 0;
            const isToday = cell.dateKey === todayDateKey;

            // Cell Styles
            let bgClass = 'bg-[#0E1016] border-[#292C38]/60 hover:border-[#FF087F]/50';
            if (hasActivity) {
              if (isProfit) {
                bgClass = 'bg-[#00C087]/10 border-[#00C087]/35 hover:border-[#00C087] hover:bg-[#00C087]/15';
              } else if (isLoss) {
                bgClass = 'bg-[#EB3458]/10 border-[#EB3458]/35 hover:border-[#EB3458] hover:bg-[#EB3458]/15';
              }
            }

            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => {
                  if (rec && rec.trades.length > 0) {
                    setSelectedDayRecord(rec);
                  }
                }}
                className={`h-20 sm:h-24 p-1.5 sm:p-2 rounded-xl border flex flex-col justify-between text-left transition-all duration-150 group relative ${bgClass} ${
                  hasActivity ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                {/* Day Header: Day Number + Today Badge */}
                <div className="flex items-center justify-between w-full">
                  <span className={`text-xs font-bold font-mono ${
                    isToday ? 'text-[#FF087F] font-extrabold' : 'text-[#F5F5F7]'
                  }`}>
                    {cell.dayNum}
                  </span>
                  {isToday && (
                    <span className="px-1 py-0.2 rounded text-[8px] font-bold bg-[#FF087F] text-white">
                      HARI INI
                    </span>
                  )}
                </div>

                {/* Day Content: PnL & Trade Badge */}
                {hasActivity ? (
                  <div className="space-y-0.5 my-auto w-full">
                    <div className={`text-[11px] sm:text-xs font-bold font-mono truncate ${
                      isProfit ? 'text-[#00C087]' : (isLoss ? 'text-[#EB3458]' : 'text-[#F5F5F7]')
                    }`}>
                      {formatVal(rec.pnlIdr, rec.pnlUsdt)}
                    </div>
                    <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono text-[#9298A6]">
                      <span className={rec.returnPct >= 0 ? 'text-[#00C087]' : 'text-[#EB3458]'}>
                        {rec.returnPct >= 0 ? '+' : ''}{rec.returnPct}%
                      </span>
                      <span className="text-[#686D7A] hidden sm:inline">
                        {rec.tradesCount} tx
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-[#686D7A] font-mono my-auto">
                    -
                  </div>
                )}

                {/* Micro Win/Loss Dots */}
                {hasActivity && (
                  <div className="flex items-center gap-1 pt-1 border-t border-white/5 text-[9px] font-mono text-[#686D7A]">
                    <span className="text-[#00C087] font-semibold">{rec.winCount}W</span>
                    <span>/</span>
                    <span className="text-[#EB3458] font-semibold">{rec.lossCount}L</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend & Help Footer */}
        <div className="mt-5 pt-4 border-t border-[#292C38]/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#00C087]/20 border border-[#00C087]" />
              <span className="text-[#9298A6]">Profit (Untung)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#EB3458]/20 border border-[#EB3458]" />
              <span className="text-[#9298A6]">Loss (Rugi)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#0E1016] border border-[#292C38]" />
              <span className="text-[#686D7A]">Tidak Ada Order</span>
            </div>
          </div>

          <span className="text-[11px] text-[#686D7A]">
            💡 Klik tanggal untuk membuka daftar riwayat transaksi & eksekusi order hari tersebut.
          </span>
        </div>
      </div>

      {/* Day Detail Inspector Modal */}
      {selectedDayRecord && (
        <Modal
          isOpen={Boolean(selectedDayRecord)}
          onClose={() => setSelectedDayRecord(null)}
          title={`Detail Transaksi: ${selectedDayRecord.date}`}
          subtitle={`Catatan eksekusi riil ${selectedDayRecord.tradesCount} order pada hari tersebut.`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4">
            {/* Day Financial Summary Card */}
            <div className="p-4 rounded-xl bg-[#0E1016] border border-[#292C38] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div>
                <span className="text-[#686D7A] block text-[10px]">Total PnL Bersih</span>
                <span className={`text-sm font-bold ${selectedDayRecord.pnlIdr >= 0 ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                  {formatVal(selectedDayRecord.pnlIdr, selectedDayRecord.pnlUsdt)}
                </span>
              </div>
              <div>
                <span className="text-[#686D7A] block text-[10px]">Return Harian</span>
                <span className={`text-sm font-bold ${selectedDayRecord.returnPct >= 0 ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                  {selectedDayRecord.returnPct >= 0 ? '+' : ''}{selectedDayRecord.returnPct}%
                </span>
              </div>
              <div>
                <span className="text-[#686D7A] block text-[10px]">Total Volume</span>
                <span className="text-sm font-bold text-[#F5F5F7]">
                  {formatVal(selectedDayRecord.volumeIdr, selectedDayRecord.volumeUsdt, false)}
                </span>
              </div>
              <div>
                <span className="text-[#686D7A] block text-[10px]">Total Fee Dibayar</span>
                <span className="text-sm font-bold text-[#EB3458]">
                  {formatVal(selectedDayRecord.feesIdr, selectedDayRecord.feesUsdt, false)}
                </span>
              </div>
            </div>

            {/* List of Executed Trades on this Date */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#F5F5F7] font-display">
                  Daftar Transaksi Eksekusi ({selectedDayRecord.trades.length} Transaksi)
                </span>
                <span className="text-[11px] font-mono text-[#00C087]">
                  {selectedDayRecord.winCount} Menang · {selectedDayRecord.lossCount} Rugi
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-[#292C38]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#0E1016] text-[#686D7A] text-[10px] border-b border-[#292C38] sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3">Waktu</th>
                      <th className="py-2.5 px-3">Pair</th>
                      <th className="py-2.5 px-3">Side</th>
                      <th className="py-2.5 px-3 text-right">Harga</th>
                      <th className="py-2.5 px-3 text-right">Jumlah</th>
                      <th className="py-2.5 px-3 text-right">Total Nilai</th>
                      <th className="py-2.5 px-3 text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#292C38]/40 bg-[#0E1016]/30">
                    {selectedDayRecord.trades.map(tx => {
                      const isBuy = tx.side === 'BUY';
                      const isUp = tx.pnlIdr >= 0;

                      return (
                        <tr key={tx.id} className="hover:bg-[#1C1F29]/60 transition-colors">
                          <td className="py-2.5 px-3 text-[#9298A6]">{tx.time}</td>
                          <td className="py-2.5 px-3 font-bold text-[#F5F5F7]">{tx.pairId}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isBuy ? 'bg-[#00C087]/15 text-[#00C087]' : 'bg-[#EB3458]/15 text-[#EB3458]'
                            }`}>
                              {tx.side}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#F5F5F7]">{tx.price}</td>
                          <td className="py-2.5 px-3 text-right text-[#F5F5F7]">{tx.quantity}</td>
                          <td className="py-2.5 px-3 text-right text-[#9298A6]">{tx.quoteVolume}</td>
                          <td className={`py-2.5 px-3 text-right font-bold ${isUp ? 'text-[#00C087]' : 'text-[#EB3458]'}`}>
                            {formatVal(tx.pnlIdr, tx.pnlUsdt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setSelectedDayRecord(null)}
              >
                Tutup
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
