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
import { mmConsoleRouter } from './routes/mmConsole.js';
import { observabilityRouter } from './routes/observability.js';
import { marketWsService } from './websocket/MarketDataWs.js';
import { fxConversionService } from './services/external/FxConversionService.js';

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

  // JSON Body Parser
  app.use(express.json());

  // WebSocket Server for High-Speed Market Data
  const wss = new WebSocketServer({ server, path: '/ws' });
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
  app.use('/api/admin', adminRouter);
  app.use('/api/risk', riskRouter);
  app.use('/api/bot', botRouter);
  app.use('/api/mm', mmConsoleRouter);
  app.use('/api/bot/mm', mmConsoleRouter);
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
    // Dynamically mount Vite middleware if dist has not been generated or in development
    console.log('[DIMONEX] dist/index.html not found, initializing Vite middleware...');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Global Error Handler to catch any file/route issues gracefully
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    console.error('[DIMONEX Server Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err?.message || 'Server error' });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[DIMONEX] Full-Stack Exchange Engine listening on http://0.0.0.0:${PORT} (Mode: ${distExists ? 'PRODUCTION / STATIC' : 'DEVELOPMENT / VITE'})`);

    // Fetch real live market FX rate from external API on startup - NO MOCK OR FAKE PRICES
    fxConversionService.fetchAndSyncLiveRate('system@dimonex.id', 12).then(res => {
      if (res.success && res.rateRecord) {
        console.log(`[DIMONEX FX Engine] Real live USDT/IDR FX rate loaded from ${res.source}: Rp ${res.rateRecord.rate.toLocaleString()}`);
      }
    }).catch(err => {
      console.warn('[DIMONEX FX Engine] Initial FX rate sync failed:', err.message);
    });

    // Background periodic live rate sync every 60 seconds
    setInterval(() => {
      fxConversionService.fetchAndSyncLiveRate('system@dimonex.id', 12).catch(() => {});
    }, 60000);
  });
}

// Auto-start if executed directly
startServer().catch(err => {
  console.error('[DIMONEX] Failed to launch server:', err);
  process.exit(1);
});
