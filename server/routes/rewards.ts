/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/rewards.ts
 * Institutional VIP, Dynamic Trader Task Center, Vouchers, Rewards History & Referral APIs.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './auth.js';
import { vipRewardsService } from '../services/rewards/VipRewardsService.js';

export const rewardsRouter = Router();

// Sliding-window per-user rate limiter for reward claims, voucher redemptions & referral mutations
const mutationRateBuckets = new Map<string, number[]>();
function rateLimitMutation(keyPrefix: string, maxPerMinute: number) {
  return (req: Request, res: Response, next: Function) => {
    const user = (req as any).user;
    const key = `${keyPrefix}:${user?.id || req.ip || 'anon'}`;
    const now = Date.now();
    const recent = (mutationRateBuckets.get(key) || []).filter(ts => now - ts < 60_000);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    recent.push(now);
    mutationRateBuckets.set(key, recent);
    next();
  };
}

// GET /api/rewards/schedule (Public read-only VIP fee schedule & active task catalog)
rewardsRouter.get('/schedule', (_req, res) => {
  res.json(vipRewardsService.getPublicSchedule());
});

// GET /api/rewards/summary (Authenticated real user VIP status, tasks, vouchers, referrals & payouts)
rewardsRouter.get('/summary', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const summary = vipRewardsService.getUserSummary(user.id);
    res.json(summary);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to compute VIP summary' });
  }
});

// GET /api/rewards/history (Authenticated paginated Rewards History for the current user)
rewardsRouter.get('/history', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const type = typeof req.query.type === 'string' ? req.query.type : 'ALL';
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 15;
    const history = vipRewardsService.getUserRewardsHistory(user.id, { type, page, limit });
    res.json(history);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to fetch rewards history' });
  }
});

// POST /api/rewards/tasks/:taskId/claim (Atomic server-verified USDT task reward claim)
rewardsRouter.post(
  '/tasks/:taskId/claim',
  requireAuth,
  rateLimitMutation('reward-claim', 15),
  (req, res) => {
    try {
      const user = (req as any).user;
      const taskId = String(req.params.taskId || '').trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,64}$/.test(taskId)) {
        return res.status(400).json({ error: 'Invalid reward task ID' });
      }
      const claim = vipRewardsService.claimTaskReward(user.id, taskId);
      const summary = vipRewardsService.getUserSummary(user.id);
      res.json({ success: true, claim, summary });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Reward claim failed' });
    }
  }
);

// POST /api/rewards/vouchers/redeem (Atomic double-entry voucher code redemption)
rewardsRouter.post(
  '/vouchers/redeem',
  requireAuth,
  rateLimitMutation('voucher-redeem', 12),
  (req, res) => {
    try {
      const user = (req as any).user;
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      if (!code.trim()) {
        return res.status(400).json({ error: 'Voucher code is required.' });
      }
      const redemption = vipRewardsService.redeemVoucher(user.id, code);
      const summary = vipRewardsService.getUserSummary(user.id);
      res.json({ success: true, redemption, summary });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Voucher redemption failed' });
    }
  }
);

// POST /api/rewards/referral/apply (Bind a valid referral code to authenticated user)
rewardsRouter.post(
  '/referral/apply',
  requireAuth,
  rateLimitMutation('referral-apply', 10),
  (req, res) => {
    try {
      const user = (req as any).user;
      const code = typeof req.body?.referralCode === 'string' ? req.body.referralCode : '';
      if (!code.trim()) {
        return res.status(400).json({ error: 'Referral code is required' });
      }
      const relation = vipRewardsService.bindReferralCode(user.id, code);
      const summary = vipRewardsService.getUserSummary(user.id);
      res.json({ success: true, relation, summary });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to apply referral code' });
    }
  }
);

// POST /api/rewards/referral/claim (Atomic double-entry claim of accrued USDT referral commissions)
rewardsRouter.post(
  '/referral/claim',
  requireAuth,
  rateLimitMutation('referral-claim', 10),
  (req, res) => {
    try {
      const user = (req as any).user;
      const payout = vipRewardsService.claimReferralCommission(user.id);
      const summary = vipRewardsService.getUserSummary(user.id);
      res.json({ success: true, payout, summary });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Referral commission claim failed' });
    }
  }
);
