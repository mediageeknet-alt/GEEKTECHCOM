import crypto from 'crypto';
import type {
  ServiceTicketRecord,
  CustomerRecord,
  SystemSettingRecord,
  WaNotificationLogRecord,
} from './dtoAndStore.ts';

// ============================================================================
// TAHAP 2C: WHATSAPP NOTIFIER SERVICE (WABLAS API + AUTO-FALLBACK DIRECT WA)
// ============================================================================

export type WaTriggerEvent = 'RECEIVED' | 'WAITING_APPROVAL' | 'READY_FOR_PICKUP';

export interface WaDispatchResult {
  wa_sent: boolean;
  mode: 'WABLAS' | 'DIRECT_FALLBACK';
  fallback_url?: string;
  message_preview: string;
  log_entry: WaNotificationLogRecord;
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function hasValidCustomerWhatsApp(phone?: string | null): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (!trimmed || trimmed === '-') return false;
  return trimmed.replace(/[^0-9]/g, '').length >= 4;
}

export class WhatsAppNotifierService {
  /**
   * Menyusun template pesan WhatsApp yang rapi, sopan, mencantumkan:
   * Nama Pelanggan, Nomor Invoice, Tipe Unit, Keluhan/Status, Rincian Biaya,
   * serta Link Tracking Langsung beserta instruksi dinamis (4 digit WA atau PIN Lacak).
   */
  static buildMessageTemplate(
    event: WaTriggerEvent,
    ticket: ServiceTicketRecord,
    customer: CustomerRecord,
    appBaseUrl: string
  ): string {
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, '');
    const trackingUrl = `${cleanBaseUrl}/?inv=${encodeURIComponent(ticket.invoice_number)}&wa=${encodeURIComponent(customer.whatsapp_last4)}`;
    const hasWa = hasValidCustomerWhatsApp(customer.whatsapp_number);
    const pinInstructionLine = hasWa
      ? `(Masukkan Nomor Invoice *${ticket.invoice_number}* dan 4 digit terakhir WA Anda: *${customer.whatsapp_last4}*)`
      : `(Masukkan Nomor Invoice *${ticket.invoice_number}* dan PIN Lacak Anda: *${customer.whatsapp_last4}*)`;

    if (event === 'RECEIVED') {
      return [
        `Halo Bapak/Ibu *${customer.full_name}*,`,
        `Terima kasih telah mempercayakan perangkat Anda di *GEEKTECH-COM Service Center*.`,
        ``,
        `*RINCIAN TANDA TERIMA SERVIS*`,
        `• No. Invoice: *${ticket.invoice_number}*`,
        `• Perangkat: ${ticket.device_brand_model} (${ticket.device_category})`,
        `• S/N atau IMEI: ${ticket.serial_number_imei || '-'}`,
        `• Keluhan Awal: ${ticket.initial_complaint}`,
        `• Estimasi Awal: ${ticket.estimated_cost > 0 ? formatRupiah(ticket.estimated_cost) : 'Menunggu Hasil Diagnosa'}`,
        ``,
        `*LACAK PROGRES REAL-TIME:*`,
        `${trackingUrl}`,
        `_${pinInstructionLine}_`,
        ``,
        `Salam hangat,`,
        `*Tim Teknisi Geektech-Com*`,
      ].join('\n');
    }

    if (event === 'WAITING_APPROVAL') {
      return [
        `Halo Bapak/Ibu *${customer.full_name}*,`,
        `Pemeriksaan/diagnosa unit Anda di *GEEKTECH-COM* telah selesai dan membutuhkan *Persetujuan Biaya* sebelum kami lanjutkan pengerjaan.`,
        ``,
        `*HASIL DIAGNOSA & ESTIMASI BIAYA*`,
        `• No. Invoice: *${ticket.invoice_number}*`,
        `• Perangkat: ${ticket.device_brand_model}`,
        `• Hasil Diagnosa: ${ticket.public_diagnosis || 'Ditemukan komponen yang memerlukan perbaikan/penggantian.'}`,
        `• Estimasi Biaya Servis: *${formatRupiah(ticket.estimated_cost)}*`,
        `• Masa Garansi: ${ticket.warranty_days} Hari`,
        ``,
        `*KONFIRMASI 1-KLIK (SETUJU / BATAL):*`,
        `Silakan klik tautan resmi berikut untuk menyetujui atau membatalkan pengerjaan secara langsung:`,
        `${trackingUrl}`,
        `_${pinInstructionLine}_`,
        ``,
        `Terima kasih,`,
        `*Admin Geektech-Com*`,
      ].join('\n');
    }

    // READY_FOR_PICKUP
    return [
      `Halo Bapak/Ibu *${customer.full_name}*,`,
      `Kabar gembira! Perangkat Anda telah *SELESAI DIPERBAIKI* dan lulus tahapan *Quality Control (QC)* di *GEEKTECH-COM*.`,
      ``,
      `*RINCIAN PENGAMBILAN UNIT*`,
      `• No. Invoice: *${ticket.invoice_number}*`,
      `• Perangkat: ${ticket.device_brand_model}`,
      `• Ringkasan Perbaikan: ${ticket.public_diagnosis || 'Perbaikan selesai & lulus uji fungsi menyeluruh.'}`,
      `• Total Biaya Akhir: *${formatRupiah(ticket.final_price > 0 ? ticket.final_price : ticket.estimated_cost)}*`,
      `• Garansi Toko: *${ticket.warranty_days} Hari* (Aktif otomatis saat unit diambil)`,
      ``,
      `*DETAIL & BUKTI PEMERIKSAAN:*`,
      `${trackingUrl}`,
      `_${pinInstructionLine}_`,
      ``,
      `Silakan membawa nota fisik atau menunjukkan halaman tracking digital saat pengambilan unit.`,
      `*Geektech-Com Service Center*`,
    ].join('\n');
  }

  /**
   * Mengirim notifikasi WhatsApp otomatis melalui Wablas API (timeout 5 detik).
   * Jika Wablas nonaktif atau gagal/error/timeout, otomatis memicu Direct WA Fallback (`wa.me`).
   */
  static async sendNotification(
    event: WaTriggerEvent,
    ticket: ServiceTicketRecord,
    customer: CustomerRecord,
    settings: SystemSettingRecord,
    appBaseUrl: string
  ): Promise<WaDispatchResult> {
    const message = this.buildMessageTemplate(event, ticket, customer, appBaseUrl);
    const cleanPhone = customer.whatsapp_number.replace(/[^0-9]/g, '');
    const normalizedPhone = cleanPhone.startsWith('0')
      ? `62${cleanPhone.slice(1)}`
      : cleanPhone;

    const fallbackUrl = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

    // 1. Cek apakah Wablas diaktifkan dan API Key terisi
    if (settings.is_wablas_enabled && settings.wablas_api_key.trim().length > 0) {
      try {
        const endpoint = `${settings.wablas_domain.replace(/\/$/, '')}/api/send-message`;
        const authHeader = settings.wablas_secret_key.trim()
          ? `${settings.wablas_api_key.trim()}.${settings.wablas_secret_key.trim()}`
          : settings.wablas_api_key.trim();

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone: normalizedPhone,
            message,
            isGroup: 'false',
          }),
          signal: AbortSignal.timeout(5000), // Timeout ketat maksimal 5 detik
        });

        const responseText = await response.text();
        if (response.ok) {
          const logEntry: WaNotificationLogRecord = {
            id: crypto.randomUUID(),
            ticket_id: ticket.id,
            method: 'WABLAS_API',
            status: 'SENT',
            response_log: `HTTP ${response.status}: ${responseText.slice(0, 300)}`,
            sent_at: new Date().toISOString(),
          };
          return {
            wa_sent: true,
            mode: 'WABLAS',
            message_preview: message,
            log_entry: logEntry,
          };
        }

        // Jika status bukan 200 OK -> Jalur Fallback
        const failLogEntry: WaNotificationLogRecord = {
          id: crypto.randomUUID(),
          ticket_id: ticket.id,
          method: 'WABLAS_API',
          status: 'FALLBACK_TRIGGERED',
          response_log: `Wablas HTTP ${response.status} Error (${responseText.slice(0, 180)}). Auto-Fallback ke Direct WA diaktifkan.`,
          sent_at: new Date().toISOString(),
        };
        return {
          wa_sent: false,
          mode: 'DIRECT_FALLBACK',
          fallback_url: fallbackUrl,
          message_preview: message,
          log_entry: failLogEntry,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Timeout / Network Error';
        const errorLogEntry: WaNotificationLogRecord = {
          id: crypto.randomUUID(),
          ticket_id: ticket.id,
          method: 'WABLAS_API',
          status: 'FALLBACK_TRIGGERED',
          response_log: `Wablas Exception (${errorMsg}). Auto-Fallback ke Direct WA diaktifkan.`,
          sent_at: new Date().toISOString(),
        };
        return {
          wa_sent: false,
          mode: 'DIRECT_FALLBACK',
          fallback_url: fallbackUrl,
          message_preview: message,
          log_entry: errorLogEntry,
        };
      }
    }

    // 2. Jika Wablas tidak aktif -> Langsung Jalur Direct WA Fallback
    const directLogEntry: WaNotificationLogRecord = {
      id: crypto.randomUUID(),
      ticket_id: ticket.id,
      method: 'DIRECT_WA_FALLBACK',
      status: 'FALLBACK_TRIGGERED',
      response_log: `Wablas Gateway nonaktif. URL Direct WhatsApp (wa.me/${normalizedPhone}) berhasil di-generate untuk event ${event}.`,
      sent_at: new Date().toISOString(),
    };

    return {
      wa_sent: false,
      mode: 'DIRECT_FALLBACK',
      fallback_url: fallbackUrl,
      message_preview: message,
      log_entry: directLogEntry,
    };
  }
}
