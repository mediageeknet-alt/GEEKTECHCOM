import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';

import {
  encryptPasscodeAES256,
  hashPassword,
  verifyPassword,
  signJwtToken,
  verifyJwtToken,
  generateCsrfToken,
  verifyCsrfToken,
  setAuthCookies,
  clearAuthCookies,
  securityHeadersMiddleware,
  type AdminJwtPayload,
} from './src/server/cryptoAndAuth.ts';
import {
  redisGuard,
  publicRateLimiterMiddleware,
  getClientIp,
} from './src/server/redisGuard.ts';
import {
  WhatsAppNotifierService,
  hasValidCustomerWhatsApp,
  type WaTriggerEvent,
} from './src/server/whatsappNotifier.ts';
import {
  dbStore,
  toPublicTicketDTO,
  toAdminTicketView,
  type TicketStatus,
  type DeviceCategory,
  type ServiceTicketRecord,
  type CustomerRecord,
  type AdminRecord,
  type PublicTicketTrackDTO,
} from './src/server/dtoAndStore.ts';

// ============================================================================
// SKEMA VALIDASI INPUT KETAT (ZOD) — MENCEGAH SQLi / XSS / PARAMETER TAMPERING
// ============================================================================

const PublicTrackSchema = z.object({
  invoice_number: z
    .string()
    .trim()
    .min(6, 'Nomor Invoice tidak valid')
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Format Nomor Invoice hanya boleh alfanumerik dan tanda hubung'),
  wa_last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'Wajib memasukkan tepat 4 digit terakhir Nomor WhatsApp'),
});

const PublicApprovalSchema = z.object({
  invoice_number: z
    .string()
    .trim()
    .min(6)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/),
  wa_last4: z
    .string()
    .trim()
    .regex(/^\d{4}$/),
  decision: z.enum(['APPROVE', 'CANCEL']),
});

const AdminLoginSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(4).max(128),
});

const CreateTicketSchema = z.object({
  customer_name: z.string().trim().min(2, 'Nama pelanggan wajib diisi').max(120),
  whatsapp_number: z.string().trim().max(24).optional().nullable(),
  tracking_pin: z.string().trim().max(10).optional().nullable(),
  customer_address: z.string().trim().max(300).optional().nullable(),
  service_type: z.enum(['REGULAR', 'WARRANTY_CLAIM', 'PRIORITY']).optional(),
  customer_own_parts: z.boolean().optional(),
  initial_status: z
    .enum(['RECEIVED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'PICKED_UP'])
    .optional(),
  device_category: z.enum(['LAPTOP', 'SMARTPHONE', 'OTHER']),
  device_brand_model: z.string().trim().min(2, 'Tipe/Model perangkat wajib diisi').max(150),
  serial_number_imei: z.string().trim().max(100).optional().nullable(),
  passcode_plain: z.string().trim().max(100).optional().nullable(),
  hardware_specs: z.string().trim().max(500).optional().nullable(),
  physical_checklist: z.object({
    unit_only: z.boolean().optional(),
    mati_total: z.boolean().optional(),
    charger: z.boolean(),
    tas: z.boolean(),
    sim_tray_memory: z.boolean(),
    layar_baret: z.boolean(),
    casing_lecet: z.boolean(),
    baut_kurang: z.number().int().min(0).max(50),
    catatan_fisik: z.string().max(600).optional(),
    hardware_specs: z.string().max(500).optional(),
  }),
  initial_complaint: z.string().trim().min(3, 'Keluhan awal wajib diisi').max(1000),
  public_diagnosis: z.string().trim().max(1000).optional().nullable(),
  secret_technician_notes: z.string().trim().max(2000).optional().nullable(),
  estimated_cost: z.number().min(0).max(500000000),
  down_payment: z.number().min(0).max(500000000).optional(),
  parts_cost_modal: z.number().min(0).max(500000000),
  warranty_days: z.number().int().min(0).max(365),
});

const UpdateTicketSchema = z.object({
  status: z
    .enum([
      'RECEIVED',
      'DIAGNOSING',
      'WAITING_APPROVAL',
      'IN_PROGRESS',
      'QC_TESTING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'CANCELLED',
    ])
    .optional(),
  public_diagnosis: z.string().trim().max(1500).optional().nullable(),
  secret_technician_notes: z.string().trim().max(2000).optional().nullable(),
  estimated_cost: z.number().min(0).max(500000000).optional(),
  final_price: z.number().min(0).max(500000000).optional(),
  parts_cost_modal: z.number().min(0).max(500000000).optional(),
  warranty_days: z.number().int().min(0).max(365).optional(),
  pickup_by: z.string().trim().max(150).optional().nullable(),
  pickup_notes: z.string().trim().max(500).optional().nullable(),
  passcode_plain: z.string().trim().max(100).optional().nullable(),
  log_description: z.string().trim().max(600).optional(),
  photo_data_url: z.string().max(2500000).optional().nullable(),
  trigger_wa_notification: z.boolean().optional(),
});

const UpdateWablasSchema = z.object({
  wablas_domain: z.string().trim().url('Domain Wablas harus berupa URL valid (https://...)'),
  wablas_api_key: z.string().trim().max(256),
  wablas_secret_key: z.string().trim().max(256),
  is_wablas_enabled: z.boolean(),
});

const UpdateStoreProfileSchema = z.object({
  store_name: z.string().trim().min(2, 'Nama usaha minimal 2 karakter').max(120),
  store_slogan: z.string().trim().max(200),
  store_address: z.string().trim().max(300),
  store_phone: z.string().trim().max(50),
  receipt_footer_notes: z.string().trim().max(1500),
});

const CreateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username minimal 3 karakter')
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username hanya boleh alfanumerik, titik, atau strip'),
  full_name: z.string().trim().min(2, 'Nama lengkap wajib diisi').max(80),
  password: z.string().min(6, 'Password minimal 6 karakter').max(64),
  role: z.enum(['OWNER', 'TECHNICIAN', 'CASHIER']),
});

const UpdateUserPasswordSchema = z
  .object({
    password: z.string().min(6, 'Password baru minimal 6 karakter').max(64).optional(),
    new_password: z.string().min(6, 'Password baru minimal 6 karakter').max(64).optional(),
  })
  .refine((data) => data.password || data.new_password, {
    message: 'Password baru minimal 6 karakter.',
  });

// ============================================================================
// HELPER NORMALISASI NOMOR WHATSAPP (Format 628xxx & 4 Digit Terakhir)
// ============================================================================

function normalizeWhatsApp(rawPhone: string): { formatted: string; last4: string } {
  const digits = rawPhone.replace(/[^0-9]/g, '');
  let formatted = digits;
  if (digits.startsWith('0')) {
    formatted = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    formatted = `62${digits}`;
  }
  const last4 = formatted.slice(-4).padStart(4, '0');
  return { formatted, last4 };
}

function getAppBaseUrl(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

// ============================================================================
// MIDDLEWARE AUTENTIKASI ADMIN (HTTPONLY COOKIE + REDIS SESSION CHECK + CSRF)
// ============================================================================

interface AuthenticatedRequest extends Request {
  adminUser?: AdminJwtPayload;
}

async function requireAdminAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let accessToken = req.cookies?.gtc_access_token;
  const authHeader = req.headers.authorization;
  if (!accessToken && authHeader && authHeader.startsWith('Bearer ')) {
    accessToken = authHeader.slice(7).trim();
  }

  if (!accessToken) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Sesi Admin tidak ditemukan. Silakan login terlebih dahulu.',
    });
  }

  const payload = verifyJwtToken(accessToken, 'access');
  if (!payload) {
    return res.status(401).json({
      error: 'TOKEN_EXPIRED_OR_INVALID',
      message: 'Token sesi telah kedaluwarsa atau tidak valid.',
    });
  }

  // Cek di Redis apakah session_id masih aktif (belum di-revoke dari jarak jauh)
  const isSessionAlive = await redisGuard.isSessionActive(payload.session_id);
  if (!isSessionAlive) {
    clearAuthCookies(res);
    return res.status(401).json({
      error: 'SESSION_REVOKED',
      message: 'Sesi ini telah dicabut (Instant Session Revocation). Silakan login kembali.',
    });
  }

  // Untuk mutasi data (POST/PUT/PATCH/DELETE), validasi CSRF jika menggunakan cookie
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    // Jika request menyertakan Bearer token, CSRF attack dari cross-site form tidak mungkin terjadi
    const isBearerAuth = Boolean(authHeader && authHeader.startsWith('Bearer '));
    if (!isBearerAuth && !verifyCsrfToken(payload.session_id, csrfHeader)) {
      return res.status(403).json({
        error: 'CSRF_VALIDATION_FAILED',
        message: 'Token keamanan CSRF tidak cocok atau hilang.',
      });
    }
  }

  const state = dbStore.getState();
  const currentAdmin = state.admins.find((a) => a.id === payload.sub);
  if (!currentAdmin) {
    clearAuthCookies(res);
    return res.status(401).json({
      error: 'ACCOUNT_NOT_FOUND',
      message: 'Akun petugas sudah tidak terdaftar. Silakan login kembali.',
    });
  }

  req.adminUser = {
    ...payload,
    username: currentAdmin.username,
    role: currentAdmin.role,
  };
  return next();
}

function requireOwnerRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const role = String(req.adminUser?.role || '').toUpperCase();
  if (role !== 'OWNER' && role !== 'ADMIN') {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message:
        'Akses ditolak (403 Forbidden). Tindakan ini hanya diizinkan untuk akun OWNER / ADMIN.',
    });
  }
  return next();
}

// ============================================================================
// INISIALISASI SERVER EXPRESS + VITE
// ============================================================================

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Percayai reverse proxy (Nginx / Cloudflare) agar req.ip dan Rate Limiter membaca IP asli pengunjung
  app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // --------------------------------------------------------------------------
  // 1. ENDPOINT PUBLIC TRACKING (ZERO DATA LEAKAGE + REDIS CACHE + RATE LIMIT)
  // --------------------------------------------------------------------------

  // Blokir tegas method GET pada `/api/v1/public/track` agar parameter tidak bocor di URL/history
  app.get('/api/v1/public/track', (_req: Request, res: Response) => {
    return res.status(405).json({
      error: 'METHOD_NOT_ALLOWED',
      message:
        'Keamanan Geektech-Com: Endpoint pelacakan publik melarang method GET agar Nomor Invoice & digit WA tidak tersimpan di riwayat URL browser atau log proxy. Gunakan POST.',
    });
  });

  app.post(
    '/api/v1/public/track',
    publicRateLimiterMiddleware,
    async (req: Request, res: Response) => {
      const parsed = PublicTrackSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Input pencarian tidak valid.',
        });
      }

      const invoiceNumber = parsed.data.invoice_number.toUpperCase();
      const waLast4 = parsed.data.wa_last4;

      // 1. Cek Redis Cache terlebih dahulu (`track:{invoice_number}:{wa_last4}`)
      const cachedDto = (await redisGuard.getCachedTicketTrack(
        invoiceNumber,
        waLast4
      )) as PublicTicketTrackDTO | null;
      if (cachedDto) {
        if (cachedDto.status === 'PICKED_UP') {
          const wDays = Math.max(0, Number(cachedDto.warranty_days ?? 0));
          if (wDays > 0 && cachedDto.picked_up_at) {
            const expMs = new Date(cachedDto.picked_up_at).getTime() + wDays * 24 * 60 * 60 * 1000;
            cachedDto.warranty_expires_at = new Date(expMs).toISOString();
            cachedDto.warranty_remaining_days = Math.max(
              0,
              Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24))
            );
          } else {
            cachedDto.warranty_expires_at = null;
            cachedDto.warranty_remaining_days = 0;
          }
        } else {
          cachedDto.warranty_expires_at = null;
          cachedDto.warranty_remaining_days = null;
        }
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Key', redisGuard.buildTrackCacheKey(invoiceNumber, waLast4));
        return res.json({
          source: 'REDIS_CACHE_HIT',
          ticket: cachedDto,
        });
      }

      // 2. Cache Miss -> Ambil dari Database dan validasi kombinasi Invoice + 4 Digit WA
      const state = dbStore.getState();
      const ticket = state.tickets.find(
        (t) => t.invoice_number.toUpperCase() === invoiceNumber
      );

      if (!ticket) {
        return res.status(404).json({
          error: 'NOT_FOUND_OR_MISMATCH',
          message:
            'Kombinasi Nomor Invoice dan 4 digit terakhir WhatsApp tidak ditemukan. Pastikan data sesuai dengan nota servis Anda.',
        });
      }

      const customer = state.customers.find((c) => c.id === ticket.customer_id);
      if (!customer || customer.whatsapp_last4 !== waLast4) {
        // Jangan beri tahu apakah invoice benar tapi WA salah (mencegah enumerasi invoice)
        return res.status(404).json({
          error: 'NOT_FOUND_OR_MISMATCH',
          message:
            'Kombinasi Nomor Invoice dan 4 digit terakhir WA / PIN Nota tidak ditemukan. Pastikan data sesuai dengan nota servis Anda.',
        });
      }

      // 3. Filter ketat melalui PublicTicketTrackDTO (Zero Data Leakage)
      const publicDto = toPublicTicketDTO(ticket, customer, state.ticket_logs);

      // 4. Simpan ke Redis dengan TTL 3600 detik (1 jam)
      const ttlSeconds = Number(process.env.TRACK_CACHE_TTL_SECONDS || 3600);
      await redisGuard.setCachedTicketTrack(invoiceNumber, waLast4, publicDto, ttlSeconds);

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Cache-Key', redisGuard.buildTrackCacheKey(invoiceNumber, waLast4));
      return res.json({
        source: 'POSTGRES_DB_FETCH',
        ticket: publicDto,
      });
    }
  );

  // --------------------------------------------------------------------------
  // 2. ENDPOINT PUBLIC ONE-CLICK COST APPROVAL (`POST /api/v1/public/approve-cost`)
  // --------------------------------------------------------------------------

  app.post(
    '/api/v1/public/approve-cost',
    publicRateLimiterMiddleware,
    async (req: Request, res: Response) => {
      const parsed = PublicApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Permintaan konfirmasi tidak valid.',
        });
      }

      const invoiceNumber = parsed.data.invoice_number.toUpperCase();
      const waLast4 = parsed.data.wa_last4;
      const decision = parsed.data.decision;

      const state = dbStore.getState();
      const ticket = state.tickets.find(
        (t) => t.invoice_number.toUpperCase() === invoiceNumber
      );
      if (!ticket) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Data servis tidak ditemukan.',
        });
      }

      const customer = state.customers.find((c) => c.id === ticket.customer_id);
      if (!customer || customer.whatsapp_last4 !== waLast4) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Verifikasi 4 digit WhatsApp tidak cocok.',
        });
      }

      if (ticket.status !== 'WAITING_APPROVAL') {
        return res.status(400).json({
          error: 'INVALID_STATUS_TRANSITION',
          message: `Tiket ini sedang berstatus ${ticket.status} dan tidak dalam tahap menunggu persetujuan biaya.`,
        });
      }

      const nowIso = new Date().toISOString();
      if (decision === 'APPROVE') {
        ticket.customer_approved = true;
        ticket.status = 'IN_PROGRESS';
        ticket.updated_at = nowIso;
        state.ticket_logs.push({
          id: crypto.randomUUID(),
          ticket_id: ticket.id,
          status_step: 'IN_PROGRESS',
          public_description:
            'Pelanggan menyetujui estimasi biaya secara online (One-Click Approval). Unit masuk ke antrean pengerjaan teknisi.',
          photo_url: null,
          created_at: nowIso,
        });
      } else {
        ticket.customer_approved = false;
        ticket.status = 'CANCELLED';
        ticket.estimated_cost = 0;
        ticket.final_price = 0;
        ticket.parts_cost_modal = 0;
        ticket.down_payment = 0;
        ticket.updated_at = nowIso;
        state.ticket_logs.push({
          id: crypto.randomUUID(),
          ticket_id: ticket.id,
          status_step: 'CANCELLED',
          public_description:
            'Pelanggan memilih membatalkan pengerjaan servis melalui portal konfirmasi biaya. Unit disiapkan untuk pengambilan kembali.',
          photo_url: null,
          created_at: nowIso,
        });
      }

      dbStore.save();

      // Cache Invalidation: Hapus cache Redis agar data terbaru langsung tampil
      await redisGuard.invalidateTicketCache(ticket.invoice_number, customer.whatsapp_last4);

      const updatedPublicDto = toPublicTicketDTO(ticket, customer, state.ticket_logs);
      return res.json({
        message:
          decision === 'APPROVE'
            ? 'Terima kasih! Persetujuan biaya berhasil tercatat dan teknisi kami segera melanjutkan pengerjaan.'
            : 'Permintaan pembatalan servis telah tercatat. Tim kami akan menyiapkan unit Anda untuk diambil.',
        ticket: updatedPublicDto,
      });
    }
  );

  // --------------------------------------------------------------------------
  // 3. ENDPOINT QR CODE SVG GENERATOR (`/api/v1/public/qr`)
  // --------------------------------------------------------------------------

  app.get('/api/v1/public/qr', async (req: Request, res: Response) => {
    const inv = String(req.query.inv || '').trim().toUpperCase();
    const wa = String(req.query.wa || '').trim();
    if (!inv) {
      return res.status(400).json({ error: 'Parameter inv diperlukan' });
    }
    const baseUrl = getAppBaseUrl(req).replace(/\/$/, '');
    const targetUrl = `${baseUrl}/?inv=${encodeURIComponent(inv)}${
      wa ? `&wa=${encodeURIComponent(wa)}` : ''
    }`;
    try {
      const svgString = await QRCode.toString(targetUrl, {
        type: 'svg',
        margin: 1,
        width: 180,
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svgString);
    } catch {
      return res.status(500).send('Gagal membuat QR');
    }
  });

  // --------------------------------------------------------------------------
  // 4. ENDPOINT ADMIN AUTH (JWT HTTPONLY COOKIE + REDIS SESSION + CSRF)
  // --------------------------------------------------------------------------

  app.post('/api/v1/admin/auth/login', async (req: Request, res: Response) => {
    const parsed = AdminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Username dan password wajib diisi dengan benar.',
      });
    }

    const { username, password } = parsed.data;
    const state = dbStore.getState();
    const admin = state.admins.find(
      (a) => a.username.toLowerCase() === username.toLowerCase()
    );

    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Username atau password salah.',
      });
    }

    const clientIp = getClientIp(req);
    admin.last_login_ip = clientIp;
    dbStore.save();

    const sessionId = crypto.randomUUID();
    await redisGuard.registerAdminSession({
      session_id: sessionId,
      admin_id: admin.id,
      username: admin.username,
      role: admin.role,
      ip_address: clientIp,
      user_agent: String(req.headers['user-agent'] || 'Browser').slice(0, 120),
      created_at: new Date().toISOString(),
      expires_at: Date.now() + 7 * 24 * 3600 * 1000,
    });

    const accessToken = signJwtToken(
      {
        sub: admin.id,
        username: admin.username,
        role: admin.role,
        session_id: sessionId,
        type: 'access',
      },
      15 * 60 // 15 menit
    );

    const refreshToken = signJwtToken(
      {
        sub: admin.id,
        username: admin.username,
        role: admin.role,
        session_id: sessionId,
        type: 'refresh',
      },
      7 * 24 * 3600 // 7 hari
    );

    const csrfToken = generateCsrfToken(sessionId);
    setAuthCookies(res, accessToken, refreshToken, csrfToken);

    return res.json({
      authenticated: true,
      access_token: accessToken,
      csrf_token: csrfToken,
      admin: {
        id: admin.id,
        username: admin.username,
        full_name: admin.full_name || admin.username,
        role: admin.role,
        session_id: sessionId,
        last_login_ip: admin.last_login_ip,
      },
    });
  });

  app.get('/api/v1/admin/auth/session', async (req: Request, res: Response) => {
    let accessToken = req.cookies?.gtc_access_token;
    const authHeader = req.headers.authorization;
    if (!accessToken && authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.slice(7).trim();
    }

    if (!accessToken) {
      return res.json({ authenticated: false });
    }
    const payload = verifyJwtToken(accessToken, 'access');
    if (!payload) {
      return res.json({ authenticated: false });
    }
    const alive = await redisGuard.isSessionActive(payload.session_id);
    if (!alive) {
      clearAuthCookies(res);
      return res.json({ authenticated: false });
    }
    const state = dbStore.getState();
    const adminRecord = state.admins.find((a) => a.id === payload.sub);
    const currentUsername = adminRecord ? adminRecord.username : payload.username;
    const currentFullName = adminRecord
      ? adminRecord.full_name || adminRecord.username
      : payload.username;
    const currentRole = adminRecord ? adminRecord.role : payload.role;

    const csrfToken = generateCsrfToken(payload.session_id);
    return res.json({
      authenticated: true,
      access_token: accessToken,
      csrf_token: csrfToken,
      admin: {
        id: payload.sub,
        username: currentUsername,
        full_name: currentFullName,
        role: currentRole,
        session_id: payload.session_id,
      },
    });
  });

  app.post(
    '/api/v1/admin/auth/logout',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      if (req.adminUser?.session_id) {
        await redisGuard.revokeSession(req.adminUser.session_id);
      }
      clearAuthCookies(res);
      return res.json({ message: 'Berhasil keluar dan sesi Redis telah dihapus.' });
    }
  );

  // Instant Session Revocation (Mematikan sesi Admin dari jarak jauh - OWNER ONLY)
  app.delete(
    '/api/v1/admin/auth/sessions/:sessionId',
    requireAdminAuth,
    requireOwnerRole,
    async (req: AuthenticatedRequest, res: Response) => {
      const targetSessionId = String(req.params.sessionId || '');
      await redisGuard.revokeSession(targetSessionId);
      return res.json({
        message: `Sesi ${targetSessionId.slice(0, 8)}... berhasil dicabut secara instan dari Redis.`,
      });
    }
  );

  // --------------------------------------------------------------------------
  // 5. ENDPOINT ADMIN DASHBOARD: RINGKASAN KEUANGAN, TIKET CRUD & REDIS GUARD
  // --------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/dashboard',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const state = dbStore.getState();
      const role = req.adminUser?.role || 'TECHNICIAN';
      const isOwner = role === 'OWNER';
      const canViewFinance = role === 'OWNER' || role === 'CASHIER';

      const enrichedTickets = state.tickets
        .map((ticket) => {
          const customer =
            state.customers.find((c) => c.id === ticket.customer_id) || {
              id: ticket.customer_id,
              full_name: 'Pelanggan',
              whatsapp_number: '628000000000',
              whatsapp_last4: '0000',
              address: null,
              created_at: ticket.created_at,
            };
          return toAdminTicketView(ticket, customer, state.ticket_logs, state.wa_logs);
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

      // Kalkulasi Keuangan (Pendapatan Kotor, Modal Sparepart, Laba Bersih)
      const activeOrCompleted = state.tickets.filter((t) => t.status !== 'CANCELLED');
      const totalGrossRevenue = activeOrCompleted.reduce((acc, t) => {
        const rev = t.final_price > 0 ? Number(t.final_price) : Number(t.estimated_cost);
        return acc + rev;
      }, 0);

      const totalPartsModal = activeOrCompleted.reduce(
        (acc, t) => acc + Number(t.parts_cost_modal),
        0
      );

      const totalNetProfit = totalGrossRevenue - totalPartsModal;

      const realizedTickets = state.tickets.filter(
        (t) => t.status === 'READY_FOR_PICKUP' || t.status === 'PICKED_UP'
      );
      const realizedRevenue = realizedTickets.reduce(
        (acc, t) => acc + (t.final_price > 0 ? Number(t.final_price) : Number(t.estimated_cost)),
        0
      );
      const realizedModal = realizedTickets.reduce(
        (acc, t) => acc + Number(t.parts_cost_modal),
        0
      );
      const realizedNetProfit = realizedRevenue - realizedModal;

      const activeSessions = isOwner ? await redisGuard.listActiveSessions() : [];
      const redisTelemetry = isOwner ? redisGuard.getTelemetrySnapshot() : null;

      return res.json({
        financial_summary: canViewFinance
          ? {
              total_gross_revenue: totalGrossRevenue,
              total_parts_modal: totalPartsModal,
              total_net_profit: totalNetProfit,
              realized_revenue: realizedRevenue,
              realized_modal: realizedModal,
              realized_net_profit: realizedNetProfit,
              total_tickets: state.tickets.length,
              waiting_approval_count: state.tickets.filter((t) => t.status === 'WAITING_APPROVAL')
                .length,
              ready_pickup_count: state.tickets.filter((t) => t.status === 'READY_FOR_PICKUP')
                .length,
            }
          : null,
        tickets: enrichedTickets,
        system_settings: isOwner
          ? state.system_settings
          : {
              ...state.system_settings,
              wablas_api_key: '',
              wablas_secret_key: '',
            },
        active_sessions: activeSessions,
        redis_telemetry: redisTelemetry,
        team_members: isOwner
          ? state.admins.map((a) => ({
              id: a.id,
              username: a.username,
              full_name: a.full_name || a.username,
              role: a.role,
              last_login_ip: a.last_login_ip,
              created_at: a.created_at,
            }))
          : [],
      });
    }
  );

  // Buat Nota Terima Servis Baru (Diizinkan untuk OWNER, TECHNICIAN, dan CASHIER)
  app.post(
    '/api/v1/admin/tickets',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = CreateTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Data nota baru tidak valid.',
        });
      }

      const data = parsed.data;
      const state = dbStore.getState();
      const nowIso = new Date().toISOString();

      // Normalisasi WhatsApp atau generate 4-digit Tracking PIN jika tanpa WA
      let normalizedWa = '';
      let waLast4 = '';
      const rawWa = (data.whatsapp_number || '').trim();

      if (rawWa.length >= 4) {
        const norm = normalizeWhatsApp(rawWa);
        normalizedWa = norm.formatted;
        waLast4 = (data.tracking_pin && data.tracking_pin.length === 4) ? data.tracking_pin : norm.last4;
      } else {
        normalizedWa = '-';
        if (data.tracking_pin && data.tracking_pin.length === 4) {
          waLast4 = data.tracking_pin;
        } else {
          waLast4 = String(Math.floor(1000 + Math.random() * 9000));
        }
      }

      // Cari atau buat Customer baru
      let customer: CustomerRecord | undefined = state.customers.find(
        (c) =>
          normalizedWa !== '-' &&
          c.whatsapp_number === normalizedWa &&
          c.full_name.toLowerCase() === data.customer_name.toLowerCase()
      );

      if (!customer) {
        customer = {
          id: crypto.randomUUID(),
          full_name: data.customer_name,
          whatsapp_number: normalizedWa,
          whatsapp_last4: waLast4,
          address: data.customer_address || null,
          created_at: nowIso,
        };
        state.customers.push(customer);
      } else {
        customer.whatsapp_last4 = waLast4;
        if (data.customer_address) {
          customer.address = data.customer_address;
        }
      }

      const invoiceNumber = dbStore.generateUniqueInvoiceNumber();
      const targetInitialStatus: TicketStatus = (data.initial_status || 'RECEIVED') as TicketStatus;
      const isDirectApproved =
        targetInitialStatus === 'IN_PROGRESS' ||
        targetInitialStatus === 'READY_FOR_PICKUP' ||
        targetInitialStatus === 'PICKED_UP';

      const OWN_PART_DISCLAIMER = '[HANYA JASA PASANG - PART DARI PELANGGAN]';
      let finalInitialComplaint = data.initial_complaint.trim();
      if (data.customer_own_parts && !finalInitialComplaint.includes(OWN_PART_DISCLAIMER)) {
        finalInitialComplaint = `${OWN_PART_DISCLAIMER} ${finalInitialComplaint}`.trim();
      }

      const finalPartsModal = data.customer_own_parts ? 0 : data.parts_cost_modal;
      const encryptedPasscode =
        targetInitialStatus === 'PICKED_UP' ? null : encryptPasscodeAES256(data.passcode_plain);

      const isPickedUpNow = targetInitialStatus === 'PICKED_UP';
      const warrantyExpiresAt =
        isPickedUpNow && data.warranty_days > 0
          ? new Date(new Date(nowIso).getTime() + data.warranty_days * 24 * 3600 * 1000).toISOString()
          : null;

      const newTicket: ServiceTicketRecord = {
        id: crypto.randomUUID(),
        invoice_number: invoiceNumber,
        customer_id: customer.id,
        device_category: data.device_category as DeviceCategory,
        device_brand_model: data.device_brand_model,
        service_type: data.service_type || 'REGULAR',
        serial_number_imei: data.serial_number_imei || null,
        passcode_encrypted: encryptedPasscode,
        physical_checklist: data.physical_checklist,
        hardware_specs: data.hardware_specs || data.physical_checklist.hardware_specs || null,
        initial_complaint: finalInitialComplaint,
        public_diagnosis: data.public_diagnosis || null,
        secret_technician_notes:
          req.adminUser?.role === 'CASHIER' ? null : data.secret_technician_notes || null,
        status: targetInitialStatus,
        customer_approved: isDirectApproved,
        estimated_cost: data.estimated_cost,
        final_price: data.estimated_cost,
        down_payment: data.down_payment || 0,
        parts_cost_modal: finalPartsModal,
        warranty_days: data.warranty_days,
        picked_up_at: isPickedUpNow ? nowIso : null,
        pickup_by: isPickedUpNow ? customer.full_name : null,
        pickup_notes: isPickedUpNow ? 'Diambil langsung di counter (Servis Bisa Ditunggu)' : null,
        warranty_expires_at: warrantyExpiresAt,
        created_at: nowIso,
        updated_at: nowIso,
      };

      state.tickets.unshift(newTicket);

      state.ticket_logs.push({
        id: crypto.randomUUID(),
        ticket_id: newTicket.id,
        status_step: 'RECEIVED',
        public_description: `Unit ${newTicket.device_brand_model} (${newTicket.service_type === 'PRIORITY' ? 'Prioritas Express' : newTicket.service_type === 'WARRANTY_CLAIM' ? 'Klaim Garansi' : 'Reguler'}) diterima di counter servis Geektech-Com. Pengecekan fisik awal telah dilakukan bersama pelanggan.`,
        photo_url: null,
        created_at: nowIso,
      });

      if (targetInitialStatus === 'IN_PROGRESS') {
        state.ticket_logs.push({
          id: crypto.randomUUID(),
          ticket_id: newTicket.id,
          status_step: 'IN_PROGRESS',
          public_description:
            'Biaya servis telah disetujui pelanggan sejak awal penerimaan. Unit langsung masuk proses pengerjaan teknisi.',
          photo_url: null,
          created_at: nowIso,
        });
      } else if (targetInitialStatus === 'READY_FOR_PICKUP') {
        state.ticket_logs.push({
          id: crypto.randomUUID(),
          ticket_id: newTicket.id,
          status_step: 'READY_FOR_PICKUP',
          public_description:
            'Pengerjaan servis selesai (Layanan Bisa Ditunggu) dan telah lulus uji fungsi Quality Control (QC). Unit siap diambil.',
          photo_url: null,
          created_at: nowIso,
        });
      } else if (targetInitialStatus === 'PICKED_UP') {
        state.ticket_logs.push({
          id: crypto.randomUUID(),
          ticket_id: newTicket.id,
          status_step: 'PICKED_UP',
          public_description:
            newTicket.warranty_days > 0
              ? `Pengerjaan selesai di tempat dan unit telah diserahkan langsung kepada ${customer.full_name}. Masa garansi ${newTicket.warranty_days} hari mulai aktif.`
              : `Pengerjaan selesai di tempat dan unit telah diserahkan langsung kepada ${customer.full_name} tanpa garansi tambahan (0 Hari).`,
          photo_url: null,
          created_at: nowIso,
        });
      }

      // Trigger otomatis WhatsApp Notifier HANYA jika nomor WA pelanggan terisi & valid
      // Jika whatsapp_number kosong/null, bypass proses notifikasi sepenuhnya (whatsapp_dispatch: null)
      let waResult: {
        wa_sent: boolean;
        mode: 'WABLAS' | 'DIRECT_FALLBACK';
        fallback_url?: string;
        message_preview: string;
      } | null = null;

      if (hasValidCustomerWhatsApp(customer.whatsapp_number)) {
        const waEvent: WaTriggerEvent =
          targetInitialStatus === 'READY_FOR_PICKUP' || targetInitialStatus === 'PICKED_UP'
            ? 'READY_FOR_PICKUP'
            : 'RECEIVED';
        const dispatch = await WhatsAppNotifierService.sendNotification(
          waEvent,
          newTicket,
          customer,
          state.system_settings,
          getAppBaseUrl(req)
        );
        state.wa_logs.unshift(dispatch.log_entry);
        waResult = {
          wa_sent: dispatch.wa_sent,
          mode: dispatch.mode,
          fallback_url: dispatch.fallback_url,
          message_preview: dispatch.message_preview,
        };
      }

      dbStore.save();
      await redisGuard.invalidateTicketCache(newTicket.invoice_number, customer.whatsapp_last4);

      return res.status(201).json({
        message: 'Servisan Berhasil Disimpan',
        ticket: toAdminTicketView(newTicket, customer, state.ticket_logs, state.wa_logs),
        whatsapp_dispatch: waResult,
      });
    }
  );

  // Update Tahapan Servis, Rahasia Teknisi, Modal Sparepart, Bukti Foto & Auto-Purge PIN
  app.patch(
    '/api/v1/admin/tickets/:id',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const ticketId = req.params.id;
      const parsed = UpdateTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Input pembaruan tidak valid.',
        });
      }

      const data = parsed.data;
      const state = dbStore.getState();
      const ticket = state.tickets.find((t) => t.id === ticketId);
      if (!ticket) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Tiket servis tidak ditemukan.',
        });
      }

      const customer = state.customers.find((c) => c.id === ticket.customer_id);
      if (!customer) {
        return res.status(404).json({
          error: 'CUSTOMER_NOT_FOUND',
          message: 'Data pelanggan tidak ditemukan.',
        });
      }

      const previousStatus = ticket.status;
      const targetStatus = (data.status || ticket.status) as TicketStatus;
      const nowIso = new Date().toISOString();

      // Validasi wajib Bukti Pengambilan (Serah Terima Barang) jika status Selesai & Diambil (PICKED_UP)
      if (targetStatus === 'PICKED_UP') {
        const finalPickupBy = (
          data.pickup_by !== undefined ? data.pickup_by || '' : ticket.pickup_by || ''
        ).trim();
        const finalPickupNotes = (
          data.pickup_notes !== undefined ? data.pickup_notes || '' : ticket.pickup_notes || ''
        ).trim();

        if (!finalPickupBy || !finalPickupNotes) {
          return res.status(400).json({
            error: 'PICKUP_RECORD_REQUIRED',
            message:
              'Nama Pengambil dan Keterangan / Hubungan wajib diisi sebagai bukti serah terima barang.',
          });
        }
        ticket.pickup_by = finalPickupBy;
        ticket.pickup_notes = finalPickupNotes;
      }

      if (data.public_diagnosis !== undefined) {
        ticket.public_diagnosis = data.public_diagnosis;
      }
      // Role KASIR (CASHIER) dilarang mengedit Catatan Internal Teknisi (Read-Only)
      if (data.secret_technician_notes !== undefined && req.adminUser?.role !== 'CASHIER') {
        ticket.secret_technician_notes = data.secret_technician_notes;
      }
      if (data.estimated_cost !== undefined) {
        ticket.estimated_cost = data.estimated_cost;
      }
      if (data.final_price !== undefined) {
        ticket.final_price = data.final_price;
      }
      if (data.parts_cost_modal !== undefined) {
        ticket.parts_cost_modal = data.parts_cost_modal;
      }
      if (data.warranty_days !== undefined) {
        ticket.warranty_days = data.warranty_days;
      }
      if (data.passcode_plain !== undefined && data.status !== 'PICKED_UP') {
        ticket.passcode_encrypted = data.passcode_plain
          ? encryptPasscodeAES256(data.passcode_plain)
          : null;
      }

      let autoPurgedPasscode = false;
      if (data.status && data.status !== previousStatus) {
        ticket.status = data.status as TicketStatus;

        // SPESIFIKASI KEAMANAN 4: Auto-Purge Privasi Pelanggan & Aktivasi Garansi saat PICKED_UP
        if (ticket.status === 'PICKED_UP') {
          ticket.passcode_encrypted = null;
          autoPurgedPasscode = true;
          ticket.picked_up_at = nowIso;
          if (ticket.warranty_days > 0) {
            const expiresDate = new Date(
              new Date(nowIso).getTime() + ticket.warranty_days * 24 * 3600 * 1000
            );
            ticket.warranty_expires_at = expiresDate.toISOString();
          } else {
            ticket.warranty_expires_at = null;
          }
          if (ticket.final_price <= 0) {
            ticket.final_price = ticket.estimated_cost;
          }
        } else {
          // Jika status belum atau bukan PICKED_UP, garansi & bukti ambil belum aktif
          ticket.picked_up_at = null;
          ticket.pickup_by = null;
          ticket.pickup_notes = null;
          ticket.warranty_expires_at = null;
        }
      } else if (ticket.status === 'PICKED_UP') {
        // Pastikan selalu null jika sudah PICKED_UP, dan rekalkulasi batas garansi jika durasi diubah
        ticket.passcode_encrypted = null;
        if (!ticket.picked_up_at) {
          const pickedLog = [...state.ticket_logs]
            .filter((l) => l.ticket_id === ticket.id && l.status_step === 'PICKED_UP')
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          ticket.picked_up_at = pickedLog?.created_at || ticket.updated_at || nowIso;
        }
        if (ticket.warranty_days > 0) {
          const baseTime = new Date(ticket.picked_up_at).getTime();
          ticket.warranty_expires_at = new Date(
            baseTime + ticket.warranty_days * 24 * 3600 * 1000
          ).toISOString();
        } else {
          ticket.warranty_expires_at = null;
        }
      } else {
        ticket.picked_up_at = null;
        ticket.pickup_by = null;
        ticket.pickup_notes = null;
        ticket.warranty_expires_at = null;
      }

      // LOGIKA RESET BIAYA SAAT STATUS DIBATALKAN (CANCELLED)
      if (ticket.status === 'CANCELLED') {
        ticket.estimated_cost = 0;
        ticket.final_price = 0;
        ticket.parts_cost_modal = 0;
        ticket.down_payment = 0;
        ticket.customer_approved = false;
        ticket.picked_up_at = null;
        ticket.pickup_by = null;
        ticket.pickup_notes = null;
        ticket.warranty_expires_at = null;
      }

      ticket.updated_at = nowIso;

      // Tambahkan TicketLog jika status berubah, atau ada log_description / foto baru
      if (
        (data.status && data.status !== previousStatus) ||
        (data.log_description && data.log_description.trim().length > 0) ||
        data.photo_data_url
      ) {
        const defaultStepDescriptions: Record<TicketStatus, string> = {
          RECEIVED: 'Unit diterima di bagian penerimaan servis.',
          DIAGNOSING: 'Teknisi sedang melakukan diagnosa menyeluruh pada perangkat.',
          WAITING_APPROVAL: `Diagnosa selesai. Menunggu persetujuan estimasi biaya sebesar Rp ${Number(
            ticket.estimated_cost
          ).toLocaleString('id-ID')}.`,
          IN_PROGRESS: 'Perangkat sedang dalam proses perbaikan dan penggantian komponen.',
          QC_TESTING: 'Perbaikan selesai, perangkat sedang menjalani uji fungsi Quality Control (QC).',
          READY_FOR_PICKUP: 'Perangkat telah lulus QC dan siap diambil di counter Geektech-Com.',
          PICKED_UP:
            ticket.warranty_days > 0
              ? `Perangkat telah diserahkan kepada ${ticket.pickup_by || customer.full_name} (${ticket.pickup_notes || 'Diambil di counter'}) dan masa garansi resmi ${ticket.warranty_days} hari mulai aktif.`
              : `Perangkat telah diserahkan kepada ${ticket.pickup_by || customer.full_name} (${ticket.pickup_notes || 'Diambil di counter'}) tanpa garansi tambahan (0 Hari).`,
          CANCELLED: 'Pengerjaan servis dibatalkan.',
        };

        state.ticket_logs.push({
          id: crypto.randomUUID(),
          ticket_id: ticket.id,
          status_step: ticket.status,
          public_description:
            data.log_description && data.log_description.trim().length > 0
              ? data.log_description.trim()
              : defaultStepDescriptions[ticket.status],
          photo_url: data.photo_data_url || null,
          created_at: nowIso,
        });
      }

      // Cek apakah perlu mengirim notifikasi WhatsApp otomatis:
      // Hanya dijalankan jika pelanggan memiliki nomor WhatsApp yang valid
      let waDispatchResult = null;
      const shouldTriggerWa =
        hasValidCustomerWhatsApp(customer.whatsapp_number) &&
        (data.trigger_wa_notification ||
          (data.status !== previousStatus &&
            (ticket.status === 'WAITING_APPROVAL' ||
              ticket.status === 'READY_FOR_PICKUP' ||
              ticket.status === 'RECEIVED')));

      if (shouldTriggerWa) {
        const eventType: WaTriggerEvent =
          ticket.status === 'WAITING_APPROVAL'
            ? 'WAITING_APPROVAL'
            : ticket.status === 'READY_FOR_PICKUP'
              ? 'READY_FOR_PICKUP'
              : 'RECEIVED';

        const waResult = await WhatsAppNotifierService.sendNotification(
          eventType,
          ticket,
          customer,
          state.system_settings,
          getAppBaseUrl(req)
        );
        state.wa_logs.unshift(waResult.log_entry);
        waDispatchResult = {
          wa_sent: waResult.wa_sent,
          mode: waResult.mode,
          fallback_url: waResult.fallback_url,
          message_preview: waResult.message_preview,
        };
      }

      dbStore.save();

      // Cache Invalidation: Hapus cache Redis untuk tiket ini
      await redisGuard.invalidateTicketCache(ticket.invoice_number, customer.whatsapp_last4);

      return res.json({
        message: autoPurgedPasscode
          ? `Status tiket diperbarui ke Selesai & Diambil. PIN pelanggan telah dihapus otomatis dan garansi ${ticket.warranty_days} hari aktif.`
          : ticket.status === 'CANCELLED'
            ? `Status tiket ${ticket.invoice_number} diubah menjadi Dibatalkan. Seluruh biaya dan modal otomatis di-reset ke Rp 0.`
            : `Tiket ${ticket.invoice_number} berhasil diperbarui.`,
        auto_purged_passcode: autoPurgedPasscode,
        ticket: toAdminTicketView(ticket, customer, state.ticket_logs, state.wa_logs),
        whatsapp_dispatch: waDispatchResult,
      });
    }
  );

  // Hapus Tiket Servis Secara Permanen (`DELETE /api/v1/admin/tickets/:id` & `/api/services/:id` - OWNER/ADMIN ONLY)
  app.delete(
    ['/api/v1/admin/tickets/:id', '/api/services/:id'],
    requireAdminAuth,
    requireOwnerRole,
    async (req: AuthenticatedRequest, res: Response) => {
      const ticketId = req.params.id;
      const state = dbStore.getState();
      const ticketIndex = state.tickets.findIndex((t) => t.id === ticketId);

      if (ticketIndex === -1) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Nota servis tidak ditemukan.',
        });
      }

      const targetTicket = state.tickets[ticketIndex];
      const customer = state.customers.find((c) => c.id === targetTicket.customer_id);

      // Hapus tiket beserta riwayat log pengerjaan dan log WA terkait
      state.tickets.splice(ticketIndex, 1);
      state.ticket_logs = state.ticket_logs.filter((l) => l.ticket_id !== ticketId);
      state.wa_logs = state.wa_logs.filter((w) => w.ticket_id !== ticketId);

      dbStore.save();

      if (customer) {
        await redisGuard.invalidateTicketCache(targetTicket.invoice_number, customer.whatsapp_last4);
      }

      return res.json({
        message: `Nota servis ${targetTicket.invoice_number} berhasil dihapus secara permanen.`,
        deleted_id: ticketId,
      });
    }
  );

  // Kirim Ulang / Trigger Notifikasi WA Spesifik dari Panel Admin
  app.post(
    '/api/v1/admin/tickets/:id/notify-wa',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const state = dbStore.getState();
      const ticket = state.tickets.find((t) => t.id === req.params.id);
      if (!ticket) {
        return res.status(404).json({ error: 'Tiket tidak ditemukan' });
      }
      const customer = state.customers.find((c) => c.id === ticket.customer_id);
      if (!customer) {
        return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
      }
      if (!hasValidCustomerWhatsApp(customer.whatsapp_number)) {
        return res.status(400).json({
          error: 'NO_WHATSAPP_NUMBER',
          message: 'Nomor WA tidak tersedia untuk tiket ini.',
        });
      }

      const eventType: WaTriggerEvent =
        ticket.status === 'WAITING_APPROVAL'
          ? 'WAITING_APPROVAL'
          : ticket.status === 'READY_FOR_PICKUP' || ticket.status === 'PICKED_UP'
            ? 'READY_FOR_PICKUP'
            : 'RECEIVED';

      const waResult = await WhatsAppNotifierService.sendNotification(
        eventType,
        ticket,
        customer,
        state.system_settings,
        getAppBaseUrl(req)
      );
      state.wa_logs.unshift(waResult.log_entry);
      dbStore.save();

      return res.json({
        whatsapp_dispatch: {
          wa_sent: waResult.wa_sent,
          mode: waResult.mode,
          fallback_url: waResult.fallback_url,
          message_preview: waResult.message_preview,
        },
        ticket: toAdminTicketView(ticket, customer, state.ticket_logs, state.wa_logs),
      });
    }
  );

  // Ambil Profil Usaha Publik (Untuk Header & Footer Cetak Nota)
  app.get('/api/v1/public/store-profile', (_req: Request, res: Response) => {
    const settings = dbStore.getState().system_settings;
    return res.json({
      store_name: settings.store_name || 'Geektech-Com',
      store_slogan: settings.store_slogan || 'Spesialis Perbaikan Laptop & Smartphone',
      store_address: settings.store_address || '',
      store_phone: settings.store_phone || '',
      receipt_footer_notes:
        settings.receipt_footer_notes ||
        'Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.',
    });
  });

  // Proteksi seluruh rute /api/settings/* dan /api/v1/admin/settings/* hanya untuk OWNER / ADMIN
  app.use(['/api/v1/admin/settings', '/api/settings'], requireAdminAuth, requireOwnerRole);

  // Update Profil Usaha (`PUT /api/v1/admin/settings/profile`)
  app.put(
    '/api/v1/admin/settings/profile',
    requireAdminAuth,
    requireOwnerRole,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = UpdateStoreProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Data profil usaha tidak valid.',
        });
      }

      const state = dbStore.getState();
      state.system_settings = {
        ...state.system_settings,
        id: 1,
        store_name: parsed.data.store_name,
        store_slogan: parsed.data.store_slogan,
        store_address: parsed.data.store_address,
        store_phone: parsed.data.store_phone,
        receipt_footer_notes: parsed.data.receipt_footer_notes,
        updated_at: new Date().toISOString(),
      };
      dbStore.save();

      return res.json({
        message: 'Profil Usaha dan pengaturan cetak nota berhasil disimpan.',
        system_settings: state.system_settings,
      });
    }
  );

  // Update Konfigurasi Wablas Gateway (`SystemSetting`)
  app.put(
    '/api/v1/admin/settings/wablas',
    requireAdminAuth,
    requireOwnerRole,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = UpdateWablasSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Konfigurasi Wablas tidak valid.',
        });
      }

      const state = dbStore.getState();
      state.system_settings = {
        ...state.system_settings,
        id: 1,
        wablas_domain: parsed.data.wablas_domain,
        wablas_api_key: parsed.data.wablas_api_key,
        wablas_secret_key: parsed.data.wablas_secret_key,
        is_wablas_enabled: parsed.data.is_wablas_enabled,
        updated_at: new Date().toISOString(),
      };
      dbStore.save();

      return res.json({
        message: 'Konfigurasi WhatsApp Gateway berhasil disimpan.',
        system_settings: state.system_settings,
      });
    }
  );

  // ==========================================================================
  // MANAJEMEN TIM (KELOLA ADMIN, TEKNISI & KASIR - ROLE OWNER ONLY)
  // ==========================================================================

  // 1. Ambil daftar akun tim (Owner Only)
  app.get(
    '/api/v1/admin/team',
    requireAdminAuth,
    requireOwnerRole,
    async (_req: AuthenticatedRequest, res: Response) => {
      const state = dbStore.getState();
      const users = state.admins.map((a) => ({
        id: a.id,
        username: a.username,
        full_name: a.full_name || a.username,
        role: a.role,
        last_login_ip: a.last_login_ip,
        created_at: a.created_at,
      }));
      return res.json({ team_members: users });
    }
  );

  // 2. Tambah Akun Tim Baru (Owner Only)
  app.post(
    '/api/v1/admin/team',
    requireAdminAuth,
    requireOwnerRole,
    async (req: AuthenticatedRequest, res: Response) => {
      if (req.adminUser?.role !== 'OWNER') {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Hanya akun dengan peran OWNER yang dapat menambah pengguna baru.',
        });
      }

      const parsed = CreateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Input anggota tim tidak valid.',
        });
      }

      const { username, full_name, password, role } = parsed.data;
      const state = dbStore.getState();

      const exists = state.admins.some((a) => a.username.toLowerCase() === username.toLowerCase());
      if (exists) {
        return res.status(409).json({
          error: 'USER_EXISTS',
          message: `Username "${username}" sudah digunakan. Silakan gunakan username lain.`,
        });
      }

      const newAdmin: AdminRecord = {
        id: crypto.randomUUID(),
        username: username.toLowerCase(),
        full_name,
        password_hash: hashPassword(password),
        role,
        last_login_ip: null,
        created_at: new Date().toISOString(),
      };

      state.admins.push(newAdmin);
      dbStore.save();

      return res.status(201).json({
        message: `Akun "${username}" (${role}) berhasil dibuat.`,
        user: {
          id: newAdmin.id,
          username: newAdmin.username,
          full_name: newAdmin.full_name,
          role: newAdmin.role,
          created_at: newAdmin.created_at,
        },
      });
    }
  );

  // 3. Ubah Password Akun Tim (Owner atau Pemilik Akun Sendiri)
  app.patch(
    '/api/v1/admin/team/:id/password',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const targetId = req.params.id;
      const isOwner = req.adminUser?.role === 'OWNER';
      const isSelf = req.adminUser?.sub === targetId;

      if (!isOwner && !isSelf) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Anda hanya diperbolehkan mengubah password akun Anda sendiri.',
        });
      }

      const parsed = UpdateUserPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Password baru tidak valid.',
        });
      }

      const state = dbStore.getState();
      const targetUser = state.admins.find((a) => a.id === targetId);
      if (!targetUser) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Akun tim tidak ditemukan.',
        });
      }

      const newPwd = parsed.data.new_password || parsed.data.password!;
      targetUser.password_hash = hashPassword(newPwd);
      dbStore.save();

      return res.json({
        message: `Password untuk akun "${targetUser.username}" berhasil diperbarui.`,
      });
    }
  );

  // 4. Hapus Akun Tim (Owner Only, tidak bisa hapus akun admin default/diri sendiri)
  app.delete(
    '/api/v1/admin/team/:id',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      if (req.adminUser?.role !== 'OWNER') {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Hanya peran OWNER yang dapat menghapus akun tim.',
        });
      }

      const targetId = req.params.id;
      if (req.adminUser?.sub === targetId) {
        return res.status(400).json({
          error: 'CANNOT_DELETE_SELF',
          message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.',
        });
      }

      const state = dbStore.getState();
      const targetUser = state.admins.find((a) => a.id === targetId);
      if (!targetUser) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Akun tidak ditemukan.',
        });
      }

      if (targetUser.username.toLowerCase() === 'admin') {
        return res.status(400).json({
          error: 'CANNOT_DELETE_ROOT_ADMIN',
          message: 'Akun utama "admin" tidak dapat dihapus demi keamanan sistem.',
        });
      }

      state.admins = state.admins.filter((a) => a.id !== targetId);
      dbStore.save();

      return res.json({
        message: `Akun "${targetUser.username}" berhasil dihapus dari sistem.`,
      });
    }
  );

  // 5. Edit Profil Akun Tim (Nama Lengkap & Username)
  app.patch(
    '/api/v1/admin/team/:id',
    requireAdminAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const targetId = req.params.id;
      const isOwner = req.adminUser?.role === 'OWNER';
      const isSelf = req.adminUser?.sub === targetId;

      if (!isOwner && !isSelf) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Anda hanya memiliki izin untuk mengubah profil akun Anda sendiri.',
        });
      }

      const rawFullName = String(req.body?.full_name || '').trim();
      const rawUsername = String(req.body?.username || '').trim().toLowerCase();

      if (rawFullName.length < 2 || rawFullName.length > 80) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Nama lengkap wajib diisi (minimal 2 karakter).',
        });
      }

      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(rawUsername)) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Username hanya boleh berisi huruf, angka, titik, strip, atau garis bawah (3-32 karakter).',
        });
      }

      const state = dbStore.getState();
      const targetUser = state.admins.find((a) => a.id === targetId);
      if (!targetUser) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Akun petugas tidak ditemukan.',
        });
      }

      const usernameExists = state.admins.some(
        (a) => a.id !== targetId && a.username.toLowerCase() === rawUsername
      );
      if (usernameExists) {
        return res.status(409).json({
          error: 'USER_EXISTS',
          message: `Username "${rawUsername}" sudah digunakan oleh akun lain.`,
        });
      }

      targetUser.full_name = rawFullName;
      targetUser.username = rawUsername;
      dbStore.save();

      let refreshedAccessToken: string | undefined;
      if (isSelf && req.adminUser) {
        refreshedAccessToken = signJwtToken(
          {
            sub: targetUser.id,
            username: targetUser.username,
            role: targetUser.role,
            session_id: req.adminUser.session_id,
            type: 'access',
          },
          15 * 60
        );
        const refreshedRefreshToken = signJwtToken(
          {
            sub: targetUser.id,
            username: targetUser.username,
            role: targetUser.role,
            session_id: req.adminUser.session_id,
            type: 'refresh',
          },
          7 * 24 * 3600
        );
        const csrfToken = generateCsrfToken(req.adminUser.session_id);
        setAuthCookies(res, refreshedAccessToken, refreshedRefreshToken, csrfToken);
      }

      return res.json({
        message: `Profil akun ${targetUser.full_name} (@${targetUser.username}) berhasil diperbarui.`,
        user: {
          id: targetUser.id,
          username: targetUser.username,
          full_name: targetUser.full_name,
          role: targetUser.role,
          last_login_ip: targetUser.last_login_ip,
          created_at: targetUser.created_at,
        },
        access_token: refreshedAccessToken,
      });
    }
  );

  // ==========================================================================
  // BACKUP & RESTORE DATABASE (EXPORT / IMPORT SELURUH TABEL JSON - OWNER ONLY)
  // ==========================================================================

  app.get(
    '/api/v1/admin/database/backup',
    requireAdminAuth,
    requireOwnerRole,
    async (_req: AuthenticatedRequest, res: Response) => {
      const state = dbStore.getState();
      const backupPayload = {
        app: 'Geektech-Com Service Management System',
        version: '1.0',
        exported_at: new Date().toISOString(),
        tables: {
          admins: state.admins,
          customers: state.customers,
          tickets: state.tickets,
          ticket_logs: state.ticket_logs,
          wa_logs: state.wa_logs,
          system_settings: state.system_settings,
        },
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="geektech-backup-${dateStr}.json"`
      );
      return res.status(200).send(JSON.stringify(backupPayload, null, 2));
    }
  );

  app.post(
    '/api/v1/admin/database/restore',
    requireAdminAuth,
    requireOwnerRole,
    async (req: AuthenticatedRequest, res: Response) => {
      const body = req.body;
      const source = body?.tables && typeof body.tables === 'object' ? body.tables : body;

      if (
        !source ||
        !Array.isArray(source.tickets) ||
        !Array.isArray(source.customers) ||
        !Array.isArray(source.admins) ||
        !source.system_settings
      ) {
        return res.status(400).json({
          error: 'INVALID_BACKUP_FORMAT',
          message:
            'Format file backup (.json) tidak valid. Pastikan file berasal dari fitur Unduh Backup Database Geektech-Com.',
        });
      }

      if (source.admins.length === 0) {
        return res.status(400).json({
          error: 'EMPTY_ADMINS',
          message: 'File backup tidak memiliki data akun petugas (admins). Restore dibatalkan.',
        });
      }

      const currentState = dbStore.getState();

      // Pastikan akun yang sedang aktif tetap ada atau minimal seluruh tabel tervalidasi
      const restoredAdmins: AdminRecord[] = source.admins.map((a: AdminRecord) => ({
        ...a,
        full_name: a.full_name || a.username,
        role: a.role || 'OWNER',
      }));

      // Jika akun yang sedang login tidak ada di file backup lama, pertahankan akun saat ini agar sesi tidak terputus
      if (req.adminUser) {
        const currentAdminInBackup = restoredAdmins.some((a) => a.id === req.adminUser?.sub);
        if (!currentAdminInBackup) {
          const selfRecord = currentState.admins.find((a) => a.id === req.adminUser?.sub);
          if (selfRecord) {
            restoredAdmins.unshift(selfRecord);
          }
        }
      }

      const newState = {
        admins: restoredAdmins,
        customers: Array.isArray(source.customers) ? source.customers : [],
        tickets: Array.isArray(source.tickets) ? source.tickets : [],
        ticket_logs: Array.isArray(source.ticket_logs) ? source.ticket_logs : [],
        wa_logs: Array.isArray(source.wa_logs) ? source.wa_logs : [],
        system_settings: {
          ...currentState.system_settings,
          ...source.system_settings,
          updated_at: new Date().toISOString(),
        },
      };

      // Invalidate cache tiket lama & baru di Redis
      for (const t of currentState.tickets) {
        const cust = currentState.customers.find((c) => c.id === t.customer_id);
        await redisGuard.invalidateTicketCache(t.invoice_number, cust?.whatsapp_last4 || '0000');
      }
      for (const t of newState.tickets) {
        if (t?.invoice_number) {
          const cust = newState.customers.find((c: CustomerRecord) => c.id === t.customer_id);
          await redisGuard.invalidateTicketCache(t.invoice_number, cust?.whatsapp_last4 || '0000');
        }
      }

      dbStore.replaceState(newState);

      const updatedSelf = newState.admins.find((a) => a.id === req.adminUser?.sub);

      return res.json({
        message: `Restore database berhasil! (${newState.tickets.length} nota servis, ${newState.customers.length} pelanggan, dan ${newState.admins.length} akun petugas telah dipulihkan).`,
        summary: {
          tickets_count: newState.tickets.length,
          customers_count: newState.customers.length,
          admins_count: newState.admins.length,
        },
        current_admin: updatedSelf
          ? {
              id: updatedSelf.id,
              username: updatedSelf.username,
              full_name: updatedSelf.full_name || updatedSelf.username,
              role: updatedSelf.role,
              session_id: req.adminUser?.session_id || '',
            }
          : undefined,
      });
    }
  );

  // Reset Rate Limit IP (Untuk mempermudah pengujian fitur Anti-Brute Force 429)
  app.post('/api/v1/public/reset-rate-limit', async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    await redisGuard.resetRateLimitForIp(ip);
    return res.json({
      message: `Rate limit & blokir IP (${ip}) telah di-reset.`,
    });
  });

  // --------------------------------------------------------------------------
  // 6. ENDPOINT BLUEPRINT ARSITEKTUR TAHAP 1–4 (UNTUK INSPEKSI KODE LENGKAP)
  // --------------------------------------------------------------------------

  app.get('/api/v1/blueprint/files', (_req: Request, res: Response) => {
    const safeRead = (relPath: string) => {
      try {
        return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
      } catch {
        return '// File tidak ditemukan';
      }
    };

    return res.json({
      stages: [
        {
          stage: 'Tahap 1: Infrastruktur & Skema Database',
          files: [
            { name: 'docker-compose.yml', language: 'yaml', content: safeRead('docker-compose.yml') },
            { name: 'nginx/nginx.conf', language: 'nginx', content: safeRead('nginx/nginx.conf') },
            { name: '.env.example', language: 'dotenv', content: safeRead('.env.example') },
            { name: 'prisma/schema.prisma', language: 'prisma', content: safeRead('prisma/schema.prisma') },
          ],
        },
        {
          stage: 'Tahap 2: Backend Core (Auth Cookie, Redis Guard, AES-256, Wablas + Fallback)',
          files: [
            { name: 'src/server/cryptoAndAuth.ts', language: 'typescript', content: safeRead('src/server/cryptoAndAuth.ts') },
            { name: 'src/server/redisGuard.ts', language: 'typescript', content: safeRead('src/server/redisGuard.ts') },
            { name: 'src/server/whatsappNotifier.ts', language: 'typescript', content: safeRead('src/server/whatsappNotifier.ts') },
          ],
        },
        {
          stage: 'Tahap 3: Backend Controllers, Strict Public DTO & Auto-Purge PIN',
          files: [
            { name: 'src/server/dtoAndStore.ts', language: 'typescript', content: safeRead('src/server/dtoAndStore.ts') },
            { name: 'server.ts', language: 'typescript', content: safeRead('server.ts') },
          ],
        },
      ],
    });
  });

  const httpServer = http.createServer(app);

  const distPath = path.resolve(process.cwd(), 'dist');
  const distIndexHtml = path.join(distPath, 'index.html');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' &&
      process.env.DISABLE_HMR !== 'true' &&
      fs.existsSync(distIndexHtml));

  if (isProduction && fs.existsSync(distIndexHtml)) {
    // MODE PRODUCTION: Sajikan file statis yang sudah di-minify dari folder dist/
    app.use(
      express.static(distPath, {
        maxAge: '7d',
        index: false,
      })
    );

    // Catch-all route untuk React SPA agar refresh halaman tidak menghasilkan 404
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      return res.sendFile(distIndexHtml);
    });
  } else {
    // MODE DEVELOPMENT: Gunakan Vite Middleware
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });

  const activePort = Number(process.env.PORT) || PORT;
  httpServer.listen(activePort, '0.0.0.0', () => {
    console.log(
      `Geektech-Com Full-Stack Server [${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}] running on http://0.0.0.0:${activePort}`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
