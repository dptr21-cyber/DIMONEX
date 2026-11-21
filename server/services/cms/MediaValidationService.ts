/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaValidationService.ts
 * Validates uploaded media files using both declared MIME type AND binary file
 * signatures (magic bytes), enforces upload size limits, blocks polyglots/SVG/scripts,
 * and stores files strictly inside a confined media directory.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, getExchangeDataDirectory } from '../../db/database.js';
import { MediaAsset } from '../../db/types.js';

export const MAX_MEDIA_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB strict limit

export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const MIME_TO_EXT: Record<AllowedImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const EXT_TO_MIME: Record<string, AllowedImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
};

export function getMediaDirectory(): string {
  const dir = path.resolve(getExchangeDataDirectory(), 'media');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Inspects raw binary magic bytes and container structure to determine the true image format.
 */
export function detectImageSignature(buffer: Buffer): AllowedImageMime | null {
  if (!buffer || buffer.length < 16) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A followed by IHDR chunk type at bytes 12..15
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a &&
    buffer[12] === 0x49 && // 'I'
    buffer[13] === 0x48 && // 'H'
    buffer[14] === 0x44 && // 'D'
    buffer[15] === 0x52    // 'R'
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF followed by a valid JPEG marker byte (E0..EF, DB, C0..CF, FE)
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer[3] >= 0xc0
  ) {
    return 'image/jpeg';
  }

  // WebP: RIFF....WEBP followed by VP8 / VP8L / VP8X chunk
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50 &&
    buffer[12] === 0x56 &&
    buffer[13] === 0x50 &&
    buffer[14] === 0x38
  ) {
    return 'image/webp';
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif';
  }

  return null;
}

/**
 * Rejects image/HTML or image/PHP polyglots containing executable script/document payloads
 * without false-positiving on legitimate C2PA Content Credentials (`c2pa.icon` SVG badge)
 * or Adobe XMP metadata embedded in modern PNG/JPEG/WebP files.
 * Note: Raw SVG uploads are already strictly rejected by MIME allowlist + binary magic bytes,
 * and served media enforces `X-Content-Type-Options: nosniff` + `CSP: default-src 'none'; sandbox`.
 */
function containsEmbeddedScriptPayload(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('latin1');
  return (
    /<script[\s>]/i.test(sample) ||
    /<\?php\b/i.test(sample) ||
    /<!doctype\s+html\b/i.test(sample) ||
    /<html[\s>]/i.test(sample) ||
    /<iframe[\s>]/i.test(sample)
  );
}

export interface UploadImageInput {
  originalName: string;
  declaredMimeType?: string;
  base64Data: string;
  altText?: string;
  uploadedBy: string;
}

export interface ValidatedImageResult {
  buffer: Buffer;
  mimeType: AllowedImageMime;
  ext: string;
  sha256Hash: string;
}

function normalizeImageMime(mime?: string): string {
  const normalized = (mime || '').toLowerCase().trim();
  if (normalized === 'image/jpg' || normalized === 'image/pjpeg') {
    return 'image/jpeg';
  }
  return normalized;
}

/**
 * Parses and validates an image upload payload (data URL or raw base64).
 */
export function validateImagePayload(
  base64Data: string,
  declaredMimeType?: string
): ValidatedImageResult {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('File image data is required');
  }

  let effectiveMime = normalizeImageMime(declaredMimeType);
  let rawBase64 = base64Data.trim();

  const dataUrlMatch = /^data:([a-zA-Z0-9/+.-]+);base64,([\s\S]+)$/.exec(rawBase64);
  if (dataUrlMatch) {
    const dataUrlMime = normalizeImageMime(dataUrlMatch[1]);
    if (effectiveMime && effectiveMime !== dataUrlMime) {
      throw new Error('Declared MIME type does not match data URL MIME type');
    }
    effectiveMime = dataUrlMime;
    rawBase64 = dataUrlMatch[2];
  }

  // Strictly reject SVG and non-allowlisted MIME types
  const allowedMimes = new Set<string>(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  if (!effectiveMime || !allowedMimes.has(effectiveMime)) {
    throw new Error(
      `Unsupported file MIME type "${effectiveMime || 'unknown'}". Allowed types: PNG, JPEG, WebP, GIF.`
    );
  }

  // Check approximate encoded length before decoding to avoid memory exhaustion
  const maxEncodedLen = Math.ceil((MAX_MEDIA_UPLOAD_BYTES * 4) / 3) + 128;
  if (rawBase64.length > maxEncodedLen) {
    throw new Error(`File exceeds maximum upload limit of ${MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded file is empty or invalid base64');
  }

  if (buffer.length > MAX_MEDIA_UPLOAD_BYTES) {
    throw new Error(`File exceeds maximum upload limit of ${MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)} MB`);
  }

  // Verify binary magic bytes and container header match declared MIME
  const detectedMime = detectImageSignature(buffer);
  if (!detectedMime) {
    throw new Error('Invalid image file signature. File content does not match a supported image format.');
  }

  if (detectedMime !== effectiveMime) {
    throw new Error(
      `MIME type mismatch: declared ${effectiveMime}, but binary signature is ${detectedMime}.`
    );
  }

  if (containsEmbeddedScriptPayload(buffer)) {
    throw new Error('Security check failed: suspicious script or markup payload detected in image.');
  }

  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    mimeType: detectedMime,
    ext: MIME_TO_EXT[detectedMime],
    sha256Hash
  };
}

/**
 * Safely resolves a media filename inside the confined media directory.
 */
export function resolveSafeMediaPath(filename: string): { filePath: string; mimeType: AllowedImageMime } | null {
  if (!filename || typeof filename !== 'string') return null;
  const cleanName = filename.trim();
  const match = /^([a-zA-Z0-9_-]{8,128})\.(png|jpg|webp|gif)$/.exec(cleanName);
  if (!match) return null;

  const baseDir = getMediaDirectory();
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }

  const ext = match[2];
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) return null;

  return { filePath: resolved, mimeType };
}

/**
 * Stores a validated image file to disk and registers a MediaAsset record in the database.
 */
export function saveUploadedMedia(input: UploadImageInput): MediaAsset {
  const validated = validateImagePayload(input.base64Data, input.declaredMimeType);
  const id = crypto.randomUUID();
  const safeFilename = `${id.replace(/-/g, '')}.${validated.ext}`;

  const resolved = resolveSafeMediaPath(safeFilename);
  if (!resolved) {
    throw new Error('Failed to resolve confined media storage path');
  }

  fs.writeFileSync(resolved.filePath, validated.buffer);

  const safeOriginalName = (input.originalName || safeFilename)
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .slice(0, 120);

  const asset: MediaAsset = {
    id,
    filename: safeFilename,
    originalName: safeOriginalName,
    mimeType: validated.mimeType,
    sizeBytes: validated.buffer.length,
    sha256Hash: validated.sha256Hash,
    url: `/api/public/media/${safeFilename}`,
    altText: input.altText ? String(input.altText).trim().slice(0, 200) : safeOriginalName,
    uploadedBy: input.uploadedBy,
    createdAt: Date.now()
  };

  db.mediaAssets.set(asset.id, asset);
  db.scheduleSave();
  return asset;
}

export function deleteUploadedMedia(mediaId: string): boolean {
  const existing = db.mediaAssets.get(mediaId);
  if (!existing) return false;

  const resolved = resolveSafeMediaPath(existing.filename);
  if (resolved && fs.existsSync(resolved.filePath)) {
    try {
      fs.unlinkSync(resolved.filePath);
    } catch {}
  }

  db.mediaAssets.delete(mediaId);
  db.scheduleSave();
  return true;
}
