/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * notifications.ts
 * Authenticated user Notification Inbox & Preferences API.
 * Strictly isolates each user's notifications to prevent IDOR access.
 */

import { Router } from 'express';
import { requireAuth } from './auth.js';
import { notificationBroadcastService } from '../services/cms/NotificationBroadcastService.js';

export const notificationsRouter = Router();

// GET /api/notifications
notificationsRouter.get('/', requireAuth, (req, res) => {
  const user = (req as any).user;
  const result = notificationBroadcastService.listUserNotifications(user.id, {
    unreadOnly: req.query.unreadOnly === 'true',
    page: req.query.page ? Number(req.query.page) : 1,
    limit: req.query.limit ? Number(req.query.limit) : 20
  });
  res.json(result);
});

// GET /api/notifications/unread-count
notificationsRouter.get('/unread-count', requireAuth, (req, res) => {
  const user = (req as any).user;
  const unreadCount = notificationBroadcastService.getUnreadCount(user.id);
  res.json({ unreadCount });
});

// GET /api/notifications/preferences
notificationsRouter.get('/preferences', requireAuth, (req, res) => {
  const user = (req as any).user;
  const preferences = notificationBroadcastService.getUserPreferences(user.id);
  res.json(preferences);
});

// PUT /api/notifications/preferences
notificationsRouter.put('/preferences', requireAuth, (req, res) => {
  const user = (req as any).user;
  const body = req.body || {};
  const updated = notificationBroadcastService.updateUserPreferences(user.id, {
    inAppEnabled: body.inAppEnabled,
    webPushEnabled: body.webPushEnabled,
    webPushPermissionGranted: body.webPushPermissionGranted,
    emailEnabled: body.emailEnabled
  });
  res.json(updated);
});

// POST /api/notifications/read-all
notificationsRouter.post('/read-all', requireAuth, (req, res) => {
  const user = (req as any).user;
  const result = notificationBroadcastService.markAllNotificationsRead(user.id);
  res.json({ success: true, ...result, unreadCount: 0 });
});

// GET /api/notifications/:id (strict ownership isolation)
notificationsRouter.get('/:id', requireAuth, (req, res) => {
  const user = (req as any).user;
  const notif = notificationBroadcastService.getUserNotificationById(user.id, req.params.id);
  if (!notif) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json(notif);
});

// POST /api/notifications/:id/read (strict ownership isolation)
notificationsRouter.post('/:id/read', requireAuth, (req, res) => {
  const user = (req as any).user;
  const notif = notificationBroadcastService.markNotificationRead(user.id, req.params.id);
  if (!notif) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  res.json({
    notification: notif,
    unreadCount: notificationBroadcastService.getUnreadCount(user.id)
  });
});
