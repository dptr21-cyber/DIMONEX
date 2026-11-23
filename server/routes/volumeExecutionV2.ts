/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/volumeExecutionV2.ts
 * Authenticated REST API for DIMONEX Volume Execution & Liquidity Management Engine V2.
 * Leaves legacy V1 (/api/bot/volume/deploy) completely untouched.
 */

import { Router } from 'express';
import { requireAuthOrHmac } from './bot.js';
import { volumeExecutionV2Service } from '../services/bots/VolumeExecutionV2Service.js';

export const volumeExecutionV2Router = Router();

volumeExecutionV2Router.get('/list', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const roleUpper = String(user.role || '').toUpperCase();
    const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'SUPERADMIN';
    const scopeAll = isAdmin && req.query.scope === 'all';
    const bots = volumeExecutionV2Service.listBotsForUser(user.id, scopeAll);
    res.json(bots);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat daftar bot V2' });
  }
});

volumeExecutionV2Router.get('/:botId', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const roleUpper = String(user.role || '').toUpperCase();
    const bot = volumeExecutionV2Service.reconcileBotState(req.params.botId, user.id, roleUpper);
    res.json(bot);
  } catch (err: any) {
    const msg = err?.message || 'Bot tidak ditemukan';
    res.status(msg.includes('otorisasi') ? 403 : 404).json({ error: msg });
  }
});

volumeExecutionV2Router.post('/deploy', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const body = req.body || {};
    const config = body.config || body;

    const bot = volumeExecutionV2Service.deployBot({
      userId: user.id,
      userEmail: user.email,
      name: body.name,
      idempotencyKey: body.idempotencyKey || req.headers['x-idempotency-key']?.toString(),
      config,
    });

    res.status(201).json({
      success: true,
      message:
        bot.mode === 'SIMULATION'
          ? `Simulasi Engine V2 (${bot.strategy}) berjalan tanpa mutasi ledger.`
          : `Volume Execution Engine V2 (${bot.strategy}) aktif dengan eksekusi order riil.`,
      bot,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal meluncurkan Engine V2' });
  }
});

volumeExecutionV2Router.post('/pause', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const { botId } = req.body || {};
    if (!botId) return res.status(400).json({ error: 'botId wajib diisi.' });
    const bot = volumeExecutionV2Service.pauseBot(botId, user.id, user.role);
    res.json({ success: true, bot });
  } catch (err: any) {
    const msg = err?.message || 'Gagal menjeda bot';
    res.status(msg.includes('otorisasi') ? 403 : 400).json({ error: msg });
  }
});

volumeExecutionV2Router.post('/resume', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const { botId } = req.body || {};
    if (!botId) return res.status(400).json({ error: 'botId wajib diisi.' });
    const bot = volumeExecutionV2Service.resumeBot(botId, user.id, user.role);
    res.json({ success: true, bot });
  } catch (err: any) {
    const msg = err?.message || 'Gagal melanjutkan bot';
    res.status(msg.includes('otorisasi') ? 403 : 400).json({ error: msg });
  }
});

volumeExecutionV2Router.post('/stop', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const { botId } = req.body || {};
    if (!botId) return res.status(400).json({ error: 'botId wajib diisi.' });
    const { bot, cancelledOrdersCount } = volumeExecutionV2Service.stopBot(botId, user.id, user.role);
    res.json({
      success: true,
      message: `Bot dihentikan dan ${cancelledOrdersCount} order terbuka milik bot dibatalkan.`,
      cancelledOrdersCount,
      bot,
    });
  } catch (err: any) {
    const msg = err?.message || 'Gagal menghentikan bot';
    res.status(msg.includes('otorisasi') ? 403 : 400).json({ error: msg });
  }
});

volumeExecutionV2Router.post('/emergency-stop-all', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const result = volumeExecutionV2Service.emergencyStopAllForUser(user.id);
    res.json({
      success: true,
      message: `Emergency stop selesai: ${result.stoppedCount} bot dihentikan, ${result.cancelledOrdersCount} order terbuka dibatalkan.`,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Emergency stop gagal' });
  }
});

volumeExecutionV2Router.post('/:botId/reconcile', requireAuthOrHmac, (req, res) => {
  try {
    const user = (req as any).user;
    const bot = volumeExecutionV2Service.reconcileBotState(req.params.botId, user.id, user.role);
    res.json({ success: true, bot });
  } catch (err: any) {
    const msg = err?.message || 'Rekonsiliasi gagal';
    res.status(msg.includes('otorisasi') ? 403 : 400).json({ error: msg });
  }
});
