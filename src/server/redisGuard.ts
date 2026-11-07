import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// TAHAP 2B: REDIS CACHING, INSTANT SESSION REVOCATION & RATE LIMITER (5 REQ/MIN)
// ============================================================================

interface RedisEntry {
  value: string;
  expiresAt: number;
}

export interface ActiveSessionRecord {
  session_id: string;
  admin_id: string;
  username: string;
  role: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: number;
}

class RedisGuardEngine {
  private store = new Map<string, RedisEntry>();
  private cacheHits = 0;
  private cacheMisses = 0;
  private blockedRequests = 0;

  private cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    this.cleanupExpired();
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async ttl(key: string): Promise<number> {
    const item = this.store.get(key);
    if (!item) return -2;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  // --------------------------------------------------------------------------
  // 1. LOGIKA REDIS CACHING UNTUK PUBLIC TRACKING (`track:{invoice}:{wa_last4}`)
  // --------------------------------------------------------------------------
  buildTrackCacheKey(invoiceNumber: string, waLast4: string): string {
    return `track:${invoiceNumber.trim().toUpperCase()}:${waLast4.trim()}`;
  }

  async getCachedTicketTrack(invoiceNumber: string, waLast4: string): Promise<unknown | null> {
    const key = this.buildTrackCacheKey(invoiceNumber, waLast4);
    const raw = await this.get(key);
    if (raw) {
      this.cacheHits += 1;
      return JSON.parse(raw);
    }
    this.cacheMisses += 1;
    return null;
  }

  async setCachedTicketTrack(invoiceNumber: string, waLast4: string, dtoData: unknown, ttlSeconds = 3600): Promise<void> {
    const key = this.buildTrackCacheKey(invoiceNumber, waLast4);
    await this.set(key, JSON.stringify(dtoData), ttlSeconds);
  }

  async invalidateTicketCache(invoiceNumber: string, waLast4: string): Promise<boolean> {
    const key = this.buildTrackCacheKey(invoiceNumber, waLast4);
    return this.del(key);
  }

  // --------------------------------------------------------------------------
  // 2. INSTANT SESSION REVOCATION (`session:{session_id}`)
  // --------------------------------------------------------------------------
  async registerAdminSession(record: ActiveSessionRecord, ttlSeconds = 7 * 24 * 3600): Promise<void> {
    await this.set(`session:${record.session_id}`, JSON.stringify(record), ttlSeconds);
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    const raw = await this.get(`session:${sessionId}`);
    return Boolean(raw);
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    return this.del(`session:${sessionId}`);
  }

  async listActiveSessions(): Promise<ActiveSessionRecord[]> {
    this.cleanupExpired();
    const sessions: ActiveSessionRecord[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (key.startsWith('session:')) {
        try {
          sessions.push(JSON.parse(entry.value) as ActiveSessionRecord);
        } catch {
          // ignore malformed
        }
      }
    }
    return sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // --------------------------------------------------------------------------
  // 3. ANTI-SCRAPING & BRUTE FORCE RATE LIMITER (5 req/menit/IP -> Blokir 15 mnt)
  // --------------------------------------------------------------------------
  async checkAndIncrementPublicRateLimit(ip: string): Promise<{
    allowed: boolean;
    count: number;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
  }> {
    const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 5);
    const windowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 60);
    const banSeconds = Number(process.env.RATE_LIMIT_BAN_SECONDS || 900); // 15 menit

    const banKey = `ban:public:${ip}`;
    const currentBanTtl = await this.ttl(banKey);
    if (currentBanTtl > 0) {
      this.blockedRequests += 1;
      return {
        allowed: false,
        count: maxRequests + 1,
        limit: maxRequests,
        remaining: 0,
        retryAfterSeconds: currentBanTtl,
      };
    }

    const counterKey = `rl:public:${ip}`;
    const existingRaw = await this.get(counterKey);
    const existingTtl = await this.ttl(counterKey);
    const currentCount = existingRaw ? Number(existingRaw) + 1 : 1;

    if (currentCount > maxRequests) {
      // Langsung blokir IP selama 15 menit (900 detik)
      await this.set(banKey, 'BANNED_BRUTE_FORCE', banSeconds);
      await this.del(counterKey);
      this.blockedRequests += 1;
      return {
        allowed: false,
        count: currentCount,
        limit: maxRequests,
        remaining: 0,
        retryAfterSeconds: banSeconds,
      };
    }

    await this.set(
      counterKey,
      String(currentCount),
      existingTtl > 0 ? existingTtl : windowSeconds
    );

    return {
      allowed: true,
      count: currentCount,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - currentCount),
      retryAfterSeconds: existingTtl > 0 ? existingTtl : windowSeconds,
    };
  }

  async resetRateLimitForIp(ip?: string): Promise<void> {
    this.cleanupExpired();
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith('ban:public:') || key.startsWith('rl:public:')) {
        if (!ip || key.endsWith(ip)) {
          this.store.delete(key);
        }
      }
    }
  }

  getTelemetrySnapshot() {
    this.cleanupExpired();
    const cachedKeys: { key: string; ttlSeconds: number }[] = [];
    const rateLimitKeys: { key: string; value: string; ttlSeconds: number }[] = [];

    for (const [key, entry] of this.store.entries()) {
      const ttlSec = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
      if (key.startsWith('track:')) {
        cachedKeys.push({ key, ttlSeconds: ttlSec });
      } else if (key.startsWith('rl:public:') || key.startsWith('ban:public:')) {
        rateLimitKeys.push({ key, value: entry.value, ttlSeconds: ttlSec });
      }
    }

    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      blockedRequests: this.blockedRequests,
      cachedKeys,
      rateLimitKeys,
    };
  }
}

export const redisGuard = new RedisGuardEngine();

export function getClientIp(req: Request): string {
  const normalizeIp = (rawIp: string): string => {
    const cleaned = rawIp.trim();
    return cleaned.startsWith('::ffff:') ? cleaned.slice(7) : cleaned;
  };

  // 1. Prioritaskan Cloudflare header jika domain diproteksi Cloudflare
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim().length > 0) {
    return normalizeIp(cfConnectingIp.split(',')[0]);
  }

  // 2. Baca X-Forwarded-For dari Nginx / Reverse Proxy (ambil IP pertama = IP asli klien)
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp && firstIp !== '127.0.0.1' && firstIp !== '::1') {
      return normalizeIp(firstIp);
    }
  } else if (Array.isArray(forwarded) && forwarded.length > 0 && forwarded[0]) {
    const firstIp = forwarded[0].split(',')[0].trim();
    if (firstIp && firstIp !== '127.0.0.1' && firstIp !== '::1') {
      return normalizeIp(firstIp);
    }
  }

  // 3. Baca X-Real-IP dari Nginx (proxy_set_header X-Real-IP $remote_addr;)
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    const cleanedRealIp = realIp.trim();
    if (cleanedRealIp !== '127.0.0.1' && cleanedRealIp !== '::1') {
      return normalizeIp(cleanedRealIp);
    }
  }

  // 4. Gunakan req.ip dari Express (otomatis terisi setelah app.set('trust proxy', 1))
  if (req.ip) {
    return normalizeIp(req.ip);
  }

  return normalizeIp(req.socket?.remoteAddress || '127.0.0.1');
}

/**
 * Middleware Redis Rate Limiter: Maksimal 5 request per menit per IP Address
 * pada `/api/v1/public/track` dan `/api/v1/public/approve-cost`.
 * Jika melewati batas -> HTTP 429 Too Many Requests + blokir IP 15 menit.
 */
export async function publicRateLimiterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = getClientIp(req);
  const status = await redisGuard.checkAndIncrementPublicRateLimit(ip);

  res.setHeader('X-RateLimit-Limit', String(status.limit));
  res.setHeader('X-RateLimit-Remaining', String(status.remaining));
  res.setHeader('X-RateLimit-Reset', String(status.retryAfterSeconds));

  if (!status.allowed) {
    return res.status(429).json({
      error: 'TERLALU_BANYAK_PERCOBAAN',
      message: `Aktivitas mencurigakan terdeteksi. IP Anda (${ip}) diblokir sementara selama ${Math.ceil(
        status.retryAfterSeconds / 60
      )} menit (${status.retryAfterSeconds} detik) karena melewati batas ${status.limit} permintaan/menit.`,
      retry_after_seconds: status.retryAfterSeconds,
    });
  }

  return next();
}

