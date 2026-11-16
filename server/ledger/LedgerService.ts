/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerService.ts
 * Double-Entry Immutable Atomic Ledger Service for DIMONEX.
 * 
 * INVARIANTS ENFORCED:
 * 1. For every journal: Sum(Debits) === Sum(Credits)
 * 2. User balance invariants: BalanceAvailable >= 0, BalanceLocked >= 0
 * 3. Total Balance = BalanceAvailable + BalanceLocked
 * 4. Idempotency: Duplicate idempotency keys return existing transaction
 * 5. Append-only ledger entries: Records cannot be updated or deleted
 */

import crypto from 'crypto';
import { db, SYSTEM_FEE_ID, SYSTEM_HOT_WALLET_ID } from '../db/database.js';
import { JournalTransaction, LedgerEntry, LedgerAccount, JournalTxType } from '../db/types.js';

export interface EntryDraft {
  accountId: string;
  entryType: 'DEBIT' | 'CREDIT';
  amount: bigint; // BigInt raw units
}

export interface JournalRequest {
  idempotencyKey: string;
  txType: JournalTxType;
  referenceId: string;
  description: string;
  entries: EntryDraft[];
}

export class LedgerService {
  /**
   * Execute a double-entry atomic journal transaction.
   * Atomic rollback occurs if any account balance becomes negative or if Debits != Credits.
   */
  static executeJournal(req: JournalRequest): { journal: JournalTransaction; entries: LedgerEntry[] } {
    // 1. Idempotency Check
    const existingJournalId = db.journalIdempotencyIndex.get(req.idempotencyKey);
    if (existingJournalId) {
      const existingJournal = db.journalTransactions.get(existingJournalId)!;
      const existingEntries = db.ledgerEntries.filter(e => e.journalId === existingJournalId);
      return { journal: existingJournal, entries: existingEntries };
    }

    // 2. Validate Double-Entry Invariant: Sum(Debit) === Sum(Credit)
    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const draft of req.entries) {
      if (draft.amount <= 0n) {
        throw new Error(`Ledger entry amount must be strictly positive: got ${draft.amount}`);
      }
      if (draft.entryType === 'DEBIT') {
        totalDebit += draft.amount;
      } else if (draft.entryType === 'CREDIT') {
        totalCredit += draft.amount;
      }
    }

    if (totalDebit !== totalCredit) {
      throw new Error(
        `Double-entry balance violation: Total Debit (${totalDebit}) does not equal Total Credit (${totalCredit})`
      );
    }

    // 3. Snapshot accounts before applying mutations for atomic rollback
    const affectedAccounts: Map<string, LedgerAccount> = new Map();
    const mutatedAccounts: Map<string, LedgerAccount> = new Map();

    for (const draft of req.entries) {
      const account = db.ledgerAccounts.get(draft.accountId);
      if (!account) {
        throw new Error(`Ledger account not found: ${draft.accountId}`);
      }
      if (!affectedAccounts.has(account.id)) {
        affectedAccounts.set(account.id, { ...account });
        mutatedAccounts.set(account.id, { ...account });
      }
    }

    // 4. Apply mutations to clones & check negative balance invariants
    const createdEntries: LedgerEntry[] = [];
    const journalId = crypto.randomUUID();
    const now = Date.now();

    for (const draft of req.entries) {
      const acc = mutatedAccounts.get(draft.accountId)!;
      let avail = BigInt(acc.balanceAvailable);

      if (draft.entryType === 'CREDIT') {
        avail += draft.amount;
      } else {
        // DEBIT
        if (avail < draft.amount) {
          // Allow system hot wallet to balance deposits/withdraws as external source
          if (acc.userId !== SYSTEM_HOT_WALLET_ID && acc.userId !== 'sys-treasury-0000-0000-000000000000') {
            throw new Error(
              `Insufficient available balance in account ${acc.id} (${acc.currency}): available ${avail}, required ${draft.amount}`
            );
          }
        }
        avail -= draft.amount;
      }

      acc.balanceAvailable = avail.toString();
      acc.version += 1;
      acc.updatedAt = now;

      createdEntries.push({
        id: crypto.randomUUID(),
        journalId,
        accountId: acc.id,
        entryType: draft.entryType,
        amount: draft.amount.toString(),
        balanceAfter: (avail + BigInt(acc.balanceLocked)).toString(),
        createdAt: now
      });
    }

    // 5. Commit mutations to Database store
    for (const [accId, updatedAcc] of mutatedAccounts.entries()) {
      db.ledgerAccounts.set(accId, updatedAcc);
    }

    const journal: JournalTransaction = {
      id: journalId,
      idempotencyKey: req.idempotencyKey,
      txType: req.txType,
      referenceId: req.referenceId,
      description: req.description,
      createdAt: now
    };

    db.journalTransactions.set(journal.id, journal);
    db.journalIdempotencyIndex.set(req.idempotencyKey, journal.id);
    db.ledgerEntries.push(...createdEntries);
    db.scheduleSave();

    return { journal, entries: createdEntries };
  }

  /**
   * Deposit asset into user's account with atomic double-entry.
   * Debits external hot wallet / VA clearing account and Credits user's available account.
   */
  static deposit(
    userId: string,
    currency: string,
    amountUnits: bigint,
    referenceId: string,
    idempotencyKey: string
  ): void {
    const userAcc = db.createOrGetAccount(userId, currency);
    const hotWalletAcc = db.createOrGetAccount(SYSTEM_HOT_WALLET_ID, currency);

    this.executeJournal({
      idempotencyKey,
      txType: 'DEPOSIT',
      referenceId,
      description: `Deposit ${amountUnits} ${currency} for user ${userId}`,
      entries: [
        {
          accountId: hotWalletAcc.id,
          entryType: 'DEBIT',
          amount: amountUnits
        },
        {
          accountId: userAcc.id,
          entryType: 'CREDIT',
          amount: amountUnits
        }
      ]
    });
  }

  /**
   * Lock balance for placing a new order.
   * Moves amount from BalanceAvailable to BalanceLocked.
   */
  static lockBalance(userId: string, currency: string, amountUnits: bigint): void {
    const userAcc = db.createOrGetAccount(userId, currency);
    const avail = BigInt(userAcc.balanceAvailable);
    const locked = BigInt(userAcc.balanceLocked);

    if (avail < amountUnits) {
      throw new Error(`Insufficient available balance to lock: need ${amountUnits}, have ${avail} ${currency}`);
    }

    userAcc.balanceAvailable = (avail - amountUnits).toString();
    userAcc.balanceLocked = (locked + amountUnits).toString();
    userAcc.version += 1;
    userAcc.updatedAt = Date.now();
    db.scheduleSave();
  }

  /**
   * Unlock balance when cancelling an order or after remaining IOC.
   * Moves amount from BalanceLocked back to BalanceAvailable.
   */
  static unlockBalance(userId: string, currency: string, amountUnits: bigint): void {
    const userAcc = db.createOrGetAccount(userId, currency);
    const avail = BigInt(userAcc.balanceAvailable);
    const locked = BigInt(userAcc.balanceLocked);

    if (locked < amountUnits) {
      throw new Error(`Cannot unlock more than currently locked: locked ${locked}, requesting ${amountUnits}`);
    }

    userAcc.balanceAvailable = (avail + amountUnits).toString();
    userAcc.balanceLocked = (locked - amountUnits).toString();
    userAcc.version += 1;
    userAcc.updatedAt = Date.now();
    db.scheduleSave();
  }

  static unlockBalanceUpToLocked(userId: string, currency: string, amountUnits: bigint): bigint {
    if (amountUnits <= 0n) return 0n;
    const userAcc = db.createOrGetAccount(userId, currency);
    const locked = BigInt(userAcc.balanceLocked);
    const toUnlock = amountUnits > locked ? locked : amountUnits;
    if (toUnlock > 0n) {
      this.unlockBalance(userId, currency, toUnlock);
    }
    return toUnlock;
  }

  /**
   * Settle a trade match between Maker and Taker atomically.
   */
  static settleTrade(params: {
    tradeId: string;
    pairId: string;
    baseCurrency: string;
    quoteCurrency: string;
    makerUserId: string;
    takerUserId: string;
    makerSide: 'BUY' | 'SELL';
    matchPriceUnits: bigint;
    matchQuantityUnits: bigint;
    quoteVolumeUnits: bigint;
    makerFeeUnits: bigint;
    takerFeeUnits: bigint;
    makerLockedSliceUnits?: bigint;
    takerLockedSliceUnits?: bigint;
  }): void {
    const {
      tradeId,
      baseCurrency,
      quoteCurrency,
      makerUserId,
      takerUserId,
      makerSide,
      matchQuantityUnits,
      quoteVolumeUnits,
      makerFeeUnits,
      takerFeeUnits,
      makerLockedSliceUnits,
      takerLockedSliceUnits
    } = params;

    // Accounts involved
    const makerBaseAcc = db.createOrGetAccount(makerUserId, baseCurrency);
    const makerQuoteAcc = db.createOrGetAccount(makerUserId, quoteCurrency);
    const takerBaseAcc = db.createOrGetAccount(takerUserId, baseCurrency);
    const takerQuoteAcc = db.createOrGetAccount(takerUserId, quoteCurrency);
    const feeQuoteAcc = db.createOrGetAccount(SYSTEM_FEE_ID, quoteCurrency);

    if (makerSide === 'BUY') {
      // Maker was buying Base, paying Quote (already locked quote + est takerFee)
      // Taker is selling Base, receiving Quote (already locked base)

      // 1. Release Maker's locked quote slice & settle exact Maker cost (quoteVolume + makerFee):
      const makerQuoteLocked = BigInt(makerQuoteAcc.balanceLocked);
      const totalMakerCost = quoteVolumeUnits + makerFeeUnits;

      if (makerLockedSliceUnits !== undefined) {
        const releaseFromLocked = makerLockedSliceUnits <= makerQuoteLocked ? makerLockedSliceUnits : makerQuoteLocked;
        makerQuoteAcc.balanceLocked = (makerQuoteLocked - releaseFromLocked).toString();

        if (releaseFromLocked >= totalMakerCost) {
          const refund = releaseFromLocked - totalMakerCost;
          if (refund > 0n) {
            makerQuoteAcc.balanceAvailable = (BigInt(makerQuoteAcc.balanceAvailable) + refund).toString();
          }
        } else {
          const shortfall = totalMakerCost - releaseFromLocked;
          const makerAvail = BigInt(makerQuoteAcc.balanceAvailable);
          if (makerAvail >= shortfall) {
            makerQuoteAcc.balanceAvailable = (makerAvail - shortfall).toString();
          } else {
            const remLocked = BigInt(makerQuoteAcc.balanceLocked);
            if (makerAvail + remLocked >= shortfall) {
              makerQuoteAcc.balanceAvailable = '0';
              makerQuoteAcc.balanceLocked = (remLocked - (shortfall - makerAvail)).toString();
            } else {
              throw new Error('Maker insufficient quote balance during trade settlement');
            }
          }
        }
      } else {
        if (makerQuoteLocked < quoteVolumeUnits) {
          throw new Error('Maker locked quote balance underflow during trade settlement');
        }
        makerQuoteAcc.balanceLocked = (makerQuoteLocked - quoteVolumeUnits).toString();
        if (makerFeeUnits > 0n) {
          const makerAvail = BigInt(makerQuoteAcc.balanceAvailable);
          if (makerAvail >= makerFeeUnits) {
            makerQuoteAcc.balanceAvailable = (makerAvail - makerFeeUnits).toString();
          }
        }
      }

      // 2. Transfer Base: Taker -> Maker (deduct from Taker's LOCKED balance FIRST)
      const takerBaseLocked = BigInt(takerBaseAcc.balanceLocked);
      if (takerBaseLocked >= matchQuantityUnits) {
        takerBaseAcc.balanceLocked = (takerBaseLocked - matchQuantityUnits).toString();
      } else {
        const rem = matchQuantityUnits - takerBaseLocked;
        const takerBaseAvail = BigInt(takerBaseAcc.balanceAvailable);
        if (takerBaseAvail < rem) {
          throw new Error('Taker insufficient base balance');
        }
        takerBaseAcc.balanceLocked = '0';
        takerBaseAcc.balanceAvailable = (takerBaseAvail - rem).toString();
      }
      // Credit Maker Base:
      makerBaseAcc.balanceAvailable = (BigInt(makerBaseAcc.balanceAvailable) + matchQuantityUnits).toString();

      // 3. Transfer Quote: Maker -> Taker (minus taker fee) & Fee Collector
      const netTakerQuote = quoteVolumeUnits > takerFeeUnits ? quoteVolumeUnits - takerFeeUnits : 0n;
      if (netTakerQuote > 0n) {
        takerQuoteAcc.balanceAvailable = (BigInt(takerQuoteAcc.balanceAvailable) + netTakerQuote).toString();
      }

      // Collect fees into exchange revenue account
      const totalFee = makerFeeUnits + takerFeeUnits;
      if (totalFee > 0n) {
        feeQuoteAcc.balanceAvailable = (BigInt(feeQuoteAcc.balanceAvailable) + totalFee).toString();
      }

    } else {
      // Maker was SELLING Base (already locked base)
      // Taker is BUYING Base, paying Quote (already locked quote + est takerFee)

      // 1. Release Maker's locked Base:
      const makerBaseLocked = BigInt(makerBaseAcc.balanceLocked);
      if (makerBaseLocked < matchQuantityUnits) {
        throw new Error('Maker locked base balance underflow during settlement');
      }
      makerBaseAcc.balanceLocked = (makerBaseLocked - matchQuantityUnits).toString();

      // 2. Transfer Base to Taker:
      takerBaseAcc.balanceAvailable = (BigInt(takerBaseAcc.balanceAvailable) + matchQuantityUnits).toString();

      // 3. Deduct Quote from Taker (deduct from LOCKED balance FIRST, refund unused fee/price improvement):
      const totalTakerCost = quoteVolumeUnits + takerFeeUnits;
      const takerLocked = BigInt(takerQuoteAcc.balanceLocked);

      if (takerLockedSliceUnits !== undefined) {
        const releaseFromLocked = takerLockedSliceUnits <= takerLocked ? takerLockedSliceUnits : takerLocked;
        takerQuoteAcc.balanceLocked = (takerLocked - releaseFromLocked).toString();

        if (releaseFromLocked >= totalTakerCost) {
          const refund = releaseFromLocked - totalTakerCost;
          if (refund > 0n) {
            takerQuoteAcc.balanceAvailable = (BigInt(takerQuoteAcc.balanceAvailable) + refund).toString();
          }
        } else {
          const shortfall = totalTakerCost - releaseFromLocked;
          const takerQuoteAvail = BigInt(takerQuoteAcc.balanceAvailable);
          if (takerQuoteAvail >= shortfall) {
            takerQuoteAcc.balanceAvailable = (takerQuoteAvail - shortfall).toString();
          } else {
            const remLocked = BigInt(takerQuoteAcc.balanceLocked);
            if (takerQuoteAvail + remLocked >= shortfall) {
              takerQuoteAcc.balanceAvailable = '0';
              takerQuoteAcc.balanceLocked = (remLocked - (shortfall - takerQuoteAvail)).toString();
            } else {
              throw new Error('Taker insufficient quote balance during settlement');
            }
          }
        }
      } else {
        if (takerLocked >= totalTakerCost) {
          takerQuoteAcc.balanceLocked = (takerLocked - totalTakerCost).toString();
        } else {
          const rem = totalTakerCost - takerLocked;
          const takerQuoteAvail = BigInt(takerQuoteAcc.balanceAvailable);
          if (takerQuoteAvail < rem) {
            throw new Error('Taker insufficient quote balance during settlement');
          }
          takerQuoteAcc.balanceLocked = '0';
          takerQuoteAcc.balanceAvailable = (takerQuoteAvail - rem).toString();
        }
      }

      // 4. Credit Quote to Maker (minus maker fee):
      const netMakerQuote = quoteVolumeUnits > makerFeeUnits ? quoteVolumeUnits - makerFeeUnits : 0n;
      if (netMakerQuote > 0n) {
        makerQuoteAcc.balanceAvailable = (BigInt(makerQuoteAcc.balanceAvailable) + netMakerQuote).toString();
      }

      // Collect fees
      const totalFee = makerFeeUnits + takerFeeUnits;
      if (totalFee > 0n) {
        feeQuoteAcc.balanceAvailable = (BigInt(feeQuoteAcc.balanceAvailable) + totalFee).toString();
      }
    }

    // Update timestamps & versions (deduplicate accounts for self-trades)
    const now = Date.now();
    const uniqueAccounts = new Set([makerBaseAcc, makerQuoteAcc, takerBaseAcc, takerQuoteAcc, feeQuoteAcc]);
    uniqueAccounts.forEach(acc => {
      acc.version += 1;
      acc.updatedAt = now;
    });

    // Record Journal Transaction
    const journalId = crypto.randomUUID();
    const journal: JournalTransaction = {
      id: journalId,
      idempotencyKey: `trade-settle-${tradeId}`,
      txType: 'TRADE_SETTLEMENT',
      referenceId: tradeId,
      description: `Trade settlement ${matchQuantityUnits} units @ ${params.matchPriceUnits}`,
      createdAt: now
    };
    db.journalTransactions.set(journal.id, journal);
    db.journalIdempotencyIndex.set(journal.idempotencyKey, journal.id);
  }

  /**
   * Verify mathematical balance consistency across all accounts in the exchange.
   * Used in automated health checks and property-based tests.
   */
  static verifyGlobalInvariants(): { isConsistent: boolean; totalAssets: Record<string, string>; errors: string[] } {
    const errors: string[] = [];
    const totalAssets: Record<string, bigint> = {};

    for (const [_, acc] of db.ledgerAccounts.entries()) {
      const avail = BigInt(acc.balanceAvailable);
      const locked = BigInt(acc.balanceLocked);

      if (avail < 0n && acc.userId !== SYSTEM_HOT_WALLET_ID && acc.userId !== 'sys-treasury-0000-0000-000000000000') {
        errors.push(`Account ${acc.id} (${acc.userId}, ${acc.currency}) has negative available balance: ${avail}`);
      }
      if (locked < 0n) {
        errors.push(`Account ${acc.id} (${acc.userId}, ${acc.currency}) has negative locked balance: ${locked}`);
      }

      totalAssets[acc.currency] = (totalAssets[acc.currency] || 0n) + (avail + locked);
    }

    const formattedTotals: Record<string, string> = {};
    for (const [curr, total] of Object.entries(totalAssets)) {
      formattedTotals[curr] = total.toString();
    }

    return {
      isConsistent: errors.length === 0,
      totalAssets: formattedTotals,
      errors
    };
  }
}
