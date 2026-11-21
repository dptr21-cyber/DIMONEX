/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NotificationCenterSection.tsx
 * Admin Content Management — Global Notification Broadcast Center.
 * Monitors transactional outbox campaigns, delivery progress, read metrics,
 * retry failed deliveries, safe cancellation, and delivery audit trails.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  RefreshCw,
  RotateCcw,
  XCircle,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  Users,
  X,
} from 'lucide-react';
import {
  ANNOUNCEMENT_CATEGORY_META,
  CmsAuditLogItem,
  NotificationCampaignItem,
  NotificationDeliveryItem,
} from '../../../types/index.js';
import { safeFetchJson } from '../../../lib/safeFetch.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { useToast } from '../../ui/Toast.js';

function getCampaignTone(status: NotificationCampaignItem['status']) {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'PROCESSING':
    case 'QUEUED':
      return 'info';
    case 'PARTIALLY_FAILED':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getDeliveryTone(status: NotificationDeliveryItem['status']) {
  switch (status) {
    case 'SENT':
      return 'success';
    case 'QUEUED':
    case 'PROCESSING':
      return 'info';
    case 'FAILED':
      return 'danger';
    case 'CANCELLED':
    case 'SKIPPED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export const NotificationCenterSection: React.FC = () => {
  const { showToast } = useToast();
  const [campaigns, setCampaigns] = useState<NotificationCampaignItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<{
    campaign: NotificationCampaignItem;
    deliveries: NotificationDeliveryItem[];
    auditTrail: CmsAuditLogItem[];
  } | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '15' });
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);
      const res = await safeFetchJson<{
        items: NotificationCampaignItem[];
        pagination: { totalPages: number };
      }>(`/api/admin/notification-campaigns?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && res.data?.items) {
        setCampaigns(res.data.items);
        setTotalPages(res.data.pagination?.totalPages || 1);
      }
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, page]);

  const fetchCampaignDetail = useCallback(async (id: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsDetailLoading(true);
    try {
      const res = await safeFetchJson<{
        campaign: NotificationCampaignItem;
        deliveries: NotificationDeliveryItem[];
        auditTrail: CmsAuditLogItem[];
      }>(`/api/admin/notification-campaigns/${id}?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && res.data) {
        setDetailData(res.data);
      }
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    if (selectedCampaignId) {
      fetchCampaignDetail(selectedCampaignId);
    }
  }, [selectedCampaignId, fetchCampaignDetail]);

  const handleRetryFailed = async (campaignId: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<{ retriedCount: number }>(
      `/api/admin/notification-campaigns/${campaignId}/retry`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok) {
      showToast(
        'success',
        'Retry Queued',
        `Re-queued ${res.data?.retriedCount ?? 0} failed deliveries with idempotency protection.`
      );
      fetchCampaigns();
      if (selectedCampaignId === campaignId) fetchCampaignDetail(campaignId);
    } else {
      showToast('error', 'Retry Failed', res.error || 'Could not retry failed deliveries.');
    }
  };

  const handleCancelCampaign = async (campaignId: string) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<{ campaign: NotificationCampaignItem }>(
      `/api/admin/notification-campaigns/${campaignId}/cancel`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok) {
      showToast('info', 'Campaign Cancelled', 'Remaining unsent deliveries were safely cancelled.');
      fetchCampaigns();
      if (selectedCampaignId === campaignId) fetchCampaignDetail(campaignId);
    } else {
      showToast('error', 'Cancel Failed', res.error || 'Could not cancel campaign.');
    }
  };

  const totalSent = campaigns.reduce((a, c) => a + c.sentCount, 0);
  const totalFailed = campaigns.reduce((a, c) => a + c.failedCount, 0);
  const totalRead = campaigns.reduce((a, c) => a + c.readCount, 0);

  return (
    <div className="space-y-4">
      {/* KPI Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5 text-[#8DA5B1]" /> Total Campaigns
          </span>
          <div className="text-xl font-bold font-mono text-[#E4EBEF] mt-1">{campaigns.length}</div>
        </div>
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-[#16A879]" /> Total Sent
          </span>
          <div className="text-xl font-bold font-mono text-[#16A879] mt-1">{totalSent}</div>
        </div>
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#6D9FE8]" /> In-App Read
          </span>
          <div className="text-xl font-bold font-mono text-[#E4EBEF] mt-1">{totalRead}</div>
        </div>
        <div className="p-4 rounded-[10px] bg-[#141C24] border border-[#202B34]">
          <span className="text-[11px] text-[#71818B] flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#EA5B65]" /> Failed Deliveries
          </span>
          <div className="text-xl font-bold font-mono text-[#EA5B65] mt-1">{totalFailed}</div>
        </div>
      </div>

      {/* Filters & Controls */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {['ALL', 'QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED'].map(
            st => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setStatusFilter(st);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-[6px] text-xs font-mono transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-[#1D2832] text-[#E4EBEF] border border-[#2B3944] font-semibold'
                    : 'bg-[#111820] text-[#71818B] hover:text-[#E4EBEF] border border-[#202B34]'
                }`}
              >
                {st}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={fetchCampaigns}
          className="px-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] hover:border-[#40515D] text-xs text-[#E4EBEF] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {/* Campaigns Table */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#111820] border-b border-[#202B34] text-[11px] font-mono text-[#71818B] uppercase">
              <tr>
                <th className="px-4 py-3">Campaign &amp; Announcement</th>
                <th className="px-3 py-3">Channels / Target</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Eligible</th>
                <th className="px-3 py-3 text-right">Queued</th>
                <th className="px-3 py-3 text-right">Sent</th>
                <th className="px-3 py-3 text-right">Failed</th>
                <th className="px-3 py-3 text-right">Read</th>
                <th className="px-3 py-3">Timestamps</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[#71818B]">
                    Loading broadcast campaigns...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center space-y-1">
                    <p className="text-[#A1AFB8] font-medium">No notification broadcast campaigns yet</p>
                    <p className="text-[11px] text-[#71818B]">
                      Publish an announcement with &ldquo;Notify All Users&rdquo; enabled to create an atomic broadcast campaign.
                    </p>
                  </td>
                </tr>
              ) : (
                campaigns.map(c => {
                  const cat = ANNOUNCEMENT_CATEGORY_META[c.category];
                  return (
                    <tr key={c.id} className="hover:bg-[#17212B]/60 transition-colors">
                      <td className="px-4 py-3 max-w-[260px]">
                        <div className="font-semibold text-[#E4EBEF] truncate">{c.title}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <StatusBadge tone={cat?.tone || 'neutral'}>
                            {cat?.label || c.category}
                          </StatusBadge>
                          <span className="text-[10px] font-mono text-[#71818B] truncate">
                            {c.id.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px]">
                        <div className="flex flex-wrap gap-1">
                          {c.channels.map(ch => (
                            <span
                              key={ch}
                              className="px-1.5 py-0.5 rounded bg-[#111820] border border-[#2B3944] text-[10px] text-[#A5BAC4]"
                            >
                              {ch}
                            </span>
                          ))}
                        </div>
                        <div className="text-[10px] text-[#71818B] mt-1 flex items-center gap-1">
                          <Users className="w-3 h-3" /> {c.targetSegment}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge tone={getCampaignTone(c.status)}>{c.status}</StatusBadge>
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[#E4EBEF]">
                        {c.totalEligible}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[#6D9FE8]">
                        {c.queuedCount}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[#16A879]">
                        {c.sentCount}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[#EA5B65]">
                        {c.failedCount}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[#C1D0D6]">
                        {c.readCount}
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-[#71818B] whitespace-nowrap">
                        <div>Start: {c.startedAt ? new Date(c.startedAt).toLocaleTimeString() : '—'}</div>
                        <div>Done: {c.completedAt ? new Date(c.completedAt).toLocaleTimeString() : '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedCampaignId(c.id)}
                          className="px-2 py-1 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#E4EBEF] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          Details
                        </button>
                        {c.failedCount > 0 && c.status !== 'CANCELLED' && (
                          <button
                            type="button"
                            onClick={() => handleRetryFailed(c.id)}
                            className="px-2 py-1 rounded-[5px] bg-[#2C2415] border border-[#D6A85C]/40 text-[#D6A85C] hover:bg-[#3A2F1B] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Retry
                          </button>
                        )}
                        {(c.status === 'QUEUED' || c.status === 'PROCESSING') && (
                          <button
                            type="button"
                            onClick={() => handleCancelCampaign(c.id)}
                            className="px-2 py-1 rounded-[5px] bg-[#401F27] border border-[#EA5B65]/40 text-[#EA5B65] hover:bg-[#522630] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <XCircle className="w-3 h-3" />
                            Cancel
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

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-[#202B34] flex items-center justify-between text-xs">
            <span className="font-mono text-[#71818B]">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-[6px] bg-[#111820] border border-[#2B3944] disabled:opacity-40 text-[#E4EBEF] cursor-pointer"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-[6px] bg-[#111820] border border-[#2B3944] disabled:opacity-40 text-[#E4EBEF] cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Campaign Detail & Delivery Audit Modal */}
      {selectedCampaignId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[88vh] rounded-[10px] bg-[#141C24] border border-[#2B3944] shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#202B34] bg-[#111820] flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[#E4EBEF]">
                  Campaign Delivery Details &amp; Audit Trail
                </h4>
                <p className="text-[11px] font-mono text-[#71818B]">ID: {selectedCampaignId}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedCampaignId(null);
                  setDetailData(null);
                }}
                className="p-1.5 rounded-[6px] hover:bg-[#1D2832] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5">
              {isDetailLoading || !detailData ? (
                <div className="py-10 text-center text-xs text-[#71818B]">
                  Loading campaign telemetry...
                </div>
              ) : (
                <>
                  {/* Campaign Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                    <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">Eligible Users</span>
                      <span className="text-base font-bold font-mono text-[#E4EBEF]">
                        {detailData.campaign.totalEligible}
                      </span>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">Queued</span>
                      <span className="text-base font-bold font-mono text-[#6D9FE8]">
                        {detailData.campaign.queuedCount}
                      </span>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">Sent</span>
                      <span className="text-base font-bold font-mono text-[#16A879]">
                        {detailData.campaign.sentCount}
                      </span>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">Failed</span>
                      <span className="text-base font-bold font-mono text-[#EA5B65]">
                        {detailData.campaign.failedCount}
                      </span>
                    </div>
                    <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34]">
                      <span className="text-[10px] text-[#71818B] block">In-App Read</span>
                      <span className="text-base font-bold font-mono text-[#E4EBEF]">
                        {detailData.campaign.readCount}
                      </span>
                    </div>
                  </div>

                  {/* Recipient Delivery Records */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold text-[#E4EBEF]">
                      Per-Recipient Delivery Records ({detailData.deliveries.length})
                    </h5>
                    <div className="rounded-[8px] border border-[#202B34] overflow-x-auto max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-[11px] font-mono">
                        <thead className="bg-[#111820] border-b border-[#202B34] text-[#71818B] sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Recipient</th>
                            <th className="px-3 py-2">Channel</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Attempts</th>
                            <th className="px-3 py-2">Sent At</th>
                            <th className="px-3 py-2">Error</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#202B34]">
                          {detailData.deliveries.map(d => (
                            <tr key={d.id}>
                              <td className="px-3 py-2 text-[#E4EBEF]">{d.userEmail || d.userId}</td>
                              <td className="px-3 py-2 text-[#A5BAC4]">{d.channel}</td>
                              <td className="px-3 py-2">
                                <StatusBadge tone={getDeliveryTone(d.status)}>{d.status}</StatusBadge>
                              </td>
                              <td className="px-3 py-2 text-[#A1AFB8]">
                                {d.attempts}/{d.maxAttempts}
                              </td>
                              <td className="px-3 py-2 text-[#71818B]">
                                {d.sentAt ? new Date(d.sentAt).toLocaleTimeString() : '—'}
                              </td>
                              <td className="px-3 py-2 text-[#EA5B65] max-w-[180px] truncate">
                                {d.lastError || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Delivery Audit Trail */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#8DA5B1]" />
                      Append-Only Campaign Audit Trail
                    </h5>
                    <div className="space-y-1.5">
                      {detailData.auditTrail.map(log => (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-[7px] bg-[#111820] border border-[#202B34] text-[11px] flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-semibold text-[#E4EBEF]">
                              {log.action}
                            </span>
                            <span className="text-[#71818B] ml-2">
                              by {log.actorEmail || log.actorId} ({log.actorRole})
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-[#71818B]">
                            {new Date(log.createdAt).toLocaleString()} · sha256:{log.currentHash.slice(0, 10)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
