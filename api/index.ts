/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * api/index.ts
 * Vercel Serverless Function entry point for DIMONEX REST API.
 * Mounts all Express routers so /api endpoints function seamlessly on Vercel serverless.
 */

import express from 'express';
import { authRouter } from '../server/routes/auth.js';
import { kycRouter } from '../server/routes/kyc.js';
import { tradingRouter } from '../server/routes/trading.js';
import { walletRouter } from '../server/routes/wallet.js';
import { apiKeyRouter } from '../server/routes/apiKeys.js';
import { adminRouter } from '../server/routes/admin.js';
import { riskRouter } from '../server/routes/risk.js';
import { botRouter } from '../server/routes/bot.js';
import { mmConsoleRouter } from '../server/routes/mmConsole.js';
import { observabilityRouter } from '../server/routes/observability.js';

const app = express();
app.use(express.json());

// Mount API Endpoints
app.use('/api/auth', authRouter);
app.use('/api/kyc', kycRouter);
app.use('/api/trading', tradingRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/api-keys', apiKeyRouter);
app.use('/api/admin', adminRouter);
app.use('/api/risk', riskRouter);
app.use('/api/bot', botRouter);
app.use('/api/mm', mmConsoleRouter);
app.use('/api/bot/mm', mmConsoleRouter);
app.use('/', observabilityRouter);

// Fallback JSON 404 for any unhandled /api/* paths
app.all('/api/*', (req, res) => {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.path}`,
    status: 404
  });
});

export default app;
