/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * src/components/admin/rewards/VipRewardsAdminSection.tsx
 * DIMONEX Admin Console — Institutional VIP & Trader Rewards Management
 * Manages Dynamic Task Center, Redeemable Vouchers, and Global Rewards Settlement Ledger.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Gift,
  Ticket,
  History,
  Plus,
  Edit3,
  Trash2,
  RefreshCw,
  Copy,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { Button } from '../../ui/Button.js';
import { Modal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { safeFetchJson } from '../../../lib/safeFetch.js';

interface Props {
  mode: 'TASKS' | 'VOUCHERS' | 'CLAIMS';
}

type TaskCategory = 'SECURITY' | 'FUNDING' | 'TRADING' | 'COMPLIANCE' | 'VIP';
type TaskRuleType =
  | 'ENABLE_2FA'
  | 'DEPOSIT_USDT'
  | 'SPOT_TRADES_COUNT'
  | 'SPOT_VOLUME_USDT'
  | 'FUTURES_VOLUME_USDT'
  | 'COMBINED_VOLUME_30D_USDT'
  | 'KYC_APPROVED';
type TaskActionView = 'SECURITY' | 'DEPOSIT' | 'TRADE' | 'FUTURES' | 'KYC';
type VoucherType = 'USDT_BONUS' | 'FEE_REBATE' | 'TRADING_CREDIT';

interface AdminOverview {
  tasks: {
    total: number;
    active: number;
    paused: number;
    totalClaims: number;
    totalDistributedUsdt: number;
  };
  vouchers: {
    total: number;
    active: number;
    totalRedemptions: number;
    totalDistributedUsdt: number;
  };
  referrals: {
    totalRelations: number;
    totalPayouts: number;
    totalDistributedUsdt: number;
  };
  totals: {
    totalSettlements: number;
    totalDistributedUsdt: number;
  };
}

interface AdminTaskItem {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  ruleType: TaskRuleType;
  targetValue: number;
  rewardCurrency: 'USDT';
  rewardAmountUsdt: number;
  rewardDisplay: string;
  actionLabel: string;
  actionView: TaskActionView;
  isActive: boolean;
  sortOrder: number;
  claimCount: number;
  totalDistributedUsdt: number;
  createdAt: number;
  updatedAt: number;
}

interface AdminVoucherItem {
  id: string;
  code: string;
  title: string;
  description: string;
  voucherType: VoucherType;
  rewardCurrency: 'USDT';
  rewardAmountUsdt: number;
  rewardDisplay: string;
  minVipLevel: number;
  maxRedemptions: number;
  redeemedCount: number;
  remainingSlots: number;
  isActive: boolean;
  expiresAt?: number;
  isExpired: boolean;
  isExhausted: boolean;
  totalDistributedUsdt: number;
  createdAt: number;
  updatedAt: number;
}

interface AdminHistoryItem {
  id: string;
  userId: string;
  userEmail?: string;
  type: 'TASK_REWARD' | 'VOUCHER_REDEMPTION' | 'REFERRAL_COMMISSION';
  title: string;
  code: string | null;
  currency: string;
  amountUsdt: number;
  amountDisplay: string;
  status: 'SETTLED';
  journalId: string;
  claimedAt: number;
}

const RULE_LABELS: Record<TaskRuleType, { label: string; unit: string; binary?: boolean }> = {
  ENABLE_2FA: { label: 'Enable Authenticator 2FA', unit: 'boolean', binary: true },
  KYC_APPROVED: { label: 'Approved KYC Verification', unit: 'boolean', binary: true },
  DEPOSIT_USDT: { label: 'Verified Deposits (USDT Equiv.)', unit: 'USDT' },
  SPOT_TRADES_COUNT: { label: 'Executed Spot Trades Count', unit: 'trades' },
  SPOT_VOLUME_USDT: { label: 'Cumulative Spot Volume (USDT)', unit: 'USDT' },
  FUTURES_VOLUME_USDT: { label: 'Cumulative Futures Volume (USDT)', unit: 'USDT' },
  COMBINED_VOLUME_30D_USDT: { label: '30D Combined Spot + Futures Volume', unit: 'USDT' }
};

const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  USDT_BONUS: 'USDT Cash Bonus',
  FEE_REBATE: 'Fee Rebate Credit',
  TRADING_CREDIT: 'Trading Credit'
};

const VIP_LABELS = ['Regular (V0+)', 'VIP 1+', 'VIP 2+', 'VIP 3+', 'VIP 4+', 'VIP 5+', 'Institutional (V6)'];

function formatUsd(val: number, decimals = 2): string {
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toDatetimeLocalValue(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function generateVoucherCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `DMX-${suffix}`;
}

export const VipRewardsAdminSection: React.FC<Props> = ({ mode }) => {
  const { showToast } = useToast();

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [vouchers, setVouchers] = useState<AdminVoucherItem[]>([]);
  const [historyItems, setHistoryItems] = useState<AdminHistoryItem[]>([]);
  const [historyPagination, setHistoryPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [historyTotalUsdt, setHistoryTotalUsdt] = useState(0);
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'ALL' | 'TASK_REWARD' | 'VOUCHER_REDEMPTION' | 'REFERRAL_COMMISSION'>('ALL');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Task Modal State
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<AdminTaskItem | null>(null);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [taskForm, setTaskForm] = useState({
    id: '',
    title: '',
    description: '',
    category: 'TRADING' as TaskCategory,
    ruleType: 'SPOT_VOLUME_USDT' as TaskRuleType,
    targetValue: '1000',
    rewardAmountUsdt: '25',
    actionLabel: 'Trade Spot',
    actionView: 'TRADE' as TaskActionView,
    sortOrder: '70',
    isActive: true
  });

  // Voucher Modal State
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [editingVoucher, setEditingVoucher] = useState<AdminVoucherItem | null>(null);
  const [isSavingVoucher, setIsSavingVoucher] = useState(false);
  const [voucherForm, setVoucherForm] = useState({
    code: '',
    title: '',
    description: '',
    voucherType: 'USDT_BONUS' as VoucherType,
    rewardAmountUsdt: '20',
    minVipLevel: '0',
    maxRedemptions: '100',
    expiresAtLocal: '',
    isActive: true
  });

  // Delete / Archive confirmation modal
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: 'TASK' | 'VOUCHER';
    id: string;
    label: string;
    hasUsage: boolean;
  } | null>(null);

  const authHeaders = () => {
    const token = localStorage.getItem('dimonex_auth_token') || '';
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    };
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    const headers = authHeaders();
    try {
      const ovRes = await safeFetchJson<AdminOverview>('/api/admin/rewards/overview', { headers });
      if (ovRes.ok && ovRes.data) {
        setOverview(ovRes.data);
      } else {
        setErrorMsg(ovRes.error || 'Failed to load VIP & Rewards admin overview.');
      }

      if (mode === 'TASKS') {
        const tRes = await safeFetchJson<{ tasks: AdminTaskItem[] }>('/api/admin/rewards/tasks', { headers });
        if (tRes.ok && tRes.data) setTasks(tRes.data.tasks);
        else setErrorMsg(tRes.error || 'Failed to load tasks.');
      } else if (mode === 'VOUCHERS') {
        const vRes = await safeFetchJson<{ vouchers: AdminVoucherItem[] }>('/api/admin/rewards/vouchers', { headers });
        if (vRes.ok && vRes.data) setVouchers(vRes.data.vouchers);
        else setErrorMsg(vRes.error || 'Failed to load vouchers.');
      } else if (mode === 'CLAIMS') {
        const params = new URLSearchParams({
          type: historyTypeFilter,
          page: String(historyPage),
          limit: '20'
        });
        if (historySearch.trim()) params.set('search', historySearch.trim());
        const hRes = await safeFetchJson<{
          items: AdminHistoryItem[];
          summary: { totalRecords: number; totalFilteredUsdt: number };
          pagination: { page: number; limit: number; total: number; totalPages: number };
        }>(`/api/admin/rewards/history?${params.toString()}`, { headers });
        if (hRes.ok && hRes.data) {
          setHistoryItems(hRes.data.items);
          setHistoryPagination(hRes.data.pagination);
          setHistoryTotalUsdt(hRes.data.summary.totalFilteredUsdt);
        } else {
          setErrorMsg(hRes.error || 'Failed to load rewards payout ledger.');
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [mode, historyTypeFilter, historyPage, historySearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ============================================================================
  // TASK HANDLERS
  // ============================================================================

  const openCreateTask = () => {
    setEditingTask(null);
    setTaskForm({
      id: '',
      title: '',
      description: '',
      category: 'TRADING',
      ruleType: 'SPOT_VOLUME_USDT',
      targetValue: '1000',
      rewardAmountUsdt: '25',
      actionLabel: 'Trade Spot',
      actionView: 'TRADE',
      sortOrder: String((tasks.length + 1) * 10),
      isActive: true
    });
    setShowTaskModal(true);
  };

  const openEditTask = (t: AdminTaskItem) => {
    setEditingTask(t);
    setTaskForm({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      ruleType: t.ruleType,
      targetValue: String(t.targetValue),
      rewardAmountUsdt: String(t.rewardAmountUsdt),
      actionLabel: t.actionLabel,
      actionView: t.actionView,
      sortOrder: String(t.sortOrder),
      isActive: t.isActive
    });
    setShowTaskModal(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTask(true);
    try {
      const payload = {
        ...(editingTask ? {} : { id: taskForm.id.trim() || undefined }),
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        category: taskForm.category,
        ruleType: taskForm.ruleType,
        targetValue: RULE_LABELS[taskForm.ruleType].binary ? 1 : Number(taskForm.targetValue),
        rewardAmountUsdt: Number(taskForm.rewardAmountUsdt),
        actionLabel: taskForm.actionLabel.trim() || 'Complete Task',
        actionView: taskForm.actionView,
        sortOrder: Number(taskForm.sortOrder) || 10,
        isActive: taskForm.isActive
      };

      const url = editingTask
        ? `/api/admin/rewards/tasks/${encodeURIComponent(editingTask.id)}`
        : '/api/admin/rewards/tasks';
      const method = editingTask ? 'PATCH' : 'POST';

      const res = await safeFetchJson<{ success: boolean }>(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast(
          'success',
          editingTask ? 'Task Updated' : 'Task Created',
          `Reward task "${payload.title}" saved and synced to Task Center.`
        );
        setShowTaskModal(false);
        await loadData();
      } else {
        showToast('error', 'Save Failed', res.error || 'Could not save reward task.');
      }
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleToggleTaskActive = async (task: AdminTaskItem) => {
    setBusyId(task.id);
    try {
      const res = await safeFetchJson(`/api/admin/rewards/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ isActive: !task.isActive })
      });
      if (res.ok) {
        showToast(
          'success',
          task.isActive ? 'Task Paused' : 'Task Activated',
          `"${task.title}" is now ${task.isActive ? 'paused' : 'live for eligible traders'}.`
        );
        await loadData();
      } else {
        showToast('error', 'Update Failed', res.error || 'Failed to update task status.');
      }
    } finally {
      setBusyId(null);
    }
  };

  // ============================================================================
  // VOUCHER HANDLERS
  // ============================================================================

  const openCreateVoucher = () => {
    setEditingVoucher(null);
    setVoucherForm({
      code: generateVoucherCode(),
      title: '',
      description: '',
      voucherType: 'USDT_BONUS',
      rewardAmountUsdt: '25',
      minVipLevel: '0',
      maxRedemptions: '100',
      expiresAtLocal: '',
      isActive: true
    });
    setShowVoucherModal(true);
  };

  const openEditVoucher = (v: AdminVoucherItem) => {
    setEditingVoucher(v);
    setVoucherForm({
      code: v.code,
      title: v.title,
      description: v.description,
      voucherType: v.voucherType,
      rewardAmountUsdt: String(v.rewardAmountUsdt),
      minVipLevel: String(v.minVipLevel),
      maxRedemptions: String(v.maxRedemptions),
      expiresAtLocal: toDatetimeLocalValue(v.expiresAt),
      isActive: v.isActive
    });
    setShowVoucherModal(true);
  };

  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingVoucher(true);
    try {
      const expiresAt = voucherForm.expiresAtLocal
        ? new Date(voucherForm.expiresAtLocal).getTime()
        : null;

      const payload = {
        code: voucherForm.code.trim().toUpperCase(),
        title: voucherForm.title.trim(),
        description: voucherForm.description.trim(),
        voucherType: voucherForm.voucherType,
        rewardAmountUsdt: Number(voucherForm.rewardAmountUsdt),
        minVipLevel: Number(voucherForm.minVipLevel) || 0,
        maxRedemptions: Number(voucherForm.maxRedemptions),
        expiresAt,
        isActive: voucherForm.isActive
      };

      const url = editingVoucher
        ? `/api/admin/rewards/vouchers/${encodeURIComponent(editingVoucher.id)}`
        : '/api/admin/rewards/vouchers';
      const method = editingVoucher ? 'PATCH' : 'POST';

      const res = await safeFetchJson<{ success: boolean }>(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showToast(
          'success',
          editingVoucher ? 'Voucher Updated' : 'Voucher Created',
          `Voucher ${payload.code} (${formatUsd(payload.rewardAmountUsdt)} USDT) saved.`
        );
        setShowVoucherModal(false);
        await loadData();
      } else {
        showToast('error', 'Save Failed', res.error || 'Could not save voucher.');
      }
    } finally {
      setIsSavingVoucher(false);
    }
  };

  const handleToggleVoucherActive = async (voucher: AdminVoucherItem) => {
    setBusyId(voucher.id);
    try {
      const res = await safeFetchJson(`/api/admin/rewards/vouchers/${encodeURIComponent(voucher.id)}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ isActive: !voucher.isActive })
      });
      if (res.ok) {
        showToast(
          'success',
          voucher.isActive ? 'Voucher Revoked' : 'Voucher Activated',
          `Voucher ${voucher.code} is now ${voucher.isActive ? 'inactive' : 'active'}.`
        );
        await loadData();
      } else {
        showToast('error', 'Update Failed', res.error || 'Failed to update voucher status.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmTarget) return;
    setBusyId(confirmTarget.id);
    try {
      const endpoint =
        confirmTarget.kind === 'TASK'
          ? `/api/admin/rewards/tasks/${encodeURIComponent(confirmTarget.id)}`
          : `/api/admin/rewards/vouchers/${encodeURIComponent(confirmTarget.id)}`;
      const res = await safeFetchJson<{ deleted: boolean; archived: boolean }>(endpoint, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.ok && res.data) {
        showToast(
          'success',
          res.data.archived ? 'Deactivated (Audit Preserved)' : 'Deleted',
          res.data.archived
            ? `${confirmTarget.label} has historical payouts and was paused to preserve ledger audit records.`
            : `${confirmTarget.label} has been permanently removed.`
        );
        setConfirmTarget(null);
        await loadData();
      } else {
        showToast('error', 'Action Failed', res.error || 'Could not delete item.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('success', 'Copied', `Voucher code ${code} copied.`);
    } catch {
      showToast('error', 'Copy Failed', 'Clipboard permission denied.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Executive KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono tabular-nums">
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] font-sans text-[#71818B] block">Active Trader Tasks</span>
          <span className="text-lg font-semibold text-[#E4EBEF] mt-1 block">
            {overview ? overview.tasks.active : '—'}{' '}
            <span className="text-xs font-sans font-normal text-[#71818B]">
              / {overview ? overview.tasks.total : 0} total
            </span>
          </span>
          <span className="text-[11px] text-[#71818B] block mt-0.5">
            {overview ? `${overview.tasks.totalClaims} claims · ${formatUsd(overview.tasks.totalDistributedUsdt)}` : 'Loading...'}
          </span>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] font-sans text-[#71818B] block">Active Voucher Campaigns</span>
          <span className="text-lg font-semibold text-[#E4EBEF] mt-1 block">
            {overview ? overview.vouchers.active : '—'}{' '}
            <span className="text-xs font-sans font-normal text-[#71818B]">
              / {overview ? overview.vouchers.total : 0} total
            </span>
          </span>
          <span className="text-[11px] text-[#71818B] block mt-0.5">
            {overview ? `${overview.vouchers.totalRedemptions} redemptions · ${formatUsd(overview.vouchers.totalDistributedUsdt)}` : 'Loading...'}
          </span>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] font-sans text-[#71818B] block">Referral Payouts</span>
          <span className="text-lg font-semibold text-[#E4EBEF] mt-1 block">
            {overview ? overview.referrals.totalPayouts : '—'}
          </span>
          <span className="text-[11px] text-[#71818B] block mt-0.5">
            {overview ? `${overview.referrals.totalRelations} linked · ${formatUsd(overview.referrals.totalDistributedUsdt)}` : 'Loading...'}
          </span>
        </div>

        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] font-sans text-[#71818B] block">Total Treasury Distributed</span>
          <span className="text-lg font-semibold text-[#16A879] mt-1 block">
            {overview ? `${formatUsd(overview.totals.totalDistributedUsdt)} USDT` : '—'}
          </span>
          <span className="text-[11px] text-[#71818B] block mt-0.5">
            {overview ? `${overview.totals.totalSettlements} atomic ledger settlements` : 'Loading...'}
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[9px] bg-[#401F27]/35 border border-[#EA5B65]/40 px-4 py-3 flex items-center justify-between gap-3 text-xs text-[#F0757E]">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadData}>
            Retry
          </Button>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODE 1: TASK CENTER MANAGER                                         */}
      {/* =================================================================== */}
      {mode === 'TASKS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="p-4 border-b border-[#202B34] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Gift className="w-4 h-4 text-[#8DA5B1]" />
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF]">Trader Task Center Manager</h3>
                <p className="text-xs text-[#71818B]">
                  Configure server-verified trader milestones and USDT treasury payouts. Changes apply immediately to Rewards &amp; VIP.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={loadData} disabled={isLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={openCreateTask}
              >
                New Task
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                  <th className="py-3 px-4 font-sans font-medium">Task</th>
                  <th className="py-3 px-4 font-sans font-medium">Verification Rule</th>
                  <th className="py-3 px-4 font-sans font-medium text-right">Reward</th>
                  <th className="py-3 px-4 font-sans font-medium text-right">Claims / Paid</th>
                  <th className="py-3 px-4 font-sans font-medium">Status</th>
                  <th className="py-3 px-4 font-sans font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[#71818B] font-sans">
                      {isLoading ? 'Loading reward tasks...' : 'No tasks configured yet.'}
                    </td>
                  </tr>
                ) : (
                  tasks.map(t => {
                    const ruleMeta = RULE_LABELS[t.ruleType];
                    return (
                      <tr key={t.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="py-3 px-4 font-sans max-w-xs">
                          <div className="font-semibold text-[#E4EBEF]">{t.title}</div>
                          <div className="text-[11px] text-[#71818B] truncate">{t.description}</div>
                          <div className="text-[10px] font-mono text-[#53616A] mt-0.5">
                            {t.id} · {t.category}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-sans text-[#A1AFB8]">
                          <div className="text-[#E4EBEF]">{ruleMeta?.label || t.ruleType}</div>
                          <div className="text-[11px] font-mono text-[#71818B]">
                            {ruleMeta?.binary
                              ? 'Boolean verification'
                              : `Target ≥ ${t.targetValue.toLocaleString('en-US')} ${ruleMeta?.unit || ''}`}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-[#16A879] whitespace-nowrap">
                          +{t.rewardDisplay}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="text-[#E4EBEF]">{t.claimCount} claims</div>
                          <div className="text-[11px] text-[#71818B]">
                            {formatUsd(t.totalDistributedUsdt)} paid
                          </div>
                        </td>
                        <td className="py-3 px-4 font-sans whitespace-nowrap">
                          <span className={t.isActive ? 'text-[#16A879] font-medium' : 'text-[#D6A85C] font-medium'}>
                            {t.isActive ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyId === t.id}
                              onClick={() => handleToggleTaskActive(t)}
                              title={t.isActive ? 'Pause task' : 'Activate task'}
                              className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            >
                              {t.isActive ? (
                                <PauseCircle className="w-3.5 h-3.5 text-[#D6A85C]" />
                              ) : (
                                <PlayCircle className="w-3.5 h-3.5 text-[#16A879]" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditTask(t)}
                              title="Edit task"
                              className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmTarget({
                                  kind: 'TASK',
                                  id: t.id,
                                  label: t.title,
                                  hasUsage: t.claimCount > 0
                                })
                              }
                              title={t.claimCount > 0 ? 'Pause / Archive task' : 'Delete task'}
                              className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] hover:border-[#EA5B65] text-[#A1AFB8] hover:text-[#EA5B65] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
      )}

      {/* =================================================================== */}
      {/* MODE 2: VOUCHER CAMPAIGN MANAGER                                    */}
      {/* =================================================================== */}
      {mode === 'VOUCHERS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="p-4 border-b border-[#202B34] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Ticket className="w-4 h-4 text-[#8DA5B1]" />
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF]">Voucher Campaign Manager</h3>
                <p className="text-xs text-[#71818B]">
                  Issue VIP-gated USDT bonus &amp; fee rebate vouchers. Redeemed codes settle atomically from Treasury to Spot Wallet.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={loadData} disabled={isLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={openCreateVoucher}
              >
                Create Voucher
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                  <th className="py-3 px-4 font-sans font-medium">Voucher Code &amp; Campaign</th>
                  <th className="py-3 px-4 font-sans font-medium">Type &amp; VIP Gate</th>
                  <th className="py-3 px-4 font-sans font-medium text-right">Reward</th>
                  <th className="py-3 px-4 font-sans font-medium">Redemptions</th>
                  <th className="py-3 px-4 font-sans font-medium">Expiration</th>
                  <th className="py-3 px-4 font-sans font-medium">Status</th>
                  <th className="py-3 px-4 font-sans font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center font-sans space-y-2">
                      <Ticket className="w-6 h-6 text-[#53616A] mx-auto" />
                      <div className="text-sm font-medium text-[#A1AFB8]">No voucher campaigns created yet</div>
                      <div className="text-xs text-[#71818B]">
                        Click &ldquo;Create Voucher&rdquo; above to launch your first redeemable USDT voucher code.
                      </div>
                    </td>
                  </tr>
                ) : (
                  vouchers.map(v => {
                    const pct = v.maxRedemptions > 0 ? Math.min(100, (v.redeemedCount / v.maxRedemptions) * 100) : 0;
                    const statusLabel = !v.isActive
                      ? 'Revoked'
                      : v.isExpired
                      ? 'Expired'
                      : v.isExhausted
                      ? 'Exhausted'
                      : 'Active';
                    const statusClass =
                      statusLabel === 'Active'
                        ? 'text-[#16A879]'
                        : statusLabel === 'Exhausted'
                        ? 'text-[#8DA5B1]'
                        : 'text-[#D6A85C]';

                    return (
                      <tr key={v.id} className="hover:bg-[#17212B]/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[#E4EBEF] tracking-wide">{v.code}</span>
                            <button
                              type="button"
                              onClick={() => copyCode(v.code)}
                              className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
                              title="Copy voucher code"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="font-sans text-xs text-[#A1AFB8] mt-0.5">{v.title}</div>
                          {v.description && (
                            <div className="font-sans text-[11px] text-[#71818B] max-w-xs truncate">
                              {v.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-sans">
                          <div className="text-[#E4EBEF]">{VOUCHER_TYPE_LABELS[v.voucherType]}</div>
                          <div className="text-[11px] font-mono text-[#71818B]">
                            Min: {VIP_LABELS[v.minVipLevel] || `VIP ${v.minVipLevel}+`}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-[#16A879] whitespace-nowrap">
                          +{v.rewardDisplay}
                        </td>
                        <td className="py-3 px-4 min-w-[150px]">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-[#E4EBEF]">
                              {v.redeemedCount} / {v.maxRedemptions}
                            </span>
                            <span className="text-[#71818B]">{formatUsd(v.totalDistributedUsdt)}</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-[#111820] border border-[#202B34] overflow-hidden mt-1">
                            <div
                              className="h-full bg-[#8DA5B1]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[#A1AFB8] whitespace-nowrap">
                          {v.expiresAt ? formatDateTime(v.expiresAt) : 'No Expiry'}
                        </td>
                        <td className={`py-3 px-4 font-sans font-medium whitespace-nowrap ${statusClass}`}>
                          {statusLabel}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyId === v.id}
                              onClick={() => handleToggleVoucherActive(v)}
                              title={v.isActive ? 'Revoke voucher' : 'Activate voucher'}
                              className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            >
                              {v.isActive ? (
                                <PauseCircle className="w-3.5 h-3.5 text-[#D6A85C]" />
                              ) : (
                                <PlayCircle className="w-3.5 h-3.5 text-[#16A879]" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditVoucher(v)}
                              title="Edit voucher"
                              className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmTarget({
                                  kind: 'VOUCHER',
                                  id: v.id,
                                  label: v.code,
                                  hasUsage: v.redeemedCount > 0
                                })
                              }
                              title={v.redeemedCount > 0 ? 'Revoke voucher' : 'Delete voucher'}
                              className="p-1.5 rounded-[6px] bg-[#111820] border border-[#2B3944] hover:border-[#EA5B65] text-[#A1AFB8] hover:text-[#EA5B65] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
      )}

      {/* =================================================================== */}
      {/* MODE 3: GLOBAL REWARDS & PAYOUT LEDGER                              */}
      {/* =================================================================== */}
      {mode === 'CLAIMS' && (
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
          <div className="p-4 border-b border-[#202B34] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-[#8DA5B1]" />
              <div>
                <h3 className="text-sm font-semibold text-[#E4EBEF]">Global Rewards &amp; Payout Ledger</h3>
                <p className="text-xs text-[#71818B]">
                  Complete audit trail of all Task Rewards, Voucher Redemptions, and Referral Commissions settled from Treasury.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => {
                    setHistorySearch(e.target.value);
                    setHistoryPage(1);
                  }}
                  placeholder="Email, code, journal ID..."
                  className="pl-8 pr-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder-[#53616A] outline-none focus:border-[#8DA5B1] w-52"
                />
              </div>
              <select
                value={historyTypeFilter}
                onChange={e => {
                  setHistoryTypeFilter(e.target.value as any);
                  setHistoryPage(1);
                }}
                className="px-2.5 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                <option value="ALL">All Types</option>
                <option value="TASK_REWARD">Task Rewards</option>
                <option value="VOUCHER_REDEMPTION">Voucher Redemptions</option>
                <option value="REFERRAL_COMMISSION">Referral Commissions</option>
              </select>
              <Button variant="secondary" size="sm" onClick={loadData} disabled={isLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="px-4 py-2.5 bg-[#111820]/60 border-b border-[#202B34] flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-[#71818B]">
              Showing {historyItems.length} of {historyPagination.total} settled payouts
            </span>
            <span className="text-[#16A879] font-semibold">
              Filtered Total: {formatUsd(historyTotalUsdt, 4)} USDT
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="bg-[#111820] text-[#71818B] border-b border-[#202B34]">
                  <th className="py-2.5 px-4 font-sans font-medium">Timestamp</th>
                  <th className="py-2.5 px-4 font-sans font-medium">User</th>
                  <th className="py-2.5 px-4 font-sans font-medium">Type</th>
                  <th className="py-2.5 px-4 font-sans font-medium">Campaign / Code</th>
                  <th className="py-2.5 px-4 font-sans font-medium">Status</th>
                  <th className="py-2.5 px-4 font-sans font-medium text-right">Amount</th>
                  <th className="py-2.5 px-4 font-sans font-medium text-right">Journal ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#202B34]">
                {historyItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#71818B] font-sans">
                      {isLoading ? 'Loading settlement records...' : 'No matching reward settlements found.'}
                    </td>
                  </tr>
                ) : (
                  historyItems.map(row => (
                    <tr key={row.id} className="hover:bg-[#17212B]/60">
                      <td className="py-2.5 px-4 text-[#A1AFB8] whitespace-nowrap">
                        {formatDateTime(row.claimedAt)}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-[#E4EBEF] whitespace-nowrap">
                        {row.userEmail || row.userId.slice(0, 10)}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-[#8DA5B1] whitespace-nowrap">
                        {row.type === 'TASK_REWARD'
                          ? 'Task Reward'
                          : row.type === 'VOUCHER_REDEMPTION'
                          ? 'Voucher'
                          : 'Referral Rebate'}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-[#E4EBEF]">
                        <div>{row.title}</div>
                        {row.code && (
                          <div className="text-[10px] font-mono text-[#71818B]">{row.code}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-sans whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-[#16A879] font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-[#16A879] whitespace-nowrap">
                        {row.amountDisplay}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[#71818B] whitespace-nowrap">
                        {row.journalId.slice(0, 14)}…
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {historyPagination.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-[#202B34] flex items-center justify-between text-xs">
              <span className="text-[#71818B] font-mono">
                Page {historyPagination.page} of {historyPagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={historyPagination.page <= 1}
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={historyPagination.page >= historyPagination.totalPages}
                  onClick={() => setHistoryPage(p => Math.min(historyPagination.totalPages, p + 1))}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* MODAL: CREATE / EDIT REWARD TASK                                    */}
      {/* =================================================================== */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        title={editingTask ? `Edit Task: ${editingTask.id}` : 'Create New Trader Task'}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSaveTask} className="space-y-3.5 text-xs">
          {!editingTask && (
            <div>
              <label className="text-[#A1AFB8] block mb-1">Task ID (optional — auto-generated if blank)</label>
              <input
                type="text"
                value={taskForm.id}
                onChange={e => setTaskForm({ ...taskForm, id: e.target.value.toUpperCase() })}
                placeholder="e.g. SPOT_VOLUME_10K"
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] font-mono uppercase outline-none focus:border-[#8DA5B1]"
              />
            </div>
          )}

          <div>
            <label className="text-[#A1AFB8] block mb-1">Task Title</label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={100}
              value={taskForm.title}
              onChange={e => setTaskForm({ ...taskForm, title: e.target.value })}
              placeholder="e.g. Trade $10,000 on Spot Markets"
              className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Description</label>
            <textarea
              required
              minLength={5}
              maxLength={300}
              rows={2}
              value={taskForm.description}
              onChange={e => setTaskForm({ ...taskForm, description: e.target.value })}
              placeholder="Clear eligibility instructions shown to traders..."
              className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Category</label>
              <select
                value={taskForm.category}
                onChange={e => setTaskForm({ ...taskForm, category: e.target.value as TaskCategory })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                <option value="SECURITY">SECURITY</option>
                <option value="FUNDING">FUNDING</option>
                <option value="TRADING">TRADING</option>
                <option value="COMPLIANCE">COMPLIANCE</option>
                <option value="VIP">VIP</option>
              </select>
            </div>

            <div>
              <label className="text-[#A1AFB8] block mb-1">Verification Rule</label>
              <select
                value={taskForm.ruleType}
                onChange={e => setTaskForm({ ...taskForm, ruleType: e.target.value as TaskRuleType })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                {(Object.keys(RULE_LABELS) as TaskRuleType[]).map(rk => (
                  <option key={rk} value={rk}>
                    {RULE_LABELS[rk].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">
                Target Threshold ({RULE_LABELS[taskForm.ruleType].unit})
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                disabled={Boolean(RULE_LABELS[taskForm.ruleType].binary)}
                value={RULE_LABELS[taskForm.ruleType].binary ? '1' : taskForm.targetValue}
                onChange={e => setTaskForm({ ...taskForm, targetValue: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1] disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-[#A1AFB8] block mb-1">Reward Amount (USDT)</label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                max="100000"
                value={taskForm.rewardAmountUsdt}
                onChange={e => setTaskForm({ ...taskForm, rewardAmountUsdt: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#16A879] font-mono font-semibold outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Action CTA Label</label>
              <input
                type="text"
                value={taskForm.actionLabel}
                onChange={e => setTaskForm({ ...taskForm, actionLabel: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              />
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">CTA Destination</label>
              <select
                value={taskForm.actionView}
                onChange={e => setTaskForm({ ...taskForm, actionView: e.target.value as TaskActionView })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                <option value="TRADE">Spot Trade</option>
                <option value="FUTURES">Perpetual Futures</option>
                <option value="DEPOSIT">Wallet Deposit</option>
                <option value="SECURITY">Security / 2FA</option>
                <option value="KYC">KYC Verification</option>
              </select>
            </div>
            <div>
              <label className="text-[#A1AFB8] block mb-1">Sort Order</label>
              <input
                type="number"
                value={taskForm.sortOrder}
                onChange={e => setTaskForm({ ...taskForm, sortOrder: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-[#E4EBEF]">
            <input
              type="checkbox"
              checked={taskForm.isActive}
              onChange={e => setTaskForm({ ...taskForm, isActive: e.target.checked })}
              className="rounded border-[#2B3944] bg-[#111820]"
            />
            <span>Active immediately in public Trader Task Center</span>
          </label>

          <div className="pt-3 border-t border-[#202B34] flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowTaskModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSavingTask}>
              {editingTask ? 'Save Changes' : 'Create Task'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL: CREATE / EDIT VOUCHER                                        */}
      {/* =================================================================== */}
      <Modal
        isOpen={showVoucherModal}
        onClose={() => setShowVoucherModal(false)}
        title={editingVoucher ? `Edit Voucher: ${editingVoucher.code}` : 'Create Redeemable Voucher'}
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSaveVoucher} className="space-y-3.5 text-xs">
          <div>
            <label className="text-[#A1AFB8] block mb-1">Voucher Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                minLength={3}
                maxLength={32}
                value={voucherForm.code}
                onChange={e => setVoucherForm({ ...voucherForm, code: e.target.value.toUpperCase() })}
                placeholder="DMX-VIP2026"
                className="flex-1 px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] font-mono uppercase outline-none focus:border-[#8DA5B1]"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Sparkles className="w-3.5 h-3.5" />}
                onClick={() => setVoucherForm({ ...voucherForm, code: generateVoucherCode() })}
              >
                Generate
              </Button>
            </div>
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Campaign Title</label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={100}
              value={voucherForm.title}
              onChange={e => setVoucherForm({ ...voucherForm, title: e.target.value })}
              placeholder="e.g. Institutional Welcome Bonus"
              className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Description (optional)</label>
            <textarea
              rows={2}
              maxLength={300}
              value={voucherForm.description}
              onChange={e => setVoucherForm({ ...voucherForm, description: e.target.value })}
              placeholder="Campaign terms or eligibility notes..."
              className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Voucher Type</label>
              <select
                value={voucherForm.voucherType}
                onChange={e => setVoucherForm({ ...voucherForm, voucherType: e.target.value as VoucherType })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                <option value="USDT_BONUS">USDT Cash Bonus</option>
                <option value="FEE_REBATE">Fee Rebate Credit</option>
                <option value="TRADING_CREDIT">Trading Credit</option>
              </select>
            </div>

            <div>
              <label className="text-[#A1AFB8] block mb-1">Reward Value (USDT)</label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                max="100000"
                value={voucherForm.rewardAmountUsdt}
                onChange={e => setVoucherForm({ ...voucherForm, rewardAmountUsdt: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#16A879] font-mono font-semibold outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[#A1AFB8] block mb-1">Minimum VIP Level</label>
              <select
                value={voucherForm.minVipLevel}
                onChange={e => setVoucherForm({ ...voucherForm, minVipLevel: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
              >
                {VIP_LABELS.map((lbl, idx) => (
                  <option key={idx} value={String(idx)}>
                    {lbl}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[#A1AFB8] block mb-1">Max Total Redemptions</label>
              <input
                type="number"
                required
                min={editingVoucher ? Math.max(1, editingVoucher.redeemedCount) : 1}
                max={1000000}
                value={voucherForm.maxRedemptions}
                onChange={e => setVoucherForm({ ...voucherForm, maxRedemptions: e.target.value })}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
              />
            </div>
          </div>

          <div>
            <label className="text-[#A1AFB8] block mb-1">Expiration Date &amp; Time (optional — leave blank for no expiry)</label>
            <input
              type="datetime-local"
              value={voucherForm.expiresAtLocal}
              onChange={e => setVoucherForm({ ...voucherForm, expiresAtLocal: e.target.value })}
              className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-[#E4EBEF] font-mono outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-[#E4EBEF]">
            <input
              type="checkbox"
              checked={voucherForm.isActive}
              onChange={e => setVoucherForm({ ...voucherForm, isActive: e.target.checked })}
              className="rounded border-[#2B3944] bg-[#111820]"
            />
            <span>Active and redeemable by eligible users</span>
          </label>

          <div className="pt-3 border-t border-[#202B34] flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowVoucherModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" isLoading={isSavingVoucher}>
              {editingVoucher ? 'Save Voucher' : 'Issue Voucher'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL: CONFIRM DELETE / ARCHIVE                                     */}
      {/* =================================================================== */}
      <Modal
        isOpen={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        title={confirmTarget?.hasUsage ? 'Deactivate Campaign (Audit Preserved)' : 'Confirm Permanent Deletion'}
        maxWidth="max-w-md"
      >
        {confirmTarget && (
          <div className="space-y-4 text-xs">
            <p className="text-[#A1AFB8] leading-relaxed">
              {confirmTarget.hasUsage
                ? `"${confirmTarget.label}" already has settled ledger payouts. To protect double-entry audit integrity, it will be paused/revoked rather than permanently deleted.`
                : `Permanently delete "${confirmTarget.label}"? This action cannot be undone.`}
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#202B34]">
              <Button variant="secondary" size="sm" onClick={() => setConfirmTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                isLoading={busyId === confirmTarget.id}
                onClick={handleConfirmDelete}
              >
                {confirmTarget.hasUsage ? 'Deactivate' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
