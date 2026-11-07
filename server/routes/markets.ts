/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/routes/markets.ts
 * Public Market Catalogue endpoints for DIMONEX.
 * Exposes ONLY active markets with exact integer specifications and 24h tickers.
 * Does NOT expose draft, pending, or preparing markets.
 */

import { Router } from 'express';
import { db } from '../db/database.js';

export const marketsRouter = Router();

// GET /api/markets - Public list of actively traded markets
marketsRouter.get('/', (req, res) => {
  try {
    db.recalculatePair24hStats();
    const activeMarkets = Array.from(db.markets.values())
      .filter(m => m.status === 'ACTIVE')
      .map(m => {
        const baseAsset = db.assets.get(m.baseAssetId);
        const quoteAsset = db.assets.get(m.quoteAssetId);
        const pair = db.tradingPairs.get(m.id);

        return {
          id: m.id,
          symbol: m.symbol,
          baseCurrency: baseAsset ? baseAsset.symbol : m.symbol.split('-')[0],
          quoteCurrency: quoteAsset ? quoteAsset.symbol : m.symbol.split('-')[1],
          baseDecimals: baseAsset ? baseAsset.decimals : 8,
          quoteDecimals: quoteAsset ? quoteAsset.decimals : 2,
          tickSize: m.tickSize,
          lotSize: m.lotSize,
          minQuantity: m.minQuantity,
          minNotional: m.minNotional,
          makerFeeBps: m.makerFeeBps,
          takerFeeBps: m.takerFeeBps,
          status: m.status,
          isHalted: pair ? pair.isHalted : false,
          lastPrice: pair ? pair.lastPrice : '0',
          high24h: pair ? pair.high24h : '0',
          low24h: pair ? pair.low24h : '0',
          volume24h: pair ? pair.volume24h : '0',
          quoteVolume24h: pair ? (pair.quoteVolume24h || '0') : '0',
          priceChange24h: pair ? pair.priceChange24h : '+0.00',
          priceChangePercent24h: pair ? (pair.priceChangePercent24h || '0.00') : '0.00',
          activatedAt: m.activatedAt
        };
      });

    // Gather all initial listings (active, scheduled, and pending review)
    const newListings = Array.from(db.listingRequests.values()).map(l => {
      const baseAsset = db.assets.get(l.assetId);
      const isDepositOpen = baseAsset?.depositEnabled ?? l.depositEnabled ?? true;
      const isWithdrawOpen = baseAsset?.withdrawalEnabled ?? l.withdrawalEnabled ?? true;
      const pairId = `${baseAsset?.symbol || 'TOKEN'}-IDR`;
      const pair = db.tradingPairs.get(pairId);

      return {
        id: l.id,
        pairId,
        symbol: pairId,
        baseCurrency: baseAsset?.symbol || 'TOKEN',
        quoteCurrency: 'IDR',
        tokenName: baseAsset?.name || baseAsset?.symbol,
        network: baseAsset?.network || 'TOKEN',
        contractAddress: baseAsset?.contractAddress,
        decimals: baseAsset?.decimals || 8,
        status: l.status,
        depositStatus: isDepositOpen ? 'OPEN' : 'CLOSED',
        withdrawalStatus: isWithdrawOpen ? 'OPEN' : 'CLOSED',
        depositOpenedAt: l.depositOpenedAt || baseAsset?.depositOpenedAt,
        withdrawalOpenedAt: l.withdrawalOpenedAt || baseAsset?.withdrawalOpenedAt,
        scheduledAt: l.scheduledAt,
        lastPrice: pair ? pair.lastPrice : '0',
        priceChange24h: pair ? pair.priceChange24h : '+0.00',
        marketMakerAccountId: l.marketMakerAccountId,
        projectOwnerAccountId: l.projectOwnerAccountId
      };
    });

    res.json({
      success: true,
      count: activeMarkets.length,
      markets: activeMarkets,
      newListings
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});

// GET /api/markets/:symbol - Public details of single active market
marketsRouter.get('/:symbol', (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const market = db.markets.get(symbol);

    if (!market || market.status !== 'ACTIVE') {
      return res.status(404).json({
        error: `Market ${symbol} tidak ditemukan atau belum aktif diperdagangkan`,
        code: 'MARKET_NOT_FOUND'
      });
    }

    const baseAsset = db.assets.get(market.baseAssetId);
    const quoteAsset = db.assets.get(market.quoteAssetId);
    const pair = db.tradingPairs.get(market.id);

    res.json({
      success: true,
      market: {
        id: market.id,
        symbol: market.symbol,
        baseCurrency: baseAsset ? baseAsset.symbol : market.symbol.split('-')[0],
        quoteCurrency: quoteAsset ? quoteAsset.symbol : market.symbol.split('-')[1],
        baseDecimals: baseAsset ? baseAsset.decimals : 8,
        quoteDecimals: quoteAsset ? quoteAsset.decimals : 2,
        tickSize: market.tickSize,
        lotSize: market.lotSize,
        minQuantity: market.minQuantity,
        minNotional: market.minNotional,
        makerFeeBps: market.makerFeeBps,
        takerFeeBps: market.takerFeeBps,
        status: market.status,
        isHalted: pair ? pair.isHalted : false,
        lastPrice: pair ? pair.lastPrice : '0',
        high24h: pair ? pair.high24h : '0',
        low24h: pair ? pair.low24h : '0',
        volume24h: pair ? pair.volume24h : '0',
        priceChange24h: pair ? pair.priceChange24h : '0.00',
        activatedAt: market.activatedAt
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR' });
  }
});
