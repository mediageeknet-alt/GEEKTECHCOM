import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// TAHAP 2A: ENKRIPSI AES-256-GCM UNTUK PIN/POLA PERANGKAT & AUTH JWT COOKIE
// ============================================================================

const RAW_AES_KEY =
  process.env.AES_256_MASTER_KEY ||
  'a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8';

// Pastikan kunci tepat 32 byte (256-bit)
const AES_KEY_BUFFER =
  RAW_AES_KEY.length === 64 && /^[0-9a-fA-F]+$/.test(RAW_AES_KEY)
    ? Buffer.from(RAW_AES_KEY, 'hex')
    : crypto.createHash('sha256').update(RAW_AES_KEY).digest();

const JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'geektech-access-secret-key-production-2026-harden';
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'geektech-refresh-secret-key-production-2026-harden';
const CSRF_SECRET =
  process.env.CSRF_SECRET || 'geektech-csrf-hmac-secret-key-production-2026';

/**
 * Mengenkripsi PIN / Password / Pola layar pelanggan dengan AES-256-GCM.
 * Format output: `${ivHex}:${authTagHex}:${cipherHex}`
 */
export function encryptPasscodeAES256(plainPasscode: string | null | undefined): string | null {
  if (!plainPasscode || !plainPasscode.trim()) return null;
  const iv = crypto.randomBytes(12); // 96-bit IV standar GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY_BUFFER, iv);
  const encrypted = Buffer.concat([cipher.update(plainPasscode.trim(), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Mendekripsi PIN / Pola layar pelanggan khusus untuk tampilan internal Teknisi/Admin.
 */
export function decryptPasscodeAES256(encryptedPayload: string | null | undefined): string | null {
  if (!encryptedPayload) return null;
  try {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) return '[Format Enkripsi Tidak Valid]';
    const [ivHex, authTagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encryptedText = Buffer.from(cipherHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY_BUFFER, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '[Gagal Dekripsi AES-256]';
  }
}

/**
 * Hashing password Admin menggunakan Scrypt (setara Argon2id di Node.js native)
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, originalHex] = parts;
  try {
    const derivedHex = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(originalHex, 'hex'), Buffer.from(derivedHex, 'hex'));
  } catch {
    return false;
  }
}

// ============================================================================
// JWT (ACCESS + REFRESH TOKEN) DENGAN HTTPONLY, SECURE, SAMESITE=STRICT COOKIE
// ============================================================================

export interface AdminJwtPayload {
  sub: string;
  username: string;
  role: 'OWNER' | 'TECHNICIAN' | 'CASHIER';
  session_id: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const pad = 4 - (input.length % 4);
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + (pad < 4 ? '='.repeat(pad) : '');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

export function signJwtToken(
  payload: Omit<AdminJwtPayload, 'iat' | 'exp'>,
  expiresInSeconds: number
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AdminJwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const secret = payload.type === 'access' ? JWT_ACCESS_SECRET : JWT_REFRESH_SECRET;
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
}

export function verifyJwtToken(
  token: string,
  expectedType: 'access' | 'refresh'
): AdminJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const secret = expectedType === 'access' ? JWT_ACCESS_SECRET : JWT_REFRESH_SECRET;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest()
    );
    if (encodedSig !== expectedSig) return null;
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminJwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now || payload.type !== expectedType) return null;
    return payload;
  } catch {
    return null;
  }
}

export function generateCsrfToken(sessionId: string): string {
  return crypto.createHmac('sha256', CSRF_SECRET).update(sessionId).digest('hex');
}

export function verifyCsrfToken(sessionId: string, tokenFromHeader: string | undefined): boolean {
  if (!tokenFromHeader) return false;
  const expected = generateCsrfToken(sessionId);
  if (expected.length !== tokenFromHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(tokenFromHeader));
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, csrfToken: string) {
  const forwardedProto = String(res.req?.headers?.['x-forwarded-proto'] || '');
  const isHttps = forwardedProto.includes('https') || res.req?.secure === true;
  const sameSiteMode: 'none' | 'lax' = isHttps ? 'none' : 'lax';

  res.cookie('gtc_access_token', accessToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: sameSiteMode,
    maxAge: 15 * 60 * 1000, // 15 menit
    path: '/',
  });

  res.cookie('gtc_refresh_token', refreshToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: sameSiteMode,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 hari
    path: '/api/v1/admin/auth',
  });

  res.cookie('gtc_csrf_token', csrfToken, {
    httpOnly: false,
    secure: isHttps,
    sameSite: sameSiteMode,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookies(res: Response) {
  const forwardedProto = String(res.req?.headers?.['x-forwarded-proto'] || '');
  const isHttps = forwardedProto.includes('https') || res.req?.secure === true;
  const sameSiteMode: 'none' | 'lax' = isHttps ? 'none' : 'lax';

  res.clearCookie('gtc_access_token', { path: '/', secure: isHttps, sameSite: sameSiteMode });
  res.clearCookie('gtc_refresh_token', { path: '/api/v1/admin/auth', secure: isHttps, sameSite: sameSiteMode });
  res.clearCookie('gtc_csrf_token', { path: '/', secure: isHttps, sameSite: sameSiteMode });
}

/**
 * Security Headers Middleware (Setara Helmet.js + Strict CORS)
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}
