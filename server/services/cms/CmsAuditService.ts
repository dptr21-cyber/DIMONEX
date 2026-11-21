/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CmsAuditService.ts
 * Append-only SHA-256 hash-chained audit logging for News CMS, Media Library,
 * and Notification Broadcast governance.
 */

import crypto from 'crypto';
import { db } from '../../db/database.js';
import { CmsAuditLog } from '../../db/types.js';

export interface RecordCmsAuditInput {
  entityType: 'ANNOUNCEMENT' | 'CAMPAIGN' | 'MEDIA';
  entityId: string;
  action: string;
  actorId: string;
  actorEmail?: string;
  actorRole: string;
  ipAddress?: string;
  details: Record<string, any>;
}

export function recordCmsAudit(input: RecordCmsAuditInput): CmsAuditLog {
  const prev = db.cmsAuditLogs.length > 0
    ? db.cmsAuditLogs[db.cmsAuditLogs.length - 1].currentHash
    : '0'.repeat(64);

  const createdAt = Date.now();
  const id = crypto.randomUUID();
  const canonical = JSON.stringify({
    id,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId,
    actorRole: input.actorRole,
    details: input.details,
    previousHash: prev,
    createdAt
  });

  const currentHash = crypto.createHash('sha256').update(canonical).digest('hex');

  const log: CmsAuditLog = {
    id,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    ipAddress: input.ipAddress,
    details: input.details,
    previousHash: prev,
    currentHash,
    createdAt
  };

  db.cmsAuditLogs.push(log);

  // Mirror into global platform auditLogs for unified admin compliance inspection
  db.auditLogs.push({
    id: crypto.randomUUID(),
    actorId: input.actorId,
    action: `CMS_${input.action}`,
    resource: `${input.entityType}:${input.entityId}`,
    details: JSON.stringify(input.details),
    ipAddress: input.ipAddress,
    createdAt
  });

  db.scheduleSave();
  return log;
}

export function getAuditLogsForEntity(
  entityType: 'ANNOUNCEMENT' | 'CAMPAIGN' | 'MEDIA',
  entityId: string
): CmsAuditLog[] {
  return db.cmsAuditLogs
    .filter(l => l.entityType === entityType && l.entityId === entityId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
