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
  hardware_specs?: string; // Spesifikasi RAM/SSD/HDD & kondisi fisik detail
}

export interface TicketLogItem {
  id: string;
  status_step: TicketStatus;
  public_description: string;
  photo_url: string | null;
  created_at: string;
}

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
  logs: TicketLogItem[];
}

export interface WaNotificationLogItem {
  id: string;
  ticket_id: string;
  method: 'WABLAS_API' | 'DIRECT_WA_FALLBACK';
  status: 'SENT' | 'FAILED' | 'FALLBACK_TRIGGERED';
  response_log: string;
  sent_at: string;
}

export interface AdminTicketView {
  id: string;
  invoice_number: string;
  customer_id: string;
  device_category: DeviceCategory;
  device_brand_model: string;
  service_type?: ServiceType;
  serial_number_imei: string | null;
  passcode_encrypted: string | null;
  passcode_decrypted: string | null;
  physical_checklist: PhysicalChecklist;
  hardware_specs?: string | null;
  initial_complaint: string;
  public_diagnosis: string | null;
  secret_technician_notes: string | null;
  status: TicketStatus;
  customer_approved: boolean;
  estimated_cost: number;
  final_price: number;
  down_payment?: number;
  parts_cost_modal: number;
  net_profit: number;
  warranty_days: number;
  picked_up_at?: string | null;
  pickup_by?: string | null;
  pickup_notes?: string | null;
  warranty_expires_at: string | null;
  created_at: string;
  updated_at: string;
  customer: {
    id: string;
    full_name: string;
    whatsapp_number: string;
    whatsapp_last4: string;
    address: string | null;
  };
  logs: TicketLogItem[];
  wa_notifications: WaNotificationLogItem[];
}

export interface FinancialSummary {
  total_gross_revenue: number;
  total_parts_modal: number;
  total_net_profit: number;
  realized_revenue: number;
  realized_modal: number;
  realized_net_profit: number;
  total_tickets: number;
  waiting_approval_count: number;
  ready_pickup_count: number;
}

export interface StoreProfileInfo {
  store_name: string;
  store_slogan: string;
  store_address: string;
  store_phone: string;
  receipt_footer_notes: string;
}

export interface SystemSettingRecord extends StoreProfileInfo {
  id: number;
  wablas_domain: string;
  wablas_api_key: string;
  wablas_secret_key: string;
  is_wablas_enabled: boolean;
  updated_at: string;
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

export interface RedisTelemetry {
  cacheHits: number;
  cacheMisses: number;
  blockedRequests: number;
  cachedKeys: { key: string; ttlSeconds: number }[];
  rateLimitKeys: { key: string; value: string; ttlSeconds: number }[];
}

export interface WaDispatchInfo {
  wa_sent: boolean;
  mode: 'WABLAS' | 'DIRECT_FALLBACK';
  fallback_url?: string;
  message_preview: string;
}

export interface AdminUser {
  id: string;
  username: string;
  full_name?: string;
  role: 'OWNER' | 'TECHNICIAN' | 'CASHIER';
  session_id: string;
}

export interface TeamMemberRecord {
  id: string;
  username: string;
  full_name: string;
  role: 'OWNER' | 'TECHNICIAN' | 'CASHIER';
  last_login_ip: string | null;
  created_at: string;
}

export interface BlueprintStage {
  stage: string;
  files: {
    name: string;
    language: string;
    content: string;
  }[];
}

export const WORKFLOW_STEPS: {
  status: TicketStatus;
  label: string;
  shortDesc: string;
}[] = [
  {
    status: 'RECEIVED',
    label: 'Unit Diterima',
    shortDesc: 'Pemeriksaan fisik & registrasi nota',
  },
  {
    status: 'DIAGNOSING',
    label: 'Diagnosa',
    shortDesc: 'Pengecekan jalur mesin & komponen',
  },
  {
    status: 'WAITING_APPROVAL',
    label: 'Konfirmasi Biaya',
    shortDesc: 'Menunggu persetujuan estimasi servis',
  },
  {
    status: 'IN_PROGRESS',
    label: 'Proses Pengerjaan',
    shortDesc: 'Perbaikan & penggantian sparepart',
  },
  {
    status: 'QC_TESTING',
    label: 'Quality Control',
    shortDesc: 'Uji fungsi & stabilitas suhu/daya',
  },
  {
    status: 'READY_FOR_PICKUP',
    label: 'Siap Diambil',
    shortDesc: 'Lulus QC & siap diserahkan',
  },
];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  RECEIVED: 'Unit Diterima',
  DIAGNOSING: 'Diagnosa Teknisi',
  WAITING_APPROVAL: 'Konfirmasi Biaya',
  IN_PROGRESS: 'Proses Pengerjaan',
  QC_TESTING: 'Quality Control',
  READY_FOR_PICKUP: 'Siap Diambil',
  PICKED_UP: 'Sudah Diambil',
  CANCELLED: 'Dibatalkan',
};

export function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

export function formatDateTimeID(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

export function formatDateOnlyID(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}
