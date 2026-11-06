import React, { useState, useEffect } from 'react';
import { Copy, Check, FileCode2, Server, Shield } from 'lucide-react';
import type { BlueprintStage } from '../types.ts';

export const ArchitectureBlueprintView: React.FC = () => {
  const [stages, setStages] = useState<BlueprintStage[]>([]);
  const [selectedStageIdx, setSelectedStageIdx] = useState(0);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/blueprint/files')
      .then((res) => res.json())
      .then((data) => {
        if (data.stages) {
          setStages(data.stages);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const currentStage = stages[selectedStageIdx];
  const currentFile = currentStage?.files[selectedFileIdx] || currentStage?.files[0];

  const handleCopy = () => {
    if (!currentFile) return;
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        Memuat kode arsitektur produksi Tahap 1 hingga Tahap 3...
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0284C7] dark:text-[#00F0FF] mb-1">
              <Shield className="w-4 h-4" />
              <span>Full Production Blueprint · Tahap 1 s/d Tahap 4</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              Arsitektur Infrastruktur Docker, Nginx, Prisma Schema & Security Core
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
              Seluruh file konfigurasi produksi (`docker-compose.yml`, `nginx.conf`, `.env.example`,
              `schema.prisma`, AES-256 Auth, Redis Rate-Limiter, dan DTO Controller) tersedia utuh
              tanpa placeholder dan siap disalin untuk deployment mandiri.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {stages.map((st, idx) => (
              <button
                key={st.stage}
                type="button"
                onClick={() => {
                  setSelectedStageIdx(idx);
                  setSelectedFileIdx(0);
                }}
                className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedStageIdx === idx
                    ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                0{idx + 1}. {st.stage.split(':')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Ringkasan Jaringan Terisolasi */}
        <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF]" />
              <span>Isolasi Jaringan Docker</span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Hanya Nginx yang berada di `public_net` (80/443). PostgreSQL (5432) dan Redis (6379)
              terkunci di `internal_net` (`internal: true`) tanpa ekspos port ke host.
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-white">
              Zero Data Leakage & Auto-Purge PIN
            </div>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Endpoint `/api/v1/public/track` hanya menerima POST, menyensor nama pelanggan (`M. N***`),
              dan menghapus `passcode_encrypted` menjadi `NULL` saat status `PICKED_UP`.
            </p>
          </div>
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800">
            <div className="font-semibold text-slate-900 dark:text-white">
              Redis Cache & Anti-Brute Force
            </div>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Cache key `track:invoice:wa_last4` (TTL 3600s) di-invalidate otomatis saat update
              tiket. Batas ketat 5 request/menit/IP dengan blokir otomatis 15 menit (HTTP 429).
            </p>
          </div>
        </div>
      </div>

      {/* Code Viewer */}
      {currentStage && currentFile && (
        <div className="rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1F2937] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-[#0B0F19] border-b border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {currentStage.files.map((file, idx) => (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setSelectedFileIdx(idx)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer ${
                    selectedFileIdx === idx
                      ? 'bg-white dark:bg-slate-800 text-[#0284C7] dark:text-[#00F0FF] font-semibold shadow-xs border border-slate-200 dark:border-slate-700'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FileCode2 className="w-3.5 h-3.5" />
                  <span>{file.name}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Kode Tersalin!' : `Salin ${currentFile.name}`}</span>
            </button>
          </div>

          <pre className="p-5 text-xs font-mono leading-relaxed overflow-x-auto max-h-[640px] bg-slate-950 text-slate-100">
            <code>{currentFile.content}</code>
          </pre>
        </div>
      )}
    </div>
  );
};
