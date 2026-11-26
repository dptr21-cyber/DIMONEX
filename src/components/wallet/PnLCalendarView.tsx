/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/wallet/PnLCalendarView.tsx
 * Interactive PnL Calendar Heatmap & Daily Profit/Loss Inspector in Obsidian Iridium matte theme.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { formatIDR } from '../../lib/formatters.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';

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
  source?: 'SPOT' | 'FUTURES' | 'COPY';
}

export interface DayPnLRecord {
  date: string;
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
  finalized?: boolean;
}

function getJakartaCurrentYearMonth(): { year: number; month: number } {
  const jakartaIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const [yStr, mStr] = jakartaIso.split('-');
  return {
    year: parseInt(yStr, 10) || new Date().getFullYear(),
    month: (parseInt(mStr, 10) || new Date().getMonth() + 1) - 1,
  };
}

export const PnLCalendarView: React.FC<Props> = ({ hideBalance = false }) => {
  const [currency, setCurrency] = useState<'IDR' | 'USDT'>('IDR');
  const [isLoading, setIsLoading] = useState(false);
  const [calendarMap, setCalendarMap] = useState<Record<string, DayPnLRecord>>({});
  const [persistedDaysCount, setPersistedDaysCount] = useState<number>(0);
  const [selectedDayRecord, setSelectedDayRecord] = useState<DayPnLRecord | null>(null);

  const initialYm = useMemo(() => getJakartaCurrentYearMonth(), []);
  const [currentYear, setCurrentYear] = useState<number>(initialYm.year);
  const [currentMonth, setCurrentMonth] = useState<number>(initialYm.month);

  const monthNamesID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const dayNamesID = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

  const currentMonthKey = useMemo(() => {
    const mStr = String(currentMonth + 1).padStart(2, '0');
    return `${currentYear}-${mStr}`;
  }, [currentYear, currentMonth]);

  const fetchCalendarData = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsLoading(true);
      const res = await safeFetchJson<any>(
        `/api/wallet/pnl-analytics?currency=${currency}&month=${currentMonthKey}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        { retries: 1, retryDelayMs: 250 }
      );
      if (res.ok && res.data?.calendarData) {
        setCalendarMap(res.data.calendarData);
        if (typeof res.data.summary?.persistedDaysCount === 'number') {
          setPersistedDaysCount(res.data.summary.persistedDaysCount);
        } else {
          setPersistedDaysCount(Object.keys(res.data.calendarData).length);
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
    const ym = getJakartaCurrentYearMonth();
    setCurrentYear(ym.year);
    setCurrentMonth(ym.month);
  };

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

  const calendarGrid = useMemo(() => {
    const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayIndexSunday = new Date(currentYear, currentMonth, 1).getDay();
    const startOffset = (firstDayIndexSunday + 6) % 7;

    const days = [];

    for (let i = 0; i < startOffset; i++) {
      days.push({ isSpacer: true, dayNum: 0, dateKey: '', record: null as DayPnLRecord | null });
    }

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
    <div className="space-y-5">
      {/* Top Header: Month Navigation & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-[#111820] p-1 rounded-[7px] border border-[#202B34]">
            <button
              type="button"
              onClick={handlePrevMonth}
              title="Bulan Sebelumnya"
              className="p-1 rounded-[5px] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#1D2832] transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-2 font-semibold text-sm text-[#E4EBEF] min-w-[140px] text-center">
              {monthNamesID[currentMonth]} {currentYear}
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              title="Bulan Berikutnya"
              className="p-1 rounded-[5px] text-[#A1AFB8] hover:text-[#E4EBEF] hover:bg-[#1D2832] transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <Button variant="secondary" size="sm" onClick={handleJumpToday}>
            Hari Ini
          </Button>

          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono text-[#16A879]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {persistedDaysCount} Hari Tersimpan Permanen
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

          <Button variant="secondary" size="sm" onClick={fetchCalendarData} title="Segarkan kalender">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Monthly Performance Aggregates */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono tabular-nums">
          <div className="space-y-1">
            <span className="text-xs font-sans font-medium text-[#A1AFB8] block">Total PnL Bulan Ini</span>
            <div className={`text-xl font-semibold tracking-tight ${monthSummary.isProfit ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
              {formatVal(monthSummary.totalPnlIdr, monthSummary.totalPnlUsdt)}
            </div>
            <span className="text-[11px] text-[#71818B] block">
              {monthNamesID[currentMonth]} {currentYear}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-sans font-medium text-[#A1AFB8] block">Win Rate</span>
            <div className="text-xl font-semibold text-[#16A879] tracking-tight">{monthSummary.winRate}%</div>
            <div className="text-[11px]">
              <span className="text-[#16A879] font-semibold">{monthSummary.winDays} Hari Untung</span>
              <span className="text-[#40515D]"> · </span>
              <span className="text-[#EA5B65] font-semibold">{monthSummary.lossDays} Rugi</span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-sans font-medium text-[#A1AFB8] block">Aktivitas Transaksi</span>
            <div className="text-xl font-semibold text-[#E4EBEF] tracking-tight">{monthSummary.totalTrades} Order</div>
            <span className="text-[11px] text-[#71818B] block">
              Vol: {formatVal(monthSummary.totalVolumeIdr, monthSummary.totalVolumeUsdt, false)}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-sans font-medium text-[#A1AFB8] block">Hari Terbaik Bulan Ini</span>
            <div className="text-xl font-semibold text-[#16A879] tracking-tight">
              {monthSummary.bestDay != null ? formatVal(monthSummary.bestDay.pnlIdr, monthSummary.bestDay.pnlUsdt) : '-'}
            </div>
            <span className="text-[11px] text-[#71818B] block">
              {monthSummary.bestDay != null ? monthSummary.bestDay.date : 'Belum ada'}
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Calendar 7-Column Grid */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 lg:p-6">
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2 text-center text-xs font-semibold text-[#71818B] font-mono">
          {dayNamesID.map(day => (
            <div key={day} className="py-1">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {calendarGrid.map((cell, idx) => {
            if (cell.isSpacer) {
              return (
                <div
                  key={`spacer-${idx}`}
                  className="h-20 sm:h-24 rounded-[7px] bg-[#111820]/40 border border-transparent opacity-40 pointer-events-none"
                />
              );
            }

            const rec = cell.record;
            const hasActivity = rec && rec.tradesCount > 0;
            const isProfit = rec && rec.pnlIdr > 0;
            const isLoss = rec && rec.pnlIdr < 0;
            const isToday = cell.dateKey === todayDateKey;

            let bgClass = 'bg-[#111820] border-[#202B34] hover:border-[#40515D]';
            if (hasActivity) {
              if (isProfit) {
                bgClass = 'bg-[#12392F]/60 border-[#16A879]/35 hover:border-[#16A879] hover:bg-[#12392F]';
              } else if (isLoss) {
                bgClass = 'bg-[#401F27]/60 border-[#EA5B65]/35 hover:border-[#EA5B65] hover:bg-[#401F27]';
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
                className={`h-20 sm:h-24 p-1.5 sm:p-2 rounded-[8px] border flex flex-col justify-between text-left transition-colors ${bgClass} ${
                  hasActivity ? 'cursor-pointer' : 'cursor-default'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`text-xs font-semibold font-mono ${isToday ? 'text-[#C1D0D6]' : 'text-[#E4EBEF]'}`}>
                    {cell.dayNum}
                  </span>
                  {isToday && (
                    <span className="px-1.5 py-0.5 rounded-[4px] text-[8px] font-semibold bg-[#8DA5B1] text-[#090D12]">
                      TODAY
                    </span>
                  )}
                </div>

                {hasActivity ? (
                  <div className="space-y-0.5 my-auto w-full font-mono tabular-nums">
                    <div
                      className={`text-[11px] sm:text-xs font-semibold truncate ${
                        isProfit ? 'text-[#16A879]' : isLoss ? 'text-[#EA5B65]' : 'text-[#E4EBEF]'
                      }`}
                    >
                      {formatVal(rec.pnlIdr, rec.pnlUsdt)}
                    </div>
                    <div className="flex items-center justify-between text-[9px] sm:text-[10px] text-[#A1AFB8]">
                      <span className={rec.returnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}>
                        {rec.returnPct >= 0 ? '+' : ''}
                        {rec.returnPct}%
                      </span>
                      <span className="text-[#71818B] hidden sm:inline">{rec.tradesCount} tx</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-[#53616A] font-mono my-auto">-</div>
                )}

                {hasActivity && (
                  <div className="flex items-center gap-1 pt-1 border-t border-[#202B34] text-[9px] font-mono text-[#71818B]">
                    <span className="text-[#16A879] font-semibold">{rec.winCount}W</span>
                    <span>/</span>
                    <span className="text-[#EA5B65] font-semibold">{rec.lossCount}L</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-[#202B34] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[3px] bg-[#12392F] border border-[#16A879]" />
              <span className="text-[#A1AFB8]">Profit</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[3px] bg-[#401F27] border border-[#EA5B65]" />
              <span className="text-[#A1AFB8]">Loss</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-[3px] bg-[#111820] border border-[#202B34]" />
              <span className="text-[#71818B]">No Activity</span>
            </div>
          </div>

          <span className="text-[11px] font-sans text-[#71818B]">
            Klik tanggal untuk melihat daftar eksekusi order hari tersebut.
          </span>
        </div>
      </div>

      {selectedDayRecord && (
        <Modal
          isOpen={Boolean(selectedDayRecord)}
          onClose={() => setSelectedDayRecord(null)}
          title={`Detail Transaksi: ${selectedDayRecord.date}`}
          subtitle={`Catatan eksekusi riil ${selectedDayRecord.tradesCount} order pada hari tersebut.`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4">
            <div className="p-4 rounded-[10px] bg-[#111820] border border-[#202B34] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
              <div>
                <span className="text-[#71818B] font-sans block text-[10px]">Total PnL Bersih</span>
                <span className={`text-sm font-semibold ${selectedDayRecord.pnlIdr >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                  {formatVal(selectedDayRecord.pnlIdr, selectedDayRecord.pnlUsdt)}
                </span>
              </div>
              <div>
                <span className="text-[#71818B] font-sans block text-[10px]">Return Harian</span>
                <span className={`text-sm font-semibold ${selectedDayRecord.returnPct >= 0 ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                  {selectedDayRecord.returnPct >= 0 ? '+' : ''}
                  {selectedDayRecord.returnPct}%
                </span>
              </div>
              <div>
                <span className="text-[#71818B] font-sans block text-[10px]">Total Volume</span>
                <span className="text-sm font-semibold text-[#E4EBEF]">
                  {formatVal(selectedDayRecord.volumeIdr, selectedDayRecord.volumeUsdt, false)}
                </span>
              </div>
              <div>
                <span className="text-[#71818B] font-sans block text-[10px]">Total Fee Dibayar</span>
                <span className="text-sm font-semibold text-[#EA5B65]">
                  {formatVal(selectedDayRecord.feesIdr, selectedDayRecord.feesUsdt, false)}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#E4EBEF]">
                  Daftar Transaksi Eksekusi ({selectedDayRecord.trades.length} Transaksi)
                </span>
                <span className="text-[11px] font-mono text-[#16A879]">
                  {selectedDayRecord.winCount} Menang · {selectedDayRecord.lossCount} Rugi
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-[10px] border border-[#202B34]">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-[#111820] text-[#71818B] text-[10px] uppercase tracking-wider border-b border-[#202B34] sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-sans font-medium">Waktu</th>
                      <th className="py-2.5 px-3 font-sans font-medium">Pair</th>
                      <th className="py-2.5 px-3 font-sans font-medium">Side</th>
                      <th className="py-2.5 px-3 text-right font-sans font-medium">Harga</th>
                      <th className="py-2.5 px-3 text-right font-sans font-medium">Jumlah</th>
                      <th className="py-2.5 px-3 text-right font-sans font-medium">Total Nilai</th>
                      <th className="py-2.5 px-3 text-right font-sans font-medium">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#202B34] bg-[#141C24]">
                    {selectedDayRecord.trades.map(tx => {
                      const isBuy = tx.side === 'BUY';
                      const isUp = tx.pnlIdr >= 0;

                      return (
                        <tr key={tx.id} className="hover:bg-[#17212B] transition-colors">
                          <td className="py-2.5 px-3 text-[#A1AFB8]">{tx.time}</td>
                          <td className="py-2.5 px-3 font-semibold text-[#E4EBEF]">
                            <span>{tx.pairId}</span>
                            {tx.source && tx.source !== 'SPOT' && (
                              <span className="ml-1.5 text-[9px] font-mono text-[#8DA5B1]">{tx.source}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-sans">
                            <StatusBadge tone={isBuy ? 'buy' : 'sell'}>{tx.side}</StatusBadge>
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#E4EBEF]">{tx.price}</td>
                          <td className="py-2.5 px-3 text-right text-[#E4EBEF]">{tx.quantity}</td>
                          <td className="py-2.5 px-3 text-right text-[#A1AFB8]">{tx.quoteVolume}</td>
                          <td className={`py-2.5 px-3 text-right font-semibold ${isUp ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
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
              <Button variant="secondary" size="md" onClick={() => setSelectedDayRecord(null)}>
                Tutup
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
