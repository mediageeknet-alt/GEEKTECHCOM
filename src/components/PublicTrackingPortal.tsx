import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Search,
  QrCode,
  X,
  Laptop,
  Smartphone,
  Cpu,
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  Camera,
  Shield,
  Zap,
  Sparkles,
} from 'lucide-react';
import {
  type PublicTicketTrackDTO,
  type TicketStatus,
  WORKFLOW_STEPS,
  STATUS_LABELS,
  formatIDR,
  formatDateTimeID,
  formatDateOnlyID,
} from '../types.ts';
import { ThermalReceiptModal } from './ThermalReceiptModal.tsx';

interface PublicTrackingPortalProps {
  initialInvoice?: string;
  initialWaLast4?: string;
}

function parseQrTrackingPayload(rawText: string): { inv: string; pin: string } | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Coba parse sebagai URL (misal: https://.../?inv=GTC-20261103-8F2A&wa=8821 atau ?inv=...&pin=...)
  try {
    const url =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? new URL(trimmed)
        : trimmed.includes('?') || trimmed.includes('inv=')
          ? new URL(
              trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\?/, '?')}`,
              window.location.origin
            )
          : null;

    if (url) {
      const invParam = (
        url.searchParams.get('inv') ||
        url.searchParams.get('invoice') ||
        url.searchParams.get('nota') ||
        ''
      )
        .trim()
        .toUpperCase();
      const pinParam = (
        url.searchParams.get('wa') ||
        url.searchParams.get('pin') ||
        url.searchParams.get('wa_last4') ||
        ''
      )
        .replace(/[^0-9]/g, '')
        .slice(0, 4);

      if (invParam) {
        return { inv: invParam, pin: pinParam };
      }
    }
  } catch {
    // Lanjut ke fallback parser string biasa
  }

  // 2. Coba parse format pemisah seperti "GTC-20261103-8F2A|8821" atau "GTC-20261103-8F2A:8821"
  const delimiterMatch = trimmed.match(/^(GTC-[A-Z0-9-]+)[|:;,\s]+(\d{4})$/i);
  if (delimiterMatch) {
    return {
      inv: delimiterMatch[1].toUpperCase(),
      pin: delimiterMatch[2],
    };
  }

  // 3. Coba ekstrak pola nomor invoice GTC-... dan parameter/angka 4 digit di sekitarnya
  const invMatch = trimmed.match(/(GTC-\d{8}-[A-Z0-9]{3,6}|GTC-[A-Z0-9-]{4,})/i);
  if (invMatch) {
    const extractedInv = invMatch[1].toUpperCase();
    const restText = trimmed.replace(invMatch[0], '');
    const pinKeyMatch = restText.match(/(?:wa|pin|wa_last4)[=:\s]+(\d{4})/i);
    const standalonePinMatch = restText.match(/(?:^|[^0-9])(\d{4})(?:$|[^0-9])/);
    const extractedPin = pinKeyMatch
      ? pinKeyMatch[1]
      : standalonePinMatch
        ? standalonePinMatch[1]
        : '';

    return {
      inv: extractedInv,
      pin: extractedPin,
    };
  }

  return null;
}

export const PublicTrackingPortal: React.FC<PublicTrackingPortalProps> = ({
  initialInvoice,
  initialWaLast4,
}) => {
  const [invoiceInput, setInvoiceInput] = useState(initialInvoice || '');
  const [waLast4Input, setWaLast4Input] = useState(initialWaLast4 || '');
  const [loading, setLoading] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [ticketData, setTicketData] = useState<PublicTicketTrackDTO | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  // State & Ref untuk Modal QR Scanner
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrScannerError, setQrScannerError] = useState<string | null>(null);
  const [qrStarting, setQrStarting] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scanHandledRef = useRef(false);

  const executeTrackLookup = useCallback(async (inv: string, wa: string) => {
    if (!inv.trim() || !wa.trim()) return;
    setLoading(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const response = await fetch('/api/v1/public/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice_number: inv.trim().toUpperCase(),
          wa_last4: wa.trim(),
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(payload.message || 'Data nota servis tidak ditemukan.');
        setTicketData(null);
        return;
      }

      setTicketData(payload.ticket);
    } catch {
      setErrorMessage('Tidak dapat terhubung ke server. Silakan coba kembali.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialInvoice && initialWaLast4) {
      executeTrackLookup(initialInvoice, initialWaLast4);
    }
  }, [initialInvoice, initialWaLast4, executeTrackLookup]);

  const stopQrScanner = useCallback(async () => {
    const instance = html5QrCodeRef.current;
    html5QrCodeRef.current = null;
    if (!instance) return;
    try {
      if (instance.isScanning) {
        await instance.stop();
      }
    } catch {
      // Abaikan error saat menghentikan stream
    }
    try {
      instance.clear();
    } catch {
      // Abaikan error clear DOM
    }
  }, []);

  const closeQrScannerModal = useCallback(async () => {
    await stopQrScanner();
    setShowQrScanner(false);
    setQrScannerError(null);
    setQrStarting(false);
  }, [stopQrScanner]);

  const handleQrDecoded = useCallback(
    async (decodedText: string) => {
      if (scanHandledRef.current) return;
      const parsed = parseQrTrackingPayload(decodedText);
      if (!parsed || !parsed.inv) {
        setQrScannerError('QR Code tidak berisi format Nomor Nota Geektech-Com yang valid.');
        return;
      }

      scanHandledRef.current = true;
      await stopQrScanner();
      setShowQrScanner(false);
      setQrScannerError(null);
      setQrStarting(false);

      const nextInv = parsed.inv.toUpperCase();
      const nextPin = parsed.pin || waLast4Input;

      setInvoiceInput(nextInv);
      if (parsed.pin) {
        setWaLast4Input(parsed.pin);
      }

      if (nextInv && nextPin && nextPin.length === 4) {
        await executeTrackLookup(nextInv, nextPin);
      } else {
        setErrorMessage(
          'Nomor Invoice berhasil dipindai dari QR Code. Silakan lengkapi 4 digit WA / PIN Anda.'
        );
      }
    },
    [executeTrackLookup, stopQrScanner, waLast4Input]
  );

  useEffect(() => {
    if (!showQrScanner) return;

    let isCancelled = false;
    scanHandledRef.current = false;
    setQrScannerError(null);
    setQrStarting(true);

    const readerElementId = 'geektech-qr-reader';
    const startCamera = async () => {
      // Beri waktu singkat agar elemen DOM modal ter-mount penuh
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (isCancelled) return;

      const scanner = new Html5Qrcode(readerElementId);
      html5QrCodeRef.current = scanner;

      const qrConfig = {
        fps: 10,
        qrbox: { width: 230, height: 230 },
        aspectRatio: 1.0,
      };

      try {
        await scanner.start(
          { facingMode: 'environment' },
          qrConfig,
          (decodedText) => {
            void handleQrDecoded(decodedText);
          },
          () => {
            // Frame kosong / belum terdeteksi QR
          }
        );
        if (!isCancelled) {
          setQrStarting(false);
        }
      } catch {
        // Fallback ke kamera depan / default webcam jika facingMode environment gagal
        try {
          await scanner.start(
            { facingMode: 'user' },
            qrConfig,
            (decodedText) => {
              void handleQrDecoded(decodedText);
            },
            () => {}
          );
          if (!isCancelled) {
            setQrStarting(false);
          }
        } catch {
          if (!isCancelled) {
            setQrStarting(false);
            setQrScannerError(
              'Tidak dapat mengakses kamera perangkat. Pastikan izin kamera diaktifkan pada browser Anda.'
            );
          }
        }
      }
    };

    void startCamera();

    return () => {
      isCancelled = true;
      void stopQrScanner();
    };
  }, [showQrScanner, handleQrDecoded, stopQrScanner]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeTrackLookup(invoiceInput, waLast4Input);
  };

  const handleCostDecision = async (decision: 'APPROVE' | 'CANCEL') => {
    if (!ticketData) return;
    setApprovalLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/v1/public/approve-cost', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoice_number: ticketData.invoice_number,
          wa_last4: waLast4Input.trim(),
          decision,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(payload.message || 'Gagal memproses konfirmasi.');
        return;
      }

      setTicketData(payload.ticket);
      setFeedbackMessage(payload.message);
    } catch {
      setErrorMessage('Terjadi kendala saat mengirim persetujuan.');
    } finally {
      setApprovalLoading(false);
    }
  };

  const getStepIndex = (status: TicketStatus): number => {
    if (status === 'PICKED_UP') return WORKFLOW_STEPS.length;
    if (status === 'CANCELLED') return -1;
    return WORKFLOW_STEPS.findIndex((s) => s.status === status);
  };

  const currentStepIdx = ticketData ? getStepIndex(ticketData.status) : 0;

  // Kalkulasi Hitung Mundur Garansi: (Tanggal Diambil + Jumlah Hari Garansi) - Hari Ini = Sisa Hari Garansi
  // Garansi HANYA aktif jika status === 'PICKED_UP'
  const warrantyInfo = React.useMemo(() => {
    if (!ticketData) return null;
    const warrantyDays = Math.max(0, Number(ticketData.warranty_days ?? 0));

    if (ticketData.status !== 'PICKED_UP') {
      return {
        isPickedUp: false,
        warrantyDays,
        remainingDays: null as number | null,
        pickedUpAtIso: null as string | null,
        expiresAtIso: null as string | null,
      };
    }

    const pickedUpLog = [...(ticketData.logs || [])]
      .reverse()
      .find((l) => l.status_step === 'PICKED_UP');
    const pickedUpAtIso =
      ticketData.picked_up_at || pickedUpLog?.created_at || ticketData.updated_at;

    if (warrantyDays <= 0) {
      return {
        isPickedUp: true,
        warrantyDays: 0,
        remainingDays: 0,
        pickedUpAtIso,
        expiresAtIso: null as string | null,
      };
    }

    const pickedUpMs = new Date(pickedUpAtIso).getTime();
    const expiresMs = pickedUpMs + warrantyDays * 24 * 60 * 60 * 1000;
    const expiresAtIso = new Date(expiresMs).toISOString();
    const diffMs = expiresMs - Date.now();
    const remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    return {
      isPickedUp: true,
      warrantyDays,
      remainingDays,
      pickedUpAtIso,
      expiresAtIso,
    };
  }, [ticketData]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-12 space-y-6">
      {/* Kartu Form Pencarian Utama */}
      <section className="rounded-2xl bg-white dark:bg-[#111827]/80 dark:backdrop-blur-md border border-slate-200 dark:border-[#1F2937] p-6 sm:p-8 shadow-xs">
        <div className="text-center max-w-xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Cek Status Servis Perangkat Anda
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Masukkan Nomor Nota dan 4 digit terakhir WhatsApp atau PIN Nota.
          </p>
        </div>

        {/* Form Pencarian */}
        <form
          onSubmit={handleSearchSubmit}
          className="mt-6 max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-end"
        >
          <div className="sm:col-span-5">
            <label
              htmlFor="invoice-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Nomor Invoice / Nota
            </label>
            <input
              id="invoice-input"
              type="text"
              value={invoiceInput}
              onChange={(e) => setInvoiceInput(e.target.value.toUpperCase())}
              placeholder="GTC-YYYYMMDD-XXXX"
              required
              className="w-full px-4 py-2.5 text-sm font-mono uppercase rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#0284C7] dark:focus:border-[#00F0FF] transition-colors"
            />
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="wa-last4-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              4 Digit WA / PIN
            </label>
            <input
              id="wa-last4-input"
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={waLast4Input}
              onChange={(e) => setWaLast4Input(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="0000"
              required
              className="w-full px-4 py-2.5 text-sm font-mono tabular-nums rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#0284C7] dark:focus:border-[#00F0FF] transition-colors"
            />
          </div>

          <div className="sm:col-span-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 disabled:opacity-50 transition-opacity whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Search className="w-4 h-4" />
              <span>{loading ? 'Memeriksa...' : 'Lacak Unit'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowQrScanner(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl border border-[#0284C7] dark:border-[#00F0FF] text-[#0284C7] dark:text-[#00F0FF] bg-transparent hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <QrCode className="w-4 h-4" />
              <span>Scan QR</span>
            </button>
          </div>
        </form>

        {/* Pesan Kesalahan */}
        {errorMessage && (
          <div className="mt-5 max-w-3xl mx-auto p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs sm:text-sm text-red-700 dark:text-red-300 text-center">
            {errorMessage}
          </div>
        )}

        {/* Pesan Feedback Persetujuan */}
        {feedbackMessage && (
          <div className="mt-5 max-w-3xl mx-auto p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 text-xs sm:text-sm text-sky-900 dark:text-sky-200 flex items-center justify-between gap-4">
            <span>{feedbackMessage}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-xs underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}
      </section>

      {/* KONDISI AWAL (Belum Lacak): 3 Info Singkat */}
      {!ticketData && !loading && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl p-5 bg-white dark:bg-[#111827]/50 border border-slate-200 dark:border-[#1F2937] text-center space-y-1.5">
            <div className="w-9 h-9 mx-auto rounded-xl bg-sky-100 dark:bg-sky-950/60 text-[#0284C7] dark:text-[#00F0FF] flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Status Langsung
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tahap pemeriksaan dan pengerjaan diperbarui langsung oleh teknisi.
            </p>
          </div>

          <div className="rounded-xl p-5 bg-white dark:bg-[#111827]/50 border border-slate-200 dark:border-[#1F2937] text-center space-y-1.5">
            <div className="w-9 h-9 mx-auto rounded-xl bg-sky-100 dark:bg-sky-950/60 text-[#0284C7] dark:text-[#00F0FF] flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Konfirmasi Biaya
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pengerjaan dilanjutkan setelah estimasi biaya disetujui.
            </p>
          </div>

          <div className="rounded-xl p-5 bg-white dark:bg-[#111827]/50 border border-slate-200 dark:border-[#1F2937] text-center space-y-1.5">
            <div className="w-9 h-9 mx-auto rounded-xl bg-sky-100 dark:bg-sky-950/60 text-[#0284C7] dark:text-[#00F0FF] flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Garansi Servis
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Masa garansi aktif otomatis sejak perangkat diambil.
            </p>
          </div>
        </section>
      )}

      {/* HASIL PELACAKAN UNIT (Tampil setelah pencarian berhasil dengan transisi halus) */}
      {ticketData && warrantyInfo && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-6"
        >
          {/* 1. KARTU GARANSI AKTIF (HANYA MUNCUL JIKA STATUS SUDAH DIAMBIL / PICKED_UP) */}
          {ticketData.status === 'PICKED_UP' && (
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border ${
                warrantyInfo.warrantyDays > 0 && (warrantyInfo.remainingDays ?? 0) > 0
                  ? 'bg-emerald-50/90 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800/70'
                  : 'bg-slate-100/90 dark:bg-slate-900/60 border-slate-300 dark:border-slate-800'
              }`}
            >
              <div className="space-y-1">
                <div
                  className={`text-xs font-semibold flex items-center gap-2 ${
                    warrantyInfo.warrantyDays > 0 && (warrantyInfo.remainingDays ?? 0) > 0
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>Status Garansi Perangkat</span>
                </div>
                {warrantyInfo.warrantyDays > 0 ? (
                  (warrantyInfo.remainingDays ?? 0) > 0 ? (
                    <>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                        Garansi Aktif: Tersisa {warrantyInfo.remainingDays} Hari hingga{' '}
                        {formatDateOnlyID(warrantyInfo.expiresAtIso)}
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Masa Garansi: <strong>{warrantyInfo.warrantyDays} Hari</strong> (Diambil pada{' '}
                        {formatDateOnlyID(warrantyInfo.pickedUpAtIso)}).
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                        Masa Garansi Telah Berakhir (Sisa 0 Hari)
                      </h2>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Masa garansi {warrantyInfo.warrantyDays} hari sejak pengambilan (
                        {formatDateOnlyID(warrantyInfo.pickedUpAtIso)}) telah berakhir pada{' '}
                        {formatDateOnlyID(warrantyInfo.expiresAtIso)}.
                      </p>
                    </>
                  )
                ) : (
                  <>
                    <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
                      Masa Garansi: 0 Hari (Tanpa Garansi)
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Unit telah diambil pada {formatDateOnlyID(warrantyInfo.pickedUpAtIso)}. Nota ini tidak memiliki masa garansi tambahan.
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowPrintModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-700 text-white hover:bg-emerald-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Bukti Nota</span>
              </button>
            </motion.section>
          )}

          {/* 2. BANNER KONFIRMASI BIAYA (Khusus status WAITING_APPROVAL) */}
          {ticketData.status === 'WAITING_APPROVAL' && (
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/70 p-6 space-y-4"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Menunggu Konfirmasi Biaya
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                    Estimasi Biaya Perbaikan:{' '}
                    <span className="font-mono tabular-nums text-[#0284C7] dark:text-[#00F0FF]">
                      {formatIDR(ticketData.estimated_cost)}
                    </span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 max-w-2xl">
                    <strong>Hasil Diagnosa Teknisi:</strong>{' '}
                    {ticketData.public_diagnosis ||
                      'Pemeriksaan selesai. Silakan konfirmasi persetujuan biaya untuk melanjutkan pengerjaan.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    disabled={approvalLoading}
                    onClick={() => handleCostDecision('APPROVE')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Setuju Lanjut Servis</span>
                  </button>
                  <button
                    type="button"
                    disabled={approvalLoading}
                    onClick={() => handleCostDecision('CANCEL')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-white dark:bg-slate-900 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Batalkan Servis</span>
                  </button>
                </div>
              </div>
            </motion.section>
          )}

          {/* 3. STEPPER HORIZONTAL 6 TAHAP */}
          <section className="rounded-2xl bg-white dark:bg-[#111827]/80 dark:backdrop-blur-md border border-slate-200 dark:border-[#1F2937] p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Nota {ticketData.invoice_number}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Diperbarui {formatDateTimeID(ticketData.updated_at)}</span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1">
                  Tahap: {STATUS_LABELS[ticketData.status]}
                </h2>
                {ticketData.status !== 'PICKED_UP' && ticketData.status !== 'CANCELLED' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF] shrink-0" />
                    <span>
                      Masa Garansi: <strong>{warrantyInfo.warrantyDays} Hari</strong>{' '}
                      {warrantyInfo.warrantyDays > 0
                        ? '(Aktif setelah barang diambil)'
                        : '(Tanpa Garansi)'}
                    </span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowPrintModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Nota</span>
              </button>
            </div>

            {ticketData.status === 'CANCELLED' ? (
              <div className="mt-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-sm text-red-700 dark:text-red-300">
                Pengerjaan servis untuk nota <strong>{ticketData.invoice_number}</strong> telah dibatalkan.
                Silakan mengambil unit Anda di counter Geektech-Com.
              </div>
            ) : (
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5">
                {WORKFLOW_STEPS.map((step, index) => {
                  const isCompleted = index < currentStepIdx;
                  const isCurrent = index === currentStepIdx;

                  return (
                    <div
                      key={step.status}
                      className={`relative rounded-xl p-4 border transition-all ${
                        isCurrent
                          ? 'bg-[#0284C7]/10 dark:bg-[#00F0FF]/10 border-[#0284C7] dark:border-[#00F0FF] shadow-[0_0_16px_rgba(0,240,255,0.18)]'
                          : isCompleted
                            ? 'bg-slate-50 dark:bg-slate-900/60 border-emerald-500/40'
                            : 'bg-slate-50/40 dark:bg-slate-900/20 border-slate-200 dark:border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono tabular-nums font-semibold text-slate-400">
                          0{index + 1}
                        </span>
                        {isCompleted && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        )}
                        {isCurrent && (
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0284C7] dark:bg-[#00F0FF] opacity-75" />
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#0284C7] dark:bg-[#00F0FF]" />
                          </span>
                        )}
                        {!isCompleted && !isCurrent && (
                          <Clock className="w-4 h-4 text-slate-400 dark:text-slate-600" />
                        )}
                      </div>
                      <div
                        className={`text-sm font-semibold ${
                          isCurrent
                            ? 'text-[#0284C7] dark:text-[#00F0FF]'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {step.label}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                        {step.shortDesc}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 4. GRID 2 KOLOM SEIMBANG: KIRI SPESIFIKASI & KANAN TIMELINE LOG */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Kolom Kiri: Spesifikasi & Kondisi Fisik Unit */}
            <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#111827]/80 dark:backdrop-blur-md border border-slate-200 dark:border-[#1F2937] p-6 space-y-5">
              <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[#0284C7] dark:text-[#00F0FF]">
                  {ticketData.device_category === 'LAPTOP' ? (
                    <Laptop className="w-5 h-5" />
                  ) : ticketData.device_category === 'SMARTPHONE' ? (
                    <Smartphone className="w-5 h-5" />
                  ) : (
                    <Cpu className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Unit Servis</div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {ticketData.device_brand_model}
                  </h3>
                </div>
              </div>

              <dl className="space-y-3 text-sm">
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                  <dt className="text-slate-500 dark:text-slate-400">Nama Pelanggan</dt>
                  <dd className="font-semibold text-slate-900 dark:text-slate-100 font-mono">
                    {ticketData.customer_masked_name}
                  </dd>
                </div>
                {ticketData.service_type && (
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                    <dt className="text-slate-500 dark:text-slate-400">Jenis Layanan</dt>
                    <dd className="font-semibold text-slate-900 dark:text-slate-100">
                      {ticketData.service_type === 'WARRANTY_CLAIM'
                        ? 'Klaim Garansi / Retur'
                        : ticketData.service_type === 'PRIORITY'
                          ? 'Prioritas (Express)'
                          : 'Servis Reguler'}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                  <dt className="text-slate-500 dark:text-slate-400">Kategori Perangkat</dt>
                  <dd className="text-slate-900 dark:text-slate-100">
                    {ticketData.device_category}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                  <dt className="text-slate-500 dark:text-slate-400">Nomor Seri / IMEI</dt>
                  <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {ticketData.serial_number_masked || '-'}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                  <dt className="text-slate-500 dark:text-slate-400">Estimasi / Total Biaya</dt>
                  <dd className="font-bold font-mono tabular-nums text-[#0284C7] dark:text-[#00F0FF]">
                    {ticketData.final_price > 0
                      ? formatIDR(ticketData.final_price)
                      : ticketData.estimated_cost > 0
                        ? formatIDR(ticketData.estimated_cost)
                        : 'Menunggu Diagnosa'}
                  </dd>
                </div>
                {(ticketData.down_payment ?? 0) > 0 && (
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                    <dt className="text-slate-500 dark:text-slate-400">Uang Muka / DP</dt>
                    <dd className="font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatIDR(ticketData.down_payment ?? 0)}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between items-start gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800/70">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">Masa Garansi</dt>
                  <dd className="font-mono tabular-nums text-right text-slate-900 dark:text-slate-100">
                    {ticketData.status === 'CANCELLED' ? (
                      <span className="text-slate-400">-</span>
                    ) : ticketData.status === 'PICKED_UP' ? (
                      warrantyInfo.warrantyDays > 0 ? (
                        <span>
                          {warrantyInfo.warrantyDays} Hari{' '}
                          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            (Sisa {warrantyInfo.remainingDays ?? 0} Hari)
                          </span>
                        </span>
                      ) : (
                        <span>0 Hari (Tanpa Garansi)</span>
                      )
                    ) : warrantyInfo.warrantyDays > 0 ? (
                      <span>
                        {warrantyInfo.warrantyDays} Hari{' '}
                        <span className="block text-[11px] font-sans text-slate-500 dark:text-slate-400">
                          (Aktif setelah barang diambil)
                        </span>
                      </span>
                    ) : (
                      <span>0 Hari (Tanpa Garansi)</span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Checklist Kondisi Fisik Saat Masuk */}
              <div className="pt-1 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Kelengkapan & Kondisi Fisik Saat Diterima
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {ticketData.physical_checklist.unit_only ? (
                    <div className="col-span-2 p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Kelengkapan</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        Unit Only (Batangan)
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Charger</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {ticketData.physical_checklist.charger ? 'Disertakan' : 'Tidak Ada'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Tas / Sleeve</span>
                        <span className="font-medium text-slate-900 dark:text-slate-100">
                          {ticketData.physical_checklist.tas ? 'Disertakan' : 'Tidak Ada'}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Layar / Casing</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {ticketData.physical_checklist.layar_baret ||
                      ticketData.physical_checklist.casing_lecet
                        ? 'Ada Gores/Lecet'
                        : 'Mulus'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Baut Kurang</span>
                    <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {ticketData.physical_checklist.baut_kurang} pcs
                    </span>
                  </div>
                  {ticketData.physical_checklist.mati_total && (
                    <div className="col-span-2 p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between">
                      <span className="text-amber-700 dark:text-amber-400">Kondisi Masuk</span>
                      <span className="font-semibold text-amber-800 dark:text-amber-300">
                        Mati Total (Fungsi Belum Teruji)
                      </span>
                    </div>
                  )}
                </div>
                {(ticketData.hardware_specs ||
                  ticketData.physical_checklist.hardware_specs ||
                  ticketData.physical_checklist.catatan_fisik) && (
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Spesifikasi & Catatan Fisik
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                      {ticketData.hardware_specs ||
                        ticketData.physical_checklist.hardware_specs ||
                        ticketData.physical_checklist.catatan_fisik}
                    </p>
                  </div>
                )}
              </div>

              {/* Keluhan & Diagnosa */}
              <div className="pt-2 space-y-3 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Keluhan Awal
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    {ticketData.initial_complaint}
                  </p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Keterangan Diagnosa Teknisi
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 mt-1 leading-relaxed">
                    {ticketData.public_diagnosis ||
                      'Tim teknisi sedang melakukan pemeriksaan menyeluruh pada perangkat.'}
                  </p>
                </div>
              </div>
            </section>

            {/* Kolom Kanan: Timeline Riwayat Pengerjaan & Foto Bukti */}
            <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#111827]/80 dark:backdrop-blur-md border border-slate-200 dark:border-[#1F2937] p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Riwayat Pengerjaan
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Catatan tahapan servis dari meja kerja teknisi Geektech-Com
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {ticketData.logs.length} Aktivitas
                </span>
              </div>

              <div className="space-y-4">
                {ticketData.logs.map((logItem, idx) => (
                  <div
                    key={logItem.id}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        0{idx + 1}. {STATUS_LABELS[logItem.status_step]}
                      </div>
                      <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatDateTimeID(logItem.created_at)}
                      </div>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {logItem.public_description}
                    </p>

                    {logItem.photo_url && (
                      <div className="pt-1">
                        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF]" />
                          <span>Foto Pemeriksaan Teknisi</span>
                        </div>
                        {!failedImages[logItem.id] ? (
                          <img
                            src={logItem.photo_url}
                            alt={`Pemeriksaan ${ticketData.invoice_number}`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedImages((prev) => ({ ...prev, [logItem.id]: true }))
                            }
                            className="w-full max-h-72 object-cover rounded-xl border border-slate-200 dark:border-slate-800"
                          />
                        ) : (
                          <div className="w-full h-44 rounded-xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                            <Cpu className="w-8 h-8 text-[#00F0FF] mb-2" />
                            <span className="text-xs font-medium text-slate-200">
                              Dokumentasi Pemeriksaan Hardware
                            </span>
                            <span className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {ticketData.device_brand_model}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </motion.div>
      )}

      {/* Modal Kamera Pemindai QR Code */}
      {showQrScanner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs"
          onClick={() => void closeQrScannerModal()}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Modal */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-[#0284C7] dark:text-[#00F0FF] flex items-center justify-center">
                  <QrCode className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Scan QR Nota Servis
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void closeQrScannerModal()}
                aria-label="Tutup pemindai QR"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body Modal & Viewport Kamera */}
            <div className="p-5 space-y-4">
              <p className="text-xs sm:text-sm text-center text-slate-600 dark:text-slate-300">
                Arahkan kamera ke QR Code yang ada di struk nota Anda.
              </p>

              <div className="relative w-full min-h-[260px] rounded-xl overflow-hidden bg-slate-950 border border-slate-300 dark:border-slate-800 flex items-center justify-center">
                <div id="geektech-qr-reader" className="w-full" />

                {qrStarting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/80 text-slate-300 text-xs">
                    <Camera className="w-6 h-6 text-[#00F0FF] animate-pulse" />
                    <span>Mengaktifkan kamera pemindai...</span>
                  </div>
                )}
              </div>

              {qrScannerError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-700 dark:text-red-300 text-center">
                  {qrScannerError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void closeQrScannerModal()}
                  className="w-full px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Batal / Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cetak Nota Thermal / PDF */}
      {showPrintModal && ticketData && (
        <ThermalReceiptModal
          ticket={ticketData}
          waLast4={waLast4Input}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
};

