/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * NotificationsView.tsx
 * User Notification Inbox, Detail Viewer, Mark Read / Mark All Read, Pagination,
 * Announcement Links, and Channel Consent Preferences (In-App, Web Push, Email).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  CheckCheck,
  Check,
  ExternalLink,
  Settings,
  Mail,
  Smartphone,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import {
  ANNOUNCEMENT_CATEGORY_META,
  UserNotificationItem,
  UserNotificationPreferencesItem,
  UserProfile,
} from '../../types/index.js';
import { safeFetchJson } from '../../lib/safeFetch.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';

interface NotificationsViewProps {
  user: UserProfile | null;
  onOpenAuthModal: () => void;
  onOpenArticle: (slug: string) => void;
  onUnreadCountChange: (count: number) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  user,
  onOpenAuthModal,
  onOpenArticle,
  onUnreadCountChange,
}) => {
  const { showToast } = useToast();
  const [items, setItems] = useState<UserNotificationItem[]>([]);
  const [selected, setSelected] = useState<UserNotificationItem | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const [prefs, setPrefs] = useState<UserNotificationPreferencesItem | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);

  const fetchNotifications = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token || !user) return;
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: '15',
      });
      if (unreadOnly) qs.set('unreadOnly', 'true');

      const res = await safeFetchJson<{
        items: UserNotificationItem[];
        unreadCount: number;
        pagination: { totalPages: number };
      }>(`/api/notifications?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok && res.data) {
        setItems(res.data.items || []);
        setUnreadCount(res.data.unreadCount || 0);
        setTotalPages(res.data.pagination?.totalPages || 1);
        onUnreadCountChange(res.data.unreadCount || 0);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, page, unreadOnly, onUnreadCountChange]);

  const fetchPreferences = useCallback(async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token || !user) return;
    const res = await safeFetchJson<UserNotificationPreferencesItem>(
      '/api/notifications/preferences',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok && res.data) {
      setPrefs(res.data);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    fetchPreferences();
  }, [fetchNotifications, fetchPreferences]);

  const handleMarkRead = async (notif: UserNotificationItem) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setSelected(notif);
    if (notif.isRead) return;

    const res = await safeFetchJson<{ notification: UserNotificationItem; unreadCount: number }>(
      `/api/notifications/${notif.id}/read`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok && res.data) {
      setItems(prev =>
        prev.map(i => (i.id === notif.id ? { ...i, isRead: true, readAt: Date.now() } : i))
      );
      setSelected({ ...notif, isRead: true, readAt: Date.now() });
      setUnreadCount(res.data.unreadCount);
      onUnreadCountChange(res.data.unreadCount);
    }
  };

  const handleMarkAllRead = async () => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    const res = await safeFetchJson<{ updatedCount: number; unreadCount: number }>(
      '/api/notifications/read-all',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok) {
      setItems(prev => prev.map(i => ({ ...i, isRead: true, readAt: i.readAt || Date.now() })));
      if (selected) setSelected({ ...selected, isRead: true });
      setUnreadCount(0);
      onUnreadCountChange(0);
      showToast('success', 'All Caught Up', 'All notifications marked as read.');
    }
  };

  const handleUpdatePrefs = async (
    patch: Partial<Pick<UserNotificationPreferencesItem, 'inAppEnabled' | 'webPushEnabled' | 'webPushPermissionGranted' | 'emailEnabled'>>
  ) => {
    const token = localStorage.getItem('dimonex_auth_token');
    if (!token) return;
    setIsSavingPrefs(true);
    try {
      const res = await safeFetchJson<UserNotificationPreferencesItem>(
        '/api/notifications/preferences',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(patch),
        }
      );
      if (res.ok && res.data) {
        setPrefs(res.data);
        showToast('success', 'Preferences Updated', 'Your notification channel consent was saved.');
      }
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleToggleWebPush = async () => {
    if (!prefs) return;
    if (prefs.webPushEnabled) {
      await handleUpdatePrefs({ webPushEnabled: false });
      return;
    }
    if (typeof window !== 'undefined' && 'Notification' in window) {
      let perm = Notification.permission;
      if (perm === 'default') {
        perm = await Notification.requestPermission();
      }
      if (perm !== 'granted') {
        showToast(
          'warning',
          'Browser Permission Required',
          'Web Push requires explicit browser notification permission.'
        );
        return;
      }
      await handleUpdatePrefs({ webPushEnabled: true, webPushPermissionGranted: true });
    } else {
      showToast('info', 'Browser Push Unavailable', 'This browser does not support Web Push notifications.');
    }
  };

  if (!user) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center bg-[#090D12]">
        <div className="max-w-md w-full rounded-[10px] bg-[#141C24] border border-[#202B34] p-8 text-center space-y-4">
          <Bell className="w-10 h-10 text-[#8DA5B1] mx-auto" />
          <h1 className="text-lg font-semibold text-[#E4EBEF]">Sign In to View Notifications</h1>
          <p className="text-xs text-[#A1AFB8]">
            Your exchange notifications, security alerts, and channel preferences are isolated to your account.
          </p>
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="px-4 py-2 rounded-[7px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-xs font-semibold cursor-pointer"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 lg:p-6 bg-[#090D12] overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="rounded-[10px] bg-[#141C24] border border-[#202B34] p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-[#17212B] border border-[#2B3944] flex items-center justify-center text-[#8DA5B1]">
              <Inbox className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-[#E4EBEF]">Notification Inbox</h1>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-[5px] bg-[#16A879]/20 border border-[#16A879]/40 text-[11px] font-mono font-semibold text-[#35B887]">
                    {unreadCount} Unread
                  </span>
                )}
              </div>
              <p className="text-xs text-[#71818B]">
                Official DIMONEX announcements, security alerts, and platform broadcasts delivered to {user.email}.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fetchNotifications}
              className="px-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] text-xs text-[#A1AFB8] hover:text-[#E4EBEF] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={handleMarkAllRead}
              className="px-3 py-1.5 rounded-[7px] bg-[#111820] border border-[#2B3944] hover:border-[#8DA5B1] disabled:opacity-40 text-xs text-[#E4EBEF] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5 text-[#16A879]" />
              Mark All Read
            </button>
            <button
              type="button"
              onClick={() => setShowPrefs(p => !p)}
              className={`px-3 py-1.5 rounded-[7px] border text-xs inline-flex items-center gap-1.5 cursor-pointer ${
                showPrefs
                  ? 'bg-[#1D2832] border-[#8DA5B1] text-[#E4EBEF]'
                  : 'bg-[#111820] border-[#2B3944] text-[#A1AFB8] hover:text-[#E4EBEF]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              Channel Preferences
            </button>
          </div>
        </div>

        {/* Channel Preferences Panel */}
        {showPrefs && prefs && (
          <div className="rounded-[10px] bg-[#141C24] border border-[#2B3944] p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#E4EBEF]">
              Notification Channel Preferences &amp; Consent
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-[8px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-[#8DA5B1]" /> In-App Inbox
                  </div>
                  <p className="text-[11px] text-[#71818B] mt-0.5">
                    Receive real-time announcements in your DIMONEX bell &amp; inbox.
                  </p>
                </div>
                <input
                  type="checkbox"
                  disabled={isSavingPrefs}
                  checked={prefs.inAppEnabled}
                  onChange={e => handleUpdatePrefs({ inAppEnabled: e.target.checked })}
                  className="accent-[#16A879] w-4 h-4 cursor-pointer"
                />
              </div>

              <div className="p-3.5 rounded-[8px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-[#8DA5B1]" /> Web Push (Optional)
                  </div>
                  <p className="text-[11px] text-[#71818B] mt-0.5">
                    Requires browser permission ({prefs.webPushPermissionGranted ? 'Granted' : 'Not granted'}).
                  </p>
                </div>
                <input
                  type="checkbox"
                  disabled={isSavingPrefs}
                  checked={prefs.webPushEnabled}
                  onChange={handleToggleWebPush}
                  className="accent-[#16A879] w-4 h-4 cursor-pointer"
                />
              </div>

              <div className="p-3.5 rounded-[8px] bg-[#111820] border border-[#202B34] flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-[#E4EBEF] flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-[#8DA5B1]" /> Email Digest (Opt-in)
                  </div>
                  <p className="text-[11px] text-[#71818B] mt-0.5">
                    Explicit consent required for email announcement broadcasts.
                  </p>
                </div>
                <input
                  type="checkbox"
                  disabled={isSavingPrefs}
                  checked={prefs.emailEnabled}
                  onChange={e => handleUpdatePrefs({ emailEnabled: e.target.checked })}
                  className="accent-[#16A879] w-4 h-4 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* Inbox Split Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Notification List */}
          <div className="lg:col-span-5 rounded-[10px] bg-[#141C24] border border-[#202B34] overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-[#111820] border-b border-[#202B34] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setUnreadOnly(false);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-[5px] text-xs cursor-pointer ${
                    !unreadOnly
                      ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold'
                      : 'text-[#71818B] hover:text-[#E4EBEF]'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUnreadOnly(true);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 rounded-[5px] text-xs cursor-pointer ${
                    unreadOnly
                      ? 'bg-[#1D2832] text-[#E4EBEF] font-semibold'
                      : 'text-[#71818B] hover:text-[#E4EBEF]'
                  }`}
                >
                  Unread ({unreadCount})
                </button>
              </div>
            </div>

            <div className="divide-y divide-[#202B34] max-h-[540px] overflow-y-auto">
              {isLoading ? (
                <div className="p-8 text-center text-xs text-[#71818B]">Loading inbox...</div>
              ) : items.length === 0 ? (
                <div className="p-10 text-center space-y-1.5">
                  <Bell className="w-7 h-7 text-[#53616A] mx-auto" />
                  <p className="text-xs font-medium text-[#A1AFB8]">No notifications here</p>
                  <p className="text-[11px] text-[#71818B]">
                    Published exchange broadcasts will appear in your inbox in real time.
                  </p>
                </div>
              ) : (
                items.map(notif => {
                  const cat = ANNOUNCEMENT_CATEGORY_META[notif.category];
                  const isActive = selected?.id === notif.id;
                  return (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => handleMarkRead(notif)}
                      className={`w-full text-left p-3.5 transition-colors cursor-pointer space-y-1.5 ${
                        isActive
                          ? 'bg-[#1D2832]'
                          : !notif.isRead
                          ? 'bg-[#17212B]/70 hover:bg-[#17212B]'
                          : 'hover:bg-[#111820]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {!notif.isRead && (
                            <span className="w-2 h-2 rounded-full bg-[#16A879] shrink-0" />
                          )}
                          <StatusBadge tone={cat?.tone || 'neutral'}>
                            {cat?.label || notif.category}
                          </StatusBadge>
                        </div>
                        <span className="text-[10px] font-mono text-[#71818B]">
                          {new Date(notif.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-[#E4EBEF] line-clamp-1">
                        {notif.title}
                      </div>
                      <p className="text-[11px] text-[#A1AFB8] line-clamp-2">{notif.summary}</p>
                    </button>
                  );
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-[#202B34] bg-[#111820] flex items-center justify-between text-xs">
                <span className="font-mono text-[#71818B]">
                  {page} / {totalPages}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-2 py-1 rounded bg-[#141C24] border border-[#2B3944] disabled:opacity-40 text-[#E4EBEF] cursor-pointer"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="px-2 py-1 rounded bg-[#141C24] border border-[#2B3944] disabled:opacity-40 text-[#E4EBEF] cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: Notification Detail View */}
          <div className="lg:col-span-7 rounded-[10px] bg-[#141C24] border border-[#202B34] p-6">
            {!selected ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center space-y-2">
                <Inbox className="w-8 h-8 text-[#53616A]" />
                <p className="text-sm font-medium text-[#A1AFB8]">Select a notification to read</p>
                <p className="text-xs text-[#71818B]">
                  Click any notification on the left to inspect its details and open the full announcement.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#202B34]">
                  <StatusBadge
                    tone={ANNOUNCEMENT_CATEGORY_META[selected.category]?.tone || 'neutral'}
                  >
                    {ANNOUNCEMENT_CATEGORY_META[selected.category]?.label || selected.category}
                  </StatusBadge>
                  <span className="text-[11px] font-mono text-[#71818B] inline-flex items-center gap-1.5">
                    {selected.isRead && <Check className="w-3.5 h-3.5 text-[#16A879]" />}
                    {new Date(selected.createdAt).toLocaleString()}
                  </span>
                </div>

                {selected.coverImageUrl && (
                  <img
                    src={selected.coverImageUrl}
                    alt={selected.title}
                    className="w-full max-h-52 object-cover rounded-[8px] border border-[#202B34]"
                  />
                )}

                <h2 className="text-lg font-bold text-[#E4EBEF]">{selected.title}</h2>
                <p className="text-sm text-[#C1D0D6] leading-relaxed">{selected.summary}</p>

                {selected.announcementSlug && (
                  <div className="pt-3 border-t border-[#202B34]">
                    <button
                      type="button"
                      onClick={() => onOpenArticle(selected.announcementSlug!)}
                      className="px-4 py-2 rounded-[7px] bg-[#8DA5B1] hover:bg-[#A5BAC4] text-[#090D12] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Read Full Announcement</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
