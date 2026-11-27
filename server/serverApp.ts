/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/serverApp.ts
 * DIMONEX Full-Stack Server Application
 * Mounts Express API Gateway, WebSocket Server, and Vite Middlewares / static assets.
 */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

import { authRouter } from './routes/auth.js';
import { kycRouter } from './routes/kyc.js';
import { tradingRouter } from './routes/trading.js';
import { walletRouter } from './routes/wallet.js';
import { apiKeyRouter } from './routes/apiKeys.js';
import { adminRouter } from './routes/admin.js';
import { listingRouter } from './routes/listing.js';
import { marketsRouter } from './routes/markets.js';
import { riskRouter } from './routes/risk.js';
import { botRouter } from './routes/bot.js';
import { volumeExecutionV2Router } from './routes/volumeExecutionV2.js';
import { volumeExecutionV2Service } from './services/bots/VolumeExecutionV2Service.js';
import { mmConsoleRouter } from './routes/mmConsole.js';
import { futuresRouter } from './routes/futures.js';
import { observabilityRouter } from './routes/observability.js';
import { marketWsService } from './websocket/MarketDataWs.js';
import { fxConversionService } from './services/external/FxConversionService.js';
import { db } from './db/database.js';
import { priceAggregatorService } from './services/external/PriceAggregatorService.js';
import { priceThresholdService } from './services/PriceThresholdService.js';
import { futuresEngine } from './services/FuturesEngine.js';
import { marketLifecycleScheduler } from './services/MarketLifecycleScheduler.js';
import { newsAdminRouter } from './routes/newsAdmin.js';
import { newsPublicRouter } from './routes/newsPublic.js';
import { notificationsRouter } from './routes/notifications.js';
import { newsCmsService } from './services/cms/NewsCmsService.js';
import { notificationBroadcastService } from './services/cms/NotificationBroadcastService.js';
import { rewardsRouter } from './routes/rewards.js';
import { rewardsAdminRouter } from './routes/rewardsAdmin.js';
import { earnRouter } from './routes/earn.js';
import { earnService } from './services/earn/EarnService.js';
import { copyTradingRouter } from './routes/copyTrading.js';
import { copyTradingService } from './services/copy/CopyTradingService.js';
import { pnlService } from './services/pnl/PnLService.js';
import { modularBotRouter } from './routes/modularBot.js';
import { modularBotOrchestrator } from './services/modularBot/ModularBotOrchestrator.js';

export async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // In AI Studio Cloud Run multi-container deployment, nginx-container binds to 8080,
  // while app-container must listen on 3000. If process.env.PORT is 8080, we must NOT
  // bind to 8080 (nginx conflict), but listen on port 3000.
  const portArgIdx = process.argv.indexOf('--port');
  const portVal = portArgIdx !== -1 ? process.argv[portArgIdx + 1] : undefined;
  const PORT = parseInt(
    portVal || (process.env.PORT && process.env.PORT !== '8080' ? process.env.PORT : '3000'),
    10
  );

  // JSON Body Parser (10mb limit supports base64-encoded 5 MB cover & asset image uploads)
  app.use(express.json({ limit: '10mb' }));

  // WebSocket Server for High-Speed Market Data
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('error', (err: any) => {
    console.error('[DIMONEX] WebSocket Server error:', err?.message || err);
  });
  marketWsService.initialize(wss);

  // Mount API Endpoints
  app.use('/api/auth', authRouter);
  app.use('/api/kyc', kycRouter);
  app.use('/api/trading', tradingRouter);
  app.use('/api/markets', marketsRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/api-keys', apiKeyRouter);
  app.use('/api/admin/listings', listingRouter);
  app.use('/api/listing', listingRouter);
  app.use('/api/admin/rewards', rewardsAdminRouter);
  app.use('/api/admin', newsAdminRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/public', newsPublicRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/rewards', rewardsRouter);
  app.use('/api/earn', earnRouter);
  app.use('/api/copy-trading', copyTradingRouter);
  app.use('/api/risk', riskRouter);
  app.use('/api/bot/volume-v2', volumeExecutionV2Router);
  app.use('/api/modular-bots', modularBotRouter);
  app.use('/api/bot', botRouter);
  app.use('/api/mm', mmConsoleRouter);
  app.use('/api/bot/mm', mmConsoleRouter);
  app.use('/api/futures', futuresRouter);
  app.use('/', observabilityRouter); // /metrics, /health, /api/ledger/verify-invariants

  // Explicit JSON 404 for any unhandled /api/* routes so they never fall through into SPA HTML
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.path}`,
      status: 404
    });
  });

  // Explicit robots.txt route for search engines and Cloud Run probes
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /api/\nDisallow: /admin\nAllow: /\n');
  });

  // Check if built static assets exist
  const distPath = path.resolve(process.cwd(), 'dist');
  const indexPath = path.resolve(distPath, 'index.html');
  const distExists = fs.existsSync(indexPath);

  if (distExists) {
    // Serve pre-built static assets when dist exists
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath, (err) => {
          if (err && !res.headersSent) {
            next(err);
          }
        });
      } else {
        next();
      }
    });
  } else {
    // Dynamically initialize Vite middleware in parallel so HTTP port binds immediately without startup timeouts
    console.log('[DIMONEX] dist/index.html not found, initializing Vite middleware...');
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    vitePromise.catch(err => {
      console.error('[DIMONEX] Vite middleware initialization failed:', err);
    });
    app.use((req, res, next) => {
      vitePromise
        .then(vite => vite.middlewares(req, res, next))
        .catch(next);
    });
  }

  // Global Error Handler to catch any file/route issues gracefully
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.code === 'ECONNABORTED' || err?.message === 'Request aborted' || req.aborted) {
      return;
    }
    if (res.headersSent) return next(err);
    console.error('[DIMONEX Server Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err?.message || 'Server error' });
  });

  server.on('error', (err: any) => {
    console.error('[DIMONEX] HTTP Server error:', err);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[DIMONEX] Full-Stack Exchange Engine listening on http://0.0.0.0:${PORT} (Mode: ${distExists ? 'PRODUCTION / STATIC' : 'DEVELOPMENT / VITE'})`);

    // Sync curated Admin WebSocket whitelist into Binance & Bybit feeds
    const binanceWsSymbols = db.getEnabledExternalWsSymbols('binance');
    const bybitWsSymbols = db.getEnabledExternalWsSymbols('bybit');
    priceAggregatorService.syncWhitelistSymbols(binanceWsSymbols, bybitWsSymbols);

    // Defer external FX sync and WS catalog initial tick seeding slightly so port binding stays instant
    setTimeout(() => {
      fxConversionService.fetchAndSyncLiveRate('system@dimonex.id', 12).then(res => {
        if (res.success && res.rateRecord) {
          console.log(`[DIMONEX FX Engine] Real live USDT/IDR FX rate loaded from ${res.source}: Rp ${res.rateRecord.rate.toLocaleString()}`);
        }
      }).catch(err => {
        console.warn('[DIMONEX FX Engine] Initial FX rate sync failed:', err.message);
      });

      for (const entry of db.externalWsWhitelist.values()) {
        if (entry.enabled) {
          priceAggregatorService.seedSymbolFromCatalog(entry.symbol, entry.providers).catch(() => {});
        }
      }
    }, 1500);

    // Start Price Threshold Alert Engine, Real Perpetual Futures Engine, Market Lifecycle Scheduler,
    // News CMS Scheduler, and Global Notification Outbox Broadcast Worker (with crash recovery)
    priceThresholdService.start();
    futuresEngine.start();
    marketLifecycleScheduler.start();
    newsCmsService.startScheduler();
    notificationBroadcastService.start();
    volumeExecutionV2Service.startRecoveryScheduler();
    earnService.startScheduler();
    copyTradingService.start();
    pnlService.startScheduler();
    modularBotOrchestrator.startRecovery();
  });

  // Clean graceful shutdown for PM2 / Cloud Run SIGTERM & SIGINT
  let isShuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[DIMONEX] Received ${signal}, flushing state and shutting down cleanly...`);
    try {
      db.flushSync();
    } catch {}
    try {
      wss.close();
    } catch {}
    try {
      server.close(() => {
        process.exit(0);
      });
    } catch {
      process.exit(0);
    }
    const forceExitTimer = setTimeout(() => process.exit(0), 1500);
    forceExitTimer.unref?.();
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

// Auto-start if executed directly
startServer().catch(err => {
  console.error('[DIMONEX] Failed to launch server:', err);
  process.exit(1);
});
