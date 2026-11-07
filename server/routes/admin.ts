/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * admin.ts
 * Admin Panel routes: KYC review, pair listing/halt, fee configuration,
 * withdrawal approvals, and system audit logs.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { requireAdmin } from './auth.js';
import { db } from '../db/database.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { TradingPair } from '../db/types.js';

export const adminRouter = Router();

// 1. Get All Users and KYC Submissions
adminRouter.get('/users', requireAdmin, (req, res) => {
  const usersList = Array.from(db.users.values()).map(u => {
    const kyc = db.kyc.get(u.id);
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      isTotpEnabled: u.isTotpEnabled,
      kycStatus: kyc ? kyc.status : 'unverified',
      kycTier: kyc ? kyc.tierLevel : 0,
      fullName: kyc ? kyc.fullName : '-',
      createdAt: u.createdAt
    };
  });
  res.json(usersList);
});

// 2. Review KYC Submission
adminRouter.post('/kyc/review', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { userId, action, rejectionReason, tierLevel } = req.body;

    const kyc = db.kyc.get(userId);
    if (!kyc) return res.status(404).json({ error: 'Data KYC tidak ditemukan' });

    if (action === 'APPROVE') {
      kyc.status = 'approved';
      kyc.tierLevel = tierLevel || 2;
      kyc.reviewedBy = adminUser.id;
      kyc.reviewedAt = Date.now();
      kyc.rejectionReason = undefined;
    } else {
      kyc.status = 'rejected';
      kyc.rejectionReason = rejectionReason || 'Dokumen identitas tidak terbaca dengan jelas';
      kyc.reviewedBy = adminUser.id;
      kyc.reviewedAt = Date.now();
    }

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: `KYC_${action}`,
      resource: `user:${userId}`,
      details: `KYC marked as ${kyc.status} by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    res.json({ success: true, kyc });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Halt / Resume Trading per Pair
adminRouter.post('/pairs/toggle-halt', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { pairId, isHalted } = req.body;

    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: 'Pair tidak ditemukan' });

    pair.isHalted = Boolean(isHalted);
    db.tradingPairs.set(pairId, pair);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: isHalted ? 'TRADING_HALTED' : 'TRADING_RESUMED',
      resource: `pair:${pairId}`,
      details: `Trading pair ${pairId} halted status changed to: ${isHalted}`,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      message: `Trading pair ${pairId} status: ${isHalted ? 'DIHENTIKAN SEMENTARA (HALTED)' : 'BERJALAN NORMAL'}`,
      pair
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Configure Maker & Taker Fees
adminRouter.post('/pairs/update-fees', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { pairId, makerFeeBps, takerFeeBps } = req.body;

    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: 'Pair tidak ditemukan' });

    if (makerFeeBps !== undefined) pair.makerFeeBps = Number(makerFeeBps);
    if (takerFeeBps !== undefined) pair.takerFeeBps = Number(takerFeeBps);

    db.tradingPairs.set(pairId, pair);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'FEES_UPDATED',
      resource: `pair:${pairId}`,
      details: `Fees updated: Maker ${pair.makerFeeBps} bps (${pair.makerFeeBps / 100}%), Taker ${pair.takerFeeBps} bps (${pair.takerFeeBps / 100}%)`,
      createdAt: Date.now()
    });

    res.json({
      success: true,
      message: `Biaya transaksi ${pairId} berhasil diperbarui: Maker ${pair.makerFeeBps / 100}%, Taker ${pair.takerFeeBps / 100}%`,
      pair
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4b. Configure Token Management & Order Quantity Limits (Min / Max Order Size)
adminRouter.post('/pairs/update-config', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const {
      pairId,
      minOrderSize,
      maxOrderSize,
      minOrderTokens,
      maxOrderTokens,
      makerFeeBps,
      takerFeeBps,
      isHalted,
      lastPrice
    } = req.body;

    if (!pairId) return res.status(400).json({ error: 'ID Trading pair wajib ditentukan' });

    const pair = db.tradingPairs.get(pairId);
    if (!pair) return res.status(404).json({ error: `Trading pair ${pairId} tidak ditemukan` });

    const baseDecimals = pair.baseDecimals || 8;
    let updatedMin = pair.minOrderSize;
    let updatedMax = pair.maxOrderSize;

    // Convert from human token decimals if provided
    if (minOrderTokens !== undefined && minOrderTokens !== null && String(minOrderTokens).trim() !== '') {
      updatedMin = PrecisionMath.parseToUnits(String(minOrderTokens), baseDecimals).toString();
    } else if (minOrderSize !== undefined && minOrderSize !== null && String(minOrderSize).trim() !== '') {
      updatedMin = String(minOrderSize).trim();
    }

    if (maxOrderTokens !== undefined && maxOrderTokens !== null && String(maxOrderTokens).trim() !== '') {
      updatedMax = PrecisionMath.parseToUnits(String(maxOrderTokens), baseDecimals).toString();
    } else if (maxOrderSize !== undefined && maxOrderSize !== null && String(maxOrderSize).trim() !== '') {
      updatedMax = String(maxOrderSize).trim();
    }

    if (BigInt(updatedMin) <= 0n) {
      return res.status(400).json({ error: 'Kuantitas minimum order harus lebih besar dari 0' });
    }
    if (BigInt(updatedMax) < BigInt(updatedMin)) {
      return res.status(400).json({ error: 'Kuantitas maksimum order tidak boleh lebih kecil dari kuantitas minimum' });
    }

    const oldMin = pair.minOrderSize;
    const oldMax = pair.maxOrderSize;

    pair.minOrderSize = updatedMin;
    pair.maxOrderSize = updatedMax;

    if (makerFeeBps !== undefined && makerFeeBps !== null) pair.makerFeeBps = Number(makerFeeBps);
    if (takerFeeBps !== undefined && takerFeeBps !== null) pair.takerFeeBps = Number(takerFeeBps);
    if (isHalted !== undefined && isHalted !== null) pair.isHalted = Boolean(isHalted);
    if (lastPrice !== undefined && lastPrice !== null && String(lastPrice).trim() !== '') {
      pair.lastPrice = String(lastPrice).trim();
    }

    db.tradingPairs.set(pairId, pair);

    // Sync with market record if exists
    const market = db.markets.get(pairId);
    if (market) {
      market.minQuantity = updatedMin;
      if (makerFeeBps !== undefined) market.makerFeeBps = Number(makerFeeBps);
      if (takerFeeBps !== undefined) market.takerFeeBps = Number(takerFeeBps);
      db.markets.set(pairId, market);
    }

    const humanMin = PrecisionMath.formatFromUnits(BigInt(updatedMin), baseDecimals);
    const humanMax = PrecisionMath.formatFromUnits(BigInt(updatedMax), baseDecimals);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'PAIR_CONFIG_UPDATED',
      resource: `pair:${pairId}`,
      details: `Token limits for ${pairId} updated: Min ${humanMin} ${pair.baseCurrency} (${updatedMin} units), Max ${humanMax} ${pair.baseCurrency} (${updatedMax} units) by ${adminUser.email}`,
      createdAt: Date.now()
    });

    db.saveToDisk();

    res.json({
      success: true,
      message: `Konfigurasi kuantitas order ${pairId} berhasil diperbarui: Min ${humanMin} ${pair.baseCurrency}, Max ${humanMax} ${pair.baseCurrency}`,
      pair,
      humanLimits: {
        minTokens: humanMin,
        maxTokens: humanMax,
        baseDecimals
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Get Pending Withdrawals
adminRouter.get('/withdrawals/pending', requireAdmin, (req, res) => {
  const pendingFiat = Array.from(db.fiatTransactions.values()).filter(t => t.type === 'WITHDRAW' && t.status === 'PENDING');
  const pendingCrypto = Array.from(db.cryptoTransactions.values()).filter(t => t.type === 'WITHDRAW' && t.status === 'PENDING');

  res.json({
    fiat: pendingFiat,
    crypto: pendingCrypto
  });
});

// 6. Approve Withdrawal
adminRouter.post('/withdrawals/approve', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { txId, txType } = req.body; // txType: 'FIAT' | 'CRYPTO'

    if (txType === 'FIAT') {
      const tx = db.fiatTransactions.get(txId);
      if (!tx || tx.status !== 'PENDING') return res.status(404).json({ error: 'Transaksi tidak ditemukan atau sudah diproses' });

      // Release locked funds from user account permanently
      const userAcc = db.createOrGetAccount(tx.userId, 'IDR');
      const locked = BigInt(userAcc.balanceLocked);
      const amountUnits = BigInt(tx.amount);
      userAcc.balanceLocked = (locked >= amountUnits ? locked - amountUnits : 0n).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();

      tx.status = 'COMPLETED';
      db.fiatTransactions.set(txId, tx);
    } else {
      const tx = db.cryptoTransactions.get(txId);
      if (!tx || tx.status !== 'PENDING') return res.status(404).json({ error: 'Transaksi kripto tidak ditemukan atau sudah diproses' });

      const userAcc = db.createOrGetAccount(tx.userId, tx.currency);
      const locked = BigInt(userAcc.balanceLocked);
      const amountUnits = BigInt(tx.amount);
      userAcc.balanceLocked = (locked >= amountUnits ? locked - amountUnits : 0n).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();

      tx.status = 'COMPLETED';
      tx.confirmations = 12;
      db.cryptoTransactions.set(txId, tx);
    }

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'WITHDRAWAL_APPROVED',
      resource: `tx:${txId}`,
      details: `Withdrawal approved by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({ success: true, message: 'Penarikan dana berhasil disetujui dan diproses!' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Reject Withdrawal and Refund Locked Balance
adminRouter.post('/withdrawals/reject', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { txId, txType, reason } = req.body;

    if (txType === 'FIAT') {
      const tx = db.fiatTransactions.get(txId);
      if (!tx || tx.status !== 'PENDING') return res.status(404).json({ error: 'Transaksi tidak ditemukan atau sudah diproses' });

      // Return locked funds back to balanceAvailable
      const userAcc = db.createOrGetAccount(tx.userId, 'IDR');
      const locked = BigInt(userAcc.balanceLocked);
      const available = BigInt(userAcc.balanceAvailable);
      const amountUnits = BigInt(tx.amount);

      userAcc.balanceLocked = (locked >= amountUnits ? locked - amountUnits : 0n).toString();
      userAcc.balanceAvailable = (available + amountUnits).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();

      tx.status = 'REJECTED';
      db.fiatTransactions.set(txId, tx);
    } else {
      const tx = db.cryptoTransactions.get(txId);
      if (!tx || tx.status !== 'PENDING') return res.status(404).json({ error: 'Transaksi kripto tidak ditemukan atau sudah diproses' });

      const userAcc = db.createOrGetAccount(tx.userId, tx.currency);
      const locked = BigInt(userAcc.balanceLocked);
      const available = BigInt(userAcc.balanceAvailable);
      const amountUnits = BigInt(tx.amount);

      userAcc.balanceLocked = (locked >= amountUnits ? locked - amountUnits : 0n).toString();
      userAcc.balanceAvailable = (available + amountUnits).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();

      tx.status = 'REJECTED';
      db.cryptoTransactions.set(txId, tx);
    }

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'WITHDRAWAL_REJECTED',
      resource: `tx:${txId}`,
      details: `Withdrawal rejected by admin ${adminUser.email}. Reason: ${reason || 'Pemeriksaan kepatuhan'}. Saldo dikembalikan ke akun pengguna.`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({ success: true, message: 'Penarikan dana ditolak dan saldo berhasil dikembalikan ke akun pengguna.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Get Complete Exchange System Statistics
adminRouter.get('/stats', requireAdmin, (req, res) => {
  try {
    const totalUsers = db.users.size;
    const totalPairs = db.tradingPairs.size;
    const totalOrders = db.orders.size;
    const totalTrades = db.trades.length;
    const totalBots = db.botInstances.size;
    const activeBots = Array.from(db.botInstances.values()).filter(b => b.status === 'RUNNING').length;
    const openOrdersCount = Array.from(db.orders.values()).filter(o => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED').length;

    // 24h Volume IDR
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let volume24hIdr = 0n;
    for (const trade of db.trades.values()) {
      if (trade.createdAt >= oneDayAgo) {
        if (trade.pairId.endsWith('-IDR')) {
          volume24hIdr += (BigInt(trade.price) * BigInt(trade.quantity)) / 100000000n;
        } else {
          // USDT based or other
          volume24hIdr += (BigInt(trade.price) * BigInt(trade.quantity) * 16350n) / 100000000n;
        }
      }
    }

    // Solvency liabilities
    const liabilitiesByCurrency: Record<string, { available: string; locked: string; total: string }> = {};
    for (const acc of db.ledgerAccounts.values()) {
      if (!liabilitiesByCurrency[acc.currency]) {
        liabilitiesByCurrency[acc.currency] = { available: '0', locked: '0', total: '0' };
      }
      const cur = liabilitiesByCurrency[acc.currency];
      const av = BigInt(cur.available) + BigInt(acc.balanceAvailable);
      const lk = BigInt(cur.locked) + BigInt(acc.balanceLocked);
      cur.available = av.toString();
      cur.locked = lk.toString();
      cur.total = (av + lk).toString();
    }

    res.json({
      totalUsers,
      totalPairs,
      totalOrders,
      totalTrades,
      totalBots,
      activeBots,
      openOrdersCount,
      volume24hIdr: volume24hIdr.toString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      liabilitiesByCurrency,
      serverTime: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Update User Role (RBAC)
adminRouter.post('/users/role', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { userId, role } = req.body;

    const validRoles = ['USER', 'MM', 'COMPLIANCE', 'ADMIN', 'SUPERADMIN'];
    const targetRole = String(role || '').toUpperCase();
    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({ error: `Role tidak valid. Pilihan: ${validRoles.join(', ')}` });
    }

    const targetUser = db.users.get(userId);
    if (!targetUser) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    const oldRole = targetUser.role;
    targetUser.role = targetRole as any;
    targetUser.updatedAt = Date.now();
    db.users.set(userId, targetUser);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'USER_ROLE_CHANGED',
      resource: `user:${userId}`,
      details: `User role changed from ${oldRole} to ${targetRole} by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({ success: true, message: `Role pengguna berhasil diubah menjadi ${targetRole}`, user: targetUser });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 10. Emergency Reset 2FA TOTP
adminRouter.post('/users/reset-2fa', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { userId, reason } = req.body;

    const targetUser = db.users.get(userId);
    if (!targetUser) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    targetUser.isTotpEnabled = false;
    targetUser.totpSecret = undefined;
    targetUser.updatedAt = Date.now();
    db.users.set(userId, targetUser);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'USER_2FA_RESET',
      resource: `user:${userId}`,
      details: `2FA TOTP disabled by admin ${adminUser.email}. Alasan: ${reason || 'Permintaan pemulihan akun'}`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({ success: true, message: `2FA TOTP untuk ${targetUser.email} berhasil di-reset.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 11. Create New Trading Pair
adminRouter.post('/pairs/create', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const {
      baseCurrency,
      quoteCurrency,
      baseDecimals = 8,
      quoteDecimals = 2,
      initialPrice = '100000000',
      minOrderTokens,
      maxOrderTokens,
      minOrderSize,
      maxOrderSize,
      makerFeeBps = 10,
      takerFeeBps = 20
    } = req.body;

    if (!baseCurrency || !quoteCurrency) {
      return res.status(400).json({ error: 'Base currency dan Quote currency wajib diisi' });
    }

    const pairId = `${baseCurrency.trim().toUpperCase()}-${quoteCurrency.trim().toUpperCase()}`;
    if (db.tradingPairs.has(pairId)) {
      return res.status(400).json({ error: `Trading pair ${pairId} sudah ada di exchange!` });
    }

    const bDec = Number(baseDecimals);
    const oneToken = 10n ** BigInt(bDec);
    let minUnits = '100000000';
    let maxUnits = (10000000n * (oneToken > 0n ? oneToken : 1n)).toString();

    if (minOrderTokens !== undefined && minOrderTokens !== null && String(minOrderTokens).trim() !== '') {
      minUnits = PrecisionMath.parseToUnits(String(minOrderTokens), bDec).toString();
    } else if (minOrderSize) {
      minUnits = String(minOrderSize).trim();
    }

    if (maxOrderTokens !== undefined && maxOrderTokens !== null && String(maxOrderTokens).trim() !== '') {
      maxUnits = PrecisionMath.parseToUnits(String(maxOrderTokens), bDec).toString();
    } else if (maxOrderSize) {
      maxUnits = String(maxOrderSize).trim();
    }

    const newPair = {
      id: pairId,
      baseCurrency: baseCurrency.trim().toUpperCase(),
      quoteCurrency: quoteCurrency.trim().toUpperCase(),
      baseDecimals: bDec,
      quoteDecimals: Number(quoteDecimals),
      minOrderSize: minUnits,
      maxOrderSize: maxUnits,
      lastPrice: String(initialPrice),
      priceChange24h: '+0.00%',
      priceChangePercent24h: '0.00',
      high24h: String(initialPrice),
      low24h: String(initialPrice),
      volume24h: '0',
      makerFeeBps: Number(makerFeeBps),
      takerFeeBps: Number(takerFeeBps),
      isHalted: false,
      isNewListing: true,
      createdAt: Date.now()
    };

    db.tradingPairs.set(pairId, newPair as any);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'PAIR_CREATED',
      resource: `pair:${pairId}`,
      details: `New trading pair ${pairId} registered by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({ success: true, message: `Pasangan perdagangan ${pairId} berhasil dibuat dan diaktifkan!`, pair: newPair });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Get All Bots Across Platform
adminRouter.get('/bots/all', requireAdmin, (req, res) => {
  try {
    const botsList = Array.from(db.botInstances.values()).map(b => {
      const owner = db.users.get(b.ownerUserId || b.accountId);
      return {
        id: b.id,
        name: b.name,
        botType: b.botType,
        pairId: b.pairId,
        environment: b.environment,
        status: b.status,
        ownerEmail: owner ? owner.email : 'Unknown',
        ownerUserId: b.ownerUserId,
        activeOrdersCount: b.depthLiquidityConfig?.activeOrderIds?.length || ((b.priceFollowerConfig?.activeBuyOrderId ? 1 : 0) + (b.priceFollowerConfig?.activeSellOrderId ? 1 : 0)) || 0,
        stats: b.stats,
        lastHeartbeat: b.lastHeartbeat,
        createdAt: b.createdAt
      };
    });
    res.json(botsList);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Emergency Stop All Bots or Specific Bot
adminRouter.post('/bots/emergency-stop', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { botId } = req.body;

    let stoppedCount = 0;
    if (botId) {
      const b = db.botInstances.get(botId);
      if (b && b.status === 'RUNNING') {
        b.status = 'STOPPED';
        b.updatedAt = Date.now();
        stoppedCount++;
      }
    } else {
      // Emergency halt ALL running bots
      for (const b of db.botInstances.values()) {
        if (b.status === 'RUNNING') {
          b.status = 'STOPPED';
          b.updatedAt = Date.now();
          stoppedCount++;
        }
      }
    }

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'BOTS_EMERGENCY_STOP',
      resource: botId ? `bot:${botId}` : 'bots:all',
      details: `Emergency stop triggered by admin ${adminUser.email}. Total bots stopped: ${stoppedCount}`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({ success: true, message: `Emergency stop berhasil: ${stoppedCount} bot dihentikan seketika.` });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 14. Immutable Double-Entry Ledger Adjustment
adminRouter.post('/ledger/adjust-balance', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { userId, currency, amountUnits, direction, reason } = req.body;
    // direction: 'CREDIT' | 'DEBIT'

    if (!userId || !currency || !amountUnits || !direction) {
      return res.status(400).json({ error: 'Parameter tidak lengkap (userId, currency, amountUnits, direction wajib diisi)' });
    }

    const units = BigInt(amountUnits);
    if (units <= 0n) return res.status(400).json({ error: 'Jumlah penyesuaian harus lebih besar dari 0' });

    const userAcc = db.createOrGetAccount(userId, currency);
    const treasuryAcc = db.createOrGetAccount('usr-sys-treasury-reserve-000001', currency);

    const userAvail = BigInt(userAcc.balanceAvailable);
    const treasuryAvail = BigInt(treasuryAcc.balanceAvailable);

    if (direction === 'CREDIT') {
      // Credit user, Debit treasury
      userAcc.balanceAvailable = (userAvail + units).toString();
      treasuryAcc.balanceAvailable = (treasuryAvail >= units ? treasuryAvail - units : 0n).toString();
    } else {
      // Debit user, Credit treasury
      if (userAvail < units) {
        return res.status(400).json({ error: `Saldo pengguna tidak mencukupi untuk didebit sebesar ${units.toString()} units.` });
      }
      userAcc.balanceAvailable = (userAvail - units).toString();
      treasuryAcc.balanceAvailable = (treasuryAvail + units).toString();
    }

    userAcc.version += 1;
    userAcc.updatedAt = Date.now();
    treasuryAcc.version += 1;
    treasuryAcc.updatedAt = Date.now();

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'LEDGER_ADJUSTMENT',
      resource: `account:${userAcc.id}`,
      details: `Balance adjustment: ${direction} ${units.toString()} units of ${currency} for user ${userId}. Reason: ${reason || 'Koreksi administratif bursa'}. Double-entry balanced via Treasury reserve.`,
      createdAt: Date.now()
    });

    db.saveToDisk();
    res.json({
      success: true,
      message: `Penyesuaian saldo ${direction} sebesar ${units.toString()} ${currency} berhasil dicatat dalam buku besar.`,
      newBalance: userAcc.balanceAvailable
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Staking / Earn Products Control
const defaultEarnPools = [
  { id: 'pool-idr-flex', asset: 'IDR', apy: 6.5, durationDays: 0, status: 'ACTIVE', minStake: '10000000', totalStaked: '25000000000' },
  { id: 'pool-btc-30', asset: 'BTC', apy: 4.2, durationDays: 30, status: 'ACTIVE', minStake: '100000', totalStaked: '1250000000' },
  { id: 'pool-eth-60', asset: 'ETH', apy: 5.8, durationDays: 60, status: 'ACTIVE', minStake: '1000000', totalStaked: '4800000000' },
  { id: 'pool-usdt-90', asset: 'USDT', apy: 11.5, durationDays: 90, status: 'ACTIVE', minStake: '1000000', totalStaked: '150000000000' }
];

adminRouter.get('/earn/pools', requireAdmin, (req, res) => {
  res.json(defaultEarnPools);
});

adminRouter.post('/earn/pools/update', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { poolId, apy, status } = req.body;

    const pool = defaultEarnPools.find(p => p.id === poolId);
    if (!pool) return res.status(404).json({ error: 'Staking pool tidak ditemukan' });

    if (apy !== undefined) pool.apy = Number(apy);
    if (status !== undefined) pool.status = status;

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'EARN_POOL_UPDATED',
      resource: `pool:${poolId}`,
      details: `Staking pool ${poolId} updated: APY ${pool.apy}%, Status ${pool.status} by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    res.json({ success: true, message: `Staking pool ${poolId} berhasil diperbarui!`, pool });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 16. Copy Trading Masters Control
const defaultMasters = [
  { id: 'trader-apex', name: 'ApexQuant Master', asset: 'BTC/IDR', roi30d: 48.2, winRate: 78.5, maxDrawdown: 6.2, followers: 412, profitShareBps: 1000, status: 'APPROVED' },
  { id: 'trader-crypto-king', name: 'CryptoKing ID', asset: 'ETH/IDR', roi30d: 32.8, winRate: 71.0, maxDrawdown: 8.5, followers: 289, profitShareBps: 1200, status: 'APPROVED' },
  { id: 'trader-scalper-pro', name: 'ScalperPro 24/7', asset: 'SOL/IDR', roi30d: 64.5, winRate: 65.4, maxDrawdown: 12.1, followers: 580, profitShareBps: 1500, status: 'APPROVED' }
];

adminRouter.get('/copy-trading/masters', requireAdmin, (req, res) => {
  res.json(defaultMasters);
});

adminRouter.post('/copy-trading/masters/update', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { masterId, status, profitShareBps } = req.body;

    const master = defaultMasters.find(m => m.id === masterId);
    if (!master) return res.status(404).json({ error: 'Master trader tidak ditemukan' });

    if (status !== undefined) master.status = status;
    if (profitShareBps !== undefined) master.profitShareBps = Number(profitShareBps);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'COPY_MASTER_UPDATED',
      resource: `master:${masterId}`,
      details: `Master trader ${masterId} updated: Status ${master.status}, Profit Share ${master.profitShareBps / 100}% by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    res.json({ success: true, message: `Master trader ${masterId} berhasil diperbarui!`, master });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 17. VIP Tier Schedule
const defaultVipTiers = [
  { tier: 0, minVolumeIdr: '0', makerFeeBps: 10, takerFeeBps: 20 },
  { tier: 1, minVolumeIdr: '100000000', makerFeeBps: 8, takerFeeBps: 18 },
  { tier: 2, minVolumeIdr: '500000000', makerFeeBps: 6, takerFeeBps: 15 },
  { tier: 3, minVolumeIdr: '2000000000', makerFeeBps: 4, takerFeeBps: 12 },
  { tier: 4, minVolumeIdr: '10000000000', makerFeeBps: 2, takerFeeBps: 8 },
  { tier: 5, minVolumeIdr: '50000000000', makerFeeBps: 0, takerFeeBps: 5 }
];

adminRouter.get('/vip-tiers', requireAdmin, (req, res) => {
  res.json(defaultVipTiers);
});

adminRouter.post('/vip-tiers/update', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { tier, makerFeeBps, takerFeeBps } = req.body;

    const t = defaultVipTiers.find(x => x.tier === Number(tier));
    if (!t) return res.status(404).json({ error: 'VIP Tier tidak ditemukan' });

    if (makerFeeBps !== undefined) t.makerFeeBps = Number(makerFeeBps);
    if (takerFeeBps !== undefined) t.takerFeeBps = Number(takerFeeBps);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser.id,
      action: 'VIP_TIER_UPDATED',
      resource: `vip:tier_${tier}`,
      details: `VIP Tier ${tier} fees updated: Maker ${t.makerFeeBps} bps, Taker ${t.takerFeeBps} bps by admin ${adminUser.email}`,
      createdAt: Date.now()
    });

    res.json({ success: true, message: `VIP Tier ${tier} berhasil diperbarui!`, tier: t });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 18. Get Audit Logs
adminRouter.get('/audit-logs', requireAdmin, (req, res) => {
  res.json(db.auditLogs.slice(-200).reverse());
});
