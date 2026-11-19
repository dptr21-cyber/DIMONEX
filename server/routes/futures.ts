/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/futures.ts
 * Real Perpetual Futures API Router for DIMONEX.
 */

import { Router } from 'express';
import { requireAuth } from './auth.js';
import { futuresEngine } from '../services/FuturesEngine.js';
import { db } from '../db/database.js';

export const futuresRouter = Router();

// Public: List all active Perpetual Futures Markets (exact decimal metadata & live funding)
futuresRouter.get('/markets', (_req, res) => {
  try {
    const markets = futuresEngine.getFuturesMarkets();
    res.json({ success: true, markets });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat pasar Futures.' });
  }
});

// Authenticated: Get user's live futures positions, resting open limit orders, history & balances
futuresRouter.get('/state', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const state = futuresEngine.getUserFuturesState(user.id);
    const balances = db.getUserAccounts(user.id).map((acc) => ({
      currency: acc.currency,
      balanceAvailable: acc.balanceAvailable,
      balanceLocked: acc.balanceLocked,
      balanceTotal: (BigInt(acc.balanceAvailable) + BigInt(acc.balanceLocked)).toString(),
    }));
    res.json({ success: true, ...state, balances });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat status akun Futures.' });
  }
});

// Authenticated: Place real Perpetual Futures MARKET or LIMIT order
futuresRouter.post('/order', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { pairId, side, orderType, marginMode, leverage, quantity, limitPrice } = req.body;

    if (!pairId || !side || !orderType || !quantity) {
      return res.status(400).json({ error: 'Parameter pairId, side, orderType, dan quantity wajib diisi.' });
    }

    const result = futuresEngine.placeOrder({
      userId: user.id,
      pairId: String(pairId),
      side: side === 'SHORT' ? 'SHORT' : 'LONG',
      orderType: orderType === 'MARKET' ? 'MARKET' : 'LIMIT',
      marginMode: marginMode === 'ISOLATED' ? 'ISOLATED' : 'CROSS',
      leverage: Number(leverage || 10),
      quantity: String(quantity),
      limitPrice: limitPrice !== undefined ? String(limitPrice) : undefined,
    });

    const state = futuresEngine.getUserFuturesState(user.id);
    res.json({
      success: true,
      message: result.executedImmediately
        ? `Posisi ${result.order.side} ${result.order.pairId} dibuka.`
        : `Order Limit ${result.order.side} ${result.order.pairId} ditempatkan di buku order.`,
      ...result,
      ...state,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menempatkan order Futures.' });
  }
});

// Authenticated: Cancel open LIMIT futures order & unlock collateral
futuresRouter.delete('/order/:orderId', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const order = futuresEngine.cancelOrder(user.id, req.params.orderId);
    const state = futuresEngine.getUserFuturesState(user.id);
    res.json({
      success: true,
      message: `Order Limit ${order.pairId} dibatalkan dan margin dibuka kembali.`,
      order,
      ...state,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal membatalkan order Futures.' });
  }
});

// Authenticated: Close open Futures position at live market price & settle realized PnL
futuresRouter.post('/position/:positionId/close', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const position = futuresEngine.closePosition(user.id, req.params.positionId, false);
    const state = futuresEngine.getUserFuturesState(user.id);
    res.json({
      success: true,
      message: `Posisi ${position.side} ${position.pairId} berhasil ditutup di market.`,
      position,
      ...state,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menutup posisi Futures.' });
  }
});
