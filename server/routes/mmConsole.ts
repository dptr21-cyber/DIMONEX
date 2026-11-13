/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * mmConsole.ts
 * Authenticated Market Maker (MM) Console Router for DIMONEX.
 * Endpoints for Order Bots, Volume Bots, Instance Cloning, CSV Import/Export, and Risk Controls.
 */

import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { requireAuth, requireMM, requireAdmin } from './auth.js';
import { AuthService } from '../auth/AuthService.js';
import { db } from '../db/database.js';
import { botWorkerManager } from '../services/BotWorkerManager.js';
import { BotInstance, OrderBotConfig, VolumeBotConfig, PriceFollowerConfig, DepthLiquidityConfig, QuantHftConfig, SmartHftLadderConfig, AdvancedMarketMakerConfig, PatternFormationType, PatternTimeframe, Environment } from '../db/types.js';
import { priceAggregatorService } from '../services/external/PriceAggregatorService.js';
import { fxConversionService } from '../services/external/FxConversionService.js';
import { DepthLiquidityBotExecutor } from '../services/bots/DepthLiquidityBot.js';
import { PriceFollowerBotExecutor } from '../services/bots/PriceFollowerBot.js';
import { SmartHftLadderBotExecutor } from '../services/bots/SmartHftLadderBot.js';
import { AdvancedMarketMakerBotExecutor } from '../services/bots/AdvancedMarketMakerBot.js';
import { timeframeAnalyticsService } from '../services/analytics/TimeframeAnalyticsService.js';
import { portfolioRebalanceService } from '../services/rebalance/PortfolioRebalanceService.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { engineTelemetry } from '../engine/EngineTelemetry.js';

export const mmConsoleRouter = Router();

// Middleware: User must be authenticated (User, MM, or Admin)
const requireMMOrAdmin = (req: Request, res: Response, next: Function) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = AuthService.authenticateToken(token);
    if (user) {
      (req as any).user = user;
      (req as any).token = token;
      return next();
    }
  }

  // Graceful fallback for MM Console: use seeded MM operator
  const mmUser = db.users.get('usr-mm-0000-0000-000000000001') ||
                 Array.from(db.users.values()).find(u => (u.role || '').toUpperCase() === 'MM' || (u.role || '').toUpperCase() === 'ADMIN');
  if (mmUser) {
    (req as any).user = mmUser;
    return next();
  }

  return res.status(401).json({ error: 'Otorisasi diperlukan: Token tidak ditemukan' });
};

// 1. Get MM Console Overview
mmConsoleRouter.get('/overview', requireMMOrAdmin, (req, res) => {
  const user = (req as any).user;
  const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';

  const allBots = Array.from(db.botInstances.values()).filter(b => isSuper || b.ownerUserId === user.id);

  let activeBotsCount = 0;
  let totalSubmitted = 0;
  let totalFilled = 0;
  let totalVolumeBaseUnits = 0n;
  let totalTradesCount = 0;

  const botOrderIds = new Set<string>();
  allBots.forEach(b => {
    if (b.status === 'RUNNING') activeBotsCount++;
    totalSubmitted += b.stats.ordersSubmitted;
    totalFilled += b.stats.ordersFilled;
    totalVolumeBaseUnits += BigInt(b.stats.executedVolume || '0');
    totalTradesCount += b.stats.totalTrades;
    b.deployedOrderIds.forEach(id => botOrderIds.add(id));
  });

  // Calculate 24h trading volume generated specifically by bots in IDR quote units
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let bot24hVolumeQuoteUnits = 0n;
  let bot24hTradesCount = 0;

  for (const trade of db.trades) {
    if (trade.createdAt >= dayAgo) {
      const isBotTrade =
        botOrderIds.has(trade.makerOrderId) ||
        botOrderIds.has(trade.takerOrderId) ||
        trade.makerUserId?.startsWith('bot-') ||
        trade.takerUserId?.startsWith('bot-') ||
        trade.makerUserId === user.id ||
        trade.takerUserId === user.id;

      if (isBotTrade) {
        bot24hTradesCount++;
        const pair = db.tradingPairs.get(trade.pairId);
        const baseDec = pair ? pair.baseDecimals : 8;
        const tradeVal = (BigInt(trade.price) * BigInt(trade.quantity)) / (10n ** BigInt(baseDec));
        bot24hVolumeQuoteUnits += tradeVal;
      }
    }
  }

  // Collect balance of MM user
  const mmAccounts = db.getUserAccounts(user.id);

  res.json({
    totalBots: allBots.length,
    activeBots: activeBotsCount,
    ordersSubmitted: totalSubmitted,
    ordersFilled: totalFilled,
    executedVolumeBaseUnits: totalVolumeBaseUnits.toString(),
    bot24hVolumeQuoteUnits: bot24hVolumeQuoteUnits.toString(),
    bot24hVolumeFormattedIdr: PrecisionMath.formatIDRDisplay(bot24hVolumeQuoteUnits),
    bot24hTradesCount,
    totalTrades: totalTradesCount,
    killSwitchActive: db.riskControls.isKillSwitchActive,
    riskControls: db.riskControls,
    balances: mmAccounts
  });
});

// 2. List Bot Instances with optional filters
mmConsoleRouter.get('/instances', requireMMOrAdmin, (req, res) => {
  const user = (req as any).user;
  const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';

  const { environment, botType, status, pairId } = req.query;

  let bots = Array.from(db.botInstances.values()).filter(b => isSuper || b.ownerUserId === user.id);

  if (environment) bots = bots.filter(b => b.environment === environment);
  if (botType) bots = bots.filter(b => b.botType === botType);
  if (status) bots = bots.filter(b => b.status === status);
  if (pairId) bots = bots.filter(b => b.pairId === pairId);

  bots.sort((a, b) => b.createdAt - a.createdAt);
  res.json(bots);
});

// 3. Create Order Bot Instance
mmConsoleRouter.post('/order-bot/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      account_id,
      price_source,
      price_decimal,
      quantity_decimal,
      random_min_quantity,
      random_max_quantity,
      order_count,
      expire_time,
      transaction_type,
      split_order_mode,
      split_range,
      buy_trailing_min_percentage,
      buy_trailing_max_percentage,
      sell_trailing_min_percentage,
      sell_trailing_max_percentage,
      buy_min_price_limit,
      buy_max_price_limit,
      sell_min_price_limit,
      sell_max_price_limit,
      jitter_timing_pct,
      jitter_price_pct
    } = req.body;

    if (!name || !pairId || !transaction_type || !random_min_quantity || !random_max_quantity) {
      return res.status(400).json({ error: 'Field konfigurasi Order Bot belum lengkap.' });
    }

    const orderBotConfig: OrderBotConfig = {
      account_id: account_id || user.id,
      price_source: price_source || 'MIDPOINT',
      price_decimal: Number(price_decimal || 2),
      quantity_decimal: Number(quantity_decimal || 8),
      random_min_quantity: String(random_min_quantity),
      random_max_quantity: String(random_max_quantity),
      order_count: Math.max(0, parseInt(String(order_count ?? 0), 10)),
      expire_time: parseInt(String(expire_time || 0), 10),
      transaction_type: transaction_type === 'SELL' ? 'SELL' : 'BUY',
      split_order_mode: split_order_mode === 'RANDOM_SPLIT' ? 'RANDOM_SPLIT' : 'NONE',
      split_range: String(split_range || '3'),
      buy_trailing_min_percentage: String(buy_trailing_min_percentage || '0.1'),
      buy_trailing_max_percentage: String(buy_trailing_max_percentage || '0.5'),
      sell_trailing_min_percentage: String(sell_trailing_min_percentage || '0.1'),
      sell_trailing_max_percentage: String(sell_trailing_max_percentage || '0.5'),
      buy_min_price_limit: String(buy_min_price_limit || ''),
      buy_max_price_limit: String(buy_max_price_limit || ''),
      sell_min_price_limit: String(sell_min_price_limit || ''),
      sell_max_price_limit: String(sell_max_price_limit || ''),
      jitter_timing_pct: Number(jitter_timing_pct || 10),
      jitter_price_pct: Number(jitter_price_pct || 2)
    };

    const botId = `bot-ord-${crypto.randomUUID().slice(0, 8)}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'ORDER_BOT',
      pairId,
      environment: (environment as Environment) || 'DEMO',
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      orderBotConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    botWorkerManager.addLog(bot, `Bot dibuat oleh ${user.email} (Status: READY, Environment: ${bot.environment}).`);
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Create Volume Bot Instance
mmConsoleRouter.post('/volume-bot/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      account_id,
      volume_price_decimal,
      volume_quantity_decimal,
      volume_random_min_quantity,
      volume_random_max_quantity,
      min_delay,
      max_delay,
      min_difference,
      max_difference,
      priority,
      max_limit_price,
      min_limit_price,
      vol_idr_stop_target,
      vol_idr_start_threshold,
      volume_sell_account_id
    } = req.body;

    if (!name || !pairId || !volume_random_min_quantity || !volume_random_max_quantity || !vol_idr_stop_target) {
      return res.status(400).json({ error: 'Field konfigurasi Volume Bot belum lengkap.' });
    }

    const volumeBotConfig: VolumeBotConfig = {
      account_id: account_id || user.id,
      volume_price_decimal: Number(volume_price_decimal || 2),
      volume_quantity_decimal: Number(volume_quantity_decimal || 8),
      volume_random_min_quantity: String(volume_random_min_quantity),
      volume_random_max_quantity: String(volume_random_max_quantity),
      min_delay: Math.max(1, parseInt(String(min_delay || 2), 10)),
      max_delay: Math.max(2, parseInt(String(max_delay || 5), 10)),
      min_difference: String(min_difference || '0.01'),
      max_difference: String(max_difference || '0.05'),
      priority: priority || 'RANDOM',
      max_limit_price: String(max_limit_price || '200000000000'),
      min_limit_price: String(min_limit_price || '100000000000'),
      vol_idr_stop_target: String(vol_idr_stop_target),
      vol_idr_start_threshold: String(vol_idr_start_threshold || '0'),
      volume_sell_account_id: volume_sell_account_id || undefined
    };

    const botId = `bot-vol-${crypto.randomUUID().slice(0, 8)}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'VOLUME_BOT',
      pairId,
      environment: (environment as Environment) || 'DEMO',
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      volumeBotConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    botWorkerManager.addLog(bot, `Volume Bot dibuat oleh ${user.email} (Target: IDR ${vol_idr_stop_target}).`);
    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Clone Bot Instance (Phase 8: Independent configuration, new bot ID, isolated state)
mmConsoleRouter.post('/instance/clone', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const { sourceBotId, newName, transaction_type, overrides } = req.body;

    const sourceBot = db.botInstances.get(sourceBotId);
    if (!sourceBot) {
      return res.status(404).json({ error: 'Source bot tidak ditemukan.' });
    }

    const clonedId = `bot-${sourceBot.botType.toLowerCase().slice(0, 3)}-${crypto.randomUUID().slice(0, 8)}`;
    
    // Deep clone configurations and apply any custom overrides (e.g. BUY -> SELL)
    const clonedOrderConfig: OrderBotConfig | undefined = sourceBot.orderBotConfig
      ? {
          ...JSON.parse(JSON.stringify(sourceBot.orderBotConfig)),
          ...(overrides?.orderBotConfig || {})
        }
      : undefined;

    if (clonedOrderConfig) {
      if (transaction_type === 'BUY' || transaction_type === 'SELL') {
        clonedOrderConfig.transaction_type = transaction_type;
      }
    }

    const clonedVolumeConfig: VolumeBotConfig | undefined = sourceBot.volumeBotConfig
      ? {
          ...JSON.parse(JSON.stringify(sourceBot.volumeBotConfig)),
          ...(overrides?.volumeBotConfig || {})
        }
      : undefined;

    const clonedPfConfig: PriceFollowerConfig | undefined = sourceBot.priceFollowerConfig
      ? {
          ...JSON.parse(JSON.stringify(sourceBot.priceFollowerConfig)),
          ...(overrides?.priceFollowerConfig || {}),
          activeBuyOrderId: undefined,
          activeSellOrderId: undefined,
          lastRepriceTimestamp: undefined
        }
      : undefined;

    const clonedDlConfig: DepthLiquidityConfig | undefined = sourceBot.depthLiquidityConfig
      ? {
          ...JSON.parse(JSON.stringify(sourceBot.depthLiquidityConfig)),
          ...(overrides?.depthLiquidityConfig || {}),
          activeOrderIds: [],
          lastRepriceTimestamp: undefined
        }
      : undefined;

    const clonedQuantHftConfig: QuantHftConfig | undefined = sourceBot.quantHftConfig
      ? {
          ...JSON.parse(JSON.stringify(sourceBot.quantHftConfig)),
          ...(overrides?.quantHftConfig || {}),
          activeOrderIds: []
        }
      : undefined;

    const clonedBot: BotInstance = {
      id: clonedId,
      name: newName || `${sourceBot.name} (Clone)`,
      botType: sourceBot.botType,
      pairId: overrides?.pairId || sourceBot.pairId,
      environment: overrides?.environment || sourceBot.environment,
      ownerUserId: user.id,
      accountId: user.id,
      version: 1,
      status: 'READY', // Ready to start immediately
      lastHeartbeat: Date.now(),
      orderBotConfig: clonedOrderConfig,
      volumeBotConfig: clonedVolumeConfig,
      priceFollowerConfig: clonedPfConfig,
      depthLiquidityConfig: clonedDlConfig,
      quantHftConfig: clonedQuantHftConfig,
      gridConfig: sourceBot.gridConfig ? JSON.parse(JSON.stringify(sourceBot.gridConfig)) : undefined,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Bot dikloning dari ${sourceBot.name} (${sourceBot.id}) oleh ${user.email} (Type: ${clonedOrderConfig?.transaction_type || sourceBot.botType}).`,
          type: 'INFO'
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.botInstances.set(clonedBot.id, clonedBot);
    db.scheduleSave();

    res.json({
      success: true,
      message: `Berhasil mengkloning bot ke ${clonedBot.name} (${clonedBot.id}).`,
      bot: clonedBot
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5b. Update Bot Configuration Endpoint
mmConsoleRouter.post('/instance/:id/update', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

    if (bot.status === 'RUNNING') {
      return res.status(400).json({ error: 'Hentikan (Stop/Pause) bot terlebih dahulu sebelum mengubah konfigurasi.' });
    }

    const { name, pairId, environment, orderBotConfig, volumeBotConfig } = req.body;
    if (name) bot.name = name;
    if (pairId) bot.pairId = pairId;
    if (environment) bot.environment = environment;

    if (orderBotConfig) {
      bot.orderBotConfig = {
        ...bot.orderBotConfig,
        ...orderBotConfig,
        account_id: orderBotConfig.account_id || bot.accountId,
        transaction_type: orderBotConfig.transaction_type === 'SELL' ? 'SELL' : 'BUY',
        price_source: orderBotConfig.price_source || 'MIDPOINT',
        price_decimal: Number(orderBotConfig.price_decimal || 2),
        quantity_decimal: Number(orderBotConfig.quantity_decimal || 8),
        random_min_quantity: String(orderBotConfig.random_min_quantity),
        random_max_quantity: String(orderBotConfig.random_max_quantity),
        order_count: Math.max(0, parseInt(String(orderBotConfig.order_count ?? 0), 10)),
        expire_time: parseInt(String(orderBotConfig.expire_time || 0), 10),
        split_order_mode: orderBotConfig.split_order_mode === 'RANDOM_SPLIT' ? 'RANDOM_SPLIT' : 'NONE',
        split_range: String(orderBotConfig.split_range || '3'),
        buy_trailing_min_percentage: String(orderBotConfig.buy_trailing_min_percentage || '0.1'),
        buy_trailing_max_percentage: String(orderBotConfig.buy_trailing_max_percentage || '0.5'),
        sell_trailing_min_percentage: String(orderBotConfig.sell_trailing_min_percentage || '0.1'),
        sell_trailing_max_percentage: String(orderBotConfig.sell_trailing_max_percentage || '0.5'),
        buy_min_price_limit: String(orderBotConfig.buy_min_price_limit || ''),
        buy_max_price_limit: String(orderBotConfig.buy_max_price_limit || ''),
        sell_min_price_limit: String(orderBotConfig.sell_min_price_limit || ''),
        sell_max_price_limit: String(orderBotConfig.sell_max_price_limit || ''),
        jitter_timing_pct: Number(orderBotConfig.jitter_timing_pct || 10),
        jitter_price_pct: Number(orderBotConfig.jitter_price_pct || 2)
      };
    }

    if (volumeBotConfig) {
      bot.volumeBotConfig = {
        ...bot.volumeBotConfig,
        ...volumeBotConfig,
        account_id: volumeBotConfig.account_id || bot.accountId,
        volume_price_decimal: Number(volumeBotConfig.volume_price_decimal || 2),
        volume_quantity_decimal: Number(volumeBotConfig.volume_quantity_decimal || 8),
        volume_random_min_quantity: String(volumeBotConfig.volume_random_min_quantity),
        volume_random_max_quantity: String(volumeBotConfig.volume_random_max_quantity),
        min_delay: Math.max(1, parseInt(String(volumeBotConfig.min_delay || 2), 10)),
        max_delay: Math.max(2, parseInt(String(volumeBotConfig.max_delay || 5), 10)),
        min_difference: String(volumeBotConfig.min_difference || '0.01'),
        max_difference: String(volumeBotConfig.max_difference || '0.05'),
        priority: volumeBotConfig.priority || 'RANDOM',
        max_limit_price: String(volumeBotConfig.max_limit_price || '200000000000'),
        min_limit_price: String(volumeBotConfig.min_limit_price || '100000000000'),
        vol_idr_stop_target: String(volumeBotConfig.vol_idr_stop_target),
        vol_idr_start_threshold: String(volumeBotConfig.vol_idr_start_threshold || '0'),
        volume_sell_account_id: volumeBotConfig.volume_sell_account_id || undefined
      };
    }

    if (req.body.priceFollowerConfig) {
      bot.priceFollowerConfig = {
        ...bot.priceFollowerConfig,
        ...req.body.priceFollowerConfig,
        account_id: req.body.priceFollowerConfig.account_id || bot.accountId
      };
    }

    if (req.body.depthLiquidityConfig) {
      bot.depthLiquidityConfig = {
        ...bot.depthLiquidityConfig,
        ...req.body.depthLiquidityConfig,
        account_id: req.body.depthLiquidityConfig.account_id || bot.accountId
      };
    }

    if (req.body.quantHftConfig) {
      bot.quantHftConfig = {
        ...bot.quantHftConfig,
        ...req.body.quantHftConfig
      };
    }

    bot.version += 1;
    bot.status = 'READY';
    bot.updatedBy = user.email;
    bot.updatedAt = Date.now();
    botWorkerManager.addLog(bot, `Konfigurasi bot diperbarui (v${bot.version}) oleh ${user.email}.`, 'INFO');

    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, message: `Konfigurasi bot ${bot.name} berhasil diperbarui.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Validate Bot Configuration
mmConsoleRouter.post('/instance/:id/validate', requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

  const result = botWorkerManager.validateConfig(bot);
  if (result.isValid) {
    bot.status = 'READY';
    botWorkerManager.addLog(bot, 'Validasi konfigurasi berhasil: Siap dijalankan.', 'INFO');
  } else {
    bot.status = 'ERROR';
    bot.errorInfo = result.errors.join('; ');
    botWorkerManager.addLog(bot, `Validasi gagal: ${bot.errorInfo}`, 'ERROR');
  }
  db.scheduleSave();

  res.json({ success: result.isValid, errors: result.errors, bot });
});

// 7. Start Bot
mmConsoleRouter.post('/instance/:id/start', requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

  const validation = botWorkerManager.validateConfig(bot);
  if (!validation.isValid) {
    const errorDetails = validation.errors.join('; ');
    return res.status(400).json({ 
      error: `Konfigurasi tidak valid: ${errorDetails}`, 
      details: validation.errors 
    });
  }

  const started = botWorkerManager.startWorker(bot.id);
  if (!started) {
    return res.status(400).json({ error: bot.errorInfo || 'Gagal memulai worker bot.' });
  }

  res.json({ success: true, message: `Bot ${bot.name} berhasil dijalankan.`, bot });
});

// 8. Pause Bot
mmConsoleRouter.post('/instance/:id/pause', requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

  const paused = botWorkerManager.pauseWorker(bot.id);
  res.json({ success: paused, bot });
});

// 9. Resume Bot
mmConsoleRouter.post('/instance/:id/resume', requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

  const started = botWorkerManager.startWorker(bot.id);
  res.json({ success: started, bot });
});

// 10. Stop Bot
mmConsoleRouter.post('/instance/:id/stop', requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

  const cancelOpen = req.body.cancelOpenOrders !== false;
  const result = botWorkerManager.stopWorker(bot.id, cancelOpen);
  res.json({ success: result.success, cancelledOrders: result.cancelledOrdersCount, bot });
});

// 11. Get Bot Logs
mmConsoleRouter.get('/instance/:id/logs', requireMMOrAdmin, (req, res) => {
  const bot = db.botInstances.get(req.params.id);
  if (!bot) {
    return res.json([]);
  }

  res.json(bot.logs || []);
});

// 11b. Delete / Remove Bot Instance
mmConsoleRouter.post('/instance/:id/delete', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) {
      // If already deleted or absent, return success so UI client removes it from view
      return res.json({
        success: true,
        message: `Bot (${req.params.id}) sudah tidak ada atau telah dihapus sebelumnya.`
      });
    }

    const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';
    if (!isSuper && bot.ownerUserId !== user.id) {
      return res.status(403).json({ error: 'Akses ditolak: Anda hanya dapat menghapus bot milik Anda sendiri.' });
    }

    const result = botWorkerManager.deleteBot(bot.id, user.email);
    res.json({
      success: true,
      message: `Bot "${result.botName}" (${bot.id}) berhasil dihapus dan ${result.cancelledOrdersCount} order terbuka dibatalkan.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

mmConsoleRouter.delete('/instance/:id', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) {
      return res.json({
        success: true,
        message: `Bot (${req.params.id}) sudah tidak ada atau telah dihapus sebelumnya.`
      });
    }

    const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';
    if (!isSuper && bot.ownerUserId !== user.id) {
      return res.status(403).json({ error: 'Akses ditolak: Anda hanya dapat menghapus bot milik Anda sendiri.' });
    }

    const result = botWorkerManager.deleteBot(bot.id, user.email);
    res.json({
      success: true,
      message: `Bot "${result.botName}" (${bot.id}) berhasil dihapus dan ${result.cancelledOrdersCount} order terbuka dibatalkan.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 11bb. Force Liquidity / Price Refresh
mmConsoleRouter.post('/instance/:id/refresh-liquidity', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const bot = db.botInstances.get(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot tidak ditemukan' });

    if (bot.botType === 'DEPTH_LIQUIDITY' && bot.depthLiquidityConfig) {
      bot.depthLiquidityConfig.last_refresh_timestamp = 0;
      bot.depthLiquidityConfig.lastRepriceTimestamp = 0;
      botWorkerManager.addLog(bot, `⚡ Trigger manual refresh likuiditas oleh ${user.email}. Melakukan kalkulasi ulang rungs & micro-jitter...`, 'INFO');
      const executed = DepthLiquidityBotExecutor.executeCycle(bot, (b, msg, type) => {
        botWorkerManager.addLog(b, msg, type);
      });
      db.scheduleSave();
      return res.json({
        success: true,
        executed,
        message: `Likuiditas bot ${bot.name} berhasil disegarkan secara instan dengan randomisasi tick baru.`,
        bot
      });
    } else if (bot.botType === 'PRICE_FOLLOWER' && bot.priceFollowerConfig) {
      bot.priceFollowerConfig.lastRepriceTimestamp = 0;
      botWorkerManager.addLog(bot, `⚡ Trigger manual refresh harga referensi oleh ${user.email}.`, 'INFO');
      const executed = PriceFollowerBotExecutor.executeCycle(bot, (b, msg, type) => {
        botWorkerManager.addLog(b, msg, type);
      });
      db.scheduleSave();
      return res.json({
        success: true,
        executed,
        message: `Harga bot ${bot.name} berhasil disinkronkan secara instan.`,
        bot
      });
    }

    res.json({ success: true, message: `Bot ${bot.name} tidak memiliki konfigurasi ladder depth.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 11c. Get Combined Activity Logs for All Bots & System
mmConsoleRouter.get('/activity-all', requireMMOrAdmin, (req, res) => {
  const user = (req as any).user;
  const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';

  const userBots = Array.from(db.botInstances.values()).filter(b => isSuper || b.ownerUserId === user.id);
  const combinedLogs: Array<{
    timestamp: number;
    botId?: string;
    botName?: string;
    botType?: string;
    message: string;
    type: string;
  }> = [];

  // Add individual bot logs
  for (const bot of userBots) {
    for (const log of bot.logs || []) {
      combinedLogs.push({
        timestamp: log.timestamp,
        botId: bot.id,
        botName: bot.name,
        botType: bot.botType,
        message: log.message,
        type: log.type
      });
    }
  }

  // Add system audit logs related to bots and kill switches
  for (const audit of db.auditLogs) {
    if (audit.action.includes('BOT') || audit.action.includes('KILL_SWITCH') || audit.resource.includes('bot-')) {
      combinedLogs.push({
        timestamp: audit.createdAt,
        botId: audit.resource,
        botName: 'Risk Controller / Sistem',
        botType: 'SYSTEM',
        message: `[${audit.action}] ${audit.details} (Aktor: ${audit.actorId})`,
        type: audit.action.includes('KILL_SWITCH') ? 'RISK' : 'INFO'
      });
    }
  }

  combinedLogs.sort((a, b) => b.timestamp - a.timestamp);
  res.json(combinedLogs.slice(0, 300));
});

// 12. Get Orders of All Bots
mmConsoleRouter.get('/orders', requireMMOrAdmin, (req, res) => {
  const user = (req as any).user;
  const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';

  const userBots = Array.from(db.botInstances.values()).filter(b => isSuper || b.ownerUserId === user.id);
  const botOrderIds = new Set<string>();
  userBots.forEach(b => b.deployedOrderIds.forEach(id => botOrderIds.add(id)));

  const botOrders = Array.from(db.orders.values())
    .filter(o => botOrderIds.has(o.id) || (o.clientOrderId && o.clientOrderId.startsWith('bot-')))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200);

  res.json(botOrders);
});

// 13. Get Executed Trades from Bots
mmConsoleRouter.get('/trades', requireMMOrAdmin, (req, res) => {
  const user = (req as any).user;
  const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';

  const userBots = Array.from(db.botInstances.values()).filter(b => isSuper || b.ownerUserId === user.id);
  const botOrderIds = new Set<string>();
  userBots.forEach(b => b.deployedOrderIds.forEach(id => botOrderIds.add(id)));

  const botTrades = db.trades
    .filter(t => botOrderIds.has(t.makerOrderId) || botOrderIds.has(t.takerOrderId))
    .slice(-100)
    .reverse();

  res.json(botTrades);
});

// 14. Risk Controls
mmConsoleRouter.get('/risk-controls', requireMMOrAdmin, (req, res) => {
  res.json(db.riskControls);
});

mmConsoleRouter.post('/risk-controls/update', requireAdmin, (req, res) => {
  try {
    const updates = req.body;
    db.riskControls = {
      ...db.riskControls,
      ...updates
    };
    db.scheduleSave();
    res.json({ success: true, message: 'Risk controls berhasil diperbarui', riskControls: db.riskControls });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 15. Emergency Kill-Switch
mmConsoleRouter.post('/kill-switch', requireMMOrAdmin, (req, res) => {
  const result = botWorkerManager.triggerEmergencyKillSwitch();
  res.json({
    success: true,
    message: `EMERGENCY KILL-SWITCH DIAKTIFKAN: ${result.haltedBots} bot dihentikan, ${result.cancelledOrders} order terbuka dibatalkan.`,
    result
  });
});

mmConsoleRouter.post('/kill-switch/reset', requireMMOrAdmin, (req, res) => {
  botWorkerManager.resetEmergencyKillSwitch();
  res.json({ success: true, message: 'Emergency Kill-Switch berhasil di-reset.' });
});

// 16. CSV Import Preview & Validation (Phase 11)
mmConsoleRouter.post('/csv/import-preview', requireMMOrAdmin, (req, res) => {
  try {
    const { csvContent, botType } = req.body;
    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ error: 'Konten CSV tidak boleh kosong.' });
    }

    const lines = csvContent.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV harus memiliki baris header dan minimal 1 baris data.' });
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const parsedRows: any[] = [];
    const errors: { row: number; field: string; error: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const rowLine = lines[i];
      const cols = rowLine.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));

      if (cols.length < headers.length) {
        errors.push({ row: i, field: 'row', error: `Jumlah kolom tidak sesuai: diharapkan ${headers.length}, ada ${cols.length}` });
        continue;
      }

      const rowObj: any = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cols[idx];
      });

      // Basic field validation
      if (!rowObj.name) errors.push({ row: i, field: 'name', error: 'Nama bot wajib diisi' });
      if (!rowObj.pairId && !rowObj.pair) errors.push({ row: i, field: 'pairId', error: 'Trading pair wajib diisi' });

      parsedRows.push({
        rowNumber: i,
        data: rowObj,
        isValid: !errors.some(e => e.row === i)
      });
    }

    res.json({
      totalRows: lines.length - 1,
      validRowsCount: parsedRows.filter(r => r.isValid).length,
      rows: parsedRows,
      errors
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 17. CSV Import Confirm
mmConsoleRouter.post('/csv/import-confirm', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const { rows, defaultBotType, defaultEnvironment } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Tidak ada baris data valid untuk diimpor.' });
    }

    const createdBots: BotInstance[] = [];

    for (const r of rows) {
      const data = r.data || r;
      const bType = data.botType || defaultBotType || 'ORDER_BOT';
      const botId = `bot-${bType.toLowerCase().slice(0, 3)}-${crypto.randomUUID().slice(0, 8)}`;

      let orderCfg: OrderBotConfig | undefined;
      let volCfg: VolumeBotConfig | undefined;

      if (bType === 'ORDER_BOT') {
        orderCfg = {
          account_id: data.account_id || user.id,
          price_source: data.price_source || 'MIDPOINT',
          price_decimal: Number(data.price_decimal || 2),
          quantity_decimal: Number(data.quantity_decimal || 8),
          random_min_quantity: String(data.random_min_quantity || '0.01'),
          random_max_quantity: String(data.random_max_quantity || '0.05'),
          order_count: parseInt(String(data.order_count || 10), 10),
          expire_time: parseInt(String(data.expire_time || 0), 10),
          transaction_type: (data.transaction_type || 'BUY').toUpperCase() as any,
          split_order_mode: data.split_order_mode || 'NONE',
          split_range: String(data.split_range || '3'),
          buy_trailing_min_percentage: String(data.buy_trailing_min_percentage || '0.1'),
          buy_trailing_max_percentage: String(data.buy_trailing_max_percentage || '0.5'),
          sell_trailing_min_percentage: String(data.sell_trailing_min_percentage || '0.1'),
          sell_trailing_max_percentage: String(data.sell_trailing_max_percentage || '0.5'),
          buy_max_price_limit: String(data.buy_max_price_limit || ''),
          sell_min_price_limit: String(data.sell_min_price_limit || ''),
          jitter_timing_pct: Number(data.jitter_timing_pct || 10),
          jitter_price_pct: Number(data.jitter_price_pct || 2)
        };
      } else {
        volCfg = {
          account_id: data.account_id || user.id,
          volume_price_decimal: Number(data.volume_price_decimal || 2),
          volume_quantity_decimal: Number(data.volume_quantity_decimal || 8),
          volume_random_min_quantity: String(data.volume_random_min_quantity || '0.01'),
          volume_random_max_quantity: String(data.volume_random_max_quantity || '0.05'),
          min_delay: parseInt(String(data.min_delay || 2), 10),
          max_delay: parseInt(String(data.max_delay || 5), 10),
          min_difference: String(data.min_difference || '0.01'),
          max_difference: String(data.max_difference || '0.05'),
          priority: data.priority || 'RANDOM',
          max_limit_price: String(data.max_limit_price || '200000000000'),
          min_limit_price: String(data.min_limit_price || '100000000000'),
          vol_idr_stop_target: String(data.vol_idr_stop_target || '1000000000'),
          vol_idr_start_threshold: String(data.vol_idr_start_threshold || '0')
        };
      }

      const bot: BotInstance = {
        id: botId,
        name: data.name || `Imported ${bType} ${createdBots.length + 1}`,
        botType: bType,
        pairId: data.pairId || data.pair || 'BTC-IDR',
        environment: (data.environment as Environment) || defaultEnvironment || 'DEMO',
        ownerUserId: user.id,
        accountId: user.id,
        version: 1,
        status: 'DRAFT', // Never auto-activated on import per spec
        lastHeartbeat: Date.now(),
        orderBotConfig: orderCfg,
        volumeBotConfig: volCfg,
        stats: {
          ordersSubmitted: 0,
          ordersAccepted: 0,
          ordersFilled: 0,
          executedVolume: '0',
          totalTrades: 0
        },
        deployedOrderIds: [],
        logs: [
          {
            timestamp: Date.now(),
            message: `Bot berhasil diimpor dari file CSV (Status: DRAFT).`,
            type: 'INFO'
          }
        ],
        createdBy: user.email,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      db.botInstances.set(bot.id, bot);
      createdBots.push(bot);
    }

    db.scheduleSave();
    res.json({
      success: true,
      message: `Berhasil mengimpor ${createdBots.length} bot konfigurasi (status DRAFT).`,
      importedCount: createdBots.length,
      bots: createdBots
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 18. CSV Export
mmConsoleRouter.get('/csv/export', requireMMOrAdmin, (req, res) => {
  const user = (req as any).user;
  const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';
  const typeFilter = req.query.botType as string || 'ORDER_BOT';

  const bots = Array.from(db.botInstances.values())
    .filter(b => (isSuper || b.ownerUserId === user.id) && b.botType === typeFilter);

  if (typeFilter === 'ORDER_BOT') {
    const headers = [
      'id', 'name', 'pairId', 'environment', 'account_id', 'price_source', 'price_decimal', 'quantity_decimal',
      'random_min_quantity', 'random_max_quantity', 'order_count', 'expire_time', 'transaction_type',
      'split_order_mode', 'split_range', 'buy_trailing_min_percentage', 'buy_trailing_max_percentage',
      'sell_trailing_min_percentage', 'sell_trailing_max_percentage', 'buy_max_price_limit', 'sell_min_price_limit',
      'jitter_timing_pct', 'jitter_price_pct'
    ];

    const rows = bots.map(b => {
      const c = b.orderBotConfig || {} as any;
      return [
        b.id,
        `"${b.name}"`,
        b.pairId,
        b.environment,
        c.account_id || b.ownerUserId,
        c.price_source || 'MIDPOINT',
        c.price_decimal || 2,
        c.quantity_decimal || 8,
        c.random_min_quantity || '0.01',
        c.random_max_quantity || '0.05',
        c.order_count || 10,
        c.expire_time || 0,
        c.transaction_type || 'BUY',
        c.split_order_mode || 'NONE',
        c.split_range || '3',
        c.buy_trailing_min_percentage || '0.1',
        c.buy_trailing_max_percentage || '0.5',
        c.sell_trailing_min_percentage || '0.1',
        c.sell_trailing_max_percentage || '0.5',
        c.buy_max_price_limit || '',
        c.sell_min_price_limit || '',
        c.jitter_timing_pct || 10,
        c.jitter_price_pct || 2
      ].join(',');
    });

    const csvOutput = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dimonex_order_bots.csv"');
    res.send(csvOutput);
  } else {
    const headers = [
      'id', 'name', 'pairId', 'environment', 'account_id', 'volume_price_decimal', 'volume_quantity_decimal',
      'volume_random_min_quantity', 'volume_random_max_quantity', 'min_delay', 'max_delay', 'min_difference',
      'max_difference', 'priority', 'max_limit_price', 'min_limit_price', 'vol_idr_stop_target',
      'vol_idr_start_threshold', 'volume_sell_account_id'
    ];

    const rows = bots.map(b => {
      const c = b.volumeBotConfig || {} as any;
      return [
        b.id,
        `"${b.name}"`,
        b.pairId,
        b.environment,
        c.account_id || b.ownerUserId,
        c.volume_price_decimal || 2,
        c.volume_quantity_decimal || 8,
        c.volume_random_min_quantity || '0.01',
        c.volume_random_max_quantity || '0.05',
        c.min_delay || 2,
        c.max_delay || 5,
        c.min_difference || '0.01',
        c.max_difference || '0.05',
        c.priority || 'RANDOM',
        c.max_limit_price || '',
        c.min_limit_price || '',
        c.vol_idr_stop_target || '1000000000',
        c.vol_idr_start_threshold || '0',
        c.volume_sell_account_id || ''
      ].join(',');
    });

    const csvOutput = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dimonex_volume_bots.csv"');
    res.send(csvOutput);
  }
});

// ============================================================================
// 19. EXTERNAL PRICE FEEDS & MULTI-EXCHANGE AGGREGATOR
// ============================================================================
mmConsoleRouter.get('/external-feeds', requireMMOrAdmin, (req, res) => {
  try {
    const status = priceAggregatorService.getProvidersStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

mmConsoleRouter.post('/external-feeds/reconnect', requireMMOrAdmin, async (req, res) => {
  try {
    const { provider } = req.body;
    if (provider === 'binance' || !provider) {
      await priceAggregatorService.binance.reconnect();
    }
    if (provider === 'bybit' || !provider) {
      await priceAggregatorService.bybit.reconnect();
    }
    res.json({ success: true, message: `Permintaan reconnect provider ${provider || 'semua'} berhasil dikirim.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

mmConsoleRouter.post('/external-feeds/config', requireMMOrAdmin, (req, res) => {
  try {
    const updated = priceAggregatorService.updateConfig(req.body);
    res.json({ success: true, message: 'Konfigurasi Price Aggregator berhasil diperbarui.', config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// 20. USDT/IDR FX CONVERSION ENGINE
// ============================================================================
mmConsoleRouter.get('/fx-rate', requireMMOrAdmin, (req, res) => {
  try {
    const currentRate = fxConversionService.getCurrentRate();
    const history = fxConversionService.getAuditHistory();
    const config = fxConversionService.getConfig();
    const btcRef = priceAggregatorService.getReferencePrice('BTC-IDR');
    const ethRef = priceAggregatorService.getReferencePrice('ETH-IDR');
    const usdtRef = priceAggregatorService.getReferencePrice('USDT-IDR');

    const btcUsdtPrice = btcRef?.effectiveUsdtPrice || 94850;
    const ethUsdtPrice = ethRef?.effectiveUsdtPrice || 2840;
    const solUsdtPrice = 174.50;

    res.json({
      success: true,
      currentRate,
      history,
      config,
      spotFormulas: {
        'BTC-IDR': fxConversionService.convertSpotPair('BTC', btcUsdtPrice),
        'ETH-IDR': fxConversionService.convertSpotPair('ETH', ethUsdtPrice),
        'SOL-IDR': fxConversionService.convertSpotPair('SOL', solUsdtPrice)
      },
      referencePrices: {
        'BTC-IDR': btcRef,
        'ETH-IDR': ethRef,
        'USDT-IDR': usdtRef
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

mmConsoleRouter.post('/fx-rate/config', requireAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const { syncIntervalMinutes, isManualLocked } = req.body;
    const config = fxConversionService.updateConfig({ syncIntervalMinutes, isManualLocked }, user.email);
    res.json({
      success: true,
      message: `Pengaturan interval kurs FX berhasil diperbarui (Interval: ${config.syncIntervalMinutes}m, Kunci Manual: ${config.isManualLocked}).`,
      config
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

mmConsoleRouter.post('/fx-rate/update', requireAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const { newRate, notes, validityHours, confirmOutOfBand } = req.body;

    if (!newRate) {
      return res.status(400).json({ error: 'Nilai kurs newRate wajib diisi.' });
    }

    const result = fxConversionService.updateManualRate(
      parseFloat(newRate),
      user.email,
      notes,
      parseInt(String(validityHours || 24), 10),
      Boolean(confirmOutOfBand)
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: `Kurs USDT/IDR berhasil diperbarui menjadi Rp ${result.rateRecord?.rate.toLocaleString('id-ID')}. Kunci manual diaktifkan.`,
      rateRecord: result.rateRecord,
      config: fxConversionService.getConfig()
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 20c. Sync FX Rate with CoinMarketCap (with Interval & Quota Protection)
mmConsoleRouter.post('/fx-rate/sync-cmc', requireMMOrAdmin, async (req, res) => {
  try {
    const user = (req as any).user;
    const { validityHours, force } = req.body;

    // Call live API to get real USDT/IDR price with cache saver support
    const result = await fxConversionService.fetchAndSyncLiveRate(
      user.email,
      parseInt(String(validityHours || 6), 10),
      Boolean(force)
    );

    if (!result.success || !result.rateRecord) {
      return res.status(502).json({ error: result.error || 'Gagal memanggil API harga live USDT/IDR.' });
    }

    res.json({
      success: true,
      cached: result.cached,
      source: result.source,
      message: result.cached
        ? (result.message || 'Menggunakan kurs ter-cache dari interval sebelumnya (Hemat Kuota API).')
        : `Kurs USDT/IDR berhasil disinkronkan dari ${result.source || 'API'} menjadi Rp ${result.rateRecord.rate.toLocaleString('id-ID')}.`,
      rateRecord: result.rateRecord,
      config: fxConversionService.getConfig()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 21. CREATE PRICE FOLLOWER BOT
// ============================================================================
mmConsoleRouter.post('/price-follower/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      account_id,
      reference_provider,
      reference_price_source,
      reference_price_mode,
      target_spread_bps,
      buy_offset_bps,
      sell_offset_bps,
      order_quantity,
      minimum_reprice_interval_ms,
      minimum_price_change_bps,
      maximum_price_deviation_bps,
      maximum_order_quantity,
      maximum_order_value_idr,
      maximum_open_orders,
      maximum_inventory,
      maximum_daily_turnover_idr,
      maximum_daily_loss_idr,
      maximum_cancel_replace_rate,
      max_data_age_ms,
      tick_size,
      lot_size,
      dry_run
    } = req.body;

    if (!name || !pairId || !order_quantity) {
      return res.status(400).json({ error: 'Nama bot, pair, dan kuantitas order wajib diisi.' });
    }

    const priceFollowerConfig: PriceFollowerConfig = {
      account_id: account_id || user.id,
      market_symbol: pairId,
      reference_provider: reference_provider || 'AGGREGATED',
      reference_price_source: reference_price_source || 'MIDPOINT',
      reference_price_mode: reference_price_mode || 'STATIC_OFFSET',
      target_spread_bps: Number(target_spread_bps || 40),
      buy_offset_bps: Number(buy_offset_bps || 20),
      sell_offset_bps: Number(sell_offset_bps || 20),
      order_quantity: String(order_quantity),
      minimum_reprice_interval_ms: Number(minimum_reprice_interval_ms || 2000),
      minimum_price_change_bps: Number(minimum_price_change_bps || 5),
      maximum_price_deviation_bps: Number(maximum_price_deviation_bps || 300),
      maximum_order_quantity: String(maximum_order_quantity || '1.0'),
      maximum_order_value_idr: String(maximum_order_value_idr || '100000000'),
      maximum_open_orders: Number(maximum_open_orders || 2),
      maximum_inventory: String(maximum_inventory || '5.0'),
      maximum_daily_turnover_idr: String(maximum_daily_turnover_idr || '500000000'),
      maximum_daily_loss_idr: String(maximum_daily_loss_idr || '25000000'),
      maximum_cancel_replace_rate: Number(maximum_cancel_replace_rate || 5),
      max_data_age_ms: Number(max_data_age_ms || 5000),
      tick_size: Number(tick_size || 1000),
      lot_size: String(lot_size || '0.0001'),
      enabled: true,
      dry_run: Boolean(dry_run)
    };

    const botId = `bot-fol-${crypto.randomUUID().slice(0, 8)}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'PRICE_FOLLOWER',
      pairId,
      environment: (environment as Environment) || 'DEMO',
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      priceFollowerConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Price Follower Bot dibuat oleh ${user.email} (Provider: ${priceFollowerConfig.reference_provider}, Buy Offset: ${priceFollowerConfig.buy_offset_bps} bps, Sell Offset: ${priceFollowerConfig.sell_offset_bps} bps).`,
          type: 'INFO'
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, message: `Price Follower Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// 22. CREATE DEPTH & LIQUIDITY BOT
// ============================================================================
mmConsoleRouter.post('/depth-liquidity/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      account_id,
      price_mode,
      reference_price_source,
      min_limit_buy_price,
      max_limit_buy_price,
      min_limit_sell_price,
      max_limit_sell_price,
      spacing_mode,
      level_spacing_idr,
      anti_stacking_enabled,
      number_of_bid_levels,
      number_of_ask_levels,
      bid_level_offsets_bps,
      ask_level_offsets_bps,
      bid_quantities,
      ask_quantities,
      quantity_randomization_enabled,
      random_min_quantity,
      random_max_quantity,
      minimum_reprice_interval_ms,
      minimum_price_change_bps,
      maximum_open_orders,
      maximum_total_bid_value_idr,
      maximum_total_ask_quantity,
      maximum_inventory,
      maximum_order_value_idr,
      max_data_age_ms,
      tick_size,
      lot_size,
      dry_run,
      liquidity_refresh_cooldown_sec,
      randomize_placement_enabled,
      price_randomization_ticks
    } = req.body;

    if (!name || !pairId) {
      return res.status(400).json({ error: 'Nama bot dan pair wajib diisi.' });
    }

    const defaultTick = pairId === 'USDT-IDR' ? 1 : pairId === 'ETH-IDR' ? 100 : 1000;
    const finalTick = (tick_size && (pairId !== 'USDT-IDR' || tick_size <= 50)) ? Number(tick_size) : defaultTick;
    const defaultSpacing = pairId === 'USDT-IDR' ? 60 : pairId === 'ETH-IDR' ? 100000 : 1000000;

    const isCustom = price_mode === 'CUSTOM_BOUNDS';

    const depthLiquidityConfig: DepthLiquidityConfig = {
      account_id: account_id || user.id,
      market_symbol: pairId,
      price_mode: isCustom ? 'CUSTOM_BOUNDS' : 'EXTERNAL_REFERENCE',
      reference_price_source: isCustom ? 'NONE' : (reference_price_source || 'AGGREGATED'),
      min_limit_buy_price: isCustom && min_limit_buy_price !== undefined ? String(min_limit_buy_price) : undefined,
      max_limit_buy_price: isCustom && max_limit_buy_price !== undefined ? String(max_limit_buy_price) : undefined,
      min_limit_sell_price: isCustom && min_limit_sell_price !== undefined ? String(min_limit_sell_price) : undefined,
      max_limit_sell_price: isCustom && max_limit_sell_price !== undefined ? String(max_limit_sell_price) : undefined,
      spacing_mode: spacing_mode || (isCustom ? 'LINEAR' : (pairId === 'USDT-IDR' ? 'FIXED_IDR' : 'PERCENT_BPS')),
      level_spacing_idr: Number(level_spacing_idr || defaultSpacing),
      anti_stacking_enabled: anti_stacking_enabled !== undefined ? Boolean(anti_stacking_enabled) : true,
      number_of_bid_levels: Number(number_of_bid_levels || 5),
      number_of_ask_levels: Number(number_of_ask_levels || 5),
      bid_level_offsets_bps: Array.isArray(bid_level_offsets_bps) ? bid_level_offsets_bps : [10, 25, 50, 80, 120],
      ask_level_offsets_bps: Array.isArray(ask_level_offsets_bps) ? ask_level_offsets_bps : [10, 25, 50, 80, 120],
      bid_quantities: Array.isArray(bid_quantities) ? bid_quantities : (pairId === 'USDT-IDR' ? ['25.0', '50.0', '75.0', '100.0', '150.0'] : ['0.02', '0.05', '0.10', '0.15', '0.20']),
      ask_quantities: Array.isArray(ask_quantities) ? ask_quantities : (pairId === 'USDT-IDR' ? ['25.0', '50.0', '75.0', '100.0', '150.0'] : ['0.02', '0.05', '0.10', '0.15', '0.20']),
      quantity_randomization_enabled: Boolean(quantity_randomization_enabled),
      random_min_quantity: String(random_min_quantity || (pairId === 'USDT-IDR' ? '5.0' : '0.01')),
      random_max_quantity: String(random_max_quantity || (pairId === 'USDT-IDR' ? '25.0' : '0.05')),
      minimum_reprice_interval_ms: Number(minimum_reprice_interval_ms || 3000),
      minimum_price_change_bps: Number(minimum_price_change_bps || 10),
      maximum_open_orders: Number(maximum_open_orders || 40),
      maximum_total_bid_value_idr: String(maximum_total_bid_value_idr || '500000000'),
      maximum_total_ask_quantity: String(maximum_total_ask_quantity || '500.0'),
      maximum_inventory: String(maximum_inventory || '1000.0'),
      maximum_order_value_idr: String(maximum_order_value_idr || '100000000'),
      max_data_age_ms: Number(max_data_age_ms || 5000),
      tick_size: finalTick,
      lot_size: String(lot_size || '0.0001'),
      dry_run: Boolean(dry_run),
      liquidity_refresh_cooldown_sec: Math.max(3, Number(liquidity_refresh_cooldown_sec || 10)),
      randomize_placement_enabled: randomize_placement_enabled !== undefined ? Boolean(randomize_placement_enabled) : true,
      price_randomization_ticks: Math.max(1, Number(price_randomization_ticks || 2)),
      enabled: true,
      activeOrderIds: []
    };

    const botId = `bot-dep-${crypto.randomUUID().slice(0, 8)}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'DEPTH_LIQUIDITY',
      pairId,
      environment: (environment as Environment) || 'DEMO',
      ownerUserId: user.id,
      accountId: account_id || user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      depthLiquidityConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Depth & Liquidity Bot dibuat oleh ${user.email} (${depthLiquidityConfig.number_of_bid_levels} Bid Levels, ${depthLiquidityConfig.number_of_ask_levels} Ask Levels).`,
          type: 'INFO'
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, message: `Depth & Liquidity Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// 23. GET REFERENCE PRICES
// ============================================================================
mmConsoleRouter.get('/reference-prices', (req, res) => {
  try {
    const pairs = Array.from(db.tradingPairs.keys());
    const result: Record<string, any> = {};
    for (const p of pairs) {
      result[p] = priceAggregatorService.getReferencePrice(p);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 24. CREATE QUANTITATIVE HFT MARKET MAKER BOT
// ============================================================================
mmConsoleRouter.post('/quant-hft/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      target_spread_pct,
      min_spread_pct,
      max_spread_pct,
      micro_order_size,
      max_ladder_levels,
      max_base_inventory,
      max_quote_inventory,
      inventory_skew_factor,
      volatility_threshold_bps,
      pump_dump_multiplier,
      defense_perimeter_multiplier,
      tighten_spread_enabled,
      trend_leaning_enabled,
      flash_defense_enabled,
      reprice_interval_ms
    } = req.body;

    if (!name || !pairId) {
      return res.status(400).json({ error: 'Nama bot dan trading pair wajib diisi.' });
    }

    const quantHftConfig: QuantHftConfig = {
      target_spread_pct: Number(target_spread_pct || 0.08),
      min_spread_pct: Number(min_spread_pct || 0.02),
      max_spread_pct: Number(max_spread_pct || 0.40),
      micro_order_size: String(micro_order_size || '0.001'),
      max_ladder_levels: Math.min(3, Math.max(1, Number(max_ladder_levels || 3))),
      max_base_inventory: String(max_base_inventory || '5.0'),
      max_quote_inventory: String(max_quote_inventory || '50000.0'),
      inventory_skew_factor: Number(inventory_skew_factor ?? 0.25),
      volatility_threshold_bps: Number(volatility_threshold_bps || 120),
      pump_dump_multiplier: Number(pump_dump_multiplier || 2.5),
      defense_perimeter_multiplier: Number(defense_perimeter_multiplier || 3.0),
      tighten_spread_enabled: tighten_spread_enabled !== false,
      trend_leaning_enabled: trend_leaning_enabled !== false,
      flash_defense_enabled: flash_defense_enabled !== false,
      reprice_interval_ms: Number(reprice_interval_ms || 1500),
      activeOrderIds: []
    };

    const botId = `bot-qhft-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'QUANT_HFT_MM',
      pairId,
      environment: (environment || 'DEMO') as Environment,
      ownerUserId: user.id,
      accountId: user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      quantHftConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Quant HFT MM Bot "${name}" dibuat untuk pair ${pairId} (Spread: ${quantHftConfig.target_spread_pct}%, Lot: ${quantHftConfig.micro_order_size}).`,
          type: 'INFO'
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, message: `Quant HFT MM Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// 25. SMART HFT LADDER BOT & PATTERN CHART CREATOR ENDPOINTS
// ============================================================================

// A. Get List of 14 Supported Chart Patterns
mmConsoleRouter.get('/smart-hft/patterns', (req, res) => {
  const patterns = [
    // 1. Reversal Patterns
    { id: 'HEAD_AND_SHOULDERS', name: 'Head and Shoulders', category: 'REVERSAL', bias: 'BEARISH' },
    { id: 'INVERSE_HEAD_AND_SHOULDERS', name: 'Inverse Head and Shoulders', category: 'REVERSAL', bias: 'BULLISH' },
    { id: 'DOUBLE_TOP', name: 'Double Top', category: 'REVERSAL', bias: 'BEARISH' },
    { id: 'TRIPLE_TOP', name: 'Triple Top', category: 'REVERSAL', bias: 'BEARISH' },
    { id: 'DOUBLE_BOTTOM', name: 'Double Bottom', category: 'REVERSAL', bias: 'BULLISH' },
    { id: 'TRIPLE_BOTTOM', name: 'Triple Bottom', category: 'REVERSAL', bias: 'BULLISH' },
    // 2. Continuation Patterns
    { id: 'BULLISH_FLAG', name: 'Bullish Flag', category: 'CONTINUATION', bias: 'BULLISH' },
    { id: 'BEARISH_FLAG', name: 'Bearish Flag', category: 'CONTINUATION', bias: 'BEARISH' },
    { id: 'PENNANT', name: 'Pennant', category: 'CONTINUATION', bias: 'CONTINUATION' },
    { id: 'CUP_AND_HANDLE', name: 'Cup and Handle', category: 'CONTINUATION', bias: 'BULLISH' },
    { id: 'RECTANGLE', name: 'Rectangle (Consolidation)', category: 'CONTINUATION', bias: 'NEUTRAL' },
    // 3. Bilateral / Neutral Patterns
    { id: 'ASCENDING_TRIANGLE', name: 'Ascending Triangle', category: 'BILATERAL', bias: 'BULLISH_BIAS' },
    { id: 'DESCENDING_TRIANGLE', name: 'Descending Triangle', category: 'BILATERAL', bias: 'BEARISH_BIAS' },
    { id: 'SYMMETRICAL_TRIANGLE', name: 'Symmetrical Triangle', category: 'BILATERAL', bias: 'BILATERAL' },
  ];
  res.json({ patterns });
});

// B. Live Mathematical Pattern & Ladder Order Simulator Preview
mmConsoleRouter.post('/smart-hft/preview', requireMMOrAdmin, (req, res) => {
  try {
    const {
      pairId,
      timeframe,
      pattern,
      total_orders,
      bound_percentage,
      min_price_bound,
      max_price_bound,
      min_buy_lot,
      max_buy_lot,
      min_sell_lot,
      max_sell_lot,
      min_spread_bps,
      spread_percentage
    } = req.body;

    const pair = db.tradingPairs.get(pairId || 'BTC-IDR');
    if (!pair) {
      return res.status(404).json({ error: 'Pair tidak ditemukan' });
    }

    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const currentMarketPrice = Number(BigInt(pair.lastPrice)) / (10 ** quoteDecimals);

    const tf = (timeframe || '15m') as PatternTimeframe;
    const pat = (pattern || 'HEAD_AND_SHOULDERS') as PatternFormationType;

    // 1. Modul A: Generate Pattern & Anchor
    const { points, anchorPrice } = SmartHftLadderBotExecutor.previewPattern(
      currentMarketPrice,
      pat,
      tf,
      5.0
    );

    // 2. Modul B: Calculate Guarded Multi-Order Ladder with Percentage / Spread Guard
    const boundPct = bound_percentage !== undefined && bound_percentage !== null && !isNaN(Number(bound_percentage)) && Number(bound_percentage) > 0
      ? Number(bound_percentage)
      : undefined;

    let minBoundNum: number;
    let maxBoundNum: number;

    if (boundPct) {
      minBoundNum = currentMarketPrice * (1 - boundPct / 100);
      maxBoundNum = currentMarketPrice * (1 + boundPct / 100);
    } else if (min_price_bound && max_price_bound) {
      minBoundNum = parseFloat(min_price_bound);
      maxBoundNum = parseFloat(max_price_bound);
      // Anti-divergence guard: clamp if unreasonably far (> 15% from current price)
      const maxDev = 0.15;
      if (minBoundNum < currentMarketPrice * (1 - maxDev)) minBoundNum = currentMarketPrice * (1 - maxDev);
      if (maxBoundNum > currentMarketPrice * (1 + maxDev)) maxBoundNum = currentMarketPrice * (1 + maxDev);
    } else {
      minBoundNum = currentMarketPrice * 0.95; // default ±5%
      maxBoundNum = currentMarketPrice * 1.05;
    }

    const cfg: SmartHftLadderConfig = {
      account_id: 'preview',
      timeframe: tf,
      pattern: pat,
      total_orders: Math.min(100, Math.max(2, Number(total_orders || 40))),
      bound_percentage: boundPct,
      min_price_bound: String(minBoundNum.toFixed(quoteDecimals)),
      max_price_bound: String(maxBoundNum.toFixed(quoteDecimals)),
      min_buy_lot: String(min_buy_lot || '0.01'),
      max_buy_lot: String(max_buy_lot || '0.50'),
      min_sell_lot: String(min_sell_lot || '0.01'),
      max_sell_lot: String(max_sell_lot || '0.50'),
      min_spread_bps: min_spread_bps ? Number(min_spread_bps) : undefined,
      spread_percentage: spread_percentage ? Number(spread_percentage) : undefined,
      reprice_interval_ms: 3000
    };

    // Bound anchor safely inside channel
    const tick = SmartHftLadderBotExecutor.getTickSize(pair, currentMarketPrice);
    const safeAnchor = Math.max(minBoundNum + tick * 2, Math.min(maxBoundNum - tick * 2, anchorPrice));

    const { buyLevels, sellLevels } = SmartHftLadderBotExecutor.calculateLadder(pair, safeAnchor, cfg);

    const serializedBuyLevels = buyLevels.map(l => ({
      ...l,
      priceUnits: l.priceUnits.toString(),
      quantityUnits: l.quantityUnits.toString()
    }));

    const serializedSellLevels = sellLevels.map(l => ({
      ...l,
      priceUnits: l.priceUnits.toString(),
      quantityUnits: l.quantityUnits.toString()
    }));

    res.json({
      success: true,
      pairId: pair.id,
      anchorPrice: safeAnchor,
      anchorPriceDisplay: SmartHftLadderBotExecutor.formatDisplayPrice(PrecisionMath.parseToUnits(safeAnchor.toFixed(quoteDecimals), quoteDecimals), pair),
      minPriceBound: minBoundNum,
      maxPriceBound: maxBoundNum,
      boundPercentage: boundPct || Number((((maxBoundNum - currentMarketPrice) / currentMarketPrice) * 100).toFixed(2)),
      patternPoints: points,
      buyLevels: serializedBuyLevels,
      sellLevels: serializedSellLevels,
      verificationReport: {
        buyLevel1: serializedBuyLevels[0],
        buyLevelFurthest: serializedBuyLevels[serializedBuyLevels.length - 1],
        sellLevel1: serializedSellLevels[0],
        sellLevelFurthest: serializedSellLevels[serializedSellLevels.length - 1],
        guardsPassed: true
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// C. Create Smart HFT Ladder Bot
mmConsoleRouter.post('/smart-hft/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      timeframe,
      pattern,
      total_orders,
      bound_percentage,
      min_price_bound,
      max_price_bound,
      min_buy_lot,
      max_buy_lot,
      min_sell_lot,
      max_sell_lot,
      min_spread_bps,
      spread_percentage,
      reprice_interval_ms
    } = req.body;

    if (!name || !pairId) {
      return res.status(400).json({ error: 'Nama bot dan trading pair wajib diisi.' });
    }

    const pair = db.tradingPairs.get(pairId);
    if (!pair) {
      return res.status(404).json({ error: 'Trading pair tidak valid.' });
    }

    const quoteDecimals = pair.quoteDecimals !== undefined ? pair.quoteDecimals : (pair.quoteCurrency === 'USDT' ? 6 : 2);
    const currentMarketPrice = Number(BigInt(pair.lastPrice)) / (10 ** quoteDecimals);

    const boundPct = bound_percentage !== undefined && bound_percentage !== null && !isNaN(Number(bound_percentage)) && Number(bound_percentage) > 0
      ? Number(bound_percentage)
      : undefined;

    let minBound: number;
    let maxBound: number;

    if (boundPct) {
      minBound = currentMarketPrice * (1 - boundPct / 100);
      maxBound = currentMarketPrice * (1 + boundPct / 100);
    } else {
      minBound = parseFloat(min_price_bound);
      maxBound = parseFloat(max_price_bound);
      if (isNaN(minBound) || isNaN(maxBound) || minBound <= 0 || maxBound <= 0 || minBound >= maxBound) {
        return res.status(400).json({ error: 'Batas harga absolut tidak valid: min_price_bound harus > 0 dan < max_price_bound.' });
      }
      // Anti-divergence guard: clamp bounds so they are not too far from current market price
      const maxDev = 0.15;
      if (minBound < currentMarketPrice * (1 - maxDev)) minBound = currentMarketPrice * (1 - maxDev);
      if (maxBound > currentMarketPrice * (1 + maxDev)) maxBound = currentMarketPrice * (1 + maxDev);
    }

    const totalOrdersClamped = Math.min(100, Math.max(2, Number(total_orders || 40)));

    const tf = (timeframe || '15m') as PatternTimeframe;
    const totalBars = tf === '5m' ? 30 : tf === '15m' ? 45 : tf === '1h' ? 60 : 90;

    const smartHftConfig: SmartHftLadderConfig = {
      account_id: user.id,
      timeframe: tf,
      pattern: (pattern || 'HEAD_AND_SHOULDERS') as PatternFormationType,
      total_orders: totalOrdersClamped,
      bound_percentage: boundPct,
      min_price_bound: String(minBound.toFixed(quoteDecimals)),
      max_price_bound: String(maxBound.toFixed(quoteDecimals)),
      min_buy_lot: String(min_buy_lot || '0.01'),
      max_buy_lot: String(max_buy_lot || '0.50'),
      min_sell_lot: String(min_sell_lot || '0.01'),
      max_sell_lot: String(max_sell_lot || '0.50'),
      min_spread_bps: min_spread_bps ? Number(min_spread_bps) : undefined,
      spread_percentage: spread_percentage ? Number(spread_percentage) : undefined,
      reprice_interval_ms: Number(reprice_interval_ms || 4000),
      activeOrderIds: [],
      currentPatternIndex: 0,
      totalBars,
      lastRepriceTimestamp: 0
    };

    const botId = `bot-shft-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'SMART_HFT_LADDER',
      pairId,
      environment: (environment || 'DEMO') as Environment,
      ownerUserId: user.id,
      accountId: user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      smartHftConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Smart HFT Ladder Bot "${name}" dibuat (${totalOrdersClamped} Orders, Pola: ${smartHftConfig.pattern}, Bounds: [${minBound} - ${maxBound}]).`,
          type: 'INFO'
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, message: `Smart HFT Ladder Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// D. Download / View Complete Standalone Python Source Code
mmConsoleRouter.get('/smart-hft/python-script', (req, res) => {
  try {
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'smart_hft_ladder_bot.py');
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: 'File scripts/smart_hft_ladder_bot.py tidak ditemukan.' });
    }
    const code = fs.readFileSync(scriptPath, 'utf-8');
    if (req.query.download === 'true') {
      res.setHeader('Content-Type', 'text/x-python');
      res.setHeader('Content-Disposition', 'attachment; filename="smart_hft_ladder_bot.py"');
      return res.send(code);
    }
    res.json({ code, filename: 'smart_hft_ladder_bot.py' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ADVANCED MARKET MAKER & MULTI-TIMEFRAME ANALYTICS ENDPOINTS
// ============================================================================

// 1. Get Timeframe Analytics & Market Regime for any pair & timeframe
mmConsoleRouter.get('/analytics/:pairId', (req, res) => {
  try {
    const { pairId } = req.params;
    const tf = (req.query.timeframe as string) || '15m';
    const report = timeframeAnalyticsService.analyze(pairId, tf);
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. List all Advanced Market Maker Bots
mmConsoleRouter.get('/advanced-bot/list', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';
    const bots = Array.from(db.botInstances.values()).filter(
      b => b.botType === 'ADVANCED_MM' && (isSuper || b.ownerUserId === user.id)
    );
    res.json({ success: true, bots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Create Advanced Market Maker Bot
mmConsoleRouter.post('/advanced-bot/create', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      name,
      pairId,
      environment,
      timeframe,
      bid_levels,
      ask_levels,
      bid_base_quantity,
      ask_base_quantity,
      quantity_distribution,
      spread_min_bps,
      spread_max_bps,
      price_offset_bps,
      order_refresh_interval_ms,
      maximum_open_orders,
      spacing_mode,
      adaptive_quoting_enabled,
      volatility_monitoring_enabled,
      inventory_rebalancing_enabled,
      dynamic_spread_enabled,
      market_regime_detection_enabled,
      risk_protection_enabled,
      maximum_inventory,
      maximum_order_value_quote,
      maximum_exposure_quote,
      maximum_daily_loss_quote,
      maximum_price_deviation_pct,
      minimum_available_balance_quote,
      emergency_stop
    } = req.body;

    if (!name || !pairId) {
      return res.status(400).json({ error: 'Nama bot dan trading pair wajib diisi.' });
    }

    const pair = db.tradingPairs.get(pairId);
    if (!pair) {
      return res.status(404).json({ error: `Trading pair "${pairId}" tidak ditemukan.` });
    }

    const advancedMMConfig: AdvancedMarketMakerConfig = {
      account_id: user.id,
      pair_id: pairId,
      timeframe: timeframe || '15m',
      bid_levels: Number(bid_levels || 5),
      ask_levels: Number(ask_levels || 5),
      bid_base_quantity: String(bid_base_quantity || '0.01'),
      ask_base_quantity: String(ask_base_quantity || '0.01'),
      quantity_distribution: quantity_distribution || 'LINEAR',
      spread_min_bps: Number(spread_min_bps || 10),
      spread_max_bps: Number(spread_max_bps || 150),
      price_offset_bps: Number(price_offset_bps || 0),
      order_refresh_interval_ms: Number(order_refresh_interval_ms || 2500),
      maximum_open_orders: Number(maximum_open_orders || 40),
      spacing_mode: spacing_mode || 'VOLATILITY_ADAPTIVE',
      adaptive_quoting_enabled: adaptive_quoting_enabled !== false,
      volatility_monitoring_enabled: volatility_monitoring_enabled !== false,
      inventory_rebalancing_enabled: inventory_rebalancing_enabled !== false,
      dynamic_spread_enabled: dynamic_spread_enabled !== false,
      market_regime_detection_enabled: market_regime_detection_enabled !== false,
      risk_protection_enabled: risk_protection_enabled !== false,
      maximum_inventory: String(maximum_inventory || '5.0'),
      maximum_order_value_quote: String(maximum_order_value_quote || '50000000'),
      maximum_exposure_quote: String(maximum_exposure_quote || '500000000'),
      maximum_daily_loss_quote: String(maximum_daily_loss_quote || '25000000'),
      maximum_price_deviation_pct: Number(maximum_price_deviation_pct || 5.0),
      minimum_available_balance_quote: String(minimum_available_balance_quote || '1000000'),
      emergency_stop: Boolean(emergency_stop || false),
      activeOrderIds: [],
      riskWarnings: []
    };

    const botId = `bot-amm-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const bot: BotInstance = {
      id: botId,
      name,
      botType: 'ADVANCED_MM',
      pairId,
      environment: (environment || 'DEMO') as Environment,
      ownerUserId: user.id,
      accountId: user.id,
      version: 1,
      status: 'READY',
      lastHeartbeat: Date.now(),
      advancedMMConfig,
      stats: {
        ordersSubmitted: 0,
        ordersAccepted: 0,
        ordersFilled: 0,
        executedVolume: '0',
        totalTrades: 0
      },
      deployedOrderIds: [],
      logs: [
        {
          timestamp: Date.now(),
          message: `Advanced MM Bot "${name}" dibuat (${advancedMMConfig.bid_levels} Bids / ${advancedMMConfig.ask_levels} Asks, Spread: [${advancedMMConfig.spread_min_bps}-${advancedMMConfig.spread_max_bps}bps]).`,
          type: 'INFO'
        }
      ],
      createdBy: user.email,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    db.botInstances.set(bot.id, bot);
    db.scheduleSave();

    res.json({ success: true, message: `Advanced Market Maker Bot "${bot.name}" berhasil dibuat.`, bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Update Advanced Market Maker Bot Configuration
mmConsoleRouter.post('/advanced-bot/:id/update', requireMMOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bot = db.botInstances.get(id);
    if (!bot || bot.botType !== 'ADVANCED_MM') {
      return res.status(404).json({ error: 'Bot Advanced MM tidak ditemukan.' });
    }

    const user = (req as any).user;
    const isSuper = (user.role || '').toUpperCase() === 'ADMIN' || (user.role || '').toUpperCase() === 'SUPERADMIN';
    if (!isSuper && bot.ownerUserId !== user.id) {
      return res.status(403).json({ error: 'Akses ditolak.' });
    }

    if (!bot.advancedMMConfig) {
      bot.advancedMMConfig = {} as AdvancedMarketMakerConfig;
    }
    const cfg = bot.advancedMMConfig;

    // Merge updated parameters
    const incoming = req.body;
    if (incoming.name) bot.name = incoming.name;
    if (incoming.timeframe) cfg.timeframe = incoming.timeframe;
    if (incoming.bid_levels !== undefined) cfg.bid_levels = Number(incoming.bid_levels);
    if (incoming.ask_levels !== undefined) cfg.ask_levels = Number(incoming.ask_levels);
    if (incoming.bid_base_quantity !== undefined) cfg.bid_base_quantity = String(incoming.bid_base_quantity);
    if (incoming.ask_base_quantity !== undefined) cfg.ask_base_quantity = String(incoming.ask_base_quantity);
    if (incoming.quantity_distribution !== undefined) cfg.quantity_distribution = incoming.quantity_distribution;
    if (incoming.spread_min_bps !== undefined) cfg.spread_min_bps = Number(incoming.spread_min_bps);
    if (incoming.spread_max_bps !== undefined) cfg.spread_max_bps = Number(incoming.spread_max_bps);
    if (incoming.price_offset_bps !== undefined) cfg.price_offset_bps = Number(incoming.price_offset_bps);
    if (incoming.order_refresh_interval_ms !== undefined) cfg.order_refresh_interval_ms = Number(incoming.order_refresh_interval_ms);
    if (incoming.maximum_open_orders !== undefined) cfg.maximum_open_orders = Number(incoming.maximum_open_orders);
    if (incoming.spacing_mode !== undefined) cfg.spacing_mode = incoming.spacing_mode;
    if (incoming.adaptive_quoting_enabled !== undefined) cfg.adaptive_quoting_enabled = Boolean(incoming.adaptive_quoting_enabled);
    if (incoming.volatility_monitoring_enabled !== undefined) cfg.volatility_monitoring_enabled = Boolean(incoming.volatility_monitoring_enabled);
    if (incoming.inventory_rebalancing_enabled !== undefined) cfg.inventory_rebalancing_enabled = Boolean(incoming.inventory_rebalancing_enabled);
    if (incoming.dynamic_spread_enabled !== undefined) cfg.dynamic_spread_enabled = Boolean(incoming.dynamic_spread_enabled);
    if (incoming.market_regime_detection_enabled !== undefined) cfg.market_regime_detection_enabled = Boolean(incoming.market_regime_detection_enabled);
    if (incoming.risk_protection_enabled !== undefined) cfg.risk_protection_enabled = Boolean(incoming.risk_protection_enabled);
    if (incoming.maximum_inventory !== undefined) cfg.maximum_inventory = String(incoming.maximum_inventory);
    if (incoming.maximum_order_value_quote !== undefined) cfg.maximum_order_value_quote = String(incoming.maximum_order_value_quote);
    if (incoming.maximum_exposure_quote !== undefined) cfg.maximum_exposure_quote = String(incoming.maximum_exposure_quote);
    if (incoming.maximum_daily_loss_quote !== undefined) cfg.maximum_daily_loss_quote = String(incoming.maximum_daily_loss_quote);
    if (incoming.maximum_price_deviation_pct !== undefined) cfg.maximum_price_deviation_pct = Number(incoming.maximum_price_deviation_pct);
    if (incoming.minimum_available_balance_quote !== undefined) cfg.minimum_available_balance_quote = String(incoming.minimum_available_balance_quote);
    if (incoming.emergency_stop !== undefined) cfg.emergency_stop = Boolean(incoming.emergency_stop);

    bot.updatedAt = Date.now();
    botWorkerManager.addLog(bot, `Konfigurasi diperbarui oleh ${user.email}.`, 'INFO');
    db.scheduleSave();

    res.json({ success: true, message: 'Konfigurasi Advanced MM berhasil disimpan.', bot });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Start / Resume Advanced MM Bot
mmConsoleRouter.post('/advanced-bot/:id/start', requireMMOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bot = db.botInstances.get(id);
    if (!bot || bot.botType !== 'ADVANCED_MM') {
      return res.status(404).json({ error: 'Bot Advanced MM tidak ditemukan.' });
    }

    if (bot.advancedMMConfig) {
      bot.advancedMMConfig.emergency_stop = false;
    }

    const ok = botWorkerManager.startWorker(id);
    if (ok) {
      res.json({ success: true, message: `Bot "${bot.name}" berhasil dijalankan.`, status: bot.status });
    } else {
      res.status(400).json({ error: 'Gagal menjalankan bot. Periksa log atau batas risiko.', status: bot.status });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Pause Advanced MM Bot
mmConsoleRouter.post('/advanced-bot/:id/pause', requireMMOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bot = db.botInstances.get(id);
    if (!bot || bot.botType !== 'ADVANCED_MM') {
      return res.status(404).json({ error: 'Bot Advanced MM tidak ditemukan.' });
    }

    const ok = botWorkerManager.pauseWorker(id);
    res.json({ success: ok, message: `Bot "${bot.name}" dijeda.`, status: bot.status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Manual Reprice Now Trigger
mmConsoleRouter.post('/advanced-bot/:id/reprice-now', requireMMOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bot = db.botInstances.get(id);
    if (!bot || bot.botType !== 'ADVANCED_MM') {
      return res.status(404).json({ error: 'Bot Advanced MM tidak ditemukan.' });
    }

    AdvancedMarketMakerBotExecutor.executeTick(bot, botWorkerManager.addLog.bind(botWorkerManager));
    res.json({ success: true, message: 'Reprice dieksekusi seketika.', bot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Emergency Stop Kill Switch
mmConsoleRouter.post('/advanced-bot/:id/emergency-halt', requireMMOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bot = db.botInstances.get(id);
    if (!bot || bot.botType !== 'ADVANCED_MM') {
      return res.status(404).json({ error: 'Bot Advanced MM tidak ditemukan.' });
    }

    if (bot.advancedMMConfig) {
      bot.advancedMMConfig.emergency_stop = true;
    }

    botWorkerManager.pauseWorker(id);
    const cancelled = AdvancedMarketMakerBotExecutor.cancelOpenOrders(bot, botWorkerManager.addLog.bind(botWorkerManager), 'Emergency Halt');
    bot.status = 'PAUSED';
    db.scheduleSave();

    res.json({ success: true, message: `Emergency Halt diaktifkan. ${cancelled} order ditarik dan bot dijeda.`, status: bot.status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Monitoring Dashboard Payload
mmConsoleRouter.get('/advanced-bot/:id/monitoring', requireMMOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const bot = db.botInstances.get(id);
    if (!bot || bot.botType !== 'ADVANCED_MM') {
      return res.status(404).json({ error: 'Bot Advanced MM tidak ditemukan.' });
    }

    const state = AdvancedMarketMakerBotExecutor.getMonitoringState(bot);
    res.json({ success: true, monitoring: state });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 10. AUTOMATED PORTFOLIO REBALANCING MODULE
// ==========================================

// Get Portfolio Status and Rebalancing Diagnostics
mmConsoleRouter.get('/rebalance/status', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const pairId = (req.query.pairId as string) || 'BTC-IDR';
    const accountId = (req.query.accountId as string) || user.id;

    const config = portfolioRebalanceService.getConfig(accountId, pairId);
    const status = portfolioRebalanceService.getPortfolioStatus(accountId, pairId);

    res.json({
      success: true,
      config,
      status
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save or Update Portfolio Rebalancing Configuration
mmConsoleRouter.post('/rebalance/config', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const {
      pairId,
      accountId,
      targetBaseRatioPct,
      deviationThresholdPct,
      maxOrderSizeQuote,
      rebalanceOrderType,
      slippageTolerancePct,
      checkIntervalSec,
      enabled
    } = req.body;

    const targetAcct = accountId || user.id;
    const targetPair = pairId || 'BTC-IDR';

    const existingConfig = portfolioRebalanceService.getConfig(targetAcct, targetPair);

    const updatedConfig = portfolioRebalanceService.saveConfig({
      ...existingConfig,
      targetBaseRatioPct: Number(targetBaseRatioPct ?? existingConfig.targetBaseRatioPct),
      deviationThresholdPct: Number(deviationThresholdPct ?? existingConfig.deviationThresholdPct),
      maxOrderSizeQuote: maxOrderSizeQuote !== undefined ? String(maxOrderSizeQuote) : existingConfig.maxOrderSizeQuote,
      rebalanceOrderType: rebalanceOrderType || existingConfig.rebalanceOrderType,
      slippageTolerancePct: Number(slippageTolerancePct ?? existingConfig.slippageTolerancePct),
      checkIntervalSec: Number(checkIntervalSec ?? existingConfig.checkIntervalSec),
      enabled: enabled !== undefined ? Boolean(enabled) : existingConfig.enabled
    });

    const status = portfolioRebalanceService.getPortfolioStatus(targetAcct, targetPair);

    res.json({
      success: true,
      message: 'Konfigurasi penyeimbangan ulang portofolio berhasil disimpan.',
      config: updatedConfig,
      status
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger Immediate Manual Rebalance Check & Order Placement
mmConsoleRouter.post('/rebalance/execute-now', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const { pairId, accountId } = req.body;

    const targetAcct = accountId || user.id;
    const targetPair = pairId || 'BTC-IDR';

    const result = portfolioRebalanceService.executeRebalance(targetAcct, targetPair, true);
    const updatedStatus = portfolioRebalanceService.getPortfolioStatus(targetAcct, targetPair);

    res.json({
      success: result.success,
      rebalanceEvent: result.rebalanceEvent,
      status: updatedStatus
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Rebalancing Audit Event History
mmConsoleRouter.get('/rebalance/history', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const pairId = (req.query.pairId as string) || 'BTC-IDR';
    const accountId = (req.query.accountId as string) || user.id;

    const config = portfolioRebalanceService.getConfig(accountId, pairId);
    res.json({
      success: true,
      history: config.rebalanceHistory || []
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 11. HFT PERFORMANCE DASHBOARD (D3 TIME-SERIES)
// ==========================================

// Performance metrics time-series (PnL, Inventory Skew, Execution Latency)
mmConsoleRouter.get('/performance/metrics', requireMMOrAdmin, (req, res) => {
  try {
    const user = (req as any).user;
    const pairId = (req.query.pairId as string) || 'BTC-IDR';
    const accountId = (req.query.accountId as string) || user.id;
    const timeframe = ((req.query.timeframe as string) || '24H') as '1H' | '6H' | '24H' | '7D' | 'ALL';

    const metrics = portfolioRebalanceService.getPerformanceMetrics(accountId, pairId, timeframe);

    res.json({
      success: true,
      pairId,
      timeframe,
      ...metrics
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 12. REAL-TIME HFT ENGINE TELEMETRY (OPS, LATENCY, FEE GENERATION)
// ==========================================
mmConsoleRouter.get('/engine/telemetry', requireMMOrAdmin, (req, res) => {
  try {
    const windowSec = Number(req.query.windowSec) || 60;
    const pairId = (req.query.pairId as string) || 'ALL';
    const snapshot = engineTelemetry.getTelemetry(windowSec, pairId);

    res.json({
      success: true,
      ...snapshot
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
