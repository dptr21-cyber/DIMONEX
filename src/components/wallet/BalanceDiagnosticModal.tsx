/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * src/components/wallet/BalanceDiagnosticModal.tsx
 * Institutional Balance & Trading Engine Synchronization Diagnostic Tool.
 * Reconciles user ledger accounts, open orders on the matching engine,
 * active bot allocations, and audit trails.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Database,
  Cpu,
  Bot,
  Activity,
  ArrowRight,
  Wrench,
  Clock
} from 'lucide-react';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
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
        headers: { 'Authorization': `Bearer ${token}` }
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
          'Authorization': `Bearer ${token}`
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
        {/* Status Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#0E1016] border border-white/10">
          <div className="flex items-center gap-3">
            {data?.status === 'SYNCHRONIZED' ? (
              <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#F5F5F7]">Engine & Ledger State:</span>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                  data?.status === 'SYNCHRONIZED'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}>
                  {data?.status === 'SYNCHRONIZED' ? '100% IN SYNC' : `${data?.totalDriftCount} DRIFT DETECTED`}
                </span>
              </div>
              <span className="text-[10px] text-[#9298A6] font-mono">
                Last checked: {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString('id-ID') : '...'} · Nonce verified
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchDiagnostics}
              disabled={isLoading}
              className="p-2 rounded-lg bg-[#171923] border border-white/10 text-[#9298A6] hover:text-[#F5F5F7] transition-colors disabled:opacity-50"
              title="Refresh diagnostics"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Wrench className="w-3.5 h-3.5" />}
              isLoading={isReconciling}
              onClick={handleReconcile}
            >
              Auto-Reconcile
            </Button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[#0E1016] border border-white/10 text-xs">
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
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-md font-semibold transition-all ${
                  isActive
                    ? 'bg-[#1C1F29] text-[#F5F5F7] border border-white/10 shadow-sm'
                    : 'text-[#9298A6] hover:text-[#F5F5F7]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/5 border border-white/10">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab 1: Ledger vs Engine Balances Table */}
        {activeTab === 'BALANCES' && (
          <div className="rounded-xl bg-[#0E1016] border border-white/10 overflow-hidden">
            <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between text-xs">
              <span className="font-bold text-[#F5F5F7]">Double-Entry Ledger Reconciliation</span>
              <span className="text-[11px] text-[#9298A6] font-mono">
                Formula: Available + Locked = Total Ledger Balance
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#15171F] text-[#9298A6] text-[11px] border-b border-white/10">
                  <tr>
                    <th className="py-2.5 px-3 font-sans">Currency</th>
                    <th className="py-2.5 px-3 text-right">Available (Ledger)</th>
                    <th className="py-2.5 px-3 text-right">Locked (Ledger)</th>
                    <th className="py-2.5 px-3 text-right">Locked (OrderBook)</th>
                    <th className="py-2.5 px-3 text-right">Drift / Diff</th>
                    <th className="py-2.5 px-3 text-center font-sans">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data?.currencies.map(c => (
                    <tr key={c.currency} className="hover:bg-white/5">
                      <td className="py-2.5 px-3 font-sans font-bold text-[#F5F5F7] flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[#FF087F]" />
                        {c.currency}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-[#F5F5F7]">
                        {c.ledgerAvailable}
                      </td>
                      <td className="py-2.5 px-3 text-right text-amber-400">
                        {c.ledgerLocked}
                      </td>
                      <td className="py-2.5 px-3 text-right text-cyan-400">
                        {c.engineLocked}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-bold ${
                        c.isSynced ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {c.drift}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {c.isSynced ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded font-sans font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            SYNC
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded font-sans font-semibold">
                            <XCircle className="w-3 h-3" />
                            DRIFT
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Open Engine Orders */}
        {activeTab === 'ORDERS' && (
          <div className="rounded-xl bg-[#0E1016] border border-white/10 overflow-hidden">
            <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between text-xs">
              <span className="font-bold text-[#F5F5F7]">Matching Engine Live Locked Orders</span>
              <span className="text-[11px] text-[#9298A6] font-mono">
                {data?.openOrders.length || 0} active orders reserving funds
              </span>
            </div>

            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#15171F] text-[#9298A6] text-[11px] border-b border-white/10 sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-sans">Pair</th>
                    <th className="py-2 px-3">Side</th>
                    <th className="py-2 px-3 text-right">Price</th>
                    <th className="py-2 px-3 text-right">Quantity</th>
                    <th className="py-2 px-3 text-right">Locked Fund</th>
                    <th className="py-2 px-3 text-center">Order ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(!data?.openOrders || data.openOrders.length === 0) ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#9298A6] font-sans">
                        Tidak ada order terbuka di matching engine. Saldo terkunci = 0.
                      </td>
                    </tr>
                  ) : (
                    data.openOrders.map(o => (
                      <tr key={o.id} className="hover:bg-white/5">
                        <td className="py-2 px-3 font-sans font-semibold text-[#F5F5F7]">{o.pairId}</td>
                        <td className="py-2 px-3">
                          <span className={o.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {o.side}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-[#F5F5F7]">{o.price}</td>
                        <td className="py-2 px-3 text-right text-[#F5F5F7]">{o.quantity}</td>
                        <td className="py-2 px-3 text-right text-amber-400 font-bold">
                          {o.lockedAmount} {o.lockedCurrency}
                        </td>
                        <td className="py-2 px-3 text-center text-[10px] text-[#9298A6]">
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

        {/* Tab 3: Bot Allocations */}
        {activeTab === 'BOTS' && (
          <div className="rounded-xl bg-[#0E1016] border border-white/10 overflow-hidden">
            <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between text-xs">
              <span className="font-bold text-[#F5F5F7]">Active Trading Bot Allocations</span>
              <span className="text-[11px] text-[#9298A6] font-mono">
                {data?.activeBots.length || 0} bots registered in ledger
              </span>
            </div>

            <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
              {(!data?.activeBots || data.activeBots.length === 0) ? (
                <div className="py-6 text-center text-[#9298A6] text-xs">
                  Belum ada bot kuantitatif yang dideploy.
                </div>
              ) : (
                data.activeBots.map(b => (
                  <div key={b.id} className="p-3 rounded-lg bg-[#15171F] border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#F5F5F7]">{b.name}</span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded ${
                          b.status === 'RUNNING' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-[#9298A6]'
                        }`}>
                          {b.status}
                        </span>
                        <span className="text-[10px] text-[#FF087F] font-mono">{b.pairId}</span>
                      </div>
                      <div className="text-[10px] text-[#9298A6] mt-1 flex items-center gap-3 font-mono">
                        <span>Strategy: {b.strategy}</span>
                        <span>Orders: {b.activeOrdersCount}</span>
                        <span>Trades: {b.tradesCount}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-[#F5F5F7] block">
                        Rp {b.allocatedBalance}
                      </span>
                      <span className="text-[10px] text-emerald-400 font-mono">
                        PnL: {b.realizedPnl}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Audit Logs */}
        {activeTab === 'LOGS' && (
          <div className="rounded-xl bg-[#0E1016] border border-white/10 overflow-hidden">
            <div className="p-3 bg-white/5 border-b border-white/10 flex items-center justify-between text-xs">
              <span className="font-bold text-[#F5F5F7]">Immutable Audit Trail</span>
              <span className="text-[11px] text-[#9298A6] font-mono">Real-time ledger events</span>
            </div>

            <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto font-mono text-[11px]">
              {(!data?.recentAuditLogs || data.recentAuditLogs.length === 0) ? (
                <div className="py-6 text-center text-[#9298A6] font-sans">
                  Belum ada log audit untuk akun ini.
                </div>
              ) : (
                data.recentAuditLogs.map(log => (
                  <div key={log.id} className="p-2 rounded bg-[#15171F] border border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-[#9298A6]" />
                      <span className="text-[#9298A6]">{log.formattedTime}</span>
                      <span className="font-bold text-[#F5F5F7]">{log.action}</span>
                      <span className="text-[#FF087F]">{log.resource}</span>
                    </div>
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {log.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Info Explainer */}
        <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-[#9298A6] space-y-1">
          <p className="font-bold text-[#F5F5F7] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Zero-Mock Ledger Architecture Guarantee
          </p>
          <p className="text-[11px] leading-relaxed">
            DOMINEX tidak menggunakan saldo tiruan atau simulasi mock pada frontend. Setiap rupiah dan koin kripto dihitung langsung dari jurnal akuntansi atomik (Double-Entry Ledger) dan dicocokkan dengan order book engine. Tombol <em>Auto-Reconcile</em> dapat digunakan jika terdapat order yang gagal sinkron.
          </p>
        </div>
      </div>
    </Modal>
  );
};
