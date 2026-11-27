/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * server/routes/modularBot.ts
 * REST API Endpoints for DIMONEX MODULAR_STRATEGY_BOT:
 * - Strategy Plugin Registry listing
 * - Config v1.0 Validation
 * - Bot CRUD, Start/Pause/Resume/Stop/Emergency-Stop
 * - Explicit PAPER -> LIVE Promotion Confirmation
 * - Historical Backtesting & Parameter Optimization
 */

import { Router } from 'express';
import { db } from '../db/database.js';
import { requireAuthOrHmac } from './bot.js';
import { strategyRegistry } from '../services/modularBot/StrategyRegistry.js';
import '../services/modularBot/strategies/index.js';
import { dimonexConnector } from '../services/modularBot/MarketDataConnector.js';
import { ConfigValidator, normalizePairId } from '../services/modularBot/ConfigValidator.js';
import { modularBotOrchestrator } from '../services/modularBot/ModularBotOrchestrator.js';
import { BacktestEngine } from '../services/modularBot/BacktestEngine.js';

export const modularBotRouter = Router();

/**
 * List all registered StrategyController plugins & schemas
 */
modularBotRouter.get('/strategies', (_req, res) => {
  const strategies = strategyRegistry.listStrategies();
  res.json({
    strategies,
    count: strategies.length,
    supportedIndicators: [
      'SMA',
      'EMA',
      'RSI',
      'MACD',
      'BOLLINGER_BANDS',
      'ATR',
      'ADX',
      'STOCHASTIC',
      'STOCHASTIC_RSI',
      'VWAP',
      'VOLUME_MA',
      'OBV',
      'MFI',
    ],
    supportedOperators: ['AND', 'OR', 'NOT', 'GREATER_THAN', 'LESS_THAN', 'CROSS_ABOVE', 'CROSS_BELOW', 'EQUAL', 'BETWEEN'],
  });
});

/**
 * Validate BotConfigSchemaV1 against market constraints and plugin rules
 */
modularBotRouter.post('/validate', requireAuthOrHmac, (req: any, res) => {
  try {
    const config = req.body?.config || req.body;
    const pairId = normalizePairId(config?.bot?.tradingPair || '');
    const constraints = pairId ? dimonexConnector.getMarketConstraints(pairId) : null;
    const result = ConfigValidator.validate(config, constraints);
    res.json({
      ...result,
      pairConstraints: constraints,
    });
  } catch (err: any) {
    res.status(400).json({ valid: false, errors: [err?.message || 'Validasi gagal'], warnings: [] });
  }
});

/**
 * Get user's Modular Bots + Account Portfolio Risk Snapshot
 */
modularBotRouter.get('/', requireAuthOrHmac, (req: any, res) => {
  const userId = req.user.id;
  const bots = modularBotOrchestrator.listBotsForUser(userId);
  const portfolioRisk = modularBotOrchestrator.getPortfolioRisk(userId);
  res.json({
    bots,
    portfolioRisk,
  });
});

/**
 * List user's saved Backtest reports
 */
modularBotRouter.get('/backtest/history', requireAuthOrHmac, (req: any, res) => {
  const userId = req.user.id;
  const reports = db.modularBacktests
    .filter(r => r.ownerUserId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
  res.json({ reports });
});

/**
 * Run Historical Backtest (and optional optimization grid sweep)
 */
modularBotRouter.post('/backtest', requireAuthOrHmac, (req: any, res) => {
  try {
    const userId = req.user.id;
    const report = BacktestEngine.run(userId, req.body);
    res.json({ report });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Backtest gagal dijalankan.' });
  }
});

/**
 * Get single Modular Bot detail
 */
modularBotRouter.get('/:botId', requireAuthOrHmac, (req: any, res) => {
  try {
    const isAdmin = ['admin', 'superadmin', 'ADMIN'].includes(req.user.role);
    const bot = modularBotOrchestrator.getBotForUser(req.user.id, req.params.botId, isAdmin);
    res.json({ bot });
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Bot tidak ditemukan.' });
  }
});

/**
 * Create a new Modular Strategy Bot
 */
modularBotRouter.post('/', requireAuthOrHmac, (req: any, res) => {
  try {
    const { config, startImmediately, confirmLiveDeployment } = req.body || {};
    const bot = modularBotOrchestrator.createBot(req.user.id, config || req.body, {
      startImmediately: Boolean(startImmediately),
      confirmLiveDeployment: Boolean(confirmLiveDeployment),
    });
    res.status(201).json({
      bot,
      portfolioRisk: modularBotOrchestrator.getPortfolioRisk(req.user.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal membuat Modular Strategy Bot.' });
  }
});

/**
 * Update Bot configuration (only while paused/stopped/draft)
 */
modularBotRouter.patch('/:botId/config', requireAuthOrHmac, (req: any, res) => {
  try {
    const config = req.body?.config || req.body;
    const bot = modularBotOrchestrator.updateBotConfig(req.user.id, req.params.botId, config);
    res.json({ bot });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal memperbarui konfigurasi bot.' });
  }
});

/**
 * Start Bot
 */
modularBotRouter.post('/:botId/start', requireAuthOrHmac, (req: any, res) => {
  try {
    const bot = modularBotOrchestrator.startBot(req.user.id, req.params.botId);
    res.json({
      bot,
      portfolioRisk: modularBotOrchestrator.getPortfolioRisk(req.user.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal mengaktifkan bot.' });
  }
});

/**
 * Pause Bot
 */
modularBotRouter.post('/:botId/pause', requireAuthOrHmac, (req: any, res) => {
  try {
    const bot = modularBotOrchestrator.pauseBot(req.user.id, req.params.botId);
    res.json({ bot });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menjeda bot.' });
  }
});

/**
 * Resume Bot
 */
modularBotRouter.post('/:botId/resume', requireAuthOrHmac, (req: any, res) => {
  try {
    const bot = modularBotOrchestrator.resumeBot(req.user.id, req.params.botId);
    res.json({ bot });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal melanjutkan bot.' });
  }
});

/**
 * Stop Bot and safely cancel all bot-owned open orders
 */
modularBotRouter.post('/:botId/stop', requireAuthOrHmac, (req: any, res) => {
  try {
    const bot = modularBotOrchestrator.stopBot(req.user.id, req.params.botId, req.body?.reason);
    res.json({
      bot,
      portfolioRisk: modularBotOrchestrator.getPortfolioRisk(req.user.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menghentikan bot.' });
  }
});

/**
 * Emergency Stop: Cancels all open orders and attempts safe spot exit
 */
modularBotRouter.post('/:botId/emergency-stop', requireAuthOrHmac, (req: any, res) => {
  try {
    const bot = modularBotOrchestrator.emergencyStopBot(req.user.id, req.params.botId);
    res.json({
      bot,
      portfolioRisk: modularBotOrchestrator.getPortfolioRisk(req.user.id),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Emergency stop gagal.' });
  }
});

/**
 * Explicit Guarded Transition: PAPER -> LIVE
 */
modularBotRouter.post('/:botId/promote-live', requireAuthOrHmac, (req: any, res) => {
  try {
    const { confirmLiveDeployment, acknowledgeRisk } = req.body || {};
    const bot = modularBotOrchestrator.promotePaperToLive(
      req.user.id,
      req.params.botId,
      Boolean(confirmLiveDeployment),
      Boolean(acknowledgeRisk)
    );
    res.json({ bot });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Promosi ke LIVE ditolak.' });
  }
});

/**
 * Delete Bot cleanly
 */
modularBotRouter.delete('/:botId', requireAuthOrHmac, (req: any, res) => {
  try {
    modularBotOrchestrator.deleteBot(req.user.id, req.params.botId);
    res.json({ deleted: true, botId: req.params.botId });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Gagal menghapus bot.' });
  }
});
