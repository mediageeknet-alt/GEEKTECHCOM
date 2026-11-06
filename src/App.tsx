/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sun, Moon, LogOut, Search, LayoutDashboard } from 'lucide-react';
import { PublicTrackingPortal } from './components/PublicTrackingPortal.tsx';
import { AdminDashboard } from './components/AdminDashboard.tsx';
import { PullCordLamp } from './components/PullCordLamp.tsx';
import type { AdminUser } from './types.ts';

type ActiveSection = 'tracking' | 'admin';

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>('tracking');
  const [isLoginRevealed, setIsLoginRevealed] = useState(false);
  const [qrParams, setQrParams] = useState<{ inv?: string; wa?: string }>({});
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Periksa sesi aktif pada saat load awal
  useEffect(() => {
    const checkSession = async () => {
      try {
        const token = localStorage.getItem('gtc_admin_bearer');
        const res = await fetch('/api/v1/admin/auth/session', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        const data = await res.json();
        if (data.authenticated && data.admin) {
          setAdminUser(data.admin);
        }
      } catch {
        // ignore
      }
    };
    checkSession();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inv = params.get('inv') || undefined;
    const wa = params.get('wa') || undefined;
    if (inv || wa) {
      setQrParams({ inv, wa });
      setActiveSection('tracking');
    }
    if (window.location.pathname.startsWith('/admin')) {
      setIsLoginRevealed(true);
    }
  }, []);

  const handleSetAdminUser = useCallback((user: AdminUser | null) => {
    setAdminUser(user);
    if (user) {
      setIsLoginRevealed(false);
      setActiveSection('admin');
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      const token = localStorage.getItem('gtc_admin_bearer');
      await fetch('/api/v1/admin/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
    } finally {
      try {
        localStorage.removeItem('gtc_admin_bearer');
      } catch {
        // ignore
      }
      setAdminUser(null);
      setIsLoginRevealed(false);
      setActiveSection('tracking');
    }
  }, []);

  const handleTogglePullCord = useCallback(() => {
    setIsLoginRevealed((prev) => {
      const next = !prev;
      if (!next && !adminUser) {
        setActiveSection('tracking');
      }
      return next;
    });
  }, [adminUser]);

  const showSpotlightLogin = !adminUser && isLoginRevealed;

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors duration-500 overflow-x-hidden relative ${
        showSpotlightLogin
          ? 'bg-[#030712] text-slate-100'
          : 'bg-[#F8FAFC] dark:bg-[#0B0F19] text-[#0F172A] dark:text-slate-100'
      }`}
      style={
        showSpotlightLogin
          ? {
              backgroundImage:
                'radial-gradient(circle at 50% 38%, rgba(251, 191, 36, 0.16) 0%, rgba(14, 165, 233, 0.12) 24%, rgba(3, 7, 18, 0.96) 62%, #020617 100%)',
            }
          : undefined
      }
    >
      {/* Saklar Lampu Gantung Rahasia (Easter Egg Pull Cord) - Hanya saat belum login */}
      {!adminUser && (
        <PullCordLamp isOn={isLoginRevealed} onToggle={handleTogglePullCord} />
      )}

      {/* Top Bar: 3 Zones Responsif */}
      <header
        className={`no-print sticky top-0 z-40 flex justify-between items-center w-full px-4 py-3 backdrop-blur-md border-b transition-colors duration-500 ${
          showSpotlightLogin
            ? 'bg-slate-950/70 border-slate-800/80'
            : 'bg-white/90 dark:bg-[#0B0F19]/90 border-slate-200 dark:border-[#1F2937]'
        }`}
      >
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#tracking"
          onClick={(e) => {
            e.preventDefault();
            setIsLoginRevealed(false);
            setActiveSection('tracking');
          }}
          className={`text-base sm:text-lg font-bold tracking-tight whitespace-nowrap shrink-0 ${
            showSpotlightLogin ? 'text-white' : 'text-slate-900 dark:text-white'
          }`}
        >
          Geektech-Com
        </a>

        {/* Zone 2: Navigation Links */}
        <nav className="flex items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300">
          <button
            type="button"
            onClick={() => {
              setIsLoginRevealed(false);
              setActiveSection('tracking');
            }}
            title="Lacak Servis"
            className={`inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeSection === 'tracking' && !showSpotlightLogin
                ? 'border-[#0284C7] dark:border-[#00F0FF] text-slate-900 dark:text-white font-semibold'
                : 'border-transparent hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Search className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
            <span className="hidden md:block">Lacak Servis</span>
          </button>

          {adminUser && (
            <button
              type="button"
              onClick={() => setActiveSection('admin')}
              title="Dashboard Servis"
              className={`inline-flex items-center gap-1.5 py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                activeSection === 'admin'
                  ? 'border-[#0284C7] dark:border-[#00F0FF] text-slate-900 dark:text-white font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
              <span className="md:hidden">Dashboard</span>
              <span className="hidden md:block">Dashboard Servis</span>
            </button>
          )}
        </nav>

        {/* Zone 3: Actions (Tanpa tombol Login Admin di publik) */}
        <div className="flex items-center gap-2 shrink-0">
          {adminUser ? (
            <>
              {/* Badge Profil Ringkas */}
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-[#111827] text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>{adminUser.full_name || adminUser.username}</span>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  (@{adminUser.username})
                </span>
                <span className="text-[10px] uppercase font-bold text-sky-600 dark:text-[#00F0FF]">
                  ({adminUser.role})
                </span>
              </div>

              {/* Tombol Tema */}
              <button
                type="button"
                onClick={() => setDarkMode(!darkMode)}
                aria-label="Ganti Tema"
                className="p-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#111827] text-slate-800 dark:text-slate-200 hover:border-[#0284C7] dark:hover:border-[#00F0FF] transition-colors shrink-0 cursor-pointer"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-[#00F0FF]" />
                ) : (
                  <Moon className="w-4 h-4 text-[#0284C7]" />
                )}
              </button>

              {/* Tombol Keluar Langsung di Navbar */}
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center gap-1.5 p-2 md:px-3 md:py-1.5 text-xs font-semibold rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors whitespace-nowrap cursor-pointer shadow-2xs shrink-0"
                title="Keluar dari Panel Admin"
              >
                <LogOut className="w-4 h-4 md:w-3.5 md:h-3.5 shrink-0" />
                <span className="hidden md:inline">Keluar</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Ganti Tema"
              className="p-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#111827] text-slate-800 dark:text-slate-200 hover:border-[#0284C7] dark:hover:border-[#00F0FF] transition-colors shrink-0 cursor-pointer"
            >
              {darkMode ? (
                <Sun className="w-4 h-4 text-[#00F0FF]" />
              ) : (
                <Moon className="w-4 h-4 text-[#0284C7]" />
              )}
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center relative">
        <AnimatePresence mode="wait">
          {showSpotlightLogin ? (
            <motion.div
              key="spotlight-login"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="relative z-10 w-full py-6 flex flex-col items-center justify-center"
            >
              {/* Efek Sorot Cahaya Lampu Gantung di Atas Form */}
              <div
                aria-hidden="true"
                className="pointer-events-none w-64 h-16 -mb-6 rounded-full blur-2xl opacity-75"
                style={{
                  background:
                    'radial-gradient(circle, rgba(251, 191, 36, 0.55) 0%, rgba(0, 240, 255, 0.25) 60%, transparent 100%)',
                }}
              />
              <AdminDashboard
                adminUser={adminUser}
                setAdminUser={handleSetAdminUser}
                onLogout={handleLogout}
              />
            </motion.div>
          ) : activeSection === 'admin' && adminUser ? (
            <motion.div
              key="admin-dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full flex-1"
            >
              <AdminDashboard
                adminUser={adminUser}
                setAdminUser={handleSetAdminUser}
                onLogout={handleLogout}
              />
            </motion.div>
          ) : (
            <motion.div
              key="public-tracking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full flex-1"
            >
              <PublicTrackingPortal
                initialInvoice={qrParams.inv}
                initialWaLast4={qrParams.wa}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Quiet Centered Footer */}
      <footer
        className={`no-print border-t py-6 px-6 text-xs text-center transition-colors duration-500 ${
          showSpotlightLogin
            ? 'border-slate-900 text-slate-600'
            : 'border-slate-200 dark:border-[#1F2937] text-slate-500 dark:text-slate-400'
        }`}
      >
        <div className="max-w-6xl mx-auto">
          © 2026 Geektech-Com Service Center · Spesialis Perbaikan Laptop & Smartphone
        </div>
      </footer>
    </div>
  );
}
