/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * AuthService.ts
 * Multi-layer Authentication, RFC-6238 TOTP 2FA, Anti-Brute-Force, and Session Manager.
 */

import crypto from 'crypto';
import { db } from '../db/database.js';
import { User, UserRole } from '../db/types.js';

// Base32 character set for RFC-3548 / RFC-6238 TOTP
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Persistent HMAC Secret for stateless serverless sessions across Vercel instances
const SESSION_SECRET = process.env.SESSION_SECRET || 'dimonex-stateless-hmac-secret-v1-production-2026';

export interface SessionTokenPayload {
  userId: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

export class AuthService {
  /**
   * Issues a cryptographically signed HMAC-SHA256 token.
   * Self-contained and verifiable across all stateless Vercel Serverless Lambda instances.
   */
  static issueToken(user: User, device = 'Web Client', ip = '127.0.0.1'): string {
    const now = Date.now();
    const expiresAt = now + 14 * 24 * 3600 * 1000; // 14 days valid
    const payload: SessionTokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      iat: now,
      exp: expiresAt
    };
    const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payloadEncoded).digest('base64url');
    const token = `${payloadEncoded}.${signature}`;

    // Store in-memory session record
    db.sessions.set(token, {
      userId: user.id,
      token,
      device,
      ip,
      expiresAt
    });

    if (process.env.VERCEL === '1') {
      db.saveToDisk();
    } else {
      db.scheduleSave();
    }

    return token;
  }

  /**
   * RFC 6238 TOTP Secret Generator (Base32 encoded)
   */
  static generateTotpSecret(): { secret: string; otpauthUrl: string } {
    const randomBytes = crypto.randomBytes(20);
    let secret = '';
    for (let i = 0; i < randomBytes.length; i++) {
      secret += BASE32_CHARS[randomBytes[i] % 32];
    }
    const otpauthUrl = `otpauth://totp/DIMONEX:trader?secret=${secret}&issuer=DIMONEX`;
    return { secret, otpauthUrl };
  }

  /**
   * Verify standard RFC 6238 6-digit TOTP code
   */
  static verifyTotpCode(secret: string, code: string, window = 1): boolean {
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) return false;

    // Decode base32
    let bits = '';
    for (let i = 0; i < secret.length; i++) {
      const val = BASE32_CHARS.indexOf(secret.charAt(i).toUpperCase());
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    const key = Buffer.from(bytes);

    const currentTimeStep = Math.floor(Date.now() / 1000 / 30);

    for (let step = currentTimeStep - window; step <= currentTimeStep + window; step++) {
      const stepBuffer = Buffer.alloc(8);
      stepBuffer.writeBigInt64BE(BigInt(step));

      const hmac = crypto.createHmac('sha1', key).update(stepBuffer).digest();
      const offset = hmac[hmac.length - 1] & 0x0f;
      const binary =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);

      const otp = (binary % 1000000).toString().padStart(6, '0');
      if (otp === cleanCode) {
        return true;
      }
    }

    return false;
  }

  /**
   * Register a new user with default role 'user' and pending KYC.
   */
  static register(email: string, password: string): { user: Omit<User, 'passwordHash' | 'passwordSalt'>; token: string } {
    const cleanEmail = email.trim().toLowerCase();
    
    // Check existing
    for (const [_, u] of db.users.entries()) {
      if (u.email === cleanEmail) {
        throw new Error('Email sudah terdaftar. Silakan gunakan email lain atau masuk.');
      }
    }

    if (password.length < 8) {
      throw new Error('Kata sandi harus minimal 8 karakter');
    }

    const salt = db.generateSalt();
    const hash = db.hashPassword(password, salt);
    const userId = crypto.randomUUID();
    const now = Date.now();

    const user: User = {
      id: userId,
      email: cleanEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'user',
      status: 'active',
      isTotpEnabled: false,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now
    };

    db.users.set(user.id, user);

    // Initial default zero accounts
    db.createOrGetAccount(user.id, 'IDR', '0');
    db.createOrGetAccount(user.id, 'BTC', '0');
    db.createOrGetAccount(user.id, 'ETH', '0');
    db.createOrGetAccount(user.id, 'USDT', '0');

    // Create cryptographically signed session token
    const token = this.issueToken(user, 'Web Browser / Chrome', '127.0.0.1');

    const { passwordHash, passwordSalt, ...safeUser } = user;
    return { user: safeUser, token };
  }

  /**
   * Login with anti-brute force and 2FA TOTP enforcement.
   */
  static login(email: string, password: string, totpCode?: string, ip = '127.0.0.1'): { 
    user?: Omit<User, 'passwordHash' | 'passwordSalt'>; 
    token?: string; 
    requiresTotp?: boolean; 
  } {
    const cleanEmail = email.trim().toLowerCase();
    let targetUser: User | undefined;

    for (const [_, u] of db.users.entries()) {
      if (u.email === cleanEmail) {
        targetUser = u;
        break;
      }
    }

    if (!targetUser) {
      throw new Error('Email atau kata sandi tidak valid');
    }

    const now = Date.now();

    // Check account lockout
    if (targetUser.lockedUntil && targetUser.lockedUntil > now) {
      const waitMinutes = Math.ceil((targetUser.lockedUntil - now) / 60000);
      throw new Error(`Akun terkunci sementara karena percobaan gagal berulang. Coba lagi dalam ${waitMinutes} menit.`);
    }

    // Verify Password
    const computedHash = db.hashPassword(password, targetUser.passwordSalt);
    if (computedHash !== targetUser.passwordHash) {
      targetUser.failedLoginAttempts += 1;
      if (targetUser.failedLoginAttempts >= 5) {
        targetUser.lockedUntil = now + 15 * 60 * 1000; // 15 mins lock
        targetUser.failedLoginAttempts = 0;
        throw new Error('Terlalu banyak percobaan gagal. Akun dibekukan selama 15 menit untuk keamanan.');
      }
      throw new Error('Email atau kata sandi tidak valid');
    }

    // Reset failed counter on successful password
    targetUser.failedLoginAttempts = 0;
    targetUser.lockedUntil = undefined;

    // Check 2FA TOTP
    if (targetUser.isTotpEnabled && targetUser.totpSecret) {
      if (!totpCode) {
        return { requiresTotp: true };
      }
      const isTotpValid = this.verifyTotpCode(targetUser.totpSecret, totpCode);
      if (!isTotpValid) {
        throw new Error('Kode 2FA TOTP tidak valid atau kedaluwarsa.');
      }
    }

    // Issue Cryptographically Signed Session Token
    const token = this.issueToken(targetUser, 'Web Client / Dimonex Desktop', ip);

    const { passwordHash, passwordSalt, ...safeUser } = targetUser;
    return { user: safeUser, token };
  }

  /**
   * Validate bearer token and return user.
   * Supports both Stateless Cryptographic HMAC tokens (survives all serverless container recycles)
   * and backward-compatible stateful in-memory tokens.
   */
  static authenticateToken(token: string): Omit<User, 'passwordHash' | 'passwordSalt'> | null {
    if (!token || typeof token !== 'string') return null;

    // 1. Stateless Cryptographic HMAC Token verification
    if (token.includes('.')) {
      const parts = token.split('.');
      if (parts.length === 2) {
        const [payloadEncoded, signature] = parts;
        try {
          const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadEncoded).digest('base64url');
          if (signature.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
            const payload: SessionTokenPayload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf-8'));
            if (payload && payload.exp > Date.now()) {
              let user = db.users.get(payload.userId);
              if (!user) {
                // If container is fresh or cold start, reload from disk snapshot
                db.loadFromDisk();
                user = db.users.get(payload.userId);
              }

              // If user exists and is active, return safe user
              if (user && user.status === 'active') {
                const { passwordHash, passwordSalt, ...safeUser } = user;
                return safeUser;
              }

              // If user was created in another serverless instance and not yet on this instance's disk,
              // safely rehydrate active user state into in-memory store
              if (!user && payload.email) {
                const salt = db.generateSalt();
                const rehydratedUser: User = {
                  id: payload.userId,
                  email: payload.email,
                  passwordHash: '',
                  passwordSalt: salt,
                  role: (payload.role as any) || 'user',
                  status: 'active',
                  isTotpEnabled: false,
                  failedLoginAttempts: 0,
                  createdAt: payload.iat || Date.now(),
                  updatedAt: Date.now()
                };
                db.users.set(rehydratedUser.id, rehydratedUser);
                db.createOrGetAccount(rehydratedUser.id, 'IDR', '0');
                db.createOrGetAccount(rehydratedUser.id, 'BTC', '0');
                db.createOrGetAccount(rehydratedUser.id, 'ETH', '0');
                db.createOrGetAccount(rehydratedUser.id, 'USDT', '0');
                db.saveToDisk();

                const { passwordHash, passwordSalt, ...safeUser } = rehydratedUser;
                return safeUser;
              }
            }
          }
        } catch {
          // Fall through to stateful check
        }
      }
    }

    // 2. Fallback to stateful db.sessions for backward compatibility with older tokens
    const session = db.sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    const user = db.users.get(session.userId);
    if (!user || user.status !== 'active') {
      return null;
    }
    const { passwordHash, passwordSalt, ...safeUser } = user;
    return safeUser;
  }
}
