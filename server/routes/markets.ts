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
    db.ensureAssetsForTradingPairs();
    db.recalculatePair24hStats();
    const assetsBySymbol = new Map(
      Array.from(db.assets.values()).map(a => [a.symbol.toUpperCase(), a])
    );

    const activeMarkets = Array.from(db.markets.values())
      .filter(m => m.status === 'ACTIVE')
      .map(m => {
        const baseSym = m.symbol.split('-')[0];
        const quoteSym = m.symbol.split('-')[1];
        const baseAsset = db.assets.get(m.baseAssetId) || assetsBySymbol.get(baseSym);
        const quoteAsset = db.assets.get(m.quoteAssetId) || assetsBySymbol.get(quoteSym);
        const pair = db.tradingPairs.get(m.id);

        return {
          id: m.id,
          symbol: m.symbol,
          baseCurrency: baseAsset ? baseAsset.symbol : baseSym,
          quoteCurrency: quoteAsset ? quoteAsset.symbol : quoteSym,
          baseName: baseAsset?.name || baseSym,
          baseLogoUrl: baseAsset?.logoUrl || '',
          quoteLogoUrl: quoteAsset?.logoUrl || '',
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
      const quoteAsset = db.assets.get(l.quoteAssetId);
      const quoteSym = quoteAsset?.symbol || 'IDR';
      const isDepositOpen = baseAsset?.depositEnabled ?? l.depositEnabled ?? true;
      const isWithdrawOpen = baseAsset?.withdrawalEnabled ?? l.withdrawalEnabled ?? true;
      const pairId = `${baseAsset?.symbol || 'TOKEN'}-${quoteSym}`;
      const pair = db.tradingPairs.get(pairId);

      return {
        id: l.id,
        pairId,
        symbol: pairId,
        baseCurrency: baseAsset?.symbol || 'TOKEN',
        quoteCurrency: quoteSym,
        tokenName: baseAsset?.name || baseAsset?.symbol,
        logoUrl: baseAsset?.logoUrl || '',
        network: baseAsset?.network || 'TOKEN',
        contractAddress: baseAsset?.contractAddress,
        decimals: baseAsset?.decimals ?? 8,
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

// GET /api/markets/assets - Public catalogue of all exchange assets (logos, names, decimals, networks)
marketsRouter.get('/assets', (req, res) => {
  try {
    const allAssets = db.ensureAssetsForTradingPairs().map(a => ({
      id: a.id,
      symbol: a.symbol,
      name: a.name,
      logoUrl: a.logoUrl || '',
      assetType: a.assetType,
      category: a.category || (a.network === 'FIAT' ? 'Fiat' : a.assetType === 'NATIVE' ? 'Layer 1' : 'Token'),
      decimals: a.decimals,
      network: a.network,
      contractAddress: a.contractAddress || '',
      description: a.description || '',
      websiteUrl: a.websiteUrl || '',
      explorerUrl: a.explorerUrl || '',
      status: a.status,
      depositEnabled: a.depositEnabled,
      withdrawalEnabled: a.withdrawalEnabled,
      updatedAt: a.updatedAt
    }));

    res.json({
      success: true,
      count: allAssets.length,
      assets: allAssets
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
        baseName: baseAsset?.name || market.symbol.split('-')[0],
        baseLogoUrl: baseAsset?.logoUrl || '',
        quoteLogoUrl: quoteAsset?.logoUrl || '',
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
