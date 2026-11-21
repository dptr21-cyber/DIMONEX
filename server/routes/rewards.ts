/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/rewards.ts
 * Institutional VIP, Trader Rewards Task Center & Referral Program APIs.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './auth.js';
import { vipRewardsService } from '../services/rewards/VipRewardsService.js';
import { RewardTaskId } from '../db/types.js';

export const rewardsRouter = Router();

// Sliding-window per-user rate limiter for reward claims & referral mutations
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

const VALID_TASK_IDS = new Set<string>([
  'SECURITY_2FA',
  'FIRST_DEPOSIT',
  'FIRST_SPOT_TRADE',
  'FUTURES_VOLUME_2K',
  'KYC_TIER_2',
  'SPOT_VOLUME_50K'
]);

// GET /api/rewards/schedule (Public read-only VIP fee schedule & task catalog)
rewardsRouter.get('/schedule', (_req, res) => {
  res.json(vipRewardsService.getPublicSchedule());
});

// GET /api/rewards/summary (Authenticated real user VIP status, tasks, referrals & payouts)
rewardsRouter.get('/summary', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const summary = vipRewardsService.getUserSummary(user.id);
    res.json(summary);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to compute VIP summary' });
  }
});

// POST /api/rewards/tasks/:taskId/claim (Atomic server-verified USDT reward claim)
rewardsRouter.post(
  '/tasks/:taskId/claim',
  requireAuth,
  rateLimitMutation('reward-claim', 15),
  (req, res) => {
    try {
      const user = (req as any).user;
      const taskId = String(req.params.taskId || '').trim().toUpperCase();
      if (!VALID_TASK_IDS.has(taskId)) {
        return res.status(400).json({ error: 'Invalid reward task ID' });
      }
      const claim = vipRewardsService.claimTaskReward(user.id, taskId as RewardTaskId);
      const summary = vipRewardsService.getUserSummary(user.id);
      res.json({ success: true, claim, summary });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Reward claim failed' });
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
