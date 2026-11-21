/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/rewardsAdmin.ts
 * Admin Console RBAC-Protected APIs for Institutional VIP & Trader Rewards Management:
 * - Task Center CRUD
 * - Voucher Campaign CRUD
 * - Global Rewards & Payout Ledger
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from './auth.js';
import { vipRewardsService } from '../services/rewards/VipRewardsService.js';

export const rewardsAdminRouter = Router();

// Sliding-window per-admin mutation rate limiter
const adminRewardsRateBuckets = new Map<string, number[]>();
function rateLimitAdmin(label: string, maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const key = `${label}:${user?.id || req.ip || 'anon'}`;
    const now = Date.now();
    const recent = (adminRewardsRateBuckets.get(key) || []).filter(ts => now - ts < 60_000);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait before retrying.' });
    }
    recent.push(now);
    adminRewardsRateBuckets.set(key, recent);
    next();
  };
}

// All routes require authenticated ADMIN role
rewardsAdminRouter.use(requireAdmin);

// GET /api/admin/rewards/overview
rewardsAdminRouter.get('/overview', (_req, res) => {
  try {
    res.json(vipRewardsService.getAdminRewardsOverview());
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to load rewards overview' });
  }
});

// ============================================================================
// TASK CENTER MANAGEMENT
// ============================================================================

// GET /api/admin/rewards/tasks
rewardsAdminRouter.get('/tasks', (_req, res) => {
  try {
    res.json({ tasks: vipRewardsService.listAdminTasks() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to list reward tasks' });
  }
});

// POST /api/admin/rewards/tasks
rewardsAdminRouter.post('/tasks', rateLimitAdmin('admin-task-create', 30), (req, res) => {
  try {
    const actor = (req as any).user;
    const task = vipRewardsService.createAdminTask(req.body || {}, actor.id);
    res.status(201).json({ success: true, task, overview: vipRewardsService.getAdminRewardsOverview() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create reward task' });
  }
});

// PATCH /api/admin/rewards/tasks/:id
rewardsAdminRouter.patch('/tasks/:id', rateLimitAdmin('admin-task-update', 40), (req, res) => {
  try {
    const actor = (req as any).user;
    const taskId = String(req.params.id || '').trim().toUpperCase();
    const task = vipRewardsService.updateAdminTask(taskId, req.body || {}, actor.id);
    res.json({ success: true, task, overview: vipRewardsService.getAdminRewardsOverview() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update reward task' });
  }
});

// DELETE /api/admin/rewards/tasks/:id
rewardsAdminRouter.delete('/tasks/:id', rateLimitAdmin('admin-task-delete', 30), (req, res) => {
  try {
    const actor = (req as any).user;
    const taskId = String(req.params.id || '').trim().toUpperCase();
    const result = vipRewardsService.deleteAdminTask(taskId, actor.id);
    res.json({ success: true, ...result, overview: vipRewardsService.getAdminRewardsOverview() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete reward task' });
  }
});

// ============================================================================
// VOUCHER MANAGEMENT
// ============================================================================

// GET /api/admin/rewards/vouchers
rewardsAdminRouter.get('/vouchers', (_req, res) => {
  try {
    res.json({ vouchers: vipRewardsService.listAdminVouchers() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to list vouchers' });
  }
});

// POST /api/admin/rewards/vouchers
rewardsAdminRouter.post('/vouchers', rateLimitAdmin('admin-voucher-create', 30), (req, res) => {
  try {
    const actor = (req as any).user;
    const voucher = vipRewardsService.createAdminVoucher(req.body || {}, actor.id);
    res.status(201).json({ success: true, voucher, overview: vipRewardsService.getAdminRewardsOverview() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create voucher' });
  }
});

// PATCH /api/admin/rewards/vouchers/:id
rewardsAdminRouter.patch('/vouchers/:id', rateLimitAdmin('admin-voucher-update', 40), (req, res) => {
  try {
    const actor = (req as any).user;
    const voucherId = String(req.params.id || '').trim();
    const voucher = vipRewardsService.updateAdminVoucher(voucherId, req.body || {}, actor.id);
    res.json({ success: true, voucher, overview: vipRewardsService.getAdminRewardsOverview() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update voucher' });
  }
});

// DELETE /api/admin/rewards/vouchers/:id
rewardsAdminRouter.delete('/vouchers/:id', rateLimitAdmin('admin-voucher-delete', 30), (req, res) => {
  try {
    const actor = (req as any).user;
    const voucherId = String(req.params.id || '').trim();
    const result = vipRewardsService.deleteAdminVoucher(voucherId, actor.id);
    res.json({ success: true, ...result, overview: vipRewardsService.getAdminRewardsOverview() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete voucher' });
  }
});

// ============================================================================
// GLOBAL REWARDS & PAYOUT LEDGER
// ============================================================================

// GET /api/admin/rewards/history
rewardsAdminRouter.get('/history', (req, res) => {
  try {
    const type = typeof req.query.type === 'string' ? req.query.type : 'ALL';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 25;
    res.json(vipRewardsService.listAdminRewardsHistory({ type, search, page, limit }));
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to load rewards settlement ledger' });
  }
});
