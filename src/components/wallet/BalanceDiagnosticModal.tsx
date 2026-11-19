/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/wallet/BalanceDiagnosticModal.tsx
 * Balance & Trading Engine Synchronization Diagnostic Tool in Obsidian Iridium matte theme.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Database,
  Cpu,
  Bot,
  Activity,
  Wrench,
  Clock
} from 'lucide-react';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';

interface CurrencyDiagnostic {
  currency: string;
  ledgerAvailable: string;
  ledgerLocked: string;
  ledgerTotal: string;
  engineLocked: string;
  drift: string;
  isSynced: boolean;
}

interface OpenOrderDiagnostic {
  id: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  type: string;
  price: string;
  quantity: string;
  lockedAmount: string;
  lockedCurrency: string;
  status: string;
  createdAt: number;
}

interface ActiveBotDiagnostic {
  id: string;
  name: string;
  strategy: string;
  pairId: string;
  status: string;
  allocatedBalance: string;
  activeOrdersCount: number;
  tradesCount: number;
  realizedPnl: string;
}

interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  timestamp: number;
  formattedTime: string;
  status: string;
  details?: any;
}

interface DiagnosticData {
  timestamp: number;
  status: 'SYNCHRONIZED' | 'DRIFT_DETECTED';
  totalDriftCount: number;
  currencies: CurrencyDiagnostic[];
  openOrders: OpenOrderDiagnostic[];
  activeBots: ActiveBotDiagnostic[];
  recentAuditLogs: AuditLogEntry[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBalancesUpdated?: () => void;
}

export const BalanceDiagnosticModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onBalancesUpdated
}) => {
  const { showToast } = useToast();
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [activeTab, setActiveTab] = useState<'BALANCES' | 'ORDERS' | 'BOTS' | 'LOGS'>('BALANCES');

  const fetchDiagnostics = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsLoading(true);
      const res = await fetch('/api/wallet/diagnostics', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load diagnostics:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
    }
  }, [isOpen, fetchDiagnostics]);

  const handleReconcile = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;

    try {
      setIsReconciling(true);
      const res = await fetch('/api/wallet/diagnostics/reconcile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const result = await res.json();
      if (res.ok) {
        showToast('success', 'Rekonsiliasi Sukses', result.message);
        await fetchDiagnostics();
        if (onBalancesUpdated) onBalancesUpdated();
      } else {
        showToast('error', 'Rekonsiliasi Gagal', result.error || 'Terjadi kesalahan sistem');
      }
    } catch (err: any) {
      showToast('error', 'Error', err.message || 'Koneksi gagal');
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Balance & Trading Engine Synchronization Diagnostics"
      subtitle="Authoritative audit tool reconciling ledger accounts with the in-memory matching engine."
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-[10px] bg-[#111820] border border-[#202B34]">
          <div className="flex items-center gap-3">
            {data?.status === 'SYNCHRONIZED' ? (
              <div className="w-9 h-9 rounded-[7px] bg-[#12392F] border border-[#16A879]/30 flex items-center justify-center text-[#16A879]">
                <ShieldCheck className="w-5 h-5" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-[7px] bg-[#2C2415] border border-[#D6A85C]/30 flex items-center justify-center text-[#D6A85C]">
                <AlertTriangle className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#E4EBEF]">Engine &amp; Ledger State:</span>
                <StatusBadge tone={data?.status === 'SYNCHRONIZED' ? 'buy' : 'warning'}>
                  {data?.status === 'SYNCHRONIZED' ? '100% IN SYNC' : `${data?.totalDriftCount ?? 0} DRIFT DETECTED`}
                </StatusBadge>
              </div>
              <span className="text-[10px] text-[#71818B] font-mono">
                Last checked: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString('id-ID') : '...'} · Nonce verified
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={fetchDiagnostics} disabled={isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Wrench className="w-3.5 h-3.5" />}
              isLoading={isReconciling}
              onClick={handleReconcile}
            >
              Auto-Reconcile
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-1 rounded-[7px] bg-[#111820] border border-[#202B34] text-xs">
          {[
            { id: 'BALANCES', label: 'Ledger vs Engine', icon: Database, badge: data?.currencies.length },
            { id: 'ORDERS', label: 'Open Engine Orders', icon: Cpu, badge: data?.openOrders.length },
            { id: 'BOTS', label: 'Bot Allocations', icon: Bot, badge: data?.activeBots.length },
            { id: 'LOGS', label: 'Audit Trail', icon: Activity, badge: data?.recentAuditLogs.length },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-[5px] font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold border border-[#2B3944]'
                    : 'text-[#71818B] hover:text-[#E4EBEF] border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[5px] bg-[#141C24] border border-[#202B34]">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeTab === 'BALANCES' && (
          <div className="rounded-[10px] bg-[#111820] border border-[#202B34] overflow-hidden">
            <div className="p-3 bg-[#141C24] border-b border-[#202B34] flex items-center justify-between text-xs">
              <span className="font-semibold text-[#E4EBEF]">Double-Entry Ledger Reconciliation</span>
              <span className="text-[11px] text-[#71818B] font-mono">
                Available + Locked = Total Ledger Balance
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#141C24] text-[#71818B] text-[11px] border-b border-[#202B34]">
                  <tr>
                    <th className="py-2.5 px-3 font-sans font-medium">Currency</th>
                    <th className="py-2.5 px-3 text-right font-sans font-medium">Available (Ledger)</th>
                    <th className="py-2.5 px-3 text-right font-sans font-medium">Locked (Ledger)</th>
                    <th className="py-2.5 px-3 text-right font-sans font-medium">Locked (OrderBook)</th>
                    <th className="py-2.5 px-3 text-right font-sans font-medium">Drift / Diff</th>
                    <th className="py-2.5 px-3 text-center font-sans font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {data?.currencies.map(c => (
                    <tr key={c.currency} className="hover:bg-[#17212B]">
                      <td className="py-2.5 px-3 font-sans font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#8DA5B1]" />
                        {c.currency}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#E4EBEF]">{c.ledgerAvailable}</td>
                      <td className="py-2.5 px-3 text-right text-[#D6A85C]">{c.ledgerLocked}</td>
                      <td className="py-2.5 px-3 text-right text-[#6D9FE8]">{c.engineLocked}</td>
                      <td className={`py-2.5 px-3 text-right font-semibold ${c.isSynced ? 'text-[#16A879]' : 'text-[#EA5B65]'}`}>
                        {c.drift}
                      </td>
                      <td className="py-2.5 px-3 text-center font-sans">
                        <StatusBadge tone={c.isSynced ? 'buy' : 'danger'}>
                          {c.isSynced ? 'SYNC' : 'DRIFT'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'ORDERS' && (
          <div className="rounded-[10px] bg-[#111820] border border-[#202B34] overflow-hidden">
            <div className="p-3 bg-[#141C24] border-b border-[#202B34] flex items-center justify-between text-xs">
              <span className="font-semibold text-[#E4EBEF]">Matching Engine Live Locked Orders</span>
              <span className="text-[11px] text-[#71818B] font-mono">
                {data?.openOrders.length || 0} active orders reserving funds
              </span>
            </div>

            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="bg-[#141C24] text-[#71818B] text-[11px] border-b border-[#202B34] sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-sans font-medium">Pair</th>
                    <th className="py-2 px-3 font-sans font-medium">Side</th>
                    <th className="py-2 px-3 text-right font-sans font-medium">Price</th>
                    <th className="py-2 px-3 text-right font-sans font-medium">Quantity</th>
                    <th className="py-2 px-3 text-right font-sans font-medium">Locked Fund</th>
                    <th className="py-2 px-3 text-center font-sans font-medium">Order ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#202B34]">
                  {(!data?.openOrders || data.openOrders.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#71818B] font-sans">
                        Tidak ada order terbuka di matching engine. Saldo terkunci = 0.
                      </td>
                    </tr>
                  ) : (
                    data.openOrders.map(o => (
                      <tr key={o.id} className="hover:bg-[#17212B]">
                        <td className="py-2 px-3 font-sans font-semibold text-[#E4EBEF]">{o.pairId}</td>
                        <td className="py-2 px-3">
                          <span className={o.side === 'BUY' ? 'text-[#16A879] font-semibold' : 'text-[#EA5B65] font-semibold'}>
                            {o.side}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-[#E4EBEF]">{o.price}</td>
                        <td className="py-2 px-3 text-right text-[#E4EBEF]">{o.quantity}</td>
                        <td className="py-2 px-3 text-right text-[#D6A85C] font-semibold">
                          {o.lockedAmount} {o.lockedCurrency}
                        </td>
                        <td className="py-2 px-3 text-center text-[10px] text-[#71818B]">
                          {o.id.slice(0, 12)}...
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'BOTS' && (
          <div className="rounded-[10px] bg-[#111820] border border-[#202B34] overflow-hidden">
            <div className="p-3 bg-[#141C24] border-b border-[#202B34] flex items-center justify-between text-xs">
              <span className="font-semibold text-[#E4EBEF]">Active Trading Bot Allocations</span>
              <span className="text-[11px] text-[#71818B] font-mono">
                {data?.activeBots.length || 0} bots registered in ledger
              </span>
            </div>

            <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
              {(!data?.activeBots || data.activeBots.length === 0) ? (
                <div className="py-6 text-center text-[#71818B] text-xs">
                  Belum ada bot kuantitatif yang dideploy.
                </div>
              ) : (
                data.activeBots.map(b => (
                  <div key={b.id} className="p-3 rounded-[7px] bg-[#141C24] border border-[#202B34] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#E4EBEF]">{b.name}</span>
                        <StatusBadge tone={b.status === 'RUNNING' ? 'buy' : 'neutral'}>{b.status}</StatusBadge>
                        <span className="text-[10px] text-[#8DA5B1] font-mono">{b.pairId}</span>
                      </div>
                      <div className="text-[10px] text-[#71818B] mt-1 flex items-center gap-3 font-mono">
                        <span>Strategy: {b.strategy}</span>
                        <span>Orders: {b.activeOrdersCount}</span>
                        <span>Trades: {b.tradesCount}</span>
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <span className="text-xs font-semibold text-[#E4EBEF] block">
                        Rp {b.allocatedBalance}
                      </span>
                      <span className="text-[10px] text-[#16A879]">PnL: {b.realizedPnl}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'LOGS' && (
          <div className="rounded-[10px] bg-[#111820] border border-[#202B34] overflow-hidden">
            <div className="p-3 bg-[#141C24] border-b border-[#202B34] flex items-center justify-between text-xs">
              <span className="font-semibold text-[#E4EBEF]">Immutable Audit Trail</span>
              <span className="text-[11px] text-[#71818B] font-mono">Real-time ledger events</span>
            </div>

            <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto font-mono text-[11px]">
              {(!data?.recentAuditLogs || data.recentAuditLogs.length === 0) ? (
                <div className="py-6 text-center text-[#71818B] font-sans">
                  Belum ada log audit untuk akun ini.
                </div>
              ) : (
                data.recentAuditLogs.map(log => (
                  <div key={log.id} className="p-2 rounded-[7px] bg-[#141C24] border border-[#202B34] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-[#71818B]" />
                      <span className="text-[#71818B]">{log.formattedTime}</span>
                      <span className="font-semibold text-[#E4EBEF]">{log.action}</span>
                      <span className="text-[#8DA5B1]">{log.resource}</span>
                    </div>
                    <StatusBadge tone="buy">{log.status}</StatusBadge>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div className="p-3 rounded-[10px] bg-[#111820] border border-[#202B34] text-xs text-[#A1AFB8] space-y-1">
          <p className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#16A879]" />
            Zero-Mock Ledger Architecture Guarantee
          </p>
          <p className="text-[11px] leading-relaxed text-[#71818B]">
            DIMONEX tidak menggunakan saldo tiruan atau simulasi mock pada frontend. Setiap rupiah dan aset kripto dihitung langsung dari jurnal akuntansi atomik (Double-Entry Ledger) dan dicocokkan dengan order book engine.
          </p>
        </div>
      </div>
    </Modal>
  );
};
