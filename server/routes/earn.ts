/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/earn.ts
 * Institutional Earn & Staking Vaults REST APIs.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from './auth.js';
import { earnService } from '../services/earn/EarnService.js';

export const earnRouter = Router();

const earnMutationBuckets = new Map<string, number[]>();
function rateLimitEarn(keyPrefix: string, maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const key = `${keyPrefix}:${user?.id || req.ip || 'anon'}`;
    const now = Date.now();
    const recent = (earnMutationBuckets.get(key) || []).filter(ts => now - ts < 60_000);
    if (recent.length >= maxPerMinute) {
      return res.status(429).json({ error: 'Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.' });
    }
    recent.push(now);
    earnMutationBuckets.set(key, recent);
    next();
  };
}

// GET /api/earn/vaults (Public real catalog with live TVL from EarnPosition records)
earnRouter.get('/vaults', (_req, res) => {
  try {
    res.json(earnService.listPublicVaults());
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memuat daftar vault Earn' });
  }
});

// GET /api/earn/summary (Authenticated real balances, active positions & payout history)
earnRouter.get('/summary', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    res.json(earnService.getUserSummary(user.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memuat ringkasan Earn' });
  }
});

// POST /api/earn/subscribe (Atomic double-entry principal lock into Earn Custody)
earnRouter.post('/subscribe', requireAuth, rateLimitEarn('earn-subscribe', 20), (req, res) => {
  try {
    const user = (req as any).user;
    const { vaultId, amount, autoCompound, idempotencyKey } = req.body || {};
    if (!vaultId || typeof vaultId !== 'string') {
      return res.status(400).json({ error: 'vaultId wajib diisi' });
    }
    if (amount === undefined || amount === null || String(amount).trim() === '') {
      return res.status(400).json({ error: 'Nominal stake wajib diisi' });
    }

    const position = earnService.subscribeToVault({
      userId: user.id,
      vaultId: vaultId.trim(),
      amount: String(amount).trim(),
      autoCompound: Boolean(autoCompound),
      idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : undefined,
    });
    const summary = earnService.getUserSummary(user.id);
    res.status(201).json({ success: true, position, summary });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal melakukan subscription vault' });
  }
});

// POST /api/earn/positions/:id/claim (Claim settled daily yield to Spot wallet)
earnRouter.post('/positions/:id/claim', requireAuth, rateLimitEarn('earn-claim', 20), (req, res) => {
  try {
    const user = (req as any).user;
    const positionId = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(positionId)) {
      return res.status(400).json({ error: 'ID posisi tidak valid' });
    }

    const result = earnService.claimPositionYield({ userId: user.id, positionId });
    const summary = earnService.getUserSummary(user.id);
    res.json({ success: true, ...result, summary });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengklaim imbal hasil' });
  }
});

// POST /api/earn/positions/:id/redeem (Redeem principal back to Spot wallet)
earnRouter.post('/positions/:id/redeem', requireAuth, rateLimitEarn('earn-redeem', 20), (req, res) => {
  try {
    const user = (req as any).user;
    const positionId = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(positionId)) {
      return res.status(400).json({ error: 'ID posisi tidak valid' });
    }

    const { amount, confirmEarlyRedeem } = req.body || {};
    const result = earnService.redeemPosition({
      userId: user.id,
      positionId,
      amount: amount !== undefined && amount !== null && String(amount).trim() !== '' ? String(amount).trim() : undefined,
      confirmEarlyRedeem: Boolean(confirmEarlyRedeem),
    });
    const summary = earnService.getUserSummary(user.id);
    res.json({ success: true, ...result, summary });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mencairkan posisi Earn' });
  }
});

// POST /api/earn/positions/:id/auto-compound (Toggle Auto-Compound preference)
earnRouter.post('/positions/:id/auto-compound', requireAuth, rateLimitEarn('earn-compound', 30), (req, res) => {
  try {
    const user = (req as any).user;
    const positionId = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(positionId)) {
      return res.status(400).json({ error: 'ID posisi tidak valid' });
    }
    const { autoCompound } = req.body || {};
    const position = earnService.toggleAutoCompound({
      userId: user.id,
      positionId,
      autoCompound: Boolean(autoCompound),
    });
    const summary = earnService.getUserSummary(user.id);
    res.json({ success: true, position, summary });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal mengubah pengaturan Auto-Compound' });
  }
});
