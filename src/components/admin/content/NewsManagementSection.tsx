/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NewsManagementSection.tsx
 * Complete production News & Announcement CMS inside DIMONEX Admin Console.
 * Supports: Create, Edit, Save Draft, Rich Text Toolbar, Cover Image Upload /
 * Media Picker, Safe Preview, Maker-Checker Submit & Approve, Publish Immediately
 * with Global Notification Broadcast, Schedule/Reschedule, Pin/Unpin, Archive,
 * Search/Filter/Pagination, Publication Version History, and Audit Trail.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Eye,
  Send,
  Calendar,
  Archive,
  Pin,
  PinOff,
  ShieldCheck,
  History,
  Bell,
  Upload,
  Image as ImageIcon,
  Bold,
  Italic,
  Underline,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  CheckCircle2,
  X,
  RefreshCw,
} from 'lucide-react';
import {
  ANNOUNCEMENT_CATEGORY_META,
  AnnouncementCategory,
  AnnouncementItem,
  AnnouncementStatus,
  AnnouncementVersionItem,
  CmsAuditLogItem,
  NotificationChannel,
  NotificationTargetSegment,
  UserProfile,
} from '../../../types/index.js';
import { safeFetchJson } from '../../../lib/safeFetch.js';
import { StatusBadge } from '../../ui/StatusBadge.js';
import { SafeArticleContent } from '../../news/SafeArticleContent.js';
import { MediaLibrarySection } from './MediaLibrarySection.js';
import { useToast } from '../../ui/Toast.js';

interface NewsManagementSectionProps {
  user: UserProfile | null;
}

const ALL_CATEGORIES = Object.keys(ANNOUNCEMENT_CATEGORY_META) as AnnouncementCategory[];

function getStatusTone(status?: AnnouncementStatus) {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'SCHEDULED':
      return 'info';
    case 'PENDING_APPROVAL':
      return 'warning';
    case 'ARCHIVED':
      return 'danger';
    case 'DRAFT':
    default:
      return 'neutral';
  }
}

export const NewsManagementSection: React.FC<NewsManagementSectionProps> = ({ user }) => {
  const { showToast } = useToast();
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Editor state
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('ANNOUNCEMENT');
  const [shortDescription, setShortDescription] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [notifyAllUsers, setNotifyAllUsers] = useState(true);
  const [channels, setChannels] = useState<NotificationChannel[]>(['IN_APP']);
  const [targetSegment, setTargetSegment] = useState<NotificationTargetSegment>('ALL_USERS');
  const [editorTab, setEditorTab] = useState<'WRITE' | 'PREVIEW'>('WRITE');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  // Schedule modal state
  const [scheduleTarget, setScheduleTarget] = useState<AnnouncementItem | null>(null);
  const [scheduleDateTime, setScheduleDateTime] = useState('');

  // Preview / History / Audit modal
  const [previewArticle, setPreviewArticle] = useState<AnnouncementItem | null>(null);
  const [historyDetail, setHistoryDetail] = useState<{
    announcement: AnnouncementItem;
    versions: AnnouncementVersionItem[];
    auditLogs: CmsAuditLogItem[];
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '12',
      });
      if (search.trim()) qs.set('search', search.trim());
      if (categoryFilter !== 'ALL') qs.set('category', categoryFilter);
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);

      const res = await safeFetchJson<{
        items: AnnouncementItem[];
        pagination: { total: number; totalPages: number };
      }>(`/api/admin/news?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok && res.data?.items) {
        setItems(res.data.items);
        setTotal(res.data.pagination?.total || res.data.items.length);
        setTotalPages(res.data.pagination?.totalPages || 1);
      }
    } finally {
      setIsLoading(false);
    }
  }, [page, search, categoryFilter, statusFilter]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const openCreateEditor = () => {
    setEditingId(null);
    setTitle('');
    setSlug('');
    setCategory('ANNOUNCEMENT');
    setShortDescription('');
    setContentHtml('<p>Write your official DIMONEX announcement here...</p>');
    setCoverImageUrl('');
    setIsPinned(false);
    setRequiresApproval(false);
    setNotifyAllUsers(true);
    setChannels(['IN_APP']);
    setTargetSegment('ALL_USERS');
    setEditorTab('WRITE');
    setShowMediaPicker(false);
    setIsEditorOpen(true);
  };

  const openEditEditor = (item: AnnouncementItem) => {
    setEditingId(item.id);
    setTitle(item.title);
    setSlug(item.slug);
    setCategory(item.category);
    setShortDescription(item.shortDescription);
    setContentHtml(item.contentHtml || '');
    setCoverImageUrl(item.coverImageUrl || '');
    setIsPinned(Boolean(item.isPinned));
    setRequiresApproval(Boolean(item.requiresApproval));
    setNotifyAllUsers(Boolean(item.notificationEnabled));
    setChannels(item.notificationChannels?.length ? item.notificationChannels : ['IN_APP']);
    setTargetSegment(item.targetSegment || 'ALL_USERS');
    setEditorTab('WRITE');
    setShowMediaPicker(false);
    setIsEditorOpen(true);
  };

  const insertHtmlFormat = (prefix: string, suffix: string, placeholder: string) => {
    const el = textareaRef.current;
    if (!el) {
      setContentHtml(prev => `${prev}\n${prefix}${placeholder}${suffix}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = contentHtml.slice(start, end) || placeholder;
    const updated =
      contentHtml.slice(0, start) + prefix + selected + suffix + contentHtml.slice(end);
    setContentHtml(updated);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const handleToggleChannel = (ch: NotificationChannel) => {
    if (ch === 'IN_APP') return; // In-App is required when broadcasting
    setChannels(prev =>
      prev.includes(ch) ? prev.filter(x => x !== ch) : [...prev, ch]
    );
  };

  const handleUploadCoverDirect = async (file: File | null) => {
    if (!file) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      showToast('error', 'Unsupported File Type', 'Only PNG, JPEG, WebP, and GIF images are allowed.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'File Too Large', 'Maximum cover image size is 5 MB.');
      return;
    }
    setIsUploadingCover(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const res = await safeFetchJson<{ url: string }>('/api/admin/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          base64Data: dataUrl,
          altText: title || file.name,
        }),
      });
      if (res.ok && res.data?.url) {
        setCoverImageUrl(res.data.url);
        showToast('success', 'Cover Image Uploaded', 'Validated cover image attached.');
      } else {
        showToast('error', 'Cover Upload Rejected', res.error || 'Image validation failed.');
      }
    } finally {
      setIsUploadingCover(false);
    }
  };

  const handleSaveDraft = async (): Promise<AnnouncementItem | null> => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return null;
    if (title.trim().length < 3) {
      showToast('error', 'Validation Error', 'Title must be at least 3 characters.');
      return null;
    }

    setIsSaving(true);
    try {
      const payload = {
        title: title.trim(),
        slug: slug.trim() || undefined,
        category,
        shortDescription: shortDescription.trim(),
        contentHtml,
        coverImageUrl: coverImageUrl.trim() || null,
        isPinned,
        requiresApproval:
          requiresApproval || Boolean(ANNOUNCEMENT_CATEGORY_META[category]?.highPriority),
        notificationEnabled: notifyAllUsers,
        notificationChannels: channels,
        targetSegment,
      };

      const res = editingId
        ? await safeFetchJson<AnnouncementItem>(`/api/admin/news/${editingId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          })
        : await safeFetchJson<AnnouncementItem>('/api/admin/news', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });

      if (res.ok && res.data) {
        setEditingId(res.data.id);
        setSlug(res.data.slug);
        showToast(
          'success',
          editingId ? 'Announcement Saved' : 'Draft Created',
          `"${res.data.title}" saved (v${res.data.version}).`
        );
        fetchAnnouncements();
        return res.data;
      } else {
        showToast('error', 'Save Failed', res.error || 'Unable to save announcement.');
        return null;
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublishNow = async (item: AnnouncementItem, overrideNotify?: boolean) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<{ announcement: AnnouncementItem; campaign: any }>(
      `/api/admin/news/${item.id}/publish`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          notifyAllUsers: overrideNotify !== undefined ? overrideNotify : item.notificationEnabled,
          notificationChannels: item.notificationChannels || ['IN_APP'],
          targetSegment: item.targetSegment || 'ALL_USERS',
        }),
      }
    );

    if (res.ok && res.data) {
      const msg = res.data.campaign
        ? `Published live & queued broadcast campaign for ${res.data.campaign.totalEligible} eligible users.`
        : 'Published live to the public DIMONEX homepage.';
      showToast('success', 'Announcement Published', msg);
      setIsEditorOpen(false);
      fetchAnnouncements();
    } else {
      showToast('error', 'Publish Blocked', res.error || 'Could not publish announcement.');
    }
  };

  const handleSubmitApproval = async (item: AnnouncementItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<AnnouncementItem>(`/api/admin/news/${item.id}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      showToast(
        'info',
        'Submitted for Approval',
        'A second distinct admin (Checker) must approve before publishing.'
      );
      setIsEditorOpen(false);
      fetchAnnouncements();
    } else {
      showToast('error', 'Submit Failed', res.error || 'Could not submit for approval.');
    }
  };

  const handleApprove = async (item: AnnouncementItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<AnnouncementItem>(`/api/admin/news/${item.id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ note: 'Verified via Admin Console Maker-Checker' }),
    });
    if (res.ok) {
      showToast('success', 'Checker Approved', `"${item.title}" is now cleared for publication.`);
      fetchAnnouncements();
    } else {
      showToast('error', 'Approval Denied', res.error || 'Approval failed.');
    }
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleTarget || !scheduleDateTime) return;
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const ts = Date.parse(scheduleDateTime);
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      showToast('error', 'Invalid Schedule Time', 'Please pick a future date and time.');
      return;
    }

    const res = await safeFetchJson<AnnouncementItem>(`/api/admin/news/${scheduleTarget.id}/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        scheduledAt: ts,
        notifyAllUsers: scheduleTarget.notificationEnabled,
      }),
    });

    if (res.ok) {
      showToast(
        'success',
        'Publication Scheduled',
        `Will auto-publish at ${new Date(ts).toLocaleString()}.`
      );
      setScheduleTarget(null);
      setScheduleDateTime('');
      fetchAnnouncements();
    } else {
      showToast('error', 'Schedule Failed', res.error || 'Could not schedule announcement.');
    }
  };

  const handleArchive = async (item: AnnouncementItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<AnnouncementItem>(`/api/admin/news/${item.id}/archive`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      showToast('info', 'Announcement Archived', `"${item.title}" removed from public feeds.`);
      fetchAnnouncements();
    } else {
      showToast('error', 'Archive Failed', res.error || 'Could not archive.');
    }
  };

  const handleTogglePin = async (item: AnnouncementItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<AnnouncementItem>(`/api/admin/news/${item.id}/pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isPinned: !item.isPinned }),
    });
    if (res.ok) {
      showToast(
        'success',
        item.isPinned ? 'Unpinned' : 'Pinned',
        `"${item.title}" pin status updated.`
      );
      fetchAnnouncements();
    } else {
      showToast('error', 'Pin Update Failed', res.error || 'Failed to update pin state.');
    }
  };

  const handleOpenServerPreview = async (item: AnnouncementItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<AnnouncementItem>(`/api/admin/news/${item.id}/preview`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok && res.data) {
      setPreviewArticle(res.data);
    }
  };

  const handleOpenHistory = async (item: AnnouncementItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<{
      announcement: AnnouncementItem;
      versions: AnnouncementVersionItem[];
      auditLogs: CmsAuditLogItem[];
    }>(`/api/admin/news/${item.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok && res.data) {
      setHistoryDetail(res.data);
    }
  };

  const isHighPriorityCategory = Boolean(ANNOUNCEMENT_CATEGORY_META[category]?.highPriority);

  return (
    <div className="space-y-4">
      {/* Top Toolbar */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E4EBEF]">
              News &amp; Announcements CMS ({total})
            </h3>
            <p className="text-xs text-[#71818B] mt-0.5">
              Create, govern (Maker-Checker for Security/Maintenance/Important Notices), schedule, and broadcast exchange updates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchAnnouncements}
              className="px-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] hover:border-[#40515D] text-xs text-[#A1AFB8] hover:text-[#E4EBEF] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateEditor}
              className="px-3.5 py-1.5 rounded-[7px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Announcement
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-[#71818B] absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search title, slug, or summary..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-8 pr-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] placeholder-[#53616A] outline-none focus:border-[#8DA5B1]"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={e => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
          >
            <option value="ALL">All Categories</option>
            {ALL_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>
                {ANNOUNCEMENT_CATEGORY_META[cat].label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
      </div>

      {/* Announcements Table */}
      <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#111820] border-b border-[#202B34] text-[11px] font-mono text-[#71818B] uppercase">
              <tr>
                <th className="px-4 py-3">Announcement</th>
                <th className="px-3 py-3">Category</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Governance &amp; Broadcast</th>
                <th className="px-3 py-3">Timeline</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#202B34]">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#71818B]">
                    Loading announcements...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center space-y-1.5">
                    <p className="text-[#A1AFB8] font-medium">No announcements found</p>
                    <p className="text-[11px] text-[#71818B]">
                      Click &ldquo;New Announcement&rdquo; to create your first exchange update.
                    </p>
                  </td>
                </tr>
              ) : (
                items.map(item => {
                  const catMeta = ANNOUNCEMENT_CATEGORY_META[item.category];
                  const isCreator = user && item.authorAdminId === user.id;
                  const needsApprovalBeforePublish =
                    Boolean(item.requiresApproval) && !item.approvedBy;

                  return (
                    <tr key={item.id} className="hover:bg-[#17212B]/60 transition-colors">
                      <td className="px-4 py-3 max-w-[300px]">
                        <div className="flex items-start gap-2.5">
                          {item.coverImageUrl && (
                            <img
                              src={item.coverImageUrl}
                              alt=""
                              className="w-11 h-8 rounded-[5px] object-cover border border-[#2B3944] shrink-0 mt-0.5"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              {item.isPinned && <Pin className="w-3 h-3 text-[#8DA5B1] shrink-0" />}
                              <span className="font-semibold text-[#E4EBEF] truncate">
                                {item.title}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-[#71818B] truncate mt-0.5">
                              /{item.slug} · v{item.version || 1}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <StatusBadge tone={catMeta?.tone || 'neutral'}>
                          {catMeta?.label || item.category}
                        </StatusBadge>
                      </td>

                      <td className="px-3 py-3 whitespace-nowrap">
                        <StatusBadge tone={getStatusTone(item.status)}>
                          {item.status || 'DRAFT'}
                        </StatusBadge>
                      </td>

                      <td className="px-3 py-3 text-[11px] space-y-1">
                        {item.requiresApproval ? (
                          <div className="flex items-center gap-1 text-[#D6A85C]">
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              {item.approvedBy ? 'Checker Approved' : 'Maker-Checker Required'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[#71818B]">Standard Governance</span>
                        )}
                        {item.notificationEnabled && (
                          <div className="flex items-center gap-1 text-[#8DA5B1] font-mono text-[10px]">
                            <Bell className="w-3 h-3" />
                            <span>Broadcast ({(item.notificationChannels || ['IN_APP']).join(', ')})</span>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 font-mono text-[10px] text-[#71818B] whitespace-nowrap">
                        {item.status === 'PUBLISHED' && item.publishedAt && (
                          <div className="text-[#16A879]">
                            Pub: {new Date(item.publishedAt).toLocaleString()}
                          </div>
                        )}
                        {item.status === 'SCHEDULED' && item.scheduledAt && (
                          <div className="text-[#6D9FE8]">
                            Sched: {new Date(item.scheduledAt).toLocaleString()}
                          </div>
                        )}
                        <div>Upd: {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '—'}</div>
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                          <button
                            type="button"
                            onClick={() => openEditEditor(item)}
                            className="p-1.5 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenServerPreview(item)}
                            className="p-1.5 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            title="Preview Sanitized Article"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenHistory(item)}
                            className="p-1.5 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                            title="Version & Audit History"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>

                          {item.status !== 'ARCHIVED' && (
                            <button
                              type="button"
                              onClick={() => handleTogglePin(item)}
                              className={`p-1.5 rounded-[5px] border cursor-pointer ${
                                item.isPinned
                                  ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                                  : 'bg-[#111820] border-[#2B3944] text-[#71818B] hover:text-[#E4EBEF]'
                              }`}
                              title={item.isPinned ? 'Unpin' : 'Pin to Top'}
                            >
                              {item.isPinned ? (
                                <PinOff className="w-3.5 h-3.5" />
                              ) : (
                                <Pin className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}

                          {/* Maker-Checker Submit / Approve */}
                          {item.status === 'DRAFT' && needsApprovalBeforePublish && (
                            <button
                              type="button"
                              onClick={() => handleSubmitApproval(item)}
                              className="px-2 py-1 rounded-[5px] bg-[#2C2415] border border-[#D6A85C]/40 text-[#D6A85C] text-[11px] font-medium cursor-pointer"
                            >
                              Submit
                            </button>
                          )}

                          {item.status === 'PENDING_APPROVAL' && !item.approvedBy && (
                            <button
                              type="button"
                              disabled={Boolean(isCreator)}
                              onClick={() => handleApprove(item)}
                              title={
                                isCreator
                                  ? 'Creator cannot self-approve (Maker-Checker policy)'
                                  : 'Approve as Checker'
                              }
                              className="px-2 py-1 rounded-[5px] bg-[#12392F] border border-[#16A879]/40 text-[#16A879] disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Approve
                            </button>
                          )}

                          {/* Schedule / Reschedule */}
                          {(item.status === 'DRAFT' ||
                            item.status === 'SCHEDULED' ||
                            (item.status === 'PENDING_APPROVAL' && Boolean(item.approvedBy))) && (
                            <button
                              type="button"
                              disabled={needsApprovalBeforePublish}
                              onClick={() => {
                                setScheduleTarget(item);
                                const def = item.scheduledAt
                                  ? new Date(item.scheduledAt)
                                  : new Date(Date.now() + 3600_000);
                                setScheduleDateTime(def.toISOString().slice(0, 16));
                              }}
                              className="p-1.5 rounded-[5px] bg-[#162436] border border-[#6D9FE8]/40 text-[#6D9FE8] disabled:opacity-40 cursor-pointer"
                              title="Schedule / Reschedule Publication"
                            >
                              <Calendar className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Publish Immediately */}
                          {item.status !== 'PUBLISHED' && item.status !== 'ARCHIVED' && (
                            <button
                              type="button"
                              disabled={needsApprovalBeforePublish}
                              onClick={() => handlePublishNow(item)}
                              title={
                                needsApprovalBeforePublish
                                  ? 'Requires Checker approval before publishing'
                                  : 'Publish immediately'
                              }
                              className="px-2 py-1 rounded-[5px] bg-[#16A879] hover:bg-[#19BD88] disabled:opacity-40 disabled:cursor-not-allowed text-[#090D12] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Send className="w-3 h-3" />
                              Publish
                            </button>
                          )}

                          {/* Archive */}
                          {item.status !== 'ARCHIVED' && (
                            <button
                              type="button"
                              onClick={() => handleArchive(item)}
                              className="p-1.5 rounded-[5px] bg-[#111820] border border-[#2B3944] hover:border-[#EA5B65] text-[#71818B] hover:text-[#EA5B65] cursor-pointer"
                              title="Archive Announcement"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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
              Page {page} of {totalPages} ({total} total)
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

      {/* CREATE / EDIT ANNOUNCEMENT MODAL */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-5xl max-h-[92vh] rounded-[10px] bg-[#141C24] border border-[#2B3944] shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-[#202B34] bg-[#111820] flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[#E4EBEF]">
                  {editingId ? 'Edit Announcement' : 'Create New Announcement'}
                </h4>
                <p className="text-[11px] text-[#71818B]">
                  All article HTML is strictly sanitized server-side and rendered safely on client.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1.5 rounded-[6px] hover:bg-[#1D2832] text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. DIMONEX Lists SOL/IDR Spot Market With Zero Maker Fee Promo"
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                        Category *
                      </label>
                      <select
                        value={category}
                        onChange={e => setCategory(e.target.value as AnnouncementCategory)}
                        className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
                      >
                        {ALL_CATEGORIES.map(cat => (
                          <option key={cat} value={cat}>
                            {ANNOUNCEMENT_CATEGORY_META[cat].label}
                            {ANNOUNCEMENT_CATEGORY_META[cat].highPriority
                              ? ' (Maker-Checker)'
                              : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                        URL Slug (auto-generated if blank)
                      </label>
                      <input
                        type="text"
                        value={slug}
                        onChange={e => setSlug(e.target.value)}
                        placeholder="dimonex-lists-sol-idr"
                        className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#A1AFB8] mb-1">
                      Short Description / Summary *
                    </label>
                    <textarea
                      rows={2}
                      value={shortDescription}
                      onChange={e => setShortDescription(e.target.value)}
                      placeholder="Concise summary shown on homepage cards, notification inbox, and SEO metadata..."
                      className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#E4EBEF] outline-none focus:border-[#8DA5B1]"
                    />
                  </div>
                </div>

                {/* Right Settings Column: Cover + Governance + Broadcast */}
                <div className="space-y-3">
                  <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34] space-y-2">
                    <label className="block text-[11px] font-semibold text-[#E4EBEF]">
                      Cover Image
                    </label>
                    {coverImageUrl ? (
                      <div className="relative rounded-[6px] overflow-hidden border border-[#2B3944] h-24 bg-[#0B1016]">
                        <img
                          src={coverImageUrl}
                          alt="Cover preview"
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setCoverImageUrl('')}
                          className="absolute top-1 right-1 p-1 rounded bg-[#090D12]/80 text-[#EA5B65] cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-16 rounded-[6px] border border-dashed border-[#2B3944] flex items-center justify-center text-[11px] text-[#71818B]">
                        No cover attached
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      <label className="flex-1 text-center px-2 py-1.5 rounded-[6px] bg-[#17212B] hover:bg-[#1D2832] border border-[#2B3944] text-[11px] text-[#E4EBEF] cursor-pointer inline-flex items-center justify-center gap-1">
                        <Upload className="w-3 h-3" />
                        <span>{isUploadingCover ? 'Uploading...' : 'Upload'}</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={e => {
                            handleUploadCoverDirect(e.target.files?.[0] || null);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowMediaPicker(prev => !prev)}
                        className="flex-1 px-2 py-1.5 rounded-[6px] bg-[#17212B] hover:bg-[#1D2832] border border-[#2B3944] text-[11px] text-[#E4EBEF] inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <ImageIcon className="w-3 h-3" />
                        <span>Library</span>
                      </button>
                    </div>
                  </div>

                  {/* Governance & Broadcast Settings */}
                  <div className="p-3 rounded-[8px] bg-[#111820] border border-[#202B34] space-y-2.5 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isPinned}
                        onChange={e => setIsPinned(e.target.checked)}
                        className="accent-[#8DA5B1]"
                      />
                      <span className="text-[#E4EBEF]">Pin announcement to homepage</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requiresApproval || isHighPriorityCategory}
                        disabled={isHighPriorityCategory}
                        onChange={e => setRequiresApproval(e.target.checked)}
                        className="accent-[#D6A85C]"
                      />
                      <span className="text-[#D6A85C]">
                        Require Maker-Checker Approval
                        {isHighPriorityCategory ? ' (Enforced)' : ''}
                      </span>
                    </label>

                    <div className="pt-2 border-t border-[#202B34] space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notifyAllUsers}
                          onChange={e => setNotifyAllUsers(e.target.checked)}
                          className="accent-[#16A879]"
                        />
                        <span className="font-semibold text-[#E4EBEF]">
                          Notify All Users on Publish
                        </span>
                      </label>

                      {notifyAllUsers && (
                        <div className="pl-5 space-y-2 text-[11px]">
                          <div className="flex flex-wrap gap-2">
                            {(['IN_APP', 'WEB_PUSH', 'EMAIL'] as NotificationChannel[]).map(ch => (
                              <label key={ch} className="inline-flex items-center gap-1 text-[#A1AFB8]">
                                <input
                                  type="checkbox"
                                  checked={channels.includes(ch)}
                                  disabled={ch === 'IN_APP'}
                                  onChange={() => handleToggleChannel(ch)}
                                  className="accent-[#8DA5B1]"
                                />
                                <span>{ch}</span>
                              </label>
                            ))}
                          </div>
                          <div>
                            <label className="block text-[10px] text-[#71818B] mb-1">
                              Target Audience
                            </label>
                            <select
                              value={targetSegment}
                              onChange={e =>
                                setTargetSegment(e.target.value as NotificationTargetSegment)
                              }
                              className="w-full px-2 py-1 rounded-[5px] bg-[#141C24] border border-[#2B3944] text-[11px] text-[#E4EBEF]"
                            >
                              <option value="ALL_USERS">All Eligible Registered Users</option>
                              <option value="VERIFIED_USERS">KYC Verified Users Only</option>
                              <option value="KYC_TIER">KYC Tier 2+ Users</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Inline Media Picker Drawer */}
              {showMediaPicker && (
                <div className="p-3 rounded-[8px] bg-[#0B1016] border border-[#2B3944]">
                  <MediaLibrarySection
                    compact
                    onSelectUrl={url => {
                      setCoverImageUrl(url);
                      setShowMediaPicker(false);
                    }}
                  />
                </div>
              )}

              {/* Rich Text Editor + Live Safe Preview */}
              <div className="rounded-[9px] bg-[#111820] border border-[#2B3944] overflow-hidden">
                <div className="px-3 py-2 bg-[#0D131A] border-b border-[#202B34] flex flex-wrap items-center justify-between gap-2">
                  {/* Formatting Toolbar */}
                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { icon: Heading2, label: 'H2', pre: '<h2>', suf: '</h2>', ph: 'Section Heading' },
                      { icon: Heading3, label: 'H3', pre: '<h3>', suf: '</h3>', ph: 'Subheading' },
                      { icon: Bold, label: 'Bold', pre: '<strong>', suf: '</strong>', ph: 'bold text' },
                      { icon: Italic, label: 'Italic', pre: '<em>', suf: '</em>', ph: 'italic text' },
                      { icon: Underline, label: 'Underline', pre: '<u>', suf: '</u>', ph: 'underlined' },
                      { icon: List, label: 'Bullets', pre: '<ul>\n  <li>', suf: '</li>\n</ul>', ph: 'List item' },
                      { icon: ListOrdered, label: 'Numbers', pre: '<ol>\n  <li>', suf: '</li>\n</ol>', ph: 'Step one' },
                      { icon: Quote, label: 'Quote', pre: '<blockquote>', suf: '</blockquote>', ph: 'Important note' },
                      { icon: Code, label: 'Code', pre: '<code>', suf: '</code>', ph: 'BTC-IDR' },
                      { icon: LinkIcon, label: 'Link', pre: '<a href="https://dimonex.id">', suf: '</a>', ph: 'Learn more' },
                    ].map(btn => {
                      const Icon = btn.icon;
                      return (
                        <button
                          key={btn.label}
                          type="button"
                          onClick={() => insertHtmlFormat(btn.pre, btn.suf, btn.ph)}
                          className="p-1.5 rounded-[5px] hover:bg-[#1D2832] text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
                          title={btn.label}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                  </div>

                  {/* Write vs Safe Preview Switch */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditorTab('WRITE')}
                      className={`px-2.5 py-1 rounded-[5px] text-[11px] font-semibold cursor-pointer ${
                        editorTab === 'WRITE'
                          ? 'bg-[#1D2832] text-[#E4EBEF]'
                          : 'text-[#71818B] hover:text-[#E4EBEF]'
                      }`}
                    >
                      Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorTab('PREVIEW')}
                      className={`px-2.5 py-1 rounded-[5px] text-[11px] font-semibold cursor-pointer ${
                        editorTab === 'PREVIEW'
                          ? 'bg-[#1D2832] text-[#E4EBEF]'
                          : 'text-[#71818B] hover:text-[#E4EBEF]'
                      }`}
                    >
                      Live Safe Preview
                    </button>
                  </div>
                </div>

                {editorTab === 'WRITE' ? (
                  <textarea
                    ref={textareaRef}
                    rows={10}
                    value={contentHtml}
                    onChange={e => setContentHtml(e.target.value)}
                    placeholder="<p>Write full announcement details...</p>"
                    className="w-full p-4 bg-[#111820] text-xs font-mono text-[#E4EBEF] outline-none resize-y leading-relaxed"
                  />
                ) : (
                  <div className="p-5 min-h-[220px] bg-[#141C24]">
                    <SafeArticleContent html={contentHtml} />
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-[#202B34] bg-[#111820] flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-3.5 py-1.5 rounded-[7px] bg-[#141C24] border border-[#2B3944] text-xs text-[#A1AFB8] hover:text-[#E4EBEF] cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSaveDraft}
                  className="px-4 py-1.5 rounded-[7px] bg-[#1D2832] hover:bg-[#263542] border border-[#40515D] text-xs font-semibold text-[#E4EBEF] cursor-pointer"
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </button>

                {requiresApproval || isHighPriorityCategory ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={async () => {
                      const saved = await handleSaveDraft();
                      if (saved) await handleSubmitApproval(saved);
                    }}
                    className="px-4 py-1.5 rounded-[7px] bg-[#D6A85C] hover:bg-[#E1BA75] text-[#090D12] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Save &amp; Submit for Approval
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={async () => {
                      const saved = await handleSaveDraft();
                      if (saved) await handlePublishNow(saved, notifyAllUsers);
                    }}
                    className="px-4 py-1.5 rounded-[7px] bg-[#16A879] hover:bg-[#19BD88] text-[#090D12] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {notifyAllUsers ? 'Publish & Notify Users' : 'Publish Immediately'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE MODAL */}
      {scheduleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-md rounded-[10px] bg-[#141C24] border border-[#2B3944] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[#E4EBEF]">
                Schedule Publication
              </h4>
              <button
                type="button"
                onClick={() => setScheduleTarget(null)}
                className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#A1AFB8]">
              Schedule <strong className="text-[#E4EBEF]">{scheduleTarget.title}</strong> to publish automatically (and trigger broadcast if enabled).
            </p>
            <div>
              <label className="block text-[11px] text-[#71818B] mb-1">
                Publish Date &amp; Time (Local)
              </label>
              <input
                type="datetime-local"
                value={scheduleDateTime}
                onChange={e => setScheduleDateTime(e.target.value)}
                className="w-full px-3 py-2 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs font-mono text-[#E4EBEF]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScheduleTarget(null)}
                className="px-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#A1AFB8] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSchedule}
                className="px-4 py-1.5 rounded-[7px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-xs font-semibold cursor-pointer"
              >
                Confirm Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SANITIZED SERVER PREVIEW MODAL */}
      {previewArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
          <div className="w-full max-w-3xl max-h-[88vh] rounded-[10px] bg-[#141C24] border border-[#2B3944] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[#202B34] bg-[#111820] flex items-center justify-between">
              <span className="text-xs font-mono text-[#8DA5B1]">
                SERVER-SANITIZED PREVIEW · {previewArticle.status}
              </span>
              <button
                type="button"
                onClick={() => setPreviewArticle(null)}
                className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {previewArticle.coverImageUrl && (
                <img
                  src={previewArticle.coverImageUrl}
                  alt={previewArticle.title}
                  className="w-full max-h-60 object-cover rounded-[8px] border border-[#202B34]"
                />
              )}
              <StatusBadge tone={ANNOUNCEMENT_CATEGORY_META[previewArticle.category]?.tone || 'neutral'}>
                {ANNOUNCEMENT_CATEGORY_META[previewArticle.category]?.label || previewArticle.category}
              </StatusBadge>
              <h2 className="text-xl font-bold text-[#E4EBEF]">{previewArticle.title}</h2>
              <p className="text-xs text-[#A1AFB8]">{previewArticle.shortDescription}</p>
              <hr className="border-[#202B34]" />
              <SafeArticleContent html={previewArticle.contentHtml || ''} />
            </div>
          </div>
        </div>
      )}

      {/* VERSION & AUDIT HISTORY MODAL */}
      {historyDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
          <div className="w-full max-w-3xl max-h-[88vh] rounded-[10px] bg-[#141C24] border border-[#2B3944] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-[#202B34] bg-[#111820] flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[#E4EBEF]">
                  Publication History &amp; Admin Audit Trail
                </h4>
                <p className="text-[11px] text-[#71818B]">{historyDetail.announcement.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryDetail(null)}
                className="text-[#71818B] hover:text-[#E4EBEF] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              <div className="space-y-2">
                <h5 className="font-semibold text-[#E4EBEF]">
                  Revision Versions ({historyDetail.versions.length})
                </h5>
                <div className="space-y-1.5">
                  {historyDetail.versions.map(v => (
                    <div
                      key={v.id}
                      className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-mono font-semibold text-[#8DA5B1]">v{v.version}</span>
                        <span className="text-[#E4EBEF] ml-2 font-medium">{v.title}</span>
                        <span className="text-[#71818B] ml-2">({v.changeSummary || v.status})</span>
                      </div>
                      <span className="font-mono text-[10px] text-[#71818B]">
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="font-semibold text-[#E4EBEF]">
                  Append-Only Admin Audit Logs ({historyDetail.auditLogs.length})
                </h5>
                <div className="space-y-1.5">
                  {historyDetail.auditLogs.map(log => (
                    <div
                      key={log.id}
                      className="p-3 rounded-[7px] bg-[#111820] border border-[#202B34] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-[#E4EBEF]">{log.action}</span>
                        <span className="font-mono text-[10px] text-[#71818B]">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#A1AFB8]">
                        Actor: {log.actorEmail || log.actorId} ({log.actorRole}) · Hash:{' '}
                        <span className="font-mono text-[#71818B]">
                          {log.currentHash.slice(0, 14)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
