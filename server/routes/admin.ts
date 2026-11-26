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
import { TradingPair, ExternalWsWhitelistEntry, Asset, AssetStatus, AssetType } from '../db/types.js';
import { priceAggregatorService, parseExternalPairSymbol } from '../services/external/PriceAggregatorService.js';
import { marketWsService } from '../websocket/MarketDataWs.js';
import {
  scheduleDelistMarket,
  cancelScheduledDelistMarket,
  executeDelistMarket,
  relistMarket
} from '../services/MarketLifecycleScheduler.js';
import { earnService } from '../services/earn/EarnService.js';
import { copyTradingService } from '../services/copy/CopyTradingService.js';
import { matchingEngine } from '../engine/MatchingEngine.js';

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
      lastPrice,
      isDelisted,
      delistScheduledAt,
      delistReason
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

    // Apply manual delisting toggle or scheduled delisting date atomically via lifecycle service
    let lifecycleNote = '';
    if (typeof isDelisted === 'boolean') {
      if (isDelisted && !pair.isDelisted) {
        const resDelist = executeDelistMarket(
          pairId,
          adminUser.id,
          adminUser.email,
          delistReason || pair.delistReason || 'Manual delisting oleh admin'
        );
        lifecycleNote = ` · Market di-DELISTING (${resDelist.cancelledOrdersCount} order dibatalkan & direfund, ${resDelist.stoppedBotsCount} bot dihentikan).`;
      } else if (!isDelisted && pair.isDelisted) {
        relistMarket(pairId, adminUser.id, adminUser.email);
        if (isHalted !== undefined && isHalted !== null) {
          const refreshed = db.tradingPairs.get(pairId);
          if (refreshed) {
            refreshed.isHalted = Boolean(isHalted);
            db.tradingPairs.set(pairId, refreshed);
          }
        }
        lifecycleNote = ' · Market diaktifkan kembali (Relisted).';
      }
    }

    const currentPairAfterToggle = db.tradingPairs.get(pairId) || pair;
    if (!currentPairAfterToggle.isDelisted && delistScheduledAt !== undefined) {
      if (delistScheduledAt === null || delistScheduledAt === '' || Number(delistScheduledAt) === 0) {
        if (currentPairAfterToggle.delistScheduledAt) {
          cancelScheduledDelistMarket(pairId, adminUser.id, adminUser.email);
          lifecycleNote += ' · Jadwal delisting dibatalkan.';
        }
      } else {
        const parsedTs = Number(delistScheduledAt);
        if (!Number.isFinite(parsedTs) || parsedTs <= Date.now() + 10000) {
          return res.status(400).json({ error: 'Waktu jadwal delisting harus berada di masa depan (minimal 10 detik dari sekarang).' });
        }
        if (
          currentPairAfterToggle.delistScheduledAt !== parsedTs ||
          (delistReason !== undefined && delistReason !== currentPairAfterToggle.delistReason)
        ) {
          scheduleDelistMarket(
            pairId,
            parsedTs,
            adminUser.id,
            adminUser.email,
            delistReason || currentPairAfterToggle.delistReason || 'Delisting terjadwal oleh admin'
          );
          lifecycleNote += ` · Delisting dijadwalkan pada ${new Date(parsedTs).toLocaleString('id-ID')}.`;
        }
      }
    }

    db.saveToDisk();
    const finalPair = db.tradingPairs.get(pairId) || pair;

    res.json({
      success: true,
      message: `Konfigurasi ${pairId} berhasil diperbarui: Min ${humanMin} ${finalPair.baseCurrency}, Max ${humanMax} ${finalPair.baseCurrency}${lifecycleNote}`,
      pair: finalPair,
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

    const treasuryFeeOverview = earnService.getExchangeFeeAndEarnTreasuryStats();

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
      treasuryFeeSummary: treasuryFeeOverview.summary,
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
        activeOrdersCount: b.depthLiquidityConfig?.activeOrderIds?.length || b.movementDepthConfig?.activeOrderIds?.length || ((b.priceFollowerConfig?.activeBuyOrderId ? 1 : 0) + (b.priceFollowerConfig?.activeSellOrderId ? 1 : 0)) || 0,
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

// 15. Staking / Earn Vaults Institutional Control (Real DB & Double-Entry Custody)
adminRouter.get('/earn/pools', requireAdmin, (_req, res) => {
  try {
    res.json(earnService.listAdminVaults());
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memuat Earn Vaults' });
  }
});

adminRouter.post('/earn/pools', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const vault = earnService.createVault(req.body || {}, adminUser.id);
    res.status(201).json({
      success: true,
      message: `Vault Earn ${vault.name} (${vault.asset}) berhasil dibuat.`,
      pool: vault,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal membuat Earn Vault' });
  }
});

adminRouter.post('/earn/pools/update', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { poolId, vaultId, ...patch } = req.body || {};
    const targetId = String(vaultId || poolId || '').trim();
    if (!targetId) return res.status(400).json({ error: 'poolId / vaultId wajib diisi' });

    const pool = earnService.updateVault(targetId, patch, adminUser.id);
    res.json({
      success: true,
      message: `Vault Earn ${targetId} berhasil diperbarui (APY ${pool.apyPct}%, Status ${pool.status}).`,
      pool,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get('/earn/positions', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(250, Math.max(10, Number(req.query.limit) || 100));
    res.json({ positions: earnService.listAllPositions(limit) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memuat posisi Earn pengguna' });
  }
});

adminRouter.get('/earn/solvency', requireAdmin, (_req, res) => {
  try {
    res.json(earnService.getCustodySolvencyReport());
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memeriksa solvensi Earn Custody' });
  }
});

adminRouter.get('/earn/assets', requireAdmin, (_req, res) => {
  try {
    res.json({ assets: earnService.listActiveAssetsForEarn() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memuat aset Earn' });
  }
});

adminRouter.get('/earn/payouts', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 120));
    res.json({ payouts: earnService.listAdminPayouts(limit) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal memuat riwayat distribusi yield' });
  }
});

adminRouter.post('/earn/positions/:id/unlock', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const positionId = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(positionId)) {
      return res.status(400).json({ error: 'ID posisi tidak valid' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const position = earnService.adminUnlockPosition(positionId, adminUser.id, reason);
    res.json({
      success: true,
      message: `Posisi ${positionId} berhasil dibuka (MATURED) tanpa penalti.`,
      position,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal membuka lockup posisi' });
  }
});

adminRouter.post('/earn/settle-yield', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const forceCycle = Boolean(req.body?.forceCycle);
    const result = earnService.runDailyYieldSettlement(Date.now(), {
      forceCycle,
      actorId: adminUser.id,
    });
    res.json({
      success: true,
      message: `Distribusi imbal hasil selesai: ${result.settledPositions} posisi diproses, ${result.payoutsCreated} pembayaran dicatat.`,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal menjalankan distribusi imbal hasil' });
  }
});

// 15b. Exchange Transaction Fee Revenue & Staking Earn Treasury Funding Monitor
adminRouter.get('/treasury-fees', requireAdmin, (_req, res) => {
  try {
    res.json(earnService.getExchangeFeeAndEarnTreasuryStats());
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memuat laporan fee transaksi dan treasury staking' });
  }
});

adminRouter.post('/treasury-fees/sweep', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const result = earnService.sweepCollectedFeesToTreasury(adminUser.id);
    const overview = earnService.getExchangeFeeAndEarnTreasuryStats();
    res.json({
      success: true,
      ...result,
      overview,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Gagal melakukan sweep fee ke treasury' });
  }
});

// 16. Real Copy Trading Masters Control (Persisted in db.copyMasters)
adminRouter.get('/copy-trading/masters', requireAdmin, (_req, res) => {
  try {
    res.json(copyTradingService.listAdminMasters());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat daftar Master Trader' });
  }
});

adminRouter.post('/copy-trading/masters/update', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { masterId, status, profitShareBps, badge, maxFollowers, riskScore } = req.body || {};
    if (!masterId) return res.status(400).json({ error: 'masterId wajib diisi' });

    const master = copyTradingService.adminUpdateMaster(
      String(masterId),
      { status, profitShareBps, badge, maxFollowers, riskScore },
      adminUser.id
    );

    res.json({
      success: true,
      message: `Master trader ${master.name} berhasil diperbarui (Status: ${master.status}, Profit Share: ${master.profitSharePct}%).`,
      master,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal memperbarui Master Trader' });
  }
});

adminRouter.post('/copy-trading/masters/execute-signal', requireAdmin, (req, res) => {
  try {
    const { masterId, pairId, side, quantity, price, orderType } = req.body || {};
    if (!masterId || !pairId || (side !== 'BUY' && side !== 'SELL') || !quantity) {
      return res.status(400).json({ error: 'masterId, pairId, side (BUY/SELL), dan quantity wajib diisi.' });
    }
    const result = copyTradingService.executeMasterSignal(String(masterId), {
      pairId: String(pairId),
      side,
      quantity: String(quantity),
      price: price ? String(price) : undefined,
      orderType: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
    });
    res.json({
      success: true,
      message: `Sinyal Master ${side} ${quantity} pada ${pairId} tereksekusi (${result.trades.length} matched trade, ${result.mirroredOrdersCount} mirror ke pengikut).`,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal mengeksekusi sinyal Master' });
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

// ============================================================================
// 19. EXTERNAL WEBSOCKET PAIR WHITELIST (Binance & Bybit Spot Curation)
// ============================================================================

adminRouter.get('/external-ws/whitelist', requireAdmin, (req, res) => {
  try {
    const items = Array.from(db.externalWsWhitelist.values()).map(entry => {
      const snap = priceAggregatorService.getSymbolSnapshot(entry.symbol, 'AGGREGATED');
      return {
        ...entry,
        binancePrice: snap.binancePrice,
        bybitPrice: snap.bybitPrice,
        binanceFresh: snap.binanceFresh,
        bybitFresh: snap.bybitFresh
      };
    });

    res.json({
      success: true,
      items,
      feedStatus: {
        binance: {
          status: priceAggregatorService.binance.getConnectionStatus(),
          subscribedCount: priceAggregatorService.binance.getSubscribedSymbols().length,
          subscribedSymbols: priceAggregatorService.binance.getSubscribedSymbols()
        },
        bybit: {
          status: priceAggregatorService.bybit.getConnectionStatus(),
          subscribedCount: priceAggregatorService.bybit.getSubscribedSymbols().length,
          subscribedSymbols: priceAggregatorService.bybit.getSubscribedSymbols()
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/external-ws/catalog', requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();
    const providerFilter = String(req.query.provider || 'ALL').toUpperCase();
    const force = req.query.refresh === '1';

    const catalog = await priceAggregatorService.fetchAvailableCatalog(force);
    let filtered = catalog.items;

    if (providerFilter === 'BINANCE') {
      filtered = filtered.filter(i => i.providers.includes('binance'));
    } else if (providerFilter === 'BYBIT') {
      filtered = filtered.filter(i => i.providers.includes('bybit'));
    }

    if (q) {
      filtered = filtered.filter(i =>
        i.symbol.includes(q) ||
        i.baseAsset.includes(q) ||
        i.quoteAsset.includes(q)
      );
    }

    const whitelistedSet = new Set(Array.from(db.externalWsWhitelist.keys()));
    const limited = filtered.slice(0, 60).map(item => ({
      ...item,
      isWhitelisted: whitelistedSet.has(item.symbol)
    }));

    res.json({
      success: true,
      source: catalog.source,
      fetchedAt: catalog.fetchedAt,
      totalMatches: filtered.length,
      items: limited
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/external-ws/whitelist/add', requireAdmin, async (req, res) => {
  try {
    const adminUser = (req as any).user;
    const rawSymbol = String(req.body?.symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!rawSymbol || rawSymbol.length < 4) {
      return res.status(400).json({ error: 'Simbol pair tidak valid (contoh: SOLUSDT, PEPEUSDT, ETHBTC).' });
    }

    const providersInput = Array.isArray(req.body?.providers) && req.body.providers.length > 0
      ? req.body.providers.filter((p: string) => p === 'binance' || p === 'bybit')
      : ['binance', 'bybit'];
    const providers: ('binance' | 'bybit')[] = providersInput.length > 0 ? providersInput : ['binance', 'bybit'];

    const parsed = parseExternalPairSymbol(rawSymbol);
    const label = req.body?.label
      ? String(req.body.label).trim()
      : `${parsed.baseAsset} / ${parsed.quoteAsset}`;

    const entry: ExternalWsWhitelistEntry = {
      symbol: rawSymbol,
      baseAsset: parsed.baseAsset,
      quoteAsset: parsed.quoteAsset,
      label,
      providers,
      enabled: true,
      addedBy: adminUser?.email || 'ADMIN',
      addedAt: Date.now()
    };

    db.externalWsWhitelist.set(rawSymbol, entry);
    db.saveToDisk();

    // Seed initial price if available from REST catalog & sync live WS streams
    await priceAggregatorService.seedSymbolFromCatalog(rawSymbol, providers);
    priceAggregatorService.syncWhitelistSymbols(
      db.getEnabledExternalWsSymbols('binance'),
      db.getEnabledExternalWsSymbols('bybit')
    );

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser?.id || 'ADMIN',
      action: 'EXTERNAL_WS_WHITELIST_ADDED',
      resource: `ws_pair:${rawSymbol}`,
      details: `Pair ${rawSymbol} (${providers.join(', ')}) ditambahkan ke whitelist WebSocket oleh ${adminUser?.email}`,
      createdAt: Date.now()
    });
    db.scheduleSave();

    res.json({
      success: true,
      message: `Pair ${rawSymbol} ditambahkan ke whitelist & stream WebSocket Binance/Bybit disinkronkan.`,
      entry
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/external-ws/whitelist/toggle', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const rawSymbol = String(req.body?.symbol || '').trim().toUpperCase();
    const entry = db.externalWsWhitelist.get(rawSymbol);
    if (!entry) {
      return res.status(404).json({ error: `Pair ${rawSymbol} tidak ditemukan di whitelist.` });
    }

    entry.enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !entry.enabled;
    if (Array.isArray(req.body?.providers) && req.body.providers.length > 0) {
      const validProvs = req.body.providers.filter((p: string) => p === 'binance' || p === 'bybit');
      if (validProvs.length > 0) entry.providers = validProvs;
    }

    db.externalWsWhitelist.set(rawSymbol, entry);
    db.saveToDisk();

    priceAggregatorService.syncWhitelistSymbols(
      db.getEnabledExternalWsSymbols('binance'),
      db.getEnabledExternalWsSymbols('bybit')
    );

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser?.id || 'ADMIN',
      action: 'EXTERNAL_WS_WHITELIST_TOGGLED',
      resource: `ws_pair:${rawSymbol}`,
      details: `Pair ${rawSymbol} diubah status=${entry.enabled ? 'ENABLED' : 'DISABLED'} oleh ${adminUser?.email}`,
      createdAt: Date.now()
    });
    db.scheduleSave();

    res.json({
      success: true,
      message: `Pair ${rawSymbol} sekarang ${entry.enabled ? 'AKTIF' : 'NONAKTIF'} di WebSocket feed.`,
      entry
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/external-ws/whitelist/remove', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const rawSymbol = String(req.body?.symbol || '').trim().toUpperCase();
    if (!db.externalWsWhitelist.has(rawSymbol)) {
      return res.status(404).json({ error: `Pair ${rawSymbol} tidak ditemukan di whitelist.` });
    }

    db.externalWsWhitelist.delete(rawSymbol);
    db.saveToDisk();

    priceAggregatorService.syncWhitelistSymbols(
      db.getEnabledExternalWsSymbols('binance'),
      db.getEnabledExternalWsSymbols('bybit')
    );

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser?.id || 'ADMIN',
      action: 'EXTERNAL_WS_WHITELIST_REMOVED',
      resource: `ws_pair:${rawSymbol}`,
      details: `Pair ${rawSymbol} dihapus dari whitelist WebSocket oleh ${adminUser?.email}`,
      createdAt: Date.now()
    });
    db.scheduleSave();

    res.json({
      success: true,
      message: `Pair ${rawSymbol} dihapus dari whitelist & di-unsubscribe dari WebSocket.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// CRYPTO ASSET METADATA, LOGO/ICON & DECIMAL MANAGEMENT (ADMIN CONSOLE)
// ============================================================================

function validateAndSanitizeLogoUrl(rawLogo: unknown): string | undefined {
  if (rawLogo === undefined) return undefined;
  const trimmed = String(rawLogo || '').trim();
  if (!trimmed) return '';

  if (trimmed.length > 512000) {
    throw new Error('Ukuran logo terlalu besar (maksimal 500 KB). Kompres atau pilih gambar yang lebih kecil.');
  }

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    if (trimmed.length > 2048) {
      throw new Error('URL logo terlalu panjang (maksimal 2048 karakter).');
    }
    return trimmed;
  }

  const dataUriMatch = trimmed.match(/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i);
  if (dataUriMatch) {
    const mimeSubtype = dataUriMatch[1].toLowerCase();
    if (mimeSubtype === 'svg+xml') {
      const decodedSvg = Buffer.from(dataUriMatch[2], 'base64').toString('utf8');
      if (/<script[\s>]|on[a-z]+\s*=|javascript:/i.test(decodedSvg)) {
        throw new Error('File SVG tidak diizinkan mengandung script atau event handler.');
      }
    }
    return trimmed;
  }

  throw new Error('Format logo tidak valid. Gunakan upload PNG/JPG/WebP/SVG atau URL https://');
}

function validateOptionalHttpUrl(rawUrl: unknown, fieldName: string): string | undefined {
  if (rawUrl === undefined) return undefined;
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`${fieldName} harus diawali dengan https:// atau http://`);
  }
  if (trimmed.length > 1024) {
    throw new Error(`${fieldName} terlalu panjang.`);
  }
  return trimmed;
}

function serializeAdminAsset(asset: Asset) {
  const linkedPairs = Array.from(db.tradingPairs.values())
    .filter(
      p =>
        p.baseCurrency.toUpperCase() === asset.symbol.toUpperCase() ||
        p.quoteCurrency.toUpperCase() === asset.symbol.toUpperCase()
    )
    .map(p => p.id);

  return {
    ...asset,
    logoUrl: asset.logoUrl || '',
    category: asset.category || (asset.network === 'FIAT' ? 'Fiat' : asset.assetType === 'NATIVE' ? 'Layer 1' : 'Token'),
    contractAddress: asset.contractAddress || '',
    description: asset.description || '',
    websiteUrl: asset.websiteUrl || '',
    explorerUrl: asset.explorerUrl || '',
    linkedPairs
  };
}

// GET /api/admin/assets - List all exchange crypto & fiat assets with linked pairs
adminRouter.get('/assets', requireAdmin, (req, res) => {
  try {
    const assets = db.ensureAssetsForTradingPairs()
      .map(serializeAdminAsset)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    res.json({
      success: true,
      count: assets.length,
      assets
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/assets - Register a new crypto asset with logo, metadata & decimals
adminRouter.post('/assets', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const rawSymbol = String(req.body?.symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rawName = String(req.body?.name || '').trim();

    if (!rawSymbol || rawSymbol.length < 2 || rawSymbol.length > 15) {
      return res.status(400).json({ error: 'Simbol aset harus 2–15 karakter alfanumerik (contoh: BTC, SOL, PEPE).' });
    }
    if (!rawName || rawName.length < 2 || rawName.length > 80) {
      return res.status(400).json({ error: 'Nama lengkap aset harus 2–80 karakter.' });
    }

    const existing = Array.from(db.assets.values()).find(
      a => a.symbol.toUpperCase() === rawSymbol
    );
    if (existing) {
      return res.status(409).json({ error: `Aset dengan simbol ${rawSymbol} sudah terdaftar. Gunakan menu Edit Aset.` });
    }

    const decimals = Number(req.body?.decimals ?? 8);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      return res.status(400).json({ error: 'Desimal aset harus berupa bilangan bulat antara 0 sampai 18.' });
    }

    const assetType: AssetType = req.body?.assetType === 'NATIVE' ? 'NATIVE' : 'TOKEN';
    const allowedStatuses: AssetStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED'];
    const status: AssetStatus = allowedStatuses.includes(req.body?.status) ? req.body.status : 'ACTIVE';
    const network = String(req.body?.network || rawSymbol).trim().toUpperCase() || rawSymbol;
    const logoUrl = validateAndSanitizeLogoUrl(req.body?.logoUrl) || '';
    const websiteUrl = validateOptionalHttpUrl(req.body?.websiteUrl, 'Website URL') || '';
    const explorerUrl = validateOptionalHttpUrl(req.body?.explorerUrl, 'Explorer URL') || '';
    const category = String(req.body?.category || (assetType === 'NATIVE' ? 'Layer 1' : 'Token')).trim().slice(0, 40);
    const description = String(req.body?.description || '').trim().slice(0, 1000);
    const contractAddress = String(req.body?.contractAddress || '').trim().slice(0, 160);

    const now = Date.now();
    const newAsset: Asset = {
      id: `ast-${rawSymbol.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`,
      symbol: rawSymbol,
      name: rawName,
      logoUrl,
      assetType,
      category,
      decimals,
      network,
      contractAddress: contractAddress || undefined,
      description: description || undefined,
      websiteUrl: websiteUrl || undefined,
      explorerUrl: explorerUrl || undefined,
      status,
      depositEnabled: req.body?.depositEnabled !== undefined ? Boolean(req.body.depositEnabled) : true,
      withdrawalEnabled: req.body?.withdrawalEnabled !== undefined ? Boolean(req.body.withdrawalEnabled) : true,
      createdAt: now,
      updatedAt: now
    };

    db.deletedAssetSymbols.delete(rawSymbol);
    db.assets.set(newAsset.id, newAsset);
    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser?.id || 'ADMIN',
      action: 'ASSET_CREATED',
      resource: `asset:${newAsset.symbol}`,
      details: `Aset baru ${newAsset.symbol} (${newAsset.name}, ${newAsset.decimals} desimal, network=${newAsset.network}, customLogo=${Boolean(logoUrl)}) ditambahkan oleh ${adminUser?.email}`,
      createdAt: now
    });
    db.saveToDisk();

    const serializedList = Array.from(db.assets.values()).map(serializeAdminAsset);
    marketWsService.broadcastAssetsUpdated(serializedList);

    res.status(201).json({
      success: true,
      message: `Aset ${newAsset.symbol} (${newAsset.name}) berhasil ditambahkan.`,
      asset: serializeAdminAsset(newAsset)
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/admin/assets/:id - Edit asset logo/icon, details, decimals, network & operational flags
adminRouter.put('/assets/:id', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const assetId = req.params.id;
    const asset = db.assets.get(assetId) ||
      Array.from(db.assets.values()).find(a => a.symbol.toUpperCase() === assetId.toUpperCase());

    if (!asset) {
      return res.status(404).json({ error: `Aset ${assetId} tidak ditemukan.` });
    }

    const changes: string[] = [];

    if (req.body?.name !== undefined) {
      const nextName = String(req.body.name).trim();
      if (nextName.length < 2 || nextName.length > 80) {
        return res.status(400).json({ error: 'Nama aset harus 2–80 karakter.' });
      }
      if (nextName !== asset.name) {
        changes.push(`name: "${asset.name}" -> "${nextName}"`);
        asset.name = nextName;
      }
    }

    if (req.body?.logoUrl !== undefined) {
      const sanitizedLogo = validateAndSanitizeLogoUrl(req.body.logoUrl) || '';
      if (sanitizedLogo !== (asset.logoUrl || '')) {
        changes.push(`logoUrl: ${sanitizedLogo ? 'UPDATED' : 'CLEARED'}`);
        asset.logoUrl = sanitizedLogo || undefined;
      }
    }

    if (req.body?.assetType !== undefined) {
      const nextType: AssetType = req.body.assetType === 'NATIVE' ? 'NATIVE' : 'TOKEN';
      if (nextType !== asset.assetType) {
        changes.push(`assetType: ${asset.assetType} -> ${nextType}`);
        asset.assetType = nextType;
      }
    }

    if (req.body?.category !== undefined) {
      const nextCategory = String(req.body.category || '').trim().slice(0, 40);
      if (nextCategory !== (asset.category || '')) {
        changes.push(`category: "${asset.category || ''}" -> "${nextCategory}"`);
        asset.category = nextCategory || undefined;
      }
    }

    if (req.body?.network !== undefined) {
      const nextNetwork = String(req.body.network || '').trim().toUpperCase().slice(0, 40);
      if (!nextNetwork) {
        return res.status(400).json({ error: 'Jaringan (network) tidak boleh kosong.' });
      }
      if (nextNetwork !== asset.network) {
        changes.push(`network: ${asset.network} -> ${nextNetwork}`);
        asset.network = nextNetwork;
      }
    }

    if (req.body?.contractAddress !== undefined) {
      const nextContract = String(req.body.contractAddress || '').trim().slice(0, 160);
      if (nextContract !== (asset.contractAddress || '')) {
        changes.push(`contractAddress updated`);
        asset.contractAddress = nextContract || undefined;
      }
    }

    if (req.body?.description !== undefined) {
      const nextDesc = String(req.body.description || '').trim().slice(0, 1000);
      if (nextDesc !== (asset.description || '')) {
        changes.push(`description updated`);
        asset.description = nextDesc || undefined;
      }
    }

    if (req.body?.websiteUrl !== undefined) {
      const nextWeb = validateOptionalHttpUrl(req.body.websiteUrl, 'Website URL') || '';
      if (nextWeb !== (asset.websiteUrl || '')) {
        changes.push(`websiteUrl updated`);
        asset.websiteUrl = nextWeb || undefined;
      }
    }

    if (req.body?.explorerUrl !== undefined) {
      const nextExplorer = validateOptionalHttpUrl(req.body.explorerUrl, 'Explorer URL') || '';
      if (nextExplorer !== (asset.explorerUrl || '')) {
        changes.push(`explorerUrl updated`);
        asset.explorerUrl = nextExplorer || undefined;
      }
    }

    const syncedPairs: string[] = [];
    if (req.body?.decimals !== undefined) {
      const nextDecimals = Number(req.body.decimals);
      if (!Number.isInteger(nextDecimals) || nextDecimals < 0 || nextDecimals > 18) {
        return res.status(400).json({ error: 'Desimal aset harus berupa bilangan bulat antara 0 sampai 18.' });
      }
      if (nextDecimals !== asset.decimals) {
        changes.push(`decimals: ${asset.decimals} -> ${nextDecimals}`);
        asset.decimals = nextDecimals;

        // Synchronize baseDecimals / quoteDecimals across linked trading pairs so order book & forms stay consistent
        for (const pair of db.tradingPairs.values()) {
          let pairChanged = false;
          if (pair.baseCurrency.toUpperCase() === asset.symbol.toUpperCase()) {
            pair.baseDecimals = nextDecimals;
            pairChanged = true;
          }
          if (pair.quoteCurrency.toUpperCase() === asset.symbol.toUpperCase()) {
            pair.quoteDecimals = nextDecimals;
            pairChanged = true;
          }
          if (pairChanged) {
            syncedPairs.push(pair.id);
          }
        }
      }
    }

    if (req.body?.status !== undefined) {
      const allowedStatuses: AssetStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED'];
      if (!allowedStatuses.includes(req.body.status)) {
        return res.status(400).json({ error: 'Status aset tidak valid.' });
      }
      if (req.body.status !== asset.status) {
        changes.push(`status: ${asset.status} -> ${req.body.status}`);
        asset.status = req.body.status;
      }
    }

    if (req.body?.depositEnabled !== undefined) {
      const nextDep = Boolean(req.body.depositEnabled);
      if (nextDep !== asset.depositEnabled) {
        changes.push(`depositEnabled: ${asset.depositEnabled} -> ${nextDep}`);
        asset.depositEnabled = nextDep;
      }
    }

    if (req.body?.withdrawalEnabled !== undefined) {
      const nextWd = Boolean(req.body.withdrawalEnabled);
      if (nextWd !== asset.withdrawalEnabled) {
        changes.push(`withdrawalEnabled: ${asset.withdrawalEnabled} -> ${nextWd}`);
        asset.withdrawalEnabled = nextWd;
      }
    }

    asset.updatedAt = Date.now();
    db.assets.set(asset.id, asset);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser?.id || 'ADMIN',
      action: 'ASSET_UPDATED',
      resource: `asset:${asset.symbol}`,
      details: `Aset ${asset.symbol} diperbarui oleh ${adminUser?.email}: ${changes.length > 0 ? changes.join('; ') : 'no field changes'}${syncedPairs.length > 0 ? ` | Synced pairs: ${syncedPairs.join(', ')}` : ''}`,
      createdAt: Date.now()
    });
    db.saveToDisk();

    const serializedList = Array.from(db.assets.values()).map(serializeAdminAsset);
    marketWsService.broadcastAssetsUpdated(serializedList);

    res.json({
      success: true,
      message: `Aset ${asset.symbol} (${asset.name}) berhasil diperbarui${syncedPairs.length > 0 ? ` & disinkronkan ke ${syncedPairs.length} pair` : ''}.`,
      asset: serializeAdminAsset(asset),
      syncedPairs
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/assets/:id - Delete a crypto token/asset with dependency safeguard & optional force cleanup
adminRouter.delete('/assets/:id', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const assetId = String(req.params.id || '').trim();
    const asset =
      db.assets.get(assetId) ||
      Array.from(db.assets.values()).find(a => a.symbol.toUpperCase() === assetId.toUpperCase());

    if (!asset) {
      return res.status(404).json({ error: `Aset ${assetId} tidak ditemukan.` });
    }

    const sym = asset.symbol.toUpperCase();
    if (sym === 'IDR') {
      return res.status(400).json({
        error: 'Mata uang dasar IDR tidak dapat dihapus karena merupakan settlement utama bursa.',
      });
    }

    const force =
      req.query.force === '1' ||
      req.query.force === 'true' ||
      Boolean(req.body?.force);

    const linkedPairs = Array.from(db.tradingPairs.values()).filter(
      p => p.baseCurrency.toUpperCase() === sym || p.quoteCurrency.toUpperCase() === sym
    );
    const linkedPairIds = new Set(linkedPairs.map(p => p.id));

    const openOrders = Array.from(db.orders.values()).filter(
      o => linkedPairIds.has(o.pairId) && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
    );

    const activeBots = Array.from(db.botInstances.values()).filter(
      b =>
        linkedPairIds.has(b.pairId) &&
        (b.status === 'RUNNING' || b.status === 'PAUSED' || b.status === 'READY')
    );

    const activeEarnPositions = Array.from(db.earnPositions.values()).filter(
      p => p.asset.toUpperCase() === sym && p.status !== 'REDEEMED'
    );

    const holdersWithBalance = Array.from(db.ledgerAccounts.values()).filter(
      acc =>
        !acc.userId.startsWith('sys-') &&
        acc.currency.toUpperCase() === sym &&
        BigInt(acc.balanceAvailable) + BigInt(acc.balanceLocked) > 0n
    );

    const hasDependencies =
      linkedPairs.length > 0 ||
      openOrders.length > 0 ||
      activeBots.length > 0 ||
      activeEarnPositions.length > 0 ||
      holdersWithBalance.length > 0;

    if (hasDependencies && !force) {
      return res.status(409).json({
        error: `Token ${sym} masih memiliki keterkaitan aktif. Gunakan opsi Hapus Paksa (Force Delete) untuk membersihkan pair & order terbuka secara atomik.`,
        requiresForce: true,
        dependencies: {
          linkedPairs: linkedPairs.map(p => p.id),
          openOrdersCount: openOrders.length,
          activeBotsCount: activeBots.length,
          activeEarnPositionsCount: activeEarnPositions.length,
          holdersCount: holdersWithBalance.length,
        },
      });
    }

    const now = Date.now();
    let cancelledOrdersCount = 0;
    for (const order of openOrders) {
      try {
        matchingEngine.cancelOrder(order.id, order.userId, order.pairId, 'ADMIN');
        cancelledOrdersCount++;
      } catch (err: any) {
        console.warn(`[Admin Delete Asset] Gagal batalkan order ${order.id}:`, err?.message || err);
      }
    }

    let stoppedBotsCount = 0;
    for (const bot of activeBots) {
      bot.status = 'STOPPED';
      bot.stoppedAt = now;
      bot.updatedAt = now;
      bot.lastExecutionResult = `Auto-stopped because asset ${sym} was deleted by admin`;
      db.botInstances.set(bot.id, bot);
      stoppedBotsCount++;
    }

    // Remove linked pairs, markets, and listing requests so asset does not auto-resurrect
    let removedPairsCount = 0;
    for (const pair of linkedPairs) {
      db.tradingPairs.delete(pair.id);
      db.markets.delete(pair.id);
      removedPairsCount++;
    }
    for (const [reqId, lr] of db.listingRequests.entries()) {
      if (lr.assetId === asset.id || lr.quoteAssetId === asset.id) {
        db.listingRequests.delete(reqId);
      }
    }

    // Pause any Earn vaults tied to the deleted token
    for (const vault of db.earnVaults.values()) {
      if (vault.asset.toUpperCase() === sym && vault.status === 'ACTIVE') {
        vault.status = 'PAUSED';
        vault.updatedAt = now;
        db.earnVaults.set(vault.id, vault);
      }
    }

    db.deletedAssetSymbols.add(sym);
    db.assets.delete(asset.id);

    db.auditLogs.push({
      id: crypto.randomUUID(),
      actorId: adminUser?.id || 'ADMIN',
      action: 'ASSET_DELETED',
      resource: `asset:${sym}`,
      details: `Token/Aset ${sym} (${asset.name}) dihapus permanen oleh ${adminUser?.email} (force=${force}, removedPairs=${removedPairsCount}, cancelledOrders=${cancelledOrdersCount}, stoppedBots=${stoppedBotsCount}).`,
      createdAt: now,
    });
    db.saveToDisk();

    const serializedList = Array.from(db.assets.values()).map(serializeAdminAsset);
    marketWsService.broadcastAssetsUpdated(serializedList);
    marketWsService.broadcastTickerSnapshot();

    res.json({
      success: true,
      message: `Token ${sym} (${asset.name}) berhasil dihapus permanen${removedPairsCount > 0 ? ` beserta ${removedPairsCount} pair pasar terkait` : ''}.`,
      deletedSymbol: sym,
      removedPairsCount,
      cancelledOrdersCount,
      stoppedBotsCount,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menghapus aset token' });
  }
});

// ============================================================================
// MARKET DELISTING & RELISTING OPERATIONS (ADMIN CONSOLE)
// ============================================================================

// POST /api/admin/pairs/delist-schedule - Schedule future delisting with live countdown in Chart & Markets
adminRouter.post('/pairs/delist-schedule', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { pairId, delistScheduledAt, reason } = req.body;
    if (!pairId || !delistScheduledAt) {
      return res.status(400).json({ error: 'pairId dan delistScheduledAt wajib diisi.' });
    }
    const pair = scheduleDelistMarket(
      String(pairId),
      Number(delistScheduledAt),
      adminUser?.id || 'ADMIN',
      adminUser?.email,
      reason
    );
    res.json({
      success: true,
      message: `Delisting ${pair.id} dijadwalkan pada ${new Date(pair.delistScheduledAt || 0).toLocaleString('id-ID')}. Countdown timer delisting kini tampil di Market Chart.`,
      pair
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/pairs/delist-cancel - Cancel an upcoming scheduled delisting
adminRouter.post('/pairs/delist-cancel', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { pairId } = req.body;
    if (!pairId) return res.status(400).json({ error: 'pairId wajib diisi.' });
    const pair = cancelScheduledDelistMarket(String(pairId), adminUser?.id || 'ADMIN', adminUser?.email);
    res.json({
      success: true,
      message: `Jadwal delisting untuk ${pair.id} berhasil dibatalkan.`,
      pair
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/pairs/delist-now - Immediately delist market, cancel & refund all resting orders atomically
adminRouter.post('/pairs/delist-now', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { pairId, reason } = req.body;
    if (!pairId) return res.status(400).json({ error: 'pairId wajib diisi.' });
    const result = executeDelistMarket(
      String(pairId),
      adminUser?.id || 'ADMIN',
      adminUser?.email,
      reason
    );
    res.json({
      success: true,
      message: `Market ${result.pair.id} berhasil di-DELISTING. ${result.cancelledOrdersCount} order terbuka dibatalkan & direfund otomatis, ${result.stoppedBotsCount} bot dihentikan.`,
      ...result
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/pairs/relist - Restore a previously delisted market back to active
adminRouter.post('/pairs/relist', requireAdmin, (req, res) => {
  try {
    const adminUser = (req as any).user;
    const { pairId } = req.body;
    if (!pairId) return res.status(400).json({ error: 'pairId wajib diisi.' });
    const pair = relistMarket(String(pairId), adminUser?.id || 'ADMIN', adminUser?.email);
    res.json({
      success: true,
      message: `Market ${pair.id} berhasil diaktifkan kembali (Relisted).`,
      pair
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
