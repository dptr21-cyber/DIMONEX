/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server/services/listing/ListingAuditService.ts
 * Append-only Cryptographic Audit Trail for Initial Listing.
 * Uses canonical JSON serialization and SHA-256 hash chaining to ensure tamper-evident records.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { ListingAuditEvent } from '../../db/types.js';

export interface RecordAuditEventInput {
  aggregateId: string;
  eventType: ListingAuditEvent['eventType'];
  actorId: string;
  correlationId?: string;
  idempotencyKey?: string;
  aggregateVersion: number;
  payload: Record<string, any>;
  reason?: string;
  securityMetadata?: {
    ip?: string;
    userAgent?: string;
    authRole?: string;
    sessionHash?: string;
  };
}

export class ListingAuditService {
  private static readonly GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Deterministically orders keys in JSON for canonical serialization
   */
  private static canonicalStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalStringify(item)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    const keyValues = keys.map(k => `${JSON.stringify(k)}:${this.canonicalStringify(obj[k])}`);
    return '{' + keyValues.join(',') + '}';
  }

  /**
   * Redacts sensitive fields from audit payload
   */
  private static redactSensitiveData(data: Record<string, any>): Record<string, any> {
    const sensitiveKeys = ['password', 'totpsecret', 'secrethash', 'token', 'privatekey', 'apikey', 'secret'];
    const sanitized: Record<string, any> = {};

    for (const [key, val] of Object.entries(data)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        sanitized[key] = this.redactSensitiveData(val);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  /**
   * Records an append-only audit event with cryptographic hash chaining
   */
  public static recordEvent(input: RecordAuditEventInput): ListingAuditEvent {
    const events = db.listingAuditEvents;
    const previousHash = events.length > 0 ? events[events.length - 1].currentHash : this.GENESIS_HASH;

    const eventId = crypto.randomUUID();
    const correlationId = input.correlationId || crypto.randomUUID();
    const sanitizedPayload = this.redactSensitiveData(input.payload);
    const createdAt = Date.now();

    const dataToHash = {
      id: eventId,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      actorId: input.actorId,
      correlationId,
      idempotencyKey: input.idempotencyKey || null,
      aggregateVersion: input.aggregateVersion,
      payload: sanitizedPayload,
      reason: input.reason || null,
      securityMetadata: input.securityMetadata || {},
      previousHash,
      createdAt
    };

    const canonicalSerialized = this.canonicalStringify(dataToHash);
    const currentHash = crypto.createHash('sha256').update(canonicalSerialized).digest('hex');

    const auditEvent: ListingAuditEvent = {
      id: eventId,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      actorId: input.actorId,
      correlationId,
      idempotencyKey: input.idempotencyKey,
      aggregateVersion: input.aggregateVersion,
      payload: sanitizedPayload,
      reason: input.reason,
      securityMetadata: input.securityMetadata || {},
      previousHash,
      currentHash,
      createdAt
    };

    // Immutable append
    db.listingAuditEvents.push(auditEvent);
    db.scheduleSave();

    return auditEvent;
  }

  /**
   * Retrieves audit events for a given aggregate (asset or listing request)
   */
  public static getEventsForAggregate(aggregateId: string): ListingAuditEvent[] {
    return db.listingAuditEvents.filter(e => e.aggregateId === aggregateId);
  }

  /**
   * Validates the cryptographic integrity of the entire audit chain.
   * Returns verification result and any violated sequence indexes.
   */
  public static verifyAuditIntegrity(): {
    isValid: boolean;
    totalEvents: number;
    tamperedIndex?: number;
    error?: string;
  } {
    const events = db.listingAuditEvents;
    let prevHash = this.GENESIS_HASH;

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];

      // 1. Verify previous hash linkage
      if (evt.previousHash !== prevHash) {
        return {
          isValid: false,
          totalEvents: events.length,
          tamperedIndex: i,
          error: `Broken hash chain at index ${i}: expected prevHash ${prevHash}, got ${evt.previousHash}`
        };
      }

      // 2. Recompute current hash
      const dataToHash = {
        id: evt.id,
        aggregateId: evt.aggregateId,
        eventType: evt.eventType,
        actorId: evt.actorId,
        correlationId: evt.correlationId,
        idempotencyKey: evt.idempotencyKey || null,
        aggregateVersion: evt.aggregateVersion,
        payload: evt.payload,
        reason: evt.reason || null,
        securityMetadata: evt.securityMetadata,
        previousHash: evt.previousHash,
        createdAt: evt.createdAt
      };

      const canonicalSerialized = this.canonicalStringify(dataToHash);
      const computedHash = crypto.createHash('sha256').update(canonicalSerialized).digest('hex');

      if (computedHash !== evt.currentHash) {
        return {
          isValid: false,
          totalEvents: events.length,
          tamperedIndex: i,
          error: `Tampered payload or signature at index ${i}: expected ${computedHash}, got ${evt.currentHash}`
        };
      }

      prevHash = evt.currentHash;
    }

    return {
      isValid: true,
      totalEvents: events.length
    };
  }
}
