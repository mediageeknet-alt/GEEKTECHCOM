import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Lock,
  Plus,
  Printer,
  Send,
  ShieldAlert,
  Check,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  RefreshCw,
  LogOut,
  Camera,
  Settings,
  Search,
  KeyRound,
  Users,
  UserPlus,
  ShieldCheck,
  Wallet,
  TrendingUp,
  Pencil,
  Download,
  Upload,
  Database,
  AlertTriangle,
} from 'lucide-react';
import {
  type AdminTicketView,
  type FinancialSummary,
  type SystemSettingRecord,
  type ActiveSessionRecord,
  type RedisTelemetry,
  type TicketStatus,
  type DeviceCategory,
  type ServiceType,
  type WaDispatchInfo,
  type TeamMemberRecord,
  type AdminUser,
  STATUS_LABELS,
  formatIDR,
  formatDateTimeID,
} from '../types.ts';
import { ThermalReceiptModal } from './ThermalReceiptModal.tsx';

export const STATUS_CLEAN_LABELS: Record<TicketStatus, string> = {
  RECEIVED: 'Unit Diterima',
  DIAGNOSING: 'Pemeriksaan / Diagnosa',
  WAITING_APPROVAL: 'Konfirmasi Biaya',
  IN_PROGRESS: 'Proses Pengerjaan',
  QC_TESTING: 'QC & Pengujian Akhir',
  READY_FOR_PICKUP: 'Siap Diambil',
  PICKED_UP: 'Selesai & Diambil',
  CANCELLED: 'Dibatalkan',
};

const ALL_STATUSES: TicketStatus[] = [
  'RECEIVED',
  'DIAGNOSING',
  'WAITING_APPROVAL',
  'IN_PROGRESS',
  'QC_TESTING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'CANCELLED',
];

export type SubTabType = 'tickets' | 'new_ticket' | 'finance' | 'settings';
export type SettingsSectionType = 'profile' | 'whatsapp' | 'team_security';

interface AdminDashboardProps {
  adminUser?: AdminUser | null;
  setAdminUser?: (user: AdminUser | null) => void;
  onLogout?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminUser: externalAdminUser,
  setAdminUser: externalSetAdminUser,
  onLogout: externalOnLogout,
}) => {
  const [authChecking, setAuthChecking] = useState(!externalAdminUser);
  const [internalAdminUser, setInternalAdminUser] = useState<AdminUser | null>(
    externalAdminUser || null
  );

  const adminUser = externalAdminUser !== undefined ? externalAdminUser : internalAdminUser;

  const setAdminUser = useCallback(
    (user: AdminUser | null) => {
      setInternalAdminUser(user);
      if (externalSetAdminUser) externalSetAdminUser(user);
    },
    [externalSetAdminUser]
  );

  const [csrfToken, setCsrfToken] = useState<string>('');

  // Login State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Dashboard Data State
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
  const [tickets, setTickets] = useState<AdminTicketView[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettingRecord | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionRecord[]>([]);
  const [redisTelemetry, setRedisTelemetry] = useState<RedisTelemetry | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // UI Sub-Tab & Filter State
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>('tickets');
  const [settingsSection, setSettingsSection] = useState<SettingsSectionType>('profile');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');
  const [deviceCategoryFilter, setDeviceCategoryFilter] = useState<'ALL' | DeviceCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [financeSearchQuery, setFinanceSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showPasscode, setShowPasscode] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  const hasTicketWhatsApp = useCallback((t: AdminTicketView | null | undefined): boolean => {
    if (!t || !t.customer || !t.customer.whatsapp_number) return false;
    const raw = t.customer.whatsapp_number.trim();
    if (!raw || raw === '-') return false;
    return raw.replace(/\D/g, '').length >= 4;
  }, []);

  // Ref untuk scroll halus ke panel detail pada mobile touch screen
  const detailPanelRef = useRef<HTMLFormElement>(null);

  // Bearer Token Fallback untuk AI Studio cross-origin iframe
  const [bearerToken, setBearerToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('gtc_admin_bearer');
    } catch {
      return null;
    }
  });

  // Modal Print, Modal Konfirmasi Hapus Nota & Modal WhatsApp Fallback
  const [printTicket, setPrintTicket] = useState<AdminTicketView | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<AdminTicketView | null>(null);
  const [deletingTicket, setDeletingTicket] = useState(false);
  const [waModalInfo, setWaModalInfo] = useState<{
    invoiceNumber: string;
    customerName: string;
    dispatch: WaDispatchInfo;
  } | null>(null);
  const [copiedWaText, setCopiedWaText] = useState(false);

  // Team Management State
  const [teamMembers, setTeamMembers] = useState<TeamMemberRecord[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [newMemberOpen, setNewMemberOpen] = useState(false);
  const [newMemberFullName, setNewMemberFullName] = useState('');
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'OWNER' | 'TECHNICIAN' | 'CASHIER'>('TECHNICIAN');
  const [creatingMember, setCreatingMember] = useState(false);
  const [changePasswordMember, setChangePasswordMember] = useState<TeamMemberRecord | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [editProfileMember, setEditProfileMember] = useState<TeamMemberRecord | null>(null);
  const [editProfileFullName, setEditProfileFullName] = useState('');
  const [editProfileUsername, setEditProfileUsername] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<TeamMemberRecord | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);
  const [teamActionMessage, setTeamActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Backup & Restore Database State
  const [backupDownloading, setBackupDownloading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoringDatabase, setRestoringDatabase] = useState(false);
  const [backupRestoreMessage, setBackupRestoreMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  // Form Edit Tiket Terpilih
  const [editStatus, setEditStatus] = useState<TicketStatus>('RECEIVED');
  const [editPublicDiagnosis, setEditPublicDiagnosis] = useState('');
  const [editSecretNotes, setEditSecretNotes] = useState('');
  const [editEstimatedCost, setEditEstimatedCost] = useState<number>(0);
  const [editFinalPrice, setEditFinalPrice] = useState<number>(0);
  const [editPartsModal, setEditPartsModal] = useState<number>(0);
  const [editWarrantyDays, setEditWarrantyDays] = useState<number>(30);
  const [editPickupBy, setEditPickupBy] = useState('');
  const [editPickupNotes, setEditPickupNotes] = useState('');
  const [editLogDescription, setEditLogDescription] = useState('');
  const [editPhotoDataUrl, setEditPhotoDataUrl] = useState<string | null>(null);
  const [savingTicket, setSavingTicket] = useState(false);

  // Form Input Servisan Baru
  const [newServiceType, setNewServiceType] = useState<ServiceType>('REGULAR');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newWaNumber, setNewWaNumber] = useState('');
  const [newTrackingPin, setNewTrackingPin] = useState(() =>
    String(Math.floor(1000 + Math.random() * 9000))
  );
  const [newCustomerAddress, setNewCustomerAddress] = useState('');
  const [newDeviceCategory, setNewDeviceCategory] = useState<DeviceCategory>('LAPTOP');
  const [newDeviceBrandModel, setNewDeviceBrandModel] = useState('');
  const [newSerialNumber, setNewSerialNumber] = useState('');
  const [newPasscodePlain, setNewPasscodePlain] = useState('');
  const [newChkUnitOnly, setNewChkUnitOnly] = useState(false);
  const [newChkMatiTotal, setNewChkMatiTotal] = useState(false);
  const [newChkCharger, setNewChkCharger] = useState(true);
  const [newChkTas, setNewChkTas] = useState(false);
  const [newChkSimMemory, setNewChkSimMemory] = useState(false);
  const [newChkLayarBaret, setNewChkLayarBaret] = useState(false);
  const [newChkCasingLecet, setNewChkCasingLecet] = useState(false);
  const [newChkBautKurang, setNewChkBautKurang] = useState(0);
  const [newHardwareSpecs, setNewHardwareSpecs] = useState('');
  const [newInitialComplaint, setNewInitialComplaint] = useState('');
  const [newPublicDiagnosis, setNewPublicDiagnosis] = useState('');
  const [newSecretNotes, setNewSecretNotes] = useState('');
  const [newEstimatedCost, setNewEstimatedCost] = useState<number | ''>('');
  const [newDownPayment, setNewDownPayment] = useState<number | ''>('');
  const [newPartsModal, setNewPartsModal] = useState<number | ''>('');
  const [newWarrantyDays, setNewWarrantyDays] = useState<number>(30);
  const [newCustomerOwnParts, setNewCustomerOwnParts] = useState(false);
  const [newInitialStatus, setNewInitialStatus] = useState<
    'RECEIVED' | 'IN_PROGRESS' | 'READY_FOR_PICKUP' | 'PICKED_UP'
  >('RECEIVED');
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showWaSuggestions, setShowWaSuggestions] = useState(false);
  const [selectedWarrantyTicketId, setSelectedWarrantyTicketId] = useState<string>('');

  // Form Pengaturan Profil Usaha (Header & Footer Struk)
  const [storeName, setStoreName] = useState('Geektech-Com');
  const [storeSlogan, setStoreSlogan] = useState('Spesialis Perbaikan Laptop & Smartphone');
  const [storeAddress, setStoreAddress] = useState('Jl. Soekarno Hatta No. 102, Malang');
  const [storePhone, setStorePhone] = useState('0811-3600-8899');
  const [receiptFooterNotes, setReceiptFooterNotes] = useState(
    '1. Garansi hanya berlaku untuk kerusakan dan komponen yang sama sesuai nota ini.\n2. Garansi gugur apabila segel rusak, terkena cairan, atau terjatuh.\n3. Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.'
  );
  const [savingProfile, setSavingProfile] = useState(false);

  // Form Pengaturan Wablas
  const [wablasDomain, setWablasDomain] = useState('https://solo.wablas.com');
  const [wablasApiKey, setWablasApiKey] = useState('');
  const [wablasSecretKey, setWablasSecretKey] = useState('');
  const [isWablasEnabled, setIsWablasEnabled] = useState(false);
  const [savingWablas, setSavingWablas] = useState(false);

  // Helper penyusun request headers dengan Bearer token fallback & CSRF
  const getAuthHeaders = useCallback(
    (extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = { ...extra };
      const currentToken = bearerToken || localStorage.getItem('gtc_admin_bearer');
      if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
      }
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      return headers;
    },
    [bearerToken, csrfToken]
  );

  const fetchDashboardData = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const res = await fetch('/api/v1/admin/dashboard', {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (res.status === 401) {
        setAdminUser(null);
        return;
      }
      const data = await res.json();
      setFinancialSummary(data.financial_summary);
      setTickets(data.tickets || []);
      setSystemSettings(data.system_settings);
      setActiveSessions(data.active_sessions || []);
      setRedisTelemetry(data.redis_telemetry || null);

      if (data.system_settings) {
        setStoreName(data.system_settings.store_name || 'Geektech-Com');
        setStoreSlogan(
          data.system_settings.store_slogan || 'Spesialis Perbaikan Laptop & Smartphone'
        );
        setStoreAddress(data.system_settings.store_address ?? '');
        setStorePhone(data.system_settings.store_phone ?? '');
        setReceiptFooterNotes(
          data.system_settings.receipt_footer_notes ||
            'Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.'
        );
        setWablasDomain(data.system_settings.wablas_domain);
        setWablasApiKey(data.system_settings.wablas_api_key);
        setWablasSecretKey(data.system_settings.wablas_secret_key);
        setIsWablasEnabled(data.system_settings.is_wablas_enabled);
      }

      if (data.tickets?.length > 0) {
        setSelectedTicketId((prev) => {
          if (prev && data.tickets.some((t: AdminTicketView) => t.id === prev)) {
            return prev;
          }
          return data.tickets[0].id;
        });
      }
    } catch {
      // ignore
    } finally {
      setDashboardLoading(false);
    }
  }, [getAuthHeaders, setAdminUser]);

  const fetchTeamMembers = useCallback(async () => {
    setTeamLoading(true);
    try {
      const res = await fetch('/api/v1/admin/team', {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        setTeamMembers(data.team_members || []);
      }
    } catch {
      // ignore
    } finally {
      setTeamLoading(false);
    }
  }, [getAuthHeaders]);

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
          setCsrfToken(data.csrf_token || '');
          if (data.access_token) {
            setBearerToken(data.access_token);
            localStorage.setItem('gtc_admin_bearer', data.access_token);
          }
        }
      } catch {
        // ignore
      } finally {
        setAuthChecking(false);
      }
    };
    checkSession();
  }, []);

  useEffect(() => {
    if (adminUser) {
      fetchDashboardData();
      fetchTeamMembers();
    }
  }, [adminUser, fetchDashboardData, fetchTeamMembers]);

  const filteredTickets = tickets.filter((t) => {
    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const matchesCategory =
      deviceCategoryFilter === 'ALL' || t.device_category === deviceCategoryFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      t.invoice_number.toLowerCase().includes(q) ||
      t.customer.full_name.toLowerCase().includes(q) ||
      t.device_brand_model.toLowerCase().includes(q) ||
      t.customer.whatsapp_number.includes(q);
    return matchesStatus && matchesCategory && matchesQuery;
  });

  const selectedTicket =
    filteredTickets.find((t) => t.id === selectedTicketId) ||
    filteredTickets[0] ||
    tickets.find((t) => t.id === selectedTicketId) ||
    tickets[0] ||
    null;

  const syncFormWithTicket = useCallback((t: AdminTicketView) => {
    setEditStatus(t.status);
    setEditPublicDiagnosis(t.public_diagnosis || '');
    setEditSecretNotes(t.secret_technician_notes || '');
    setEditEstimatedCost(Number(t.estimated_cost));
    setEditFinalPrice(Number(t.final_price));
    setEditPartsModal(Number(t.parts_cost_modal));
    setEditWarrantyDays(Number(t.warranty_days ?? 30));
    setEditPickupBy(t.pickup_by || t.customer.full_name || '');
    setEditPickupNotes(t.pickup_notes || '');
    setEditLogDescription('');
    setEditPhotoDataUrl(null);
    setShowPasscode(false);
  }, []);

  useEffect(() => {
    if (selectedTicket) {
      syncFormWithTicket(selectedTicket);
    }
  }, [
    selectedTicket?.id,
    selectedTicket?.status,
    selectedTicket?.public_diagnosis,
    selectedTicket?.secret_technician_notes,
    selectedTicket?.final_price,
    selectedTicket?.estimated_cost,
    selectedTicket?.parts_cost_modal,
    selectedTicket?.warranty_days,
    selectedTicket?.pickup_by,
    selectedTicket?.pickup_notes,
    selectedTicket?.updated_at,
    syncFormWithTicket,
  ]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.message || 'Gagal masuk.');
        return;
      }
      setCsrfToken(data.csrf_token || '');
      if (data.access_token) {
        setBearerToken(data.access_token);
        try {
          localStorage.setItem('gtc_admin_bearer', data.access_token);
        } catch {
          // ignore
        }
      }
      setAdminUser(data.admin);
    } catch {
      setLoginError('Gagal terhubung ke server autentikasi.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSelectTicket = (ticketOrId: AdminTicketView | string) => {
    const targetTicket =
      typeof ticketOrId === 'string'
        ? tickets.find((t) => t.id === ticketOrId) || null
        : ticketOrId;

    const targetId = typeof ticketOrId === 'string' ? ticketOrId : ticketOrId.id;
    setSelectedTicketId(targetId);

    if (targetTicket) {
      syncFormWithTicket(targetTicket);
    }

    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setTimeout(() => {
        detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/admin/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
      });
    } finally {
      try {
        localStorage.removeItem('gtc_admin_bearer');
      } catch {
        // ignore
      }
      setBearerToken(null);
      setAdminUser(null);
      setCsrfToken('');
      if (externalOnLogout) externalOnLogout();
    }
  };

  const handleCreateTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberUsername || !newMemberFullName || !newMemberPassword) {
      setTeamActionMessage({ type: 'error', text: 'Semua field wajib diisi.' });
      return;
    }
    setCreatingMember(true);
    setTeamActionMessage(null);
    try {
      const res = await fetch('/api/v1/admin/team', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          username: newMemberUsername.trim(),
          full_name: newMemberFullName.trim(),
          password: newMemberPassword,
          role: newMemberRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamActionMessage({
          type: 'error',
          text: data.message || 'Gagal menambahkan anggota tim.',
        });
        return;
      }
      setTeamActionMessage({
        type: 'success',
        text: `Akun ${data.user.full_name} (@${data.user.username}) berhasil ditambahkan.`,
      });
      setNewMemberOpen(false);
      setNewMemberFullName('');
      setNewMemberUsername('');
      setNewMemberPassword('');
      setNewMemberRole('TECHNICIAN');
      await fetchTeamMembers();
    } catch {
      setTeamActionMessage({
        type: 'error',
        text: 'Terjadi kesalahan jaringan saat membuat user.',
      });
    } finally {
      setCreatingMember(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changePasswordMember) return;
    if (!newPasswordInput || newPasswordInput.length < 6) {
      setTeamActionMessage({
        type: 'error',
        text: 'Password baru minimal harus 6 karakter.',
      });
      return;
    }
    setUpdatingPassword(true);
    setTeamActionMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/team/${changePasswordMember.id}/password`, {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({ new_password: newPasswordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamActionMessage({
          type: 'error',
          text: data.message || 'Gagal memperbarui password.',
        });
        return;
      }
      setTeamActionMessage({
        type: 'success',
        text: `Password untuk @${changePasswordMember.username} berhasil diubah.`,
      });
      setChangePasswordMember(null);
      setNewPasswordInput('');
    } catch {
      setTeamActionMessage({
        type: 'error',
        text: 'Terjadi kesalahan jaringan saat mengubah password.',
      });
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleEditMemberProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editProfileMember) return;
    const cleanFullName = editProfileFullName.trim();
    const cleanUsername = editProfileUsername.trim().toLowerCase();
    if (!cleanFullName || !cleanUsername) {
      setTeamActionMessage({
        type: 'error',
        text: 'Nama Lengkap dan Username tidak boleh kosong.',
      });
      return;
    }
    setUpdatingProfile(true);
    setTeamActionMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/team/${editProfileMember.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify({
          full_name: cleanFullName,
          username: cleanUsername,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamActionMessage({
          type: 'error',
          text: data.message || 'Gagal memperbarui profil akun.',
        });
        return;
      }

      if (data.access_token) {
        setBearerToken(data.access_token);
        try {
          localStorage.setItem('gtc_admin_bearer', data.access_token);
        } catch {
          // ignore
        }
      }

      if (adminUser && editProfileMember.id === adminUser.id && data.user) {
        setAdminUser({
          ...adminUser,
          username: data.user.username,
          full_name: data.user.full_name,
        });
      }

      setTeamActionMessage({
        type: 'success',
        text:
          data.message ||
          `Profil akun ${cleanFullName} (@${cleanUsername}) berhasil diperbarui.`,
      });
      showToast('Profil Akun Berhasil Diperbarui');
      setEditProfileMember(null);
      await fetchTeamMembers();
    } catch {
      setTeamActionMessage({
        type: 'error',
        text: 'Terjadi kesalahan jaringan saat memperbarui profil akun.',
      });
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleDeleteTeamMember = (member: TeamMemberRecord) => {
    if (member.id === adminUser?.id) {
      setTeamActionMessage({
        type: 'error',
        text: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.',
      });
      return;
    }
    if (member.username === 'admin') {
      setTeamActionMessage({
        type: 'error',
        text: 'Akun Super Admin utama tidak dapat dihapus.',
      });
      return;
    }
    setMemberToDelete(member);
  };

  const handleConfirmDeleteTeamMember = async () => {
    if (!memberToDelete) return;
    setDeletingMember(true);
    setTeamActionMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/team/${memberToDelete.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamActionMessage({
          type: 'error',
          text: data.message || 'Gagal menghapus user.',
        });
        return;
      }
      setTeamActionMessage({
        type: 'success',
        text: data.message || 'Akun anggota tim berhasil dihapus.',
      });
      setMemberToDelete(null);
      await fetchTeamMembers();
    } catch {
      setTeamActionMessage({
        type: 'error',
        text: 'Terjadi kesalahan jaringan saat menghapus akun.',
      });
    } finally {
      setDeletingMember(false);
    }
  };

  const handleDownloadBackup = async () => {
    setBackupDownloading(true);
    setBackupRestoreMessage(null);
    try {
      const res = await fetch('/api/v1/admin/database/backup', {
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setBackupRestoreMessage({
          type: 'error',
          text: errData.message || 'Gagal mengunduh file backup database.',
        });
        return;
      }
      const jsonText = await res.text();
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `geektech-backup-${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setBackupRestoreMessage({
        type: 'success',
        text: `File backup database (geektech-backup-${dateStr}.json) berhasil diunduh.`,
      });
      showToast('Backup Database Berhasil Diunduh');
    } catch {
      setBackupRestoreMessage({
        type: 'error',
        text: 'Terjadi kesalahan jaringan saat mengunduh backup database.',
      });
    } finally {
      setBackupDownloading(false);
    }
  };

  const handleRestoreDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreFile) {
      setBackupRestoreMessage({
        type: 'error',
        text: 'Pilih file backup (.json) terlebih dahulu sebelum melakukan Restore Data.',
      });
      return;
    }

    setRestoringDatabase(true);
    setBackupRestoreMessage(null);
    try {
      const fileContent = await restoreFile.text();
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(fileContent);
      } catch {
        setBackupRestoreMessage({
          type: 'error',
          text: 'File yang dipilih bukan format JSON yang valid.',
        });
        setRestoringDatabase(false);
        return;
      }

      const res = await fetch('/api/v1/admin/database/restore', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        credentials: 'include',
        body: JSON.stringify(parsedJson),
      });
      const data = await res.json();
      if (!res.ok) {
        setBackupRestoreMessage({
          type: 'error',
          text: data.message || 'Gagal memulihkan database dari file backup.',
        });
        return;
      }

      if (data.current_admin) {
        setAdminUser(data.current_admin);
      }

      setRestoreFile(null);
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = '';
      }
      setBackupRestoreMessage({
        type: 'success',
        text: data.message || 'Database berhasil dipulihkan dari file backup.',
      });
      showToast('Database Berhasil Dipulihkan');
      await fetchDashboardData();
      await fetchTeamMembers();
    } catch {
      setBackupRestoreMessage({
        type: 'error',
        text: 'Terjadi kesalahan saat memproses restore database.',
      });
    } finally {
      setRestoringDatabase(false);
    }
  };

  const handleUpdateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;

    if (editStatus === 'PICKED_UP') {
      if (!editPickupBy.trim() || !editPickupNotes.trim()) {
        setFeedbackBanner(
          'Mohon lengkapi Nama Pengambil dan Keterangan / Hubungan pada kotak Bukti Pengambilan terlebih dahulu.'
        );
        return;
      }
    }

    setSavingTicket(true);
    setFeedbackBanner(null);

    const isCancelled = editStatus === 'CANCELLED';

    try {
      const res = await fetch(`/api/v1/admin/tickets/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
        body: JSON.stringify({
          status: editStatus,
          public_diagnosis: editPublicDiagnosis,
          secret_technician_notes: editSecretNotes,
          estimated_cost: isCancelled ? 0 : Number(editEstimatedCost),
          final_price: isCancelled ? 0 : Number(editFinalPrice),
          parts_cost_modal: isCancelled ? 0 : Number(editPartsModal),
          warranty_days: Number(editWarrantyDays),
          pickup_by: editStatus === 'PICKED_UP' ? editPickupBy.trim() : null,
          pickup_notes: editStatus === 'PICKED_UP' ? editPickupNotes.trim() : null,
          log_description: editLogDescription || undefined,
          photo_data_url: editPhotoDataUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedbackBanner(data.message || 'Gagal memperbarui tiket.');
        return;
      }

      if (isCancelled) {
        setEditEstimatedCost(0);
        setEditFinalPrice(0);
        setEditPartsModal(0);
        if (statusFilter !== 'ALL' && statusFilter !== 'CANCELLED') {
          setStatusFilter('CANCELLED');
        }
      }

      setFeedbackBanner(data.message);
      setEditLogDescription('');
      setEditPhotoDataUrl(null);
      await fetchDashboardData();

      if (hasTicketWhatsApp(data.ticket) && data.whatsapp_dispatch) {
        setWaModalInfo({
          invoiceNumber: data.ticket.invoice_number,
          customerName: data.ticket.customer.full_name,
          dispatch: data.whatsapp_dispatch,
        });
      }
    } catch {
      setFeedbackBanner('Terjadi kesalahan jaringan saat menyimpan perubahan.');
    } finally {
      setSavingTicket(false);
    }
  };

  const handleConfirmDeleteTicket = async () => {
    if (!ticketToDelete) return;
    setDeletingTicket(true);
    setFeedbackBanner(null);

    try {
      const targetId = ticketToDelete.id;
      const res = await fetch(`/api/v1/admin/tickets/${targetId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedbackBanner(data.message || 'Gagal menghapus nota servis.');
        setTicketToDelete(null);
        return;
      }

      setTicketToDelete(null);
      setFeedbackBanner(data.message || 'Nota servis berhasil dihapus secara permanen.');

      const remaining = tickets.filter((t) => t.id !== targetId);
      setTickets(remaining);
      if (selectedTicketId === targetId) {
        setSelectedTicketId(remaining.length > 0 ? remaining[0].id : null);
      }

      await fetchDashboardData();
    } catch {
      setFeedbackBanner('Terjadi kesalahan jaringan saat menghapus nota servis.');
      setTicketToDelete(null);
    } finally {
      setDeletingTicket(false);
    }
  };

  // Helper kalkulasi sisa hari garansi tiket:
  // Garansi aktif jika dan hanya jika status === 'PICKED_UP' dan Tanggal Expired > Hari Ini
  const getTicketWarrantyRemainingDays = useCallback((t: AdminTicketView): number => {
    const wDays = Math.max(0, Number(t.warranty_days ?? 0));
    if (t.status !== 'PICKED_UP' || wDays <= 0) return 0;
    const pickedUpLog = [...(t.logs || [])]
      .reverse()
      .find((l) => l.status_step === 'PICKED_UP');
    const pickedUpAtIso = t.picked_up_at || pickedUpLog?.created_at || t.updated_at;
    const expiresMs = t.warranty_expires_at
      ? new Date(t.warranty_expires_at).getTime()
      : new Date(pickedUpAtIso).getTime() + wDays * 24 * 60 * 60 * 1000;
    const diffMs = expiresMs - Date.now();
    if (diffMs <= 0) return 0;
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, []);

  // Daftar pelanggan unik dari database beserta info apakah memiliki unit bergaransi aktif
  const uniqueCustomerDirectory = React.useMemo(() => {
    const map = new Map<
      string,
      AdminTicketView['customer'] & { activeWarrantyCount: number }
    >();
    for (const t of tickets) {
      const cust = t.customer;
      const cleanAddr = cust.address
        ? cust.address.replace(/\s*\(RAHASIA INTERNAL\)/gi, '').trim()
        : null;
      const rem = getTicketWarrantyRemainingDays(t);
      const existing = map.get(cust.id);
      if (!existing) {
        map.set(cust.id, {
          ...cust,
          address: cleanAddr,
          activeWarrantyCount: rem > 0 ? 1 : 0,
        });
      } else if (rem > 0) {
        existing.activeWarrantyCount += 1;
      }
    }
    return Array.from(map.values());
  }, [tickets, getTicketWarrantyRemainingDays]);

  // Daftar tiket bergaransi aktif milik pelanggan yang sedang diketik/dipilih di form Input Servisan
  const eligibleWarrantyTickets = React.useMemo(() => {
    const nameQuery = newCustomerName.trim().toLowerCase();
    const waDigits = newWaNumber.replace(/\D/g, '');
    if (!nameQuery && waDigits.length < 4) return [];

    return tickets
      .filter((t) => {
        if (t.status !== 'PICKED_UP') return false;
        const rem = getTicketWarrantyRemainingDays(t);
        if (rem <= 0) return false;

        const custName = t.customer.full_name.trim().toLowerCase();
        const custWaDigits = (t.customer.whatsapp_number || '').replace(/\D/g, '');

        const matchByName = nameQuery.length >= 2 && custName === nameQuery;
        const matchByWa =
          waDigits.length >= 6 &&
          custWaDigits.length >= 6 &&
          custWaDigits.slice(-8) === waDigits.slice(-8);

        return matchByName || matchByWa;
      })
      .map((t) => ({
        ticket: t,
        remainingDays: getTicketWarrantyRemainingDays(t),
      }));
  }, [tickets, newCustomerName, newWaNumber, getTicketWarrantyRemainingDays]);

  // Sinkronisasi otomatis field unit saat mode "Klaim Garansi / Retur" aktif
  useEffect(() => {
    if (newServiceType !== 'WARRANTY_CLAIM') return;

    if (eligibleWarrantyTickets.length > 0) {
      const currentMatch =
        eligibleWarrantyTickets.find((item) => item.ticket.id === selectedWarrantyTicketId) ||
        eligibleWarrantyTickets[0];
      if (currentMatch) {
        setSelectedWarrantyTicketId(currentMatch.ticket.id);
        setNewDeviceCategory(currentMatch.ticket.device_category);
        setNewDeviceBrandModel(currentMatch.ticket.device_brand_model);
        setNewSerialNumber(currentMatch.ticket.serial_number_imei || '');
        setNewWarrantyDays(currentMatch.remainingDays);
      }
    } else {
      setSelectedWarrantyTicketId('');
      setNewDeviceBrandModel('');
      setNewSerialNumber('');
    }
  }, [newServiceType, eligibleWarrantyTickets, selectedWarrantyTicketId]);

  const handleWaNumberChange = (val: string) => {
    setNewWaNumber(val);
    const digits = val.replace(/\D/g, '');
    if (digits.length >= 4) {
      setNewTrackingPin(digits.slice(-4));
    } else if (digits.length === 0) {
      setNewTrackingPin(String(Math.floor(1000 + Math.random() * 9000)));
    }
  };

  const handleSelectCustomerSuggestion = (
    cust: AdminTicketView['customer'] & { activeWarrantyCount?: number }
  ) => {
    setNewCustomerName(cust.full_name);
    const cleanWa =
      cust.whatsapp_number && cust.whatsapp_number !== '-' ? cust.whatsapp_number : '';
    setNewWaNumber(cleanWa);
    const digits = cleanWa.replace(/\D/g, '');
    if (digits.length >= 4) {
      setNewTrackingPin(digits.slice(-4));
    } else if (cust.whatsapp_last4) {
      setNewTrackingPin(cust.whatsapp_last4);
    }
    const cleanAddr = (cust.address || '').replace(/\s*\(RAHASIA INTERNAL\)/gi, '').trim();
    setNewCustomerAddress(cleanAddr);
    setShowNameSuggestions(false);
    setShowWaSuggestions(false);
  };

  const regenerateRandomPin = () => {
    setNewTrackingPin(String(Math.floor(1000 + Math.random() * 9000)));
  };

  const handleToggleUnitOnly = () => {
    const nextVal = !newChkUnitOnly;
    setNewChkUnitOnly(nextVal);
    if (nextVal) {
      setNewChkCharger(false);
      setNewChkTas(false);
      setNewChkSimMemory(false);
    }
  };

  const handleToggleAccessory = (
    current: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>
  ) => {
    const nextVal = !current;
    setter(nextVal);
    if (nextVal && newChkUnitOnly) {
      setNewChkUnitOnly(false);
    }
  };

  const OWN_PART_TAG = '[HANYA JASA PASANG - PART DARI PELANGGAN]';

  const formatThousandSeparator = (val: number | '' | null | undefined): string => {
    if (val === '' || val === null || val === undefined) return '';
    const num = Number(val);
    if (Number.isNaN(num)) return '';
    return num.toLocaleString('id-ID');
  };

  const parseCurrencyInput = (raw: string): number | '' => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return parseInt(digits, 10);
  };

  const handleToggleCustomerOwnParts = (checked: boolean) => {
    setNewCustomerOwnParts(checked);
    if (checked) {
      setNewPartsModal(0);
      setNewWarrantyDays(0);
      setNewInitialComplaint((prev) => {
        if (prev.includes(OWN_PART_TAG)) return prev;
        return prev.trim() ? `${OWN_PART_TAG} ${prev.trim()}` : `${OWN_PART_TAG} `;
      });
    } else {
      setNewPartsModal('');
      setNewWarrantyDays(30);
      setNewInitialComplaint((prev) => prev.replace(OWN_PART_TAG, '').replace(/^\s+/, ''));
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newServiceType === 'WARRANTY_CLAIM' && eligibleWarrantyTickets.length === 0) {
      setFeedbackBanner(
        'Tidak ditemukan unit dengan garansi aktif untuk pelanggan ini. Silakan ubah ke Servis Reguler.'
      );
      return;
    }

    setCreatingTicket(true);
    setFeedbackBanner(null);

    const hasValidWa = newWaNumber.replace(/\D/g, '').length >= 4;
    const finalComplaintText =
      newCustomerOwnParts && !newInitialComplaint.includes(OWN_PART_TAG)
        ? `${OWN_PART_TAG} ${newInitialComplaint.trim()}`.trim()
        : newInitialComplaint.trim();

    const cleanEstimatedCost = newEstimatedCost === '' ? 0 : Number(newEstimatedCost);
    const cleanDownPayment = newDownPayment === '' ? 0 : Number(newDownPayment);
    const cleanPartsModal = newCustomerOwnParts
      ? 0
      : newPartsModal === ''
        ? 0
        : Number(newPartsModal);

    try {
      const res = await fetch('/api/v1/admin/tickets', {
        method: 'POST',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
        body: JSON.stringify({
          service_type: newServiceType,
          customer_own_parts: newCustomerOwnParts,
          initial_status: newInitialStatus,
          customer_name: newCustomerName,
          whatsapp_number: hasValidWa ? newWaNumber.trim() : '',
          tracking_pin: newTrackingPin.replace(/\D/g, '').slice(-4).padStart(4, '0'),
          customer_address:
            newCustomerAddress.replace(/\s*\(RAHASIA INTERNAL\)/gi, '').trim() || null,
          device_category: newDeviceCategory,
          device_brand_model: newDeviceBrandModel,
          serial_number_imei: newSerialNumber || null,
          passcode_plain: newPasscodePlain || null,
          hardware_specs: newHardwareSpecs.trim() || null,
          physical_checklist: {
            unit_only: newChkUnitOnly,
            mati_total: newChkMatiTotal,
            charger: newChkUnitOnly ? false : newChkCharger,
            tas: newChkUnitOnly ? false : newChkTas,
            sim_tray_memory: newChkUnitOnly ? false : newChkSimMemory,
            layar_baret: newChkLayarBaret,
            casing_lecet: newChkCasingLecet,
            baut_kurang: Number(newChkBautKurang),
            hardware_specs: newHardwareSpecs.trim() || undefined,
            catatan_fisik: newHardwareSpecs.trim() || undefined,
          },
          initial_complaint: finalComplaintText,
          public_diagnosis: newPublicDiagnosis || null,
          secret_technician_notes: newSecretNotes || null,
          estimated_cost: cleanEstimatedCost,
          down_payment: cleanDownPayment,
          parts_cost_modal: cleanPartsModal,
          warranty_days: Number(newWarrantyDays),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedbackBanner(data.message || 'Gagal membuat nota servis baru.');
        return;
      }

      setFeedbackBanner('Servisan Berhasil Disimpan');
      showToast('Servisan Berhasil Disimpan');
      await fetchDashboardData();
      if (statusFilter !== 'ALL' && statusFilter !== data.ticket.status) {
        setStatusFilter('ALL');
      }
      setSelectedTicketId(data.ticket.id);
      setActiveSubTab('tickets');

      // Reset form
      setNewServiceType('REGULAR');
      setNewCustomerOwnParts(false);
      setNewInitialStatus('RECEIVED');
      setSelectedWarrantyTicketId('');
      setNewCustomerName('');
      setNewWaNumber('');
      setNewTrackingPin(String(Math.floor(1000 + Math.random() * 9000)));
      setNewCustomerAddress('');
      setNewDeviceBrandModel('');
      setNewSerialNumber('');
      setNewPasscodePlain('');
      setNewChkUnitOnly(false);
      setNewChkMatiTotal(false);
      setNewChkCharger(true);
      setNewChkTas(false);
      setNewChkSimMemory(false);
      setNewChkLayarBaret(false);
      setNewChkCasingLecet(false);
      setNewChkBautKurang(0);
      setNewHardwareSpecs('');
      setNewInitialComplaint('');
      setNewPublicDiagnosis('');
      setNewSecretNotes('');
      setNewEstimatedCost('');
      setNewDownPayment('');
      setNewPartsModal('');
      setNewWarrantyDays(30);

      // Jika nomor WhatsApp kosong: bypass notifikasi WA sepenuhnya dan langsung buka Cetak Nota Thermal
      if (!hasValidWa) {
        setWaModalInfo(null);
        setPrintTicket(data.ticket);
      } else if (data.whatsapp_dispatch) {
        setWaModalInfo({
          invoiceNumber: data.ticket.invoice_number,
          customerName: data.ticket.customer.full_name,
          dispatch: data.whatsapp_dispatch,
        });
      }
    } catch {
      setFeedbackBanner('Gagal menyimpan servisan baru.');
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleManualWaTrigger = async (ticket: AdminTicketView) => {
    if (!hasTicketWhatsApp(ticket)) return;
    try {
      const res = await fetch(`/api/v1/admin/tickets/${ticket.id}/notify-wa`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.whatsapp_dispatch) {
        setWaModalInfo({
          invoiceNumber: ticket.invoice_number,
          customerName: ticket.customer.full_name,
          dispatch: data.whatsapp_dispatch,
        });
        await fetchDashboardData();
      }
    } catch {
      // ignore
    }
  };

  const handlePhotoUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveStoreProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setFeedbackBanner(null);
    try {
      const res = await fetch('/api/v1/admin/settings/profile', {
        method: 'PUT',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
        body: JSON.stringify({
          store_name: storeName.trim(),
          store_slogan: storeSlogan.trim(),
          store_address: storeAddress.trim(),
          store_phone: storePhone.trim(),
          receipt_footer_notes: receiptFooterNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackBanner(data.message || 'Gagal menyimpan Profil Usaha.');
        return;
      }
      setFeedbackBanner(data.message || 'Profil Usaha berhasil disimpan.');
      await fetchDashboardData();
    } catch {
      setFeedbackBanner('Gagal menyimpan Profil Usaha.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveWablasSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingWablas(true);
    setFeedbackBanner(null);
    try {
      const res = await fetch('/api/v1/admin/settings/wablas', {
        method: 'PUT',
        headers: getAuthHeaders({
          'Content-Type': 'application/json',
        }),
        credentials: 'include',
        body: JSON.stringify({
          wablas_domain: wablasDomain,
          wablas_api_key: wablasApiKey,
          wablas_secret_key: wablasSecretKey,
          is_wablas_enabled: isWablasEnabled,
        }),
      });
      const data = await res.json();
      setFeedbackBanner(data.message || 'Pengaturan disimpan.');
      await fetchDashboardData();
    } catch {
      setFeedbackBanner('Gagal menyimpan konfigurasi Wablas.');
    } finally {
      setSavingWablas(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/v1/admin/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      setFeedbackBanner(data.message);
      await fetchDashboardData();
    } catch {
      // ignore
    }
  };

  if (authChecking) {
    return (
      <div className="max-w-md mx-auto py-20 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
        Memeriksa sesi login...
      </div>
    );
  }

  // Tampilan Login Admin jika belum terautentikasi
  if (!adminUser) {
    return (
      <div className="max-w-md w-full mx-auto px-4 py-8">
        <div className="rounded-2xl bg-white dark:bg-[#111827]/95 border border-slate-200 dark:border-[#1F2937] p-6 sm:p-8 shadow-2xl space-y-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#0284C7] dark:text-[#00F0FF] mb-1.5">
              <Lock className="w-4 h-4" />
              <span>Akses Internal</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Login Admin
            </h1>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Username
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Masukkan username"
                required
                autoComplete="username"
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Password
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Masukkan password"
                required
                autoComplete="current-password"
                className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>

            {loginError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-xs text-red-600 dark:text-red-300">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer shadow-xs"
            >
              {loginLoading ? 'Memverifikasi...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Helper untuk menghitung hari menginap unit servis
  const getDaysAgo = (dateStr: string) => {
    try {
      const created = new Date(dateStr).getTime();
      const diffDays = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return 'Hari ini';
      if (diffDays === 1) return '1 hari lalu';
      return `${diffDays} hari lalu`;
    } catch {
      return '-';
    }
  };

  const getDaysAgoNumber = (dateStr: string) => {
    try {
      const created = new Date(dateStr).getTime();
      return Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
    } catch {
      return 0;
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full px-2 md:px-6 py-6 md:py-8 space-y-6">
      {/* Baris Header Internal Admin & Sub-Navigasi */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="px-1 md:px-0">
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
            Dashboard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Pantau dan kelola antrean servis hari ini.
          </p>
        </div>

        {/* Tab Navigasi Admin Bersih & Responsif (Bisa di-swipe horizontal di layar HP) */}
        <div className="flex items-center gap-2 w-full md:w-auto min-w-0">
          <div className="flex flex-row overflow-x-auto whitespace-nowrap scrollbar-hide no-scrollbar w-full gap-2 pb-2 md:pb-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setActiveSubTab('tickets')}
              className={`px-3 py-1.5 text-sm md:text-base font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'tickets'
                  ? 'bg-white dark:bg-[#111827] text-[#0284C7] dark:text-[#00F0FF] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Antrean Servis ({tickets.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('new_ticket')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm md:text-base font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'new_ticket'
                  ? 'bg-white dark:bg-[#111827] text-[#0284C7] dark:text-[#00F0FF] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Input Servisan</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('finance')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm md:text-base font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'finance'
                  ? 'bg-white dark:bg-[#111827] text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Wallet className="w-4 h-4 shrink-0" />
              <span>Kas & Keuangan</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('settings');
                fetchTeamMembers();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm md:text-base font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === 'settings'
                  ? 'bg-white dark:bg-[#111827] text-[#0284C7] dark:text-[#00F0FF] shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Pengaturan</span>
            </button>
          </div>

          <button
            type="button"
            onClick={fetchDashboardData}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Segarkan Data"
          >
            <RefreshCw className={`w-4 h-4 ${dashboardLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Toast Success Mengambang (Tetap Terlihat Saat Modal Cetak Nota Terbuka) */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-600 text-white text-xs sm:text-sm font-semibold shadow-xl border border-emerald-400/40">
          <Check className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Notifikasi Feedback Aksi */}
      {feedbackBanner && (
        <div className="p-4 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/70 text-xs sm:text-sm text-sky-900 dark:text-sky-200 flex items-center justify-between gap-4">
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-xs underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 1: ANTREAN SERVIS (DAFTAR NOTA & PANEL DETAIL TEKNISI)
         ==================================================================== */}
      {activeSubTab === 'tickets' && (
        <div className="space-y-4">
          {/* Ringkasan Status Unit Aktif (Interaktif / Bisa Diklik Untuk Filter) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-sky-50/80 dark:bg-sky-950/40 border-[#0284C7] dark:border-[#00F0FF] shadow-xs ring-1 ring-[#0284C7]/20 dark:ring-[#00F0FF]/20'
                  : 'bg-white dark:bg-[#111827]/80 border-slate-200 dark:border-[#1F2937] hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span>Total Unit</span>
                <span className="text-[10px] text-slate-400">Semua</span>
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
                {tickets.length} <span className="text-xs font-normal text-slate-500">Unit</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('WAITING_APPROVAL')}
              className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${
                statusFilter === 'WAITING_APPROVAL'
                  ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-500 shadow-xs ring-1 ring-amber-500/20'
                  : 'bg-white dark:bg-[#111827]/80 border-slate-200 dark:border-[#1F2937] hover:border-amber-400 dark:hover:border-amber-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <span>Tunggu Konfirmasi</span>
                <span className="text-[10px]">Filter</span>
              </div>
              <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
                {tickets.filter((t) => t.status === 'WAITING_APPROVAL').length}{' '}
                <span className="text-xs font-normal text-amber-600/70 dark:text-amber-400/70">Unit</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('IN_PROGRESS')}
              className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${
                statusFilter === 'IN_PROGRESS'
                  ? 'bg-sky-50/80 dark:bg-sky-950/40 border-sky-500 shadow-xs ring-1 ring-sky-500/20'
                  : 'bg-white dark:bg-[#111827]/80 border-slate-200 dark:border-[#1F2937] hover:border-sky-400 dark:hover:border-sky-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-sky-600 dark:text-sky-400">
                <span>Sedang Dikerjakan</span>
                <span className="text-[10px]">Filter</span>
              </div>
              <div className="text-xl font-bold font-mono text-sky-600 dark:text-sky-400 mt-1">
                {tickets.filter((t) => ['IN_PROGRESS', 'WAITING_PARTS', 'DIAGNOSING'].includes(t.status)).length}{' '}
                <span className="text-xs font-normal text-sky-600/70 dark:text-sky-400/70">Unit</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('READY_FOR_PICKUP')}
              className={`text-left rounded-xl p-3.5 border transition-all cursor-pointer ${
                statusFilter === 'READY_FOR_PICKUP'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-500 shadow-xs ring-1 ring-emerald-500/20'
                  : 'bg-white dark:bg-[#111827]/80 border-slate-200 dark:border-[#1F2937] hover:border-emerald-400 dark:hover:border-emerald-700'
              }`}
            >
              <div className="flex items-center justify-between text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span>Siap Diambil</span>
                <span className="text-[10px]">Filter</span>
              </div>
              <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                {tickets.filter((t) => t.status === 'READY_FOR_PICKUP').length}{' '}
                <span className="text-xs font-normal text-emerald-600/70 dark:text-emerald-400/70">Unit</span>
              </div>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Daftar Tiket & Filter (Kiri - 7 Kolom) */}
            <div className="lg:col-span-7 rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] overflow-hidden shadow-xs">
              <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 space-y-3.5">
                {/* Baris Judul & Pencarian & Toggle Kategori Perangkat */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Antrean Unit Servis
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Menampilkan {filteredTickets.length} dari {tickets.length} unit terdaftar
                    </p>
                  </div>

                  {/* Toggle Kategori Perangkat: Semua | Laptop | Smartphone */}
                  <div className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 shrink-0 text-xs">
                    <button
                      type="button"
                      onClick={() => setDeviceCategoryFilter('ALL')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        deviceCategoryFilter === 'ALL'
                          ? 'bg-white dark:bg-[#1F2937] text-slate-900 dark:text-white shadow-2xs font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceCategoryFilter('LAPTOP')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        deviceCategoryFilter === 'LAPTOP'
                          ? 'bg-white dark:bg-[#1F2937] text-[#0284C7] dark:text-[#00F0FF] shadow-2xs font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Laptop
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceCategoryFilter('SMARTPHONE')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                        deviceCategoryFilter === 'SMARTPHONE'
                          ? 'bg-white dark:bg-[#1F2937] text-[#0284C7] dark:text-[#00F0FF] shadow-2xs font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      Smartphone
                    </button>
                  </div>
                </div>

                {/* Kolom Pencarian */}
                <div className="relative w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nomor invoice, nama pelanggan, tipe perangkat, nomor WA..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0284C7] dark:focus:ring-[#00F0FF]"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Filter Status Servis: Flex-Wrap agar tidak pernah terpotong */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ALL')}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer ${
                      statusFilter === 'ALL'
                        ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 font-semibold shadow-2xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    Semua ({tickets.length})
                  </button>
                  {ALL_STATUSES.map((st) => {
                    const count = tickets.filter((t) => t.status === st).length;
                    const isSelected = statusFilter === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 font-semibold shadow-2xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {STATUS_CLEAN_LABELS[st]} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* TAMPILAN 1: MOBILE CARD LIST (< 1024px) */}
              <div className="block lg:hidden divide-y divide-slate-200 dark:divide-slate-800">
                {filteredTickets.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Tidak ada unit servis yang sesuai dengan filter atau kata kunci.
                  </div>
                ) : (
                  filteredTickets.map((t) => {
                    const isSelected = selectedTicket?.id === t.id;
                    const daysAgoNum = getDaysAgoNumber(t.created_at);
                    const daysAgoText = getDaysAgo(t.created_at);
                    const isOverdue = daysAgoNum >= 5 && !['COMPLETED', 'PICKED_UP', 'CANCELLED'].includes(t.status);

                    return (
                      <div
                        key={t.id}
                        onClick={() => handleSelectTicket(t)}
                        className={`p-4 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-sky-50/90 dark:bg-[#00F0FF]/10 border-l-4 border-[#0284C7] dark:border-[#00F0FF]'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                                {t.invoice_number}
                              </span>
                              {/* Badge Lama Menginap */}
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  isOverdue
                                    ? 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 ring-1 ring-red-500/30'
                                    : daysAgoNum >= 3
                                      ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                }`}
                              >
                                {daysAgoText}
                              </span>
                            </div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1">
                              {t.device_brand_model}
                            </div>
                            <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                              {t.customer.full_name} ·{' '}
                              {hasTicketWhatsApp(t)
                                ? `WA: ${t.customer.whatsapp_number}`
                                : `PIN Lacak: ${t.customer.whatsapp_last4}`}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                              {t.status === 'CANCELLED'
                                ? formatIDR(0)
                                : formatIDR(t.final_price > 0 ? t.final_price : t.estimated_cost)}
                            </div>
                            <span
                              className={`inline-block mt-1 text-xs font-semibold ${
                                t.status === 'CANCELLED'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-[#0284C7] dark:text-[#00F0FF]'
                              }`}
                            >
                              {STATUS_CLEAN_LABELS[t.status]}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 text-xs">
                          {/* Badge Status Persetujuan Biaya */}
                          {t.status === 'CANCELLED' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400 text-[11px]">
                              <span>✖ Servis Dibatalkan</span>
                            </span>
                          ) : t.customer_approved ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 text-[11px]">
                              <span>✔ Biaya Disetujui</span>
                            </span>
                          ) : t.status === 'WAITING_APPROVAL' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400 text-[11px]">
                              <span>⏳ Menunggu ACC</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">Belum Konfirmasi</span>
                          )}

                          <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setPrintTicket(t)}
                              className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs cursor-pointer"
                              title="Cetak Nota"
                            >
                              Nota
                            </button>
                            {hasTicketWhatsApp(t) ? (
                              <button
                                type="button"
                                onClick={() => handleManualWaTrigger(t)}
                                className="px-2 py-1 rounded bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 text-xs font-medium cursor-pointer"
                                title="Kirim WA"
                              >
                                WA
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-600 text-xs font-medium cursor-not-allowed opacity-60"
                                title="Nomor WA tidak tersedia"
                              >
                                WA
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setTicketToDelete(t)}
                              className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 transition-colors cursor-pointer"
                              title="Hapus Nota Permanen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectTicket(t)}
                              className="px-2.5 py-1 rounded bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 text-xs font-semibold cursor-pointer"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* TAMPILAN 2: DESKTOP TABLE VIEW (>= 1024px) */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0B0F19]/50">
                      <th className="py-3 px-4">Invoice & Pelanggan</th>
                      <th className="py-3 px-3">Perangkat</th>
                      <th className="py-3 px-3">Status & ACC</th>
                      <th className="py-3 px-3 text-right">Biaya Servis</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs">
                    {filteredTickets.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          Tidak ada unit servis yang sesuai dengan filter atau kata kunci.
                        </td>
                      </tr>
                    ) : (
                      filteredTickets.map((t) => {
                        const isSelected = selectedTicket?.id === t.id;
                        const daysAgoNum = getDaysAgoNumber(t.created_at);
                        const daysAgoText = getDaysAgo(t.created_at);
                        const isOverdue = daysAgoNum >= 5 && !['COMPLETED', 'PICKED_UP', 'CANCELLED'].includes(t.status);

                        return (
                          <tr
                            key={t.id}
                            onClick={() => handleSelectTicket(t)}
                            className={`cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-sky-50/90 dark:bg-[#00F0FF]/10 ring-1 ring-inset ring-[#0284C7]/30 dark:ring-[#00F0FF]/30'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <td className="py-3 px-4 align-top">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                                  {t.invoice_number}
                                </span>
                                {/* Badge Lama Menginap */}
                                <span
                                  className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                                    isOverdue
                                      ? 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 ring-1 ring-red-500/30'
                                      : daysAgoNum >= 3
                                        ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                  }`}
                                  title={`Diterima: ${formatDateTimeID(t.created_at)}`}
                                >
                                  {daysAgoText}
                                </span>
                              </div>
                              <div className="text-slate-700 dark:text-slate-300 font-medium mt-0.5">
                                {t.customer.full_name}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                {hasTicketWhatsApp(t)
                                  ? `WA: ${t.customer.whatsapp_number}`
                                  : `PIN Lacak: ${t.customer.whatsapp_last4}`}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {t.device_brand_model}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {t.device_category}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top">
                              <span
                                className={`font-semibold ${
                                  t.status === 'CANCELLED'
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-[#0284C7] dark:text-[#00F0FF]'
                                }`}
                              >
                                {STATUS_CLEAN_LABELS[t.status]}
                              </span>
                              <div className="mt-1">
                                {t.status === 'CANCELLED' ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400 text-[11px]">
                                    ✖ Batal Servis
                                  </span>
                                ) : t.customer_approved ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 text-[11px]">
                                    ✔ Biaya Disetujui
                                  </span>
                                ) : t.status === 'WAITING_APPROVAL' ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400 text-[11px]">
                                    ⏳ Menunggu ACC
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">
                                    Belum Konfirmasi
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-3 align-top text-right font-mono tabular-nums">
                              <div className="font-bold text-slate-900 dark:text-white">
                                {t.status === 'CANCELLED'
                                  ? formatIDR(0)
                                  : formatIDR(t.final_price > 0 ? t.final_price : t.estimated_cost)}
                              </div>
                            </td>

                            <td
                              className="py-3 px-4 align-top text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setPrintTicket(t)}
                                  className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                  title="Cetak Nota"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                </button>
                                {hasTicketWhatsApp(t) ? (
                                  <button
                                    type="button"
                                    onClick={() => handleManualWaTrigger(t)}
                                    className="p-1.5 rounded-md bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600/25 transition-colors cursor-pointer"
                                    title="Kirim WA"
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-60"
                                    title="Nomor WA tidak tersedia"
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setTicketToDelete(t)}
                                  className="p-1.5 rounded-md bg-red-500/10 dark:bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/20 dark:hover:bg-red-500/25 transition-colors cursor-pointer"
                                  title="Hapus Nota Permanen"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panel Detail & Edit Servis (Kanan - 5 Kolom Sticky Desktop / Mobile Target) */}
            {selectedTicket ? (
              <form
                key={selectedTicket.id}
                ref={detailPanelRef}
                onSubmit={handleUpdateTicket}
                className="lg:col-span-5 rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-5 sm:p-6 space-y-4 lg:sticky lg:top-20 shadow-xs ring-1 ring-slate-200/50 dark:ring-slate-800"
              >
                {/* Mobile Back-To-Queue Button */}
                <div className="flex lg:hidden items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-semibold text-slate-500">Edit Servis Perangkat</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs text-[#0284C7] dark:text-[#00F0FF] font-semibold cursor-pointer"
                  >
                    <span>↑ Kembali ke Daftar Antrean</span>
                  </button>
                </div>

                <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-[#0284C7] dark:text-[#00F0FF] font-semibold">
                        {selectedTicket.invoice_number}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {getDaysAgo(selectedTicket.created_at)}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                      {selectedTicket.device_brand_model}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedTicket.customer.full_name} (
                      {hasTicketWhatsApp(selectedTicket)
                        ? selectedTicket.customer.whatsapp_number
                        : `PIN Lacak: ${selectedTicket.customer.whatsapp_last4}`}
                      )
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPrintTicket(selectedTicket)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Cetak Nota"
                    >
                      <Printer className="w-3 h-3" />
                      <span>Nota</span>
                    </button>
                    {hasTicketWhatsApp(selectedTicket) ? (
                      <button
                        type="button"
                        onClick={() => handleManualWaTrigger(selectedTicket)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors cursor-pointer"
                        title="Kirim WA"
                      >
                        <Send className="w-3 h-3" />
                        <span>Kirim WA</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-70"
                        title="Nomor WA tidak tersedia"
                      >
                        <Send className="w-3 h-3" />
                        <span>Kirim WA</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* INFO PERMANEN BUKTI SERAH TERIMA JIKA SUDAH BERSTATUS SELESAI & DIAMBIL */}
                {selectedTicket.status === 'PICKED_UP' && (
                  <div className="p-3.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800/70 space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Bukti Serah Terima Tercatat</span>
                      </span>
                      <span className="font-mono font-normal text-[10px]">
                        {formatDateTimeID(selectedTicket.picked_up_at || selectedTicket.updated_at)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-900 dark:text-slate-100 font-semibold leading-relaxed">
                      Barang Diambil Oleh:{' '}
                      <span className="text-emerald-700 dark:text-emerald-300">
                        {selectedTicket.pickup_by || selectedTicket.customer.full_name}
                      </span>{' '}
                      - {selectedTicket.pickup_notes || 'Diambil langsung di counter'}
                    </div>
                  </div>
                )}

                {/* Box PIN / Pola Perangkat - Bersih Tanpa Cipher String */}
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF]" />
                      <span>PIN / Pola Perangkat:</span>
                    </span>
                    {selectedTicket.passcode_decrypted && (
                      <button
                        type="button"
                        onClick={() => setShowPasscode(!showPasscode)}
                        className="inline-flex items-center gap-1 text-xs text-[#0284C7] dark:text-[#00F0FF] hover:underline cursor-pointer"
                      >
                        {showPasscode ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Sembunyikan</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Lihat PIN</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {selectedTicket.status === 'PICKED_UP' ? (
                    <div className="text-xs text-slate-500">
                      Telah dihapus otomatis saat unit diambil
                    </div>
                  ) : selectedTicket.passcode_decrypted ? (
                    <div className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                      {showPasscode ? selectedTicket.passcode_decrypted : '••••••••'}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">Tidak ada PIN dicatat</div>
                  )}
                </div>

                {/* Ubah Status Pengerjaan (Sinkron dengan Unit Terpilih) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Status Pengerjaan Saat Ini
                    </label>
                    <span
                      className={`text-[11px] font-semibold ${
                        selectedTicket.status === 'CANCELLED'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-[#0284C7] dark:text-[#00F0FF]'
                      }`}
                    >
                      {STATUS_CLEAN_LABELS[selectedTicket.status]}
                    </span>
                  </div>
                  <select
                    value={editStatus}
                    onChange={(e) => {
                      const nextStatus = e.target.value as TicketStatus;
                      setEditStatus(nextStatus);
                      if (nextStatus === 'PICKED_UP') {
                        if (!editPickupBy.trim()) {
                          setEditPickupBy(selectedTicket.customer.full_name || '');
                        }
                      } else if (nextStatus === 'CANCELLED') {
                        setEditEstimatedCost(0);
                        setEditFinalPrice(0);
                        setEditPartsModal(0);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#0284C7] dark:focus:ring-[#00F0FF]"
                  >
                    {ALL_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st === 'CANCELLED' ? 'Dibatalkan / Batal Servis' : STATUS_CLEAN_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* KOTAK FORM BUKTI PENGAMBILAN (MUNCUL OTOMATIS JIKA STATUS = SELESAI & DIAMBIL) */}
                {editStatus === 'PICKED_UP' && (
                  <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-300 dark:border-emerald-800/70 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Bukti Pengambilan (Serah Terima Barang)</span>
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-200/80 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200">
                        Wajib Diisi
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-emerald-950 dark:text-emerald-200 mb-1">
                        Nama Pengambil *
                      </label>
                      <input
                        type="text"
                        required={editStatus === 'PICKED_UP'}
                        value={editPickupBy}
                        onChange={(e) => setEditPickupBy(e.target.value)}
                        placeholder="Nama orang yang mengambil unit..."
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#0B0F19] border border-emerald-300 dark:border-emerald-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-emerald-950 dark:text-emerald-200 mb-1">
                        Keterangan / Hubungan *
                      </label>
                      <input
                        type="text"
                        required={editStatus === 'PICKED_UP'}
                        value={editPickupNotes}
                        onChange={(e) => setEditPickupNotes(e.target.value)}
                        placeholder="Contoh: Diambil sendiri, Diambil suami (bawa nota asli), Kurir Gojek Nopol G 1234 AB..."
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-[#0B0F19] border border-emerald-300 dark:border-emerald-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                )}

                {/* Diagnosa / Keterangan Pelanggan */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Hasil Diagnosa / Keterangan Pelanggan
                  </label>
                  <textarea
                    rows={2}
                    value={editPublicDiagnosis}
                    onChange={(e) => setEditPublicDiagnosis(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 custom-scrollbar focus:outline-none focus:ring-1 focus:ring-[#0284C7]"
                    placeholder="Penjelasan kerusakan dan perbaikan yang dapat dilihat pelanggan..."
                  />
                </div>

                {/* Catatan Internal Teknisi & Modal */}
                <div className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Catatan Internal Teknisi & Modal</span>
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                      Internal
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-amber-950 dark:text-amber-200 mb-1">
                      Catatan Teknisi
                    </label>
                    <textarea
                      rows={2}
                      value={editSecretNotes}
                      onChange={(e) => setEditSecretNotes(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-[#0B0F19] border border-amber-300 dark:border-amber-800/80 text-slate-900 dark:text-slate-100 custom-scrollbar focus:outline-none focus:ring-1 focus:ring-amber-500"
                      placeholder="Jalur jumper, skema board, supplier part..."
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="flex flex-col justify-end h-full">
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1 whitespace-nowrap truncate">
                        Estimasi (Rp)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={editEstimatedCost}
                        onChange={(e) => setEditEstimatedCost(Number(e.target.value))}
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-col justify-end h-full">
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1 whitespace-nowrap truncate">
                        Harga Final (Rp)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={editFinalPrice}
                        onChange={(e) => setEditFinalPrice(Number(e.target.value))}
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-col justify-end h-full">
                      <label className="block text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1 whitespace-nowrap truncate">
                        Modal Part (Rp)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={editPartsModal}
                        onChange={(e) => setEditPartsModal(Number(e.target.value))}
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-[#0B0F19] border border-amber-400 dark:border-amber-700 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="flex flex-col justify-end h-full">
                      <label className="block text-[11px] font-semibold text-[#0284C7] dark:text-[#00F0FF] mb-1 whitespace-nowrap truncate">
                        Garansi (Hari)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={editWarrantyDays}
                        onChange={(e) =>
                          setEditWarrantyDays(
                            e.target.value === ''
                              ? 0
                              : Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0))
                          )
                        }
                        className="w-full px-2 py-1 text-xs font-mono tabular-nums rounded-lg bg-white dark:bg-[#0B0F19] border border-[#0284C7]/60 dark:border-[#00F0FF]/60 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs font-mono tabular-nums">
                    <span className="text-slate-600 dark:text-slate-400">
                      Laba Bersih Tiket:
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">
                      {formatIDR(
                        (editFinalPrice > 0 ? editFinalPrice : editEstimatedCost) - editPartsModal
                      )}
                    </span>
                  </div>
                </div>

                {/* Tambah Catatan Progres & Foto Bukti */}
                <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Catatan Progres Baru (Opsional)
                    </label>
                    <input
                      type="text"
                      value={editLogDescription}
                      onChange={(e) => setEditLogDescription(e.target.value)}
                      placeholder="Contoh: Selesai penggantian sparepart, lanjut pengujian..."
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 cursor-pointer">
                      <Camera className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF]" />
                      <span>Lampirkan Foto</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUploadChange}
                        className="hidden"
                      />
                    </label>
                    {editPhotoDataUrl && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        Foto siap dilampirkan
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingTicket}
                  className="w-full py-2.5 px-4 text-xs sm:text-sm font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer shadow-xs"
                >
                  {savingTicket ? 'Menyimpan...' : 'Simpan Perubahan & Update'}
                </button>
              </form>
            ) : (
              <div className="lg:col-span-5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-xs text-slate-500">
                Pilih salah satu nota servis dari daftar di sebelah kiri untuk melihat detail atau mengubah status.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB 2: FORM INPUT SERVISAN BARU
         ==================================================================== */}
      {activeSubTab === 'new_ticket' && (
        <form
          onSubmit={handleCreateTicket}
          className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-6 sm:p-8 space-y-6"
        >
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Input Servisan Baru
            </h2>

            {/* Pilihan Jenis Servis */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'REGULAR', label: 'Servis Reguler' },
                  { id: 'WARRANTY_CLAIM', label: 'Klaim Garansi / Retur' },
                  { id: 'PRIORITY', label: 'Prioritas (Express)' },
                ] as { id: ServiceType; label: string }[]
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    const prevType = newServiceType;
                    setNewServiceType(st.id);
                    if (st.id === 'WARRANTY_CLAIM') {
                      setNewEstimatedCost('');
                      setNewDownPayment('');
                    } else if (prevType === 'WARRANTY_CLAIM') {
                      // Reset kembali ke input teks biasa saat pindah ke Servis Reguler / Prioritas
                      setSelectedWarrantyTicketId('');
                      setNewDeviceBrandModel('');
                      setNewSerialNumber('');
                      setNewEstimatedCost('');
                      setNewWarrantyDays(30);
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    newServiceType === st.id
                      ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 border-[#0284C7] dark:border-[#00F0FF]'
                      : 'bg-slate-50 dark:bg-[#0B0F19] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 01. DATA PELANGGAN & PERANGKAT */}
            <div className="space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                01. DATA PELANGGAN & PERANGKAT
              </div>

              {/* Input Nama Lengkap Pelanggan + Auto-Suggestion Dropdown */}
              <div className="relative">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nama Lengkap Pelanggan *
                </label>
                <input
                  type="text"
                  required
                  value={newCustomerName}
                  onFocus={() => setShowNameSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowNameSuggestions(false), 180)}
                  onChange={(e) => {
                    setNewCustomerName(e.target.value);
                    setShowNameSuggestions(true);
                  }}
                  placeholder="Ketik nama pelanggan baru atau cari pelanggan lama..."
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
                {showNameSuggestions &&
                  (() => {
                    const q = newCustomerName.trim().toLowerCase();
                    const matches = uniqueCustomerDirectory
                      .filter((c) => {
                        if (!q) return true;
                        return (
                          c.full_name.toLowerCase().includes(q) ||
                          c.whatsapp_number.includes(q)
                        );
                      })
                      .slice(0, 6);

                    if (matches.length === 0) return null;

                    return (
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                        <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#0B0F19] text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Saran Data Pelanggan Terdaftar (Klik untuk Auto-Fill)
                        </div>
                        {matches.map((cust) => (
                          <button
                            key={cust.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectCustomerSuggestion(cust);
                            }}
                            className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-sky-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer flex items-center justify-between gap-2"
                          >
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {cust.full_name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                                {cust.whatsapp_number !== '-'
                                  ? `WA: ${cust.whatsapp_number}`
                                  : `PIN: ${cust.whatsapp_last4}`}
                                {cust.address ? ` · ${cust.address}` : ''}
                              </div>
                            </div>
                            {cust.activeWarrantyCount > 0 && (
                              <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 shrink-0">
                                Garansi Aktif ({cust.activeWarrantyCount})
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Input Nomor WhatsApp + Auto-Suggestion Dropdown */}
                <div className="sm:col-span-2 relative">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nomor WhatsApp <span className="text-slate-400 font-normal">(Opsional)</span>
                  </label>
                  <input
                    type="text"
                    value={newWaNumber}
                    onFocus={() => setShowWaSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowWaSuggestions(false), 180)}
                    onChange={(e) => {
                      handleWaNumberChange(e.target.value);
                      setShowWaSuggestions(true);
                    }}
                    placeholder="Contoh: 081234568821 (Kosongkan jika tidak ada WA)"
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                  {showWaSuggestions &&
                    newWaNumber.trim().length >= 2 &&
                    (() => {
                      const rawQ = newWaNumber.trim().toLowerCase();
                      const digitQ = newWaNumber.replace(/\D/g, '');
                      const matches = uniqueCustomerDirectory
                        .filter((c) => {
                          const cDigits = (c.whatsapp_number || '').replace(/\D/g, '');
                          return (
                            (digitQ.length >= 2 && cDigits.includes(digitQ)) ||
                            c.full_name.toLowerCase().includes(rawQ) ||
                            c.whatsapp_last4.includes(digitQ)
                          );
                        })
                        .slice(0, 5);

                      if (matches.length === 0) return null;

                      return (
                        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                          <div className="px-3 py-1.5 bg-slate-50 dark:bg-[#0B0F19] text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Saran Nomor WA Pelanggan
                          </div>
                          {matches.map((cust) => (
                            <button
                              key={cust.id}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectCustomerSuggestion(cust);
                              }}
                              className="w-full text-left px-3.5 py-2 text-xs hover:bg-sky-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer flex items-center justify-between gap-2"
                            >
                              <div>
                                <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                  {cust.whatsapp_number} · {cust.full_name}
                                </div>
                                {cust.address && (
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {cust.address}
                                  </div>
                                )}
                              </div>
                              {cust.activeWarrantyCount > 0 && (
                                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 shrink-0">
                                  Garansi Aktif
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    PIN Lacak (4 Digit) *
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      required
                      maxLength={4}
                      pattern="\d{4}"
                      value={newTrackingPin}
                      onChange={(e) =>
                        setNewTrackingPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      placeholder="4829"
                      className="w-full px-3 py-2 text-sm font-bold font-mono tabular-nums text-center tracking-widest rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-[#0284C7] dark:text-[#00F0FF]"
                    />
                    <button
                      type="button"
                      onClick={regenerateRandomPin}
                      title="Acak ulang 4 digit PIN Lacak"
                      className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F19] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Alamat
                </label>
                <input
                  type="text"
                  value={newCustomerAddress}
                  onChange={(e) => setNewCustomerAddress(e.target.value)}
                  placeholder="Contoh: Jl. Soekarno Hatta No. 48, Malang"
                  className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Kategori Unit
                  </label>
                  <select
                    value={newDeviceCategory}
                    disabled={
                      newServiceType === 'WARRANTY_CLAIM' && eligibleWarrantyTickets.length === 0
                    }
                    onChange={(e) => setNewDeviceCategory(e.target.value as DeviceCategory)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="LAPTOP">LAPTOP</option>
                    <option value="SMARTPHONE">SMARTPHONE</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Merk & Tipe Model Unit *
                  </label>
                  {newServiceType === 'WARRANTY_CLAIM' ? (
                    eligibleWarrantyTickets.length > 0 ? (
                      <select
                        required
                        value={selectedWarrantyTicketId}
                        onChange={(e) => {
                          const chosenId = e.target.value;
                          setSelectedWarrantyTicketId(chosenId);
                          const found = eligibleWarrantyTickets.find(
                            (item) => item.ticket.id === chosenId
                          );
                          if (found) {
                            setNewDeviceCategory(found.ticket.device_category);
                            setNewDeviceBrandModel(found.ticket.device_brand_model);
                            setNewSerialNumber(found.ticket.serial_number_imei || '');
                            setNewWarrantyDays(found.remainingDays);
                          }
                        }}
                        className="w-full px-3.5 py-2 text-sm font-medium rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-400 dark:border-emerald-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        {eligibleWarrantyTickets.map(({ ticket: wt, remainingDays }) => (
                          <option key={wt.id} value={wt.id}>
                            {wt.device_brand_model} - Sisa Garansi: {remainingDays} Hari - Inv Lama:{' '}
                            {wt.invoice_number}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        disabled
                        value=""
                        placeholder="Tidak ada unit bergaransi aktif untuk pelanggan ini"
                        className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-900 border border-red-300 dark:border-red-800/70 text-slate-400 cursor-not-allowed"
                      />
                    )
                  ) : (
                    <input
                      type="text"
                      required
                      value={newDeviceBrandModel}
                      onChange={(e) => setNewDeviceBrandModel(e.target.value)}
                      placeholder="Contoh: MacBook Air M2 13-inch / iPhone 14 Pro"
                      className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  )}
                </div>
              </div>

              {/* Peringatan Merah Jika Mode Klaim Garansi Namun Tidak Ada Unit Bergaransi Aktif */}
              {newServiceType === 'WARRANTY_CLAIM' && eligibleWarrantyTickets.length === 0 && (
                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-red-700 dark:text-red-300">
                  <div className="font-semibold">
                    Tidak ditemukan unit dengan garansi aktif untuk pelanggan ini.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewServiceType('REGULAR');
                      setSelectedWarrantyTicketId('');
                      setNewDeviceBrandModel('');
                      setNewSerialNumber('');
                      setNewEstimatedCost('');
                      setNewWarrantyDays(30);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 font-semibold hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors shrink-0 cursor-pointer"
                  >
                    Ubah ke Servis Reguler
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Serial Number / IMEI
                  </label>
                  <input
                    type="text"
                    value={newSerialNumber}
                    disabled={
                      newServiceType === 'WARRANTY_CLAIM' && eligibleWarrantyTickets.length === 0
                    }
                    onChange={(e) => setNewSerialNumber(e.target.value)}
                    placeholder="S/N atau IMEI"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    PIN / Pola Layar
                  </label>
                  <input
                    type="text"
                    value={newPasscodePlain}
                    onChange={(e) => setNewPasscodePlain(e.target.value)}
                    placeholder="Contoh: 123456 / Pola Z (Kosongkan jika tidak ada)"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>

            {/* 02. KELENGKAPAN, KONDISI FISIK & RINCIAN SERVIS */}
            <div className="space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                02. KELENGKAPAN, KONDISI FISIK & RINCIAN SERVIS
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* Tombol Unit Only (Batangan) */}
                <button
                  type="button"
                  onClick={handleToggleUnitOnly}
                  className={`p-2.5 text-xs font-medium rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    newChkUnitOnly
                      ? 'bg-[#0284C7]/15 dark:bg-[#00F0FF]/15 border-[#0284C7] dark:border-[#00F0FF] text-slate-900 dark:text-white'
                      : 'bg-slate-50 dark:bg-[#0B0F19] border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  <span>Unit Only (Batangan)</span>
                  {newChkUnitOnly && (
                    <Check className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF] shrink-0" />
                  )}
                </button>

                {/* Tombol Aksesoris (Otomatis mati jika Unit Only aktif) */}
                {[
                  {
                    label: 'Charger / Adaptor',
                    val: newChkCharger,
                    toggle: () => handleToggleAccessory(newChkCharger, setNewChkCharger),
                  },
                  {
                    label: 'Tas / Sleeve',
                    val: newChkTas,
                    toggle: () => handleToggleAccessory(newChkTas, setNewChkTas),
                  },
                  {
                    label: 'SIM Tray / MicroSD',
                    val: newChkSimMemory,
                    toggle: () => handleToggleAccessory(newChkSimMemory, setNewChkSimMemory),
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.toggle}
                    className={`p-2.5 text-xs font-medium rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                      item.val
                        ? 'bg-[#0284C7]/15 dark:bg-[#00F0FF]/15 border-[#0284C7] dark:border-[#00F0FF] text-slate-900 dark:text-white'
                        : 'bg-slate-50 dark:bg-[#0B0F19] border-slate-200 dark:border-slate-800 text-slate-500'
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.val && (
                      <Check className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF] shrink-0" />
                    )}
                  </button>
                ))}

                {/* Kondisi Fisik & Mati Total */}
                {[
                  { label: 'Layar Baret', val: newChkLayarBaret, set: setNewChkLayarBaret },
                  {
                    label: 'Casing Lecet / Dent',
                    val: newChkCasingLecet,
                    set: setNewChkCasingLecet,
                  },
                  {
                    label: 'Mati Total (Fungsi Belum Teruji)',
                    val: newChkMatiTotal,
                    set: setNewChkMatiTotal,
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => item.set(!item.val)}
                    className={`p-2.5 text-xs font-medium rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                      item.val
                        ? 'bg-[#0284C7]/15 dark:bg-[#00F0FF]/15 border-[#0284C7] dark:border-[#00F0FF] text-slate-900 dark:text-white'
                        : 'bg-slate-50 dark:bg-[#0B0F19] border-slate-200 dark:border-slate-800 text-slate-500'
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.val && (
                      <Check className="w-3.5 h-3.5 text-[#0284C7] dark:text-[#00F0FF] shrink-0" />
                    )}
                  </button>
                ))}

                <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-600 dark:text-slate-400">Baut Kurang:</span>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={newChkBautKurang}
                    onChange={(e) => setNewChkBautKurang(Number(e.target.value))}
                    className="w-14 px-2 py-0.5 text-xs font-mono text-right rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              {/* Input Spesifikasi & Catatan Fisik (RAM / SSD / HDD / Detail Kondisi) */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Spesifikasi & Catatan Fisik (RAM / SSD / HDD / Detail Kondisi)
                </label>
                <input
                  type="text"
                  value={newHardwareSpecs}
                  onChange={(e) => setNewHardwareSpecs(e.target.value)}
                  placeholder="Contoh: RAM 8GB DDR4, SSD 256GB NVMe, HDD 1TB, engsel kiri agak berat..."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Opsi Checkbox: Bawa Sparepart Sendiri (Hanya Jasa Pasang) */}
              <div
                className={`p-3.5 rounded-xl border transition-all ${
                  newCustomerOwnParts
                    ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-400 dark:border-amber-700'
                    : 'bg-slate-50 dark:bg-[#0B0F19] border-slate-200 dark:border-slate-800'
                }`}
              >
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newCustomerOwnParts}
                    onChange={(e) => handleToggleCustomerOwnParts(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-[#0284C7] dark:accent-[#00F0FF] rounded cursor-pointer shrink-0"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Bawa Sparepart Sendiri (Hanya Jasa Pasang)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Otomatis mengunci Modal Part ke Rp 0, mengatur Garansi 0 Hari, dan menyertakan
                      catatan pelepasan tanggung jawab part pada nota.
                    </div>
                    {newCustomerOwnParts && (
                      <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-200/70 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[11px] font-semibold">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span>Garansi part gugur, hanya garansi jasa/pemasangan</span>
                      </div>
                    )}
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Keluhan Awal Pelanggan *
                </label>
                <textarea
                  rows={2}
                  required
                  value={newInitialComplaint}
                  onChange={(e) => setNewInitialComplaint(e.target.value)}
                  placeholder="Contoh: Layar berkedip saat suhu panas, baterai drop..."
                  className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                  Catatan Internal Teknisi
                </label>
                <input
                  type="text"
                  value={newSecretNotes}
                  onChange={(e) => setNewSecretNotes(e.target.value)}
                  placeholder="Jalur skema motherboard / toko sparepart..."
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-amber-50/40 dark:bg-[#0B0F19] border border-amber-300 dark:border-amber-800/70 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col justify-end h-full">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 whitespace-nowrap truncate">
                    Estimasi Biaya (Rp)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Contoh: 350.000"
                    value={formatThousandSeparator(newEstimatedCost)}
                    onChange={(e) => setNewEstimatedCost(parseCurrencyInput(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                </div>
                <div className="flex flex-col justify-end h-full">
                  <label className="block text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1 whitespace-nowrap truncate">
                    Uang Muka / DP (Rp)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Contoh: 50.000"
                    value={formatThousandSeparator(newDownPayment)}
                    onChange={(e) => setNewDownPayment(parseCurrencyInput(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-emerald-300 dark:border-emerald-800/70 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  />
                </div>
                <div className="flex flex-col justify-end h-full">
                  <label className="block text-xs font-medium text-amber-700 dark:text-amber-400 mb-1 whitespace-nowrap truncate">
                    Modal Part (Rp) {newCustomerOwnParts && <span className="text-[10px]">(Terkunci)</span>}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Contoh: 80.000"
                    disabled={newCustomerOwnParts}
                    value={newCustomerOwnParts ? '0' : formatThousandSeparator(newPartsModal)}
                    onChange={(e) => setNewPartsModal(parseCurrencyInput(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-amber-300 dark:border-amber-800/70 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-slate-200/70 dark:disabled:bg-slate-900"
                  />
                </div>
                <div className="flex flex-col justify-end h-full">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1 whitespace-nowrap truncate">
                    Garansi (Hari)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={newWarrantyDays}
                    onChange={(e) =>
                      setNewWarrantyDays(
                        e.target.value === ''
                          ? 0
                          : Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0))
                      )
                    }
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 03. STATUS AWAL SERVISAN (3 RADIO CARDS INTERAKTIF) */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Status Awal Servisan
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  {
                    value: 'RECEIVED',
                    title: 'Unit Diterima',
                    desc: 'Masuk antrean pengecekan. Belum ada persetujuan biaya.',
                  },
                  {
                    value: 'IN_PROGRESS',
                    title: 'Langsung Dikerjakan',
                    desc: 'Pelanggan sudah setuju biaya di awal. Langsung eksekusi.',
                  },
                  {
                    value: 'PICKED_UP',
                    title: 'Langsung Selesai',
                    desc: 'Servis ringan / bisa ditunggu. Barang langsung diambil.',
                  },
                ] as const
              ).map((opt) => {
                const isSelected = newInitialStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setNewInitialStatus(opt.value)}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between gap-2.5 ${
                      isSelected
                        ? 'bg-[#0284C7]/10 dark:bg-[#00F0FF]/15 border-[#0284C7] dark:border-[#00F0FF] shadow-2xs ring-1 ring-[#0284C7]/20 dark:ring-[#00F0FF]/20'
                        : 'bg-slate-50 dark:bg-[#0B0F19] border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                        {opt.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {opt.desc}
                      </div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'border-[#0284C7] dark:border-[#00F0FF] bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              {newServiceType === 'WARRANTY_CLAIM' && eligibleWarrantyTickets.length === 0 && (
                <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                  Tidak ditemukan unit dengan garansi aktif untuk pelanggan ini.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveSubTab('tickets')}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={
                  creatingTicket ||
                  (newServiceType === 'WARRANTY_CLAIM' && eligibleWarrantyTickets.length === 0)
                }
                className="px-6 py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
              >
                {creatingTicket
                  ? 'Menyimpan Data Servisan...'
                  : newWaNumber.replace(/\D/g, '').length >= 4
                    ? 'Simpan Servisan & Kirim WA'
                    : 'Simpan Servisan & Cetak Nota'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ====================================================================
          SUB-TAB KAS & KEUANGAN (LAPORAN OMZET, MODAL, DAN LABA BERSIH)
         ==================================================================== */}
      {activeSubTab === 'finance' && (
        <div className="space-y-6">
          {/* 4 Kartu Utama Keuangan */}
          {financialSummary && (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-5 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Total Pendapatan (Gross)</span>
                  <Wallet className="w-4 h-4 text-[#0284C7] dark:text-[#00F0FF]" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1.5">
                  {formatIDR(financialSummary.total_gross_revenue)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
                  Terealisasi: {formatIDR(financialSummary.realized_revenue)}
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-5 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Total Modal Sparepart</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300">
                    Modal
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1.5">
                  {formatIDR(financialSummary.total_parts_modal)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
                  Modal Terealisasi: {formatIDR(financialSummary.realized_modal)}
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-5 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Estimasi Laba Bersih</span>
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
                  {formatIDR(financialSummary.total_net_profit)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-mono tabular-nums">
                  Laba Terealisasi: {formatIDR(financialSummary.realized_net_profit)}
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-5 shadow-xs">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>Margin Keuntungan</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-300">
                    Margin
                  </span>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-[#0284C7] dark:text-[#00F0FF] mt-1.5">
                  {financialSummary.total_gross_revenue > 0
                    ? Math.round((financialSummary.total_net_profit / financialSummary.total_gross_revenue) * 100)
                    : 0}%
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Dari total {financialSummary.total_tickets} unit servis tercatat
                </div>
              </div>
            </section>
          )}

          {/* Rincian Pemasukan & Modal Per Nota */}
          <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] overflow-hidden shadow-xs">
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Rincian Keuangan Per Nota Servis
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Catatan nilai servis, modal sparepart, laba bersih, dan status realisasi kas toko.
                </p>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                {tickets.length} Nota Tercatat
              </div>
            </div>

            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0B0F19]/50">
                    <th className="py-3 px-4">No. Invoice & Tanggal</th>
                    <th className="py-3 px-3">Pelanggan & Perangkat</th>
                    <th className="py-3 px-3 text-right">Tarif Servis</th>
                    <th className="py-3 px-3 text-right">Modal Part</th>
                    <th className="py-3 px-3 text-right">Laba Bersih</th>
                    <th className="py-3 px-4 text-center">Status Kas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 font-mono">
                  {tickets.map((t) => {
                    const isCancelled = t.status === 'CANCELLED';
                    const price = isCancelled
                      ? 0
                      : t.final_price > 0
                        ? t.final_price
                        : t.estimated_cost;
                    const modal = isCancelled ? 0 : t.parts_cost_modal || 0;
                    const profit = isCancelled ? 0 : t.net_profit ?? price - modal;
                    const isRealized = ['READY_FOR_PICKUP', 'PICKED_UP'].includes(t.status);

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-900 dark:text-white">{t.invoice_number}</span>
                          <div className="text-[11px] text-slate-500 font-sans mt-0.5">{formatDateTimeID(t.created_at)}</div>
                        </td>
                        <td className="py-3 px-3 font-sans">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{t.customer.full_name}</div>
                          <div className="text-[11px] text-slate-500">{t.device_brand_model}</div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                          {formatIDR(price)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {formatIDR(modal)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                          {formatIDR(profit)}
                        </td>
                        <td className="py-3 px-4 text-center font-sans">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              isCancelled
                                ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                                : isRealized
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {isCancelled
                              ? 'Dibatalkan'
                              : isRealized
                                ? 'Lunas / Terealisasi'
                                : 'Belum Selesai'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          SUB-TAB PENGATURAN SISTEM (2 KOLOM UTAMA: SIDEBAR 25% KIRI, MAIN CONTENT 75% KANAN)
         ==================================================================== */}
      {activeSubTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* KOLOM KIRI (SIDEBAR 25% / lg:col-span-3): Navigasi Sub-Menu Pengaturan */}
          <aside className="lg:col-span-3 rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-3.5 shadow-xs space-y-1.5 lg:sticky lg:top-20">
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800/80 mb-1">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Pengaturan Sistem
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                Profil toko, WhatsApp, tim, & database
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSettingsSection('profile')}
              className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                settingsSection === 'profile'
                  ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2">
                <Printer className="w-4 h-4 shrink-0" />
                <span>Profil Usaha</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsSection('whatsapp')}
              className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                settingsSection === 'whatsapp'
                  ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2">
                <Send className="w-4 h-4 shrink-0" />
                <span>WhatsApp Gateway</span>
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  settingsSection === 'whatsapp'
                    ? 'bg-white/20 text-white dark:bg-slate-950/20 dark:text-slate-950'
                    : isWablasEnabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {isWablasEnabled ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSettingsSection('team_security');
                fetchTeamMembers();
              }}
              className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                settingsSection === 'team_security'
                  ? 'bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 shadow-2xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4 shrink-0" />
                <span>Manajemen Tim & Keamanan</span>
              </span>
            </button>
          </aside>

          {/* KOLOM KANAN (MAIN CONTENT 75% / lg:col-span-9) */}
          <div className="lg:col-span-9 space-y-6">
            {/* ----------------------------------------------------------------
                SUB-MENU 1: PROFIL USAHA (2 BAGIAN: KIRI FORM, KANAN PRATINJAU STRUK)
               ---------------------------------------------------------------- */}
            {settingsSection === 'profile' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Bagian Kiri: Form Profil Usaha */}
                <form
                  onSubmit={handleSaveStoreProfile}
                  className="lg:col-span-7 rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-6 space-y-4 shadow-xs"
                >
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Profil Usaha & Identitas Nota Servis
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Informasi di bawah ini otomatis ditampilkan pada bagian Header dan Footer saat
                      mencetak struk kasir thermal (58mm/80mm) maupun PDF A4.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nama Toko / Usaha *
                    </label>
                    <input
                      type="text"
                      required
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      placeholder="Contoh: Geektech-Com"
                      className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Slogan Usaha
                    </label>
                    <input
                      type="text"
                      value={storeSlogan}
                      onChange={(e) => setStoreSlogan(e.target.value)}
                      placeholder="Contoh: Spesialis Perbaikan Laptop & Smartphone"
                      className="w-full px-3.5 py-2 text-sm rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Nomor Telepon / WhatsApp Toko
                    </label>
                    <input
                      type="text"
                      value={storePhone}
                      onChange={(e) => setStorePhone(e.target.value)}
                      placeholder="Contoh: 0811-3600-8899"
                      className="w-full px-3.5 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Alamat Toko
                    </label>
                    <textarea
                      rows={3}
                      value={storeAddress}
                      onChange={(e) => setStoreAddress(e.target.value)}
                      placeholder="Contoh: Jl. Soekarno Hatta No. 102, Kec. Lowokwaru, Kota Malang"
                      className="w-full px-3.5 py-2 text-sm leading-relaxed rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Catatan Kaki Nota / Syarat & Ketentuan (Footer Struk)
                    </label>
                    <textarea
                      rows={4}
                      value={receiptFooterNotes}
                      onChange={(e) => setReceiptFooterNotes(e.target.value)}
                      placeholder="Contoh: Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami."
                      className="w-full px-3.5 py-2 text-xs leading-relaxed rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="w-full px-6 py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer shadow-xs"
                    >
                      {savingProfile ? 'Menyimpan Profil...' : 'Simpan Profil'}
                    </button>
                  </div>
                </form>

                {/* Bagian Kanan: Pratinjau Struk Kasir (Live Preview) */}
                <div className="lg:col-span-5 rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-5 space-y-3 shadow-xs lg:sticky lg:top-20">
                  <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Pratinjau Struk
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Thermal / PDF A5
                    </span>
                  </div>

                  <div className="p-4 rounded-lg bg-white text-slate-950 border border-slate-300 font-mono text-xs space-y-3 shadow-inner">
                    {/* Header Nota Centered */}
                    <div className="text-center border-b border-dashed border-slate-400 pb-3 space-y-0.5">
                      <div className="font-bold text-sm uppercase">
                        {storeName || 'Geektech-Com'}
                      </div>
                      {storeSlogan && (
                        <div className="text-[11px] text-slate-700">{storeSlogan}</div>
                      )}
                      {storeAddress && (
                        <div className="text-[10px] text-slate-600 whitespace-pre-line break-words">
                          {storeAddress}
                        </div>
                      )}
                      {storePhone && (
                        <div className="text-[10px] text-slate-600">WA / Telp: {storePhone}</div>
                      )}
                    </div>

                    {/* Contoh Isi Singkat */}
                    <div className="text-[10px] text-slate-500 text-center py-2 border-b border-dashed border-slate-300">
                      [Rincian Invoice, Unit, Biaya & QR Code]
                    </div>

                    {/* Footer Nota Centered */}
                    <div className="text-center text-[10px] leading-relaxed text-slate-600 space-y-1">
                      <div className="font-bold text-slate-800 uppercase">
                        Syarat & Ketentuan Servis / Garansi
                      </div>
                      <div className="whitespace-pre-line break-words">
                        {receiptFooterNotes ||
                          'Barang yang tidak diambil lebih dari 30 hari di luar tanggung jawab kami.'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------------
                SUB-MENU 2: WHATSAPP GATEWAY (WABLAS)
               ---------------------------------------------------------------- */}
            {settingsSection === 'whatsapp' && (
              <form
                onSubmit={handleSaveWablasSettings}
                className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-6 space-y-4 shadow-xs max-w-2xl"
              >
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Pengaturan WhatsApp Gateway
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Integrasi Wablas API untuk mengirim notifikasi tanda terima dan pembaruan status
                    servis ke pelanggan. Tersedia fallback otomatis ke tautan WhatsApp jika gateway
                    offline.
                  </p>
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Kirim Notifikasi Otomatis via Wablas
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isWablasEnabled
                        ? 'Aktif: Otomatis kirim saat nota dibuat/diupdate'
                        : 'Nonaktif: Menggunakan tautan manual wa.me'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isWablasEnabled}
                    onChange={(e) => setIsWablasEnabled(e.target.checked)}
                    className="w-4 h-4 accent-[#0284C7] dark:accent-[#00F0FF] cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Wablas Server Domain
                  </label>
                  <input
                    type="url"
                    value={wablasDomain}
                    onChange={(e) => setWablasDomain(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Wablas API Key
                  </label>
                  <input
                    type="password"
                    value={wablasApiKey}
                    onChange={(e) => setWablasApiKey(e.target.value)}
                    placeholder="Masukkan API Token Wablas..."
                    className="w-full px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Wablas Secret Key (Opsional)
                  </label>
                  <input
                    type="password"
                    value={wablasSecretKey}
                    onChange={(e) => setWablasSecretKey(e.target.value)}
                    placeholder="Masukkan Secret Key Wablas jika ada..."
                    className="w-full px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingWablas}
                    className="px-6 py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer"
                  >
                    {savingWablas ? 'Menyimpan...' : 'Simpan Pengaturan WhatsApp'}
                  </button>
                </div>
              </form>
            )}

            {/* ----------------------------------------------------------------
                SUB-MENU 3: MANAJEMEN TIM & KEAMANAN (DAFTAR AKUN PETUGAS + BACKUP & RESTORE DB)
               ---------------------------------------------------------------- */}
            {settingsSection === 'team_security' && (
              <div className="space-y-6">
                {/* Header Manajemen Tim & Tombol Tambah Anggota */}
                <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Manajemen Akun & Keamanan Sistem</span>
                    </div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      Manajemen Tim & Hak Akses
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                      Kelola profil akun petugas (Nama Lengkap & Username), ubah kata sandi, dan
                      atur pencadangan (Backup & Restore) database toko.
                    </p>
                  </div>

                  {adminUser.role === 'OWNER' && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewMemberOpen(true);
                        setTeamActionMessage(null);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer shrink-0 shadow-xs"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Tambah Anggota Baru</span>
                    </button>
                  )}
                </div>

                {/* Feedback Notifikasi Aksi Tim */}
                {teamActionMessage && (
                  <div
                    className={`p-4 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-3 ${
                      teamActionMessage.type === 'success'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {teamActionMessage.type === 'success' ? (
                        <Check className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                      )}
                      <span>{teamActionMessage.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTeamActionMessage(null)}
                      className="text-xs underline cursor-pointer shrink-0"
                    >
                      Tutup
                    </button>
                  </div>
                )}

                {/* Tabel Daftar Akun Petugas */}
                <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] overflow-hidden shadow-xs">
                  <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        Daftar Akun Petugas ({teamMembers.length})
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Edit nama lengkap, username, atau ganti password untuk Admin, Teknisi, dan Kasir
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={fetchTeamMembers}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${teamLoading ? 'animate-spin' : ''}`} />
                      <span>Segarkan</span>
                    </button>
                  </div>

                  {teamLoading ? (
                    <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                      Memuat data staf...
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-[#0B0F19] text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-200 dark:border-slate-800 font-medium">
                          <tr>
                            <th className="px-4 py-3">Nama Lengkap & Username</th>
                            <th className="px-4 py-3">Peran (Role)</th>
                            <th className="px-4 py-3">Terdaftar Sejak</th>
                            <th className="px-4 py-3">IP Login Terakhir</th>
                            <th className="px-4 py-3 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {teamMembers.map((member) => {
                            const isSelf = member.id === adminUser.id;
                            const isRootAdmin = member.username === 'admin';
                            const canEditAccount = adminUser.role === 'OWNER' || isSelf;

                            return (
                              <tr
                                key={member.id}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xs uppercase shrink-0 shadow-xs">
                                      {member.full_name
                                        ? member.full_name.charAt(0)
                                        : member.username.charAt(0)}
                                    </div>
                                    <div>
                                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                                        <span>{member.full_name || member.username}</span>
                                        {isSelf && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                                            Anda
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                        @{member.username}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                <td className="px-4 py-3 whitespace-nowrap">
                                  {member.role === 'OWNER' && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                                      <ShieldCheck className="w-3 h-3" />
                                      <span>Owner (Pemilik)</span>
                                    </span>
                                  )}
                                  {member.role === 'TECHNICIAN' && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
                                      <span>Teknisi Servis</span>
                                    </span>
                                  )}
                                  {member.role === 'CASHIER' && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                      <span>Kasir Toko</span>
                                    </span>
                                  )}
                                </td>

                                <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                                  {formatDateTimeID(member.created_at)}
                                </td>

                                <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-400">
                                  {member.last_login_ip || 'Belum ada login'}
                                </td>

                                <td className="px-4 py-3 whitespace-nowrap text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      disabled={!canEditAccount}
                                      onClick={() => {
                                        setEditProfileMember(member);
                                        setEditProfileFullName(member.full_name || member.username);
                                        setEditProfileUsername(member.username);
                                        setTeamActionMessage(null);
                                      }}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                                        canEditAccount
                                          ? 'border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50 cursor-pointer'
                                          : 'border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                                      }`}
                                    >
                                      <Pencil className="w-3 h-3" />
                                      <span>Edit</span>
                                    </button>

                                    <button
                                      type="button"
                                      disabled={!canEditAccount}
                                      onClick={() => {
                                        setChangePasswordMember(member);
                                        setNewPasswordInput('');
                                        setTeamActionMessage(null);
                                      }}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                                        canEditAccount
                                          ? 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
                                          : 'border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                                      }`}
                                    >
                                      <KeyRound className="w-3 h-3" />
                                      <span>Ganti Password</span>
                                    </button>

                                    {adminUser.role === 'OWNER' && (
                                      <button
                                        type="button"
                                        disabled={isSelf || isRootAdmin}
                                        onClick={() => handleDeleteTeamMember(member)}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                                          isSelf || isRootAdmin
                                            ? 'border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                                            : 'border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer'
                                        }`}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>Hapus</span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Panel Backup & Restore Database (Menggantikan Sesi Login Pengguna) */}
                <div className="rounded-xl bg-white dark:bg-[#111827]/80 border border-slate-200 dark:border-[#1F2937] p-6 space-y-5 shadow-xs">
                  <div className="border-b border-slate-200 dark:border-slate-800 pb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#0284C7] dark:text-[#00F0FF] mb-0.5">
                        <Database className="w-4 h-4" />
                        <span>Manajemen Data Lokal & Pemulihan Sistem</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Backup & Restore Database
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Cadangkan seluruh data nota servis, pelanggan, pengaturan toko, dan akun petugas ke
                        dalam file JSON, atau pulihkan data dari cadangan sebelumnya.
                      </p>
                    </div>
                  </div>

                  {backupRestoreMessage && (
                    <div
                      className={`p-4 rounded-xl border text-xs sm:text-sm flex items-center justify-between gap-3 ${
                        backupRestoreMessage.type === 'success'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                          : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {backupRestoreMessage.type === 'success' ? (
                          <Check className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                        )}
                        <span>{backupRestoreMessage.text}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBackupRestoreMessage(null)}
                        className="text-xs underline cursor-pointer shrink-0"
                      >
                        Tutup
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
                    {/* Kotak 1: Export / Backup Database */}
                    <div className="p-5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                          <Download className="w-4 h-4" />
                          <span>Export / Backup Database</span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          Simpan Cadangan Data (.json)
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          Mengunduh seluruh isi tabel database (Data Servis/Tickets, Pelanggan/Customers,
                          Riwayat Pengerjaan, Pengaturan Struk, dan Akun Petugas) ke komputer Anda.
                        </p>
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={handleDownloadBackup}
                          disabled={backupDownloading}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer shadow-xs"
                        >
                          <Download className="w-4 h-4" />
                          <span>
                            {backupDownloading
                              ? 'Menyiapkan File Backup...'
                              : 'Unduh Backup Database'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Kotak 2: Import / Restore Database */}
                    <form
                      onSubmit={handleRestoreDatabase}
                      className="p-5 rounded-xl bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-4"
                    >
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          <Upload className="w-4 h-4" />
                          <span>Import / Restore Database</span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          Pulihkan Data dari File Backup
                        </h4>

                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                          <span>
                            <strong>Peringatan:</strong> Seluruh data lama di sistem saat ini akan
                            tertimpa oleh data dari file backup yang Anda unggah.
                          </span>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Pilih File Backup (.json)
                          </label>
                          <input
                            ref={restoreFileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                            className="w-full text-xs text-slate-700 dark:text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-200 dark:file:bg-slate-800 file:text-slate-800 dark:file:text-slate-200 hover:file:bg-slate-300 dark:hover:file:bg-slate-700 file:cursor-pointer bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded-lg p-1.5"
                          />
                        </div>
                      </div>

                      <div className="pt-1">
                        <button
                          type="submit"
                          disabled={restoringDatabase || !restoreFile}
                          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
                            restoringDatabase || !restoreFile
                              ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                              : 'bg-amber-600 hover:bg-amber-500 text-white cursor-pointer shadow-xs'
                          }`}
                        >
                          <Upload className="w-4 h-4" />
                          <span>
                            {restoringDatabase ? 'Memulihkan Database...' : 'Restore Data'}
                          </span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL TAMBAH ANGGOTA TIM BARU (ROLE OWNER)
         ==================================================================== */}
      {newMemberOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Tambah Akun Staf / Tim Baru
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Buat akun untuk teknisi, kasir, atau mitra pengelola toko.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewMemberOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleCreateTeamMember} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  value={newMemberFullName}
                  onChange={(e) => setNewMemberFullName(e.target.value)}
                  placeholder="Contoh: Rian Hidayat"
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Username Login (Alfanumerik)
                </label>
                <input
                  type="text"
                  value={newMemberUsername}
                  onChange={(e) => setNewMemberUsername(e.target.value)}
                  placeholder="Contoh: rian_tech"
                  required
                  className="w-full px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password Awal (Min. 6 Karakter)
                </label>
                <input
                  type="password"
                  value={newMemberPassword}
                  onChange={(e) => setNewMemberPassword(e.target.value)}
                  placeholder="Masukkan kata sandi aman"
                  required
                  minLength={6}
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Pilih Peran / Hak Akses (Role)
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <label
                    className={`p-2.5 rounded-lg border text-left cursor-pointer flex items-center justify-between transition-colors ${
                      newMemberRole === 'TECHNICIAN'
                        ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/30'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        TECHNICIAN (Teknisi)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Bisa memeriksa unit, update tahapan pengerjaan, foto bukti, & catatan rahasia.
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="role"
                      value="TECHNICIAN"
                      checked={newMemberRole === 'TECHNICIAN'}
                      onChange={() => setNewMemberRole('TECHNICIAN')}
                      className="accent-[#0284C7] dark:accent-[#00F0FF]"
                    />
                  </label>

                  <label
                    className={`p-2.5 rounded-lg border text-left cursor-pointer flex items-center justify-between transition-colors ${
                      newMemberRole === 'CASHIER'
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        CASHIER (Kasir / Front Office)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Bisa membuat nota terima cepat, cetak nota thermal, & serah terima unit.
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="role"
                      value="CASHIER"
                      checked={newMemberRole === 'CASHIER'}
                      onChange={() => setNewMemberRole('CASHIER')}
                      className="accent-[#0284C7] dark:accent-[#00F0FF]"
                    />
                  </label>

                  <label
                    className={`p-2.5 rounded-lg border text-left cursor-pointer flex items-center justify-between transition-colors ${
                      newMemberRole === 'OWNER'
                        ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/30'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        OWNER (Pemilik Toko)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Akses tanpa batas ke seluruh modul finansial, kelola tim, & pengaturan API.
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="role"
                      value="OWNER"
                      checked={newMemberRole === 'OWNER'}
                      onChange={() => setNewMemberRole('OWNER')}
                      className="accent-[#0284C7] dark:accent-[#00F0FF]"
                    />
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setNewMemberOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creatingMember}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer"
                >
                  {creatingMember ? 'Menyimpan Akun...' : 'Simpan Akun Baru'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL EDIT PROFIL AKUN PETUGAS (NAMA LENGKAP & USERNAME)
         ==================================================================== */}
      {editProfileMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Edit Profil Akun Petugas
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Perbarui Nama Lengkap dan Username untuk akun{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    @{editProfileMember.username}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditProfileMember(null)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleEditMemberProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nama Lengkap *
                </label>
                <input
                  type="text"
                  value={editProfileFullName}
                  onChange={(e) => setEditProfileFullName(e.target.value)}
                  placeholder="Contoh: Budi Santoso (Owner)"
                  required
                  minLength={2}
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Username Login *
                </label>
                <input
                  type="text"
                  value={editProfileUsername}
                  onChange={(e) => setEditProfileUsername(e.target.value)}
                  placeholder="Contoh: admin"
                  required
                  minLength={3}
                  className="w-full px-3.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditProfileMember(null)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={updatingProfile}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer"
                >
                  {updatingProfile ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL KONFIRMASI HAPUS AKUN TIM
         ==================================================================== */}
      {memberToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Hapus Akun @{memberToDelete.username}?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  Apakah Anda yakin ingin menghapus akun petugas{' '}
                  <strong>{memberToDelete.full_name}</strong> (@{memberToDelete.username})?
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={deletingMember}
                onClick={() => setMemberToDelete(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingMember}
                onClick={handleConfirmDeleteTeamMember}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
              >
                {deletingMember ? 'Menghapus...' : 'Ya, Hapus Akun'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL GANTI PASSWORD ANGGOTA TIM
         ==================================================================== */}
      {changePasswordMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Ganti Kata Sandi Staf
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Mengubah password untuk akun{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {changePasswordMember.full_name}
                  </span>{' '}
                  (@{changePasswordMember.username})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChangePasswordMember(null)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Tutup
              </button>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password Baru (Minimal 6 Karakter)
                </label>
                <input
                  type="password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="Masukkan kata sandi baru"
                  required
                  minLength={6}
                  className="w-full px-3.5 py-2 text-xs rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setChangePasswordMember(null)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={updatingPassword}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#00F0FF] text-white dark:text-slate-950 hover:opacity-95 transition-opacity cursor-pointer"
                >
                  {updatingPassword ? 'Memperbarui...' : 'Perbarui Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL INTERAKTIF WHATSAPP NOTIFIER (WABLAS / DIRECT WA FALLBACK)
         ==================================================================== */}
      {waModalInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {waModalInfo.dispatch.mode === 'WABLAS'
                    ? 'TERKIRIM OTOMATIS VIA WABLAS GATEWAY'
                    : 'AUTO-FALLBACK KE DIRECT WHATSAPP (WABLAS OFFLINE / NONAKTIF)'}
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                  Notifikasi WA · {waModalInfo.invoiceNumber} ({waModalInfo.customerName})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWaModalInfo(null)}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Tutup
              </button>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 max-h-60 overflow-y-auto">
              <div className="text-[11px] font-semibold text-slate-500 mb-1">
                Pratinjau Pesan WhatsApp:
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed">
                {waModalInfo.dispatch.message_preview}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(waModalInfo.dispatch.message_preview);
                  setCopiedWaText(true);
                  setTimeout(() => setCopiedWaText(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedWaText ? 'Pesan Tersalin!' : 'Salin Isi Pesan'}</span>
              </button>

              {waModalInfo.dispatch.fallback_url && (
                <a
                  href={waModalInfo.dispatch.fallback_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Kirim WA Manual (Wablas Offline)</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Nota Servis Permanen */}
      {ticketToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Hapus Nota {ticketToDelete.invoice_number}?
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                  Apakah Anda yakin ingin menghapus nota ini secara permanen? Data yang dihapus
                  tidak dapat dikembalikan.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={deletingTicket}
                onClick={() => setTicketToDelete(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingTicket}
                onClick={handleConfirmDeleteTicket}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
              >
                {deletingTicket ? 'Menghapus...' : 'OK, Hapus Permanen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cetak Nota Thermal 58mm / 80mm / PDF */}
      {printTicket && (
        <ThermalReceiptModal
          ticket={printTicket}
          storeProfile={{
            store_name: storeName,
            store_slogan: storeSlogan,
            store_address: storeAddress,
            store_phone: storePhone,
            receipt_footer_notes: receiptFooterNotes,
          }}
          onClose={() => setPrintTicket(null)}
        />
      )}
    </div>
  );
};
