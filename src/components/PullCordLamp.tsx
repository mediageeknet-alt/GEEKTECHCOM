import React, { useState, useCallback } from 'react';

interface PullCordLampProps {
  isOn: boolean;
  onToggle: () => void;
}

/**
 * Efek suara klik mekanis saklar tarik (Pull-Chain Switch) menggunakan Web Audio API
 */
function playMechanicalSwitchSound(turningOn: boolean) {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Suara klik tarik pertama (logam rantai)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(turningOn ? 1350 : 980, now);
    osc1.frequency.exponentialRampToValueAtTime(220, now + 0.035);
    gain1.gain.setValueAtTime(0.22, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.04);

    // Suara pegas kembali ("clack" mekanis saklar lampu)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(turningOn ? 1850 : 1200, now + 0.055);
    osc2.frequency.exponentialRampToValueAtTime(340, now + 0.095);
    gain2.gain.setValueAtTime(0.18, now + 0.055);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.055);
    osc2.stop(now + 0.1);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 200);
  } catch {
    // Abaikan jika browser memblokir audio otomatis
  }
}

export const PullCordLamp: React.FC<PullCordLampProps> = ({ isOn, onToggle }) => {
  const [isPulling, setIsPulling] = useState(false);

  const handlePull = useCallback(() => {
    setIsPulling(true);
    playMechanicalSwitchSound(!isOn);
    onToggle();
    setTimeout(() => {
      setIsPulling(false);
    }, 240);
  }, [isOn, onToggle]);

  return (
    <div className="no-print fixed top-0 right-14 sm:right-20 z-50 select-none pointer-events-auto">
      <button
        type="button"
        onClick={handlePull}
        aria-label="Saklar Lampu"
        title={isOn ? 'Tarik saklar untuk mematikan lampu' : 'Tarik saklar'}
        className="group relative flex flex-col items-center px-2 pt-0 pb-2 focus:outline-none cursor-pointer origin-top transition-transform duration-300 ease-out hover:rotate-3 active:rotate-0"
      >
        {/* Dudukan Kecil di Plafon / Atas Layar */}
        <span className="w-3 h-1 rounded-b-full bg-slate-400 dark:bg-slate-600 transition-colors" />

        {/* Tali Vertikal (Memanjang saat ditarik) */}
        <span
          className={`w-[1.5px] bg-gradient-to-b from-slate-400 via-slate-400 to-slate-500 dark:from-slate-600 dark:via-slate-500 dark:to-slate-400 transition-all duration-200 ease-out ${
            isPulling
              ? 'h-20 sm:h-24 translate-y-1'
              : isOn
                ? 'h-14 sm:h-16 group-hover:h-16 sm:group-hover:h-18'
                : 'h-12 sm:h-14 group-hover:h-14 sm:group-hover:h-16'
          }`}
        />

        {/* Bandul / Bola Kecil di Ujung Tali */}
        <span
          className={`w-3.5 h-3.5 rounded-full border transition-all duration-200 flex items-center justify-center ${
            isPulling ? 'translate-y-1 scale-95' : 'group-hover:scale-110'
          } ${
            isOn
              ? 'bg-amber-300 border-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.95)]'
              : 'bg-slate-300 dark:bg-slate-700 border-slate-400 dark:border-slate-500 group-hover:bg-amber-200/80 dark:group-hover:bg-amber-400/70 shadow-xs'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isOn ? 'bg-white' : 'bg-slate-500 dark:bg-slate-400'
            }`}
          />
        </span>
      </button>
    </div>
  );
};
