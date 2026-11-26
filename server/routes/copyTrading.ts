/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/copyTrading.ts
 * Real Institutional Copy Trading REST Endpoints.
 */

import { Router } from 'express';
import { requireAuth } from './auth.js';
import { copyTradingService } from '../services/copy/CopyTradingService.js';
import { db } from '../db/database.js';

export const copyTradingRouter = Router();

// Public: Leaderboard of APPROVED Master Traders with live real trade metrics
copyTradingRouter.get('/masters', (_req, res) => {
  try {
    const masters = copyTradingService.listPublicMasters();
    res.json({ success: true, masters });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat daftar Master Trader' });
  }
});

// Public: Single Master Trader detailed metrics + real recent trades
copyTradingRouter.get('/masters/:id', (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) {
      return res.status(400).json({ error: 'ID master tidak valid' });
    }
    const detail = copyTradingService.getMasterDetail(id);
    res.json({ success: true, ...detail });
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Master trader tidak ditemukan' });
  }
});

// Authenticated: Get user's copy relationships, valuations, mirrored orders & own Master profile if any
copyTradingRouter.get('/my-copies', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const copies = copyTradingService.getUserCopyRelationships(user.id);
    const myMasterRaw = Array.from(db.copyMasters.values()).find(m => m.userId === user.id);
    const myMaster = myMasterRaw ? copyTradingService.computeMasterMetrics(myMasterRaw) : null;
    res.json({ success: true, copies, myMaster });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat portofolio copy trading' });
  }
});

// Authenticated: Start copying a Master Trader with atomic ledger capital isolation
copyTradingRouter.post('/follow', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { masterId, allocationCurrency, amount, stopLossPct, takeProfitPct, maxPerTradePct } =
      req.body || {};

    const relationship = copyTradingService.followMaster(user.id, {
      masterId,
      allocationCurrency,
      amount,
      stopLossPct,
      takeProfitPct,
      maxPerTradePct,
    });

    res.status(201).json({
      success: true,
      message: 'Copy Trading aktif. Modal telah diisolasi ke sleeve copy trading secara atomik.',
      relationship,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal memulai copy trading' });
  }
});

// Authenticated: Pause copy mirroring
copyTradingRouter.post('/pause', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const relationshipId = String(req.body?.relationshipId || '').trim();
    if (!relationshipId) return res.status(400).json({ error: 'relationshipId wajib diisi' });
    const relationship = copyTradingService.pauseCopy(relationshipId, user.id);
    res.json({ success: true, message: 'Copy trading dijeda sementara.', relationship });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menjeda copy trading' });
  }
});

// Authenticated: Resume copy mirroring
copyTradingRouter.post('/resume', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const relationshipId = String(req.body?.relationshipId || '').trim();
    if (!relationshipId) return res.status(400).json({ error: 'relationshipId wajib diisi' });
    const relationship = copyTradingService.resumeCopy(relationshipId, user.id);
    res.json({ success: true, message: 'Copy trading diaktifkan kembali.', relationship });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal melanjutkan copy trading' });
  }
});

// Authenticated: Stop copy trading, liquidate sleeve, settle High-Water Mark share & return to Spot wallet
copyTradingRouter.post('/stop', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const relationshipId = String(req.body?.relationshipId || '').trim();
    if (!relationshipId) return res.status(400).json({ error: 'relationshipId wajib diisi' });
    const result = copyTradingService.stopCopy(relationshipId, user.id, 'Dihentikan oleh pengguna');
    res.json({
      success: true,
      message: 'Copy trading dihentikan. Seluruh posisi dilikuidasi & sisa dana bersih dikembalikan ke Spot Wallet.',
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menghentikan copy trading' });
  }
});

// Authenticated: Apply to become a Verified Master Trader
copyTradingRouter.post('/apply-master', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { name, handle, strategySummary, primaryPair, profitSharePct, minCopyUsdt } = req.body || {};
    const master = copyTradingService.applyAsMaster(user.id, {
      name,
      handle,
      strategySummary,
      primaryPair,
      profitSharePct,
      minCopyUsdt,
    });
    res.status(201).json({
      success: true,
      message: 'Pengajuan Master Trader berhasil dikirim dan sedang menunggu persetujuan Admin.',
      master,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal mengajukan pendaftaran Master Trader' });
  }
});

// Authenticated Master: Execute a real Spot trade signal on Master account -> mirrors immediately to followers
copyTradingRouter.post('/master/signal', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const master = Array.from(db.copyMasters.values()).find(m => m.userId === user.id);
    if (!master) {
      return res.status(403).json({ error: 'Akun Anda belum terdaftar sebagai Master Trader.' });
    }
    const { pairId, side, quantity, price, orderType } = req.body || {};
    if (side !== 'BUY' && side !== 'SELL') {
      return res.status(400).json({ error: 'Side order harus BUY atau SELL.' });
    }
    const result = copyTradingService.executeMasterSignal(master.id, {
      pairId: String(pairId || master.primaryPair),
      side,
      quantity: String(quantity || ''),
      price: price ? String(price) : undefined,
      orderType: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
    });
    res.json({
      success: true,
      message: `Sinyal ${side} berhasil dieksekusi & di-mirror ke ${result.mirroredOrdersCount} pengikut aktif.`,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal mengeksekusi sinyal Master Trader' });
  }
});
