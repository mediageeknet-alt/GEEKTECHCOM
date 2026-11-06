import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  encryptPasscodeAES256,
  decryptPasscodeAES256,
  hashPassword,
  verifyPassword,
} from './cryptoAndAuth.ts';

// ============================================================================
// TAHAP 3A: SKEMA DATA, AUTO-PURGE HOOK, DAN STRICT PUBLIC DTO FILTERING
// ============================================================================

export type AdminRole = 'OWNER' | 'TECHNICIAN' | 'CASHIER';
export type DeviceCategory = 'LAPTOP' | 'SMARTPHONE' | 'OTHER';
export type TicketStatus =
  | 'RECEIVED'
  | 'DIAGNOSING'
  | 'WAITING_APPROVAL'
  | 'IN_PROGRESS'
  | 'QC_TESTING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'CANCELLED';

export type ServiceType = 'REGULAR' | 'WARRANTY_CLAIM' | 'PRIORITY';

export interface PhysicalChecklist {
  unit_only?: boolean;
  mati_total?: boolean;
  charger: boolean;
  tas: boolean;
  sim_tray_memory: boolean;
  layar_baret: boolean;
  casing_lecet: boolean;
  baut_kurang: number;
  catatan_fisik?: string;
  hardware_specs?: string;
}

export interface AdminRecord {
  id: string;
  username: string;
  full_name?: string;
  password_hash: string;
  role: AdminRole;
  last_login_ip: string | null;
  created_at: string;
}

export interface CustomerRecord {
  id: string;
  full_name: string;
  whatsapp_number: string; // Format 628xxx atau '-' (STRICTLY PRIVATE)
  whatsapp_last4: string;  // CHAR(4) - Digunakan sebagai PIN Lacak Publik
  address: string | null;  // STRICTLY PRIVATE
  created_at: string;
}

export interface ServiceTicketRecord {
  id: string;
  invoice_number: string; // Format: GTC-YYYYMMDD-XXXX
  customer_id: string;
  device_category: DeviceCategory;
  device_brand_model: string;
  service_type?: ServiceType;
  serial_number_imei: string | null;
  passcode_encrypted: string | null; // AES-256-GCM, otomatis NULL saat PICKED_UP
  physical_checklist: PhysicalChecklist;
  hardware_specs?: string | null;
  initial_complaint: string;
  public_diagnosis: string | null;
  secret_technician_notes: string | null; // RAHASIA ADMIN
  status: TicketStatus;
  customer_approved: boolean;
  estimated_cost: number;
  final_price: number;
  down_payment?: number; // Panjar / DP
  parts_cost_modal: number; // RAHASIA ADMIN
  warranty_days: number;
  picked_up_at?: string | null;
  pickup_by?: string | null;
  pickup_notes?: string | null;
  warranty_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketLogRecord {
  id: string;
  ticket_id: string;
  status_step: TicketStatus;
  public_description: string;
  photo_url: string | null;
  created_at: string;
}

export interface WaNotificationLogRecord {
  id: string;
  ticket_id: string;
  method: 'WABLAS_API' | 'DIRECT_WA_FALLBACK';
  status: 'SENT' | 'FAILED' | 'FALLBACK_TRIGGERED';
  response_log: string;
  sent_at: string;
}

export interface SystemSettingRecord {
  id: number;
  store_name: string;
  store_slogan: string;
  store_address: string;
  store_phone: string;
  receipt_footer_notes: string;
  wablas_domain: string;
  wablas_api_key: string;
  wablas_secret_key: string;
  is_wablas_enabled: boolean;
  updated_at: string;
}

// ============================================================================
// STRICT PUBLIC DTO (ZERO DATA LEAKAGE SERIALIZER)
// DILARANG KERAS menyertakan whatsapp_number, address, secret_technician_notes,
// parts_cost_modal, atau passcode_encrypted!
// ============================================================================

export interface PublicTicketTrackDTO {
  invoice_number: string;
  customer_masked_name: string;
  has_whatsapp?: boolean;
  device_category: DeviceCategory;
  device_brand_model: string;
  service_type?: ServiceType;
  serial_number_masked: string | null;
  physical_checklist: PhysicalChecklist;
  hardware_specs?: string | null;
  initial_complaint: string;
  public_diagnosis: string | null;
  status: TicketStatus;
  customer_approved: boolean;
  estimated_cost: number;
  final_price: number;
  down_payment?: number;
  warranty_days: number;
  picked_up_at?: string | null;
  pickup_by?: string | null;
  pickup_notes?: string | null;
  warranty_expires_at: string | null;
  warranty_remaining_days: number | null;
  created_at: string;
  updated_at: string;
  logs: {
    id: string;
    status_step: TicketStatus;
    public_description: string;
    photo_url: string | null;
    created_at: string;
  }[];
}

/**
 * Masking nama pelanggan secara ketat:
 * Contoh: "M. Nizar" -> "M. N***", "Rizky Pratama" -> "Rizky P***", "Andi" -> "An***"
 */
export function maskCustomerName(fullName: string): string {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Pelanggan ***';
  const parts = cleaned.split(' ');
  if (parts.length === 1) {
    const word = parts[0];
    if (word.length <= 2) return `${word[0]}***`;
    return `${word.slice(0, 2)}***`;
  }
  const firstPart = parts[0];
  const secondInitial = parts[1][0] || '';
  return `${firstPart} ${secondInitial}***`;
}

export function maskSerialNumber(sn: string | null): string | null {
  if (!sn || !sn.trim()) return null;
  const clean = sn.trim();
  if (clean.length <= 4) return `***${clean.slice(-2)}`;
  return `${clean.slice(0, 3)}••••${clean.slice(-3)}`;
}

/**
 * Serializer DTO Publik Ketat — Hanya memilih field yang aman untuk publik.
 * Logika Hitung Mundur Garansi:
 * Garansi hanya aktif jika status === 'PICKED_UP'.
 * Sisa Hari Garansi = (Tanggal Diambil + Jumlah Hari Garansi) - Hari Ini.
 */
export function toPublicTicketDTO(
  ticket: ServiceTicketRecord,
  customer: CustomerRecord,
  logs: TicketLogRecord[]
): PublicTicketTrackDTO {
  const ticketLogs = logs
    .filter((l) => l.ticket_id === ticket.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const warrantyDays = Math.max(0, Number(ticket.warranty_days ?? 0));
  let pickedUpAt: string | null = null;
  let warrantyExpiresAt: string | null = null;
  let warrantyRemainingDays: number | null = null;

  if (ticket.status === 'PICKED_UP') {
    const pickedUpLog = [...ticketLogs].reverse().find((l) => l.status_step === 'PICKED_UP');
    pickedUpAt = ticket.picked_up_at || pickedUpLog?.created_at || ticket.updated_at;

    if (warrantyDays > 0) {
      const pickedUpMs = new Date(pickedUpAt).getTime();
      const expiresMs = pickedUpMs + warrantyDays * 24 * 60 * 60 * 1000;
      warrantyExpiresAt = new Date(expiresMs).toISOString();
      const diffMs = expiresMs - Date.now();
      warrantyRemainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    } else {
      warrantyExpiresAt = null;
      warrantyRemainingDays = 0;
    }
  }

  const hasWhatsapp = Boolean(
    customer.whatsapp_number &&
      customer.whatsapp_number.trim() !== '' &&
      customer.whatsapp_number.trim() !== '-' &&
      customer.whatsapp_number.replace(/[^0-9]/g, '').length >= 4
  );

  return {
    invoice_number: ticket.invoice_number,
    customer_masked_name: maskCustomerName(customer.full_name),
    has_whatsapp: hasWhatsapp,
    device_category: ticket.device_category,
    device_brand_model: ticket.device_brand_model,
    service_type: ticket.service_type || 'REGULAR',
    serial_number_masked: maskSerialNumber(ticket.serial_number_imei),
    physical_checklist: ticket.physical_checklist,
    hardware_specs: ticket.hardware_specs || ticket.physical_checklist.hardware_specs || null,
    initial_complaint: ticket.initial_complaint,
    public_diagnosis: ticket.public_diagnosis,
    status: ticket.status,
    customer_approved: ticket.customer_approved,
    estimated_cost: Number(ticket.estimated_cost),
    final_price: Number(ticket.final_price),
    down_payment: Number(ticket.down_payment || 0),
    warranty_days: warrantyDays,
    picked_up_at: pickedUpAt,
    pickup_by: ticket.status === 'PICKED_UP' ? ticket.pickup_by || null : null,
    pickup_notes: ticket.status === 'PICKED_UP' ? ticket.pickup_notes || null : null,
    warranty_expires_at: warrantyExpiresAt,
    warranty_remaining_days: warrantyRemainingDays,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    logs: ticketLogs.map((l) => ({
      id: l.id,
      status_step: l.status_step,
      public_description: l.public_description,
      photo_url: l.photo_url,
      created_at: l.created_at,
    })),
  };
}

/**
 * Serializer Admin Lengkap (Mencakup dekripsi PIN AES-256 selama status != PICKED_UP,
 * catatan rahasia teknisi, harga modal sparepart, dan kalkulasi laba bersih).
 */
export function toAdminTicketView(
  ticket: ServiceTicketRecord,
  customer: CustomerRecord,
  logs: TicketLogRecord[],
  waLogs: WaNotificationLogRecord[]
) {
  const effectiveRevenue =
    ticket.final_price > 0 ? Number(ticket.final_price) : Number(ticket.estimated_cost);
  const netProfit =
    ticket.status === 'CANCELLED' ? 0 : effectiveRevenue - Number(ticket.parts_cost_modal);

  return {
    ...ticket,
    passcode_decrypted: ticket.passcode_encrypted
      ? decryptPasscodeAES256(ticket.passcode_encrypted)
      : null,
    net_profit: netProfit,
    customer: {
      id: customer.id,
      full_name: customer.full_name,
      whatsapp_number: customer.whatsapp_number,
      whatsapp_last4: customer.whatsapp_last4,
      address: customer.address,
    },
    logs: logs
      .filter((l) => l.ticket_id === ticket.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    wa_notifications: waLogs
      .filter((w) => w.ticket_id === ticket.id)
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at)),
  };
}

// ============================================================================
// GENERATOR SVG DIAGNOSTIC PHOTO (ZERO BROKEN IMAGE GUARANTEE)
// ============================================================================

function createDiagnosticSvgDataUri(
  title: string,
  subtitle: string,
  hashLabel: string,
  accentHex: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0B0F19"/>
        <stop offset="55%" stop-color="#111827"/>
        <stop offset="100%" stop-color="#1E293B"/>
      </linearGradient>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#334155" stroke-width="0.6" stroke-opacity="0.45"/>
      </pattern>
    </defs>
    <rect width="800" height="500" fill="url(#bg)"/>
    <rect width="800" height="500" fill="url(#grid)"/>
    <rect x="36" y="36" width="728" height="428" rx="14" fill="#0F172A" fill-opacity="0.82" stroke="${accentHex}" stroke-width="1.5" stroke-opacity="0.55"/>
    <!-- PCB Schematic Graphic -->
    <g transform="translate(70, 95)" stroke="${accentHex}" fill="none">
      <rect x="0" y="0" width="280" height="210" rx="8" stroke-width="1.8" fill="#111827"/>
      <rect x="35" y="35" width="90" height="90" rx="4" stroke-width="1.5" fill="#1E293B"/>
      <rect x="155" y="35" width="90" height="55" rx="4" stroke-width="1.5" fill="#1E293B"/>
      <circle cx="200" cy="145" r="28" stroke-width="1.5" fill="#1E293B"/>
      <path d="M 125 60 L 155 60 M 125 90 L 155 90 M 80 125 L 80 180 L 172 145" stroke-width="1.4" stroke-dasharray="4 3"/>
      <circle cx="80" cy="80" r="8" fill="${accentHex}" fill-opacity="0.35"/>
      <circle cx="200" cy="145" r="6" fill="${accentHex}"/>
    </g>
    <!-- Inspection Telemetry -->
    <text x="385" y="135" fill="#94A3B8" font-family="monospace" font-size="13" letter-spacing="1">GEEKTECH-COM LAB INSPECTION</text>
    <text x="385" y="175" fill="#F8FAFC" font-family="sans-serif" font-size="22" font-weight="700">${title}</text>
    <text x="385" y="210" fill="#CBD5E1" font-family="sans-serif" font-size="15">${subtitle}</text>
    <rect x="385" y="242" width="340" height="92" rx="8" fill="#1E293B" stroke="#334155" stroke-width="1"/>
    <text x="405" y="272" fill="${accentHex}" font-family="monospace" font-size="13">VCC_MAIN RAIL : 19.85V STABLE</text>
    <text x="405" y="296" fill="#E2E8F0" font-family="monospace" font-size="13">THERMAL DELTA : 41.2°C NOMINAL</text>
    <text x="405" y="320" fill="#94A3B8" font-family="monospace" font-size="12">HASH: ${hashLabel}</text>
    <text x="70" y="425" fill="#64748B" font-family="monospace" font-size="12">VERIFIED OPTICAL BENCH CAPTURE · ZERO-EXIF SANITIZED</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ============================================================================
// DATABASE STORE PERSISTEN (.data/geektech-db.json)
// ============================================================================

export interface DatabaseState {
  admins: AdminRecord[];
  customers: CustomerRecord[];
  tickets: ServiceTicketRecord[];
  ticket_logs: TicketLogRecord[];
  wa_logs: WaNotificationLogRecord[];
  system_settings: SystemSettingRecord;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'geektech-db.json');

function createInitialSeedData(): DatabaseState {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString();
  const sixHoursAgo = new Date(now.getTime() - 6 * 3600 * 1000).toISOString();
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString();
  const warrantyFromOneDayAgo = new Date(
    new Date(oneDayAgo).getTime() + 30 * 24 * 3600 * 1000
  ).toISOString();

  const cust1Id = 'c1111111-1111-4111-8111-111111111111';
  const cust2Id = 'c2222222-2222-4222-8222-222222222222';
  const cust3Id = 'c3333333-3333-4333-8333-333333333333';
  const cust4Id = 'c4444444-4444-4444-8444-444444444444';
  const cust5Id = 'c5555555-5555-4555-8555-555555555555';

  const t1Id = 'd1111111-1111-4111-8111-111111111111';
  const t2Id = 'd2222222-2222-4222-8222-222222222222';
  const t3Id = 'd3333333-3333-4333-8333-333333333333';
  const t4Id = 'd4444444-4444-4444-8444-444444444444';
  const t5Id = 'd5555555-5555-4555-8555-555555555555';

  return {
    admins: [
      {
        id: 'a1111111-1111-4111-8111-111111111111',
        username: 'admin',
        full_name: 'Administrator',
        password_hash: hashPassword('admin123'),
        role: 'OWNER',
        last_login_ip: null,
        created_at: threeDaysAgo,
      },
    ],
    customers: [
      {
        id: cust1Id,
        full_name: 'M. Nizar Pratama',
        whatsapp_number: '6281234568821',
        whatsapp_last4: '8821',
        address: 'Jl. Soekarno Hatta No. 48, Lowokwaru, Malang',
        created_at: twoDaysAgo,
      },
      {
        id: cust2Id,
        full_name: 'Alya Rahmawati',
        whatsapp_number: '6281398764410',
        whatsapp_last4: '4410',
        address: 'Perum Griya Shanta Blok K-12, Malang',
        created_at: twoDaysAgo,
      },
      {
        id: cust3Id,
        full_name: 'Hendra Wijaya',
        whatsapp_number: '6285711229090',
        whatsapp_last4: '9090',
        address: 'Jl. Ijen Besar No. 19, Klojen, Malang',
        created_at: threeDaysAgo,
      },
      {
        id: cust4Id,
        full_name: 'Dimas Aditya',
        whatsapp_number: '6282155447712',
        whatsapp_last4: '7712',
        address: 'Jl. Veteran No. 10, Malang',
        created_at: oneDayAgo,
      },
      {
        id: cust5Id,
        full_name: 'Clarissa Putri',
        whatsapp_number: '6281133445599',
        whatsapp_last4: '5599',
        address: 'Jl. Dieng Atas No. 88, Malang',
        created_at: sixHoursAgo,
      },
    ],
    tickets: [
      {
        id: t1Id,
        invoice_number: 'GTC-20261103-8F2A',
        customer_id: cust1Id,
        device_category: 'LAPTOP',
        device_brand_model: 'MacBook Pro 14" M2 Pro (A2779)',
        serial_number_imei: 'C02Y89ZKL490',
        passcode_encrypted: encryptPasscodeAES256('MacNizar#88'),
        physical_checklist: {
          charger: true,
          tas: true,
          sim_tray_memory: false,
          layar_baret: false,
          casing_lecet: true,
          baut_kurang: 0,
          catatan_fisik: 'Dent halus di sudut kiri palmrest, charger MagSafe 3 67W dibawa.',
        },
        initial_complaint: 'Mati total setelah terkena cipratan kopi di area trackpad, indikator MagSafe tidak menyala.',
        public_diagnosis:
          'Ditemukan korosi pada jalur IC CD3217B12 (USB-C Controller) dan kapasitor filter PPBUS_AON short. Perlu penggantian IC CD3217, reballing jalur pad, dan ultrasonic cleaning.',
        secret_technician_notes:
          'Jumper jalur PP3V3_G3H pin 14 ke R7020 (skema board 820-02773-A). IC CD3217B12 supplier Sinar Jaya Part Rp 285.000 + flux Amtech Rp 35.000.',
        status: 'WAITING_APPROVAL',
        customer_approved: false,
        estimated_cost: 1450000,
        final_price: 1450000,
        parts_cost_modal: 320000,
        warranty_days: 60,
        warranty_expires_at: null,
        created_at: twoDaysAgo,
        updated_at: twoHoursAgo,
      },
      {
        id: t2Id,
        invoice_number: 'GTC-20261103-4K9P',
        customer_id: cust2Id,
        device_category: 'SMARTPHONE',
        device_brand_model: 'iPhone 15 Pro Max 256GB Natural Titanium',
        serial_number_imei: '358901249812774',
        passcode_encrypted: encryptPasscodeAES256('240899'),
        physical_checklist: {
          charger: false,
          tas: false,
          sim_tray_memory: true,
          layar_baret: true,
          casing_lecet: false,
          baut_kurang: 0,
          catatan_fisik: 'Unit only, tempered glass retak di pojok kanan atas.',
        },
        initial_complaint: 'Layar tiba-tiba blank hijau/putih (Green Screen of Death) setelah update iOS, suara notifikasi masih masuk.',
        public_diagnosis:
          'Jalur fleksibel OLED mengalami micro-fracture pada jalur VSN/VSP. Sedang dilakukan proses direct bonding fleksibel layar & kalibrasi TrueTone.',
        secret_technician_notes:
          'Jumper jalur VGH ke testpoint TP-4 (micro-wire 0.01mm UV mask). Modal kawat + lem ACF Rp 95.000, pengerjaan in-house.',
        status: 'IN_PROGRESS',
        customer_approved: true,
        estimated_cost: 950000,
        final_price: 950000,
        parts_cost_modal: 95000,
        warranty_days: 30,
        warranty_expires_at: null,
        created_at: twoDaysAgo,
        updated_at: sixHoursAgo,
      },
      {
        id: t3Id,
        invoice_number: 'GTC-20261031-9M1X',
        customer_id: cust3Id,
        device_category: 'LAPTOP',
        device_brand_model: 'ASUS ROG Zephyrus G14 GA402RJ (Ryzen 9)',
        serial_number_imei: 'N4NRKD008192',
        passcode_encrypted: null, // Otomatis NULL karena sudah PICKED_UP (Auto-Purge Privacy)
        physical_checklist: {
          charger: true,
          tas: false,
          sim_tray_memory: false,
          layar_baret: false,
          casing_lecet: false,
          baut_kurang: 2,
          catatan_fisik: 'Baut backcover bawah kurang 2 pcs sejak awal masuk.',
        },
        initial_complaint: 'Suhu CPU tembus 98°C dan sering mati mendadak (thermal shutdown) saat rendering 3D.',
        public_diagnosis:
          'Liquid metal bawaan pabrik mengering dan menggeser dari die CPU. Telah dilakukan pembersihan total heatsink, aplikasi ulang Thermal Grizzly Conductonaut + penggantian thermal pad VRAM.',
        secret_technician_notes:
          'Seal conformal coating di sekeliling SMD kapasitor CPU wajib 2 lapis agar liquid metal aman. Modal Conductonaut + Arctic Pad 1.0mm Rp 165.000.',
        status: 'PICKED_UP',
        customer_approved: true,
        estimated_cost: 650000,
        final_price: 650000,
        parts_cost_modal: 165000,
        warranty_days: 30,
        picked_up_at: oneDayAgo,
        pickup_by: 'Hendra Wijaya',
        pickup_notes: 'Diambil sendiri (membawa nota asli)',
        warranty_expires_at: warrantyFromOneDayAgo,
        created_at: threeDaysAgo,
        updated_at: oneDayAgo,
      },
      {
        id: t4Id,
        invoice_number: 'GTC-20261103-7C3E',
        customer_id: cust4Id,
        device_category: 'LAPTOP',
        device_brand_model: 'Lenovo Legion 5 Pro 16ACH6H (RTX 3070)',
        serial_number_imei: 'PF38LK91',
        passcode_encrypted: encryptPasscodeAES256('Legion#7712'),
        physical_checklist: {
          charger: true,
          tas: true,
          sim_tray_memory: false,
          layar_baret: false,
          casing_lecet: false,
          baut_kurang: 0,
          catatan_fisik: 'Charger 300W original disertakan.',
        },
        initial_complaint: 'Port charger belakang longgar dan harus diganjal agar bisa mengisi daya.',
        public_diagnosis:
          'Konektor DC-In persegi mengalami patah pin tengah akibat panas berlebih. Penggantian konektor DC-In original & penguatan timah jalur ground selesai, lulus uji beban 300W.',
        secret_technician_notes:
          'Part konektor DC-In Legion 300W beli di IndoSparepart Rp 85.000.',
        status: 'READY_FOR_PICKUP',
        customer_approved: true,
        estimated_cost: 420000,
        final_price: 420000,
        parts_cost_modal: 85000,
        warranty_days: 45,
        warranty_expires_at: null,
        created_at: oneDayAgo,
        updated_at: twoHoursAgo,
      },
      {
        id: t5Id,
        invoice_number: 'GTC-20261103-2B5R',
        customer_id: cust5Id,
        device_category: 'SMARTPHONE',
        device_brand_model: 'Samsung Galaxy S23 Ultra 5G 512GB',
        serial_number_imei: '354719880231559',
        passcode_encrypted: encryptPasscodeAES256('Pola-Z-5599'),
        physical_checklist: {
          charger: false,
          tas: false,
          sim_tray_memory: true,
          layar_baret: false,
          casing_lecet: true,
          baut_kurang: 0,
          catatan_fisik: 'S-Pen terpasang normal, bezel bawah ada gores tipis.',
        },
        initial_complaint: 'Kamera utama 1x dan 3x tidak bisa fokus (blur) serta terdengar bunyi getar halus di modul kamera.',
        public_diagnosis:
          'Sedang dilakukan pemeriksaan modul OIS (Optical Image Stabilization) pada sensor utama 200MP dan pengujian jalur tegangan LDO kamera.',
        secret_technician_notes:
          'Cek soket J6002 dan LDO MIPI camera. Jika OIS coil putus, modul kamera copotan ori stok laci B-4 modal Rp 550.000.',
        status: 'DIAGNOSING',
        customer_approved: false,
        estimated_cost: 980000,
        final_price: 0,
        parts_cost_modal: 550000,
        warranty_days: 30,
        warranty_expires_at: null,
        created_at: sixHoursAgo,
        updated_at: twoHoursAgo,
      },
    ],
    ticket_logs: [
      {
        id: 'l101',
        ticket_id: t1Id,
        status_step: 'RECEIVED',
        public_description:
          'Unit MacBook Pro 14" M2 Pro diterima di Geektech-Com. Pengecekan fisik awal telah dilakukan bersama pelanggan.',
        photo_url: null,
        created_at: twoDaysAgo,
      },
      {
        id: 'l102',
        ticket_id: t1Id,
        status_step: 'DIAGNOSING',
        public_description:
          'Pembongkaran logic board & pengukuran tegangan rail utama menggunakan mikroskop digital.',
        photo_url: createDiagnosticSvgDataUri(
          'Logic Board 820-02773-A Inspection',
          'Ditemukan korosi aktif pada IC CD3217B12 & filter PPBUS_AON',
          'sha256:9f84b2c1e09a47d1',
          '#00F0FF'
        ),
        created_at: oneDayAgo,
      },
      {
        id: 'l103',
        ticket_id: t1Id,
        status_step: 'WAITING_APPROVAL',
        public_description:
          'Hasil diagnosa selesai. Menunggu persetujuan estimasi biaya perbaikan sebesar Rp 1.450.000 dari pelanggan.',
        photo_url: null,
        created_at: twoHoursAgo,
      },
      {
        id: 'l201',
        ticket_id: t2Id,
        status_step: 'RECEIVED',
        public_description: 'Unit iPhone 15 Pro Max diterima di counter servis.',
        photo_url: null,
        created_at: twoDaysAgo,
      },
      {
        id: 'l202',
        ticket_id: t2Id,
        status_step: 'DIAGNOSING',
        public_description: 'Pemeriksaan jalur tegangan panel OLED & konektor FPC.',
        photo_url: createDiagnosticSvgDataUri(
          'OLED Flex Bonding & VSN Rail Test',
          'Kalibrasi sinyal panel Super Retina XDR & pemulihan jalur VGH',
          'sha256:4a21e77c8830b912',
          '#3B82F6'
        ),
        created_at: oneDayAgo,
      },
      {
        id: 'l203',
        ticket_id: t2Id,
        status_step: 'WAITING_APPROVAL',
        public_description: 'Biaya perbaikan Rp 950.000 telah disetujui pelanggan melalui portal tracking.',
        photo_url: null,
        created_at: oneDayAgo,
      },
      {
        id: 'l204',
        ticket_id: t2Id,
        status_step: 'IN_PROGRESS',
        public_description: 'Proses micro-repair jalur fleksibel OLED dan penyegelan ulang lapisan anti-air.',
        photo_url: null,
        created_at: sixHoursAgo,
      },
      {
        id: 'l301',
        ticket_id: t3Id,
        status_step: 'RECEIVED',
        public_description: 'Unit ASUS ROG Zephyrus G14 diterima.',
        photo_url: null,
        created_at: threeDaysAgo,
      },
      {
        id: 'l302',
        ticket_id: t3Id,
        status_step: 'IN_PROGRESS',
        public_description: 'Pembersihan blok vapor chamber & aplikasi ulang Liquid Metal Conductonaut.',
        photo_url: createDiagnosticSvgDataUri(
          'Vapor Chamber & Liquid Metal Repaste',
          'Suhu full-load Cinebench R23 turun dari 98°C menjadi 74°C stabil',
          'sha256:7d9930c4a112f80e',
          '#10B981'
        ),
        created_at: twoDaysAgo,
      },
      {
        id: 'l303',
        ticket_id: t3Id,
        status_step: 'PICKED_UP',
        public_description:
          'Unit telah diambil oleh pelanggan dan masa garansi resmi 30 hari telah aktif.',
        photo_url: null,
        created_at: oneDayAgo,
      },
      {
        id: 'l401',
        ticket_id: t4Id,
        status_step: 'RECEIVED',
        public_description: 'Unit Lenovo Legion 5 Pro diterima beserta adaptor 300W.',
        photo_url: null,
        created_at: oneDayAgo,
      },
      {
        id: 'l402',
        ticket_id: t4Id,
        status_step: 'READY_FOR_PICKUP',
        public_description: 'Penggantian konektor DC-In selesai & lulus stress test daya 300W selama 2 jam.',
        photo_url: null,
        created_at: twoHoursAgo,
      },
      {
        id: 'l501',
        ticket_id: t5Id,
        status_step: 'RECEIVED',
        public_description: 'Unit Samsung Galaxy S23 Ultra diterima untuk pengecekan modul kamera.',
        photo_url: null,
        created_at: sixHoursAgo,
      },
      {
        id: 'l502',
        ticket_id: t5Id,
        status_step: 'DIAGNOSING',
        public_description: 'Pengujian aktuator OIS kamera utama 200MP dan telefoto 3x.',
        photo_url: null,
        created_at: twoHoursAgo,
      },
    ],
    wa_logs: [
      {
        id: 'w101',
        ticket_id: t1Id,
        method: 'DIRECT_WA_FALLBACK',
        status: 'FALLBACK_TRIGGERED',
        response_log:
          'Wablas Gateway nonaktif. URL Direct WhatsApp (wa.me/6281234568821) berhasil di-generate untuk event WAITING_APPROVAL.',
        sent_at: twoHoursAgo,
      },
      {
        id: 'w401',
        ticket_id: t4Id,
        method: 'DIRECT_WA_FALLBACK',
        status: 'FALLBACK_TRIGGERED',
        response_log:
          'Wablas Gateway nonaktif. URL Direct WhatsApp (wa.me/6282155447712) berhasil di-generate untuk event READY_FOR_PICKUP.',
        sent_at: twoHoursAgo,
      },
    ],
    system_settings: {
      id: 1,
      store_name: 'Geektech-Com',
      store_slogan: 'Spesialis Perbaikan Laptop & Smartphone',
      store_address: 'Jl. Soekarno Hatta No. 102, Malang',
      store_phone: '0811-3600-8899',
      receipt_footer_notes:
        '1. Garansi hanya berlaku untuk kerusakan dan komponen yang sama sesuai nota ini.\n2. Garansi gugur apabila segel rusak, terkena cairan, atau terjatuh.\n3. Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.',
      wablas_domain: process.env.WABLAS_DOMAIN || 'https://solo.wablas.com',
      wablas_api_key: process.env.WABLAS_API_KEY || '',
      wablas_secret_key: process.env.WABLAS_SECRET_KEY || '',
      is_wablas_enabled: process.env.IS_WABLAS_ENABLED === 'true',
      updated_at: now.toISOString(),
    },
  };
}

class GeektechDatabase {
  private state: DatabaseState;

  constructor() {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): DatabaseState {
    let loadedState: DatabaseState | null = null;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        loadedState = JSON.parse(raw) as DatabaseState;
      }
    } catch {
      // fallback to seed
    }

    if (!loadedState) {
      loadedState = createInitialSeedData();
    }

    // Hapus akun dummy teknisi bawaan lama jika ada
    loadedState.admins = (loadedState.admins || []).filter(
      (a) =>
        a.id !== 'a2222222-2222-4222-8222-222222222222' &&
        !(a.username.toLowerCase() === 'teknisi' && a.full_name === 'Doni Pratama (Teknisi Senior)')
    );

    // Pastikan jika tabel user kosong atau akun admin utama belum ada, otomatis buat 1 user utama (admin / admin123 / OWNER)
    if (loadedState.admins.length === 0) {
      loadedState.admins.push({
        id: 'a1111111-1111-4111-8111-111111111111',
        username: 'admin',
        full_name: 'Administrator',
        password_hash: hashPassword('admin123'),
        role: 'OWNER',
        last_login_ip: null,
        created_at: new Date().toISOString(),
      });
    } else {
      const adminUser = loadedState.admins.find(
        (a) =>
          a.username.toLowerCase() === 'admin' ||
          a.id === 'a1111111-1111-4111-8111-111111111111'
      );
      if (adminUser) {
        // Migrasikan password seed bawaan lama ke 'admin123'
        if (
          adminUser.password_hash.startsWith('scrypt$827c8c359e7ee4fdc098987a90cbe22f$') ||
          adminUser.full_name === 'Budi Santoso (Owner)' ||
          verifyPassword('geektech123', adminUser.password_hash) ||
          verifyPassword('Geektech#2026', adminUser.password_hash)
        ) {
          adminUser.password_hash = hashPassword('admin123');
        }
        if (!adminUser.full_name || adminUser.full_name === 'Budi Santoso (Owner)') {
          adminUser.full_name = 'Administrator';
        }
      }
    }

    // Pastikan field Profil Usaha selalu terisi pada system_settings
    if (!loadedState.system_settings) {
      loadedState.system_settings = createInitialSeedData().system_settings;
    } else {
      if (!loadedState.system_settings.store_name) {
        loadedState.system_settings.store_name = 'Geektech-Com';
      }
      if (!loadedState.system_settings.store_slogan) {
        loadedState.system_settings.store_slogan = 'Spesialis Perbaikan Laptop & Smartphone';
      }
      if (loadedState.system_settings.store_address === undefined) {
        loadedState.system_settings.store_address = 'Jl. Soekarno Hatta No. 102, Malang';
      }
      if (loadedState.system_settings.store_phone === undefined) {
        loadedState.system_settings.store_phone = '0811-3600-8899';
      }
      if (loadedState.system_settings.receipt_footer_notes === undefined) {
        loadedState.system_settings.receipt_footer_notes =
          '1. Garansi hanya berlaku untuk kerusakan dan komponen yang sama sesuai nota ini.\n2. Garansi gugur apabila segel rusak, terkena cairan, atau terjatuh.\n3. Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.';
      }
    }

    // Sinkronisasi data garansi pada tiket yang sudah tersimpan di disk
    for (const t of loadedState.tickets) {
      if (typeof t.warranty_days !== 'number' || Number.isNaN(t.warranty_days)) {
        t.warranty_days = 30;
      }
      if (t.status === 'PICKED_UP') {
        const pickedLog = [...loadedState.ticket_logs]
          .filter((l) => l.ticket_id === t.id && l.status_step === 'PICKED_UP')
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        if (!t.picked_up_at) {
          t.picked_up_at = pickedLog?.created_at || t.updated_at;
        }
        if (!t.pickup_by) {
          const cust = loadedState.customers.find((c) => c.id === t.customer_id);
          t.pickup_by = cust?.full_name || 'Pelanggan';
        }
        if (!t.pickup_notes) {
          t.pickup_notes = 'Diambil sendiri (membawa nota asli)';
        }
        if (t.warranty_days > 0) {
          const pickedMs = new Date(t.picked_up_at).getTime();
          t.warranty_expires_at = new Date(
            pickedMs + t.warranty_days * 24 * 3600 * 1000
          ).toISOString();
        } else {
          t.warranty_expires_at = null;
        }
      } else {
        t.picked_up_at = null;
        t.pickup_by = null;
        t.pickup_notes = null;
        t.warranty_expires_at = null;
      }
    }

    // Bersihkan teks "(RAHASIA INTERNAL)" pada alamat pelanggan yang sudah tersimpan di disk
    for (const c of loadedState.customers) {
      if (c.address) {
        c.address = c.address.replace(/\s*\(RAHASIA INTERNAL\)/gi, '').trim();
      }
    }

    this.saveToDisk(loadedState);
    return loadedState;
  }

  private saveToDisk(data: DatabaseState = this.state) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // ignore write errors in read-only environments
    }
  }

  getState(): DatabaseState {
    return this.state;
  }

  save(): void {
    this.saveToDisk(this.state);
  }

  replaceState(newState: DatabaseState): void {
    this.state = newState;
    this.saveToDisk(this.state);
  }

  /**
   * Generate nomor invoice unik dengan format `GTC-YYYYMMDD-XXXX`
   */
  generateUniqueInvoiceNumber(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let attempt = 0; attempt < 20; attempt++) {
      let suffix = '';
      for (let i = 0; i < 4; i++) {
        suffix += chars[crypto.randomInt(0, chars.length)];
      }
      const candidate = `GTC-${yyyy}${mm}${dd}-${suffix}`;
      if (!this.state.tickets.some((t) => t.invoice_number === candidate)) {
        return candidate;
      }
    }
    return `GTC-${yyyy}${mm}${dd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  }
}

export const dbStore = new GeektechDatabase();
