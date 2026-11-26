/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * wallet.ts
 * Wallet management: balances, Virtual Account IDR deposits/withdrawals,
 * name matching verification with KYC, crypto address generator, and block listener.
 */

import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from './auth.js';
import { db } from '../db/database.js';
import { PrecisionMath } from '../ledger/PrecisionMath.js';
import { LedgerService } from '../ledger/LedgerService.js';
import { FiatTransaction, CryptoTransaction } from '../db/types.js';
import { pnlService } from '../services/pnl/PnLService.js';

export const walletRouter = Router();

// Get User Balances (All currencies: Available vs Locked)
walletRouter.get('/balances', requireAuth, (req, res) => {
  const user = (req as any).user;
  const accounts = db.getUserAccounts(user.id);

  const formattedBalances = accounts.map(acc => {
    const availBig = BigInt(acc.balanceAvailable);
    const lockedBig = BigInt(acc.balanceLocked);
    const totalBig = availBig + lockedBig;

    const decimals = getCurrencyDecimals(acc.currency);
    const humanAvail = PrecisionMath.formatFromUnits(availBig, decimals);
    const humanLocked = PrecisionMath.formatFromUnits(lockedBig, decimals);
    const humanTotal = PrecisionMath.formatFromUnits(totalBig, decimals);

    return {
      currency: acc.currency,
      balanceAvailable: acc.balanceAvailable,
      balanceLocked: acc.balanceLocked,
      balanceTotal: totalBig.toString(),
      available: humanAvail,
      locked: humanLocked,
      total: humanTotal,
      displayAvailable: acc.currency === 'IDR' 
        ? PrecisionMath.formatIDRDisplay(availBig)
        : PrecisionMath.formatCryptoDisplay(availBig, acc.currency),
      displayLocked: acc.currency === 'IDR'
        ? PrecisionMath.formatIDRDisplay(lockedBig)
        : PrecisionMath.formatCryptoDisplay(lockedBig, acc.currency),
      displayTotal: acc.currency === 'IDR'
        ? PrecisionMath.formatIDRDisplay(totalBig)
        : PrecisionMath.formatCryptoDisplay(totalBig, acc.currency)
    };
  });

  res.json(formattedBalances);
});

// Generate Virtual Account for IDR Deposit
walletRouter.post('/idr/deposit-va', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { bankCode, amount } = req.body; // amount in plain IDR (e.g. "10000000")

    if (!bankCode || !amount) {
      return res.status(400).json({ error: 'Bank dan nominal deposit wajib diisi' });
    }

    const prefixes: Record<string, string> = {
      BCA: '88001',
      MANDIRI: '89001',
      BRI: '80001'
    };
    const prefix = prefixes[bankCode.toUpperCase()] || '88801';
    // Deterministic VA per user
    const userSuffix = user.id.replace(/\D/g, '').slice(0, 10).padEnd(10, '7');
    const vaNumber = `${prefix}${userSuffix}`;

    const amountUnits = PrecisionMath.parseToUnits(amount, 2);

    res.json({
      vaNumber,
      bankName: bankCode.toUpperCase(),
      amount: amountUnits.toString(),
      formattedAmount: PrecisionMath.formatIDRDisplay(amountUnits),
      instructions: [
        `1. Buka aplikasi m-Banking ${bankCode.toUpperCase()}`,
        '2. Pilih menu Transfer > Virtual Account',
        `3. Masukkan nomor Virtual Account: ${vaNumber}`,
        `4. Pastikan nama penerima adalah DIMONEX - ${user.email}`,
        `5. Masukkan nominal tepat: ${PrecisionMath.formatIDRDisplay(amountUnits)}`,
        '6. Konfirmasi pembayaran'
      ]
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Simulate Payment Gateway Callback / Instant VA Deposit Confirmation
walletRouter.post('/idr/simulate-deposit-payment', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { bankCode, amount } = req.body;

    const amountUnits = PrecisionMath.parseToUnits(amount, 2);
    if (amountUnits <= 0n) {
      return res.status(400).json({ error: 'Nominal deposit harus lebih dari 0' });
    }

    const txId = crypto.randomUUID();
    const idempotencyKey = `dep-idr-${txId}`;

    // Execute atomic deposit in Ledger
    LedgerService.deposit(user.id, 'IDR', amountUnits, txId, idempotencyKey);

    const fiatTx: FiatTransaction = {
      id: txId,
      userId: user.id,
      type: 'DEPOSIT',
      method: `${bankCode.toUpperCase()}_VA` as any,
      amount: amountUnits.toString(),
      status: 'COMPLETED',
      accountNumber: `VA-${bankCode}-${user.id.slice(0, 6)}`,
      accountHolderName: user.email,
      idempotencyKey,
      createdAt: Date.now()
    };
    db.fiatTransactions.set(fiatTx.id, fiatTx);

    res.json({
      success: true,
      message: `Deposit ${PrecisionMath.formatIDRDisplay(amountUnits)} via ${bankCode} berhasil masuk ke saldo IDR Anda!`,
      transaction: fiatTx
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// IDR Withdrawal Request with KYC Name Matching Verification
walletRouter.post('/idr/withdraw', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { bankName, accountNumber, accountHolderName, amount } = req.body;

    if (!bankName || !accountNumber || !accountHolderName || !amount) {
      return res.status(400).json({ error: 'Seluruh data penarikan wajib diisi lengkap' });
    }

    // 1. Check KYC verification
    const kyc = db.kyc.get(user.id);
    if (!kyc || kyc.status !== 'approved') {
      return res.status(403).json({ error: 'Penarikan dana memerlukan akun KYC yang telah terverifikasi' });
    }

    // 2. Security Check: Bank account holder name MUST match KYC Full Name
    const cleanHolder = accountHolderName.trim().toLowerCase();
    const cleanKyc = kyc.fullName.trim().toLowerCase();
    if (cleanHolder !== cleanKyc) {
      return res.status(400).json({
        error: `Nama pemilik rekening bank (${accountHolderName}) TIDAK COCOK dengan nama KYC Anda (${kyc.fullName}). Penarikan ke rekening pihak ketiga dilarang keras demi kepatuhan regulasi.`
      });
    }

    const amountUnits = PrecisionMath.parseToUnits(amount, 2);
    const userAcc = db.createOrGetAccount(user.id, 'IDR');
    const avail = BigInt(userAcc.balanceAvailable);

    if (avail < amountUnits) {
      return res.status(400).json({ error: 'Saldo IDR yang tersedia tidak mencukupi' });
    }

    // Lock funds for withdrawal
    LedgerService.lockBalance(user.id, 'IDR', amountUnits);

    const txId = crypto.randomUUID();
    const idempotencyKey = `wd-idr-${txId}`;

    // Large withdrawals (> IDR 10,000,000) go to PENDING approval queue
    const isLarge = amountUnits > 1000000000n; // > Rp 10,000,000.00
    const status = isLarge ? 'PENDING' : 'COMPLETED';

    if (!isLarge) {
      // Auto-settle small withdrawal in ledger
      const locked = BigInt(userAcc.balanceLocked);
      userAcc.balanceLocked = (locked - amountUnits).toString();
      userAcc.version += 1;
      userAcc.updatedAt = Date.now();
    }

    const fiatTx: FiatTransaction = {
      id: txId,
      userId: user.id,
      type: 'WITHDRAW',
      method: 'BANK_TRANSFER',
      amount: amountUnits.toString(),
      status,
      accountNumber,
      accountHolderName: kyc.fullName,
      idempotencyKey,
      createdAt: Date.now()
    };
    db.fiatTransactions.set(fiatTx.id, fiatTx);

    res.json({
      success: true,
      message: isLarge 
        ? 'Permintaan penarikan nominal besar telah masuk antrean persetujuan tim kepatuhan DIMONEX'
        : 'Penarikan IDR berhasil diproses ke rekening bank Anda',
      transaction: fiatTx
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Supported Assets List (All Tokens from Market and Listing)
walletRouter.get('/supported-assets', (req, res) => {
  const currencies = db.getAllCurrencies();
  const assetsList = currencies.map(curr => {
    const clean = curr.toUpperCase();
    const isFiat = clean === 'IDR';
    const decimals = getCurrencyDecimals(clean);
    const networks = getCurrencyNetworks(clean);

    let name = clean;
    for (const a of db.assets.values()) {
      if (a.symbol.toUpperCase() === clean) {
        name = a.name;
        break;
      }
    }
    if (name === clean) {
      if (clean === 'BTC') name = 'Bitcoin';
      else if (clean === 'ETH') name = 'Ethereum';
      else if (clean === 'USDT') name = 'Tether USD';
      else if (clean === 'SOL') name = 'Solana';
      else if (clean === 'TON') name = 'The Open Network';
      else if (clean === 'DOGE') name = 'Dogecoin';
      else if (clean === 'IDR') name = 'Indonesian Rupiah';
    }

    // Default presets
    let presets = [
      { label: `1 ${clean}`, value: '1' },
      { label: `5 ${clean}`, value: '5' },
      { label: `10 ${clean}`, value: '10' },
      { label: `50 ${clean}`, value: '50' }
    ];
    if (clean === 'IDR') {
      presets = [
        { label: 'Rp 5 Juta', value: '5000000' },
        { label: 'Rp 10 Juta', value: '10000000' },
        { label: 'Rp 50 Juta', value: '50000000' },
        { label: 'Rp 100 Juta', value: '100000000' }
      ];
    } else if (clean === 'BTC') {
      presets = [
        { label: '0.01 BTC', value: '0.01' },
        { label: '0.05 BTC', value: '0.05' },
        { label: '0.1 BTC', value: '0.1' },
        { label: '0.5 BTC', value: '0.5' }
      ];
    } else if (clean === 'ETH') {
      presets = [
        { label: '0.2 ETH', value: '0.2' },
        { label: '0.5 ETH', value: '0.5' },
        { label: '1.0 ETH', value: '1.0' },
        { label: '2.0 ETH', value: '2.0' }
      ];
    } else if (clean === 'USDT') {
      presets = [
        { label: '100 USDT', value: '100' },
        { label: '500 USDT', value: '500' },
        { label: '1,000 USDT', value: '1000' },
        { label: '5,000 USDT', value: '5000' }
      ];
    } else if (clean === 'SOL') {
      presets = [
        { label: '2 SOL', value: '2' },
        { label: '5 SOL', value: '5' },
        { label: '10 SOL', value: '10' },
        { label: '25 SOL', value: '25' }
      ];
    } else if (clean === 'TON') {
      presets = [
        { label: '10 TON', value: '10' },
        { label: '50 TON', value: '50' },
        { label: '100 TON', value: '100' },
        { label: '500 TON', value: '500' }
      ];
    } else if (clean === 'DOGE') {
      presets = [
        { label: '500 DOGE', value: '500' },
        { label: '1,000 DOGE', value: '1000' },
        { label: '5,000 DOGE', value: '5000' },
        { label: '10,000 DOGE', value: '10000' }
      ];
    }

    return {
      symbol: clean,
      name,
      isFiat,
      decimals,
      networks,
      presets,
      status: 'ACTIVE',
      depositEnabled: true,
      withdrawalEnabled: true
    };
  });

  res.json(assetsList);
});

// Helper for dynamic decimals
function getCurrencyDecimals(currency: string): number {
  const clean = currency.toUpperCase();
  if (clean === 'IDR') return 2;
  if (clean === 'USDT' || clean === 'USDC') return 6;
  for (const asset of db.assets.values()) {
    if (asset.symbol.toUpperCase() === clean) return asset.decimals;
  }
  for (const pair of db.tradingPairs.values()) {
    if (pair.baseCurrency.toUpperCase() === clean) return pair.baseDecimals;
    if (pair.quoteCurrency.toUpperCase() === clean) return pair.quoteDecimals;
  }
  return 8;
}

// Helper for dynamic networks
function getCurrencyNetworks(currency: string): { id: string; name: string; fee: string; minDeposit: string; confirmations: number }[] {
  const clean = currency.toUpperCase();
  if (clean === 'IDR') {
    return [
      { id: 'VA_BCA', name: 'BCA Virtual Account', fee: 'Rp 0', minDeposit: 'Rp 50.000', confirmations: 1 },
      { id: 'VA_MANDIRI', name: 'Mandiri Virtual Account', fee: 'Rp 0', minDeposit: 'Rp 50.000', confirmations: 1 },
      { id: 'VA_BRI', name: 'BRI Virtual Account', fee: 'Rp 0', minDeposit: 'Rp 50.000', confirmations: 1 },
    ];
  }
  if (clean === 'USDT') {
    return [
      { id: 'TRC20', name: 'Tron (TRC20)', fee: '1.00 USDT', minDeposit: '10.00 USDT', confirmations: 1 },
      { id: 'ERC20', name: 'Ethereum (ERC20)', fee: '3.50 USDT', minDeposit: '20.00 USDT', confirmations: 12 },
      { id: 'ARBITRUM', name: 'Arbitrum One (L2)', fee: '0.20 USDT', minDeposit: '5.00 USDT', confirmations: 20 },
      { id: 'SOLANA', name: 'Solana (SPL)', fee: '0.50 USDT', minDeposit: '5.00 USDT', confirmations: 32 },
    ];
  }
  if (clean === 'BTC') {
    return [
      { id: 'BITCOIN', name: 'Bitcoin (Native SegWit)', fee: '0.0001 BTC', minDeposit: '0.0005 BTC', confirmations: 2 },
      { id: 'LIGHTNING', name: 'Lightning Network', fee: '0.00001 BTC', minDeposit: '0.0001 BTC', confirmations: 1 },
      { id: 'BEP20', name: 'BNB Smart Chain (BEP20)', fee: '0.00005 BTC', minDeposit: '0.0002 BTC', confirmations: 15 },
    ];
  }
  if (clean === 'ETH') {
    return [
      { id: 'ERC20', name: 'Ethereum (ERC20)', fee: '0.0015 ETH', minDeposit: '0.005 ETH', confirmations: 12 },
      { id: 'ARBITRUM', name: 'Arbitrum One (L2)', fee: '0.0001 ETH', minDeposit: '0.001 ETH', confirmations: 20 },
      { id: 'OPTIMISM', name: 'OP Mainnet', fee: '0.0001 ETH', minDeposit: '0.001 ETH', confirmations: 20 },
    ];
  }
  if (clean === 'SOL') {
    return [
      { id: 'SOLANA', name: 'Solana (SPL)', fee: '0.005 SOL', minDeposit: '0.01 SOL', confirmations: 32 },
    ];
  }
  if (clean === 'TON') {
    return [
      { id: 'TON', name: 'The Open Network (TON)', fee: '0.05 TON', minDeposit: '0.1 TON', confirmations: 12 },
    ];
  }
  if (clean === 'DOGE') {
    return [
      { id: 'DOGECOIN', name: 'Dogecoin Network', fee: '2.0 DOGE', minDeposit: '5.0 DOGE', confirmations: 10 },
    ];
  }
  return [
    { id: `${clean}_MAINNET`, name: `${clean} Native Network`, fee: `0.01 ${clean}`, minDeposit: `0.1 ${clean}`, confirmations: 12 },
    { id: 'ERC20', name: 'Ethereum (ERC20)', fee: `0.05 ${clean}`, minDeposit: `0.5 ${clean}`, confirmations: 12 }
  ];
}

// Helper for deterministic address
function generateDeterministicCryptoAddress(userId: string, currency: string, network?: string): { address: string; chain: string } {
  const clean = currency.toUpperCase();
  const userHash = crypto.createHash('sha256').update(userId + clean + (network || '')).digest('hex');

  if (clean === 'BTC') {
    return { address: `bc1q${userHash.slice(0, 38)}`, chain: 'Bitcoin Native SegWit' };
  }
  if (clean === 'ETH' || (clean === 'USDT' && network === 'ERC20') || network === 'ERC20' || network === 'ARBITRUM' || network === 'OPTIMISM') {
    return { address: `0x${userHash.slice(0, 40)}`, chain: 'Ethereum (ERC-20)' };
  }
  if (clean === 'USDT' || network === 'TRC20' || clean === 'TRX') {
    return { address: `T${userHash.slice(0, 33).toUpperCase()}`, chain: 'TRON (TRC-20)' };
  }
  if (clean === 'SOL' || network === 'SOLANA') {
    return { address: `${userHash.slice(0, 32)}sol`, chain: 'Solana (SPL)' };
  }
  if (clean === 'TON') {
    return { address: `EQD${userHash.slice(0, 40)}`, chain: 'The Open Network (TON)' };
  }
  if (clean === 'DOGE') {
    return { address: `D${userHash.slice(0, 33)}`, chain: 'Dogecoin Network' };
  }
  return { address: `0x${userHash.slice(0, 40)}`, chain: `${clean} Mainnet` };
}

// Generate / Get Crypto Deposit Address for ANY supported currency
walletRouter.get('/crypto/deposit-address/:currency', requireAuth, (req, res) => {
  const user = (req as any).user;
  const currency = req.params.currency.toUpperCase();
  const network = (req.query.network as string) || '';

  const { address, chain } = generateDeterministicCryptoAddress(user.id, currency, network);

  const minDeposits: Record<string, string> = {
    BTC: '0.0001 BTC',
    ETH: '0.005 ETH',
    USDT: '10.00 USDT',
    SOL: '0.05 SOL',
    TON: '0.1 TON',
    DOGE: '5.0 DOGE'
  };

  const confirmations: Record<string, number> = {
    BTC: 3,
    ETH: 12,
    USDT: 20,
    SOL: 32,
    TON: 12,
    DOGE: 10
  };

  res.json({
    currency,
    chain,
    address,
    minDeposit: minDeposits[currency] || `0.1 ${currency}`,
    confirmationsRequired: confirmations[currency] || 12
  });
});

// Simulate Incoming Blockchain Deposit for ANY supported currency
walletRouter.post('/crypto/simulate-deposit-block', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { currency, amount, network } = req.body;

    if (!currency || !amount) {
      return res.status(400).json({ error: 'Mata uang kripto dan nominal wajib diisi' });
    }

    const cleanCurr = currency.toUpperCase();
    const decimals = getCurrencyDecimals(cleanCurr);
    const amountUnits = PrecisionMath.parseToUnits(amount, decimals);

    if (amountUnits <= 0n) {
      return res.status(400).json({ error: 'Nominal deposit harus lebih dari 0' });
    }

    const txHash = '0x' + crypto.randomBytes(32).toString('hex');
    const txId = crypto.randomUUID();

    // Deposit to user ledger
    LedgerService.deposit(user.id, cleanCurr, amountUnits, txId, `dep-crypto-${txId}`);

    const { address, chain } = generateDeterministicCryptoAddress(user.id, cleanCurr, network);

    const cryptoTx: CryptoTransaction = {
      id: txId,
      userId: user.id,
      type: 'DEPOSIT',
      currency: cleanCurr,
      chain,
      address,
      amount: amountUnits.toString(),
      txHash,
      status: 'COMPLETED',
      confirmations: 12,
      requiredConfirmations: 12,
      createdAt: Date.now()
    };
    db.cryptoTransactions.set(cryptoTx.id, cryptoTx);

    res.json({
      success: true,
      message: `Deposit ${amount} ${cleanCurr} berhasil dikonfirmasi di blockchain (12/12 blok)!`,
      transaction: cryptoTx
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Crypto Withdrawal for ANY supported currency
walletRouter.post('/crypto/withdraw', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const { currency, address, amount, network } = req.body;

    if (!currency || !address || !amount) {
      return res.status(400).json({ error: 'Mata uang, alamat penarikan, dan nominal wajib diisi' });
    }

    const cleanCurr = currency.toUpperCase();
    const decimals = getCurrencyDecimals(cleanCurr);
    const amountUnits = PrecisionMath.parseToUnits(amount, decimals);

    if (amountUnits <= 0n) {
      return res.status(400).json({ error: 'Nominal penarikan harus lebih dari 0' });
    }

    const userAcc = db.createOrGetAccount(user.id, cleanCurr);
    const avail = BigInt(userAcc.balanceAvailable);

    if (avail < amountUnits) {
      return res.status(400).json({ error: `Saldo ${cleanCurr} tidak mencukupi untuk penarikan ini` });
    }

    // Lock funds
    LedgerService.lockBalance(user.id, cleanCurr, amountUnits);

    const txId = crypto.randomUUID();
    const { chain } = generateDeterministicCryptoAddress(user.id, cleanCurr, network);

    const cryptoTx: CryptoTransaction = {
      id: txId,
      userId: user.id,
      type: 'WITHDRAW',
      currency: cleanCurr,
      chain,
      address,
      amount: amountUnits.toString(),
      txHash: '0x' + crypto.randomBytes(32).toString('hex'),
      status: 'PENDING', // Cold wallet approval queue
      confirmations: 0,
      requiredConfirmations: 12,
      createdAt: Date.now()
    };
    db.cryptoTransactions.set(cryptoTx.id, cryptoTx);

    res.json({
      success: true,
      message: `Permintaan penarikan ${amount} ${cleanCurr} telah masuk antrean persetujuan penarikan cold wallet`,
      transaction: cryptoTx
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get Combined Authentic User Transactions History
walletRouter.get('/transactions', requireAuth, (req, res) => {
  const user = (req as any).user;
  const fiatTxs = Array.from(db.fiatTransactions.values()).filter(tx => tx.userId === user.id);
  const cryptoTxs = Array.from(db.cryptoTransactions.values()).filter(tx => tx.userId === user.id);

  const formattedTxs = [
    ...fiatTxs.map(tx => ({
      id: tx.id,
      type: tx.type === 'DEPOSIT' ? 'DEPOSIT' : 'WITHDRAW',
      asset: 'IDR',
      amount: PrecisionMath.formatIDRDisplay(BigInt(tx.amount)),
      rawAmount: tx.amount,
      status: tx.status,
      time: new Date(tx.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
      timestamp: tx.createdAt,
      txid: tx.accountNumber || tx.idempotencyKey || tx.id,
      method: tx.method
    })),
    ...cryptoTxs.map(tx => ({
      id: tx.id,
      type: tx.type === 'DEPOSIT' ? 'DEPOSIT' : 'WITHDRAW',
      asset: tx.currency,
      amount: PrecisionMath.formatCryptoDisplay(BigInt(tx.amount), tx.currency),
      rawAmount: tx.amount,
      status: tx.status,
      time: new Date(tx.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
      timestamp: tx.createdAt,
      txid: tx.txHash ? `${tx.txHash.slice(0, 8)}...${tx.txHash.slice(-6)}` : tx.id,
      method: tx.chain
    }))
  ].sort((a, b) => b.timestamp - a.timestamp);

  res.json(formattedTxs);
});

// Balance & Trading Engine Synchronization Diagnostics
walletRouter.get('/diagnostics', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const currencies = ['IDR', 'BTC', 'ETH', 'USDT', 'SOL'];

    // 1. Ledger Accounts State
    const accounts = db.getUserAccounts(user.id);

    // 2. Open Orders on Matching Engine for this User
    const userOpenOrders = Array.from(db.orders.values()).filter(
      o => o.userId === user.id && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
    );

    // 3. Active Bots for this User
    const userBots = Array.from(db.botInstances.values()).filter(
      b => b.ownerUserId === user.id || b.accountId === user.id
    );

    // Calculate locked sums per currency from open orders
    const engineLockedPerCurrency: Record<string, bigint> = {
      IDR: 0n,
      BTC: 0n,
      ETH: 0n,
      USDT: 0n,
      SOL: 0n
    };

    userOpenOrders.forEach(o => {
      const curr = o.lockedCurrency;
      if (curr && engineLockedPerCurrency[curr] !== undefined) {
        engineLockedPerCurrency[curr] += BigInt(o.lockedAmount || '0');
      }
    });

    let totalDriftCount = 0;
    const currencyDiagnostics = currencies.map(curr => {
      const acc = accounts.find(a => a.currency === curr) || db.createOrGetAccount(user.id, curr);
      const ledgerAvail = BigInt(acc.balanceAvailable);
      const ledgerLocked = BigInt(acc.balanceLocked);
      const ledgerTotal = ledgerAvail + ledgerLocked;
      const engineLocked = engineLockedPerCurrency[curr] || 0n;

      const drift = ledgerLocked - engineLocked;
      const isSynced = drift === 0n;
      if (!isSynced) totalDriftCount++;

      const decimals = curr === 'IDR' ? 2 : (curr === 'USDT' ? 6 : 8);

      return {
        currency: curr,
        ledgerAvailable: PrecisionMath.formatFromUnits(ledgerAvail, decimals),
        ledgerLocked: PrecisionMath.formatFromUnits(ledgerLocked, decimals),
        ledgerTotal: PrecisionMath.formatFromUnits(ledgerTotal, decimals),
        engineLocked: PrecisionMath.formatFromUnits(engineLocked, decimals),
        drift: PrecisionMath.formatFromUnits(drift, decimals),
        rawLedgerAvailable: ledgerAvail.toString(),
        rawLedgerLocked: ledgerLocked.toString(),
        rawEngineLocked: engineLocked.toString(),
        rawDrift: drift.toString(),
        isSynced
      };
    });

    // 4. Audit Log Entries related to this user
    const userAuditEntries = db.auditLogs
      .filter(l => l.actorId === user.id)
      .slice(-10)
      .map(l => ({
        id: l.id,
        action: l.action,
        resource: l.resource,
        timestamp: l.createdAt,
        formattedTime: new Date(l.createdAt).toLocaleTimeString('id-ID'),
        status: 'LOGGED',
        details: l.details
      }));

    res.json({
      timestamp: Date.now(),
      status: totalDriftCount === 0 ? 'SYNCHRONIZED' : 'DRIFT_DETECTED',
      totalDriftCount,
      currencies: currencyDiagnostics,
      openOrders: userOpenOrders.map(o => ({
        id: o.id,
        pairId: o.pairId,
        side: o.side,
        type: o.orderType,
        price: o.price,
        quantity: o.quantity,
        lockedAmount: o.lockedAmount,
        lockedCurrency: o.lockedCurrency,
        status: o.status,
        createdAt: o.createdAt
      })),
      activeBots: userBots.map(b => ({
        id: b.id,
        name: b.name,
        strategy: b.botType,
        pairId: b.pairId,
        status: b.status,
        allocatedBalance: b.depthLiquidityConfig?.maximum_total_bid_value_idr || '0',
        activeOrdersCount: b.depthLiquidityConfig?.activeOrderIds?.length || 0,
        tradesCount: b.stats?.totalTrades || 0,
        realizedPnl: b.stats?.executedVolume || '0'
      })),
      recentAuditLogs: userAuditEntries
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-Reconcile Balance Discrepancy Endpoint
walletRouter.post('/diagnostics/reconcile', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const currencies = ['IDR', 'BTC', 'ETH', 'USDT', 'SOL'];
    const accounts = db.getUserAccounts(user.id);

    const userOpenOrders = Array.from(db.orders.values()).filter(
      o => o.userId === user.id && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
    );

    const engineLockedPerCurrency: Record<string, bigint> = {
      IDR: 0n, BTC: 0n, ETH: 0n, USDT: 0n, SOL: 0n
    };

    userOpenOrders.forEach(o => {
      const curr = o.lockedCurrency;
      if (curr && engineLockedPerCurrency[curr] !== undefined) {
        engineLockedPerCurrency[curr] += BigInt(o.lockedAmount || '0');
      }
    });

    let reconciledCount = 0;
    currencies.forEach(curr => {
      const acc = accounts.find(a => a.currency === curr);
      if (!acc) return;

      const currentLocked = BigInt(acc.balanceLocked);
      const trueEngineLocked = engineLockedPerCurrency[curr] || 0n;

      if (currentLocked !== trueEngineLocked) {
        const drift = currentLocked - trueEngineLocked;
        const currentAvail = BigInt(acc.balanceAvailable);
        
        // Return leaked locked balance back to available
        acc.balanceAvailable = (currentAvail + drift).toString();
        acc.balanceLocked = trueEngineLocked.toString();
        acc.version += 1;
        acc.updatedAt = Date.now();
        reconciledCount++;
      }
    });

    db.scheduleSave();

    res.json({
      success: true,
      message: reconciledCount > 0 
        ? `Berhasil merekonsiliasi ${reconciledCount} akun mata uang dengan buku order engine.`
        : 'Seluruh saldo ledger sudah 100% sinkron dengan buku order engine.',
      reconciledCount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// REAL-TIME PNL ANALYTICS & PERSISTENT DAILY CALENDAR ENDPOINT (100% REAL DATA)
// ============================================================================
walletRouter.get('/pnl-analytics', requireAuth, (req, res) => {
  try {
    const user = (req as any).user;
    const requestedMonth =
      typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : undefined;
    const requestedCurrency =
      String(req.query.currency || 'IDR').toUpperCase() === 'USDT' ? 'USDT' : 'IDR';

    const analytics = pnlService.getUserPnLAnalytics(user.id, requestedMonth, requestedCurrency);
    res.json(analytics);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Gagal memuat analitik PnL' });
  }
});


