import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, QrCode, Tag, CheckCircle2, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import {
  type AdminTicketView,
  type PublicTicketTrackDTO,
  type StoreProfileInfo,
  STATUS_LABELS,
  formatIDR,
  formatDateTimeID,
  formatDateOnlyID,
} from '../types.ts';

interface ThermalReceiptModalProps {
  ticket: AdminTicketView | PublicTicketTrackDTO;
  storeProfile?: Partial<StoreProfileInfo> | null;
  waLast4?: string;
  customerFullName?: string;
  customerPhone?: string;
  onClose: () => void;
}

export type PrintFormatType = '58mm' | '80mm' | 'a4' | 'label';

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  ticket,
  storeProfile,
  waLast4,
  customerFullName,
  customerPhone,
  onClose,
}) => {
  const [paperWidth, setPaperWidth] = useState<PrintFormatType>('80mm');
  const [fetchedProfile, setFetchedProfile] = useState<StoreProfileInfo | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfFeedbackMessage, setPdfFeedbackMessage] = useState<string | null>(null);
  const printableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/v1/public/store-profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setFetchedProfile(data);
      })
      .catch(() => {
        // ignore fallback
      });
  }, []);

  const activeStoreName =
    storeProfile?.store_name || fetchedProfile?.store_name || 'Geektech-Com';
  const activeStoreSlogan =
    storeProfile?.store_slogan ||
    fetchedProfile?.store_slogan ||
    'Spesialis Perbaikan Laptop & Smartphone';
  const activeStoreAddress =
    storeProfile?.store_address ??
    fetchedProfile?.store_address ??
    'Jl. Soekarno Hatta No. 102, Malang';
  const activeStorePhone =
    storeProfile?.store_phone ?? fetchedProfile?.store_phone ?? '0811-3600-8899';
  const activeFooterNotes =
    storeProfile?.receipt_footer_notes ||
    fetchedProfile?.receipt_footer_notes ||
    '1. Garansi hanya berlaku untuk kerusakan dan komponen yang sama sesuai nota ini.\n2. Garansi gugur apabila segel rusak, terkena cairan, atau terjatuh.\n3. Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.';

  const isAdminTicket = 'customer' in ticket;
  const displayCustomerName = isAdminTicket
    ? ticket.customer.full_name
    : customerFullName || ticket.customer_masked_name;
  const displayWaLast4 = isAdminTicket ? ticket.customer.whatsapp_last4 : waLast4 || '****';
  const hasCustomerWa = isAdminTicket
    ? Boolean(
        ticket.customer.whatsapp_number &&
          ticket.customer.whatsapp_number.trim() !== '' &&
          ticket.customer.whatsapp_number.trim() !== '-' &&
          ticket.customer.whatsapp_number.replace(/\D/g, '').length >= 4
      )
    : ticket.has_whatsapp !== undefined
      ? ticket.has_whatsapp
      : Boolean(
          customerPhone &&
            customerPhone.trim() !== '' &&
            customerPhone.trim() !== '-' &&
            customerPhone.replace(/\D/g, '').length >= 4
        );
  const displayPhone = isAdminTicket
    ? hasCustomerWa
      ? ticket.customer.whatsapp_number
      : '-'
    : hasCustomerWa
      ? customerPhone || `•••• •••• ${displayWaLast4}`
      : '-';
  const displaySerial = isAdminTicket
    ? ticket.serial_number_imei || '-'
    : ticket.serial_number_masked || '-';

  const qrUrl = `/api/v1/public/qr?inv=${encodeURIComponent(ticket.invoice_number)}&wa=${encodeURIComponent(
    displayWaLast4
  )}`;

  const checklist = ticket.physical_checklist;
  const activeCost =
    ticket.final_price > 0 ? Number(ticket.final_price) : Number(ticket.estimated_cost);

  const exportReceiptToPdf = async () => {
    const printElement = printableRef.current;
    if (!printElement || isExportingPdf) return;

    setIsExportingPdf(true);
    setPdfFeedbackMessage(null);

    try {
      const rect = printElement.getBoundingClientRect();
      const widthPx = Math.ceil(
        Math.max(rect.width, printElement.offsetWidth, printElement.scrollWidth) || 520
      );
      const heightPx = Math.ceil(
        Math.max(rect.height, printElement.offsetHeight, printElement.scrollHeight) || 700
      );
      const aspectRatio = heightPx / widthPx;

      // Reset margin otomatis (mx-auto) pada root clone agar tidak bergeser & terpotong di sebelah kanan
      const dataUrl = await toPng(printElement, {
        width: widthPx,
        height: heightPx,
        canvasWidth: widthPx * 2,
        canvasHeight: heightPx * 2,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        style: {
          margin: '0',
          marginLeft: '0',
          marginRight: '0',
          marginTop: '0',
          marginBottom: '0',
          width: `${widthPx}px`,
          maxWidth: `${widthPx}px`,
          height: `${heightPx}px`,
          boxSizing: 'border-box',
          transform: 'none',
        },
      });

      if (paperWidth === 'a4') {
        // Dokumen A4 Portrait (210mm x 297mm):
        // Nota dipaksa rata atas (margin-top kecil) & tinggi maksimal dibatasi <= 140mm (< 148.5mm)
        // sehingga minimal 50% bagian bawah kertas A4 benar-benar kosong murni untuk dipotong.
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
        });
        const topMarginMm = 4;
        const leftMarginMm = 6;
        const maxHalfPageHeightMm = 140; // Setengah tinggi A4 adalah 148.5mm
        let targetWidthMm = 140; // Setara ~14cm (ukuran A5 <= 148.5mm)
        let targetHeightMm = targetWidthMm * aspectRatio;
        if (targetHeightMm > maxHalfPageHeightMm) {
          targetHeightMm = maxHalfPageHeightMm;
          targetWidthMm = targetHeightMm / aspectRatio;
        }
        pdf.addImage(
          dataUrl,
          'PNG',
          leftMarginMm,
          topMarginMm,
          targetWidthMm,
          targetHeightMm,
          undefined,
          'FAST'
        );
        pdf.save(`Nota-${ticket.invoice_number}-A5.pdf`);
      } else if (paperWidth === '80mm') {
        const pdfWidthMm = 80;
        const innerWidthMm = pdfWidthMm - 4;
        const innerHeightMm = innerWidthMm * aspectRatio;
        const pdfHeightMm = Math.max(90, Math.ceil(innerHeightMm + 6));
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [pdfWidthMm, pdfHeightMm],
        });
        pdf.addImage(dataUrl, 'PNG', 2, 2, innerWidthMm, innerHeightMm, undefined, 'FAST');
        pdf.save(`Struk-${ticket.invoice_number}-80mm.pdf`);
      } else if (paperWidth === '58mm') {
        const pdfWidthMm = 58;
        const innerWidthMm = pdfWidthMm - 3;
        const innerHeightMm = innerWidthMm * aspectRatio;
        const pdfHeightMm = Math.max(75, Math.ceil(innerHeightMm + 5));
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [pdfWidthMm, pdfHeightMm],
        });
        pdf.addImage(dataUrl, 'PNG', 1.5, 1.5, innerWidthMm, innerHeightMm, undefined, 'FAST');
        pdf.save(`Struk-${ticket.invoice_number}-58mm.pdf`);
      } else {
        const pdfWidthMm = 76;
        const innerWidthMm = pdfWidthMm - 4;
        const innerHeightMm = innerWidthMm * aspectRatio;
        const pdfHeightMm = Math.max(45, Math.ceil(innerHeightMm + 4));
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [pdfWidthMm, pdfHeightMm],
        });
        pdf.addImage(dataUrl, 'PNG', 2, 2, innerWidthMm, innerHeightMm, undefined, 'FAST');
        pdf.save(`Label-Teknisi-${ticket.invoice_number}.pdf`);
      }

      setPdfFeedbackMessage('File PDF berhasil disimpan & siap dicetak!');
      setTimeout(() => {
        setPdfFeedbackMessage(null);
      }, 4000);
    } catch (err) {
      console.error('Gagal mengekspor PDF:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handlePrint = async () => {
    // 1. Coba panggil dialog print bawaan browser secara sinkron (aktif bila dibuka di tab penuh)
    let nativePrintOpened = false;
    const onBeforePrint = () => {
      nativePrintOpened = true;
    };
    window.addEventListener('beforeprint', onBeforePrint, { once: true });
    try {
      window.print();
    } catch {
      // Diabaikan bila diblokir oleh sandbox iframe
    }
    window.removeEventListener('beforeprint', onBeforePrint);

    // 2. Jika window.print() diblokir oleh sandbox preview iframe, otomatis simpan & unduh sebagai PDF siap cetak
    if (!nativePrintOpened) {
      await exportReceiptToPdf();
    }
  };

  const renderReceiptSheetContent = () => {
    return (
      <div className="w-full max-w-full box-border bg-white text-slate-950 break-words whitespace-normal text-wrap">
        {/* 1. Header Toko Dinamis (Padat & Rata Tengah) */}
        <div className="w-full max-w-full text-center border-b border-dashed border-slate-400 pb-1.5 mb-1.5 space-y-0.5 break-words whitespace-normal text-wrap">
          <div className="font-bold tracking-tight text-sm uppercase text-slate-950 leading-tight break-words whitespace-normal text-wrap">
            {activeStoreName}
          </div>
          {activeStoreSlogan && (
            <div className="text-[10px] text-slate-800 font-medium leading-tight break-words whitespace-normal text-wrap">
              {activeStoreSlogan}
            </div>
          )}
          {(activeStoreAddress || activeStorePhone) && (
            <div className="text-[9.5px] text-slate-700 leading-tight break-words whitespace-normal text-wrap">
              {activeStoreAddress}
              {activeStoreAddress && activeStorePhone ? ' · ' : ''}
              {activeStorePhone && (
                <span className="font-mono font-semibold text-slate-800">
                  WA/Telp: {activeStorePhone}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 2. Metadata Invoice & Data Pelanggan */}
        <div className="w-full max-w-full space-y-0.5 border-b border-dashed border-slate-400 pb-1.5 mb-1.5 text-[11px] leading-snug text-slate-900">
          <div className="flex items-start justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">No. Invoice:</span>
            <span className="font-bold font-mono tabular-nums text-right text-slate-950 break-words whitespace-normal text-wrap">
              {ticket.invoice_number}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">Tanggal Masuk:</span>
            <span className="font-mono tabular-nums text-right text-slate-900 break-words whitespace-normal text-wrap">
              {formatDateTimeID(ticket.created_at)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">Pelanggan:</span>
            <span className="font-semibold text-right text-slate-950 break-words whitespace-normal text-wrap">
              {displayCustomerName}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">No. WhatsApp:</span>
            <span className="font-mono tabular-nums text-right text-slate-900 break-words whitespace-normal text-wrap">
              {displayPhone}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">Status Saat Ini:</span>
            <span className="font-semibold text-right text-slate-950 break-words whitespace-normal text-wrap">
              {STATUS_LABELS[ticket.status]}
            </span>
          </div>
          {ticket.service_type && (
            <div className="flex items-start justify-between gap-3 w-full">
              <span className="text-slate-700 shrink-0">Jenis Servis:</span>
              <span className="font-semibold text-right text-slate-950 break-words whitespace-normal text-wrap">
                {ticket.service_type === 'WARRANTY_CLAIM'
                  ? 'Klaim Garansi / Retur'
                  : ticket.service_type === 'PRIORITY'
                    ? 'Prioritas (Express)'
                    : 'Servis Reguler'}
              </span>
            </div>
          )}
        </div>

        {/* 3. Detail Perangkat & Checklist Fisik (Strict 2-Column Grid) */}
        <div className="w-full max-w-full border-b border-dashed border-slate-400 pb-1.5 mb-1.5 text-[11px] leading-snug text-black break-words whitespace-normal text-wrap">
          <div className="font-bold uppercase text-[10px] text-black mb-1.5">
            Data Unit & Kondisi Fisik
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 mb-1.5 items-start">
            <div className="text-gray-600 leading-snug">Unit:</div>
            <div className="text-black font-medium leading-snug break-words whitespace-normal text-wrap">
              {ticket.device_brand_model} ({ticket.device_category})
            </div>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 mb-1.5 items-start">
            <div className="text-gray-600 leading-snug">S/N · IMEI:</div>
            <div className="text-black font-medium font-mono tabular-nums leading-snug break-words whitespace-normal text-wrap">
              {displaySerial}
            </div>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-2 mb-1.5 items-start">
            <div className="text-gray-600 leading-snug">Kelengkapan:</div>
            <div className="text-black font-medium leading-snug break-words whitespace-normal text-wrap">
              {[
                checklist.unit_only
                  ? 'Unit Only (Batangan)'
                  : checklist.charger
                    ? 'Charger Bawa'
                    : 'Tanpa Charger',
                !checklist.unit_only && checklist.tas ? 'Tas/Sleeve Ada' : null,
                !checklist.unit_only && checklist.sim_tray_memory ? 'SIM/SD Ada' : null,
                checklist.mati_total ? 'Mati Total (Belum Teruji)' : null,
                checklist.layar_baret ? 'Layar Baret' : null,
                checklist.casing_lecet ? 'Casing Lecet' : null,
                checklist.baut_kurang > 0 ? `Baut Kurang ${checklist.baut_kurang}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>

          {(ticket.hardware_specs || checklist.hardware_specs || checklist.catatan_fisik) && (
            <div className="grid grid-cols-[120px_1fr] gap-2 mb-1.5 items-start">
              <div className="text-gray-600 leading-snug">Spesifikasi & Kondisi:</div>
              <div className="text-black font-medium leading-snug break-words whitespace-normal text-wrap">
                {ticket.hardware_specs || checklist.hardware_specs || checklist.catatan_fisik}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[120px_1fr] gap-2 mb-1.5 items-start">
            <div className="text-gray-600 leading-snug">Keluhan Awal:</div>
            <div className="text-black font-medium leading-snug break-words whitespace-normal text-wrap">
              {ticket.initial_complaint}
            </div>
          </div>

          {ticket.public_diagnosis && (
            <div className="grid grid-cols-[120px_1fr] gap-2 mb-1.5 items-start">
              <div className="text-gray-600 leading-snug">Diagnosa Teknisi:</div>
              <div className="text-black font-medium leading-snug break-words whitespace-normal text-wrap">
                {ticket.public_diagnosis}
              </div>
            </div>
          )}
        </div>

        {/* 4. Rincian Biaya & Garansi */}
        <div className="w-full max-w-full space-y-0.5 border-b border-dashed border-slate-400 pb-1.5 mb-1.5 text-[11px] leading-snug text-slate-900">
          <div className="flex items-baseline justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">
              {ticket.final_price > 0 ? 'Total Biaya Servis:' : 'Estimasi Biaya:'}
            </span>
            <span className="text-xs font-bold font-mono tabular-nums text-right text-slate-950 break-words whitespace-normal text-wrap">
              {activeCost > 0 ? formatIDR(activeCost) : 'Menunggu Diagnosa'}
            </span>
          </div>
          {(ticket.down_payment ?? 0) > 0 && (
            <>
              <div className="flex items-start justify-between gap-3 w-full">
                <span className="text-slate-700 shrink-0">Uang Muka / DP:</span>
                <span className="font-mono tabular-nums font-semibold text-right text-slate-950 break-words whitespace-normal text-wrap">
                  {formatIDR(ticket.down_payment ?? 0)}
                </span>
              </div>
              {activeCost > (ticket.down_payment ?? 0) && (
                <div className="flex items-start justify-between gap-3 w-full">
                  <span className="text-slate-700 shrink-0">Sisa Pembayaran:</span>
                  <span className="font-mono tabular-nums font-bold text-right text-slate-950 break-words whitespace-normal text-wrap">
                    {formatIDR(activeCost - (ticket.down_payment ?? 0))}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="flex items-start justify-between gap-3 w-full">
            <span className="text-slate-700 shrink-0">Masa Garansi:</span>
            <span className="font-mono tabular-nums font-semibold text-right text-slate-950 break-words whitespace-normal text-wrap">
              {ticket.warranty_days > 0
                ? ticket.status === 'PICKED_UP'
                  ? `${ticket.warranty_days} Hari (Aktif)`
                  : `${ticket.warranty_days} Hari (Aktif saat diambil)`
                : '0 Hari (Tanpa Garansi)'}
            </span>
          </div>
          {ticket.status === 'PICKED_UP' &&
            ticket.warranty_days > 0 &&
            ticket.warranty_expires_at && (
              <div className="flex items-start justify-between gap-3 w-full">
                <span className="text-slate-700 shrink-0">Batas Garansi:</span>
                <span className="font-mono tabular-nums text-right text-slate-950 break-words whitespace-normal text-wrap">
                  s/d {formatDateOnlyID(ticket.warranty_expires_at)}
                </span>
              </div>
            )}
          {ticket.status === 'PICKED_UP' && ticket.pickup_by && (
            <div className="pt-0.5 mt-0.5 border-t border-dotted border-slate-300 text-[10.5px] break-words whitespace-normal text-wrap">
              <span className="text-slate-700">Diambil Oleh: </span>
              <span className="font-semibold text-slate-950 break-words whitespace-normal text-wrap">
                {ticket.pickup_by}
                {ticket.pickup_notes ? ` (${ticket.pickup_notes})` : ''}
              </span>
            </div>
          )}
        </div>

        {/* 5. QR Code Tracking Real-Time (Ukuran Ringkas 68px agar Hemat Ruang Vertikal) */}
        <div className="w-full max-w-full flex flex-col items-center text-center py-1 border-b border-dashed border-slate-400 mb-1.5 bg-white text-slate-950 break-words whitespace-normal text-wrap">
          <div className="text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center justify-center gap-1 text-slate-950">
            <QrCode className="w-3 h-3 text-slate-950 shrink-0" />
            <span>Scan QR Lacak Progres Servis</span>
          </div>
          <div className="p-1 bg-white border border-slate-400 rounded-sm inline-block">
            <img
              src={qrUrl}
              alt={`QR Code Tracking ${ticket.invoice_number}`}
              referrerPolicy="no-referrer"
              className="w-[68px] h-[68px] object-contain mx-auto block"
            />
          </div>
          <div className="text-[9.5px] text-slate-950 mt-1 font-mono font-medium leading-tight break-words whitespace-normal text-wrap">
            Invoice: <strong className="font-bold">{ticket.invoice_number}</strong> ·{' '}
            {hasCustomerWa ? '4 Digit WA:' : 'PIN Lacak:'}{' '}
            <strong className="font-bold">{displayWaLast4}</strong>
          </div>
          <div className="text-[9px] text-slate-800 mt-0.5 font-mono leading-tight px-1 break-words whitespace-normal text-wrap">
            {hasCustomerWa ? (
              <span>
                (Masukkan Nomor Invoice <strong>*{ticket.invoice_number}*</strong> dan 4 digit
                terakhir WA Anda: <strong>*{displayWaLast4}*</strong>)
              </span>
            ) : (
              <span>
                (Masukkan Nomor Invoice <strong>*{ticket.invoice_number}*</strong> dan PIN Lacak
                Anda: <strong>*{displayWaLast4}*</strong>)
              </span>
            )}
          </div>
        </div>

        {/* 6. Footer Nota: Syarat & Ketentuan Dinamis */}
        <div className="w-full max-w-full text-center text-[9.5px] leading-snug text-slate-800 space-y-0.5 pt-0.5 pb-1 bg-white break-words whitespace-normal text-wrap">
          <div className="font-bold text-slate-950 uppercase tracking-wide">
            Syarat & Ketentuan Servis / Garansi
          </div>
          <div className="whitespace-pre-line break-words text-wrap text-slate-800 font-medium">
            {activeFooterNotes}
          </div>
          <div className="pt-1 text-[9px] text-slate-600 font-mono break-words whitespace-normal text-wrap">
            Terima kasih atas kepercayaan Anda di {activeStoreName}
          </div>
        </div>

        {/* 7. Garis Potong (Cut Line) di Bagian Paling Bawah Nota */}
        <div className="w-full max-w-full pt-2 mt-1">
          <div className="relative w-full border-b-2 border-dashed border-gray-400 flex items-center justify-center">
            <span className="-mb-2 px-2 bg-white text-[9px] font-mono text-gray-500/80 tracking-wide select-none">
              ✂️ Gunting / Potong di sini
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderActivePaperBlock = (withRef?: boolean) => (
    <div
      id={withRef ? 'geektech-printable-area' : undefined}
      ref={withRef ? printableRef : undefined}
      data-print-format={paperWidth}
      className={`h-auto box-border bg-white text-slate-950 border border-slate-300 shadow-md transition-all align-top ${
        paperWidth === '58mm'
          ? 'w-[240px] mx-auto p-3 pb-4 text-[11px] font-mono'
          : paperWidth === '80mm'
            ? 'w-[320px] mx-auto p-3.5 pb-5 text-xs font-mono'
            : paperWidth === 'label'
              ? 'w-[300px] mx-auto p-3.5 text-xs font-mono border-2 border-slate-900'
              : 'print-container w-full max-w-[148.5mm] max-h-[210mm] mx-auto p-3.5 pb-4 text-xs font-sans'
      }`}
    >
      {paperWidth === 'label' ? (
        /* ==============================================================
           MODE CETAK LABEL TEKNISI (TEMPELAN FISIK UNIT)
           Susunan: No. Invoice, Nama Pelanggan, Tipe Unit (S/N),
           Keluhan Awal / Kerusakan, Tgl Masuk
           ============================================================== */
        <div className="w-full max-w-full bg-white text-slate-950 space-y-2.5 break-words whitespace-normal text-wrap">
          {/* 1. No. Invoice */}
          <div className="w-full max-w-full border-b-2 border-slate-900 pb-2 text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-700">
              LABEL IDENTITAS UNIT SERVIS
            </div>
            <div className="text-xl font-extrabold font-mono tracking-tight text-slate-950 mt-0.5 break-words">
              {ticket.invoice_number}
            </div>
          </div>

          <div className="space-y-2.5 text-slate-950 pt-0.5">
            {/* 2. Nama Pelanggan */}
            <div className="break-words whitespace-normal text-wrap">
              <div className="text-[10px] font-bold uppercase text-slate-600">
                Nama Pelanggan
              </div>
              <div className="text-base font-extrabold text-slate-950 leading-tight break-words whitespace-normal text-wrap">
                {displayCustomerName}
              </div>
            </div>

            {/* 3. Tipe Unit (S/N) */}
            <div className="break-words whitespace-normal text-wrap">
              <div className="text-[10px] font-bold uppercase text-slate-600">
                Tipe Unit (S/N)
              </div>
              <div className="text-sm font-extrabold text-slate-950 leading-snug break-words whitespace-normal text-wrap">
                {ticket.device_brand_model}
              </div>
              <div className="text-xs font-bold font-mono text-slate-800 mt-0.5 break-words whitespace-normal text-wrap">
                S/N: {displaySerial}
              </div>
            </div>

            {/* 4. Keluhan Awal / Kerusakan */}
            <div className="w-full max-w-full pt-2 border-t border-dashed border-slate-400 break-words whitespace-normal text-wrap">
              <div className="text-[10px] font-bold uppercase text-slate-600">
                Keluhan / Kerusakan
              </div>
              <div className="text-sm font-bold text-slate-950 leading-snug mt-0.5 break-words whitespace-normal text-wrap">
                {ticket.initial_complaint || '-'}
              </div>
            </div>

            {/* 5. Tgl Masuk */}
            <div className="w-full max-w-full pt-2 border-t border-dashed border-slate-400 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase text-slate-600 shrink-0">
                Tgl Masuk:
              </span>
              <span className="text-xs font-extrabold font-mono text-right text-slate-950">
                {formatDateTimeID(ticket.created_at)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ==============================================================
           MODE NOTA TUNGGAL (THERMAL 58mm / 80mm / DOKUMEN SETENGAH A4 - A5)
           ============================================================== */
        renderReceiptSheetContent()
      )}
    </div>
  );

  return (
    <>
      <div className="print-modal-backdrop fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm overflow-y-auto p-4 sm:p-6">
        <style>{`@media print { @page { size: A4 portrait; margin: 0; } .print-container { width: 100% !important; max-width: 148.5mm !important; max-height: 148.5mm !important; margin: 0 !important; margin-top: 0 !important; padding: 12px 16px !important; vertical-align: top !important; box-sizing: border-box !important; } }`}</style>
        <div className="print-modal-card w-full max-w-3xl mx-auto my-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 shadow-2xl transition-all">
          {/* Toolbar Kontrol Cetak (Disembunyikan saat @media print) */}
          <div className="no-print flex flex-wrap items-center justify-between gap-4 px-5 py-4 rounded-t-xl bg-slate-50 dark:bg-[#0B0F19] border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Modul Cetak Nota Servis & Label Unit
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pilih format struk kasir thermal (58mm / 80mm), dokumen setengah A4 (A5), atau Label Teknisi
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setPaperWidth('58mm')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paperWidth === '58mm'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-[#00F0FF] shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Thermal 58mm
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth('80mm')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paperWidth === '80mm'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-[#00F0FF] shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Thermal 80mm
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth('a4')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paperWidth === 'a4'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-[#00F0FF] shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Dokumen PDF / A4
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth('label')}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    paperWidth === 'label'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-[#00F0FF] shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Label Teknisi</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handlePrint}
                disabled={isExportingPdf}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 disabled:opacity-60 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isExportingPdf ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Menyiapkan PDF...</span>
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4" />
                    <span>Cetak / Simpan PDF</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {pdfFeedbackMessage && (
            <div className="no-print flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{pdfFeedbackMessage}</span>
            </div>
          )}

          {/* Stage Kertas: Tanpa overflow-hidden agar container nota tidak pernah terpotong */}
          <div className="print-paper-stage w-full py-8 px-4 sm:px-6 rounded-b-xl bg-slate-200/70 dark:bg-slate-950/80">
            {renderActivePaperBlock(true)}
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <div id="geektech-print-portal">{renderActivePaperBlock(false)}</div>,
          document.body
        )}
    </>
  );
};

