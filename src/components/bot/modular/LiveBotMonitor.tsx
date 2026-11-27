/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/bot/modular/LiveBotMonitor.tsx
 * Real-time Inspector & Control Panel for an individual MODULAR_STRATEGY_BOT instance.
 */

import React, { useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowUpRight,
  ListOrdered,
  Pause,
  Play,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { ModularBotInstance, TradingPairItem } from '../../../types/index.js';
import { formatDateTime, formatQuotePrice, formatUnitsToDecimal } from '../../../lib/formatters.js';
import { Button } from '../../ui/Button.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { SegmentedTabs } from '../../ui/Tabs.js';
import { Modal } from '../../ui/Modal.js';

interface Props {
  bot: ModularBotInstance;
  pairs: TradingPairItem[];
  onRefresh: () => void;
}

export const LiveBotMonitor: React.FC<Props> = ({ bot, pairs, onRefresh }) => {
  const [detailTab, setDetailTab] = useState<'SIGNALS' | 'ORDERS' | 'EXECUTIONS' | 'LOGS'>('SIGNALS');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [promoteAckChecked, setPromoteAckChecked] = useState(false);

  const pair = pairs.find(p => p.id === bot.pairId);
  const baseDec = pair?.baseDecimals ?? 8;
  const quoteDec = pair?.quoteDecimals ?? (bot.pairId.endsWith('-USDT') ? 6 : 2);
  const baseCur = pair?.baseCurrency || bot.pairId.split('-')[0] || 'BASE';
  const quoteCur = pair?.quoteCurrency || bot.pairId.split('-')[1] || 'IDR';

  const statusTone =
    bot.status === 'RUNNING'
      ? 'success'
      : bot.status === 'PAUSED'
        ? 'warning'
        : bot.status === 'ERROR' || bot.status === 'RISK_HALTED'
          ? 'danger'
          : 'neutral';

  const invokeAction = async (endpoint: string, method = 'POST', body?: any) => {
    setErrorMsg(null);
    setActionLoading(endpoint);
    try {
      const res = await fetch(`/api/modular-bots/${bot.id}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('dimonex_auth_token') || localStorage.getItem('dimonex_token') || ''}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Aksi gagal dieksekusi.');
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error eksekusi.');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePromoteToLive = async () => {
    if (!promoteAckChecked) return;
    await invokeAction('/promote-live', 'POST', {
      confirmLiveDeployment: true,
      acknowledgeRisk: true,
    });
    setIsPromoteModalOpen(false);
    setPromoteAckChecked(false);
  };

  const realizedPnlBig = BigInt(bot.metrics.realizedPnlQuoteUnits || '0');
  const unrealizedPnlBig = BigInt(bot.metrics.unrealizedPnlQuoteUnits || '0');
  const latestSignal = bot.recentSignals?.[0];

  return (
    <div className="bg-[#141C24] border border-[#202B34] rounded-[10px] p-4 space-y-4">
      {/* Header & Lifecycle Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#202B34]">
        <div>
          <div className="flex items-center flex-wrap gap-2">
            <h3 className="text-base font-semibold text-[#E4EBEF]">{bot.config.bot.name}</h3>
            <StatusBadge tone={statusTone} dot={bot.status === 'RUNNING'}>
              {bot.status}
            </StatusBadge>
            <StatusBadge tone={bot.config.bot.mode === 'LIVE' ? 'sell' : 'info'}>
              {bot.config.bot.mode}
            </StatusBadge>
          </div>
          <div className="text-xs font-mono text-[#71818B] mt-1">
            {bot.pairId} · {bot.config.bot.strategyId} · {bot.config.market.timeframe} · Regime {bot.metrics.lastRegime || 'NORMAL'}
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {bot.config.bot.mode === 'PAPER' && bot.status !== 'RUNNING' && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowUpRight className="w-3.5 h-3.5" />}
              onClick={() => setIsPromoteModalOpen(true)}
            >
              Promote ke LIVE
            </Button>
          )}

          {bot.status !== 'RUNNING' ? (
            <Button
              size="sm"
              variant="profit"
              isLoading={actionLoading === '/start' || actionLoading === '/resume'}
              icon={<Play className="w-3.5 h-3.5" />}
              onClick={() =>
                invokeAction(bot.status === 'PAUSED' ? '/resume' : '/start')
              }
            >
              {bot.status === 'PAUSED' ? 'Resume' : 'Jalankan'}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              isLoading={actionLoading === '/pause'}
              icon={<Pause className="w-3.5 h-3.5" />}
              onClick={() => invokeAction('/pause')}
            >
              Pause
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            isLoading={actionLoading === '/stop'}
            icon={<Square className="w-3.5 h-3.5" />}
            onClick={() => invokeAction('/stop', 'POST', { reason: 'Stopped via Dashboard' })}
          >
            Stop & Cancel
          </Button>

          <Button
            size="sm"
            variant="danger"
            isLoading={actionLoading === '/emergency-stop'}
            icon={<AlertOctagon className="w-3.5 h-3.5" />}
            onClick={() => invokeAction('/emergency-stop')}
          >
            Emergency Stop
          </Button>

          {bot.status !== 'RUNNING' && (
            <Button
              size="sm"
              variant="ghost"
              isLoading={actionLoading === ''}
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => invokeAction('', 'DELETE')}
            >
              Hapus
            </Button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-2.5 rounded-[7px] bg-[#401F27] border border-[#EA5B65]/40 text-xs text-[#EA5B65]">
          {errorMsg}
        </div>
      )}

      {bot.errorInfo && (
        <div className="p-2.5 rounded-[7px] bg-[#401F27]/70 border border-[#EA5B65]/40 text-xs text-[#EA5B65] flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{bot.errorInfo}</span>
        </div>
      )}

      {/* Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3">
          <div className="text-[10px] text-[#71818B] uppercase">Posisi & Entry</div>
          <div className="text-xs font-semibold font-mono text-[#E4EBEF] mt-1">
            {bot.position.side} · {formatUnitsToDecimal(bot.position.baseQtyUnits, baseDec, true)} {baseCur}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
            Avg: {formatQuotePrice(bot.position.avgEntryPriceUnits, quoteCur, quoteDec)}
          </div>
        </div>

        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3">
          <div className="text-[10px] text-[#71818B] uppercase">Realized PnL</div>
          <div
            className={`text-xs font-semibold font-mono tabular-nums mt-1 ${
              realizedPnlBig >= 0n ? 'text-[#16A879]' : 'text-[#EA5B65]'
            }`}
          >
            {formatQuotePrice(bot.metrics.realizedPnlQuoteUnits, quoteCur, quoteDec)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
            Fee: {formatQuotePrice(bot.metrics.totalFeesQuoteUnits, quoteCur, quoteDec)}
          </div>
        </div>

        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3">
          <div className="text-[10px] text-[#71818B] uppercase">Unrealized PnL</div>
          <div
            className={`text-xs font-semibold font-mono tabular-nums mt-1 ${
              unrealizedPnlBig >= 0n ? 'text-[#16A879]' : 'text-[#EA5B65]'
            }`}
          >
            {formatQuotePrice(bot.metrics.unrealizedPnlQuoteUnits, quoteCur, quoteDec)}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
            Max DD: {bot.metrics.maxDrawdownPct.toFixed(2)}%
          </div>
        </div>

        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3">
          <div className="text-[10px] text-[#71818B] uppercase">TP / SL Barriers</div>
          <div className="text-[11px] font-mono tabular-nums text-[#16A879] mt-1">
            TP: {bot.position.activeTakeProfitPriceUnits ? formatQuotePrice(bot.position.activeTakeProfitPriceUnits, quoteCur, quoteDec) : '—'}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#EA5B65] mt-0.5">
            SL: {bot.position.activeStopLossPriceUnits ? formatQuotePrice(bot.position.activeStopLossPriceUnits, quoteCur, quoteDec) : '—'}
          </div>
        </div>

        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3">
          <div className="text-[10px] text-[#71818B] uppercase">Order & Trades</div>
          <div className="text-xs font-semibold font-mono tabular-nums text-[#E4EBEF] mt-1">
            {bot.openOrders.length} Open / {bot.metrics.totalTrades} Fills
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B] mt-0.5">
            Sub {bot.metrics.ordersSubmitted} · Canc {bot.metrics.ordersCancelled}
          </div>
        </div>

        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3">
          <div className="text-[10px] text-[#71818B] uppercase">
            {bot.paperWallet ? 'Virtual Paper Wallet' : 'Daily Loss Used'}
          </div>
          {bot.paperWallet ? (
            <>
              <div className="text-[11px] font-mono tabular-nums text-[#E4EBEF] mt-1">
                {formatQuotePrice(bot.paperWallet.quoteAvailableUnits, quoteCur, quoteDec)}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[#A1AFB8] mt-0.5">
                {formatUnitsToDecimal(bot.paperWallet.baseAvailableUnits, baseDec, true)} {baseCur}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-semibold font-mono tabular-nums text-[#E4EBEF] mt-1">
                {formatQuotePrice(bot.metrics.dailyLossQuoteUnits, quoteCur, quoteDec)}
              </div>
              <div className="text-[11px] font-mono text-[#71818B] mt-0.5">
                Cap: {bot.config.risk.limits.maxDailyLoss} {quoteCur}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Latest Signal Banner */}
      {latestSignal && (
        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="w-4 h-4 text-[#8DA5B1] shrink-0" />
            <span className="font-mono font-semibold text-[#E4EBEF] shrink-0">
              [{latestSignal.signalType}]
            </span>
            <span className="text-[#A1AFB8] truncate">{latestSignal.strategyExplanation}</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-[#71818B] shrink-0">
            Conf {latestSignal.confidenceScore}% · {formatDateTime(latestSignal.signalTimestamp)}
          </div>
        </div>
      )}

      {/* Detail Tabs */}
      <SegmentedTabs
        size="sm"
        activeTab={detailTab}
        onChange={setDetailTab}
        tabs={[
          { id: 'SIGNALS', label: 'Strategy Signals', badge: bot.recentSignals.length, icon: <Activity className="w-3.5 h-3.5" /> },
          { id: 'ORDERS', label: 'Open Orders', badge: bot.openOrders.length, icon: <ListOrdered className="w-3.5 h-3.5" /> },
          { id: 'EXECUTIONS', label: 'Executions', badge: bot.executions.length },
          { id: 'LOGS', label: 'Engine Logs', badge: bot.logs.length, icon: <Terminal className="w-3.5 h-3.5" /> },
        ]}
      />

      {detailTab === 'SIGNALS' && (
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#71818B] border-b border-[#202B34]">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">Signal</th>
                <th className="py-2 pr-3">Conf</th>
                <th className="py-2 pr-3">Penjelasan & Indikator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {bot.recentSignals.slice(0, 20).map(sig => (
                <tr key={sig.signalId} className="hover:bg-[#17212B]">
                  <td className="py-2 pr-3 font-mono text-[11px] text-[#71818B] whitespace-nowrap">
                    {formatDateTime(sig.signalTimestamp)}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge
                      tone={
                        sig.signalType === 'BUY' || sig.signalType === 'LONG'
                          ? 'buy'
                          : sig.signalType === 'EXIT' || sig.signalType === 'SELL'
                            ? 'sell'
                            : 'neutral'
                      }
                    >
                      {sig.signalType}
                    </StatusBadge>
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums text-[#E4EBEF]">{sig.confidenceScore}%</td>
                  <td className="py-2 text-[#A1AFB8]">
                    <div>{sig.strategyExplanation}</div>
                    <div className="text-[10px] font-mono text-[#71818B] mt-0.5">
                      {Object.entries(sig.indicatorValues || {})
                        .slice(0, 6)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' · ')}
                    </div>
                  </td>
                </tr>
              ))}
              {bot.recentSignals.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[#71818B]">
                    Belum ada sinyal terekam. Jalankan bot untuk memulai evaluasi real-time.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailTab === 'ORDERS' && (
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#71818B] border-b border-[#202B34]">
                <th className="py-2 pr-3">Client Order ID</th>
                <th className="py-2 pr-3">Sisi / Tipe</th>
                <th className="py-2 pr-3 text-right">Harga</th>
                <th className="py-2 pr-3 text-right">Qty / Terisi</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
              {bot.openOrders.map(oo => (
                <tr key={oo.orderId} className="hover:bg-[#17212B]">
                  <td className="py-2 pr-3 text-[#A1AFB8]">{oo.clientOrderId}</td>
                  <td className={`py-2 pr-3 ${oo.side === 'BUY' ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                    {oo.side} · {oo.orderType} ({oo.timeInForce})
                  </td>
                  <td className="py-2 pr-3 text-right text-[#E4EBEF]">
                    {formatQuotePrice(oo.priceUnits, quoteCur, quoteDec)}
                  </td>
                  <td className="py-2 pr-3 text-right text-[#E4EBEF]">
                    {formatUnitsToDecimal(oo.filledQuantityUnits, baseDec, true)} / {formatUnitsToDecimal(oo.quantityUnits, baseDec, true)}
                  </td>
                  <td className="py-2 text-right text-[#8DA5B1]">{oo.status}</td>
                </tr>
              ))}
              {bot.openOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#71818B]">
                    Tidak ada order aktif milik bot ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailTab === 'EXECUTIONS' && (
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#71818B] border-b border-[#202B34]">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">Sisi</th>
                <th className="py-2 pr-3 text-right">Harga</th>
                <th className="py-2 pr-3 text-right">Jumlah</th>
                <th className="py-2 pr-3 text-right">Fee</th>
                <th className="py-2 text-right">Realized PnL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34] font-mono tabular-nums">
              {bot.executions.slice().reverse().map(ex => {
                const p = BigInt(ex.realizedPnlQuoteUnits || '0');
                return (
                  <tr key={ex.executionId} className="hover:bg-[#17212B]">
                    <td className="py-2 pr-3 text-[#71818B]">{formatDateTime(ex.timestamp)}</td>
                    <td className={`py-2 pr-3 font-semibold ${ex.side === 'BUY' ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                      {ex.side} ({ex.orderType})
                    </td>
                    <td className="py-2 pr-3 text-right text-[#E4EBEF]">
                      {formatQuotePrice(ex.priceUnits, quoteCur, quoteDec)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[#E4EBEF]">
                      {formatUnitsToDecimal(ex.quantityUnits, baseDec, true)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[#71818B]">
                      {formatQuotePrice(ex.feeUnits, quoteCur, quoteDec)}
                    </td>
                    <td className={`py-2 text-right ${p >= 0n ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                      {formatQuotePrice(ex.realizedPnlQuoteUnits, quoteCur, quoteDec)}
                    </td>
                  </tr>
                );
              })}
              {bot.executions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[#71818B]">
                    Belum ada eksekusi fill tercatat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detailTab === 'LOGS' && (
        <div className="bg-[#111820] border border-[#202B34] rounded-[8px] p-3 max-h-64 overflow-y-auto space-y-1.5 font-mono text-[11px]">
          {bot.logs.slice().reverse().map((l, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-[#71818B] shrink-0">{new Date(l.timestamp).toLocaleTimeString('id-ID')}</span>
              <span
                className={`shrink-0 font-semibold ${
                  l.type === 'ERROR' || l.type === 'RISK'
                    ? 'text-[#EA5B65]'
                    : l.type === 'FILL'
                      ? 'text-[#16A879]'
                      : 'text-[#8DA5B1]'
                }`}
              >
                [{l.type}]
              </span>
              <span className="text-[#E4EBEF]">{l.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Explicit Paper -> Live Confirmation Modal */}
      <Modal
        isOpen={isPromoteModalOpen}
        onClose={() => setIsPromoteModalOpen(false)}
        title="Konfirmasi Promosi PAPER → LIVE"
        subtitle="Tindakan ini menghubungkan strategi ke MatchingEngine dan Ledger riil."
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 rounded-[8px] bg-[#401F27]/60 border border-[#EA5B65]/40 text-[#E4EBEF] space-y-1">
            <div className="font-semibold text-[#EA5B65]">Peringatan Risiko Dana Riil</div>
            <p className="text-[#A1AFB8]">
              Saldo virtual Paper akan dihapus, dan bot akan dikonfigurasi ke mode LIVE pada pair <strong className="font-mono text-[#E4EBEF]">{bot.pairId}</strong> menggunakan saldo tersedia akun Anda.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[#E4EBEF] cursor-pointer">
            <input
              type="checkbox"
              checked={promoteAckChecked}
              onChange={e => setPromoteAckChecked(e.target.checked)}
              className="accent-[#EA5B65]"
            />
            <span>Saya menyetujui promosi ke LIVE dan batas risiko yang telah diatur.</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={() => setIsPromoteModalOpen(false)}>
              Batal
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!promoteAckChecked}
              isLoading={actionLoading === '/promote-live'}
              onClick={handlePromoteToLive}
            >
              Konfirmasi & Aktifkan Mode LIVE
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
