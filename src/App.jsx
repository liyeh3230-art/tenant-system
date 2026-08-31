import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Home, Users, FileText, CreditCard, Building,
  LogOut, Plus, CheckCircle, Clock, AlertCircle,
  Search, User, LayoutDashboard, Wallet,
  Calendar, Phone, DollarSign, X, Check, Clipboard, Edit3, Trash2, Menu, FileEdit, XCircle, History, Image, Share2, Lock, FileCheck,
  Printer, Download, QrCode, Send, ArrowUpRight, RefreshCw, SlidersHorizontal, ChevronRight, Percent, TrendingUp, Receipt, Copy, Sparkles, Filter, Layers, ChevronDown, ChevronUp,
  Upload, Star, ArrowLeft, ArrowRight, ShieldCheck, GripVertical, KeyRound, MessageSquare, Shield, Eye, EyeOff
} from 'lucide-react';
import {
  sanitizeText,
  registerUser,
  completeTenantOnboarding,
  submitLandlordApplication,
  loginUser,
  logoutUser,
  transitionPaymentStatus,
  generateLineBindingToken,
  redirectToLineLogin,
  handleLineOAuthCallback,
  logAuditEvent,
  PaymentStatus
} from './lib/securityService';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';

export const categoryMap = {
  rent: { label: '租金', icon: '🏠', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  deposit: { label: '押金保證金', icon: '🔒', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  utilities: { label: '水電費', icon: '⚡', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  management: { label: '管理費', icon: '🏢', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  other: { label: '其他', icon: '📦', color: 'bg-slate-100 text-slate-700 border-slate-300' }
};

export const getCategoryInfo = (type) => {
  if (type === 'water' || type === 'electricity' || type === 'gas') return categoryMap.utilities;
  if (type === 'maintenance') return categoryMap.other;
  return categoryMap[type] || categoryMap.other;
};

export const formatPaymentMethod = (method) => {
  if (!method) return '銀行轉帳';
  if (method === 'bank') return '銀行轉帳';
  if (method === 'cash') return '現金交付';
  return String(method).replace(/^bank\b/i, '銀行轉帳');
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'superadmin') {
          return { id: 'usr_superadmin', phone: parsed.phone || '0900000000', role: 'superadmin' };
        }
        if (parsed?.id || parsed?.phone) {
          return { id: parsed.id, phone: parsed.phone, user_metadata: { role: parsed.role, name: parsed.name } };
        }
      }
    } catch (e) {}
    return null;
  });

  const [role, setRole] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'superadmin') return 'superadmin';
        if (parsed?.role === 'landlord' || parsed?.role === 'admin') return 'admin';
        if (parsed?.role === 'tenant') return 'tenant';
      }
    } catch (e) {}
    return 'portal';
  });

  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'superadmin') return 'landlords';
        if (parsed?.role === 'tenant') return 'portal';
        if (parsed?.role === 'landlord' || parsed?.role === 'admin') return 'dashboard';
      }
    } catch (e) {}
    return 'dashboard';
  });

  const [searchQuery, setSearchQuery] = useState('');

  const [landlords, setLandlords] = useState([]);
  const [properties, setProperties] = useState([]);
  const [leases, setLeases] = useState([]);
  const [payments, setPayments] = useState([]);
  const [historicalLeases, setHistoricalLeases] = useState([]);

  const [currentLandlordId, setCurrentLandlordId] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'landlord' || parsed?.role === 'admin') return parsed.id;
      }
    } catch (e) {}
    return null;
  });

  const [currentLandlordPhone, setCurrentLandlordPhone] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'landlord' || parsed?.role === 'admin') return parsed.phone;
      }
    } catch (e) {}
    return null;
  });

  const [currentTenantLeaseId, setCurrentTenantLeaseId] = useState(null);
  const [currentTenantPhone, setCurrentTenantPhone] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'tenant') return parsed.phone;
      }
    } catch (e) {}
    return null;
  });
  const [currentTenantName, setCurrentTenantName] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'tenant') return parsed.name || '';
      }
    } catch (e) {}
    return '';
  });

  const [landlordLoginPhone, setLandlordLoginPhone] = useState('');
  const [landlordLoginPassword, setLandlordLoginPassword] = useState('');

  const [filterPropertyStatus, setFilterPropertyStatus] = useState('all');
  const [filterLeaseStatus, setFilterLeaseStatus] = useState('all');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('all');
  const [filterPaymentMonth, setFilterPaymentMonth] = useState('all');
  const [filterPaymentProperty, setFilterPaymentProperty] = useState('all');
  const [filterPaymentCategory, setFilterPaymentCategory] = useState('all');

  const [activeModal, setActiveModal] = useState(null);
  const [photoModalProperty, setPhotoModalProperty] = useState(null);
  const [photoInputUrl, setPhotoInputUrl] = useState('');
  const [tempPhotos, setTempPhotos] = useState([]);
  const [editingProperty, setEditingProperty] = useState(null);
  const [viewingLandlordProps, setViewingLandlordProps] = useState(null);
  const [viewingLease, setViewingLease] = useState(null);
  const [editingLease, setEditingLease] = useState(null);
  const [toasts, setToasts] = useState([]);

  const [expandedHistLeases, setExpandedHistLeases] = useState({});
  const toggleHistLeaseExpanded = (leaseId) => {
    setExpandedHistLeases(prev => ({
      ...prev,
      [leaseId]: !prev[leaseId]
    }));
  };

  // Payment Management States (Landlord & Tenant)
  const [recordingPayment, setRecordingPayment] = useState(null);
  const [recordPaymentMethod, setRecordPaymentMethod] = useState('bank');
  const [recordPaymentDate, setRecordPaymentDate] = useState('');
  const [recordPaymentNote, setRecordPaymentNote] = useState('');
  const [receiptPayment, setReceiptPayment] = useState(null);

  // Landlord Add Payment/Bill States
  const [customBillLeaseId, setCustomBillLeaseId] = useState('');
  const [customBillCategory, setCustomBillCategory] = useState('rent');
  const [customBillTitle, setCustomBillTitle] = useState('');
  const [customBillAmount, setCustomBillAmount] = useState('');
  const [customBillDueDate, setCustomBillDueDate] = useState('');
  const [customBillNote, setCustomBillNote] = useState('');
  const [customBillPaymentType, setCustomBillPaymentType] = useState('paid'); // 'paid' (已收款直接入帳) | 'pending' (待繳帳單)
  const [customBillPaymentMethod, setCustomBillPaymentMethod] = useState('bank');

  // Tenant Self-Report / Add Payment States
  const [tenantReportCategory, setTenantReportCategory] = useState('rent');
  const [tenantReportTitle, setTenantReportTitle] = useState('');
  const [tenantReportAmount, setTenantReportAmount] = useState('');
  const [tenantReportMethod, setTenantReportMethod] = useState('cash'); // 預設為現金交付
  const [tenantReportTransferLast5, setTenantReportTransferLast5] = useState('');
  const [tenantReportDate, setTenantReportDate] = useState('');
  const [tenantReportNote, setTenantReportNote] = useState('');
  const [tenantReportTargetBill, setTenantReportTargetBill] = useState(null);

  // Tenant Payment Interaction States
  const [tenantPayingBill, setTenantPayingBill] = useState(null);
  const [tenantPayChannel, setTenantPayChannel] = useState('cash');
  const [tenantPayTransferLast5, setTenantPayTransferLast5] = useState('');
  const [tenantPayCardNumber, setTenantPayCardNumber] = useState('');
  const [tenantPayCardExp, setTenantPayCardExp] = useState('');
  const [tenantPayCardCvc, setTenantPayCardCvc] = useState('');

  // Landlord Bank Account Configuration States (房東專區自訂收款帳戶，若未填寫則為空值)
  const [landlordBankInfo, setLandlordBankInfo] = useState({
    bankName: '',
    bankAccount: '',
    accountName: '',
    note: ''
  });
  const [tempBankName, setTempBankName] = useState('');
  const [tempBankAccount, setTempBankAccount] = useState('');
  const [tempAccountName, setTempAccountName] = useState('');
  const [tempBankNote, setTempBankNote] = useState('');

  // Modals state inputs
  const [propName, setPropName] = useState('');
  const [propType, setPropType] = useState('獨立套房');
  const [propRent, setPropRent] = useState('');
  const [propRentPeriod, setPropRentPeriod] = useState('monthly'); // 'monthly' | 'yearly'
  const [propStatus, setPropStatus] = useState('vacant');
  const [propAddress, setPropAddress] = useState('');
  const [propIsAdvertised, setPropIsAdvertised] = useState(false);

  // Lease Form State (Simplified for recording information)
  const [leasePropId, setLeasePropId] = useState('');
  const [leaseTenantName, setLeaseTenantName] = useState('');
  const [leasePhone, setLeasePhone] = useState('');
  const [leaseCoPhone, setLeaseCoPhone] = useState('');
  const [leaseCoTenantName, setLeaseCoTenantName] = useState('');
  const [leaseStartDate, setLeaseStartDate] = useState('');
  const [leaseEndDate, setLeaseEndDate] = useState('');
  const [leaseDeposit, setLeaseDeposit] = useState('');
  const [leaseUnitRent, setLeaseUnitRent] = useState('');
  const [leasePeriodCount, setLeasePeriodCount] = useState('12');
  const [leaseUnitType, setLeaseUnitType] = useState('monthly'); // 'monthly' | 'yearly'
  const [leaseTotalRent, setLeaseTotalRent] = useState('');
  const [leaseNote, setLeaseNote] = useState('');
  const [showCoTenant, setShowCoTenant] = useState(false);

  // Landlord Self-Registration & Superadmin Approval States
  const [landlordAuthMode, setLandlordAuthMode] = useState('login'); // 'login' | 'register'
  const [landlordSelfName, setLandlordSelfName] = useState('');
  const [landlordSelfPhone, setLandlordSelfPhone] = useState('');
  const [landlordSelfPassword, setLandlordSelfPassword] = useState('');
  const [isSuperadminAuthenticated, setIsSuperadminAuthenticated] = useState(() => {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.role === 'superadmin') return true;
      }
    } catch (e) {}
    return false;
  });
  const [superadminLoginPhone, setSuperadminLoginPhone] = useState('');
  const [superadminPasswordInput, setSuperadminPasswordInput] = useState('');
  const [superadminLoginLoading, setSuperadminLoginLoading] = useState(false);
  const [showSuperadminPassword, setShowSuperadminPassword] = useState(false);
  const [superadminTab, setSuperadminTab] = useState('approved'); // 'approved' | 'pending'
  const [superadminCategory, setSuperadminCategory] = useState('landlord'); // 'landlord' | 'tenant'
  const [landlordAddresses, setLandlordAddresses] = useState([]);
  const [newAddressText, setNewAddressText] = useState('');

  // Tenant Self-Registration & Password-based Login States
  const [registeredTenants, setRegisteredTenants] = useState([]);
  const [tenantAuthMode, setTenantAuthMode] = useState('login'); // 'login' | 'register'
  const [tenantSelfName, setTenantSelfName] = useState('');
  const [tenantSelfPhone, setTenantSelfPhone] = useState('');
  const [tenantSelfPassword, setTenantSelfPassword] = useState('');
  const [tenantLoginPhone, setTenantLoginPhone] = useState('');
  const [tenantLoginPassword, setTenantLoginPassword] = useState('');

  // --- 統一登入與註冊狀態 (Unified Auth & Onboarding States) ---
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [authPhone, setAuthPhone] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authRole, setAuthRole] = useState('tenant'); // 'tenant' | 'landlord'
  const [authShowPassword, setAuthShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // 註冊後身分導引與詳細資料
  const [onboardingUser, setOnboardingUser] = useState(null); // { id, phone, name }
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [landlordAppForm, setLandlordAppForm] = useState({
    idNumber: '',
    contactAddress: '',
    companyName: '',
    bankName: '',
    bankAccount: '',
    notes: '',
  });
  const [landlordAppLoading, setLandlordAppLoading] = useState(false);
  const [pendingLandlordNotice, setPendingLandlordNotice] = useState({
    open: false,
    data: null,
  });

  // Mobile Responsiveness
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Custom confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState(null);
  const showConfirmDialog = (message) => new Promise((resolve) => {
    setConfirmDialog({
      message,
      onConfirm: () => { setConfirmDialog(null); resolve(true); },
      onCancel: () => { setConfirmDialog(null); resolve(false); },
    });
  });

  // --- 1. 獨立的資料抓取函式 (使用 useCallback 並在 SQL 層面以 .eq()/.in() 進行身分精確過濾) ---
  const fetchSupabaseDataRef = useRef(null);

  const fetchSupabaseData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      // 🚀 優化 A：針對「房東視角」進行精確查詢
      if (role === 'admin' || currentLandlordId || currentLandlordPhone) {
        const cleanLndPhone = currentLandlordPhone ? String(currentLandlordPhone).replace(/[^0-9]/g, '') : '';
        let targetLandlordId = currentLandlordId;

        // 查詢當前房東 Profile / Landlord 資訊
        const { data: myProfileData } = await supabase.from('profiles').select('*').eq('role', 'landlord');
        const { data: myLandlordsData } = await supabase.from('landlords').select('*');

        const matchedProfile = (myProfileData || []).find(p => (targetLandlordId && p.id === targetLandlordId) || (cleanLndPhone && String(p.phone || '').replace(/[^0-9]/g, '') === cleanLndPhone));
        const matchedLandlord = (myLandlordsData || []).find(l => (targetLandlordId && l.id === targetLandlordId) || (cleanLndPhone && String(l.phone || '').replace(/[^0-9]/g, '') === cleanLndPhone));

        const resolvedId = targetLandlordId || matchedProfile?.id || matchedLandlord?.id || (myLandlordsData?.[0]?.id) || (myProfileData?.[0]?.id);
        const resolvedPhone = cleanLndPhone || matchedProfile?.phone || matchedLandlord?.phone || '';
        const resolvedName = matchedProfile?.name || matchedLandlord?.name || '房東';

        const landlordIdList = Array.from(new Set([
          targetLandlordId,
          matchedProfile?.id,
          matchedLandlord?.id,
          resolvedId
        ].filter(Boolean)));

        const rawBank = matchedProfile?.bank_info || matchedLandlord?.bank_info;
        if (rawBank) {
          const parsed = typeof rawBank === 'string' ? JSON.parse(rawBank || '{}') : rawBank;
          setLandlordBankInfo({
            bankName: parsed.bankName || '',
            bankAccount: parsed.bankAccount || '',
            accountName: parsed.accountName || '',
            note: parsed.note || ''
          });
        } else {
          setLandlordBankInfo({ bankName: '', bankAccount: '', accountName: '', note: '' });
        }

        setLandlords([{
          id: resolvedId || 'LND_CURRENT',
          name: resolvedName,
          phone: resolvedPhone,
          status: matchedLandlord?.status || 'approved',
          adListingEnabled: matchedLandlord?.ad_listing_enabled ?? false
        }]);

        // 抓取該房東的地址庫
        const addrOrClause = landlordIdList.map(id => `landlord_id.eq.${id}`).join(',');
        const addrQuery = addrOrClause
          ? supabase.from('landlord_addresses').select('*').or(`${addrOrClause},landlord_id.is.null`)
          : supabase.from('landlord_addresses').select('*');
        const { data: addrData } = await addrQuery;
        if (addrData) {
          setLandlordAddresses(addrData.map(a => ({
            id: a.id,
            landlordId: a.landlord_id,
            address: a.address
          })));
        }

        // 抓取該房東的房源 (包含軟刪除以供歷史合約參照)
        const propOrClause = landlordIdList.map(id => `landlord_id.eq.${id}`).join(',');
        const propQuery = propOrClause
          ? supabase.from('properties').select('*').or(`${propOrClause},landlord_id.is.null`)
          : supabase.from('properties').select('*');
        const { data: propData } = await propQuery;
        if (propData) {
          setProperties(propData.map(p => ({
            id: p.id,
            landlordId: p.landlord_id,
            name: p.name,
            type: p.type,
            rent: p.rent,
            rentPeriod: p.rent_period || 'monthly',
            status: p.status,
            address: p.address,
            isAdvertised: p.is_advertised,
            photos: p.photos || [],
            deletedAt: p.deleted_at
          })));
        }

        // 抓取該房東的租約
        const leaseOrClause = landlordIdList.map(id => `landlord_id.eq.${id}`).join(',');
        const leaseQuery = leaseOrClause
          ? supabase.from('leases').select('*').or(`${leaseOrClause},landlord_id.is.null`).is('deleted_at', null)
          : supabase.from('leases').select('*').is('deleted_at', null);
        const { data: leaseData } = await leaseQuery;

        if (leaseData) {
          const activeLeases = leaseData.filter(l => l.status === 'active').map(l => ({
            id: l.id,
            propertyId: l.property_id,
            tenantName: l.tenant_name,
            phone: l.phone,
            coPhone: l.co_phone,
            coTenantName: l.co_tenant_name,
            startDate: l.start_date,
            endDate: l.end_date,
            deposit: l.deposit,
            monthlyRent: l.monthly_rent,
            totalContractRent: l.total_contract_rent,
            status: l.status,
            note: l.note
          }));
          setLeases(activeLeases);
          if (activeLeases.length > 0) {
            setCurrentTenantLeaseId(prev => prev || activeLeases[0].id);
          }

          const histLeases = leaseData.filter(l => l.status === 'terminated').map(l => ({
            id: l.id,
            propertyId: l.property_id,
            tenantName: l.tenant_name,
            phone: l.phone,
            startDate: l.start_date,
            endDate: l.end_date,
            terminatedAt: l.terminated_at,
            status: l.status,
            note: l.note,
            archivedPayments: []
          }));
          setHistoricalLeases(histLeases);

          // 從合約中提取房客名冊，並同步加載所有已註冊房客 Profile
          const tMap = new Map();
          leaseData.forEach(l => {
            const cleanP = (l.phone || '').replace(/[^0-9]/g, '');
            if (cleanP && !tMap.has(cleanP)) {
              tMap.set(cleanP, { id: `TEN_${cleanP}`, name: l.tenant_name || '房客', phone: l.phone, isSelfRegistered: false });
            }
            if (l.co_phone) {
              const cleanCo = l.co_phone.replace(/[^0-9]/g, '');
              if (cleanCo && !tMap.has(cleanCo)) {
                tMap.set(cleanCo, { id: `TEN_${cleanCo}`, name: l.co_tenant_name || '共同承租人', phone: l.co_phone, isSelfRegistered: false });
              }
            }
          });

          // 同步加載已註冊之房客 Profile
          try {
            const { data: tenantProfs } = await supabase
              .from('profiles')
              .select('id, name, phone, role')
              .eq('role', 'tenant')
              .is('deleted_at', null);

            if (tenantProfs) {
              tenantProfs.forEach(p => {
                const cleanP = (p.phone || '').replace(/[^0-9]/g, '');
                if (cleanP && p.name) {
                  tMap.set(cleanP, { id: p.id, name: p.name, phone: p.phone, isSelfRegistered: true });
                }
              });
            }
          } catch (pErr) {
            console.warn('Preload tenant profiles warning:', pErr);
          }

          setRegisteredTenants(Array.from(tMap.values()));

          // 只抓取該房東合約相關的帳單，避免全庫下載
          const leaseIds = leaseData.map(l => l.id);
          if (leaseIds.length > 0) {
            const { data: paymentData } = await supabase
              .from('payments')
              .select('*')
              .in('lease_id', leaseIds)
              .is('deleted_at', null);

            const allPaymentRows = paymentData || [];
            const activeLeaseIds = new Set(activeLeases.map(l => l.id));

            setPayments(allPaymentRows
              .filter(p => activeLeaseIds.has(p.lease_id))
              .map(p => ({
                id: p.id,
                leaseId: p.lease_id,
                tenantName: p.tenant_name,
                propertyName: p.property_name,
                amount: p.amount,
                status: p.status,
                billType: p.bill_type || 'rent',
                title: p.title,
                dueDate: p.due_date,
                paidDate: p.paid_date,
                paymentMethod: p.payment_method,
                transferLast5: p.transfer_last5,
                note: p.note
              })));

            const histLeasesWithPayments = histLeases.map(hl => ({
              ...hl,
              archivedPayments: allPaymentRows
                .filter(p => p.lease_id === hl.id)
                .map(p => ({
                  id: p.id,
                  leaseId: p.lease_id,
                  tenantName: p.tenant_name,
                  propertyName: p.property_name,
                  amount: p.amount,
                  status: p.status,
                  billType: p.bill_type || 'rent',
                  title: p.title,
                  dueDate: p.due_date,
                  paidDate: p.paid_date,
                  paymentMethod: p.payment_method,
                  transferLast5: p.transfer_last5,
                  note: p.note
                }))
            }));
            setHistoricalLeases(histLeasesWithPayments);
          } else {
            setPayments([]);
            setHistoricalLeases(histLeases);
          }
        }
      }

      // 🚀 優化 B：針對「租客視角」進行精確查詢
      else if (role === 'tenant' && currentTenantPhone) {
        const cleanTenantPhone = String(currentTenantPhone).replace(/[^0-9]/g, '');
        // 抓取該租客在 profiles 中的真實姓名
        try {
          const { data: profData } = await supabase
            .from('profiles')
            .select('name')
            .eq('phone', cleanTenantPhone)
            .maybeSingle();
          if (profData?.name) {
            setCurrentTenantName(profData.name);
          }
        } catch (e) {}

        // 抓取該租客的合約
        const { data: leaseData } = await supabase
          .from('leases')
          .select('*')
          .or(`phone.eq.${cleanTenantPhone},co_phone.eq.${cleanTenantPhone}`)
          .is('deleted_at', null);

        if (leaseData) {
          const activeLeases = leaseData.filter(l => l.status === 'active').map(l => ({
            id: l.id,
            propertyId: l.property_id,
            landlordId: l.landlord_id,
            tenantName: l.tenant_name,
            phone: l.phone,
            coPhone: l.co_phone,
            coTenantName: l.co_tenant_name,
            startDate: l.start_date,
            endDate: l.end_date,
            deposit: l.deposit,
            monthlyRent: l.monthly_rent,
            totalContractRent: l.total_contract_rent,
            status: l.status,
            note: l.note
          }));
          setLeases(activeLeases);

          const histLeases = leaseData.filter(l => l.status === 'terminated').map(l => ({
            id: l.id,
            propertyId: l.property_id,
            landlordId: l.landlord_id,
            tenantName: l.tenant_name,
            phone: l.phone,
            startDate: l.start_date,
            endDate: l.end_date,
            terminatedAt: l.terminated_at,
            status: l.status,
            note: l.note,
            archivedPayments: []
          }));

          // 抓取該租客合約關聯的房源
          const propIds = Array.from(new Set(leaseData.map(l => l.property_id).filter(Boolean)));
          if (propIds.length > 0) {
            const { data: propData } = await supabase
              .from('properties')
              .select('*')
              .in('id', propIds);
            if (propData) {
              setProperties(propData.map(p => ({
                id: p.id,
                landlordId: p.landlord_id,
                name: p.name,
                type: p.type,
                rent: p.rent,
                rentPeriod: p.rent_period || 'monthly',
                status: p.status,
                address: p.address,
                isAdvertised: p.is_advertised,
                photos: p.photos || [],
                deletedAt: p.deleted_at
              })));
            }
          }

          // 抓取該租客房東的完整資訊與收款帳戶
          const lndIds = Array.from(new Set([
            ...leaseData.map(l => l.landlord_id),
            ...(propIds.length > 0 ? (properties.map(p => p.landlordId)) : [])
          ].filter(Boolean)));

          if (lndIds.length > 0) {
            const { data: lndProfs } = await supabase.from('profiles').select('id, name, phone, bank_info').in('id', lndIds);
            const { data: lndTable } = await supabase.from('landlords').select('id, name, phone, bank_info, ad_listing_enabled, status').in('id', lndIds);

            const combinedLandlords = (lndTable || []).map(l => {
              const matchedProf = (lndProfs || []).find(p => p.id === l.id);
              return {
                id: l.id,
                name: l.name || matchedProf?.name || '房東',
                phone: l.phone || matchedProf?.phone || '',
                status: l.status || 'approved',
                adListingEnabled: l.ad_listing_enabled || false,
                bankInfo: l.bank_info || matchedProf?.bank_info
              };
            });

            (lndProfs || []).forEach(p => {
              if (!combinedLandlords.some(l => l.id === p.id)) {
                combinedLandlords.push({
                  id: p.id,
                  name: p.name || '房東',
                  phone: p.phone || '',
                  status: 'approved',
                  adListingEnabled: false,
                  bankInfo: p.bank_info
                });
              }
            });

            setLandlords(combinedLandlords);

            const targetBank = combinedLandlords[0]?.bankInfo;
            if (targetBank) {
              const parsed = typeof targetBank === 'string' ? JSON.parse(targetBank || '{}') : targetBank;
              setLandlordBankInfo({
                bankName: parsed.bankName || '',
                bankAccount: parsed.bankAccount || '',
                accountName: parsed.accountName || '',
                note: parsed.note || ''
              });
            } else {
              setLandlordBankInfo({ bankName: '', bankAccount: '', accountName: '', note: '' });
            }
          } else {
            setLandlords([]);
            setLandlordBankInfo({ bankName: '', bankAccount: '', accountName: '', note: '' });
          }

          // 抓取該租客合約關聯的帳單
          const leaseIds = leaseData.map(l => l.id);
          if (leaseIds.length > 0) {
            const { data: paymentData } = await supabase
              .from('payments')
              .select('*')
              .in('lease_id', leaseIds)
              .is('deleted_at', null);

            const allPaymentRows = paymentData || [];
            const activeLeaseIds = new Set(activeLeases.map(l => l.id));

            setPayments(allPaymentRows
              .filter(p => activeLeaseIds.has(p.lease_id))
              .map(p => ({
                id: p.id,
                leaseId: p.lease_id,
                tenantName: p.tenant_name,
                propertyName: p.property_name,
                amount: p.amount,
                status: p.status,
                billType: p.bill_type || 'rent',
                title: p.title,
                dueDate: p.due_date,
                paidDate: p.paid_date,
                paymentMethod: p.payment_method,
                transferLast5: p.transfer_last5,
                note: p.note
              })));

            const histLeasesWithPayments = histLeases.map(hl => ({
              ...hl,
              archivedPayments: allPaymentRows
                .filter(p => p.lease_id === hl.id)
                .map(p => ({
                  id: p.id,
                  leaseId: p.lease_id,
                  tenantName: p.tenant_name,
                  propertyName: p.property_name,
                  amount: p.amount,
                  status: p.status,
                  billType: p.bill_type || 'rent',
                  title: p.title,
                  dueDate: p.due_date,
                  paidDate: p.paid_date,
                  paymentMethod: p.payment_method,
                  transferLast5: p.transfer_last5,
                  note: p.note
                }))
            }));
            setHistoricalLeases(histLeasesWithPayments);
          } else {
            setPayments([]);
            setHistoricalLeases(histLeases);
          }
        }
      }

      // 🚀 優化 C：若為「總管理員」，才抓取全平台資料以進行統計
      else if (role === 'superadmin') {
        const { data: propData } = await supabase.from('properties').select('*');
        if (propData) {
          setProperties(propData.map(p => ({
            id: p.id,
            landlordId: p.landlord_id,
            name: p.name,
            type: p.type,
            rent: p.rent,
            rentPeriod: p.rent_period || 'monthly',
            status: p.status,
            address: p.address,
            isAdvertised: p.is_advertised,
            photos: p.photos || [],
            deletedAt: p.deleted_at
          })));
        }

        const { data: leaseData } = await supabase.from('leases').select('*').is('deleted_at', null);
        if (leaseData) {
          setLeases(leaseData.filter(l => l.status === 'active').map(l => ({
            id: l.id,
            propertyId: l.property_id,
            tenantName: l.tenant_name,
            phone: l.phone,
            coPhone: l.co_phone,
            coTenantName: l.co_tenant_name,
            startDate: l.start_date,
            endDate: l.end_date,
            deposit: l.deposit,
            monthlyRent: l.monthly_rent,
            totalContractRent: l.total_contract_rent,
            status: l.status,
            note: l.note
          })));
          setHistoricalLeases(leaseData.filter(l => l.status === 'terminated').map(l => ({
            id: l.id,
            propertyId: l.property_id,
            tenantName: l.tenant_name,
            phone: l.phone,
            startDate: l.start_date,
            endDate: l.end_date,
            terminatedAt: l.terminated_at,
            status: l.status,
            note: l.note,
            archivedPayments: []
          })));
        }

        const { data: paymentData } = await supabase.from('payments').select('*').is('deleted_at', null);
        if (paymentData) {
          setPayments(paymentData.map(p => ({
            id: p.id,
            leaseId: p.lease_id,
            tenantName: p.tenant_name,
            propertyName: p.property_name,
            amount: p.amount,
            status: p.status,
            billType: p.bill_type || 'rent',
            title: p.title,
            dueDate: p.due_date,
            paidDate: p.paid_date,
            paymentMethod: p.payment_method,
            transferLast5: p.transfer_last5,
            note: p.note
          })));
        }

        const { data: addrData } = await supabase.from('landlord_addresses').select('*');
        if (addrData) {
          setLandlordAddresses(addrData.map(a => ({
            id: a.id,
            landlordId: a.landlord_id,
            address: a.address
          })));
        }

        const { data: profileData } = await supabase.from('profiles').select('*');
        const { data: landlordTableData } = await supabase.from('landlords').select('*');
        const lndMap = {};
        (landlordTableData || []).forEach(l => { if (l && l.id) lndMap[l.id] = l; });
        const lndIdSet = new Set();
        const lnds = [];

        (profileData || []).filter(p => p.role === 'landlord').forEach(p => {
          lndIdSet.add(p.id);
          const lndInfo = lndMap[p.id] || {};
          lnds.push({
            id: p.id,
            name: p.name || lndInfo.name || '房東',
            phone: p.phone || lndInfo.phone || '',
            company_name: lndInfo.company_name || '',
            id_number: lndInfo.id_number || '',
            contact_address: lndInfo.contact_address || '',
            bank_name: lndInfo.bank_name || '',
            bank_account: lndInfo.bank_account || '',
            status: lndInfo.status || 'approved',
            adListingEnabled: lndInfo.ad_listing_enabled ?? false
          });
        });

        (landlordTableData || []).forEach(l => {
          if (l && l.id && !lndIdSet.has(l.id)) {
            lndIdSet.add(l.id);
            lnds.push({
              id: l.id,
              name: l.name || '房東',
              phone: l.phone || '',
              company_name: l.company_name || '',
              id_number: l.id_number || '',
              contact_address: l.contact_address || '',
              bank_name: l.bank_name || '',
              bank_account: l.bank_account || '',
              status: l.status || 'approved',
              adListingEnabled: l.ad_listing_enabled ?? false
            });
          }
        });
        setLandlords(lnds);

        const tenantMap = new Map();
        (profileData || []).filter(p => p.role === 'tenant').forEach(p => {
          const cleanP = (p.phone || '').replace(/[^0-9]/g, '');
          if (cleanP) {
            tenantMap.set(cleanP, { id: p.id, name: p.name || '租客', phone: p.phone, isSelfRegistered: true });
          }
        });
        setRegisteredTenants(Array.from(tenantMap.values()));
      }

    } catch (err) {
      console.error('Supabase 資料載入失敗:', err);
    }
  }, [currentLandlordId, currentLandlordPhone, currentTenantPhone, role]);

  fetchSupabaseDataRef.current = fetchSupabaseData;

  // 觸發資料獲取 (當身分或關鍵參數改變時)
  useEffect(() => {
    fetchSupabaseData();
  }, [fetchSupabaseData]);

  // --- 2. 初始化 Auth 狀態：以 Supabase session 與受 RLS 保護的 profile 為唯一來源 ---
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let mounted = true;
    const applySession = async (session) => {
      if (!mounted) return;
      const user = session?.user;

      // 1. 若 Supabase Auth 存在有效 Session
      if (user) {
        const isSuperadmin = user.app_metadata?.role === 'superadmin';
        if (isSuperadmin) {
          setCurrentUser(user);
          setRole('superadmin');
          setActiveTab('landlords');
          setIsSuperadminAuthenticated(true);
          try {
            localStorage.setItem('app_auth_session', JSON.stringify({ id: user.id, role: 'superadmin', name: '平台總管理員' }));
          } catch (e) {}
          return;
        }

        const metaPhone = (user.user_metadata?.phone || user.email?.split('@')[0] || '').replace(/[^0-9]/g, '');
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, role, phone, name')
          .or(`id.eq.${user.id},phone.eq.${metaPhone}`);
        const profile = profs?.[0];
        if (!mounted) return;

        // ⚠️ 若會員在 profiles 資料表中已被刪除/註銷，強制登出並清除殘留 Session
        if (!profile) {
          try {
            await supabase.auth.signOut();
            localStorage.removeItem('app_auth_session');
          } catch (e) {}
          setCurrentUser(null);
          setRole('portal');
          setCurrentLandlordId(null);
          setCurrentLandlordPhone(null);
          setCurrentTenantPhone(null);
          return;
        }

        const userRole = profile.role || 'tenant';
        const cleanPhone = String(profile.phone || metaPhone).replace(/[^0-9]/g, '');

        setIsSuperadminAuthenticated(false);
        if (userRole === 'landlord' || userRole === 'admin') {
          const { data: lndRec } = await supabase
            .from('landlords')
            .select('*')
            .eq('id', profile.id)
            .maybeSingle();

          if (lndRec && lndRec.status === 'approved') {
            setRole('admin');
            setActiveTab('dashboard');
            setCurrentLandlordId(profile.id);
            setCurrentLandlordPhone(cleanPhone);
            try {
              localStorage.setItem('app_auth_session', JSON.stringify({ id: profile.id, phone: cleanPhone, name: profile.name, role: userRole }));
            } catch (e) {}
          } else {
            // 待審核或拒絕：不得進入房東後台！
            await logoutUser();
            if (lndRec && (lndRec.status === 'pending' || lndRec.status === 'rejected')) {
              setPendingLandlordNotice({
                open: true,
                status: lndRec.status,
                data: {
                  id: profile.id,
                  name: profile.name,
                  phone: cleanPhone,
                  companyName: lndRec.company_name,
                  idNumber: lndRec.id_number,
                  contactAddress: lndRec.contact_address,
                  bankName: lndRec.bank_name,
                  bankAccount: lndRec.bank_account,
                  submittedAt: lndRec.created_at ? new Date(lndRec.created_at).toLocaleDateString() : '近日',
                }
              });
            }
            return;
          }
        } else {
          setRole('tenant');
          setActiveTab('portal');
          setCurrentTenantPhone(cleanPhone);
          setCurrentTenantName(profile.name || user?.user_metadata?.name || '');
          try {
            localStorage.setItem('app_auth_session', JSON.stringify({ id: profile.id, phone: cleanPhone, name: profile.name, role: userRole }));
          } catch (e) {}
        }
        return;
      }

      // 2. 若無 Supabase Auth Session，檢查 Persistent Local Session (如 LINE 登入或手機登入)
      const savedSessionStr = typeof localStorage !== 'undefined' ? localStorage.getItem('app_auth_session') : null;
      if (savedSessionStr) {
        try {
          const savedSession = JSON.parse(savedSessionStr);
          if (savedSession && (savedSession.id || savedSession.phone)) {
            if (savedSession.role === 'superadmin') {
              setCurrentUser({ id: 'usr_superadmin', phone: '0900000000', role: 'superadmin' });
              setRole('superadmin');
              setActiveTab('landlords');
              setIsSuperadminAuthenticated(true);
              return;
            }

            // 向雲端 profiles 核實該會員是否存在且未被刪除
            const query = savedSession.id ? `id.eq.${savedSession.id},phone.eq.${savedSession.phone}` : `phone.eq.${savedSession.phone}`;
            const { data: profs, error: pErr } = await supabase.from('profiles').select('id, role, phone, name, deleted_at').or(query);
            const profile = profs?.[0];
            if (!mounted) return;

            if (profile && !profile.deleted_at) {
              const activeSessionRole = savedSession.role || profile.role || 'tenant';
              const cleanPhone = String(profile.phone || savedSession.phone).replace(/[^0-9]/g, '');

              setCurrentUser({ id: profile.id, phone: cleanPhone, user_metadata: { role: profile.role, name: profile.name } });
              setIsSuperadminAuthenticated(false);
              setCurrentTenantPhone(cleanPhone);
              setCurrentTenantName(profile.name || savedSession.name || '');

              if (activeSessionRole === 'landlord' || activeSessionRole === 'admin') {
                const { data: lndRec } = await supabase
                  .from('landlords')
                  .select('*')
                  .eq('id', profile.id)
                  .maybeSingle();

                if (lndRec && lndRec.status === 'approved') {
                  setRole('admin');
                  setActiveTab('dashboard');
                  setCurrentLandlordId(profile.id);
                  setCurrentLandlordPhone(cleanPhone);
                } else {
                  // 待審核、拒絕或尚未通過審核：清除 Session 並顯示審核中告示
                  await logoutUser();
                  if (lndRec && (lndRec.status === 'pending' || lndRec.status === 'rejected')) {
                    setPendingLandlordNotice({
                      open: true,
                      status: lndRec.status,
                      data: {
                        id: profile.id,
                        name: profile.name,
                        phone: cleanPhone,
                        companyName: lndRec.company_name,
                        idNumber: lndRec.id_number,
                        contactAddress: lndRec.contact_address,
                        bankName: lndRec.bank_name,
                        bankAccount: lndRec.bank_account,
                        submittedAt: lndRec.created_at ? new Date(lndRec.created_at).toLocaleDateString() : '近日',
                      }
                    });
                  }
                  return;
                }
              } else {
                setRole('tenant');
                setActiveTab('portal');
                setCurrentTenantPhone(cleanPhone);
                setCurrentTenantName(profile.name || savedSession.name || '');
              }
              return;
            } else if (profile && profile.deleted_at) {
              // 明確遭到管理員刪除/註銷
              localStorage.removeItem('app_auth_session');
            } else if (!pErr && profs && profs.length === 0) {
              // 資料庫中確定無此紀錄
              localStorage.removeItem('app_auth_session');
            } else {
              // 網路或未預期錯誤，保持目前已從 localStorage 載入的登入狀態！
              return;
            }
          }
        } catch (err) {
          console.warn('Failed to restore local session:', err);
        }
      }

      // 3. 無登入狀態 (僅在 localStorage 確定沒有任何 session 時才重置為 portal)
      if (!savedSessionStr) {
        setCurrentUser(null);
        setIsSuperadminAuthenticated(false);
        setRole('portal');
      }
    };

    supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // 避免在 Supabase callback 內直接發出其他 auth 呼叫。
      setTimeout(() => applySession(session), 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // --- 3. 穩定掛載 Realtime 頻道 (掛載一次，透過 Ref 呼叫最新 fetchSupabaseData，避免重複建立連線) ---
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let debounceTimer = null;
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (fetchSupabaseDataRef.current) {
            fetchSupabaseDataRef.current();
          }
        }, 500);
      })
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (role === 'admin') {
      const validAdminTabs = ['dashboard', 'payments', 'properties', 'advertise', 'leases', 'history'];
      setActiveTab(prev => (validAdminTabs.includes(prev) ? prev : 'dashboard'));
      setLandlordAuthMode('login');
    } else if (role === 'tenant') {
      const validTenantTabs = ['portal', 'tenantHistory', 'contract'];
      setActiveTab(prev => (validTenantTabs.includes(prev) ? prev : 'portal'));
      setTenantAuthMode('login');
    } else if (role === 'superadmin') {
      const validSuperTabs = ['landlords', 'superadmin_tenants', 'export'];
      setActiveTab(prev => (validSuperTabs.includes(prev) ? prev : 'landlords'));
      setSuperadminTab('approved');
    }
    setSearchQuery('');
    setIsMobileMenuOpen(false);
  }, [role]);

  // --- LINE OAuth 2.0 Authorization Callback Hook ---
  const [lineFirstLoginUser, setLineFirstLoginUser] = useState(null);
  const [lineFirstLoginName, setLineFirstLoginName] = useState('');
  const [lineFirstLoginPhone, setLineFirstLoginPhone] = useState('');
  const [lineFirstLoginRole, setLineFirstLoginRole] = useState('tenant');
  const [lineFirstLoginLoading, setLineFirstLoginLoading] = useState(false);

  useEffect(() => {
    const processLineOAuth = async () => {
      try {
        const oauthResult = await handleLineOAuthCallback();
        if (oauthResult && oauthResult.user) {
          const u = oauthResult.user;
          const cleanP = String(u.phone || '').replace(/[^0-9]/g, '');
          const isFirstTime = oauthResult.isNewUser || !cleanP || cleanP.length < 8 || String(u.phone).startsWith('line_');

          if (isFirstTime) {
            setLineFirstLoginUser({ ...u, lineProfile: oauthResult.lineProfile });
            const initialName = u.name && !u.name.includes('LINE') ? u.name : (oauthResult.lineProfile?.displayName || '');
            setLineFirstLoginName(initialName);
            setLineFirstLoginPhone('');
            setLineFirstLoginRole('tenant');
            setActiveModal('lineFirstLogin');
            showToast('🎉 LINE 授權成功！請填寫姓名、電話並選擇您的會員身分。', 'info');
          } else {
            if (u.role === 'landlord') {
              const { data: lndRec } = await supabase
                .from('landlords')
                .select('*')
                .eq('id', u.id)
                .maybeSingle();

              if (lndRec && lndRec.status === 'approved') {
                setCurrentUser({
                  id: u.id,
                  phone: u.phone,
                  user_metadata: { role: u.role, name: u.name, avatar_url: u.avatar_url }
                });
                setRole('admin');
                setCurrentLandlordId(u.id);
                setCurrentLandlordPhone(u.phone);
                setActiveTab('dashboard');
                try {
                  localStorage.setItem('app_auth_session', JSON.stringify({ id: u.id, phone: u.phone, name: u.name, role: u.role }));
                } catch (e) {}
                showToast(`🎉 LINE 授權快速登入成功！歡迎回來，${u.name}！`, 'success');
              } else {
                // 待審核、拒絕或尚未通過審核：不得進入房東後台！
                await logoutUser();
                if (lndRec && (lndRec.status === 'pending' || lndRec.status === 'rejected')) {
                  setPendingLandlordNotice({
                    open: true,
                    status: lndRec.status,
                    data: {
                      id: u.id,
                      name: u.name,
                      phone: u.phone,
                      companyName: lndRec.company_name,
                      idNumber: lndRec.id_number,
                      contactAddress: lndRec.contact_address,
                      bankName: lndRec.bank_name,
                      bankAccount: lndRec.bank_account,
                      submittedAt: lndRec.created_at ? new Date(lndRec.created_at).toLocaleDateString() : '近日',
                    }
                  });
                  if (lndRec.status === 'rejected') {
                    showToast('您的房東身分審核未通過，請查看詳細說明。', 'error');
                  } else {
                    showToast('您的房東身分正在審核中，請等待平台總管理員開通。', 'info');
                  }
                } else {
                  // 尚未填寫房東查核資料，引導填寫
                  setOnboardingUser({ id: u.id, phone: u.phone, name: u.name });
                  setActiveModal('landlordApplication');
                  showToast('請填寫房東查核資料以供管理員審核開通！', 'info');
                }
                return;
              }
            } else {
              setCurrentUser({
                id: u.id,
                phone: u.phone,
                user_metadata: { role: u.role, name: u.name, avatar_url: u.avatar_url }
              });
              setRole('tenant');
              setCurrentTenantPhone(u.phone);
              setActiveTab('portal');
              try {
                localStorage.setItem('app_auth_session', JSON.stringify({ id: u.id, phone: u.phone, name: u.name, role: u.role }));
              } catch (e) {}
              showToast(`🎉 LINE 授權快速登入成功！歡迎回來，${u.name}！`, 'success');
            }
          }
        }
      } catch (oauthErr) {
        console.warn('LINE OAuth callback processing notice:', oauthErr);
        showToast(oauthErr.message || 'LINE 登入授權失敗', 'error');
      }
    };
    processLineOAuth();
  }, []);

  const handleSaveLineFirstLogin = async (e) => {
    if (e) e.preventDefault();
    const cleanName = sanitizeText(lineFirstLoginName).trim();
    const cleanPhone = String(lineFirstLoginPhone || '').replace(/[^0-9]/g, '').trim();
    const chosenRole = lineFirstLoginRole || 'tenant';

    if (!cleanName || cleanName.length < 2) {
      showToast('請填寫完整真實姓名（至少2個字）！', 'warning');
      return;
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      showToast('請填寫有效的手機電話號碼！', 'warning');
      return;
    }

    if (chosenRole === 'landlord') {
      const idNum = sanitizeText(landlordAppForm.idNumber).trim();
      const addr = sanitizeText(landlordAppForm.contactAddress).trim();
      if (!idNum || idNum.length < 6) {
        showToast('請填寫有效的身分證字號、居留證號或統一編號以供身分查核！', 'warning');
        return;
      }
      if (!addr || addr.length < 5) {
        showToast('請填寫完整通訊聯絡地址！', 'warning');
        return;
      }
    }

    setLineFirstLoginLoading(true);
    try {
      const u = lineFirstLoginUser || {};
      const targetId = u.id || `line_usr_${Date.now()}`;

      // 1. 查詢是否已有該電話的會員 Profile
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('*')
        .eq('phone', cleanPhone);

      let finalId = targetId;
      if (existingProfiles && existingProfiles.length > 0) {
        const existingP = existingProfiles[0];
        finalId = existingP.id;
        await supabase.from('profiles').update({
          name: cleanName,
          role: chosenRole,
          updated_at: new Date().toISOString(),
        }).eq('id', finalId);
      } else {
        await supabase.from('profiles').upsert({
          id: finalId,
          role: chosenRole,
          name: cleanName,
          phone: cleanPhone,
          updated_at: new Date().toISOString(),
        });
      }

      // 2. 寫入 LINE 綁定表
      const lineUid = u.lineProfile?.userId || u.id;
      if (lineUid) {
        try {
          await supabase.from('line_bindings').upsert({
            tenant_id: finalId,
            line_user_id: lineUid,
            line_display_name: cleanName,
            status: 'active',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'line_user_id' });
        } catch (bErr) {
          console.warn('Line binding upsert notice:', bErr);
        }
      }

      // 3. 永久儲存至本機快取以供未來一鍵免輸入登入
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('line_linked_user_id', finalId);
        localStorage.setItem('line_linked_phone', cleanPhone);
        localStorage.setItem('line_linked_name', cleanName);
        localStorage.setItem('line_linked_role', chosenRole);
      }

      // 4. 根據身分分流引導
      if (chosenRole === 'tenant') {
        // 房客身分 → 直接開通登入並進入房客專區
        setCurrentUser({
          id: finalId,
          phone: cleanPhone,
          user_metadata: { role: 'tenant', name: cleanName, avatar_url: u.lineProfile?.pictureUrl }
        });
        setRole('tenant');
        setCurrentTenantPhone(cleanPhone);
        setActiveTab('portal');

        try {
          localStorage.setItem('app_auth_session', JSON.stringify({
            id: finalId,
            phone: cleanPhone,
            name: cleanName,
            role: 'tenant'
          }));
        } catch (e) {}

        setActiveModal(null);
        showToast(`🎉 歡迎 ${cleanName}！已成功為您開通房客會員專區！`, 'success');
      } else {
        // 房東身分 → 直接寫入審核資料並開啟審核狀態告示
        const idNum = sanitizeText(landlordAppForm.idNumber).trim();
        const addr = sanitizeText(landlordAppForm.contactAddress).trim();

        await submitLandlordApplication({
          userId: finalId,
          phone: cleanPhone,
          name: cleanName,
          idNumber: idNum,
          contactAddress: addr,
          companyName: landlordAppForm.companyName,
          bankName: landlordAppForm.bankName,
          bankAccount: landlordAppForm.bankAccount,
          notes: landlordAppForm.notes,
        });

        setActiveModal(null);
        setPendingLandlordNotice({
          open: true,
          status: 'pending',
          data: {
            id: finalId,
            name: cleanName,
            phone: cleanPhone,
            companyName: landlordAppForm.companyName,
            idNumber: idNum,
            contactAddress: addr,
            bankName: landlordAppForm.bankName,
            bankAccount: landlordAppForm.bankAccount,
            submittedAt: new Date().toLocaleDateString(),
          }
        });
        showToast(`🎉 基本資料已完成，房東身分審核申請已送出！請等待平台管理員審核開通。`, 'success');
      }
      fetchSupabaseData();
    } catch (err) {
      console.error('Save LINE first login error:', err);
      showToast('資料儲存異常：' + (err.message || '請重試'), 'error');
    } finally {
      setLineFirstLoginLoading(false);
    }
  };

  // --- 統一登入送出函式 (Unified Member Login: 房東/房客/管理員共用單一入口) ---
  const handleUnifiedLogin = async (e) => {
    if (e) e.preventDefault();
    const cleanPhone = String(authPhone || '').replace(/[^0-9]/g, '').trim();
    const cleanPassword = String(authPassword || '').trim();

    if (!cleanPhone || cleanPhone.length < 8) {
      showToast('請填寫有效的手機號碼！', 'warning');
      return;
    }
    if (!cleanPassword) {
      showToast('請輸入您的登入密碼！', 'warning');
      return;
    }

    setAuthLoading(true);
    try {
      const authResult = await loginUser({ phone: cleanPhone, password: cleanPassword });
      const userProfile = authResult.profile;

      // 1. 系統總管理員
      if (authResult.isSuperadmin || userProfile?.role === 'superadmin') {
        const adminSession = {
          id: 'usr_superadmin',
          phone: cleanPhone || '0900000000',
          name: userProfile?.name || '平台總管理員',
          role: 'superadmin'
        };
        setCurrentUser(authResult.user || adminSession);
        setIsSuperadminAuthenticated(true);
        setRole('superadmin');
        setActiveTab('landlords');
        setAuthPassword('');
        try {
          localStorage.setItem('app_auth_session', JSON.stringify(adminSession));
        } catch (e) {}
        showToast('🎉 系統總管理員身分認證成功！', 'success');
        fetchSupabaseData();
        return;
      }

      // 2. 房東帳號
      if (userProfile?.role === 'landlord') {
        const { data: landlordAccount } = await supabase
          .from('landlords')
          .select('*')
          .eq('id', userProfile.id)
          .maybeSingle();

        if (landlordAccount && (landlordAccount.status === 'pending' || landlordAccount.status === 'rejected')) {
          await logoutUser();
          setPendingLandlordNotice({
            open: true,
            status: landlordAccount.status,
            data: {
              id: userProfile.id,
              name: userProfile.name,
              phone: cleanPhone,
              companyName: landlordAccount.company_name,
              idNumber: landlordAccount.id_number,
              contactAddress: landlordAccount.contact_address,
              bankName: landlordAccount.bank_name,
              bankAccount: landlordAccount.bank_account,
              submittedAt: landlordAccount.created_at ? new Date(landlordAccount.created_at).toLocaleDateString() : '近日',
            }
          });
          if (landlordAccount.status === 'rejected') {
            showToast('您的房東身分審核未通過，請查看詳細說明以進行補件或身分切換。', 'error');
          } else {
            showToast('房東帳戶身分審核中，請待管理員確認開通後登入。', 'warning');
          }
          return;
        }

        const targetId = userProfile.id;
        setCurrentUser(authResult.user);
        setCurrentLandlordId(targetId);
        setCurrentLandlordPhone(cleanPhone);
        setCurrentTenantPhone(cleanPhone);
        setCurrentTenantName(userProfile.name || '');
        setRole('admin');
        setActiveTab('dashboard');
        setAuthPassword('');

        try {
          localStorage.setItem('app_auth_session', JSON.stringify({
            id: targetId,
            phone: cleanPhone,
            name: userProfile.name,
            role: 'landlord'
          }));
        } catch (e) {}

        showToast(`歡迎回來，${userProfile.name} 房東！`, 'success');
        fetchSupabaseData();
        return;
      }

      // 3. 租客帳號
      if (userProfile?.role === 'tenant') {
        const targetId = userProfile.id;
        setCurrentUser(authResult.user);
        setCurrentTenantPhone(cleanPhone);
        setCurrentTenantName(userProfile.name || '');

        // 檢查該租客是否同時擁有已審核通過之房東身分
        const { data: maybeLandlord } = await supabase
          .from('landlords')
          .select('*')
          .eq('phone', cleanPhone)
          .maybeSingle();
        if (maybeLandlord && maybeLandlord.status === 'approved') {
          setCurrentLandlordId(maybeLandlord.id);
          setCurrentLandlordPhone(cleanPhone);
        }

        setRole('tenant');
        setActiveTab('portal');
        setAuthPassword('');

        const userLeases = leases.filter(l =>
          l.phone.replace(/[^0-9]/g, '') === cleanPhone ||
          (l.coPhone && l.coPhone.replace(/[^0-9]/g, '') === cleanPhone)
        );
        if (userLeases.length > 0) {
          setCurrentTenantLeaseId(userLeases[0].id);
        }

        try {
          localStorage.setItem('app_auth_session', JSON.stringify({
            id: targetId,
            phone: cleanPhone,
            name: userProfile.name,
            role: 'tenant'
          }));
        } catch (e) {}

        showToast(`歡迎回來，${userProfile.name}！`, 'success');
        fetchSupabaseData();
        return;
      }

      // 4. 未選身分 (unassigned) -> 彈出身分選擇導引
      setOnboardingUser({
        id: userProfile?.id || authResult.user?.id,
        phone: cleanPhone,
        name: userProfile?.name || '新會員',
      });
      setActiveModal('roleOnboarding');
      setAuthPassword('');
      showToast('歡迎回來！請選擇您的系統身分（我是房客或我是房東）。', 'info');
    } catch (err) {
      showToast(err.message || '登入失敗：帳號或密碼錯誤，請確認後重試。', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  // --- 雙重身分快速切換機制 (Dual-Role Switcher: Landlord <-> Tenant) ---
  const activeUserPhone = String(
    currentLandlordPhone || currentTenantPhone || currentUser?.phone || ''
  ).replace(/[^0-9]/g, '');

  const myLandlordAccount = landlords.find(l =>
    (currentUser?.id && l.id === currentUser.id) ||
    (currentLandlordId && l.id === currentLandlordId) ||
    (l.phone && String(l.phone).replace(/[^0-9]/g, '') === activeUserPhone)
  );

  const isApprovedLandlord = Boolean(myLandlordAccount && myLandlordAccount.status === 'approved');
  const isPendingLandlord = Boolean(myLandlordAccount && myLandlordAccount.status === 'pending');

  const handleSwitchRole = async (targetRole) => {
    if (targetRole === role) return;

    const currentPhone = activeUserPhone;
    const currentName = currentTenantName || currentUser?.user_metadata?.name || myLandlordAccount?.name || '會員';

    if (targetRole === 'admin') {
      // 1. 若想切換為房東模式
      if (!isApprovedLandlord) {
        if (isPendingLandlord) {
          showToast('⏳ 您的房東帳號審核中，待管理員核准後即可開啟房東管理功能！', 'warning');
          return;
        }
        // 尚未申請過房東身分 -> 導引開啟房東認證申請
        setOnboardingUser({
          id: currentUser?.id || myLandlordAccount?.id || `usr_${currentPhone}`,
          phone: currentPhone,
          name: currentName,
        });
        setLandlordAppForm(prev => ({
          ...prev,
          companyName: '',
          idNumber: '',
          contactAddress: '',
          bankName: '',
          bankAccount: '',
          notes: '',
        }));
        setActiveModal('landlordApplication');
        showToast('請填寫房東基本資料以開通房東管理權限！', 'info');
        return;
      }

      setRole('admin');
      setActiveTab('dashboard');
      setCurrentLandlordId(myLandlordAccount.id);
      setCurrentLandlordPhone(myLandlordAccount.phone || currentPhone);

      try {
        localStorage.setItem('app_auth_session', JSON.stringify({
          id: myLandlordAccount.id,
          phone: myLandlordAccount.phone || currentPhone,
          name: currentName,
          role: 'landlord'
        }));
      } catch (e) {}

      showToast(`🔄 已切換至「房東管理後台」(${myLandlordAccount.name || currentName} 房東)`, 'success');
      setIsMobileMenuOpen(false);
      fetchSupabaseData();
    } else if (targetRole === 'tenant') {
      // 2. 若想切換為租客中心模式
      setRole('tenant');
      setActiveTab('portal');
      setCurrentTenantPhone(currentPhone);
      setCurrentTenantName(currentName);

      // 自動選取該租客關聯的第一張有效合約
      const userLeases = leases.filter(l =>
        l.phone.replace(/[^0-9]/g, '') === currentPhone ||
        (l.coPhone && l.coPhone.replace(/[^0-9]/g, '') === currentPhone)
      );
      if (userLeases.length > 0) {
        setCurrentTenantLeaseId(userLeases[0].id);
      }

      try {
        localStorage.setItem('app_auth_session', JSON.stringify({
          id: currentUser?.id || myLandlordAccount?.id,
          phone: currentPhone,
          name: currentName,
          role: 'tenant'
        }));
      } catch (e) {}

      showToast(`🔄 已切換至「租客個人中心」(${currentName})`, 'info');
      setIsMobileMenuOpen(false);
      fetchSupabaseData();
    }
  };

  // --- 統一註冊送出函式 (Unified Phone Registration) ---
  const handleUnifiedRegister = async (e) => {
    if (e) e.preventDefault();
    const cleanName = sanitizeText(authName).trim();
    const cleanPhone = String(authPhone || '').replace(/[^0-9]/g, '').trim();
    const cleanPassword = String(authPassword || '').trim();
    const chosenRole = authRole || 'tenant';

    if (!cleanName || cleanName.length < 2) {
      showToast('請填寫真實姓名（至少2個字）！', 'warning');
      return;
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      showToast('請填寫有效的手機號碼！', 'warning');
      return;
    }
    if (!cleanPassword || cleanPassword.length < 6) {
      showToast('密碼長度至少需 6 碼以上！', 'warning');
      return;
    }

    setAuthLoading(true);
    try {
      const regResult = await registerUser({
        name: cleanName,
        phone: cleanPhone,
        password: cleanPassword,
        requestedRole: chosenRole,
      });

      setAuthName('');
      setAuthPassword('');

      if (chosenRole === 'tenant') {
        // 房客身分 → 直接開通並登入房客專區
        setCurrentUser({
          id: regResult.id,
          phone: cleanPhone,
          user_metadata: { role: 'tenant', name: cleanName }
        });
        setRole('tenant');
        setCurrentTenantPhone(cleanPhone);
        setCurrentTenantName(cleanName);
        setActiveTab('portal');

        try {
          localStorage.setItem('app_auth_session', JSON.stringify({
            id: regResult.id,
            phone: cleanPhone,
            name: cleanName,
            role: 'tenant'
          }));
        } catch (e) {}

        showToast(`🎉 歡迎加入！已成功為您建立帳號並開通房客專區！`, 'success');
        fetchSupabaseData();
      } else {
        // 房東身分 → 進入房東身分審核資料填寫
        setOnboardingUser({
          id: regResult.id,
          phone: cleanPhone,
          name: cleanName,
        });
        setLandlordAppForm(prev => ({
          ...prev,
          companyName: '',
          idNumber: '',
          contactAddress: '',
          bankName: '',
          bankAccount: '',
          notes: '',
        }));
        setActiveModal('landlordApplication');
        showToast('🎉 帳號建立成功！請填寫房東身分審核資料。', 'info');
      }
    } catch (err) {
      showToast(err.message || '註冊失敗，請重試', err.message?.includes('已被註冊') ? 'warning' : 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  // --- 身分選擇：我是房客 (免審核即開即用) ---
  const handleSelectTenantRole = async () => {
    if (!onboardingUser) return;
    setOnboardingLoading(true);
    try {
      await completeTenantOnboarding({
        userId: onboardingUser.id,
        phone: onboardingUser.phone,
        name: onboardingUser.name,
      });

      setCurrentUser({
        id: onboardingUser.id,
        phone: onboardingUser.phone,
        user_metadata: { role: 'tenant', name: onboardingUser.name }
      });
      setRole('tenant');
      setCurrentTenantPhone(onboardingUser.phone);
      setActiveTab('portal');

      try {
        localStorage.setItem('app_auth_session', JSON.stringify({
          id: onboardingUser.id,
          phone: onboardingUser.phone,
          name: onboardingUser.name,
          role: 'tenant'
        }));
      } catch (e) {}

      setActiveModal(null);
      setOnboardingUser(null);
      showToast(`🎉 歡迎加入！您已成功開通房客會員專區！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast('開通失敗: ' + (err.message || '請重試'), 'error');
    } finally {
      setOnboardingLoading(false);
    }
  };

  // --- 身分選擇：我是房東 (進入詳細資料填寫) ---
  const handleSelectLandlordRole = () => {
    if (!onboardingUser) return;
    setLandlordAppForm(prev => ({
      ...prev,
      companyName: '',
      idNumber: '',
      contactAddress: '',
      bankName: '',
      bankAccount: '',
      notes: '',
    }));
    setActiveModal('landlordApplication');
  };

  // --- 提交房東認證資料 (送出後狀態為待審核) ---
  const handleSubmitLandlordApplication = async (e) => {
    if (e) e.preventDefault();

    const targetUserId = onboardingUser?.id || currentUser?.id || myLandlordAccount?.id || `usr_${activeUserPhone}`;
    const targetPhone = onboardingUser?.phone || activeUserPhone || currentTenantPhone;
    const targetName = onboardingUser?.name || currentTenantName || currentUser?.user_metadata?.name || myLandlordAccount?.name || '房東';

    if (!targetPhone) {
      showToast('缺少聯絡電話，請重新登入後再試！', 'error');
      return;
    }

    const idNum = sanitizeText(landlordAppForm.idNumber).trim();
    const addr = sanitizeText(landlordAppForm.contactAddress).trim();

    if (!idNum || idNum.length < 6) {
      showToast('請填寫有效的身分證字號、居留證號或統一編號以供身分查核！', 'warning');
      return;
    }
    if (!addr || addr.length < 5) {
      showToast('請填寫完整通訊聯絡地址！', 'warning');
      return;
    }

    setLandlordAppLoading(true);
    try {
      await submitLandlordApplication({
        userId: targetUserId,
        phone: targetPhone,
        name: targetName,
        idNumber: idNum,
        contactAddress: addr,
        companyName: landlordAppForm.companyName,
        bankName: landlordAppForm.bankName,
        bankAccount: landlordAppForm.bankAccount,
        notes: landlordAppForm.notes,
      });

      setActiveModal(null);
      setPendingLandlordNotice({
        open: true,
        status: 'pending',
        data: {
          id: targetUserId,
          name: targetName,
          phone: targetPhone,
          companyName: landlordAppForm.companyName,
          idNumber: idNum,
          contactAddress: addr,
          bankName: landlordAppForm.bankName,
          bankAccount: landlordAppForm.bankAccount,
          submittedAt: new Date().toLocaleDateString(),
        }
      });

      setOnboardingUser(null);
      showToast('🎉 房東身分申請已送出！請等待平台管理員確認開通。', 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast('申請送出失敗: ' + (err.message || '請重試'), 'error');
    } finally {
      setLandlordAppLoading(false);
    }
  };

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const [lineLoginRole, setLineLoginRole] = useState('tenant');
  const [lineLoginInput, setLineLoginInput] = useState('');
  const [lineLoginLoading, setLineLoginLoading] = useState(false);

  const handleOpenLineLoginModal = (targetRole = 'tenant') => {
    setLineLoginRole(targetRole);
    setLineLoginInput('');
    setActiveModal('lineLogin');
  };

  const handleExecuteLineLogin = async (e) => {
    if (e) e.preventDefault();
    const cleanInput = lineLoginInput.trim();
    if (!cleanInput) {
      showToast('請輸入綁定代碼或綁定的手機號碼！', 'warning');
      return;
    }
    setLineLoginLoading(true);
    try {
      const cleanPhone = cleanInput.replace(/[^0-9]/g, '');
      let matchedProfile = null;
      if (cleanPhone.length >= 8) {
        const { data: profs } = await supabase.from('profiles').select('*').eq('phone', cleanPhone);
        matchedProfile = profs?.[0];
      }

      if (!matchedProfile) {
        const { data: tokens } = await supabase.from('line_binding_tokens').select('*').eq('token', cleanInput.toUpperCase());
        if (tokens && tokens[0]) {
          const { data: profs } = await supabase.from('profiles').select('*').or(`id.eq.${tokens[0].tenant_id}`);
          matchedProfile = profs?.[0];
        }
      }

      if (!matchedProfile) {
        const { data: bindings } = await supabase.from('line_bindings').select('*').eq('status', 'active');
        const found = (bindings || []).find(b => b.line_user_id === cleanInput || b.tenant_id === cleanInput);
        if (found) {
          const { data: profs } = await supabase.from('profiles').select('*').eq('id', found.tenant_id);
          matchedProfile = profs?.[0];
        }
      }

      if (matchedProfile) {
        setCurrentUser({ id: matchedProfile.id, phone: matchedProfile.phone, user_metadata: { role: matchedProfile.role, name: matchedProfile.name } });
        if (matchedProfile.role === 'landlord' || lineLoginRole === 'landlord') {
          setRole('admin');
          setCurrentLandlordId(matchedProfile.id);
          setCurrentLandlordPhone(matchedProfile.phone);
          setActiveTab('dashboard');
        } else {
          setRole('tenant');
          setCurrentTenantPhone(matchedProfile.phone);
          setActiveTab('portal');
        }
        setActiveModal(null);
        showToast(`🎉 LINE 授權快速登入成功！歡迎回來，${matchedProfile.name}！`, 'success');
      } else {
        showToast('未查到相符的 LINE 綁定或會員帳號，請輸入綁定手機號碼或使用密碼登入。', 'error');
      }
    } catch (err) {
      showToast('LINE 登入處理失敗: ' + err.message, 'error');
    } finally {
      setLineLoginLoading(false);
    }
  };
  const [lineBindingTokenData, setLineBindingTokenData] = useState(null);
  const [lineBindingLoading, setLineBindingLoading] = useState(false);

  const handleOpenLineBinding = async () => {
    setLineBindingLoading(true);
    try {
      const targetId = currentUser?.id || (currentTenantPhone ? `tenant_${currentTenantPhone}` : 'tenant_user');
      const tokenResult = await generateLineBindingToken(targetId);
      setLineBindingTokenData(tokenResult);
      setActiveModal('lineBinding');
    } catch (err) {
      console.warn('LINE binding token fallback:', err);
      const mockToken = Math.random().toString(36).substring(2, 8).toUpperCase();
      setLineBindingTokenData({
        token: mockToken,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        expiresInSeconds: 600,
      });
      setActiveModal('lineBinding');
    } finally {
      setLineBindingLoading(false);
    }
  };

  const handleTenantSelfRegister = async (e) => {
    if (e) e.preventDefault();
    const cleanName = sanitizeText(tenantSelfName);
    const cleanPhone = tenantSelfPhone.replace(/[^0-9]/g, '');
    const password = tenantSelfPassword;

    if (!cleanName || !cleanPhone || !password) {
      showToast('請填寫完整註冊欄位！', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('密碼長度至少需 6 碼以上！', 'warning');
      return;
    }

    try {
      const registeredResult = await registerUser({
        name: cleanName,
        phone: cleanPhone,
        password: password,
        requestedRole: 'tenant'
      });

      setTenantSelfName('');
      setTenantSelfPhone('');
      setTenantSelfPassword('');
      setTenantAuthMode('login');
      setTenantLoginPhone(cleanPhone);
      showToast(registeredResult.needsEmailConfirmation
        ? '註冊成功！請先完成信箱驗證後再登入。'
        : '🎉 註冊成功！請使用電話與密碼進行登入。', 'success');
    } catch (err) {
      showToast(err.message || '註冊失敗，請重試', err.message?.includes('已被註冊') ? 'warning' : 'error');
    }
  };

  const handleTenantLogin = async (e) => {
    if (e) e.preventDefault();
    const cleanPhone = tenantLoginPhone.replace(/[^0-9]/g, '');
    const password = tenantLoginPassword;

    if (!cleanPhone || !password) {
      showToast('請輸入電話號碼與密碼', 'error');
      return;
    }

    try {
      const authResult = await loginUser({ phone: cleanPhone, password, expectedRole: 'tenant' });
      setCurrentUser(authResult.user);
      setCurrentTenantPhone(String(authResult.profile.phone || cleanPhone).replace(/[^0-9]/g, ''));

      const userLeases = leases.filter(l =>
        l.phone.replace(/[^0-9]/g, '') === cleanPhone ||
        (l.coPhone && l.coPhone.replace(/[^0-9]/g, '') === cleanPhone)
      );

      if (userLeases.length > 0) {
        setCurrentTenantLeaseId(userLeases[0].id);
      } else {
        setCurrentTenantLeaseId(null);
      }

      try {
        localStorage.setItem('app_auth_session', JSON.stringify({ id: authResult.profile?.id, phone: cleanPhone, name: authResult.profile?.name, role: 'tenant' }));
      } catch (e) {}

      setTenantLoginPhone('');
      setTenantLoginPassword('');
      setActiveTab('portal');
      const matched = registeredTenants.find(t => t.phone.replace(/[^0-9]/g, '') === cleanPhone);
      showToast(`歡迎回來，${matched?.name || authResult?.profile?.name || '租客'}！`, 'success');
    } catch (err) {
      // P0/P2: 統一錯誤訊息，防止帳號列舉攻擊
      showToast('登入失敗：帳號或密碼錯誤，請確認後重試。', 'error');
    }
  };

  const handleLandlordLogin = async (e) => {
    if (e) e.preventDefault();
    const cleanInputPhone = String(landlordLoginPhone || '').replace(/[^0-9]/g, '').trim();
    const cleanInputPassword = String(landlordLoginPassword || '').trim();

    if (!cleanInputPhone || !cleanInputPassword) {
      showToast('請輸入房東電話號碼與登入密碼！', 'error');
      return;
    }

    try {
      const authResult = await loginUser({ phone: cleanInputPhone, password: cleanInputPassword, expectedRole: 'landlord' });
      const matchedLandlord = landlords.find(l => String(l.phone || '').replace(/[^0-9]/g, '') === cleanInputPhone);

      const { data: landlordAccount } = await supabase
        .from('landlords')
        .select('status')
        .eq('id', authResult.profile.id)
        .maybeSingle();

      if (landlordAccount && (landlordAccount.status === 'pending' || landlordAccount.status === 'rejected')) {
        await logoutUser();
        setPendingLandlordNotice({
          open: true,
          data: {
            name: authResult.profile.name,
            phone: cleanInputPhone,
            companyName: landlordAccount.company_name,
            submittedAt: landlordAccount.created_at ? new Date(landlordAccount.created_at).toLocaleDateString() : '近日',
          }
        });
        showToast('房東帳戶身分審核中，請待管理員審核通過後登入。', 'warning');
        return;
      }

      const targetId = authResult.profile.id;
      setCurrentUser(authResult.user);
      setCurrentLandlordId(targetId);
      setCurrentLandlordPhone(String(authResult.profile.phone || cleanInputPhone).replace(/[^0-9]/g, ''));

      try {
        localStorage.setItem('app_auth_session', JSON.stringify({ id: targetId, phone: cleanInputPhone, name: authResult.profile?.name, role: 'landlord' }));
      } catch (e) {}

      setActiveTab('dashboard');
      if (matchedLandlord) {
        setLandlordLoginPhone('');
        setLandlordLoginPassword('');
        showToast(`歡迎回來，${matchedLandlord.name} 房東！`, 'success');
      } else if (authResult?.profile) {
        const newLnd = authResult.profile;
        setLandlords(prev => [...prev.filter(l => l.id !== newLnd.id), newLnd]);
        setLandlordLoginPhone('');
        setLandlordLoginPassword('');
        showToast(`歡迎回來，${newLnd.name} 房東！`, 'success');
      } else {
        showToast('登入失敗：帳號或密碼錯誤，請確認後重新輸入。', 'error');
      }
    } catch (err) {
      // P0/P2: 統一錯誤訊息，防止帳號列舉攻擊
      showToast('登入失敗：帳號或密碼錯誤，請確認後重新輸入。', 'error');
    }
  };

  const handleSuperadminLogin = async (e) => {
    if (e) e.preventDefault();
    const cleanPhone = String(superadminLoginPhone || '').replace(/[^0-9]/g, '').trim();
    const cleanPwd = String(superadminPasswordInput || '').trim();
    if (!cleanPhone || !cleanPwd) {
      showToast('請輸入管理員電話與密碼！', 'error');
      return;
    }

    setSuperadminLoginLoading(true);
    try {
      const authResult = await loginUser({ phone: cleanPhone, password: cleanPwd, expectedRole: 'superadmin' });
      setCurrentUser(authResult.user);
      setRole('superadmin');
      setIsSuperadminAuthenticated(true);
      try {
        localStorage.setItem('app_auth_session', JSON.stringify({ id: 'usr_superadmin', phone: cleanPhone, name: '平台總管理員', role: 'superadmin' }));
      } catch (e) {}

      setActiveTab('landlords');
      setSuperadminLoginPhone('');
      setSuperadminPasswordInput('');
      showToast('🎉 系統管理員驗證通過，歡迎進入平台總管理後台！', 'success');
    } catch (err) {
      showToast('身分驗證異常，請重試', 'error');
    } finally {
      setSuperadminLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    if (role === 'tenant') {
      setCurrentTenantPhone(null);
      setCurrentTenantLeaseId(null);
      showToast('已成功登出您的租客帳號！', 'success');
    } else if (role === 'admin') {
      setCurrentLandlordId(null);
      setCurrentLandlordPhone(null);
      showToast('已登出房東管理系統！', 'success');
    } else if (role === 'superadmin') {
      setIsSuperadminAuthenticated(false);
      setSuperadminLoginPhone('');
      setSuperadminPasswordInput('');
      showToast('已登出系統管理員！', 'success');
    }
    setRole('portal');
  };

  const handleLandlordSelfRegister = async (e) => {
    if (e) e.preventDefault();
    const cleanName = sanitizeText(landlordSelfName);
    const cleanPhone = landlordSelfPhone.replace(/[^0-9]/g, '');
    const password = landlordSelfPassword;

    if (!cleanName || !cleanPhone || !password) {
      showToast('請填寫姓名、電話與登入密碼！', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('密碼長度至少需 6 碼以上！', 'warning');
      return;
    }

    try {
      const registeredResult = await registerUser({
        name: cleanName,
        phone: cleanPhone,
        password: password,
        requestedRole: 'landlord'
      });
      setLandlordSelfName('');
      setLandlordSelfPhone('');
      setLandlordSelfPassword('');
      await logoutUser();
      setRole('portal');
      showToast(registeredResult.needsEmailConfirmation
        ? '申請已送出，請先完成信箱驗證；管理員審核後即可登入。'
        : '申請已送出，待管理員審核通過後即可登入。', 'success');
    } catch (err) {
      showToast(err.message || '註冊失敗，請重試', err.message?.includes('已被註冊') ? 'warning' : 'error');
    }
  };

  const handleApproveLandlord = async (landlordId, landlordName) => {
    try {
      const { error: rpcErr } = await supabase.rpc('approve_landlord_account', { p_landlord_id: landlordId });
      if (rpcErr) {
        // 降級容錯：直接更新 landlords 表
        const { error: updateErr } = await supabase
          .from('landlords')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', landlordId);
        if (updateErr) throw updateErr;
      }
      setLandlords(landlords.map(l =>
        l.id === landlordId ? { ...l, status: 'approved' } : l
      ));
      showToast(`已成功核准房東「${landlordName}」的註冊申請！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast(`核准失敗: ${err.message}`, 'error');
    }
  };

  const handleRejectLandlord = async (landlordId, landlordName) => {
    const confirmed = await showConfirmDialog(`確定要拒絕並停用房東「${landlordName}」的註冊申請嗎？`);
    if (confirmed) {
      try {
        const { error: rpcErr } = await supabase.rpc('reject_landlord_account', { p_landlord_id: landlordId });
        if (rpcErr) {
          const { error: updateErr } = await supabase
            .from('landlords')
            .update({ status: 'rejected', updated_at: new Date().toISOString() })
            .eq('id', landlordId);
          if (updateErr) throw updateErr;
        }
        setLandlords(landlords.filter(l => l.id !== landlordId));
        showToast(`已成功停用房東「${landlordName}」`, 'info');
        fetchSupabaseData();
      } catch (err) {
        showToast(`刪除失敗: ${err.message}`, 'error');
      }
    }
  };

  const handleSuperadminDeleteLandlord = async (landlordId, landlordName, landlordPhone) => {
    const confirmed = await showConfirmDialog(`確定要徹底刪除房東「${landlordName}」嗎？這將會一併移除該房東的所有房源、租約與專屬地址庫。`);
    if (!confirmed) return;

    try {
      const cleanPhone = String(landlordPhone || '').replace(/[^0-9]/g, '');

      // 0. 呼叫管理員級 RPC 徹底清理 auth.users 與所有關聯
      try {
        await supabase.rpc('delete_user_by_admin', { 
          target_user_id: String(landlordId || ''), 
          target_phone: cleanPhone 
        });
      } catch (rpcErr) {
        console.warn('RPC delete_user_by_admin notice:', rpcErr);
      }

      // 1. 查詢該房東名下所有房源
      const { data: props } = await supabase.from('properties').select('id').eq('landlord_id', landlordId);
      const propIds = (props || []).map(p => p.id);

      // 2. 刪除關聯帳單、合約與房源
      if (propIds.length > 0) {
        const { data: lData } = await supabase.from('leases').select('id').in('property_id', propIds);
        const leaseIds = (lData || []).map(l => l.id);
        if (leaseIds.length > 0) {
          await supabase.from('payments').delete().in('lease_id', leaseIds);
          await supabase.from('leases').delete().in('id', leaseIds);
        }
        await supabase.from('properties').delete().eq('landlord_id', landlordId);
      }

      // 3. 刪除房東地址庫與 LINE 綁定
      await supabase.from('landlord_addresses').delete().eq('landlord_id', landlordId);
      if (landlordId) {
        await supabase.from('line_bindings').delete().or(`tenant_id.eq.${landlordId},line_user_id.eq.${landlordId}`);
        await supabase.from('line_binding_tokens').delete().eq('tenant_id', landlordId);
      }

      // 4. 刪除 landlords 表與 profiles 表
      await supabase.from('landlords').delete().or(`id.eq.${landlordId || 'none'},phone.eq.${cleanPhone}`);
      if (cleanPhone) {
        await supabase.from('profiles').delete().or(`id.eq.${landlordId || 'none'},phone.eq.${cleanPhone}`);
      } else {
        await supabase.from('profiles').delete().eq('id', landlordId);
      }

      // 5. 更新本地狀態
      setLandlords(prev => prev.filter(l => l.id !== landlordId));
      setProperties(prev => prev.filter(p => p.landlordId !== landlordId));
      setLandlordAddresses(prev => prev.filter(a => a.landlordId !== landlordId));

      showToast(`已成功徹底刪除房東「${landlordName}」及其所有資料！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      console.error('Delete landlord error:', err);
      showToast(`刪除房東失敗: ${err.message || '資料庫操作異常'}`, 'error');
    }
  };

  const handleSuperadminDeleteTenant = async (tenantPhone, tenantName, tenantId) => {
    const confirmed = await showConfirmDialog(`確定要徹底註銷租客「${tenantName}」(${tenantPhone}) 的會員帳戶嗎？`);
    if (!confirmed) return;

    try {
      const cleanPhone = String(tenantPhone || '').replace(/[^0-9]/g, '');

      // 0. 呼叫管理員級 RPC 徹底清理 auth.users 與所有關聯
      try {
        await supabase.rpc('delete_user_by_admin', { 
          target_user_id: String(tenantId || ''), 
          target_phone: cleanPhone 
        });
      } catch (rpcErr) {
        console.warn('RPC delete_user_by_admin notice:', rpcErr);
      }

      // 1. 刪除 LINE 綁定表記錄
      if (tenantId) {
        await supabase.from('line_bindings').delete().or(`tenant_id.eq.${tenantId},line_user_id.eq.${tenantId}`);
        await supabase.from('line_binding_tokens').delete().eq('tenant_id', tenantId);
      }

      // 2. 刪除 tenants 表
      if (tenantId) {
        await supabase.from('tenants').delete().eq('id', tenantId);
      }

      // 3. 刪除 profiles 表
      if (cleanPhone) {
        await supabase.from('profiles').delete().or(`id.eq.${tenantId || 'none'},phone.eq.${cleanPhone}`);
      } else if (tenantId) {
        await supabase.from('profiles').delete().eq('id', tenantId);
      }

      // 4. 更新本地狀態
      setRegisteredTenants(prev => prev.filter(rt => rt.phone !== tenantPhone && rt.id !== tenantId));

      showToast(`已成功註銷並刪除租客「${tenantName}」之會員帳號！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      console.error('Delete tenant error:', err);
      showToast(`註銷租客失敗: ${err.message || '資料庫操作異常'}`, 'error');
    }
  };



  const currentLandlord = landlords.find(l =>
    (currentLandlordId && l.id === currentLandlordId) ||
    (currentLandlordPhone && String(l.phone || '').replace(/[^0-9]/g, '') === String(currentLandlordPhone).replace(/[^0-9]/g, ''))
  );
  const activeLandlordId = currentLandlord?.id || currentLandlordId;

  const isMyLandlordProp = (p) => {
    if (p.deletedAt) return false; // 排除軟刪除房源，不在活躍列表顯示
    if (role === 'admin') return true; // 房東後台載入的房源皆為自身房源
    if (activeLandlordId && p.landlordId === activeLandlordId) return true;
    if (currentLandlordId && p.landlordId === currentLandlordId) return true;
    if (currentLandlord && p.landlordId === currentLandlord.id) return true;
    return false;
  };

  const landlordPropertyIds = properties.filter(isMyLandlordProp).map(p => p.id);
  const landlordLeases = leases.filter(l =>
    role === 'admin' ||
    landlordPropertyIds.includes(l.propertyId) ||
    (activeLandlordId && l.landlordId === activeLandlordId) ||
    (currentLandlord && l.landlordId === currentLandlord.id)
  );
  const landlordLeaseIds = landlordLeases.map(l => l.id);
  const landlordPayments = payments.filter(p =>
    role === 'admin' ||
    landlordLeaseIds.includes(p.leaseId)
  );

  const markAsPaid = async (paymentId) => {
    const today = new Date().toISOString().split('T')[0];
    try {
      await transitionPaymentStatus({
        paymentId,
        newStatus: PaymentStatus.PAID,
        metadata: { operator: 'landlord' }
      });
      setPayments(payments.map(p =>
        p.id === paymentId ? { ...p, status: 'paid', paidDate: today } : p
      ));
      showToast('已確認收款並標記為「已付款」', 'success');
    } catch (err) {
      showToast(`標記失敗: ${err.message}`, 'error');
    }
  };

  const handleToggleAdvertiseWithConfirm = async (propertyId, propertyName, currentIsAdvertised) => {
    const currentLandlord = landlords.find(l => l.id === currentLandlordId);
    if (!currentLandlord?.adListingEnabled) {
      showToast('⚠️ 您的帳號尚未開通廣告刊登權限！需由管理員在後台開啟後方可刊登。', 'error');
      return;
    }

    const nextState = !currentIsAdvertised;
    const nextStateText = nextState ? '刊登中' : '未刊登';
    const confirmed = await showConfirmDialog(
      `確定要將房源「${propertyName}」的廣告刊登狀態變更為「${nextStateText}」嗎？\n\n💡 刊登後將公開於租屋廣告牆，讓租客即時瀏覽房源與實景照片。`
    );
    if (!confirmed) return;

    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('properties')
          .update({
            is_advertised: nextState,
            updated_at: new Date().toISOString()
          })
          .eq('id', propertyId);

        if (error) throw error;
      }

      setProperties(prev => prev.map(p => {
        if (p.id === propertyId) {
          return { ...p, isAdvertised: nextState };
        }
        return p;
      }));
      showToast(`房源「${propertyName}」廣告狀態已成功變更為「${nextStateText}」並同步至雲端！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      console.error('Toggle advertise error:', err);
      showToast(`廣告刊登變更失敗: ${err.message}`, 'error');
    }
  };

  const handleToggleLandlordAdPermission = async (landlordId, currentStatus) => {
    const lnd = landlords.find(l => l.id === landlordId);
    const actionText = !currentStatus ? '開通啟用' : '關閉停用';
    const confirmed = await showConfirmDialog(
      `確定要為房東「${lnd?.name || '此房東'}」${actionText}「廣告刊登」功能權限嗎？`
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc('set_landlord_ad_listing', {
        p_landlord_id: landlordId,
        p_enabled: !currentStatus,
      });
      if (error) throw error;
      setLandlords(prev => prev.map(l => l.id === landlordId ? { ...l, adListingEnabled: !currentStatus } : l));
      showToast(`已成功${actionText}房東「${lnd?.name || ''}」的廣告刊登權限！`, 'success');
    } catch (err) {
      showToast(`變更權限失敗: ${err.message}`, 'error');
    }
  };

  const handleTogglePropertyStatusWithConfirm = async (propertyId, propertyName, currentStatus) => {
    const nextStatusText = currentStatus === 'vacant' ? '已出租' : '未出租';
    const confirmed = await showConfirmDialog(
      `確定要將房源「${propertyName}」的狀態變更為「${nextStatusText}」嗎？`
    );
    if (!confirmed) return;

    setProperties(prev => prev.map(p => {
      if (p.id === propertyId) {
        const nextStatus = currentStatus === 'vacant' ? 'occupied' : 'vacant';
        return { ...p, status: nextStatus };
      }
      return p;
    }));
  };

  const handleOpenPhotoModal = (property) => {
    setPhotoModalProperty(property);
    setTempPhotos(property.photos || []);
    setPhotoInputUrl('');
    setActiveModal('managePhotos');
  };

  const handlePhotoFileUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    let loaded = 0;
    const newImgs = [];

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const dataUrl = uploadEvent.target.result;
        newImgs.push({
          id: `IMG_${Date.now()}_${idx}_${Math.floor(Math.random() * 10000)}`,
          url: dataUrl,
          name: file.name,
          isCover: tempPhotos.length === 0 && newImgs.length === 1
        });
        loaded++;
        if (loaded === files.length) {
          setTempPhotos(prev => {
            const hasCover = prev.some(p => p.isCover) || newImgs.some(p => p.isCover);
            const combined = [...prev, ...newImgs];
            if (!hasCover && combined.length > 0) {
              combined[0].isCover = true;
            }
            return combined;
          });
          showToast(`已成功載入 ${files.length} 張房源照片！請記得點擊下方「儲存照片」保存。`, 'success');
        }
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const handleMovePhoto = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= tempPhotos.length) return;
    const updated = [...tempPhotos];
    const item = updated.splice(index, 1)[0];
    updated.splice(targetIndex, 0, item);
    setTempPhotos(updated);
  };

  const handleSetCoverPhoto = (photoId) => {
    setTempPhotos(prev => prev.map(img => ({
      ...img,
      isCover: img.id === photoId
    })));
    showToast('已將此張照片設為房源封面主圖！', 'success');
  };

  const handleAddPhoto = (url) => {
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    if (!cleanUrl) return;
    const newPhoto = {
      id: `IMG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      url: cleanUrl,
      isCover: tempPhotos.length === 0
    };
    setTempPhotos([...tempPhotos, newPhoto]);
    setPhotoInputUrl('');
    showToast('已加入照片網址！', 'success');
  };

  const handleDeletePhoto = (photoId) => {
    const updated = tempPhotos.filter(img => img.id !== photoId);
    if (tempPhotos.find(img => img.id === photoId)?.isCover && updated.length > 0) {
      updated[0].isCover = true;
    }
    setTempPhotos(updated);
    showToast('已移除該張照片', 'info');
  };

  const handleSavePhotos = async () => {
    if (!photoModalProperty) return;
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('properties')
          .update({
            photos: tempPhotos,
            updated_at: new Date().toISOString()
          })
          .eq('id', photoModalProperty.id);
        if (error) throw error;
      }
      setProperties(prev => prev.map(p => {
        if (p.id === photoModalProperty.id) {
          return { ...p, photos: tempPhotos };
        }
        return p;
      }));
      setActiveModal(null);
      setPhotoModalProperty(null);
      showToast('房源照片已成功更新並儲存至雲端！', 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast(`照片儲存失敗: ${err.message}`, 'error');
    }
  };

  const handleAddProperty = async (e) => {
    if (e) e.preventDefault();
    if (!propName.trim() || !propRent || !propAddress.trim()) {
      showToast('請填寫房源名稱、租金，並選擇租屋地址！', 'error');
      return;
    }
    const nextIdNum = properties.reduce((max, p) => Math.max(max, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0) + 1;
    const newProp = {
      id: `P${String(nextIdNum).padStart(3, '0')}`,
      landlordId: currentLandlordId,
      name: propName.trim(),
      type: propType,
      rent: Number(propRent),
      rentPeriod: propRentPeriod,
      status: 'vacant',
      address: propAddress.trim(),
      isAdvertised: false,
      photos: [],
      deletedAt: null
    };

    try {
      if (isSupabaseConfigured && currentLandlordId) {
        const { data: insertedRows, error: insertErr } = await supabase.from('properties').insert({
          id: newProp.id,
          landlord_id: currentLandlordId,
          name: newProp.name,
          type: newProp.type,
          rent: newProp.rent,
          rent_period: newProp.rentPeriod,
          status: 'vacant',
          address: newProp.address,
          is_advertised: false,
          photos: []
        }).select();
        if (insertErr) throw insertErr;
        if (insertedRows && insertedRows[0]) {
          newProp.id = insertedRows[0].id;
        }
      }
      setProperties(prev => {
        if (prev.some(p => p.id === newProp.id)) return prev;
        return [...prev, newProp];
      });
      setActiveModal(null);
      showToast(`房源「${propName}」新增成功並同步至雲端！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast(`新增失敗: ${err.message}`, 'error');
    }
  };

  const handleEditPropertyOpen = (prop) => {
    setEditingProperty(prop);
    setPropName(prop.name);
    setPropType(prop.type);
    setPropRent(prop.rent);
    setPropRentPeriod(prop.rentPeriod || 'monthly');
    setPropStatus(prop.status);
    setPropAddress(prop.address || '');
    setPropIsAdvertised(prop.isAdvertised || false);
    setActiveModal('editProperty');
  };

  const handleEditPropertySubmit = async (e) => {
    e.preventDefault();
    try {
      if (isSupabaseConfigured && editingProperty) {
        await supabase.from('properties').update({
          name: propName.trim(),
          type: propType,
          rent: Number(propRent),
          rent_period: propRentPeriod,
          status: propStatus,
          address: propAddress.trim(),
          is_advertised: propIsAdvertised,
          updated_at: new Date().toISOString()
        }).eq('id', editingProperty.id);
      }
      setProperties(properties.map(p =>
        p.id === editingProperty.id ? {
          ...p,
          name: propName.trim(),
          type: propType,
          rent: Number(propRent),
          rentPeriod: propRentPeriod,
          status: propStatus,
          address: propAddress.trim(),
          isAdvertised: propIsAdvertised
        } : p
      ));
      setActiveModal(null);
      showToast(`房源「${propName}」修改成功並同步至雲端！`, 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast(`修改失敗: ${err.message}`, 'error');
    }
  };

  const handleDeleteProperty = async (propertyId) => {
    const target = properties.find(p => p.id === propertyId);
    const confirmed = await showConfirmDialog(`確定要將房源「${target?.name || ''}」下架/刪除嗎？歷史租約與帳單紀錄將會完整保留。`);
    if (confirmed) {
      try {
        const nowIso = new Date().toISOString();
        if (isSupabaseConfigured) {
          await supabase.from('properties').update({ deleted_at: nowIso }).eq('id', propertyId);
        }
        setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, deletedAt: nowIso } : p));
        showToast('房源已成功下架！歷史紀錄已安全留存於雲端。', 'success');
        fetchSupabaseData();
      } catch (err) {
        showToast(`刪除失敗: ${err.message}`, 'error');
      }
    }
  };

  // Drag and Drop & Long-Press Reordering States
  const [draggedPropId, setDraggedPropId] = useState(null);
  const [dragOverPropId, setDragOverPropId] = useState(null);
  const [touchPropId, setTouchPropId] = useState(null);

  const [draggedPhotoId, setDraggedPhotoId] = useState(null);
  const [dragOverPhotoId, setDragOverPhotoId] = useState(null);
  const [touchPhotoId, setTouchPhotoId] = useState(null);

  // Property Drag & Touch Handlers
  const handlePropDragStart = (e, propId) => {
    setDraggedPropId(propId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', propId);
  };

  const handlePropDragOver = (e, targetPropId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPropId !== targetPropId) {
      setDragOverPropId(targetPropId);
    }
  };

  const handlePropDrop = (e, targetPropId) => {
    e.preventDefault();
    if (!draggedPropId || draggedPropId === targetPropId) {
      setDraggedPropId(null);
      setDragOverPropId(null);
      return;
    }

    const landlordProps = properties.filter(p => p.landlordId === currentLandlordId);
    const sourceIndex = landlordProps.findIndex(p => p.id === draggedPropId);
    const targetIndex = landlordProps.findIndex(p => p.id === targetPropId);

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedPropId(null);
      setDragOverPropId(null);
      return;
    }

    const reorderedLandlordProps = [...landlordProps];
    const [moved] = reorderedLandlordProps.splice(sourceIndex, 1);
    reorderedLandlordProps.splice(targetIndex, 0, moved);

    let lpIdx = 0;
    const newProperties = properties.map(p => {
      if (p.landlordId === currentLandlordId) {
        return reorderedLandlordProps[lpIdx++];
      }
      return p;
    });

    setProperties(newProperties);
    setDraggedPropId(null);
    setDragOverPropId(null);
    showToast(`已移動房源「${moved.name}」的排列順序！`, 'success');
  };

  const handlePropDragEnd = () => {
    setDraggedPropId(null);
    setDragOverPropId(null);
  };

  const handlePropTouchStart = (propId) => {
    setTouchPropId(propId);
  };

  const handlePropTouchMove = (e) => {
    if (!touchPropId) return;
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropItem = targetEl?.closest('[data-prop-id]');
    if (dropItem) {
      const targetId = dropItem.getAttribute('data-prop-id');
      if (targetId && targetId !== dragOverPropId) {
        setDragOverPropId(targetId);
      }
    }
  };

  const handlePropTouchEnd = () => {
    if (touchPropId && dragOverPropId && touchPropId !== dragOverPropId) {
      const landlordProps = properties.filter(p => p.landlordId === currentLandlordId);
      const sourceIndex = landlordProps.findIndex(p => p.id === touchPropId);
      const targetIndex = landlordProps.findIndex(p => p.id === dragOverPropId);

      if (sourceIndex !== -1 && targetIndex !== -1) {
        const reorderedLandlordProps = [...landlordProps];
        const [moved] = reorderedLandlordProps.splice(sourceIndex, 1);
        reorderedLandlordProps.splice(targetIndex, 0, moved);

        let lpIdx = 0;
        const newProperties = properties.map(p => {
          if (p.landlordId === currentLandlordId) {
            return reorderedLandlordProps[lpIdx++];
          }
          return p;
        });

        setProperties(newProperties);
        showToast(`已移動房源「${moved.name}」的排列順序！`, 'success');
      }
    }
    setTouchPropId(null);
    setDragOverPropId(null);
  };

  // Photo Drag & Touch Handlers
  const handlePhotoDragStart = (e, photoId) => {
    setDraggedPhotoId(photoId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', photoId);
  };

  const handlePhotoDragOver = (e, targetPhotoId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverPhotoId !== targetPhotoId) {
      setDragOverPhotoId(targetPhotoId);
    }
  };

  const handlePhotoDrop = (e, targetPhotoId) => {
    e.preventDefault();
    if (!draggedPhotoId || draggedPhotoId === targetPhotoId) {
      setDraggedPhotoId(null);
      setDragOverPhotoId(null);
      return;
    }

    const sourceIndex = tempPhotos.findIndex(p => p.id === draggedPhotoId);
    const targetIndex = tempPhotos.findIndex(p => p.id === targetPhotoId);

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedPhotoId(null);
      setDragOverPhotoId(null);
      return;
    }

    const reordered = [...tempPhotos];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    setTempPhotos(reordered);
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
    showToast('已調整照片順序！', 'success');
  };

  const handlePhotoDragEnd = () => {
    setDraggedPhotoId(null);
    setDragOverPhotoId(null);
  };

  const handlePhotoTouchStart = (photoId) => {
    setTouchPhotoId(photoId);
  };

  const handlePhotoTouchMove = (e) => {
    if (!touchPhotoId) return;
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    const dropItem = targetEl?.closest('[data-photo-id]');
    if (dropItem) {
      const targetId = dropItem.getAttribute('data-photo-id');
      if (targetId && targetId !== dragOverPhotoId) {
        setDragOverPhotoId(targetId);
      }
    }
  };

  const handlePhotoTouchEnd = () => {
    if (touchPhotoId && dragOverPhotoId && touchPhotoId !== dragOverPhotoId) {
      const sourceIndex = tempPhotos.findIndex(p => p.id === touchPhotoId);
      const targetIndex = tempPhotos.findIndex(p => p.id === dragOverPhotoId);

      if (sourceIndex !== -1 && targetIndex !== -1) {
        const reordered = [...tempPhotos];
        const [moved] = reordered.splice(sourceIndex, 1);
        reordered.splice(targetIndex, 0, moved);
        setTempPhotos(reordered);
        showToast('已調整照片順序！', 'success');
      }
    }
    setTouchPhotoId(null);
    setDragOverPhotoId(null);
  };

  // Helper to calculate months between two dates
  const calculateMonths = (start, end) => {
    if (!start || !end) return 12;
    const d1 = new Date(start);
    const d2 = new Date(end);
    let months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    return months > 0 ? months : 1;
  };

  // Helper to get locked-in monthly rent for a lease independent of property rent changes
  const getLeaseMonthlyRent = (lease) => {
    if (!lease) return 0;
    if (lease.monthlyRent && Number(lease.monthlyRent) > 0) {
      return Number(lease.monthlyRent);
    }
    const months = calculateMonths(lease.startDate, lease.endDate);
    if (lease.totalContractRent && Number(lease.totalContractRent) > 0 && months > 0) {
      return Math.round(Number(lease.totalContractRent) / months);
    }
    const prop = properties.find(p => p.id === lease.propertyId);
    return prop ? prop.rent : 15000;
  };

  // --- Simplified Lease Creation (Focus on recording info) ---
  const handleUnitRentChange = (val) => {
    setLeaseUnitRent(val);
    const uRent = Number(val) || 0;
    const pCount = Number(leasePeriodCount) || 0;
    setLeaseTotalRent((uRent * pCount).toString());
  };

  const handlePeriodCountChange = (val) => {
    setLeasePeriodCount(val);
    const uRent = Number(leaseUnitRent) || 0;
    const pCount = Number(val) || 0;
    setLeaseTotalRent((uRent * pCount).toString());
  };

  const handleUnitTypeChange = (type) => {
    setLeaseUnitType(type);
    const uRent = Number(leaseUnitRent) || 0;
    const pCount = Number(leasePeriodCount) || 0;
    setLeaseTotalRent((uRent * pCount).toString());
  };

  const handleLeasePropertySelect = (propId) => {
    setLeasePropId(propId);
    const targetProp = properties.find(p => p.id === propId);
    if (targetProp) {
      const defaultUnitRent = targetProp.rent || 15000;
      const defaultPeriodType = targetProp.rentPeriod === 'yearly' ? 'yearly' : 'monthly';
      const defaultPeriodCount = defaultPeriodType === 'yearly' ? 1 : 12;
      setLeaseUnitRent(defaultUnitRent.toString());
      setLeaseUnitType(defaultPeriodType);
      setLeasePeriodCount(defaultPeriodCount.toString());
      setLeaseTotalRent((defaultUnitRent * defaultPeriodCount).toString());
    }
  };

  const handleAddLeaseOpen = () => {
    const landlordProps = properties.filter(p => !p.deletedAt && (p.landlordId === currentLandlordId || !p.landlordId));
    if (landlordProps.length === 0) {
      showToast('目前名下沒有建立任何房源！請先在「房源管理」新增房源。', 'error');
      return;
    }
    const vacantProp = landlordProps.find(p => p.status === 'vacant') || landlordProps[0];
    setLeasePropId(vacantProp.id);
    setLeaseTenantName('');
    setLeasePhone('');
    setLeaseCoPhone('');
    setLeaseCoTenantName('');
    setShowCoTenant(false);
    const today = new Date();
    const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
    const startStr = today.toISOString().split('T')[0];
    const endStr = nextYear.toISOString().split('T')[0];
    setLeaseStartDate(startStr);
    setLeaseEndDate(endStr);
    setLeaseDeposit(''); // 履約押金不預設金額

    // 3個計算欄位: (月/年)租金 * 合約期(月/年) = 合約總租金，依房源所設定之租金與週期同步預設
    const defaultUnitRent = vacantProp ? (vacantProp.rent || 15000) : 15000;
    const defaultPeriodType = vacantProp?.rentPeriod === 'yearly' ? 'yearly' : 'monthly';
    const defaultPeriodCount = defaultPeriodType === 'yearly' ? 1 : 12;
    setLeaseUnitRent(defaultUnitRent.toString());
    setLeasePeriodCount(defaultPeriodCount.toString());
    setLeaseUnitType(defaultPeriodType);
    setLeaseTotalRent((defaultUnitRent * defaultPeriodCount).toString());

    setLeaseNote('');
    setActiveModal('addLease');
  };

  const handlePhoneInputChange = async (phoneVal) => {
    setLeasePhone(phoneVal);
    const cleaned = String(phoneVal || '').replace(/[^0-9]/g, '').trim();
    if (!cleaned) {
      setLeaseTenantName('');
      return;
    }

    // 1. 本地快取快速搜尋 (Local Cache: registeredTenants, leases, historicalLeases)
    const matchedReg = registeredTenants.find(t => String(t.phone || '').replace(/[^0-9]/g, '').trim() === cleaned);
    if (matchedReg && matchedReg.name) {
      setLeaseTenantName(matchedReg.name);
      return;
    }
    const matchedLease = leases.find(l => String(l.phone || '').replace(/[^0-9]/g, '').trim() === cleaned);
    if (matchedLease && matchedLease.tenantName) {
      setLeaseTenantName(matchedLease.tenantName);
      return;
    }
    const matchedHist = historicalLeases.find(l => String(l.phone || '').replace(/[^0-9]/g, '').trim() === cleaned);
    if (matchedHist && matchedHist.tenantName) {
      setLeaseTenantName(matchedHist.tenantName);
      return;
    }

    // 2. 線上即時查詢 Supabase profiles 資料庫（支援所有已註冊或 LINE 綁定租客）
    if (cleaned.length >= 8) {
      try {
        const { data: profData } = await supabase
          .from('profiles')
          .select('name, phone')
          .eq('phone', cleaned)
          .maybeSingle();

        if (profData && profData.name) {
          setLeaseTenantName(profData.name);
          setRegisteredTenants(prev => {
            const filtered = prev.filter(t => String(t.phone).replace(/[^0-9]/g, '') !== cleaned);
            return [...filtered, { id: `TEN_${cleaned}`, name: profData.name, phone: cleaned, isSelfRegistered: true }];
          });
          return;
        }

        // 3. 查詢全系統既有租約歷史紀錄
        const { data: leaseData } = await supabase
          .from('leases')
          .select('tenant_name, phone')
          .eq('phone', cleaned)
          .is('deleted_at', null)
          .limit(1);

        if (leaseData && leaseData.length > 0 && leaseData[0].tenant_name) {
          setLeaseTenantName(leaseData[0].tenant_name);
          setRegisteredTenants(prev => {
            const filtered = prev.filter(t => String(t.phone).replace(/[^0-9]/g, '') !== cleaned);
            return [...filtered, { id: `TEN_${cleaned}`, name: leaseData[0].tenant_name, phone: cleaned, isSelfRegistered: false }];
          });
          return;
        }
      } catch (dbErr) {
        console.warn('Auto match tenant name from Supabase notice:', dbErr);
      }
    }
  };

  const handleCoPhoneInputChange = async (phoneVal) => {
    setLeaseCoPhone(phoneVal);
    const cleaned = String(phoneVal || '').replace(/[^0-9]/g, '').trim();
    if (!cleaned) {
      setLeaseCoTenantName('');
      return;
    }

    const matchedReg = registeredTenants.find(t => String(t.phone || '').replace(/[^0-9]/g, '').trim() === cleaned);
    if (matchedReg && matchedReg.name) {
      setLeaseCoTenantName(matchedReg.name);
      return;
    }
    const matchedLease = leases.find(l => String(l.phone || '').replace(/[^0-9]/g, '').trim() === cleaned);
    if (matchedLease && matchedLease.tenantName) {
      setLeaseCoTenantName(matchedLease.tenantName);
      return;
    }
    const matchedHist = historicalLeases.find(l => String(l.phone || '').replace(/[^0-9]/g, '').trim() === cleaned);
    if (matchedHist && matchedHist.tenantName) {
      setLeaseCoTenantName(matchedHist.tenantName);
      return;
    }

    if (cleaned.length >= 8) {
      try {
        const { data: profData } = await supabase
          .from('profiles')
          .select('name, phone')
          .eq('phone', cleaned)
          .maybeSingle();

        if (profData && profData.name) {
          setLeaseCoTenantName(profData.name);
          setRegisteredTenants(prev => {
            const filtered = prev.filter(t => String(t.phone).replace(/[^0-9]/g, '') !== cleaned);
            return [...filtered, { id: `TEN_${cleaned}`, name: profData.name, phone: cleaned, isSelfRegistered: true }];
          });
          return;
        }
      } catch (dbErr) {
        console.warn('Auto match co-tenant name from Supabase notice:', dbErr);
      }
    }
  };

  const handleAddLeaseSubmit = async (e) => {
    e.preventDefault();
    if (!leasePhone.trim()) {
      showToast('請輸入承租人聯絡電話！', 'error');
      return;
    }
    if (!leaseTenantName.trim()) {
      showToast('請輸入承租人姓名！', 'error');
      return;
    }

    // Check if property already has an active lease
    const propAlreadyLeased = leases.find(l => l.propertyId === leasePropId && l.status === 'active');
    if (propAlreadyLeased) {
      const confirmed = await showConfirmDialog(
        `⚠️ 此房源已有進行中的租約紀錄（承租人：${propAlreadyLeased.tenantName}）。\n\n您確定要覆蓋並建立新的租約紀錄嗎？`
      );
      if (!confirmed) return;
    }

    // Auto-link tenant profile if not registered yet so they can register and bind later
    const cleanedPhone = leasePhone.replace(/[-\s]/g, '');
    const existingTenant = registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === cleanedPhone);
    if (!existingTenant) {
      const autoTenant = {
        name: leaseTenantName.trim(),
        phone: leasePhone.trim(),
        isSelfRegistered: false
      };
      setRegisteredTenants(prev => [...prev, autoTenant]);
    } else if (!existingTenant.isSelfRegistered && existingTenant.name !== leaseTenantName.trim()) {
      setRegisteredTenants(prev => prev.map(t => t.phone.replace(/[-\s]/g, '') === cleanedPhone ? { ...t, name: leaseTenantName.trim() } : t));
    }

    if (showCoTenant && leaseCoPhone.trim() && leaseCoTenantName.trim()) {
      const cleanedCoPhone = leaseCoPhone.replace(/[-\s]/g, '');
      const existingCoTenant = registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === cleanedCoPhone);
      if (!existingCoTenant) {
        const autoCoTenant = {
          name: leaseCoTenantName.trim(),
          phone: leaseCoPhone.trim(),
          isSelfRegistered: false
        };
        setRegisteredTenants(prev => [...prev, autoCoTenant]);
      }
    }

    // 保證全域唯一且不與已終止/其他租約發生 Primary Key 衝突的租約編號
    const uniqueLeaseCode = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
    const nextLeaseId = `L${uniqueLeaseCode}`;
    const totalRent = Number(leaseTotalRent) || (Number(leaseUnitRent) * Number(leasePeriodCount)) || 0;
    const pCount = Number(leasePeriodCount) || 12;
    const monthlyRentVal = leaseUnitType === 'yearly'
      ? Math.round(Number(leaseUnitRent) / 12) || Math.round(totalRent / (pCount * 12)) || totalRent
      : Number(leaseUnitRent) || (pCount > 0 ? Math.round(totalRent / pCount) : totalRent);

    const newLease = {
      id: nextLeaseId,
      propertyId: leasePropId,
      tenantName: leaseTenantName.trim(),
      phone: leasePhone.trim(),
      coPhone: (showCoTenant && leaseCoPhone.trim()) ? leaseCoPhone.trim() : null,
      coTenantName: (showCoTenant && leaseCoTenantName.trim()) ? leaseCoTenantName.trim() : null,
      startDate: leaseStartDate,
      endDate: leaseEndDate,
      deposit: Number(leaseDeposit) || 0,
      monthlyRent: monthlyRentVal,
      totalContractRent: totalRent,
      unitRent: Number(leaseUnitRent) || monthlyRentVal,
      periodCount: pCount,
      unitType: leaseUnitType,
      note: leaseNote.trim(),
      status: 'active',
      createdAt: new Date().toISOString().split('T')[0]
    };

    try {
      if (isSupabaseConfigured) {
        const { data: insertedRows, error: insertErr } = await supabase.from('leases').insert({
          id: nextLeaseId,
          property_id: leasePropId,
          landlord_id: currentLandlordId,
          tenant_name: newLease.tenantName,
          phone: newLease.phone,
          co_phone: newLease.coPhone,
          co_tenant_name: newLease.coTenantName,
          start_date: newLease.startDate,
          end_date: newLease.endDate,
          deposit: newLease.deposit,
          monthly_rent: newLease.monthlyRent,
          total_contract_rent: newLease.totalContractRent,
          status: 'active',
          note: newLease.note
        }).select();
        if (insertErr) throw insertErr;
        if (insertedRows && insertedRows[0]) {
          newLease.id = insertedRows[0].id;
        }
        await supabase.from('properties').update({ status: 'occupied', updated_at: new Date().toISOString() }).eq('id', leasePropId);
      }
      setProperties(prev => prev.map(p =>
        p.id === leasePropId ? { ...p, status: 'occupied' } : p
      ));
      setLeases(prev => {
        if (prev.some(l => l.id === newLease.id)) return prev;
        return [...prev, newLease];
      });
      setActiveModal(null);
      showToast(`已成功建立「${leaseTenantName.trim()}」的租約紀錄！合約總租金：NT$ ${totalRent.toLocaleString()}`, 'success');
      fetchSupabaseData();
    } catch (err) {
      showToast(`建立租約失敗: ${err.message}`, 'error');
    }
  };

  // Edit Lease Record
  const handleEditLeaseOpen = (lease) => {
    setEditingLease(lease);
    setLeasePropId(lease.propertyId);
    setLeaseTenantName(lease.tenantName || '');
    setLeasePhone(lease.phone || '');
    setLeaseCoTenantName(lease.coTenantName || '');
    setLeaseCoPhone(lease.coPhone || '');
    setShowCoTenant(Boolean(lease.coTenantName || lease.coPhone));
    setLeaseStartDate(lease.startDate || '');
    setLeaseEndDate(lease.endDate || '');
    setLeaseDeposit(lease.deposit !== undefined ? lease.deposit.toString() : '');

    const months = calculateMonths(lease.startDate, lease.endDate) || 12;
    const pCount = lease.periodCount ? lease.periodCount.toString() : months.toString();
    const uType = lease.unitType || 'monthly';
    const uRent = lease.unitRent ? lease.unitRent.toString() : (lease.monthlyRent ? lease.monthlyRent.toString() : '15000');
    const totRent = (lease.totalContractRent !== undefined && lease.totalContractRent !== null)
      ? lease.totalContractRent.toString()
      : ((Number(uRent) || 15000) * (Number(pCount) || 12)).toString();

    setLeaseUnitRent(uRent);
    setLeasePeriodCount(pCount);
    setLeaseUnitType(uType);
    setLeaseTotalRent(totRent);

    setLeaseNote(lease.note || '');
    setActiveModal('editLease');
  };

  const handleEditLeaseSubmit = async (e) => {
    e.preventDefault();
    if (!editingLease) return;
    if (!leasePhone.trim()) {
      showToast('請輸入聯絡電話！', 'error');
      return;
    }
    if (!leaseTenantName.trim()) {
      showToast('請輸入承租人姓名！', 'error');
      return;
    }

    const totalRent = Number(leaseTotalRent) || (Number(leaseUnitRent) * Number(leasePeriodCount)) || 0;
    const pCount = Number(leasePeriodCount) || 12;
    const monthlyRentVal = leaseUnitType === 'yearly'
      ? Math.round(Number(leaseUnitRent) / 12) || Math.round(totalRent / (pCount * 12)) || totalRent
      : Number(leaseUnitRent) || (pCount > 0 ? Math.round(totalRent / pCount) : totalRent);

    const updatedLeaseData = {
      propertyId: leasePropId,
      tenantName: leaseTenantName.trim(),
      phone: leasePhone.trim(),
      coTenantName: (showCoTenant && leaseCoTenantName.trim()) ? leaseCoTenantName.trim() : null,
      coPhone: (showCoTenant && leaseCoPhone.trim()) ? leaseCoPhone.trim() : null,
      startDate: leaseStartDate,
      endDate: leaseEndDate,
      deposit: Number(leaseDeposit) || 0,
      monthlyRent: monthlyRentVal,
      totalContractRent: totalRent,
      unitRent: Number(leaseUnitRent) || monthlyRentVal,
      periodCount: pCount,
      unitType: leaseUnitType,
      note: leaseNote.trim()
    };

    try {
      if (isSupabaseConfigured) {
        const { error: updateErr } = await supabase
          .from('leases')
          .update({
            property_id: updatedLeaseData.propertyId,
            tenant_name: updatedLeaseData.tenantName,
            phone: updatedLeaseData.phone,
            co_tenant_name: updatedLeaseData.coTenantName,
            co_phone: updatedLeaseData.coPhone,
            start_date: updatedLeaseData.startDate,
            end_date: updatedLeaseData.endDate,
            deposit: updatedLeaseData.deposit,
            monthly_rent: updatedLeaseData.monthlyRent,
            total_contract_rent: updatedLeaseData.totalContractRent,
            note: updatedLeaseData.note,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingLease.id);

        if (updateErr) throw updateErr;
      }

      setLeases(prev => prev.map(l =>
        l.id === editingLease.id ? { ...l, ...updatedLeaseData } : l
      ));
      setActiveModal(null);
      setEditingLease(null);
      showToast('租約資訊已成功更新並同步至雲端！', 'success');
      fetchSupabaseData();
    } catch (err) {
      console.error('Update lease error:', err);
      showToast(`更新租約失敗: ${err.message}`, 'error');
    }
  };

  const handleDeleteLease = async (leaseId, propertyId) => {
    const leaseToEnd = leases.find(l => l.id === leaseId);
    if (!leaseToEnd) return;
    const relatedPayments = payments.filter(p => p.leaseId === leaseId);

    const confirmed = await showConfirmDialog(
      `確定要終止此租約紀錄（退租結案）嗎？\n\n承租人：${leaseToEnd.tenantName}\n合約期間：${leaseToEnd.startDate} ~ ${leaseToEnd.endDate}\n\n⚠️ 終止後：\n1. 該租約將移入「歷史合約」永久留存。\n2. 原本在「帳單與已繳紀錄清單」的 ${relatedPayments.length} 筆帳單將同步輸出並完整封存至歷史合約中供日後查閱，並從當前活躍帳單清單中清除。\n3. 房源將自動釋出為「空置」狀態。\n4. 資料將同步上傳至雲端資料庫 (Supabase)，所有手機與電腦皆同步更新。`
    );
    if (!confirmed) return;

    try {
      const nowIso = new Date().toISOString();
      const todayStr = nowIso.split('T')[0];

      if (isSupabaseConfigured) {
        // 1. 更新 Supabase 租約狀態為 terminated
        const { error: leaseErr } = await supabase
          .from('leases')
          .update({
            status: 'terminated',
            updated_at: nowIso
          })
          .eq('id', leaseId);

        if (leaseErr) throw leaseErr;

        // 2. 更新房源狀態為 vacant (空置)
        if (propertyId) {
          await supabase
            .from('properties')
            .update({
              status: 'vacant',
              updated_at: nowIso
            })
            .eq('id', propertyId);
        }
      }

      const archivedLease = {
        ...leaseToEnd,
        status: 'terminated',
        terminatedAt: todayStr,
        archivedPayments: relatedPayments, // 完整輸出並保存該合約所有帳單與已繳紀錄
      };

      setHistoricalLeases(prev => [...prev, archivedLease]);
      setLeases(prev => prev.filter(l => l.id !== leaseId));
      setPayments(prev => prev.filter(p => p.leaseId !== leaseId)); // 從活躍清單中清除
      if (propertyId) {
        setProperties(prev => prev.map(p =>
          p.id === propertyId ? { ...p, status: 'vacant' } : p
        ));
      }

      if (currentTenantLeaseId === leaseId) {
        const remainingLeases = leases.filter(l => l.id !== leaseId);
        setCurrentTenantLeaseId(remainingLeases.length > 0 ? remainingLeases[0].id : null);
      }

      showToast(`租約已順利退租結案！房源已釋出為空置，歷史合約與 ${relatedPayments.length} 筆帳單已同步保存至雲端。`, 'success');
      fetchSupabaseData();
    } catch (err) {
      console.error('Terminate lease error:', err);
      showToast(`退租結案失敗: ${err.message}`, 'error');
    }
  };

  const formatChineseCurrency = (n) => {
    if (!n || isNaN(n)) return '零元整';
    const digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
    const units = ['', '拾', '佰', '仟'];
    const bigUnits = ['', '萬', '億'];
    let numStr = Math.floor(Math.abs(n)).toString();
    if (numStr === '0') return '零元整';

    const parts = [];
    while (numStr.length > 0) {
      parts.unshift(numStr.slice(-4));
      numStr = numStr.slice(0, -4);
    }

    let chineseStr = '';
    parts.forEach((part, partIdx) => {
      let partChinese = '';
      let partLen = part.length;
      let hasNonZero = false;
      for (let i = 0; i < partLen; i++) {
        let digit = parseInt(part[i]);
        let unit = units[partLen - 1 - i];
        if (digit !== 0) {
          hasNonZero = true;
          partChinese += digits[digit] + unit;
        } else {
          if (partChinese.length > 0 && !partChinese.endsWith('零') && i < partLen - 1) {
            partChinese += '零';
          }
        }
      }
      if (partChinese.endsWith('零')) {
        partChinese = partChinese.slice(0, -1);
      }
      if (hasNonZero) {
        let bigUnit = bigUnits[parts.length - 1 - partIdx];
        chineseStr += partChinese + bigUnit;
      }
    });
    return '新臺幣 ' + (chineseStr || '零') + ' 元整';
  };

  const handleOpenRecordPayment = (payment) => {
    setRecordingPayment(payment);
    setRecordPaymentMethod(payment.paymentMethod || 'bank');
    setRecordPaymentDate(payment.paidDate || new Date().toISOString().split('T')[0]);
    setRecordPaymentNote(payment.note || '');
    setActiveModal('recordPayment');
  };

  const handleSaveRecordedPayment = async (e) => {
    e?.preventDefault();
    if (!recordingPayment) return;
    const methodNames = {
      bank: '銀行轉帳',
      cash: '現金交付'
    };
    const finalMethod = methodNames[recordPaymentMethod] || formatPaymentMethod(recordPaymentMethod) || '銀行轉帳';
    const paidDateVal = recordPaymentDate || new Date().toISOString().split('T')[0];

    try {
      await transitionPaymentStatus({
        paymentId: recordingPayment.id,
        newStatus: PaymentStatus.PAID,
        metadata: {
          operator: 'landlord',
          paymentMethod: recordPaymentMethod === 'cash' ? 'cash' : 'bank_transfer',
          note: recordPaymentNote || null,
        }
      });

      setPayments(payments.map(p => {
        if (p.id === recordingPayment.id) {
          return {
            ...p,
            status: 'paid',
            paidDate: paidDateVal,
            payment_method: finalMethod,
            note: recordPaymentNote
          };
        }
        return p;
      }));
      setActiveModal(null);
      setRecordingPayment(null);
      showToast(`已確認「${recordingPayment.tenantName}」的帳單收款入帳！`, 'success');
    } catch (err) {
      showToast(`儲存入帳失敗: ${err.message}`, 'error');
    }
  };

  const handleSendPaymentReminder = (payment) => {
    showToast(`📢 已向租客「${payment.tenantName}」發送繳費提醒通知！`, 'success');
  };

  const handleOpenReceipt = (payment) => {
    setReceiptPayment(payment);
    setActiveModal('viewReceipt');
  };

  const handleOpenAddCustomBill = () => {
    const activeLeases = leases.filter(l => landlordPropertyIds.includes(l.propertyId) && l.status === 'active');
    if (activeLeases.length === 0) {
      showToast('目前尚無有效租約可開立帳單！', 'warning');
      return;
    }
    const firstLease = activeLeases[0];
    setCustomBillLeaseId(firstLease.id);
    setCustomBillCategory('rent');
    setCustomBillTitle('');
    setCustomBillAmount(getLeaseMonthlyRent(firstLease).toString());

    // 應繳截止日期預設為新增帳單一個月內
    const oneMonthLater = new Date();
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
    const dueDateStr = oneMonthLater.toISOString().split('T')[0];
    setCustomBillDueDate(dueDateStr);

    setCustomBillPaymentType('paid'); // Default: record directly as paid
    setCustomBillPaymentMethod('bank');
    setCustomBillNote('');
    setActiveModal('addCustomBill');
  };

  const handleSaveCustomBill = async (e) => {
    e.preventDefault();
    if (!customBillLeaseId) {
      showToast('請選擇承租合約/房客！', 'error');
      return;
    }
    const targetLease = leases.find(l => l.id === customBillLeaseId);
    if (!targetLease) return;
    const targetProp = properties.find(p => p.id === targetLease.propertyId);
    const amt = parseInt(customBillAmount, 10);
    if (!amt || amt <= 0) {
      showToast('請輸入正確的帳單金額！', 'error');
      return;
    }

    const typeLabels = {
      rent: '租金',
      deposit: '押金保證金',
      utilities: '水電費',
      management: '管理費',
      other: '其他'
    };

    const isDirectlyPaid = customBillPaymentType === 'paid';
    const methodNames = {
      bank: '銀行轉帳',
      cash: '現金交付'
    };

    const newPayment = {
      id: `BILL${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      leaseId: targetLease.id,
      tenantName: targetLease.tenantName,
      propertyName: targetProp?.name || '租賃房源',
      amount: amt,
      dueDate: customBillDueDate || new Date().toISOString().split('T')[0],
      status: isDirectlyPaid ? 'paid' : 'pending',
      paidDate: isDirectlyPaid ? (customBillDueDate || new Date().toISOString().split('T')[0]) : null,
      billType: customBillCategory,
      title: customBillTitle.trim(),
      paymentMethod: isDirectlyPaid ? (methodNames[customBillPaymentMethod] || customBillPaymentMethod) : null,
      creatorRole: 'landlord',
      approvalStatus: 'approved',
      note: customBillNote.trim() || ''
    };

    try {
      if (isSupabaseConfigured) {
        const { data: insertedRows, error: insertErr } = await supabase.from('payments').insert({
          id: newPayment.id,
          lease_id: targetLease.id,
          tenant_name: newPayment.tenantName,
          property_name: newPayment.propertyName,
          amount: amt,
          due_date: newPayment.dueDate,
          status: newPayment.status,
          paid_date: newPayment.paidDate,
          bill_type: newPayment.billType,
          title: newPayment.title,
          payment_method: newPayment.paymentMethod,
          note: newPayment.note
        }).select();
        if (insertErr) throw insertErr;
        if (insertedRows && insertedRows[0]) {
          newPayment.id = insertedRows[0].id;
        }
      }
      setPayments(prev => {
        if (prev.some(p => p.id === newPayment.id)) return prev;
        return [newPayment, ...prev];
      });
      setActiveModal(null);
      const displayItemName = `${typeLabels[customBillCategory] || '費用項目'}${newPayment.title ? ` (${newPayment.title})` : ''}`;
      showToast(`已成功記錄 ${targetLease.tenantName} 的「${displayItemName}」(金額 NT$ ${amt.toLocaleString()}${isDirectlyPaid ? ' · 已入帳' : ' · 待繳款'})！`, 'success');
    } catch (err) {
      showToast(`記錄失敗: ${err.message}`, 'error');
    }
  };

  const handleOpenLandlordBankModal = () => {
    setTempBankName(landlordBankInfo.bankName || '');
    setTempBankAccount(landlordBankInfo.bankAccount || '');
    setTempAccountName(landlordBankInfo.accountName || '');
    setTempBankNote(landlordBankInfo.note || '');
    setActiveModal('manageBankInfo');
  };

  const handleSaveLandlordBankInfo = async (e) => {
    if (e) e.preventDefault();
    const updatedBank = {
      bankName: tempBankName.trim(),
      bankAccount: tempBankAccount.trim(),
      accountName: tempAccountName.trim(),
      note: tempBankNote.trim()
    };
    try {
      if (isSupabaseConfigured && currentLandlordId) {
        await supabase.from('profiles').update({
          bank_info: updatedBank,
          updated_at: new Date().toISOString()
        }).eq('id', currentLandlordId);

        await supabase.from('landlords').update({
          bank_info: updatedBank,
          updated_at: new Date().toISOString()
        }).eq('id', currentLandlordId);
      }
      setLandlordBankInfo(updatedBank);
      setActiveModal(null);
      showToast('收款帳戶資訊已成功保存！', 'success');
    } catch (err) {
      showToast(`保存失敗: ${err.message}`, 'error');
    }
  };

  const handleOpenTenantReportPayment = (targetBill = null) => {
    if (!currentTenantLease) {
      showToast('目前尚無生效之租約可回報！', 'warning');
      return;
    }
    if (targetBill && typeof targetBill === 'object' && targetBill.amount) {
      setTenantReportTargetBill(targetBill);
      setTenantReportCategory(targetBill.billType || 'rent');
      setTenantReportTitle(targetBill.title || '');
      setTenantReportAmount(targetBill.amount.toString());
      setTenantReportMethod('cash'); // 預設為現金交付
      setTenantReportTransferLast5(targetBill.transferLast5 || '');
      setTenantReportDate(targetBill.dueDate || new Date().toISOString().split('T')[0]);
      setTenantReportNote('');
    } else {
      setTenantReportTargetBill(null);
      setTenantReportCategory('rent');
      setTenantReportTitle('');
      setTenantReportAmount(getLeaseMonthlyRent(currentTenantLease).toString());
      setTenantReportMethod('cash'); // 預設為現金交付
      setTenantReportTransferLast5('');
      setTenantReportDate(new Date().toISOString().split('T')[0]);
      setTenantReportNote('');
    }
    setActiveModal('tenantReportPayment');
  };

  const handleTenantSubmitReport = async (e) => {
    e.preventDefault();
    if (!currentTenantLease) return;
    const amt = parseInt(tenantReportAmount, 10);
    if (!amt || amt <= 0) {
      showToast('請輸入正確的繳款金額！', 'error');
      return;
    }

    if (tenantReportMethod === 'bank' && !tenantReportTransferLast5.trim()) {
      showToast('請填寫匯款轉帳後五碼，以便房東對帳！', 'warning');
      return;
    }

    const typeLabels = {
      rent: '租金',
      deposit: '押金保證金',
      utilities: '水電費',
      management: '管理費',
      other: '其他'
    };

    const methodNames = {
      bank: `銀行轉帳${tenantReportTransferLast5 ? ` (末5碼: ${tenantReportTransferLast5})` : ''}`,
      cash: '現金交付'
    };

    try {
      if (!tenantReportTargetBill) {
        throw new Error('為避免未授權帳款，請從既有帳單選擇要回報的款項。');
      }
      if (amt !== Number(tenantReportTargetBill.amount)) {
        throw new Error('繳款回報金額必須與原帳單金額相同。');
      }

      await transitionPaymentStatus({
        paymentId: tenantReportTargetBill.id,
        newStatus: PaymentStatus.TENANT_SUBMITTED,
        metadata: {
          paymentMethod: tenantReportMethod === 'bank' ? 'bank_transfer' : 'cash',
          transferLast5: tenantReportMethod === 'bank' ? tenantReportTransferLast5 : null,
          note: tenantReportNote.trim() || null,
        }
      });
      setPayments(payments.map(p => p.id === tenantReportTargetBill.id
        ? {
            ...p,
            status: 'tenant_submitted',
            approvalStatus: 'pending_approval',
            paymentMethod: methodNames[tenantReportMethod],
            transferLast5: tenantReportMethod === 'bank' ? tenantReportTransferLast5 : null,
          }
        : p));

      setActiveModal(null);
      setTenantReportTargetBill(null);
      const displayReportName = `${typeLabels[tenantReportCategory] || '費用項目'}${tenantReportTitle.trim() ? ` (${tenantReportTitle.trim()})` : ''}`;
      showToast(`🎉「${displayReportName}」繳費回報已成功提交！已通知房東進行審核確認。`, 'success');
    } catch (err) {
      showToast(`提交回報失敗: ${err.message}`, 'error');
    }
  };

  const handleApprovePayment = async (paymentId) => {
    const target = payments.find(p => p.id === paymentId);
    if (!target) return;

    try {
      await transitionPaymentStatus({
        paymentId,
        newStatus: PaymentStatus.PAID,
        metadata: { operator: 'landlord', confirmedAt: new Date().toISOString() }
      });

      setPayments(payments.map(p => {
        if (p.id === paymentId) {
          return {
            ...p,
            status: 'paid',
            approvalStatus: 'approved',
            paidDate: new Date().toISOString().split('T')[0]
          };
        }
        return p;
      }));

      await logAuditEvent({
        actorUserId: currentLandlordId,
        actorRole: 'landlord',
        action: 'PAYMENT_APPROVED',
        entityType: 'payment',
        entityId: paymentId,
        newData: { amount: target.amount, status: 'paid' }
      });

      const cat = getCategoryInfo(target.billType);
      const itemTitle = `${cat.label}${target.title ? ` (${target.title})` : ''}`;
      showToast(`✅ 已核准「${target.tenantName}」回報的 ${itemTitle} (NT$ ${target.amount.toLocaleString()})，已正式入帳！`, 'success');
    } catch (err) {
      showToast(`核准失敗: ${err.message}`, 'error');
    }
  };

  const handleRejectPayment = async (paymentId) => {
    const target = payments.find(p => p.id === paymentId);
    if (!target) return;

    const confirmed = await showConfirmDialog(`確定要駁回「${target.tenantName}」的這筆繳費回報 (NT$ ${target.amount.toLocaleString()}) 嗎？`);
    if (!confirmed) return;

    try {
      await transitionPaymentStatus({
        paymentId,
        newStatus: PaymentStatus.REJECTED,
        metadata: { operator: 'landlord', rejectedAt: new Date().toISOString() }
      });

      setPayments(payments.map(p => {
        if (p.id === paymentId) {
          return {
            ...p,
            status: 'rejected',
            approvalStatus: 'rejected'
          };
        }
        return p;
      }));

      await logAuditEvent({
        actorUserId: currentLandlordId,
        actorRole: 'landlord',
        action: 'PAYMENT_REJECTED',
        entityType: 'payment',
        entityId: paymentId,
      });

      showToast(`已駁回該筆繳費回報。`, 'warning');
    } catch (err) {
      showToast(`駁回失敗: ${err.message}`, 'error');
    }
  };

  const handleDeletePayment = async (paymentId, title) => {
    const target = payments.find(p => p.id === paymentId);
    if (!target) return;

    if (target.status === 'void') {
      showToast('此帳單已經是作廢狀態！', 'warning');
      return;
    }

    const confirmed = await showConfirmDialog(
      `確定要作廢此筆帳單「${title || target.title || '租金帳單'}」(金額 NT$ ${target.amount.toLocaleString()}) 嗎？\n\n⚠️ 作廢後該筆紀錄將完整保留於雙方（房東與租客）的系統清單中供日後查閱對帳，並清楚標記作廢人與時間，同時不會列入應繳租金與財務營收統計。`
    );
    if (!confirmed) return;

    const operator = role === 'admin'
      ? `房東 (${landlords.find(l => l.id === currentLandlordId)?.name || '房東'})`
      : role === 'tenant'
        ? `租客 (${registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === currentTenantPhone?.replace(/[-\s]/g, ''))?.name || currentTenantLease?.tenantName || '租客'})`
        : '系統總管理員';

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const voidedAtStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    try {
      if (isSupabaseConfigured) {
        const { error: voidErr } = await supabase
          .from('payments')
          .update({
            status: 'void',
            note: target.note ? `${target.note} (作廢: ${operator} 於 ${voidedAtStr})` : `(作廢: ${operator} 於 ${voidedAtStr})`,
            updated_at: now.toISOString(),
          })
          .eq('id', paymentId);

        if (voidErr) throw voidErr;
      }

      setPayments(prev => prev.map(p => {
        if (p.id === paymentId) {
          return {
            ...p,
            status: 'void',
            approvalStatus: 'void',
            voidedBy: operator,
            voidedAt: voidedAtStr,
            voidedRole: role
          };
        }
        return p;
      }));
      showToast(`已成功將此筆帳單標記為「已作廢」並同步至雲端！紀錄已保留於雙方清單中。`, 'warning');
      fetchSupabaseData();
    } catch (err) {
      console.error('Void payment error:', err);
      showToast(`作廢失敗: ${err.message}`, 'error');
    }
  };

  const handleOpenTenantPay = (bill) => {
    setTenantPayingBill(bill);
    setTenantPayChannel('bank');
    setTenantPayTransferLast5('');
    setActiveModal('tenantPay');
  };

  const handleTenantSubmitPayment = async (e) => {
    e.preventDefault();
    if (!tenantPayingBill) return;

    if (tenantPayChannel === 'bank' && !tenantPayTransferLast5.trim()) {
      showToast('請填寫匯款帳號末五碼，方便房東對帳確認！', 'warning');
      return;
    }

    const channelNames = {
      bank: `銀行轉帳${tenantPayTransferLast5 ? ` (末5碼: ${tenantPayTransferLast5})` : ''}`,
      cash: '現金交付'
    };
    const finalMethod = channelNames[tenantPayChannel] || (tenantPayChannel === 'cash' ? '現金交付' : '銀行轉帳');

    try {
      await transitionPaymentStatus({
        paymentId: tenantPayingBill.id,
        newStatus: PaymentStatus.TENANT_SUBMITTED,
        metadata: {
          paymentMethod: tenantPayChannel === 'bank' ? 'bank_transfer' : 'cash',
          transferLast5: tenantPayChannel === 'bank' ? tenantPayTransferLast5 : null,
        }
      });

      setPayments(payments.map(p => {
        if (p.id === tenantPayingBill.id) {
          return {
            ...p,
            status: 'tenant_submitted',
            paymentMethod: finalMethod,
            transferLast5: tenantPayChannel === 'bank' ? (tenantPayTransferLast5 || null) : null
          };
        }
        return p;
      }));

      setActiveModal(null);
      setTenantPayingBill(null);
      showToast('🎉 繳款回報已提交，待房東確認入帳。', 'success');
    } catch (err) {
      showToast(`繳納失敗: ${err.message}`, 'error');
    }
  };

  const tenantLeases = currentTenantPhone ? leases.filter(l =>
    l.phone.replace(/[-\s]/g, '') === currentTenantPhone.replace(/[-\s]/g, '') ||
    (l.coPhone && l.coPhone.replace(/[-\s]/g, '') === currentTenantPhone.replace(/[-\s]/g, ''))
  ) : [];
  const currentTenantLease = leases.find(l => l.id === currentTenantLeaseId) || (tenantLeases.length > 0 ? tenantLeases[0] : null);
  const currentTenantProperty = properties.find(p => p.id === currentTenantLease?.propertyId);
  const currentTenantPayments = payments.filter(p => p.leaseId === currentTenantLease?.id);

  const handleTenantPay = async (paymentId) => {
    const bill = payments.find(p => p.id === paymentId);
    if (bill) {
      handleOpenTenantPay(bill);
    } else {
      try {
        await transitionPaymentStatus({
          paymentId,
          newStatus: PaymentStatus.TENANT_SUBMITTED,
          metadata: { paymentMethod: 'cash' }
        });
        setPayments(payments.map(p =>
          p.id === paymentId ? { ...p, status: 'tenant_submitted' } : p
        ));
        showToast('繳款回報已提交，待房東確認入帳。', 'success');
      } catch (err) {
        showToast(`付款失敗: ${err.message}`, 'error');
      }
    }
  };

  // --- filters ---
  const filteredProperties = properties.filter(prop => {
    if (!isMyLandlordProp(prop)) return false;
    const matchesSearch = prop.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prop.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prop.type.toLowerCase().includes(searchQuery.toLowerCase());
    let matchesStatus = true;
    if (filterPropertyStatus === 'occupied') {
      matchesStatus = prop.status === 'occupied';
    } else if (filterPropertyStatus === 'vacant') {
      matchesStatus = prop.status === 'vacant' || prop.status === 'maintenance';
    }
    return matchesSearch && matchesStatus;
  });

  const filteredLeases = landlordLeases.filter(lease => {
    const prop = properties.find(p => p.id === lease.propertyId);
    const propName = prop ? prop.name : '';
    const matchesSearch = lease.tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lease.phone.includes(searchQuery) ||
      (lease.coTenantName && lease.coTenantName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      propName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterLeaseStatus === 'all' || lease.status === filterLeaseStatus;
    return matchesSearch && matchesStatus;
  });

  const filteredPayments = landlordPayments.filter(payment => {
    const prop = properties.find(p => {
      const l = leases.find(le => le.id === payment.leaseId);
      return l ? p.id === l.propertyId : false;
    });
    const propName = payment.propertyName || (prop ? prop.name : '');
    const title = payment.title || '';

    const matchesSearch = payment.tenantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      payment.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      propName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      title.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = filterPaymentStatus === 'all' || payment.status === filterPaymentStatus;
    const matchesProperty = filterPaymentProperty === 'all' || (prop ? prop.id === filterPaymentProperty : false) || payment.propertyId === filterPaymentProperty;

    const normalizedCategory = (t) => {
      if (t === 'water' || t === 'electricity' || t === 'gas') return 'utilities';
      if (t === 'maintenance') return 'other';
      return t || 'rent';
    };
    const matchesCategory = filterPaymentCategory === 'all'
      ? true
      : filterPaymentCategory === 'void'
        ? payment.status === 'void'
        : normalizedCategory(payment.billType) === filterPaymentCategory;

    return matchesSearch && matchesStatus && matchesProperty && matchesCategory;
  });

  const openViewLease = (lease) => {
    setViewingLease(lease);
    setActiveModal('viewLease');
  };

  // --- inner components ---
  const StatusBadge = ({ status }) => {
    const badgeStyles = {
      active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      occupied: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      vacant: 'bg-rose-50 text-rose-700 border-rose-200',
      maintenance: 'bg-rose-50 text-rose-700 border-rose-200',
      paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      pending: 'bg-blue-50 text-blue-700 border-blue-200',
      pending_approval: 'bg-amber-50 text-amber-800 border-amber-300',
      rejected: 'bg-rose-50 text-rose-700 border-rose-200',
      overdue: 'bg-rose-50 text-rose-700 border-rose-200',
      processing: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      resolved: 'bg-slate-100 text-slate-600 border-slate-300',
      void: 'bg-slate-100 text-slate-600 border-slate-300 font-bold',
      voided: 'bg-slate-100 text-slate-600 border-slate-300 font-bold',
    };

    const labelMap = {
      active: '租賃中',
      occupied: '已出租',
      vacant: '未出租',
      maintenance: '未出租',
      paid: '已付款',
      pending: '待付款',
      pending_approval: '待房東審核',
      rejected: '已駁回',
      overdue: '已逾期',
      processing: '處理中',
      resolved: '已結案',
      void: '已作廢',
      voided: '已作廢',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${badgeStyles[status] || 'bg-slate-100 text-slate-800'}`}>
        {labelMap[status] || status}
      </span>
    );
  };

  const isAuthScreen = role === 'portal' || (!currentLandlordId && !currentTenantPhone && !isSuperadminAuthenticated);

  return (
    <div className="flex h-screen bg-slate-100 text-slate-800 font-sans antialiased overflow-hidden">

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 left-4 sm:left-auto sm:right-4 z-[110] space-y-2 max-w-sm pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`p-3.5 sm:p-4 rounded-xl shadow-lg border text-xs sm:text-sm font-semibold pointer-events-auto flex items-center gap-2 animate-in slide-in-from-top-2 duration-200 ${toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
              toast.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
          >
            {toast.type === 'error' ? <AlertCircle size={18} className="text-rose-500 flex-shrink-0" /> :
              toast.type === 'warning' ? <AlertCircle size={18} className="text-amber-500 flex-shrink-0" /> :
                <CheckCircle size={18} className="text-emerald-500 flex-shrink-0" />}
            <span className="leading-snug">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Confirm Dialog Modal (Highest Layer z-[100]) */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-2xl p-5 sm:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <AlertCircle size={20} className="text-amber-500" />
              <span>系統確認</span>
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={confirmDialog.onCancel}
                className="px-4 py-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus:outline-none"
              >
                取消
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors focus:outline-none shadow-xs"
              >
                確定執行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-30 md:hidden transition-opacity"
        />
      )}

      {/* Sidebar Navigation (Only shown when authenticated) */}
      {!isAuthScreen && (
        <div className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-300 flex flex-col justify-between transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}>
        <div>
          {/* Brand Logo & Switcher */}
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-md">
                <Building size={22} />
              </div>
              <div>
                <h1 className="font-bold text-base text-white tracking-wide">智慧租屋管理</h1>
                <p className="text-[10px] text-slate-400 font-mono">
                  {role === 'superadmin' ? '總管理員系統' : role === 'admin' ? '房東管理後台' : role === 'tenant' ? '租客中心' : '首頁入口'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg focus:outline-none"
            >
              <X size={20} />
            </button>
          </div>

          {/* 側邊欄快速身分切換卡片 (Sidebar Role Switcher Card) */}
          {(role === 'admin' || role === 'tenant') && (
            <div className="mx-3 mt-3 mb-1 p-2.5 bg-slate-800/90 rounded-xl border border-slate-700/70 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-400 font-medium">目前操作身分</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                  role === 'admin'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {role === 'admin' ? '🏢 房東管理中' : '🏠 租客中心'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleSwitchRole(role === 'admin' ? 'tenant' : 'admin')}
                className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-bold text-white shadow-xs transition-all ${
                  role === 'admin'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500'
                    : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500'
                }`}
                title={role === 'admin' ? '切換為租客個人中心' : (isApprovedLandlord ? '切換為房東管理後台' : '申請開通房東管理權限')}
              >
                <RefreshCw size={12} className="transition-transform group-hover:rotate-180 duration-500" />
                <span>切換為{role === 'admin' ? '租客模式' : (isApprovedLandlord ? '房東管理模式' : '房東模式 (申請)')}</span>
              </button>
            </div>
          )}

          {/* Role Navigation Items */}
          <nav className="p-4 space-y-1">
            {role === 'superadmin' ? (
              <button
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg bg-slate-800 text-white font-medium focus:outline-none"
              >
                {isSuperadminAuthenticated ? <Users size={20} /> : <Shield size={20} />}
                <span>{isSuperadminAuthenticated ? '會員資料管理' : '管理員身分驗證'}</span>
              </button>
            ) : role === 'admin' ? (
              currentLandlordId ? (
                <>
                  <button
                    onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'dashboard' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <LayoutDashboard size={20} />
                    <span>系統總覽</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('properties'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'properties' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <Building size={20} />
                    <span>房源管理</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('advertise'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'advertise' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <Share2 size={20} />
                    <span>廣告刊登</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('leases'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'leases' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <Users size={20} />
                    <span>租約與租客</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('payments'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'payments' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <DollarSign size={20} />
                    <span>租金收款</span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('history'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'history' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <History size={20} />
                    <span>歷史合約</span>
                  </button>
                </>
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 font-medium">
                  請先登入房東帳戶。
                </div>
              )
            ) : role === 'tenant' ? (
              currentTenantPhone ? (
                <>
                  <button
                    onClick={() => { setActiveTab('portal'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'portal' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <Home size={20} />
                    <span>我的首頁</span>
                  </button>
                  {currentTenantLeaseId && (
                    <button
                      onClick={() => { setActiveTab('contract'); setIsMobileMenuOpen(false); }}
                      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'contract' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                        }`}
                    >
                      <FileText size={20} />
                      <span>租約資訊</span>
                    </button>
                  )}
                  <button
                    onClick={() => { setActiveTab('tenantHistory'); setIsMobileMenuOpen(false); }}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors focus:outline-none ${activeTab === 'tenantHistory' ? 'bg-slate-800 text-white font-semibold' : 'hover:bg-slate-800/50 hover:text-white'
                      }`}
                  >
                    <History size={20} />
                    <span>歷史合約</span>
                  </button>
                </>
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 font-medium">
                  請先登入租客帳號。
                </div>
              )
            ) : null}
          </nav>
        </div>

        {/* Sidebar Footer Logout */}
        <div className="p-4 border-t border-slate-800 space-y-1">
          <button
            onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}
            className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors focus:outline-none text-xs"
          >
            <LogOut size={16} />
            <span>
              {role === 'superadmin' ? '返回入口首頁' : (role === 'admin' && currentLandlordId) ? '登出帳號' : (role === 'tenant' && currentTenantPhone) ? '登出帳號' : '返回入口首頁'}
            </span>
          </button>
        </div>
      </div>
      )}

      {/* Main Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-4 sm:px-8 flex-shrink-0">
          {isAuthScreen ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                  <Building size={20} />
                </div>
                <div>
                  <h1 className="font-bold text-base text-slate-800 tracking-wide">智慧租屋管理整合系統</h1>
                  <p className="text-[10px] text-slate-400 font-medium">Smart Rental Cloud Platform</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>雲端服務運行中</span>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center space-x-2 sm:space-x-4">
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="md:hidden text-slate-600 hover:text-slate-900 focus:outline-none p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
                  title="開啟選單"
                >
                  <Menu size={20} />
                </button>

                {/* Search Bar - hidden on mobile to give room to pill & profile, visible on sm+ */}
                <div className="hidden sm:flex items-center text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg w-40 sm:w-64 transition-all">
                  <Search size={18} className="mr-2 text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="搜尋..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm w-full font-medium text-gray-750"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600 focus:outline-none">
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* User Section */}
              <div className="flex items-center space-x-1.5 sm:space-x-4">
                {/* 頂部身分快速切換膠囊按鈕 (Top Header Role Switcher Pill) */}
                {(role === 'admin' || role === 'tenant') && (
                  <div className="flex items-center bg-slate-100 p-0.5 sm:p-1 rounded-xl border border-slate-200 shadow-xs flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSwitchRole('admin')}
                      className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all ${
                        role === 'admin'
                          ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                      }`}
                      title={isApprovedLandlord ? '切換至房東管理後台' : '申請開通房東身分'}
                    >
                      <Building size={13} />
                      <span className="hidden sm:inline">房東管理</span>
                      <span className="sm:hidden">房東</span>
                      {!isApprovedLandlord && (
                        <span className="ml-0.5 text-[9px] px-1 py-0.2 bg-amber-400/30 text-amber-800 rounded font-semibold">
                          申請
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchRole('tenant')}
                      className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold transition-all ${
                        role === 'tenant'
                          ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
                      }`}
                      title="切換至租客個人中心"
                    >
                      <Home size={13} />
                      <span className="hidden sm:inline">租客中心</span>
                      <span className="sm:hidden">租客</span>
                    </button>
                  </div>
                )}

                <div className="flex items-center space-x-1.5 sm:space-x-2 pl-1 sm:pl-2 border-l border-slate-200/80">
                  <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm shadow-xs select-none flex-shrink-0">
                    {role === 'superadmin' ? '總' : (role === 'admin' && currentLandlordId) ? (landlords.find(l => l.id === currentLandlordId)?.name[0] || '房') : (role === 'tenant' && currentTenantPhone) ? (currentTenantName?.[0] || currentUser?.user_metadata?.name?.[0] || registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === currentTenantPhone.replace(/[-\s]/g, ''))?.name[0] || currentTenantLease?.tenantName[0] || '租') : '訪'}
                  </div>
                  <span className="hidden md:inline text-xs sm:text-sm font-semibold text-gray-700 max-w-[100px] truncate">
                    {role === 'superadmin' ? '總管理員' : (role === 'admin' && currentLandlordId) ? `${landlords.find(l => l.id === currentLandlordId)?.name || '房東'} (房東)` : role === 'admin' ? '未登入房東' : (role === 'tenant' && currentTenantPhone) ? `${currentTenantName || currentUser?.user_metadata?.name || registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === currentTenantPhone.replace(/[-\s]/g, ''))?.name || currentTenantLease?.tenantName || '租客'} (租客)` : '訪客 (未登入)'}
                  </span>
                </div>
              </div>
            </>
          )}
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-8 pb-20 sm:pb-8 bg-slate-50/50">
          <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-300">

            {/* UNIFIED AUTH SCREEN (SINGLE ENTRY FOR LOGIN & REGISTER) */}
            {(role === 'portal' || (!currentLandlordId && !currentTenantPhone && !isSuperadminAuthenticated)) && (
              <div className="relative py-4 sm:py-8 flex flex-col justify-center items-center overflow-hidden w-full max-w-full">
                {/* Decorative Ambient Background */}
                <div className="absolute top-1/4 -left-20 w-80 h-80 bg-indigo-200/35 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-10 -right-20 w-80 h-80 bg-emerald-200/35 rounded-full blur-3xl pointer-events-none" />

                {/* Central Glassmorphic Card */}
                <div className="relative z-10 max-w-md w-full bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-200/60 border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  {/* Brand Header */}
                  <div className="pt-8 pb-6 px-6 sm:px-8 text-center border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white">
                    <div className="w-14 h-14 bg-gradient-to-tr from-indigo-600 via-indigo-500 to-indigo-700 text-white rounded-2xl flex items-center justify-center mx-auto shadow-md shadow-indigo-200 mb-3">
                      <Building size={28} />
                    </div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                      智慧租屋管理整合系統
                    </h1>
                    <p className="text-xs text-slate-500 mt-1 font-medium">
                      房東與租客專屬雲端入口・帳單・合約一站完成
                    </p>
                    <div className="flex items-center justify-center gap-2 mt-3 text-[11px] font-bold">
                      <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full border border-indigo-100">
                        ⚡ 單一入口免分流
                      </span>
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-100">
                        🛡️ 雲端安全加密
                      </span>
                    </div>
                  </div>

                  {/* Segmented Pill Tabs */}
                  <div className="p-1.5 mx-6 sm:mx-8 mt-5 bg-slate-100/90 rounded-2xl flex relative">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        authMode === 'login'
                          ? 'bg-white text-indigo-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <KeyRound size={15} />
                      <span>會員登入</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={`flex-1 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        authMode === 'register'
                          ? 'bg-white text-emerald-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <User size={15} />
                      <span>免費註冊</span>
                    </button>
                  </div>

                  {/* Card Body */}
                  <div className="p-6 sm:p-8 pt-5">
                    {authMode === 'login' ? (
                      <form onSubmit={handleUnifiedLogin} className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            手機號碼
                          </label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                              <Phone size={16} />
                            </div>
                            <input
                              type="tel"
                              placeholder="請輸入註冊的手機號碼 (例如：0912345678)"
                              value={authPhone}
                              onChange={(e) => setAuthPhone(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white font-semibold transition-colors"
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1.5">
                            <label className="block text-xs font-bold text-slate-700">
                              登入密碼
                            </label>
                          </div>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                              <Lock size={16} />
                            </div>
                            <input
                              type={authShowPassword ? 'text' : 'password'}
                              placeholder="請輸入您的登入密碼"
                              value={authPassword}
                              onChange={(e) => setAuthPassword(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white font-semibold transition-colors"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setAuthShowPassword(!authShowPassword)}
                              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                            >
                              {authShowPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={authLoading}
                          className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white font-bold py-3 rounded-xl shadow-md shadow-indigo-200 transition-all text-sm focus:outline-none flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span>{authLoading ? '身分驗證中...' : '安全登入系統'}</span>
                          <ArrowRight size={16} />
                        </button>

                        <div className="relative my-4">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200/80" />
                          </div>
                          <div className="relative flex justify-center text-xs">
                            <span className="bg-white px-3 text-slate-400 font-semibold">或使用 LINE 帳號授權</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => redirectToLineLogin()}
                          className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white font-bold py-3 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 text-sm focus:outline-none cursor-pointer"
                        >
                          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                            <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.122.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.646 1.281-.54 6.911-4.069 9.428-6.967 1.739-1.907 2.572-3.843 2.572-5.993z" />
                          </svg>
                          <span>LINE 帳號一鍵授權登入</span>
                        </button>

                        <div className="pt-2 text-center">
                          <button
                            type="button"
                            onClick={() => setAuthMode('register')}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                          >
                            還沒有帳號？立即免費註冊新會員 →
                          </button>
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={handleUnifiedRegister} className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            真實姓名 <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                              <User size={16} />
                            </div>
                            <input
                              type="text"
                              placeholder="請輸入真實姓名 (例如：林小美)"
                              value={authName}
                              onChange={(e) => setAuthName(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white font-semibold transition-colors"
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            手機號碼 <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                              <Phone size={16} />
                            </div>
                            <input
                              type="tel"
                              placeholder="請輸入手機號碼 (例如：0912345678)"
                              value={authPhone}
                              onChange={(e) => setAuthPhone(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white font-semibold transition-colors"
                              required
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            設定登入密碼 <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                              <Lock size={16} />
                            </div>
                            <input
                              type={authShowPassword ? 'text' : 'password'}
                              placeholder="請設定密碼（6碼以上）"
                              value={authPassword}
                              onChange={(e) => setAuthPassword(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white font-semibold transition-colors"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setAuthShowPassword(!authShowPassword)}
                              className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                            >
                              {authShowPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>

                        {/* Direct Role Selection Cards on Registration */}
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-2">
                            請選擇您的會員身分 <span className="text-rose-500">*</span>
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {/* Tenant Card */}
                            <div
                              onClick={() => setAuthRole('tenant')}
                              className={`border-2 rounded-2xl p-3.5 cursor-pointer transition-all flex flex-col justify-between ${
                                authRole === 'tenant'
                                  ? 'border-emerald-500 bg-emerald-50/70 shadow-xs ring-2 ring-emerald-400/20'
                                  : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className={`p-1.5 rounded-lg ${authRole === 'tenant' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                  <Home size={16} />
                                </div>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                  ⚡ 免審核・即開即用
                                </span>
                              </div>
                              <div>
                                <div className="text-xs font-bold text-slate-800 flex items-center gap-1">
                                  <span>我是房客 (Tenant)</span>
                                  {authRole === 'tenant' && <CheckCircle size={13} className="text-emerald-600" />}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                                  查閱租金帳單、線上合約明細與繳費回報。
                                </p>
                              </div>
                            </div>

                            {/* Landlord Card */}
                            <div
                              onClick={() => setAuthRole('landlord')}
                              className={`border-2 rounded-2xl p-3.5 cursor-pointer transition-all flex flex-col justify-between ${
                                authRole === 'landlord'
                                  ? 'border-indigo-500 bg-indigo-50/70 shadow-xs ring-2 ring-indigo-400/20'
                                  : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className={`p-1.5 rounded-lg ${authRole === 'landlord' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                  <Building size={16} />
                                </div>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                                  🛡️ 管理員審核
                                </span>
                              </div>
                              <div>
                                <div className="text-xs font-bold text-slate-800 flex items-center gap-1">
                                  <span>我是房東 (Landlord)</span>
                                  {authRole === 'landlord' && <CheckCircle size={13} className="text-indigo-600" />}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
                                  房源房間管理、自動出帳、收款入帳審核。
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={authLoading}
                          className={`w-full font-bold py-3 rounded-xl shadow-md transition-all text-sm focus:outline-none flex items-center justify-center gap-2 cursor-pointer text-white disabled:opacity-50 ${
                            authRole === 'tenant'
                              ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-emerald-200'
                              : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 shadow-indigo-200'
                          }`}
                        >
                          {authRole === 'tenant' ? (
                            <>
                              <CheckCircle size={16} />
                              <span>{authLoading ? '帳號建立中...' : '🎉 免費註冊並直接開通房客專區'}</span>
                            </>
                          ) : (
                            <>
                              <span>{authLoading ? '帳號建立中...' : '下一步：填寫房東審核資料'}</span>
                              <ArrowRight size={16} />
                            </>
                          )}
                        </button>

                        <div className="relative my-4">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-slate-200/80" />
                          </div>
                          <div className="relative flex justify-center text-xs">
                            <span className="bg-white px-3 text-slate-400 font-semibold">或使用 LINE 帳號一鍵註冊</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => redirectToLineLogin()}
                          className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white font-bold py-3 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 text-sm focus:outline-none cursor-pointer"
                        >
                          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                            <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.122.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.646 1.281-.54 6.911-4.069 9.428-6.967 1.739-1.907 2.572-3.843 2.572-5.993z" />
                          </svg>
                          <span>LINE 帳號一鍵授權註冊</span>
                        </button>

                        <div className="pt-2 text-center">
                          <button
                            type="button"
                            onClick={() => setAuthMode('login')}
                            className="text-xs font-bold text-emerald-600 hover:text-emerald-800 transition-colors cursor-pointer"
                          >
                            已有帳號？直接登入 →
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  {/* Card Security Footer */}
                  <div className="bg-slate-50/80 px-6 py-3.5 border-t border-slate-100 flex items-center justify-center text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5 font-medium">
                      <ShieldCheck size={13} className="text-emerald-600" />
                      <span>256-bit SSL 安全加密防護</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* SUPER ADMIN CHANNEL - PASSWORD LOGIN CHALLENGE */}
            {role === 'superadmin' && !isSuperadminAuthenticated && (
              <div className="max-w-md mx-auto my-8 bg-white p-8 rounded-3xl shadow-xl border border-slate-100 space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-slate-900 text-amber-400 rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-slate-900/20">
                    <Shield size={32} />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">系統管理員身分驗證</h2>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                    請以 Supabase Auth 管理員帳戶登入。管理員權限只由伺服器端 app_metadata 授予。
                  </p>
                </div>

                <form onSubmit={handleSuperadminLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">管理員聯絡電話</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="請輸入管理員帳戶電話"
                      value={superadminLoginPhone}
                      onChange={(e) => setSuperadminLoginPhone(e.target.value)}
                      autoFocus
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white font-semibold transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span>管理員專屬密碼</span>
                      <span className="text-[10px] text-slate-400 font-normal">Supabase Auth 驗證</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showSuperadminPassword ? 'text' : 'password'}
                        placeholder="請輸入管理員密碼"
                        value={superadminPasswordInput}
                        onChange={(e) => setSuperadminPasswordInput(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white font-semibold transition-all pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSuperadminPassword(!showSuperadminPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                      >
                        {showSuperadminPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={superadminLoginLoading}
                    className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-slate-900/10 hover:shadow-slate-900/25 transition-all text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {superadminLoginLoading ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <>
                        <KeyRound size={18} />
                        <span>驗證身分並進入後台</span>
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-2 text-center border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setRole('portal');
                      setSuperadminLoginPhone('');
                      setSuperadminPasswordInput('');
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 font-semibold transition-colors cursor-pointer"
                  >
                    ← 返回入口首頁
                  </button>
                </div>
              </div>
            )}

            {/* SUPER ADMIN CHANNEL - AUTHENTICATED DASHBOARD */}
            {role === 'superadmin' && isSuperadminAuthenticated && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800">平台總管理後台</h2>
                  <p className="text-xs sm:text-sm text-slate-500">管理平台內所有註冊會員的資料與全站統計</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center">
                    <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600 mr-4">
                      <Users size={24} />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm text-slate-500 font-medium">總註冊房東 (已啟用)</p>
                      <h3 className="text-xl sm:text-2xl font-bold text-slate-800">
                        {landlords.filter(l => l.status !== 'pending').length} 位
                      </h3>
                      {landlords.some(l => l.status === 'pending') && (
                        <p className="text-[10px] text-rose-500 font-bold mt-1 flex items-center">
                          <AlertCircle size={10} className="mr-0.5" />
                          另有 {landlords.filter(l => l.status === 'pending').length} 筆申請待審核
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center">
                    <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600 mr-4">
                      <Building size={24} />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm text-slate-500 font-medium">平台總房源</p>
                      <h3 className="text-xl sm:text-2xl font-bold text-slate-800">{properties.length} 間</h3>
                    </div>
                  </div>
                  <div className="bg-white p-5 sm:p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center">
                    <div className="p-3 bg-rose-50 rounded-xl text-rose-600 mr-4">
                      <CheckCircle size={24} />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm text-slate-500 font-medium">全站平均出租率</p>
                      <h3 className="text-xl sm:text-2xl font-bold text-slate-800">
                        {properties.length > 0 ? Math.round((properties.filter(p => p.status === 'occupied').length / properties.length) * 100) : 0} %
                      </h3>
                    </div>
                  </div>
                </div>

                {/* 會員類別切換 */}
                <div className="flex border-b border-slate-200">
                  <button
                    onClick={() => setSuperadminCategory('landlord')}
                    className={`px-6 py-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 focus:outline-none ${superadminCategory === 'landlord' ? 'border-indigo-600 text-indigo-650' : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    <Building size={16} />
                    <span>房東會員資料</span>
                    <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-medium">
                      {landlords.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setSuperadminCategory('tenant')}
                    className={`px-6 py-3 text-sm font-bold border-b-2 transition-all flex items-center gap-2 focus:outline-none ${superadminCategory === 'tenant' ? 'border-indigo-600 text-indigo-650' : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                  >
                    <Users size={16} />
                    <span>租客會員資料</span>
                    <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-medium">
                      {registeredTenants.length}
                    </span>
                  </button>
                </div>

                {/* Landlords list */}
                {superadminCategory === 'landlord' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-4 mb-4 gap-4">
                      <h3 className="text-base sm:text-lg font-bold text-slate-800">房東名冊管理</h3>
                      <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                        <button
                          onClick={() => setSuperadminTab('approved')}
                          className={`flex-1 sm:flex-none text-center px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${superadminTab === 'approved' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                          已啟用帳戶 ({landlords.filter(l => l.status !== 'pending').length})
                        </button>
                        <button
                          onClick={() => setSuperadminTab('pending')}
                          className={`flex-1 sm:flex-none text-center px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${superadminTab === 'pending' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                            }`}
                        >
                          <span>待審核申請 ({landlords.filter(l => l.status === 'pending').length})</span>
                          {landlords.some(l => l.status === 'pending') && (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                            </span>
                          )}
                        </button>
                      </div>
                    </div>


                    {superadminTab === 'approved' ? (
                      <div>
                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-100 text-xs">
                                <th className="pb-3 px-4 font-bold">房東姓名</th>
                                <th className="pb-3 px-4 font-bold">聯絡電話</th>
                                <th className="pb-3 px-4 font-bold text-center">旗下房源</th>
                                <th className="pb-3 px-4 font-bold text-center">廣告刊登權限</th>
                                <th className="pb-3 px-4 font-bold text-right">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 text-slate-600">
                              {landlords.filter(l => l.status !== 'pending').length === 0 ? (
                                <tr>
                                  <td colSpan="5" className="py-8 text-center text-slate-400">目前無已啟用的房東帳號</td>
                                </tr>
                              ) : (
                                landlords.filter(l => l.status !== 'pending').map(lnd => (
                                  <tr key={lnd.id} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="py-3.5 px-4 font-bold text-slate-800">{lnd.name}</td>
                                    <td className="py-3.5 px-4">{lnd.phone}</td>
                                    <td className="py-3.5 px-4 text-center">
                                      <button
                                        onClick={() => {
                                          setViewingLandlordProps(lnd);
                                          setActiveModal('viewLandlordProperties');
                                        }}
                                        className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-650 rounded-lg text-xs font-bold transition-colors focus:outline-none"
                                      >
                                        <Building size={13} />
                                        <span>{properties.filter(p => p.landlordId === lnd.id).length} 間</span>
                                      </button>
                                    </td>
                                    <td className="py-3.5 px-4 text-center">
                                      <div className="inline-flex items-center gap-2">
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${lnd.adListingEnabled
                                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                                          }`}>
                                          {lnd.adListingEnabled ? '✅ 已開通' : '🔒 未開通'}
                                        </span>
                                        <button
                                          onClick={() => handleToggleLandlordAdPermission(lnd.id, Boolean(lnd.adListingEnabled))}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shadow-2xs ${lnd.adListingEnabled
                                            ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
                                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                            }`}
                                        >
                                          {lnd.adListingEnabled ? '關閉刊登' : '啟用刊登'}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="py-3.5 px-4 text-right">
                                      <button
                                        onClick={() => handleSuperadminDeleteLandlord(lnd.id, lnd.name, lnd.phone)}
                                        className="text-rose-600 hover:text-rose-800 font-bold text-xs inline-flex items-center focus:outline-none"
                                      >
                                        <Trash2 size={13} className="mr-0.5" />
                                        <span>刪除</span>
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Stacked Card View (No Horizontal Scroll) */}
                        <div className="md:hidden space-y-3">
                          {landlords.filter(l => l.status !== 'pending').length === 0 ? (
                            <div className="py-8 text-center text-slate-400 text-sm">目前無已啟用的房東帳號</div>
                          ) : (
                            landlords.filter(l => l.status !== 'pending').map(lnd => (
                              <div key={`m-${lnd.id}`} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
                                <div className="flex justify-between items-center">
                                  <span className="font-bold text-slate-800 text-sm">{lnd.name}</span>
                                  <button
                                    onClick={() => {
                                      setViewingLandlordProps(lnd);
                                      setActiveModal('viewLandlordProperties');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100/70 text-indigo-700 rounded-lg text-xs font-bold"
                                  >
                                    <Building size={12} />
                                    <span>{properties.filter(p => p.landlordId === lnd.id).length} 間房源</span>
                                  </button>
                                </div>
                                <div className="text-xs text-slate-600 flex items-center justify-between">
                                  <span>電話：<a href={`tel:${lnd.phone}`} className="text-indigo-600 font-semibold underline">{lnd.phone}</a></span>
                                </div>
                                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs">
                                  <span className="font-bold text-slate-600">廣告刊登：</span>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${lnd.adListingEnabled
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-200 text-slate-600'
                                      }`}>
                                      {lnd.adListingEnabled ? '已開通' : '未開通'}
                                    </span>
                                    <button
                                      onClick={() => handleToggleLandlordAdPermission(lnd.id, Boolean(lnd.adListingEnabled))}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold ${lnd.adListingEnabled
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-indigo-600 text-white'
                                        }`}
                                    >
                                      {lnd.adListingEnabled ? '關閉' : '啟用'}
                                    </button>
                                  </div>
                                </div>
                                <div className="pt-2 border-t border-slate-200/60 flex justify-end">
                                  <button
                                    onClick={() => handleSuperadminDeleteLandlord(lnd.id, lnd.name, lnd.phone)}
                                    className="text-rose-600 hover:text-rose-800 font-bold text-xs inline-flex items-center"
                                  >
                                    <Trash2 size={13} className="mr-0.5" />
                                    <span>刪除帳號</span>
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div>
                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-100 text-xs">
                                <th className="pb-3 px-4 font-bold">申請房東姓名</th>
                                <th className="pb-3 px-4 font-bold">聯絡電話</th>
                                <th className="pb-3 px-4 font-bold">身分證 / 統編</th>
                                <th className="pb-3 px-4 font-bold">通訊地址 / 備註</th>
                                <th className="pb-3 px-4 font-bold text-right">審核操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50 text-slate-600">
                              {landlords.filter(l => l.status === 'pending').length === 0 ? (
                                <tr>
                                  <td colSpan="5" className="py-8 text-center text-slate-400">目前無待審核的註冊申請</td>
                                </tr>
                              ) : (
                                landlords.filter(l => l.status === 'pending').map(lnd => {
                                  let appDetails = null;
                                  try {
                                    if (lnd.company_name && lnd.company_name.startsWith('{')) {
                                      appDetails = JSON.parse(lnd.company_name);
                                    }
                                  } catch (e) {}

                                  const idNum = appDetails?.idNumber || lnd.id_number || '待查';
                                  const addr = appDetails?.contactAddress || lnd.contact_address || '未提供';
                                  const comp = appDetails?.companyName || lnd.company_name || '';

                                  return (
                                    <tr key={lnd.id} className="hover:bg-slate-50/60 transition-colors">
                                      <td className="py-3.5 px-4 font-bold text-slate-800">
                                        <div>{lnd.name}</div>
                                        {comp && !comp.startsWith('{') && (
                                          <div className="text-[11px] text-indigo-600 font-normal">{comp}</div>
                                        )}
                                      </td>
                                      <td className="py-3.5 px-4 font-medium">{lnd.phone}</td>
                                      <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-700">{idNum}</td>
                                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs truncate" title={addr}>{addr}</td>
                                      <td className="py-3.5 px-4 text-right space-x-2">
                                        <button
                                          onClick={() => handleApproveLandlord(lnd.id, lnd.name)}
                                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-xs transition-colors focus:outline-none cursor-pointer"
                                        >
                                          核准啟用
                                        </button>
                                        <button
                                          onClick={() => handleRejectLandlord(lnd.id, lnd.name)}
                                          className="bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors focus:outline-none cursor-pointer"
                                        >
                                          拒絕
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Stacked Card View */}
                        <div className="md:hidden space-y-3">
                          {landlords.filter(l => l.status === 'pending').length === 0 ? (
                            <div className="py-8 text-center text-slate-400 text-sm">目前無待審核的註冊申請</div>
                          ) : (
                            landlords.filter(l => l.status === 'pending').map(lnd => {
                              let appDetails = null;
                              try {
                                if (lnd.company_name && lnd.company_name.startsWith('{')) {
                                  appDetails = JSON.parse(lnd.company_name);
                                }
                              } catch (e) {}

                              const idNum = appDetails?.idNumber || lnd.id_number || '待查';
                              const addr = appDetails?.contactAddress || lnd.contact_address || '未提供';

                              return (
                                <div key={`m-pend-${lnd.id}`} className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-4 space-y-2.5">
                                  <div className="flex justify-between items-center">
                                    <span className="font-bold text-slate-800 text-sm">{lnd.name}</span>
                                    <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-bold">待審核</span>
                                  </div>
                                  <div className="text-xs text-slate-600 space-y-1">
                                    <div>電話：<a href={`tel:${lnd.phone}`} className="text-indigo-600 font-semibold underline">{lnd.phone}</a></div>
                                    <div>身分證/統編：<span className="font-mono font-bold text-slate-800">{idNum}</span></div>
                                    <div className="truncate">通訊地址：<span className="text-slate-800">{addr}</span></div>
                                  </div>
                                  <div className="flex gap-2 pt-2 border-t border-amber-200/50">
                                    <button
                                      onClick={() => handleApproveLandlord(lnd.id, lnd.name)}
                                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-xs font-bold text-center cursor-pointer"
                                    >
                                      核准啟用
                                    </button>
                                    <button
                                      onClick={() => handleRejectLandlord(lnd.id, lnd.name)}
                                      className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 py-2 rounded-lg text-xs font-bold text-center cursor-pointer"
                                    >
                                      拒絕
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tenant List */}
                {superadminCategory === 'tenant' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-6">
                    <h3 className="text-base sm:text-lg font-bold text-slate-800 border-b border-slate-100 pb-4 mb-4">租客會員名冊</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-100 text-xs">
                            <th className="pb-3 px-4 font-bold">租客姓名</th>
                            <th className="pb-3 px-4 font-bold">聯絡電話</th>
                            <th className="pb-3 px-4 font-bold text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-slate-600">
                          {registeredTenants.length === 0 ? (
                            <tr>
                              <td colSpan="3" className="py-8 text-center text-slate-400">目前無已註冊的租客帳號</td>
                            </tr>
                          ) : (
                            registeredTenants.map(t => (
                              <tr key={t.phone} className="hover:bg-slate-50/60 transition-colors">
                                <td className="py-3.5 px-4 font-bold text-slate-800">{t.name}</td>
                                <td className="py-3.5 px-4">{t.phone}</td>
                                <td className="py-3.5 px-4 text-right">
                                  <button
                                    onClick={() => handleSuperadminDeleteTenant(t.phone, t.name, t.id)}
                                    className="text-rose-600 hover:text-rose-800 font-bold text-xs inline-flex items-center focus:outline-none"
                                  >
                                    <Trash2 size={13} className="mr-0.5" />
                                    <span>註銷帳戶</span>
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* LANDLORD LOGGED IN DASHBOARD & PAYMENTS HUB */}
            {role === 'admin' && currentLandlordId && (activeTab === 'dashboard' || activeTab === 'payments' || !['properties', 'advertise', 'leases', 'history'].includes(activeTab)) && (() => {
              // Financial & category calculations (純租金收入計算：排除押金、水電費、管理費、其他)
              const pendingTenantReports = landlordPayments.filter(p => p.status === 'pending_approval');
              const activeLandlordLeases = leases.filter(l => landlordPropertyIds.includes(l.propertyId) && l.status === 'active');
              const activeLeaseIds = activeLandlordLeases.map(l => l.id);

              // 1. 合約應收總租金 (純租金部分)
              const baseContractRentTotal = activeLandlordLeases.reduce((acc, l) => {
                if (l.totalContractRent && Number(l.totalContractRent) > 0) {
                  return acc + Number(l.totalContractRent);
                }
                const months = calculateMonths(l.startDate, l.endDate);
                return acc + (getLeaseMonthlyRent(l) * months);
              }, 0);

              // 額外開立之租金帳單 (排除非租金項目如押金、水電、管理費、其他，且排除已作廢與已駁回)
              const extraRentBillsTotal = landlordPayments
                .filter(p => p.status !== 'rejected' && p.status !== 'void' && p.billType === 'rent' && !activeLeaseIds.includes(p.leaseId))
                .reduce((acc, p) => acc + (p.amount || 0), 0);

              // 應收租金總額 (純租金)
              const totalExpectedRent = baseContractRentTotal + extraRentBillsTotal;

              // 實收租金總額 (僅計入已付款之租金項目，排除押金/水電/管理/其他)
              const totalPaidRent = landlordPayments
                .filter(p => p.status === 'paid' && p.billType === 'rent')
                .reduce((acc, p) => acc + (p.amount || 0), 0);

              // 尚餘待收租金 (純租金)
              const totalRemainingRent = Math.max(0, totalExpectedRent - totalPaidRent);

              // 待收租金與逾期租金
              const totalPendingRent = landlordPayments
                .filter(p => p.status === 'pending' && p.billType === 'rent')
                .reduce((acc, p) => acc + (p.amount || 0), 0);

              const totalOverdueRent = landlordPayments
                .filter(p => p.status === 'overdue' && p.billType === 'rent')
                .reduce((acc, p) => acc + (p.amount || 0), 0);

              // 租金筆數計算 (純租金，排除已駁回與已作廢)
              const rentPayments = landlordPayments.filter(p => p.billType === 'rent');
              const countRentTotal = rentPayments.filter(p => p.status !== 'rejected' && p.status !== 'void').length;
              const countRentPaid = rentPayments.filter(p => p.status === 'paid').length;
              const countRentPending = rentPayments.filter(p => p.status === 'pending').length;
              const countRentOverdue = rentPayments.filter(p => p.status === 'overdue').length;

              const collectionRateNum = totalExpectedRent > 0 ? ((totalPaidRent / totalExpectedRent) * 100) : (countRentTotal > 0 ? 0 : 100);
              const collectionRateStr = collectionRateNum.toFixed(1);

              const paidPct = totalExpectedRent > 0 ? (totalPaidRent / totalExpectedRent) * 100 : 0;
              const pendingPct = totalExpectedRent > 0 ? (totalPendingRent / totalExpectedRent) * 100 : 0;
              const overduePct = totalExpectedRent > 0 ? Math.max(0, 100 - paidPct - pendingPct) : 0;

              const categoryMap = {
                rent: { label: '租金', icon: '🏠', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                deposit: { label: '押金保證金', icon: '🔒', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                utilities: { label: '水電費', icon: '⚡', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
                management: { label: '管理費', icon: '🏢', color: 'bg-teal-50 text-teal-700 border-teal-200' },
                other: { label: '其他', icon: '📦', color: 'bg-slate-100 text-slate-700 border-slate-300' }
              };

              const getCategoryInfo = (type) => {
                if (type === 'water' || type === 'electricity' || type === 'gas') return categoryMap.utilities;
                if (type === 'maintenance') return categoryMap.other;
                return categoryMap[type] || categoryMap.other;
              };

              return (
                <div className="space-y-6">
                  {/* Top Header & Fast Actions */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                          <Wallet size={24} />
                        </span>
                        <div>
                          <h2 className="text-xl sm:text-2xl font-bold text-slate-800">
                            {activeTab === 'payments' ? '帳單與款項收支管理' : '系統儀表板與收款中心'}
                          </h2>
                          <p className="text-xs sm:text-sm text-slate-500 font-medium">
                            租金收入獨立結算（押金、水電費、管理費等非租金項目不計入租金營收與尚餘租金）
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 w-full sm:flex sm:w-auto">
                      <button
                        onClick={handleOpenLandlordBankModal}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center border border-slate-250 focus:outline-none whitespace-nowrap"
                      >
                        <CreditCard size={15} className="mr-1 sm:mr-1.5 text-slate-550 flex-shrink-0" />
                        <span>設定收款帳戶</span>
                      </button>
                      <button
                        onClick={handleOpenAddCustomBill}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center shadow-xs whitespace-nowrap"
                      >
                        <Plus size={15} className="mr-1 sm:mr-1.5 flex-shrink-0" />
                        <span className="hidden sm:inline">登記帳單/已繳紀錄</span>
                        <span className="sm:hidden">登記新帳單</span>
                      </button>
                    </div>
                  </div>

                  {/* General Stats (When in dashboard tab) */}
                  {activeTab === 'dashboard' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center">
                        <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600 mr-4">
                          <Building size={24} />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 font-medium">房源出租率</p>
                          <h3 className="text-lg sm:text-xl font-bold text-slate-800">
                            {landlordPropertyIds.filter(pid => properties.find(p => p.id === pid)?.status === 'occupied').length} / {landlordPropertyIds.length} 間
                          </h3>
                        </div>
                      </div>
                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center">
                        <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600 mr-4">
                          <CheckCircle size={24} />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 font-medium">累計實收租金</p>
                          <h3 className="text-lg sm:text-xl font-bold text-slate-800">
                            NT$ {totalPaidRent.toLocaleString()}
                          </h3>
                        </div>
                      </div>
                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center">
                        <div className="p-3 bg-amber-50 rounded-xl text-amber-600 mr-4">
                          <DollarSign size={24} />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 font-medium">目前尚餘待收租金</p>
                          <h3 className="text-lg sm:text-xl font-bold text-amber-700">
                            NT$ {totalRemainingRent.toLocaleString()}
                          </h3>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PENDING APPROVAL QUEUE (租客自主回報待審核專區) */}
                  {pendingTenantReports.length > 0 && (
                    <div className="bg-amber-50/70 border-2 border-amber-300 rounded-2xl p-5 shadow-xs space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                          <span className="p-2 bg-amber-500 text-white rounded-xl shadow-xs animate-pulse">
                            <Clock size={18} />
                          </span>
                          <div>
                            <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                              待審核的租客繳費回報 ({pendingTenantReports.length} 筆待確認)
                            </h3>
                            <p className="text-xs text-slate-600 font-medium">
                              房客已自主回報繳款紀錄，查核入帳後請點擊「核准入帳」以正式登記並扣減尚餘租金
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingTenantReports.map(rep => {
                          const catInfo = getCategoryInfo(rep.billType);
                          return (
                            <div key={`approval-${rep.id}`} className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs flex flex-col justify-between space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="flex items-center space-x-2 mb-1">
                                    <span className="font-bold text-slate-800 text-base">{rep.tenantName}</span>
                                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${catInfo.color}`}>
                                      {catInfo.icon} {catInfo.label}{rep.title ? ` (${rep.title})` : ''}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-500">{rep.propertyName} · 回報日期: {rep.dueDate}</p>
                                </div>
                                <div className="text-right">
                                  <span className="text-base sm:text-lg font-black text-slate-900">
                                    NT$ {rep.amount.toLocaleString()}
                                  </span>
                                  <StatusBadge status={rep.status} />
                                </div>
                              </div>

                              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs space-y-1">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">繳納管道：</span>
                                  <span className="font-semibold text-slate-700">{rep.paymentMethod || '線上回報'}</span>
                                </div>
                                {rep.transferLast5 && (
                                  <div className="flex justify-between font-bold text-amber-800">
                                    <span>匯款後五碼：</span>
                                    <span className="font-mono bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">{rep.transferLast5}</span>
                                  </div>
                                )}
                                {rep.note && (
                                  <div className="text-slate-600 pt-1 border-t border-slate-200">
                                    <span>備註：{rep.note}</span>
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-end space-x-2 pt-1 border-t border-slate-100">
                                <button
                                  onClick={() => handleRejectPayment(rep.id)}
                                  className="px-3 py-1.5 text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg font-bold transition-colors"
                                >
                                  駁回
                                </button>
                                <button
                                  onClick={() => handleApprovePayment(rep.id)}
                                  className="px-3.5 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg font-bold transition-colors shadow-xs flex items-center space-x-1"
                                >
                                  <CheckCircle size={14} />
                                  <span>核准入帳</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* FINANCIAL METRIC CARDS (Focusing on Rent Income & Remaining Balance / 租金收入與尚餘租金) */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Hero: Collection Rate & Remaining Balance Gauge */}
                    <div className="lg:col-span-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-md flex flex-col justify-between relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                        <TrendingUp size={160} />
                      </div>

                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
                            全站租金收款進度
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${collectionRateNum >= 100 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                            collectionRateNum >= 75 ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' :
                              'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}>
                            {collectionRateNum >= 100 ? '✨ 全部已結清' : collectionRateNum >= 75 ? '🟢 收款順暢' : '🟡 持續收取中'}
                          </span>
                        </div>

                        <div className="my-4 flex items-baseline space-x-2">
                          <h3 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                            {collectionRateStr}%
                          </h3>
                          <span className="text-indigo-200 text-sm font-medium">租金回收率</span>
                        </div>

                        {/* Visual SVG Progress Ring & Ratio Info */}
                        <div className="space-y-3 pt-2 border-t border-slate-800">
                          <div className="flex justify-between text-xs text-indigo-200">
                            <span>已收租金帳單數：</span>
                            <span className="font-bold text-white">{countRentPaid} / {countRentTotal} 筆</span>
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700">
                            <div
                              className="bg-gradient-to-r from-emerald-400 to-indigo-400 h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.max(0, collectionRateNum))}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t border-slate-800/80 space-y-1">
                        <span className="text-[11px] text-indigo-300 block">目前尚餘待收租金：</span>
                        <span className="text-2xl font-black text-amber-400 font-mono">
                          NT$ {totalRemainingRent.toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Right 4 Financial Metric Cards */}
                    <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Card 1: Total Expected Rent */}
                      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between hover:border-slate-200 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-semibold text-slate-500">應收租金總額 (Expected Rent)</span>
                          <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                            <DollarSign size={18} />
                          </span>
                        </div>
                        <div>
                          <h4 className="text-2xl font-bold text-slate-800">
                            NT$ {totalExpectedRent.toLocaleString()}
                          </h4>
                          <p className="text-xs text-slate-400 font-medium mt-1">
                            共 {activeLandlordLeases.length} 筆有效租約合約
                          </p>
                        </div>
                      </div>

                      {/* Card 2: Collected Rent */}
                      <div className="bg-white rounded-2xl p-5 shadow-sm border border-emerald-100/80 bg-emerald-50/20 flex flex-col justify-between hover:border-emerald-200 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-semibold text-emerald-700">實收租金 (Collected Rent)</span>
                          <span className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                            <CheckCircle size={18} />
                          </span>
                        </div>
                        <div>
                          <h4 className="text-2xl font-bold text-emerald-600">
                            NT$ {totalPaidRent.toLocaleString()}
                          </h4>
                          <p className="text-xs text-emerald-700 font-medium mt-1">
                            已入帳租金 {countRentPaid} 筆 (佔比 {paidPct.toFixed(1)}%)
                          </p>
                        </div>
                      </div>

                      {/* Card 3: Remaining Rent (尚餘租金) - Highlighted */}
                      <div className="bg-gradient-to-br from-amber-50 to-orange-50/40 rounded-2xl p-5 shadow-sm border-2 border-amber-300 flex flex-col justify-between hover:border-amber-400 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-bold text-amber-900 flex items-center">
                            <span className="w-2 h-2 rounded-full bg-amber-500 mr-1.5 animate-pulse" />
                            尚餘待收租金 (Remaining Rent)
                          </span>
                          <span className="p-2 bg-amber-500 text-white rounded-xl shadow-xs">
                            <Clock size={18} />
                          </span>
                        </div>
                        <div>
                          <h4 className="text-2xl sm:text-3xl font-extrabold text-amber-900">
                            NT$ {totalRemainingRent.toLocaleString()}
                          </h4>
                          <p className="text-xs text-amber-800 font-medium mt-1">
                            尚餘 {countRentPending + countRentOverdue} 筆待入帳租金
                          </p>
                        </div>
                      </div>

                      {/* Card 4: Overdue & Pending Approvals */}
                      <div className="bg-white rounded-2xl p-5 shadow-sm border border-rose-100/80 bg-rose-50/20 flex flex-col justify-between hover:border-rose-200 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-semibold text-rose-700">逾期與待審核租金</span>
                          <span className="p-2 bg-rose-100 text-rose-600 rounded-xl">
                            <AlertCircle size={18} />
                          </span>
                        </div>
                        <div>
                          <h4 className="text-2xl font-bold text-rose-600">
                            NT$ {(totalOverdueRent + pendingTenantReports.filter(p => p.billType === 'rent').reduce((a, b) => a + b.amount, 0)).toLocaleString()}
                          </h4>
                          <p className="text-xs text-rose-700 font-medium mt-1">
                            逾期租金 {countRentOverdue} 筆 · 待審核租金 {pendingTenantReports.filter(p => p.billType === 'rent').length} 筆
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Category Quick Filter Pills Toolbar */}
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="flex items-center space-x-2">
                      <Filter size={18} className="text-indigo-600" />
                      <span className="text-sm font-bold text-slate-800">費用類別快速篩選：</span>
                    </div>
                    <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1.5 scrollbar-none no-scrollbar flex-nowrap md:flex-wrap">
                      <button
                        onClick={() => setFilterPaymentCategory('all')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 whitespace-nowrap ${filterPaymentCategory === 'all'
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                      >
                        全部類別 ({landlordPayments.length})
                      </button>
                      {Object.keys(categoryMap).map(catKey => {
                        const cat = categoryMap[catKey];
                        const count = landlordPayments.filter(p => {
                          const norm = (t) => (t === 'water' || t === 'electricity' || t === 'gas') ? 'utilities' : (t === 'maintenance' ? 'other' : (t || 'rent'));
                          return norm(p.billType) === catKey && p.status !== 'void';
                        }).length;
                        return (
                          <button
                            key={catKey}
                            onClick={() => setFilterPaymentCategory(catKey)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1 flex-shrink-0 whitespace-nowrap ${filterPaymentCategory === catKey
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                          >
                            <span>{cat.icon}</span>
                            <span>{cat.label} ({count})</span>
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setFilterPaymentCategory('void')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1 flex-shrink-0 whitespace-nowrap ${filterPaymentCategory === 'void'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                          }`}
                      >
                        <span>🚫</span>
                        <span>已作廢 ({landlordPayments.filter(p => p.status === 'void').length})</span>
                      </button>
                    </div>
                  </div>

                  {/* PAYMENTS INVOICE MANAGEMENT TABLE & FILTERS */}
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-6">
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                      <div>
                        <h3 className="text-base sm:text-lg font-bold text-slate-800">帳單與已繳紀錄清單</h3>
                        <p className="text-xs sm:text-sm text-slate-500 font-medium">
                          管理所有房源各項費用（租金、押金保證金、水電費、管理費、其他）、審核租客回報與開立收據
                        </p>
                      </div>

                      {/* Multi-Filters */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full lg:w-auto">
                        <select
                          value={filterPaymentStatus}
                          onChange={(e) => setFilterPaymentStatus(e.target.value)}
                          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500"
                        >
                          <option value="all">所有付款/審核狀態</option>
                          <option value="paid">已付款 (已入帳)</option>
                          <option value="pending">待付款 (未繳)</option>
                          <option value="pending_approval">待房東審核 (租客回報)</option>
                          <option value="overdue">已逾期 (催繳)</option>
                          <option value="rejected">已駁回</option>
                          <option value="void">已作廢 (作廢存查)</option>
                        </select>

                        <select
                          value={filterPaymentProperty}
                          onChange={(e) => setFilterPaymentProperty(e.target.value)}
                          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500"
                        >
                          <option value="all">所有房源物件</option>
                          {landlordPropertyIds.map(pid => {
                            const p = properties.find(prop => prop.id === pid);
                            return p ? <option key={p.id} value={p.id}>{p.name}</option> : null;
                          })}
                        </select>
                      </div>
                    </div>

                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-100 text-xs bg-slate-50/50">
                            <th className="py-3 px-4 font-semibold rounded-l-xl">項目編號 / 類別</th>
                            <th className="py-3 px-4 font-semibold">房客與房源</th>
                            <th className="py-3 px-4 font-semibold">金額</th>
                            <th className="py-3 px-4 font-semibold">日期 / 期限</th>
                            <th className="py-3 px-4 font-semibold">狀態與管道</th>
                            <th className="py-3 px-4 font-semibold text-right rounded-r-xl">操作動作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-slate-600">
                          {filteredPayments.length === 0 ? (
                            <tr>
                              <td colSpan="6" className="py-12 text-center text-slate-400">
                                <div className="max-w-xs mx-auto space-y-2">
                                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                                    <Receipt size={24} />
                                  </div>
                                  <p className="font-semibold text-slate-600">無符合條件的項目紀錄</p>
                                  <p className="text-xs text-slate-400">您可以點擊右上角「登記帳單/已繳紀錄」建立新項目</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            filteredPayments.map(pay => {
                              const catInfo = getCategoryInfo(pay.billType);
                              const targetLease = leases.find(l => l.id === pay.leaseId);
                              const targetProp = properties.find(p => p.id === targetLease?.propertyId);
                              const isVoid = pay.status === 'void';

                              return (
                                <tr key={pay.id} className={`transition-colors ${isVoid ? 'bg-slate-50/50 opacity-75 hover:opacity-90' : 'hover:bg-slate-50/80'}`}>
                                  <td className="py-3.5 px-4">
                                    <div className="space-y-1">
                                      <span className="text-slate-500 font-mono text-xs block">{pay.id.split('_')[0]}</span>
                                      <span className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${catInfo.color}`}>
                                        <span>{catInfo.icon}</span>
                                        <span>{catInfo.label}{pay.title ? ` (${pay.title})` : ''}</span>
                                      </span>
                                      {pay.creatorRole === 'tenant' && (
                                        <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded block w-max font-semibold">
                                          房客自行回報
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <div>
                                      <span className="text-slate-800 font-bold block">{pay.tenantName}</span>
                                      <span className="text-xs text-slate-500 font-medium">
                                        {pay.propertyName || targetProp?.name || '租賃房間'}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <span className={`text-base font-extrabold ${isVoid ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                      NT$ {pay.amount.toLocaleString()}
                                    </span>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <div>
                                      <span className="text-slate-700 font-semibold text-xs block">{pay.dueDate}</span>
                                      {pay.status === 'pending' && (
                                        <span className={`text-[10px] font-bold ${new Date(pay.dueDate) < new Date() ? 'text-rose-600' : 'text-slate-400'
                                          }`}>
                                          {new Date(pay.dueDate) < new Date() ? '⚠️ 已逾期' : '期限內'}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4">
                                    <div className="space-y-1">
                                      <StatusBadge status={pay.status} />
                                      {isVoid ? (
                                        <div className="text-[11px] text-rose-700 font-semibold bg-rose-50 border border-rose-200 px-2 py-0.5 rounded w-max">
                                          由 {pay.voidedBy || '管理員'} 作廢
                                          {pay.voidedAt && <span className="block text-[10px] text-slate-400 font-mono">({pay.voidedAt})</span>}
                                        </div>
                                      ) : (
                                        <>
                                          {pay.status === 'paid' && (
                                            <div className="text-[11px] text-slate-500">
                                              <span>{formatPaymentMethod(pay.paymentMethod)}</span>
                                              {pay.paidDate && <span className="block text-slate-400 font-mono text-[10px]">({pay.paidDate})</span>}
                                            </div>
                                          )}
                                          {pay.transferLast5 && (
                                            <span className="inline-block text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                              轉帳末5碼: {pay.transferLast5}
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3.5 px-4 text-right">
                                    {isVoid ? (
                                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                                        <XCircle size={13} className="text-slate-400" />
                                        <span>已作廢存查</span>
                                      </span>
                                    ) : (
                                      <div className="flex items-center justify-end space-x-2">
                                        {pay.status === 'pending_approval' ? (
                                          <>
                                            <button
                                              onClick={() => handleApprovePayment(pay.id)}
                                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center shadow-xs"
                                            >
                                              <CheckCircle size={13} className="mr-1" />
                                              <span>核准</span>
                                            </button>
                                            <button
                                              onClick={() => handleRejectPayment(pay.id)}
                                              className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold px-2.5 py-1.5 rounded-lg transition-colors"
                                            >
                                              駁回
                                            </button>
                                          </>
                                        ) : pay.status === 'paid' ? (
                                          <button
                                            onClick={() => handleOpenReceipt(pay)}
                                            className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center shadow-2xs"
                                          >
                                            <Printer size={13} className="mr-1" />
                                            <span>收據</span>
                                          </button>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => handleOpenRecordPayment(pay)}
                                              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center shadow-xs"
                                            >
                                              <CheckCircle size={13} className="mr-1" />
                                              <span>確認收款</span>
                                            </button>
                                            <button
                                              onClick={() => handleSendPaymentReminder(pay)}
                                              title="發送催繳提醒通知"
                                              className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold p-1.5 rounded-lg transition-colors"
                                            >
                                              <Send size={14} />
                                            </button>
                                          </>
                                        )}
                                        <button
                                          onClick={() => handleDeletePayment(pay.id, pay.title || `${pay.tenantName} 的紀錄`)}
                                          title="作廢此帳單（保留於雙方紀錄中並標註作廢）"
                                          className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors inline-flex items-center gap-1 font-bold text-xs"
                                        >
                                          <Trash2 size={14} />
                                          <span className="hidden sm:inline">作廢</span>
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Responsive Cards */}
                    <div className="md:hidden space-y-3">
                      {filteredPayments.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 text-sm">無符合條件的項目紀錄</div>
                      ) : (
                        filteredPayments.map(pay => {
                          const catInfo = getCategoryInfo(pay.billType);
                          const targetLease = leases.find(l => l.id === pay.leaseId);
                          const targetProp = properties.find(p => p.id === targetLease?.propertyId);
                          const propName = pay.propertyName || targetProp?.name || '租賃房間';
                          const isVoid = pay.status === 'void';

                          return (
                            <div key={`m-pay-${pay.id}`} className={`border rounded-2xl p-4 space-y-3 shadow-2xs ${isVoid ? 'bg-slate-100/70 border-slate-200 opacity-80' : 'bg-slate-50 border-slate-200/80'}`}>
                              <div className="flex justify-between items-start gap-2">
                                <div className="space-y-1">
                                  <span className="text-[10px] text-slate-400 font-mono block">{pay.id.split('_')[0]}</span>
                                  <h4 className="font-bold text-slate-800 text-base">{pay.tenantName}</h4>
                                  <div className="text-xs text-slate-600 font-medium flex items-center gap-1">
                                    <Building size={13} className="text-slate-400" />
                                    <span>{propName}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                    <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded border ${catInfo.color}`}>
                                      <span>{catInfo.icon}</span>
                                      <span>{catInfo.label}{pay.title ? ` (${pay.title})` : ''}</span>
                                    </span>
                                    {pay.creatorRole === 'tenant' && (
                                      <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-semibold border border-amber-200">
                                        房客回報
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <StatusBadge status={pay.status} />
                              </div>

                              <div className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-slate-200/60 bg-white p-3 rounded-xl border">
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-500 font-medium">金額</span>
                                  <span className={`font-bold text-sm font-mono ${isVoid ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                    NT$ {pay.amount.toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="text-slate-500 font-medium">日期/期限</span>
                                  <div className="text-right">
                                    <span className="text-slate-700 font-semibold">{pay.dueDate}</span>
                                    {pay.status === 'pending' && (
                                      <span className={`text-[10px] ml-1 font-bold ${new Date(pay.dueDate) < new Date() ? 'text-rose-600' : 'text-slate-400'}`}>
                                        {new Date(pay.dueDate) < new Date() ? '⚠️ 已逾期' : '(期限內)'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isVoid ? (
                                  <div className="text-rose-700 font-semibold pt-1 border-t border-slate-100 space-y-0.5">
                                    <div className="flex justify-between">
                                      <span>作廢人員：</span>
                                      <span>{pay.voidedBy || '管理員'}</span>
                                    </div>
                                    {pay.voidedAt && (
                                      <div className="flex justify-between text-slate-500 text-[11px]">
                                        <span>作廢時間：</span>
                                        <span className="font-mono">{pay.voidedAt}</span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    {pay.status === 'paid' && (
                                      <div className="flex justify-between text-emerald-700 font-semibold">
                                        <span>入帳資訊</span>
                                        <span>{formatPaymentMethod(pay.paymentMethod)}{pay.paidDate ? ` (${pay.paidDate})` : ''}</span>
                                      </div>
                                    )}
                                    {pay.transferLast5 && (
                                      <div className="flex justify-between text-amber-700 font-bold">
                                        <span>轉帳末5碼</span>
                                        <span className="font-mono bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">{pay.transferLast5}</span>
                                      </div>
                                    )}
                                  </>
                                )}
                                {pay.note && (
                                  <div className="flex justify-between text-slate-500 pt-1 border-t border-slate-100">
                                    <span>備註說明</span>
                                    <span className="text-slate-700 truncate max-w-[180px]">{pay.note}</span>
                                  </div>
                                )}
                              </div>

                              {/* Mobile Action Buttons */}
                              <div className="pt-1 flex gap-2">
                                {isVoid ? (
                                  <div className="w-full text-center text-xs font-semibold text-slate-400 bg-slate-200/60 py-2 rounded-xl">
                                    此帳單已作廢存查
                                  </div>
                                ) : pay.status === 'pending_approval' ? (
                                  <>
                                    <button
                                      onClick={() => handleApprovePayment(pay.id)}
                                      className="flex-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 py-2 rounded-xl font-bold transition-colors shadow-xs flex items-center justify-center"
                                    >
                                      <CheckCircle size={14} className="mr-1" /> 核准入帳
                                    </button>
                                    <button
                                      onClick={() => handleRejectPayment(pay.id)}
                                      className="px-3 text-xs bg-rose-50 text-rose-700 border border-rose-200 py-2 rounded-xl font-bold transition-colors"
                                    >
                                      駁回
                                    </button>
                                    <button
                                      onClick={() => handleDeletePayment(pay.id, pay.title || `${pay.tenantName} 的紀錄`)}
                                      className="px-3 text-xs bg-slate-100 text-slate-600 hover:text-rose-600 py-2 rounded-xl font-bold transition-colors"
                                      title="作廢"
                                    >
                                      作廢
                                    </button>
                                  </>
                                ) : pay.status === 'paid' ? (
                                  <>
                                    <button
                                      onClick={() => handleOpenReceipt(pay)}
                                      className="flex-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 py-2 rounded-xl font-bold transition-colors flex items-center justify-center"
                                    >
                                      <Printer size={14} className="mr-1" /> 檢視收據
                                    </button>
                                    <button
                                      onClick={() => handleDeletePayment(pay.id, pay.title || `${pay.tenantName} 的紀錄`)}
                                      className="px-3 text-xs bg-slate-100 text-slate-600 hover:text-rose-600 py-2 rounded-xl font-bold transition-colors"
                                      title="作廢"
                                    >
                                      作廢
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleOpenRecordPayment(pay)}
                                      className="flex-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700 py-2 rounded-xl font-bold transition-colors shadow-xs flex items-center justify-center"
                                    >
                                      <CheckCircle size={14} className="mr-1" /> 確認收款
                                    </button>
                                    <button
                                      onClick={() => handleSendPaymentReminder(pay)}
                                      className="px-3 text-xs bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 py-2 rounded-xl font-bold transition-colors flex items-center justify-center"
                                    >
                                      <Send size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleDeletePayment(pay.id, pay.title || `${pay.tenantName} 的紀錄`)}
                                      className="px-3 text-xs bg-slate-100 text-slate-600 hover:text-rose-600 py-2 rounded-xl font-bold transition-colors"
                                      title="作廢"
                                    >
                                      作廢
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* LANDLORD PROPERTIES PANEL */}
            {role === 'admin' && currentLandlordId && activeTab === 'properties' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-800">房源管理</h2>
                    <p className="text-xs sm:text-sm text-slate-500">管理所有出租房屋資訊與空置狀態</p>
                  </div>
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <select
                      value={filterPropertyStatus}
                      onChange={(e) => setFilterPropertyStatus(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 outline-none flex-1 sm:flex-none"
                    >
                      <option value="all">所有狀態</option>
                      <option value="occupied">已出租</option>
                      <option value="vacant">未出租</option>
                    </select>
                    <button
                      onClick={handleOpenLandlordBankModal}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center border border-slate-250 flex-1 sm:flex-none focus:outline-none"
                    >
                      <CreditCard size={16} className="mr-1 text-slate-550" />
                      <span>設定收款帳戶</span>
                    </button>
                    <button
                      onClick={() => {
                        setNewAddressText('');
                        setActiveModal('manageAddresses');
                      }}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center justify-center border border-slate-250 flex-1 sm:flex-none focus:outline-none"
                    >
                      <Building size={16} className="mr-1 text-slate-550" />
                      <span>管理租屋地址</span>
                    </button>
                    <button
                      onClick={() => {
                        const myAddresses = landlordAddresses.filter(addr => addr.landlordId === currentLandlordId);
                        if (myAddresses.length === 0) {
                          showToast('請先新增「租屋地址」後，才能新增房間房號！', 'error');
                          return;
                        }
                        setPropName('');
                        setPropType('獨立套房');
                        setPropRent('');
                        setPropRentPeriod('monthly');
                        setPropStatus('vacant');
                        setPropAddress(myAddresses[0].address);
                        setActiveModal('addProperty');
                      }}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center shadow-xs flex-1 sm:flex-none focus:outline-none"
                    >
                      <Plus size={16} className="mr-1" />
                      <span>新增房間房號</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">

                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-100">
                        <tr className="text-xs">
                          <th className="py-4 px-2 text-center w-10"></th>
                          <th className="p-4 font-semibold">目前狀態</th>
                          <th className="p-4 font-semibold">租屋地址</th>
                          <th className="p-4 font-semibold">房源名稱/房號</th>
                          <th className="p-4 font-semibold">類型</th>
                          <th className="p-4 font-semibold">租金</th>
                          <th className="p-4 font-semibold text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-600">
                        {filteredProperties.length === 0 ? (
                          <tr>
                            <td colSpan="7" className="p-8 text-center text-slate-400">目前無符合條件的房源</td>
                          </tr>
                        ) : (
                          filteredProperties.map(prop => {
                            const isDragging = draggedPropId === prop.id || touchPropId === prop.id;
                            const isOver = dragOverPropId === prop.id && !isDragging;

                            return (
                              <tr
                                key={prop.id}
                                draggable="true"
                                data-prop-id={prop.id}
                                onDragStart={(e) => handlePropDragStart(e, prop.id)}
                                onDragOver={(e) => handlePropDragOver(e, prop.id)}
                                onDrop={(e) => handlePropDrop(e, prop.id)}
                                onDragEnd={handlePropDragEnd}
                                onTouchStart={() => handlePropTouchStart(prop.id)}
                                onTouchMove={handlePropTouchMove}
                                onTouchEnd={handlePropTouchEnd}
                                className={`transition-all duration-150 ${
                                  isDragging
                                    ? 'opacity-40 bg-indigo-100/70 border-2 border-dashed border-indigo-400 scale-[0.99]'
                                    : isOver
                                    ? 'bg-indigo-50 border-t-2 border-t-indigo-600 shadow-sm'
                                    : 'hover:bg-slate-50/70'
                                }`}
                              >
                                <td className="py-4 px-2 text-center">
                                  <div
                                    className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg inline-flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors"
                                    title="拖曳換位"
                                  >
                                    <GripVertical size={16} />
                                  </div>
                                </td>
                                <td className="p-4">
                                  <div
                                    onClick={() => handleTogglePropertyStatusWithConfirm(prop.id, prop.name, prop.status)}
                                    className={`relative w-20 h-8 rounded-full cursor-pointer transition-colors duration-300 flex items-center px-2 text-[10px] font-bold select-none border ${prop.status === 'occupied' ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-slate-200 border-slate-300 text-slate-500'
                                      }`}
                                  >
                                    <div
                                      className={`absolute top-[3px] left-[3px] w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-300 ${prop.status === 'occupied' ? 'translate-x-[50px]' : 'translate-x-0'
                                        }`}
                                    />
                                    <span className={`transition-all duration-300 z-10 ${prop.status === 'occupied' ? 'opacity-100 pl-0.5' : 'opacity-0 w-0 overflow-hidden'}`}>
                                      已出租
                                    </span>
                                    <span className={`transition-all duration-300 z-10 ml-auto ${prop.status === 'occupied' ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 pr-0.5'}`}>
                                      未出租
                                    </span>
                                  </div>
                                </td>
                                <td className="p-4 text-slate-600 font-medium text-xs sm:text-sm">{prop.address || '未填寫'}</td>
                                <td className="p-4 font-bold text-slate-800">{prop.name}</td>
                                <td className="p-4 text-slate-600">{prop.type}</td>
                                <td className="p-4 text-slate-800 font-semibold">NT$ {prop.rent.toLocaleString()}/{prop.rentPeriod === 'yearly' ? '年' : '月'}</td>
                                <td className="p-4 text-right space-x-2">
                                  <button
                                    onClick={() => handleEditPropertyOpen(prop)}
                                    className="text-indigo-600 hover:text-indigo-800 font-semibold text-xs inline-flex items-center focus:outline-none"
                                  >
                                    <Edit3 size={14} className="mr-0.5" />
                                    <span>編輯</span>
                                  </button>
                                  <button
                                    onClick={() => handleDeleteProperty(prop.id)}
                                    className="text-rose-600 hover:text-rose-800 font-semibold text-xs inline-flex items-center focus:outline-none"
                                  >
                                    <Trash2 size={14} className="mr-0.5" />
                                    <span>刪除</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Stacked Card View (Vertical line-broken flow with Long-Press Drag) */}
                  <div className="md:hidden divide-y divide-slate-100">
                    {filteredProperties.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-sm">目前無符合條件的房源</div>
                    ) : (
                      filteredProperties.map(prop => {
                        const isDragging = draggedPropId === prop.id || touchPropId === prop.id;
                        const isOver = dragOverPropId === prop.id && !isDragging;

                        return (
                          <div
                            key={`m-prop-${prop.id}`}
                            draggable="true"
                            data-prop-id={prop.id}
                            onDragStart={(e) => handlePropDragStart(e, prop.id)}
                            onDragOver={(e) => handlePropDragOver(e, prop.id)}
                            onDrop={(e) => handlePropDrop(e, prop.id)}
                            onDragEnd={handlePropDragEnd}
                            onTouchStart={() => handlePropTouchStart(prop.id)}
                            onTouchMove={handlePropTouchMove}
                            onTouchEnd={handlePropTouchEnd}
                            className={`p-4 space-y-3 transition-all duration-150 ${
                              isDragging
                                ? 'opacity-40 bg-indigo-50 border-2 border-dashed border-indigo-400 scale-[0.98] rounded-2xl'
                                : isOver
                                ? 'bg-indigo-50/80 border-t-2 border-t-indigo-600'
                                : 'hover:bg-slate-50/50'
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-slate-100 text-slate-400 rounded-lg cursor-grab active:cursor-grabbing border border-slate-200">
                                  <GripVertical size={16} />
                                </div>
                                <div>
                                  <h4 className="font-bold text-slate-900 text-base">{prop.name}</h4>
                                  <span className="text-xs text-slate-500 font-medium">{prop.type}</span>
                                </div>
                              </div>
                              <div
                                onClick={() => handleTogglePropertyStatusWithConfirm(prop.id, prop.name, prop.status)}
                                className={`relative w-20 h-7 rounded-full cursor-pointer transition-colors duration-300 flex items-center px-2 text-[10px] font-bold select-none border ${prop.status === 'occupied' ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-slate-200 border-slate-300 text-slate-500'
                                  }`}
                              >
                                <div
                                  className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${prop.status === 'occupied' ? 'translate-x-[52px]' : 'translate-x-0'
                                    }`}
                                />
                                <span className={`transition-all duration-300 z-10 ${prop.status === 'occupied' ? 'opacity-100 pl-0.5' : 'opacity-0 w-0 overflow-hidden'}`}>
                                  已出租
                                </span>
                                <span className={`transition-all duration-300 z-10 ml-auto ${prop.status === 'occupied' ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 pr-0.5'}`}>
                                  未出租
                                </span>
                              </div>
                            </div>

                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs text-slate-600">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-slate-400 text-[11px]">租屋地址：</span>
                                <span className="text-slate-800 font-medium break-all">{prop.address || '未填寫'}</span>
                              </div>
                              <div className="flex justify-between items-center pt-1 border-t border-slate-200/50">
                                <span className="text-slate-400 text-[11px]">租金：</span>
                                <span className="text-indigo-600 font-bold text-sm">NT$ {prop.rent.toLocaleString()}/{prop.rentPeriod === 'yearly' ? '年' : '月'}</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={() => handleEditPropertyOpen(prop)}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center border border-indigo-100"
                              >
                                <Edit3 size={13} className="mr-1" />
                                <span>編輯</span>
                              </button>
                              <button
                                onClick={() => handleDeleteProperty(prop.id)}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold px-3.5 py-1.5 rounded-xl text-xs flex items-center border border-rose-100"
                              >
                                <Trash2 size={13} className="mr-1" />
                                <span>刪除</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* LANDLORD ADVERTISEMENT PANEL */}
            {role === 'admin' && currentLandlordId && activeTab === 'advertise' && (() => {
              const currentLandlord = landlords.find(l => l.id === currentLandlordId);
              const isAdEnabled = Boolean(currentLandlord?.adListingEnabled);

              return (
                <div className="space-y-6">
                  {/* Top Header with Ad Status */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-800">廣告刊登管理</h2>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-2xs ${isAdEnabled
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                          {isAdEnabled ? <CheckCircle size={13} /> : <Lock size={13} />}
                          <span>{isAdEnabled ? '已開通廣告刊登' : '未開通 (需由管理員開啟)'}</span>
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">結合房源管理，設定公開展示狀態與上傳房源實景照片</p>
                    </div>

                    <button
                      onClick={() => setActiveTab('properties')}
                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-4 py-2 rounded-xl text-xs sm:text-sm border border-indigo-200 transition-colors flex items-center gap-1.5"
                    >
                      <Building size={16} />
                      <span>返回房源清單管理</span>
                    </button>
                  </div>

                  {/* Permission Status Banner */}
                  <div className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-2xs ${isAdEnabled
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                    : 'bg-amber-50/80 border-amber-200 text-amber-950'
                    }`}>
                    <div className="flex items-start sm:items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-2xs ${isAdEnabled ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
                        }`}>
                        {isAdEnabled ? <CheckCircle size={22} /> : <Lock size={22} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm sm:text-base">
                            {isAdEnabled ? '廣告刊登功能：已開通 (啟用中)' : '廣告刊登功能：尚未開通 (權限受限)'}
                          </h3>
                        </div>
                        <p className="text-xs mt-0.5 opacity-85 leading-relaxed">
                          {isAdEnabled
                            ? '✅ 您的帳號已由管理員開通廣告刊登權限，可自由切換各房源的刊登狀態與管理展示相簿。'
                            : '🔒 此功能須由系統管理員於後台為您的房東帳號啟用後方可進行公開刊登。若需開通請聯繫平台管理員。'}
                        </p>
                      </div>
                    </div>

                    {!isAdEnabled && (
                      <span className="text-[11px] font-bold px-3 py-1.5 bg-white/90 border border-amber-300 rounded-xl text-amber-800 self-stretch sm:self-auto text-center flex-shrink-0">
                        🔒 刊登切換受限中
                      </span>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-100 bg-slate-50/75 text-xs uppercase tracking-wider">
                            <th className="p-4 font-semibold text-center w-16"></th>
                            <th className="p-4 font-semibold">刊登狀態</th>
                            <th className="p-4 font-semibold">租屋地址</th>
                            <th className="p-4 font-semibold">房源名稱</th>
                            <th className="p-4 font-semibold">類型</th>
                            <th className="p-4 font-semibold">租金</th>
                            <th className="p-4 font-semibold text-right">房源照片管理</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-600">
                          {filteredProperties.length === 0 ? (
                            <tr>
                              <td colSpan="7" className="p-8 text-center text-slate-400">目前尚無建立任何房源物件</td>
                            </tr>
                          ) : (
                            filteredProperties.map(prop => {
                              const isDragging = draggedPropId === prop.id || touchPropId === prop.id;
                              const isOver = dragOverPropId === prop.id && !isDragging;

                              return (
                                <tr
                                  key={prop.id}
                                  draggable="true"
                                  data-prop-id={prop.id}
                                  onDragStart={(e) => handlePropDragStart(e, prop.id)}
                                  onDragOver={(e) => handlePropDragOver(e, prop.id)}
                                  onDrop={(e) => handlePropDrop(e, prop.id)}
                                  onDragEnd={handlePropDragEnd}
                                  onTouchStart={() => handlePropTouchStart(prop.id)}
                                  onTouchMove={handlePropTouchMove}
                                  onTouchEnd={handlePropTouchEnd}
                                  className={`transition-all duration-150 ${
                                    isDragging
                                      ? 'opacity-40 bg-indigo-100/70 border-2 border-dashed border-indigo-400 scale-[0.99]'
                                      : isOver
                                      ? 'bg-indigo-50 border-t-2 border-t-indigo-600 shadow-sm'
                                      : 'hover:bg-slate-50/70'
                                  }`}
                                >
                                  <td className="p-4 text-center">
                                    <div
                                      className="p-1.5 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg inline-flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors"
                                    >
                                      <GripVertical size={16} />
                                    </div>
                                  </td>
                                  <td className="p-4">
                                    <div
                                      onClick={() => handleToggleAdvertiseWithConfirm(prop.id, prop.name, prop.isAdvertised)}
                                      className={`relative w-20 h-8 rounded-full cursor-pointer transition-colors duration-300 flex items-center px-2 text-[10px] font-bold select-none border ${
                                        prop.isAdvertised
                                          ? 'bg-emerald-500 border-emerald-600 text-white'
                                          : 'bg-slate-200 border-slate-300 text-slate-500'
                                      } ${!isAdEnabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                                      title={!isAdEnabled ? '未開通廣告權限' : '點擊切換刊登狀態'}
                                    >
                                      <div
                                        className={`absolute top-[3px] left-[3px] w-6 h-6 bg-white rounded-full shadow-md transform transition-transform duration-300 ${
                                          prop.isAdvertised ? 'translate-x-[50px]' : 'translate-x-0'
                                        }`}
                                      />
                                      <span className={`transition-all duration-300 z-10 ${prop.isAdvertised ? 'opacity-100 pl-0.5' : 'opacity-0 w-0 overflow-hidden'}`}>
                                        刊登中
                                      </span>
                                      <span className={`transition-all duration-300 z-10 ml-auto ${prop.isAdvertised ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 pr-0.5'}`}>
                                        未刊登
                                      </span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-slate-600 font-medium text-xs sm:text-sm">{prop.address || '未填寫'}</td>
                                  <td className="p-4 font-bold text-slate-800">
                                    <div className="flex items-center gap-2.5">
                                      {prop.photos && prop.photos.length > 0 ? (
                                        <img
                                          src={prop.photos.find(img => img.isCover)?.url || prop.photos[0].url}
                                          alt={prop.name}
                                          className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                                        />
                                      ) : (
                                        <div className="w-10 h-10 bg-slate-100 text-slate-400 rounded-lg flex items-center justify-center border border-slate-200">
                                          <Image size={16} />
                                        </div>
                                      )}
                                      <span>{prop.name}</span>
                                    </div>
                                  </td>
                                  <td className="p-4 text-slate-600">{prop.type}</td>
                                  <td className="p-4 text-slate-800 font-semibold">NT$ {prop.rent.toLocaleString()}/{prop.rentPeriod === 'yearly' ? '年' : '月'}</td>
                                  <td className="p-4 text-right">
                                    <button
                                      onClick={() => handleOpenPhotoModal(prop)}
                                      className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors focus:outline-none inline-flex items-center gap-1.5 text-xs shadow-2xs"
                                    >
                                      <Upload size={13} />
                                      <span>上傳/管理照片 ({prop.photos?.length || 0})</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Stacked Card View (With Long-Press Touch Drag) */}
                    <div className="md:hidden divide-y divide-slate-100">
                      {filteredProperties.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 text-sm">目前尚無建立任何房源物件</div>
                      ) : (
                        filteredProperties.map(prop => {
                          const isDragging = draggedPropId === prop.id || touchPropId === prop.id;
                          const isOver = dragOverPropId === prop.id && !isDragging;

                          return (
                            <div
                              key={`m-adv-${prop.id}`}
                              draggable="true"
                              data-prop-id={prop.id}
                              onDragStart={(e) => handlePropDragStart(e, prop.id)}
                              onDragOver={(e) => handlePropDragOver(e, prop.id)}
                              onDrop={(e) => handlePropDrop(e, prop.id)}
                              onDragEnd={handlePropDragEnd}
                              onTouchStart={() => handlePropTouchStart(prop.id)}
                              onTouchMove={handlePropTouchMove}
                              onTouchEnd={handlePropTouchEnd}
                              className={`p-4 space-y-3 transition-all duration-150 ${
                                isDragging
                                  ? 'opacity-40 bg-indigo-50 border-2 border-dashed border-indigo-400 scale-[0.98] rounded-2xl'
                                  : isOver
                                  ? 'bg-indigo-50/80 border-t-2 border-t-indigo-600'
                                  : 'hover:bg-slate-50/50'
                              }`}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="p-1.5 bg-slate-100 text-slate-400 rounded-lg cursor-grab active:cursor-grabbing border border-slate-200 flex-shrink-0">
                                    <GripVertical size={16} />
                                  </div>
                                  {prop.photos && prop.photos.length > 0 ? (
                                    <img
                                      src={prop.photos.find(img => img.isCover)?.url || prop.photos[0].url}
                                      alt={prop.name}
                                      className="w-12 h-12 object-cover rounded-xl border border-slate-200 flex-shrink-0"
                                    />
                                  ) : (
                                    <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center border border-slate-200 flex-shrink-0">
                                      <Image size={20} />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <h4 className="font-bold text-slate-900 text-sm truncate">{prop.name}</h4>
                                    <span className="text-xs text-slate-500 font-medium">{prop.type}</span>
                                  </div>
                                </div>

                                <div
                                  onClick={() => handleToggleAdvertiseWithConfirm(prop.id, prop.name, prop.isAdvertised)}
                                  className={`relative w-20 h-7 rounded-full cursor-pointer transition-colors duration-300 flex items-center px-2 text-[10px] font-bold select-none border flex-shrink-0 ${
                                    prop.isAdvertised ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-slate-200 border-slate-300 text-slate-500'
                                  } ${!isAdEnabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                  <div
                                    className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${
                                      prop.isAdvertised ? 'translate-x-[52px]' : 'translate-x-0'
                                    }`}
                                  />
                                  <span className={`transition-all duration-300 z-10 ${prop.isAdvertised ? 'opacity-100 pl-0.5' : 'opacity-0 w-0 overflow-hidden'}`}>
                                    刊登中
                                  </span>
                                  <span className={`transition-all duration-300 z-10 ml-auto ${prop.isAdvertised ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 pr-0.5'}`}>
                                    未刊登
                                  </span>
                                </div>
                              </div>

                              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1 text-xs text-slate-600">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-slate-400 text-[11px]">租屋地址：</span>
                                  <span className="text-slate-800 font-medium break-all">{prop.address || '未填寫'}</span>
                                </div>
                                <div className="flex justify-between items-center pt-1 border-t border-slate-200/50">
                                  <span className="text-slate-400 text-[11px]">租金：</span>
                                  <span className="text-indigo-600 font-bold text-sm">NT$ {prop.rent.toLocaleString()}/{prop.rentPeriod === 'yearly' ? '年' : '月'}</span>
                                </div>
                              </div>

                              <div className="pt-1">
                                <button
                                  onClick={() => handleOpenPhotoModal(prop)}
                                  className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2 rounded-xl text-xs flex items-center justify-center border border-indigo-100 shadow-2xs"
                                >
                                  <Upload size={14} className="mr-1.5" />
                                  <span>上傳/管理照片 ({prop.photos?.length || 0})</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* LANDLORD LEASES PANEL (Simplified Information Recording) */}
            {role === 'admin' && currentLandlordId && activeTab === 'leases' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-800">租約與租客紀錄</h2>
                    <p className="text-xs sm:text-sm text-slate-500">紀錄與管理房客承租資訊、起訖期限、租金押金與備忘筆記</p>
                  </div>
                  <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <select
                      value={filterLeaseStatus}
                      onChange={(e) => setFilterLeaseStatus(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 outline-none flex-1 sm:flex-none"
                    >
                      <option value="all">所有租約狀態</option>
                      <option value="active">租賃中</option>
                    </select>
                    <button
                      onClick={handleAddLeaseOpen}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center shadow-xs flex-1 sm:flex-none"
                    >
                      <Plus size={16} className="mr-1" />
                      <span>新增租約紀錄</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredLeases.length === 0 ? (
                    <div className="col-span-full bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400">
                      目前無符合條件的租約資料。點選右上角「新增租約紀錄」即可快速登錄房客資料！
                    </div>
                  ) : (
                    filteredLeases.map(lease => {
                      const prop = properties.find(p => p.id === lease.propertyId);
                      const leaseMonthly = getLeaseMonthlyRent(lease);
                      const leaseMonths = calculateMonths(lease.startDate, lease.endDate);
                      const contractTotalRent = (lease.totalContractRent && Number(lease.totalContractRent) > 0)
                        ? Number(lease.totalContractRent)
                        : (leaseMonthly * leaseMonths);

                      const leasePayments = payments.filter(p => p.leaseId === lease.id);
                      const leasePaidRent = leasePayments.filter(p => p.status === 'paid' && p.billType === 'rent').reduce((acc, p) => acc + (p.amount || 0), 0);
                      const leaseRemainingRent = Math.max(0, contractTotalRent - leasePaidRent);

                      return (
                        <div key={lease.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col justify-between hover:shadow-md transition-shadow relative">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-lg font-bold text-slate-800">
                                  {lease.tenantName}
                                </h3>
                                {lease.coTenantName && (
                                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-semibold">
                                    同住: {lease.coTenantName}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-1 flex items-center font-medium">
                                <Building size={13} className="mr-1 text-slate-400 flex-shrink-0" />
                                <span>{prop ? (prop.name + (prop.deletedAt ? ' (已下架)' : '')) : (lease.propertyName || lease.propertyId || '歷史房源')}</span>
                                {prop?.address && <span className="ml-1 text-slate-400">({prop.address})</span>}
                              </p>
                            </div>
                            <StatusBadge status={lease.status} />
                          </div>

                          <div className="space-y-2.5 my-3 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
                            <div className="flex justify-between items-center font-medium">
                              <span className="text-slate-500 flex items-center">
                                <Phone size={12} className="mr-1 text-slate-400" />
                                承租人電話
                              </span>
                              <a href={`tel:${lease.phone}`} className="text-indigo-600 font-bold hover:underline">
                                {lease.phone}
                              </a>
                            </div>
                            {lease.coPhone && (
                              <div className="flex justify-between items-center font-medium">
                                <span className="text-slate-500 flex items-center">
                                  <Phone size={12} className="mr-1 text-slate-400" />
                                  同住人電話
                                </span>
                                <a href={`tel:${lease.coPhone}`} className="text-indigo-600 font-bold hover:underline">
                                  {lease.coPhone}
                                </a>
                              </div>
                            )}
                            <div className="flex justify-between items-center font-medium">
                              <span className="text-slate-500 flex items-center">
                                <Calendar size={12} className="mr-1 text-slate-400" />
                                租賃起訖
                              </span>
                              <span className="text-slate-800 font-semibold">{lease.startDate} ~ {lease.endDate}</span>
                            </div>
                            <div className="flex justify-between items-center font-medium">
                              <span className="text-slate-500 flex items-center">
                                <DollarSign size={12} className="mr-1 text-slate-400" />
                                押金與每月租金
                              </span>
                              <span className="text-slate-800 font-semibold">
                                押金 NT$ {lease.deposit.toLocaleString()} / 月租 NT$ {leaseMonthly.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between items-center font-bold bg-indigo-50/70 p-2.5 rounded-xl border border-indigo-100">
                              <span className="text-indigo-900 flex items-center">
                                <Wallet size={13} className="mr-1 text-indigo-600" />
                                合約總租金
                              </span>
                              <span className="text-indigo-700 font-mono text-sm">
                                NT$ {contractTotalRent.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between items-center font-bold bg-amber-50/80 p-2.5 rounded-xl border border-amber-200/80">
                              <span className="text-amber-900 flex items-center">
                                <Clock size={13} className="mr-1 text-amber-600" />
                                此合約尚餘租金
                              </span>
                              <span className="text-amber-700 font-mono text-sm">
                                NT$ {leaseRemainingRent.toLocaleString()}
                              </span>
                            </div>
                            {lease.note && (
                              <div className="pt-2 border-t border-slate-200/60 text-slate-600">
                                <span className="text-slate-400 font-semibold">備註事項：</span>
                                <p className="mt-0.5 text-slate-700 bg-white p-2 rounded-lg border border-slate-100 leading-relaxed">
                                  {lease.note}
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="mt-2 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                            <button
                              onClick={() => handleDeleteLease(lease.id, lease.propertyId)}
                              className="text-rose-600 hover:text-rose-800 font-bold flex items-center focus:outline-none"
                            >
                              <Trash2 size={13} className="mr-1" />
                              <span>退租/結案</span>
                            </button>
                            <div className="space-x-3">
                              <button
                                onClick={() => handleEditLeaseOpen(lease)}
                                className="text-indigo-600 hover:text-indigo-800 font-bold focus:outline-none inline-flex items-center gap-1"
                              >
                                <Edit3 size={13} />
                                <span>編輯紀錄</span>
                              </button>
                              <button
                                onClick={() => openViewLease(lease)}
                                className="text-slate-600 hover:text-slate-900 font-bold focus:outline-none inline-flex items-center gap-1"
                              >
                                <FileText size={13} />
                                <span>詳細資訊</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* LANDLORD HISTORICAL LEASES PANEL */}
            {role === 'admin' && currentLandlordId && activeTab === 'history' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800">歷史合約與帳務保存</h2>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                    查看名下已終止或到期的歷史租賃紀錄，以及完整留存之合約期間帳單與繳費憑證
                  </p>
                </div>

                {(() => {
                  const landlordPropIds = properties.filter(p => p.landlordId === currentLandlordId).map(p => p.id);
                  const myHistoricalLeases = historicalLeases.filter(l => landlordPropIds.includes(l.propertyId));
                  if (myHistoricalLeases.length === 0) {
                    return (
                      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 font-medium">
                        目前尚無任何歷史合約紀錄
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {myHistoricalLeases.slice().reverse().map((lease, idx) => {
                        const prop = properties.find(p => p.id === lease.propertyId);
                        const archivedList = lease.archivedPayments || [];
                        const paidTotal = archivedList.filter(p => p.status === 'paid').reduce((acc, p) => acc + (p.amount || 0), 0);

                        return (
                          <div key={`hist-tab-${lease.id}-${idx}`} className="bg-white shadow-sm border border-slate-100 rounded-2xl p-5 sm:p-6 flex flex-col justify-between hover:shadow-md transition-shadow relative space-y-4">
                            <div>
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <span className="text-[10px] text-slate-400 font-mono block mb-0.5">{lease.id}</span>
                                  <h4 className="text-lg font-bold text-slate-800">{lease.tenantName}</h4>
                                  <span className="text-xs text-slate-500 font-medium">{prop ? prop.name : lease.propertyId}</span>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  已終止存查
                                </span>
                              </div>

                              <div className="space-y-2 text-xs font-medium text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div className="flex justify-between">
                                  <span className="text-slate-500 flex items-center"><Building size={12} className="mr-1.5 text-slate-400" />承租房源</span>
                                  <span className="text-slate-800 font-semibold">{prop ? prop.name : lease.propertyId}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500 flex items-center"><Phone size={12} className="mr-1.5 text-slate-400" />聯絡電話</span>
                                  <span className="text-slate-800 font-semibold">{lease.phone}</span>
                                </div>
                                {lease.coTenantName && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500 flex items-center"><Users size={12} className="mr-1.5 text-slate-400" />同住人</span>
                                    <span className="text-slate-800 font-semibold">{lease.coTenantName} {lease.coPhone ? `(${lease.coPhone})` : ''}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-500 flex items-center"><DollarSign size={12} className="mr-1.5 text-slate-400" />月租 / 押金</span>
                                  <span className="text-slate-800 font-semibold">月租 NT$ {getLeaseMonthlyRent(lease).toLocaleString()} · 押金 NT$ {(lease.deposit || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500 flex items-center"><Calendar size={12} className="mr-1.5 text-slate-400" />合約期間</span>
                                  <span className="text-slate-800 font-semibold">{lease.startDate} ~ {lease.endDate}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500 flex items-center"><XCircle size={12} className="mr-1.5 text-slate-400" />終止日期</span>
                                  <span className="text-rose-600 font-bold">{lease.terminatedAt || '已結案'}</span>
                                </div>
                                {lease.note && (
                                  <div className="text-slate-500 pt-1 border-t border-slate-200">
                                    <span>備註：{lease.note}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Collapsible Archived Payments Dropdown Section (Landlord) */}
                            <div className="pt-2 border-t border-slate-100 space-y-2.5">
                              <button
                                type="button"
                                onClick={() => toggleHistLeaseExpanded(lease.id)}
                                className={`w-full flex justify-between items-center p-3 rounded-xl border transition-all text-left group ${expandedHistLeases[lease.id]
                                  ? 'bg-indigo-50/80 border-indigo-200 text-indigo-950 shadow-2xs'
                                  : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200 text-slate-700'
                                  }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`p-1.5 rounded-lg transition-colors ${expandedHistLeases[lease.id]
                                    ? 'bg-indigo-600 text-white shadow-2xs'
                                    : 'bg-slate-200 text-slate-600 group-hover:bg-indigo-600 group-hover:text-white'
                                    }`}>
                                    <Receipt size={14} />
                                  </span>
                                  <div>
                                    <span className="text-xs font-bold block">
                                      歷史帳單與已繳紀錄保存
                                    </span>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                      共 {archivedList.length} 筆存查 {paidTotal > 0 ? `· 實收 NT$ ${paidTotal.toLocaleString()}` : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-xs font-semibold text-indigo-600">
                                  <span>{expandedHistLeases[lease.id] ? '收合明細' : '點選展開明細'}</span>
                                  {expandedHistLeases[lease.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </div>
                              </button>

                              {/* Dropdown Content Area */}
                              {expandedHistLeases[lease.id] && (
                                <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-2 pt-1">
                                  {archivedList.length === 0 ? (
                                    <div className="bg-slate-50 rounded-xl p-3 text-center text-slate-400 text-xs font-medium">
                                      此歷史合約無留存之帳單紀錄
                                    </div>
                                  ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                      {archivedList.map((p) => {
                                        const catInfo = getCategoryInfo(p.billType);
                                        const isVoid = p.status === 'void';
                                        return (
                                          <div key={`arch-p-${p.id}`} className={`p-2.5 rounded-xl border text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${isVoid ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200 shadow-2xs'
                                            }`}>
                                            <div className="space-y-0.5">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${catInfo.color}`}>
                                                  <span>{catInfo.icon}</span>
                                                  <span>{catInfo.label}{p.title ? ` (${p.title})` : ''}</span>
                                                </span>
                                                <span className={`font-bold font-mono ${isVoid ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                                  NT$ {p.amount.toLocaleString()}
                                                </span>
                                                <StatusBadge status={p.status} />
                                              </div>
                                              <div className="text-[11px] text-slate-500">
                                                {p.status === 'paid' ? (
                                                  <span>入帳：{p.paidDate || p.dueDate} · {formatPaymentMethod(p.paymentMethod)}</span>
                                                ) : isVoid ? (
                                                  <span className="text-rose-600">作廢：{p.voidedBy || '管理員'} ({p.voidedAt})</span>
                                                ) : (
                                                  <span>期限：{p.dueDate}</span>
                                                )}
                                                {p.transferLast5 && <span className="ml-1 font-mono text-amber-700 font-semibold">(末5碼: {p.transferLast5})</span>}
                                              </div>
                                            </div>

                                            {p.status === 'paid' && (
                                              <button
                                                onClick={() => handleOpenReceipt(p)}
                                                className="self-end sm:self-auto text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg border border-indigo-200 transition-colors flex items-center gap-1 flex-shrink-0"
                                              >
                                                <Printer size={11} />
                                                <span>收據</span>
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TENANT HOME SCREEN */}
            {role === 'tenant' && currentTenantPhone && (activeTab === 'portal' || !['tenantHistory', 'contract'].includes(activeTab)) && (
              <div className="space-y-6">
                {/* 方案一：頂部合約膠囊切換器 (Segmented Pills Switcher for Multiple Leases) */}
                {tenantLeases.length > 1 && (
                  <div className="bg-white/90 backdrop-blur-md p-3.5 sm:p-4 rounded-2xl border border-indigo-100/80 shadow-xs space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg shadow-2xs">
                          <Layers size={16} />
                        </span>
                        <div>
                          <span className="text-xs sm:text-sm font-bold text-slate-800">
                            您的承租合約 ({tenantLeases.length} 筆房源)
                          </span>
                          <span className="hidden sm:inline text-xs text-slate-400 font-normal ml-2">
                            點擊膠囊按鈕即可切換查看不同房源的帳單、收據與回報紀錄
                          </span>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50/70 px-2 py-0.5 rounded-full self-start sm:self-auto border border-indigo-100">
                        目前檢視：{currentTenantProperty ? currentTenantProperty.name : (currentTenantLease?.id || '未選擇')}
                      </span>
                    </div>

                    {/* Scrollable Pills Row */}
                    <div className="flex items-center gap-2.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
                      {tenantLeases.map((l) => {
                        const isSelected = (currentTenantLease?.id === l.id);
                        const prop = properties.find(p => p.id === l.propertyId);
                        const leaseUnpaidBills = payments.filter(p => p.leaseId === l.id && (p.status === 'pending' || p.status === 'overdue'));
                        const leasePendingApproval = payments.filter(p => p.leaseId === l.id && p.status === 'pending_approval');
                        const monthly = getLeaseMonthlyRent(l);

                        return (
                          <button
                            key={`pill-${l.id}`}
                            type="button"
                            onClick={() => setCurrentTenantLeaseId(l.id)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all flex-shrink-0 cursor-pointer ${isSelected
                              ? 'bg-gradient-to-r from-indigo-600 via-indigo-650 to-indigo-700 text-white border-indigo-600 shadow-md shadow-indigo-100 ring-2 ring-indigo-300/60 scale-[1.01]'
                              : 'bg-slate-50/90 hover:bg-white text-slate-700 border-slate-200/90 hover:border-indigo-200 hover:shadow-xs'
                              }`}
                          >
                            <div className={`p-2 rounded-lg flex items-center justify-center transition-colors ${isSelected ? 'bg-white/20 text-white' : 'bg-white text-indigo-600 border border-slate-200 shadow-2xs'
                              }`}>
                              <Building size={16} />
                            </div>

                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs sm:text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                                  {prop ? prop.name : l.propertyId}
                                </span>
                                {isSelected && (
                                  <span className="text-[10px] bg-white/25 text-white font-bold px-1.5 py-0.2 rounded-full backdrop-blur-xs">
                                    當前選中
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className={`text-[11px] font-medium ${isSelected ? 'text-indigo-150' : 'text-slate-500'}`}>
                                  NT$ {monthly.toLocaleString()} / 月
                                </span>
                                {leaseUnpaidBills.length > 0 ? (
                                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-md flex items-center gap-1 ${isSelected
                                    ? 'bg-amber-300 text-slate-900 shadow-2xs'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                                    }`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
                                    {leaseUnpaidBills.length} 筆待繳
                                  </span>
                                ) : leasePendingApproval.length > 0 ? (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${isSelected
                                    ? 'bg-cyan-300 text-slate-900'
                                    : 'bg-cyan-100 text-cyan-800 border border-cyan-300'
                                    }`}>
                                    核帳中
                                  </span>
                                ) : (
                                  <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isSelected ? 'text-emerald-200' : 'text-emerald-600'
                                    }`}>
                                    <CheckCircle size={11} />
                                    <span>已結清</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {currentTenantLease ? (
                  <>
                    <div className="bg-indigo-600 rounded-2xl p-6 sm:p-8 text-white flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 shadow-md relative overflow-hidden">
                      <div className="absolute -right-10 -bottom-10 opacity-10">
                        <Building size={180} />
                      </div>
                      <div className="z-10">
                        <h2 className="text-2xl font-bold mb-2">
                          早安，{registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === currentTenantPhone.replace(/[-\s]/g, ''))?.name || currentTenantLease?.tenantName || '租客'}
                        </h2>
                        <p className="text-indigo-100 text-sm flex items-center font-medium">
                          <Building size={16} className="mr-1.5 text-indigo-200" />
                          您目前承租：{currentTenantProperty ? currentTenantProperty.name : '未知房源'}
                        </p>
                        {currentTenantProperty?.address && (
                          <p className="text-indigo-200 text-xs mt-1 font-medium flex items-center">
                            <Home size={12} className="mr-1.5 text-indigo-300 flex-shrink-0" />
                            {currentTenantProperty.address}
                          </p>
                        )}
                        {currentTenantLease?.coTenantName && (
                          <p className="text-indigo-200 text-xs mt-1.5 font-medium flex items-center">
                            👥 同住房客：
                            {currentTenantPhone.replace(/[-\s]/g, '') === currentTenantLease.phone.replace(/[-\s]/g, '')
                              ? `${currentTenantLease.coTenantName} (${currentTenantLease.coPhone})`
                              : `${currentTenantLease.tenantName} (${currentTenantLease.phone})`
                            }
                          </p>
                        )}
                      </div>
                      <div className="bg-white/10 p-4 rounded-xl border border-white/15 backdrop-blur-xs z-10 sm:text-right self-start sm:self-auto space-y-2">
                        <div>
                          <p className="text-xs text-indigo-100 mb-0.5">合約總租金 / 期限</p>
                          <p className="text-base sm:text-lg font-bold">
                            NT$ {(currentTenantLease?.totalContractRent || (getLeaseMonthlyRent(currentTenantLease) * calculateMonths(currentTenantLease?.startDate, currentTenantLease?.endDate))).toLocaleString()}
                          </p>
                          <p className="text-[11px] text-indigo-200">
                            截止日: {currentTenantLease?.endDate || '無資料'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleOpenLineBinding}
                          disabled={lineBindingLoading}
                          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 focus:outline-none"
                        >
                          <MessageSquare size={13} />
                          <span>{lineBindingLoading ? '產生中...' : '綁定 LINE 帳號'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Tenant Financial Status & Remaining Balance Cards */}
                    {(() => {
                      const tenantBaseContractRent = (currentTenantLease && currentTenantLease.totalContractRent && Number(currentTenantLease.totalContractRent) > 0)
                        ? Number(currentTenantLease.totalContractRent)
                        : (getLeaseMonthlyRent(currentTenantLease) * calculateMonths(currentTenantLease?.startDate, currentTenantLease?.endDate));

                      // 純租金已繳納總額 (排除押金、水電、管理費、其他)
                      const tenantPaidRent = currentTenantPayments
                        .filter(p => p.status === 'paid' && p.billType === 'rent')
                        .reduce((acc, p) => acc + (p.amount || 0), 0);

                      // 尚餘待繳租金
                      const tenantRemainingRent = Math.max(0, tenantBaseContractRent - tenantPaidRent);

                      // 待房東審核租金
                      const tenantPendingApprovalRent = currentTenantPayments
                        .filter(p => p.status === 'pending_approval' && p.billType === 'rent')
                        .reduce((acc, p) => acc + (p.amount || 0), 0);

                      const categoryMap = {
                        rent: { label: '租金', icon: '🏠', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                        deposit: { label: '押金保證金', icon: '🔒', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                        utilities: { label: '水電費', icon: '⚡', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
                        management: { label: '管理費', icon: '🏢', color: 'bg-teal-50 text-teal-700 border-teal-200' },
                        other: { label: '其他', icon: '📦', color: 'bg-slate-100 text-slate-700 border-slate-300' }
                      };

                      const getCategoryInfo = (type) => {
                        if (type === 'water' || type === 'electricity' || type === 'gas') return categoryMap.utilities;
                        if (type === 'maintenance') return categoryMap.other;
                        return categoryMap[type] || categoryMap.other;
                      };

                      const unpaidBills = currentTenantPayments.filter(p => p.status === 'pending' || p.status === 'overdue');
                      const pendingApprovalBills = currentTenantPayments.filter(p => p.status === 'pending_approval');
                      const paidBills = currentTenantPayments.filter(p => p.status === 'paid');
                      const voidedBills = currentTenantPayments.filter(p => p.status === 'void');
                      const unpaidTotal = unpaidBills.reduce((acc, b) => acc + (b.amount || 0), 0);

                      return (
                        <div className="space-y-6">
                          {/* Financial 3 Status Cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Card 1: 尚餘應繳租金 (Remaining Rent) */}
                            <div className={`rounded-2xl p-5 border-2 shadow-xs flex flex-col justify-between transition-all ${tenantRemainingRent > 0
                              ? 'bg-gradient-to-br from-amber-50 to-orange-50/60 border-amber-300'
                              : 'bg-gradient-to-br from-emerald-50 to-teal-50/60 border-emerald-300'
                              }`}>
                              <div className="flex justify-between items-start mb-2">
                                <span className={`text-xs font-bold flex items-center ${tenantRemainingRent > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>
                                  {tenantRemainingRent > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 mr-1.5 animate-pulse" />}
                                  尚餘應繳租金 (Remaining Rent)
                                </span>
                                <span className={`p-2 rounded-xl text-white shadow-xs ${tenantRemainingRent > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                                  {tenantRemainingRent > 0 ? <Clock size={18} /> : <CheckCircle size={18} />}
                                </span>
                              </div>
                              <div>
                                <h3 className={`text-2xl sm:text-3xl font-black ${tenantRemainingRent > 0 ? 'text-amber-950' : 'text-emerald-950'}`}>
                                  NT$ {tenantRemainingRent.toLocaleString()}
                                </h3>
                                <p className={`text-xs font-semibold mt-1 ${tenantRemainingRent > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                                  {tenantRemainingRent > 0
                                    ? `合約總租金 NT$ ${tenantBaseContractRent.toLocaleString()} · 已繳納租金 NT$ ${tenantPaidRent.toLocaleString()}`
                                    : '🎉 所有合約租金皆已結清！'}
                                </p>
                              </div>
                            </div>

                            {/* Card 2: 已繳納實收租金 */}
                            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex flex-col justify-between">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-semibold text-slate-500">已繳納實收租金</span>
                                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                                  <CheckCircle size={18} />
                                </span>
                              </div>
                              <div>
                                <h3 className="text-2xl font-bold text-slate-800">
                                  NT$ {tenantPaidRent.toLocaleString()}
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-1">
                                  已開立 {currentTenantPayments.filter(p => p.status === 'paid' && p.billType === 'rent').length} 筆租金電子收據證明
                                </p>
                              </div>
                            </div>

                            {/* Card 3: 待房東審核租金 */}
                            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex flex-col justify-between">
                              <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-semibold text-slate-500">待房東審核租金</span>
                                <span className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                                  <Clock size={18} />
                                </span>
                              </div>
                              <div>
                                <h3 className="text-2xl font-bold text-slate-800">
                                  NT$ {tenantPendingApprovalRent.toLocaleString()}
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-1">
                                  {currentTenantPayments.filter(p => p.status === 'pending_approval' && p.billType === 'rent').length} 筆租金回報等待房東核帳
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Quick Action Toolbar */}
                          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-xs">
                            <div>
                              <h3 className="text-base font-bold text-slate-800">帳單管理與繳款回報</h3>
                              <p className="text-xs text-slate-500 font-medium">您可以自行回報已繳納之租金、押金保證金、水電費等費用，待房東核對後即入帳</p>
                            </div>
                            <button
                              onClick={() => handleOpenTenantReportPayment()}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-xs flex items-center justify-center space-x-1.5 w-full sm:w-auto"
                            >
                              <Plus size={16} />
                              <span>回報已繳費用</span>
                            </button>
                          </div>

                          {/* 1. 【置頂簡約 RWD】待繳納帳單專區 (柔和暖色醒目底色) */}
                          <div className="bg-gradient-to-br from-amber-50/50 via-orange-50/25 to-amber-50/40 rounded-2xl p-4 sm:p-6 border border-amber-200/80 shadow-xs">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-amber-100/90">
                              <div className="flex items-center space-x-3">
                                <span className={`p-2 rounded-xl flex items-center justify-center ${unpaidBills.length > 0 ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                  }`}>
                                  {unpaidBills.length > 0 ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
                                </span>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h3 className="text-base sm:text-lg font-bold text-slate-800">
                                      {unpaidBills.length > 0 ? '當前待繳納帳單' : '帳單繳納狀態良好'}
                                    </h3>
                                    {unpaidBills.length > 0 && (
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                        {unpaidBills.length} 筆待繳
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                                    {unpaidBills.length > 0
                                      ? '請於到期日前完成繳款，支援線上繳費與轉帳回報'
                                      : '目前無任何待繳帳單，所有款項皆已結清'}
                                  </p>
                                </div>
                              </div>

                              {unpaidBills.length > 0 && (
                                <div className="bg-white border border-amber-200/90 px-3.5 py-1.5 rounded-xl w-full sm:w-auto flex sm:flex-col justify-between sm:justify-center items-center sm:items-end shadow-2xs">
                                  <span className="text-[11px] text-amber-700/80 font-semibold">待繳總額</span>
                                  <span className="text-lg sm:text-xl font-black text-amber-950 font-mono">
                                    NT$ {unpaidTotal.toLocaleString()}
                                  </span>
                                </div>
                              )}
                            </div>

                            {unpaidBills.length === 0 ? (
                              <div className="bg-white/80 rounded-xl p-5 text-center border border-emerald-100 text-emerald-700 font-medium text-xs sm:text-sm flex items-center justify-center space-x-2 mt-4">
                                <CheckCircle size={16} className="text-emerald-500" />
                                <span>目前無待繳費用，所有款項皆已結清！</span>
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 mt-4">
                                {unpaidBills.map(bill => {
                                  const catInfo = getCategoryInfo(bill.billType);
                                  const isOverdue = bill.status === 'overdue';
                                  return (
                                    <div
                                      key={`unpaid-${bill.id}`}
                                      className="bg-white hover:bg-amber-50/20 border-2 border-amber-200/90 hover:border-amber-400 rounded-xl p-4 sm:p-5 flex flex-col justify-between transition-all space-y-3.5 shadow-2xs hover:shadow-xs"
                                    >
                                      <div className="space-y-2">
                                        <div className="flex justify-between items-start gap-2">
                                          <div className="space-y-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className={`inline-flex items-center space-x-1 text-xs font-bold px-2 py-0.5 rounded-md border ${catInfo.color}`}>
                                                <span>{catInfo.icon}</span>
                                                <span>{catInfo.label}{bill.title ? ` (${bill.title})` : ''}</span>
                                              </span>
                                              {isOverdue && (
                                                <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                                                  已逾期
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight pt-0.5 font-mono">
                                              NT$ {bill.amount.toLocaleString()}
                                            </div>
                                          </div>
                                          <StatusBadge status={bill.status} />
                                        </div>

                                        <div className="text-xs text-slate-500 flex flex-wrap justify-between gap-x-4 gap-y-1.5 pt-2.5 border-t border-amber-100 font-medium">
                                          <div className="flex items-center gap-1">
                                            <Building size={13} className="text-slate-400" />
                                            <span>房源：</span>
                                            <span className="text-slate-700 font-semibold truncate max-w-[140px]">
                                              {currentTenantProperty?.name || bill.propertyName || '租賃房間'}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <User size={13} className="text-slate-400" />
                                            <span>房東：</span>
                                            <span className="text-slate-700 font-semibold">
                                              {landlords.find(l => l.id === currentTenantProperty?.landlordId)?.name || '房東'}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <Calendar size={13} className="text-slate-400" />
                                            <span>期限：</span>
                                            <span className={`font-semibold ${isOverdue ? 'text-rose-600' : 'text-slate-700'}`}>
                                              {bill.dueDate}
                                            </span>
                                          </div>
                                          {bill.note && (
                                            <div className="w-full text-slate-500 truncate pt-0.5">
                                              <span className="text-slate-400">備註：</span>
                                              <span className="text-slate-700">{bill.note}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="pt-2 border-t border-slate-100">
                                        <button
                                          onClick={() => handleOpenTenantReportPayment(bill)}
                                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                                        >
                                          <Send size={15} />
                                          <span>回報已繳費用</span>
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2. 待審核專區 (Pending Approvals) */}
                          {pendingApprovalBills.length > 0 && (
                            <div className="bg-indigo-50/60 rounded-3xl p-6 border-2 border-indigo-200 shadow-xs space-y-4">
                              <div className="flex items-center space-x-2">
                                <span className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                                  <Clock size={18} />
                                </span>
                                <div>
                                  <h3 className="text-lg font-bold text-slate-800">
                                    已提交繳費回報 (待房東核對確認中 · 共 {pendingApprovalBills.length} 筆)
                                  </h3>
                                  <p className="text-xs text-slate-500 font-medium">
                                    房東核帳後將自動開立電子收據，並自尚餘租金中扣減
                                  </p>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {pendingApprovalBills.map(bill => {
                                  const catInfo = getCategoryInfo(bill.billType);
                                  const targetLease = leases.find(l => l.id === bill.leaseId) || currentTenantLease;
                                  const targetProp = properties.find(p => p.id === targetLease?.propertyId) || currentTenantProperty;
                                  const propName = currentTenantProperty?.name || bill.propertyName || targetProp?.name || '租賃房間';
                                  const landlordName = landlords.find(l => l.id === targetProp?.landlordId || l.id === currentTenantProperty?.landlordId)?.name || '房東';

                                  return (
                                    <div key={`pending-${bill.id}`} className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-xs flex flex-col justify-between">
                                      <div>
                                        <div className="flex justify-between items-start mb-2">
                                          <div>
                                            <span className={`inline-flex items-center space-x-1 text-xs font-bold px-2 py-0.5 rounded border ${catInfo.color}`}>
                                              <span>{catInfo.icon}</span>
                                              <span>{catInfo.label}{bill.title ? ` (${bill.title})` : ''}</span>
                                            </span>
                                            <h4 className="text-2xl font-bold text-slate-800 mt-1 font-mono">NT$ {bill.amount.toLocaleString()}</h4>
                                          </div>
                                          <StatusBadge status={bill.status} />
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs space-y-1.5 mb-4 text-slate-600">
                                          <div className="flex justify-between">
                                            <span className="text-slate-500">承租房源：</span>
                                            <span className="font-semibold text-slate-800">{propName}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-slate-500">出租房東：</span>
                                            <span className="font-semibold text-slate-700">{landlordName}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-slate-500">回報日期：</span>
                                            <span className="font-semibold text-slate-700">{bill.dueDate}</span>
                                          </div>
                                          {bill.transferLast5 && (
                                            <div className="flex justify-between font-bold text-amber-800">
                                              <span>匯款末5碼：</span>
                                              <span className="font-mono bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">{bill.transferLast5}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div className="w-full bg-amber-50 border border-amber-200 text-amber-800 py-2 rounded-xl font-bold flex justify-center items-center text-xs">
                                        <Clock size={14} className="mr-1.5 text-amber-600" />
                                        已送出繳費回報，等待房東對帳中
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* 3. 歷史已繳納紀錄與電子收據 (Paid Bills & Receipts - Table View Matching Landlord Format) */}
                          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-6">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                              <div>
                                <h3 className="text-base sm:text-lg font-bold text-slate-800">已繳納明細與電子收據</h3>
                                <p className="text-xs sm:text-sm text-slate-500 font-medium">
                                  查看已結清之各項費用紀錄、入帳日期與開立之電子繳費收據
                                </p>
                              </div>
                              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                                共 {paidBills.length} 筆已結清
                              </span>
                            </div>

                            {/* Desktop Table View */}
                            <div className="hidden md:block overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="text-slate-500 border-b border-slate-100 text-xs bg-slate-50/50">
                                    <th className="py-3 px-4 font-semibold rounded-l-xl">項目編號 / 類別</th>
                                    <th className="py-3 px-4 font-semibold">承租房源 / 房東</th>
                                    <th className="py-3 px-4 font-semibold">繳納金額</th>
                                    <th className="py-3 px-4 font-semibold">入帳日期</th>
                                    <th className="py-3 px-4 font-semibold">狀態與管道</th>
                                    <th className="py-3 px-4 font-semibold text-right rounded-r-xl">操作動作</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 text-slate-600">
                                  {paidBills.length === 0 ? (
                                    <tr>
                                      <td colSpan="6" className="py-12 text-center text-slate-400">
                                        <div className="max-w-xs mx-auto space-y-2">
                                          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                                            <Receipt size={24} />
                                          </div>
                                          <p className="font-semibold text-slate-600">尚無已完成繳費的歷史紀錄</p>
                                          <p className="text-xs text-slate-400">待繳款項結清並由房東入帳後將顯示於此處</p>
                                        </div>
                                      </td>
                                    </tr>
                                  ) : (
                                    paidBills.map(bill => {
                                      const catInfo = getCategoryInfo(bill.billType);
                                      return (
                                        <tr key={`paid-row-${bill.id}`} className="hover:bg-slate-50/80 transition-colors">
                                          <td className="py-3.5 px-4">
                                            <div className="space-y-1">
                                              <span className="text-slate-500 font-mono text-xs block">{bill.id.split('_')[0]}</span>
                                              <span className={`inline-flex items-center space-x-1 text-[11px] font-bold px-2 py-0.5 rounded-md border ${catInfo.color}`}>
                                                <span>{catInfo.icon}</span>
                                                <span>{catInfo.label}{bill.title ? ` (${bill.title})` : ''}</span>
                                              </span>
                                            </div>
                                          </td>
                                          <td className="py-3.5 px-4">
                                            <div>
                                              <span className="text-slate-800 font-bold block">{currentTenantProperty?.name || bill.propertyName || '租賃房間'}</span>
                                              <span className="text-xs text-slate-500 font-medium">
                                                房東：{landlords.find(l => l.id === currentTenantProperty?.landlordId)?.name || '房東'}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="py-3.5 px-4">
                                            <span className="text-slate-900 font-extrabold text-base">
                                              NT$ {bill.amount.toLocaleString()}
                                            </span>
                                          </td>
                                          <td className="py-3.5 px-4">
                                            <div>
                                              <span className="text-slate-700 font-semibold text-xs block">{bill.paidDate || bill.dueDate}</span>
                                              <span className="text-[10px] text-emerald-600 font-bold">已入帳結清</span>
                                            </div>
                                          </td>
                                          <td className="py-3.5 px-4">
                                            <div className="space-y-1">
                                              <StatusBadge status={bill.status} />
                                              <div className="text-[11px] text-slate-500">
                                                <span>{formatPaymentMethod(bill.paymentMethod)}</span>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="py-3.5 px-4 text-right">
                                            <button
                                              onClick={() => handleOpenReceipt(bill)}
                                              className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3.5 py-1.5 rounded-lg transition-colors inline-flex items-center shadow-2xs"
                                            >
                                              <Printer size={13} className="mr-1" />
                                              <span>電子收據</span>
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>

                            {/* Mobile Responsive Cards */}
                            <div className="md:hidden space-y-3">
                              {paidBills.length === 0 ? (
                                <div className="py-8 text-center text-slate-400 text-sm">尚無已完成繳費的歷史紀錄</div>
                              ) : (
                                paidBills.map(bill => {
                                  const catInfo = getCategoryInfo(bill.billType);
                                  const targetLease = leases.find(l => l.id === bill.leaseId) || currentTenantLease;
                                  const targetProp = properties.find(p => p.id === targetLease?.propertyId) || currentTenantProperty;
                                  const propName = targetProp?.name || bill.propertyName || '租賃房間';
                                  const landlordName = landlords.find(l => l.id === targetProp?.landlordId || l.id === currentTenantProperty?.landlordId)?.name || '房東';

                                  return (
                                    <div key={`m-paid-${bill.id}`} className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3 shadow-2xs">
                                      <div className="flex justify-between items-start gap-2">
                                        <div className="space-y-1">
                                          <span className="text-[10px] text-slate-400 font-mono block">{bill.id.split('_')[0]}</span>
                                          <h4 className="font-bold text-slate-800 text-base">{propName}</h4>
                                          <div className="text-xs text-slate-600 font-medium flex items-center gap-1">
                                            <User size={13} className="text-slate-400" />
                                            <span>房東：{landlordName}</span>
                                          </div>
                                          <div className="pt-0.5">
                                            <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded border ${catInfo.color}`}>
                                              <span>{catInfo.icon}</span>
                                              <span>{catInfo.label}{bill.title ? ` (${bill.title})` : ''}</span>
                                            </span>
                                          </div>
                                        </div>
                                        <StatusBadge status={bill.status} />
                                      </div>

                                      <div className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-slate-200/60 bg-white p-3 rounded-xl border">
                                        <div className="flex justify-between items-center">
                                          <span className="text-slate-500 font-medium">實繳金額</span>
                                          <span className="text-slate-900 font-bold text-sm font-mono">NT$ {bill.amount.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                          <span className="text-slate-500 font-medium">入帳日期</span>
                                          <span className="text-emerald-700 font-semibold">{bill.paidDate || bill.dueDate}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                          <span className="text-slate-500 font-medium">繳納管道</span>
                                          <span className="text-slate-700 font-semibold">{formatPaymentMethod(bill.paymentMethod)}</span>
                                        </div>
                                        {bill.transferLast5 && (
                                          <div className="flex justify-between items-center">
                                            <span className="text-slate-500 font-medium">轉帳末5碼</span>
                                            <span className="font-mono bg-amber-50 text-amber-800 font-bold px-1.5 py-0.5 rounded border border-amber-200">{bill.transferLast5}</span>
                                          </div>
                                        )}
                                        {bill.note && (
                                          <div className="flex justify-between text-slate-500 pt-1 border-t border-slate-100">
                                            <span>備註說明</span>
                                            <span className="text-slate-700 truncate max-w-[180px]">{bill.note}</span>
                                          </div>
                                        )}
                                      </div>

                                      <button
                                        onClick={() => handleOpenReceipt(bill)}
                                        className="w-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 py-2.5 rounded-xl font-bold transition-colors flex items-center justify-center shadow-2xs"
                                      >
                                        <Printer size={14} className="mr-1.5" />
                                        <span>檢視與列印電子收據</span>
                                      </button>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          {/* 4. 已作廢帳單紀錄 (Voided Bills) */}
                          {voidedBills.length > 0 && (
                            <div className="bg-slate-100/70 rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                  <span className="p-2 bg-slate-300 text-slate-700 rounded-xl shadow-2xs">
                                    <XCircle size={18} />
                                  </span>
                                  <div>
                                    <h3 className="text-base sm:text-lg font-bold text-slate-700">
                                      已作廢帳單紀錄 (共 {voidedBills.length} 筆)
                                    </h3>
                                    <p className="text-xs text-slate-500 font-medium">
                                      以下為已被作廢之帳單，保留存查紀錄且不列入應繳金額與財務計算
                                    </p>
                                  </div>
                                </div>
                                <span className="text-xs font-bold text-slate-600 bg-slate-200 px-3 py-1 rounded-full">
                                  已作廢存查
                                </span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {voidedBills.map(bill => {
                                  const catInfo = getCategoryInfo(bill.billType);
                                  const targetLease = leases.find(l => l.id === bill.leaseId) || currentTenantLease;
                                  const targetProp = properties.find(p => p.id === targetLease?.propertyId) || currentTenantProperty;
                                  const propName = currentTenantProperty?.name || bill.propertyName || targetProp?.name || '租賃房間';
                                  const landlordName = landlords.find(l => l.id === targetProp?.landlordId || l.id === currentTenantProperty?.landlordId)?.name || '房東';

                                  return (
                                    <div key={`void-${bill.id}`} className="bg-white/90 p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between opacity-80 hover:opacity-100 transition-opacity">
                                      <div>
                                        <div className="flex justify-between items-start mb-2">
                                          <div>
                                            <span className={`inline-flex items-center space-x-1 text-xs font-bold px-2 py-0.5 rounded border ${catInfo.color}`}>
                                              <span>{catInfo.icon}</span>
                                              <span>{catInfo.label}{bill.title ? ` (${bill.title})` : ''}</span>
                                            </span>
                                            <h4 className="text-2xl font-bold text-slate-400 line-through mt-1 font-mono">
                                              NT$ {bill.amount.toLocaleString()}
                                            </h4>
                                          </div>
                                          <StatusBadge status="void" />
                                        </div>

                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-xs space-y-1.5 mb-3 text-slate-600">
                                          <div className="flex justify-between">
                                            <span className="text-slate-500">承租房源：</span>
                                            <span className="font-semibold text-slate-800">{propName}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-slate-500">出租房東：</span>
                                            <span className="font-semibold text-slate-700">{landlordName}</span>
                                          </div>
                                          <div className="flex justify-between font-semibold text-rose-700 pt-1 border-t border-slate-200">
                                            <span>作廢人員：</span>
                                            <span>{bill.voidedBy || '管理員'}</span>
                                          </div>
                                          {bill.voidedAt && (
                                            <div className="flex justify-between text-slate-500">
                                              <span>作廢時間：</span>
                                              <span className="font-mono">{bill.voidedAt}</span>
                                            </div>
                                          )}
                                          <div className="flex justify-between text-slate-500">
                                            <span>原到期日：</span>
                                            <span>{bill.dueDate}</span>
                                          </div>
                                          {bill.note && (
                                            <div className="text-slate-500 pt-1 border-t border-slate-200">
                                              <span>原備註：{bill.note}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="w-full bg-slate-100 border border-slate-200 text-slate-500 py-2 rounded-xl font-bold flex justify-center items-center text-xs">
                                        <XCircle size={14} className="mr-1.5 text-slate-400" />
                                        此帳單已作廢，無需繳納
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="bg-white rounded-2xl p-8 border border-slate-100 text-center shadow-sm max-w-xl mx-auto space-y-6">
                    <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto shadow-xs">
                      <Building size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold text-slate-800">歡迎加入租客中心</h3>
                      <p className="text-sm text-slate-500 leading-relaxed">
                        您已成功註冊並登入，但您的電話號碼目前尚未有登記中之租約。
                      </p>
                    </div>
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-left space-y-3 font-medium text-xs sm:text-sm text-slate-700">
                      <p className="flex justify-between items-center">
                        <span className="text-slate-500">您的註冊姓名：</span>
                        <span className="text-slate-800 font-bold">
                          {currentTenantName || currentUser?.user_metadata?.name || registeredTenants.find(t => t.phone.replace(/[-\s]/g, '') === currentTenantPhone.replace(/[-\s]/g, ''))?.name || '租客'}
                        </span>
                      </p>
                      <p className="flex justify-between items-center">
                        <span className="text-slate-500">您的聯絡電話：</span>
                        <span className="text-indigo-600 font-bold font-mono text-sm">{currentTenantPhone}</span>
                      </p>
                    </div>
                    <div className="text-xs text-indigo-600 font-semibold bg-indigo-50 border border-indigo-100 p-4 rounded-xl leading-relaxed">
                      💡 提示：請將您的電話號碼提供給房東。當房東建立租約紀錄時，填寫此電話即可自動為您連動房源、合約與帳單資訊。
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TENANT HISTORICAL LEASES PANEL */}
            {role === 'tenant' && currentTenantPhone && activeTab === 'tenantHistory' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-800">歷史合約與帳務保存</h2>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                    檢視已終止或到期的歷史承租紀錄，以及該合約期間留存之完整帳單與電子繳費收據
                  </p>
                </div>

                {(() => {
                  const cleanedPhone = currentTenantPhone.replace(/[-\s]/g, '');
                  const myHistoricalLeases = historicalLeases.filter(l =>
                    l.phone.replace(/[-\s]/g, '') === cleanedPhone ||
                    (l.coPhone && l.coPhone.replace(/[-\s]/g, '') === cleanedPhone)
                  );
                  if (myHistoricalLeases.length === 0) {
                    return (
                      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-slate-400 font-medium">
                        目前尚無任何歷史承租紀錄
                      </div>
                    );
                  }
                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {myHistoricalLeases.slice().reverse().map((lease, idx) => {
                        const prop = properties.find(p => p.id === lease.propertyId);
                        const landlord = landlords.find(l => l.id === prop?.landlordId);
                        const archivedList = lease.archivedPayments || [];
                        const paidTotal = archivedList.filter(p => p.status === 'paid').reduce((acc, p) => acc + (p.amount || 0), 0);

                        return (
                          <div key={`tenant-hist-${lease.id}-${idx}`} className="bg-white shadow-sm border border-slate-100 rounded-2xl p-5 sm:p-6 flex flex-col justify-between hover:shadow-md transition-shadow relative space-y-4">
                            <div>
                              <div className="flex justify-between items-start mb-3">
                                <div>
                                  <span className="text-[10px] text-slate-400 font-mono block mb-0.5">{lease.id}</span>
                                  <h4 className="text-lg font-bold text-slate-800">
                                    {prop ? prop.name : lease.propertyId}
                                  </h4>
                                  <span className="text-xs text-slate-500 font-medium">房東：{landlord?.name || '房東'}</span>
                                </div>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  已終止存查
                                </span>
                              </div>

                              <div className="space-y-2 text-xs font-medium text-slate-600 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">承租人姓名</span>
                                  <span className="text-slate-800 font-semibold">{lease.tenantName}</span>
                                </div>
                                {lease.coTenantName && (
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">同住人姓名</span>
                                    <span className="text-slate-800 font-semibold">{lease.coTenantName}</span>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <span className="text-slate-500">月租金</span>
                                  <span className="text-slate-800 font-bold">
                                    NT$ {getLeaseMonthlyRent(lease).toLocaleString()} / 月
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">合約期間</span>
                                  <span className="text-slate-800 font-semibold">{lease.startDate} ~ {lease.endDate}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">終止日期</span>
                                  <span className="text-rose-600 font-bold">{lease.terminatedAt || '已結案'}</span>
                                </div>
                                {lease.note && (
                                  <div className="text-slate-500 pt-1 border-t border-slate-200">
                                    <span>備註：{lease.note}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Collapsible Archived Payments Dropdown Section (Tenant) */}
                            <div className="pt-2 border-t border-slate-100 space-y-2.5">
                              <button
                                type="button"
                                onClick={() => toggleHistLeaseExpanded(lease.id)}
                                className={`w-full flex justify-between items-center p-3 rounded-xl border transition-all text-left group ${expandedHistLeases[lease.id]
                                  ? 'bg-indigo-50/80 border-indigo-200 text-indigo-950 shadow-2xs'
                                  : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200 text-slate-700'
                                  }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`p-1.5 rounded-lg transition-colors ${expandedHistLeases[lease.id]
                                    ? 'bg-indigo-600 text-white shadow-2xs'
                                    : 'bg-slate-200 text-slate-600 group-hover:bg-indigo-600 group-hover:text-white'
                                    }`}>
                                    <Receipt size={14} />
                                  </span>
                                  <div>
                                    <span className="text-xs font-bold block">
                                      歷史帳單與電子收據留存
                                    </span>
                                    <span className="text-[11px] text-slate-500 font-medium">
                                      共 {archivedList.length} 筆存查 {paidTotal > 0 ? `· 實繳 NT$ ${paidTotal.toLocaleString()}` : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-xs font-semibold text-indigo-600">
                                  <span>{expandedHistLeases[lease.id] ? '收合明細' : '點選展開明細'}</span>
                                  {expandedHistLeases[lease.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </div>
                              </button>

                              {/* Dropdown Content Area */}
                              {expandedHistLeases[lease.id] && (
                                <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-2 pt-1">
                                  {archivedList.length === 0 ? (
                                    <div className="bg-slate-50 rounded-xl p-3 text-center text-slate-400 text-xs font-medium">
                                      此歷史合約無留存之帳單紀錄
                                    </div>
                                  ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                      {archivedList.map((p) => {
                                        const catInfo = getCategoryInfo(p.billType);
                                        const isVoid = p.status === 'void';
                                        return (
                                          <div key={`tenant-arch-p-${p.id}`} className={`p-2.5 rounded-xl border text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 ${isVoid ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200 shadow-2xs'
                                            }`}>
                                            <div className="space-y-0.5">
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${catInfo.color}`}>
                                                  <span>{catInfo.icon}</span>
                                                  <span>{catInfo.label}{p.title ? ` (${p.title})` : ''}</span>
                                                </span>
                                                <span className={`font-bold font-mono ${isVoid ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                                                  NT$ {p.amount.toLocaleString()}
                                                </span>
                                                <StatusBadge status={p.status} />
                                              </div>
                                              <div className="text-[11px] text-slate-500">
                                                {p.status === 'paid' ? (
                                                  <span>入帳：{p.paidDate || p.dueDate} · {formatPaymentMethod(p.paymentMethod)}</span>
                                                ) : isVoid ? (
                                                  <span className="text-rose-600">作廢：{p.voidedBy || '管理員'} ({p.voidedAt})</span>
                                                ) : (
                                                  <span>期限：{p.dueDate}</span>
                                                )}
                                                {p.transferLast5 && <span className="ml-1 font-mono text-amber-700 font-semibold">(末5碼: {p.transferLast5})</span>}
                                              </div>
                                            </div>

                                            {p.status === 'paid' && (
                                              <button
                                                onClick={() => handleOpenReceipt(p)}
                                                className="self-end sm:self-auto text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded-lg border border-indigo-200 transition-colors flex items-center gap-1 flex-shrink-0"
                                              >
                                                <Printer size={11} />
                                                <span>電子收據</span>
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TENANT LEASE INFO VIEW (Pure information record, no lengthy legal rules) */}
            {role === 'tenant' && currentTenantLeaseId && activeTab === 'contract' && (
              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8 max-w-3xl mx-auto space-y-6">
                {!currentTenantLease ? (
                  <div className="text-center text-slate-400 py-8">找不到您的租約資料。</div>
                ) : (
                  <>
                    <div className="border-b border-slate-100 pb-5 text-center">
                      <div className="inline-flex p-3 bg-indigo-50 text-indigo-600 rounded-2xl mb-2">
                        <FileCheck size={28} />
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold text-slate-800">房屋租賃資訊明細</h2>
                      <p className="text-xs text-slate-400 font-mono mt-1">紀錄編號: {currentTenantLease.id}</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Property Card */}
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                        <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs">
                          <Building size={14} />
                          <span>承租房源資訊</span>
                        </div>
                        <p className="text-base font-bold text-slate-800">{currentTenantProperty ? currentTenantProperty.name : '未知房源'}</p>
                        <p className="text-xs text-slate-500">{currentTenantProperty?.address || '未填寫地址'}</p>
                        <p className="text-xs text-slate-600 font-semibold">
                          房型類型：{currentTenantProperty?.type || '套房'}
                        </p>
                      </div>

                      {/* Landlord Card */}
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                        <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs">
                          <User size={14} />
                          <span>房東聯絡資訊</span>
                        </div>
                        <p className="text-base font-bold text-slate-800">
                          {landlords.find(l => l.id === (currentTenantProperty?.landlordId || currentTenantLease?.landlordId))?.name || '房東'}
                        </p>
                        <p className="text-xs text-slate-600 flex items-center gap-1 font-semibold">
                          <Phone size={12} className="text-slate-400" />
                          <span>電話：</span>
                          <a href={`tel:${landlords.find(l => l.id === (currentTenantProperty?.landlordId || currentTenantLease?.landlordId))?.phone || ''}`} className="text-indigo-600 hover:underline">
                            {landlords.find(l => l.id === (currentTenantProperty?.landlordId || currentTenantLease?.landlordId))?.phone || '未提供'}
                          </a>
                        </p>
                      </div>
                    </div>

                    {/* Lease Detail Specs */}
                    <div className="p-5 bg-slate-50/70 rounded-2xl border border-slate-100 space-y-3.5 text-xs sm:text-sm">
                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                        <span className="text-slate-500 font-medium">承租人姓名</span>
                        <span className="font-bold text-slate-800">{currentTenantLease.tenantName} ({currentTenantLease.phone})</span>
                      </div>
                      {currentTenantLease.coTenantName && (
                        <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                          <span className="text-slate-500 font-medium">同住承租人</span>
                          <span className="font-bold text-slate-800">{currentTenantLease.coTenantName} ({currentTenantLease.coPhone || '無電話'})</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                        <span className="text-slate-500 font-medium">租賃期限</span>
                        <span className="font-bold text-slate-800">{currentTenantLease.startDate} 至 {currentTenantLease.endDate}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                        <span className="text-slate-500 font-medium">每月租金</span>
                        <span className="font-bold text-indigo-600 text-sm">
                          NT$ {getLeaseMonthlyRent(currentTenantLease).toLocaleString()} / 月
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-slate-200/50">
                        <span className="text-slate-500 font-medium">履約押金</span>
                        <span className="font-bold text-slate-800">NT$ {currentTenantLease.deposit.toLocaleString()}</span>
                      </div>
                      {currentTenantLease.note && (
                        <div className="pt-2">
                          <span className="text-slate-500 font-medium block mb-1">約定備註紀錄</span>
                          <p className="bg-white p-3 rounded-xl border border-slate-200 text-slate-700 leading-relaxed font-medium">
                            {currentTenantLease.note}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="pt-2">
                      <button
                        onClick={() => setActiveTab('portal')}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xs transition-colors focus:outline-none flex items-center justify-center gap-1.5"
                      >
                        <CreditCard size={15} />
                        <span>前往租金帳單清單</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        </main>
      </div>

      {/* ALL MODALS */}
      {activeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4 overflow-y-auto">
          <div className={`bg-white rounded-2xl shadow-2xl border border-slate-100 w-full overflow-hidden max-h-[90vh] flex flex-col my-auto ${activeModal === 'managePhotos' || activeModal === 'viewLandlordProperties' || activeModal === 'viewLease' || activeModal === 'viewReceipt' ? 'max-w-2xl' : (activeModal === 'tenantReportPayment' || activeModal === 'tenantPay' || activeModal === 'roleOnboarding' || activeModal === 'landlordApplication' || activeModal === 'lineFirstLogin') ? 'max-w-xl' : 'max-w-lg'
            }`}>
            {/* Modal Header */}
            <div className="px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 flex-shrink-0">
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                {activeModal === 'addProperty' && '新增房間房號'}
                {activeModal === 'editProperty' && '編輯房源資訊'}
                {activeModal === 'manageAddresses' && '管理租屋地址'}
                {activeModal === 'manageBankInfo' && '設定收款帳戶資訊'}
                {activeModal === 'lineLogin' && 'LINE 帳號快速登入'}
                {activeModal === 'lineFirstLogin' && '🎉 首次 LINE 登入 - 請完善會員資料'}
                {activeModal === 'roleOnboarding' && '🎉 歡迎加入！請選擇您的會員身分'}
                {activeModal === 'landlordApplication' && '🏢 填寫房東身分審核資料'}
                {activeModal === 'lineBinding' && 'LINE 官方帳號安全綁定'}
                {activeModal === 'addLease' && '新增租約紀錄'}
                {activeModal === 'editLease' && '編輯租約紀錄'}
                {activeModal === 'viewLease' && '租約詳細紀錄'}
                {activeModal === 'managePhotos' && '新增/編輯房源照片'}
                {activeModal === 'viewLandlordProperties' && '旗下房源物件清單'}
                {activeModal === 'recordPayment' && '確認帳單入帳與收款登記'}
                {activeModal === 'viewReceipt' && '租金電子繳費證明收據'}
                {activeModal === 'addCustomBill' && '新增帳單 / 記錄已收款項 (房東端)'}
                {activeModal === 'tenantReportPayment' && '回報已繳費用'}
                {activeModal === 'tenantPay' && '回報已繳費用'}
              </h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 focus:outline-none p-1 rounded-lg hover:bg-slate-200/60">
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 flex-1 overflow-y-auto overscroll-contain">

              {/* Add Property */}
              {activeModal === 'addProperty' && (
                <form onSubmit={handleAddProperty} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">租屋地址 (棟/門牌)</label>
                    <select
                      value={propAddress}
                      onChange={(e) => setPropAddress(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                    >
                      {landlordAddresses.filter(addr => addr.landlordId === currentLandlordId).map(addr => (
                        <option key={addr.id} value={addr.address}>{addr.address}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">房源名稱 / 房號</label>
                    <input
                      type="text"
                      placeholder="例如：A棟-301室"
                      value={propName}
                      onChange={(e) => setPropName(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">房源類型</label>
                      <select
                        value={propType}
                        onChange={(e) => setPropType(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      >
                        <option value="獨立套房">獨立套房</option>
                        <option value="分租套房">分租套房</option>
                        <option value="雅房">雅房</option>
                        <option value="整層住家">整層住家</option>
                        <option value="店面/商辦">店面/商辦</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">租金金額 (NT$) 與收費週期</label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="0"
                          placeholder="例如：12000"
                          value={propRent}
                          onChange={(e) => setPropRent(e.target.value)}
                          className="w-full border border-slate-200 rounded-xl pl-3 pr-28 py-2.5 text-sm outline-none focus:border-indigo-500 font-bold font-mono text-slate-800"
                          required
                        />
                        <div className="absolute right-1 top-1 bottom-1 flex items-center">
                          <select
                            value={propRentPeriod}
                            onChange={(e) => setPropRentPeriod(e.target.value)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-200 rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer transition-colors"
                          >
                            <option value="monthly">每月</option>
                            <option value="yearly">每年</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 明顯提示區 (Prominent Mode Hint) */}
                  <div className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${propRentPeriod === 'yearly'
                    ? 'bg-purple-50/80 border-purple-200 text-purple-900'
                    : 'bg-indigo-50/80 border-indigo-200 text-indigo-900'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{propRentPeriod === 'yearly' ? '📅' : '📆'}</span>
                      <span className="font-semibold">
                        計費模式：
                        <span className="font-bold font-mono ml-1 underline decoration-2">
                          {propRent ? `NT$ ${Number(propRent).toLocaleString()} / ${propRentPeriod === 'yearly' ? '年 (年繳總額)' : '月 (每月月繳)'}` : '（請填寫租金金額）'}
                        </span>
                      </span>
                    </div>
                    {propRent && (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded self-start sm:self-auto ${propRentPeriod === 'yearly'
                        ? 'bg-purple-200/80 text-purple-800'
                        : 'bg-indigo-200/80 text-indigo-800'
                        }`}>
                        {propRentPeriod === 'yearly'
                          ? `折合月租約 NT$ ${Math.round(Number(propRent) / 12).toLocaleString()} / 月`
                          : `1年租期合約總額約 NT$ ${(Number(propRent) * 12).toLocaleString()}`}
                      </span>
                    )}
                  </div>
                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-500 focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors focus:outline-none shadow-xs"
                    >
                      確認新增
                    </button>
                  </div>
                </form>
              )}

              {/* Edit Property */}
              {activeModal === 'editProperty' && editingProperty && (
                <form onSubmit={handleEditPropertySubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">租屋地址</label>
                    <select
                      value={propAddress}
                      onChange={(e) => setPropAddress(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                    >
                      {landlordAddresses.filter(addr => addr.landlordId === currentLandlordId).map(addr => (
                        <option key={addr.id} value={addr.address}>{addr.address}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">房源名稱 / 房號</label>
                    <input
                      type="text"
                      value={propName}
                      onChange={(e) => setPropName(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">房源類型</label>
                      <select
                        value={propType}
                        onChange={(e) => setPropType(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      >
                        <option value="獨立套房">獨立套房</option>
                        <option value="分租套房">分租套房</option>
                        <option value="雅房">雅房</option>
                        <option value="整層住家">整層住家</option>
                        <option value="店面/商辦">店面/商辦</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">租金金額 (NT$) 與收費週期</label>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="0"
                          placeholder="例如：12000"
                          value={propRent}
                          onChange={(e) => setPropRent(e.target.value)}
                          className="w-full border border-slate-200 rounded-xl pl-3 pr-28 py-2.5 text-sm outline-none focus:border-indigo-500 font-bold font-mono text-slate-800"
                          required
                        />
                        <div className="absolute right-1 top-1 bottom-1 flex items-center">
                          <select
                            value={propRentPeriod}
                            onChange={(e) => setPropRentPeriod(e.target.value)}
                            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-200 rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer transition-colors"
                          >
                            <option value="monthly">每月 (月繳)</option>
                            <option value="yearly">每年 (年繳)</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 明顯提示區 (Prominent Mode Hint) */}
                  <div className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${propRentPeriod === 'yearly'
                    ? 'bg-purple-50/80 border-purple-200 text-purple-900'
                    : 'bg-indigo-50/80 border-indigo-200 text-indigo-900'
                    }`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{propRentPeriod === 'yearly' ? '📅' : '📆'}</span>
                      <span className="font-semibold">
                        計費模式：
                        <span className="font-bold font-mono ml-1 underline decoration-2">
                          {propRent ? `NT$ ${Number(propRent).toLocaleString()} / ${propRentPeriod === 'yearly' ? '年 (年繳總額)' : '月 (每月月繳)'}` : '（請填寫租金金額）'}
                        </span>
                      </span>
                    </div>
                    {propRent && (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded self-start sm:self-auto ${propRentPeriod === 'yearly'
                        ? 'bg-purple-200/80 text-purple-800'
                        : 'bg-indigo-200/80 text-indigo-800'
                        }`}>
                        {propRentPeriod === 'yearly'
                          ? `折合月租約 NT$ ${Math.round(Number(propRent) / 12).toLocaleString()} / 月`
                          : `1年租期合約總額約 NT$ ${(Number(propRent) * 12).toLocaleString()}`}
                      </span>
                    )}
                  </div>
                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-500 focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors focus:outline-none shadow-xs"
                    >
                      儲存變更
                    </button>
                  </div>
                </form>
              )}

              {/* Manage Addresses */}
              {activeModal === 'manageAddresses' && (
                <div className="space-y-4">
                  {/* Current Landlord Isolation Banner */}
                  <div className="bg-indigo-50/70 p-3.5 rounded-2xl border border-indigo-100 flex items-center justify-between text-xs text-indigo-950">
                    <div className="flex items-center gap-2">
                      <Building size={16} className="text-indigo-600 flex-shrink-0" />
                      <div>
                        <span className="font-bold">房東專屬租屋地址庫</span>
                        <p className="text-[11px] text-indigo-700/80 mt-0.5">每個房東各自獨立管理，其他房東無法看見或使用您的地址</p>
                      </div>
                    </div>
                    <span className="font-bold px-2.5 py-1 bg-white text-indigo-700 rounded-lg border border-indigo-200 shadow-2xs flex-shrink-0">
                      {landlords.find(l => l.id === currentLandlordId)?.name || '目前房東'}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="輸入租屋地址)"
                      value={newAddressText}
                      onChange={(e) => setNewAddressText(e.target.value)}
                      className="flex-1 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 font-semibold"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const trimmed = newAddressText.trim();
                        if (!trimmed) {
                          showToast('請輸入租屋地址內容！', 'warning');
                          return;
                        }
                        if (!currentLandlordId) {
                          showToast('無法辨識目前房東身分，請重新登入！', 'error');
                          return;
                        }
                        const myExisting = landlordAddresses.filter(addr => addr.landlordId === currentLandlordId);
                        if (myExisting.some(addr => addr.address === trimmed)) {
                          showToast('您已建立過相同的租屋地址！', 'warning');
                          return;
                        }
                        const newAddr = {
                          id: `ADDR_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                          landlordId: currentLandlordId,
                          address: trimmed
                        };

                        try {
                          if (isSupabaseConfigured && currentLandlordId) {
                            await supabase.from('landlord_addresses').insert({
                              id: newAddr.id,
                              landlord_id: currentLandlordId,
                              address: trimmed
                            });
                          }
                          setLandlordAddresses(prev => [...prev, newAddr]);
                          setNewAddressText('');
                          showToast(`已成功新增您的專屬租屋地址「${trimmed}」！`, 'success');
                        } catch (err) {
                          showToast(`新增地址失敗: ${err.message}`, 'error');
                        }
                      }}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-xs transition-colors flex items-center gap-1 focus:outline-none flex-shrink-0"
                    >
                      <Plus size={16} />
                      <span>新增地址</span>
                    </button>
                  </div>

                  <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 max-h-60 overflow-y-auto bg-slate-50/50">
                    {landlordAddresses.filter(addr => addr.landlordId === currentLandlordId).length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 font-medium">
                        您目前尚未建立任何專屬租屋地址，請於上方輸入新增。
                      </div>
                    ) : (
                      landlordAddresses.filter(addr => addr.landlordId === currentLandlordId).map(addr => (
                        <div key={addr.id} className="flex justify-between items-center p-3 hover:bg-white transition-colors">
                          <span className="text-sm text-slate-700 font-semibold truncate pr-4">{addr.address}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              const isUsed = properties.some(p => p.landlordId === currentLandlordId && p.address === addr.address);
                              if (isUsed) {
                                showToast('此地址已被您旗下的房間房號使用中，無法直接刪除！', 'error');
                                return;
                              }
                              const confirmed = await showConfirmDialog(`確定要刪除此專屬地址「${addr.address}」嗎？`);
                              if (confirmed) {
                                try {
                                  if (isSupabaseConfigured) {
                                    await supabase.from('landlord_addresses').delete().eq('id', addr.id);
                                  }
                                  setLandlordAddresses(prev => prev.filter(a => a.id !== addr.id));
                                  showToast('租屋地址已刪除！', 'success');
                                } catch (err) {
                                  showToast(`刪除失敗: ${err.message}`, 'error');
                                }
                              }
                            }}
                            className="text-rose-600 hover:text-rose-800 p-1.5 hover:bg-rose-50 rounded-lg transition-colors focus:outline-none flex-shrink-0"
                            title="刪除地址"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition-colors focus:outline-none"
                    >
                      完成
                    </button>
                  </div>
                </div>
              )}

              {/* Manage Landlord Bank Info Modal */}
              {activeModal === 'manageBankInfo' && (
                <form onSubmit={handleSaveLandlordBankInfo} className="space-y-4">
                  <div className="bg-indigo-50/70 p-4 rounded-2xl border border-indigo-100 flex items-start gap-3">
                    <CreditCard className="text-indigo-600 flex-shrink-0 mt-0.5" size={20} />
                    <div className="text-xs text-indigo-950">
                      <p className="font-bold mb-0.5">房東專屬收款帳戶設定</p>
                      <p className="text-indigo-800 leading-relaxed">
                        在此填寫您的銀行匯款帳戶資訊。當房客於房客專區選擇「銀行轉帳」繳款時，系統將會向房客展示此帳戶。若不填寫則房客端轉帳資訊將保持為空值。
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">收款銀行名稱與代碼</label>
                      <input
                        type="text"
                        placeholder="例如：808 玉山銀行 營業部，或 013 國泰世華"
                        value={tempBankName}
                        onChange={(e) => setTempBankName(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold outline-none focus:border-indigo-600 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">銀行帳號</label>
                      <input
                        type="text"
                        placeholder="例如：0012-3456-7890-12"
                        value={tempBankAccount}
                        onChange={(e) => setTempBankAccount(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-mono font-bold outline-none focus:border-indigo-600 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">戶名</label>
                      <input
                        type="text"
                        placeholder="例如：周金在"
                        value={tempAccountName}
                        onChange={(e) => setTempAccountName(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold outline-none focus:border-indigo-600 bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">轉帳備註 / 說明 (選填)</label>
                      <input
                        type="text"
                        placeholder="例如：匯款後請務必回報帳號後五碼供核帳"
                        value={tempBankNote}
                        onChange={(e) => setTempBankNote(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-indigo-600 bg-white"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold transition-colors focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors focus:outline-none"
                    >
                      儲存收款帳戶
                    </button>
                  </div>
                </form>
              )}

              {/* Add Lease (Simplified Information Recording) */}
              {activeModal === 'addLease' && (
                <form onSubmit={handleAddLeaseSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">承租房源</label>
                    <select
                      value={leasePropId}
                      onChange={(e) => handleLeasePropertySelect(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                    >
                      {properties.filter(p => !p.deletedAt && (p.landlordId === currentLandlordId || !p.landlordId)).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.address ? `(${p.address})` : ''} — {p.rentPeriod === 'yearly' ? `年繳 NT$ ${p.rent.toLocaleString()}/年` : `月繳 NT$ ${p.rent.toLocaleString()}/月`} · {p.status === 'occupied' ? '⚠️ 已出租' : '✅ 空置中'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">承租人電話</label>
                      <input
                        type="text"
                        placeholder="例如：0912345678"
                        value={leasePhone}
                        onChange={(e) => handlePhoneInputChange(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center justify-between">
                        <span>承租人姓名</span>
                        {(() => {
                          const cleaned = leasePhone.replace(/[-\s]/g, '').trim();
                          const isReg = cleaned && (
                            registeredTenants.some(t => t.phone.replace(/[-\s]/g, '').trim() === cleaned) ||
                            leases.some(l => l.phone.replace(/[-\s]/g, '').trim() === cleaned)
                          );
                          if (isReg) {
                            return (
                              <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-bold">
                                已連動會員
                              </span>
                            );
                          } else if (leasePhone.trim()) {
                            return (
                              <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-bold">
                                尚未註冊 (可手動輸入)
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </label>
                      <input
                        type="text"
                        placeholder={leasePhone.trim() ? "請輸入承租人姓名..." : "輸入電話或直接輸入姓名..."}
                        value={leaseTenantName}
                        onChange={(e) => setLeaseTenantName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none font-bold focus:border-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  {leasePhone.trim() && (
                    <div className={`p-3 rounded-xl text-xs font-medium border flex items-start gap-2 ${registeredTenants.some(t => t.phone.replace(/[-\s]/g, '').trim() === leasePhone.replace(/[-\s]/g, '').trim()) ||
                      leases.some(l => l.phone.replace(/[-\s]/g, '').trim() === leasePhone.replace(/[-\s]/g, '').trim())
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                      : 'bg-indigo-50/80 border-indigo-200 text-indigo-900'
                      }`}>
                      {registeredTenants.some(t => t.phone.replace(/[-\s]/g, '').trim() === leasePhone.replace(/[-\s]/g, '').trim()) ||
                        leases.some(l => l.phone.replace(/[-\s]/g, '').trim() === leasePhone.replace(/[-\s]/g, '').trim()) ? (
                        <>
                          <span className="text-base">✅</span>
                          <div className="leading-relaxed">
                            <strong>已連動會員：</strong>系統已自動配對註冊租客「{leaseTenantName}」。建立租約後將直接呈現在其租客中心。
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="text-base">💡</span>
                          <div className="leading-relaxed">
                            <strong>租客尚未註冊（房東手動登錄）：</strong>您可直接輸入房客姓名完成租約建立。<strong>日後租客使用此電話註冊帳號時，系統將自動無縫連動並延續此份租約、房源與帳單！</strong>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Co-tenant Section */}
                  {!showCoTenant ? (
                    <button
                      type="button"
                      onClick={() => setShowCoTenant(true)}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl transition-colors focus:outline-none"
                    >
                      <Plus size={14} className="mr-1" />
                      <span>登記同住人資訊 (選填)</span>
                    </button>
                  ) : (
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-700">同住人資訊 (選填)</span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCoTenant(false);
                            setLeaseCoTenantName('');
                            setLeaseCoPhone('');
                          }}
                          className="text-[10px] text-rose-600 hover:underline font-bold"
                        >
                          移除同住人
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">同住人電話</label>
                          <input
                            type="text"
                            placeholder="例如：0912345678"
                            value={leaseCoPhone}
                            onChange={(e) => handleCoPhoneInputChange(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-500 font-semibold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1 flex items-center justify-between">
                            <span>同住人姓名</span>
                            {leaseCoPhone.trim() && (
                              <span className="text-[9px] text-indigo-600 font-bold">可手動輸入</span>
                            )}
                          </label>
                          <input
                            type="text"
                            placeholder="輸入同住人姓名..."
                            value={leaseCoTenantName}
                            onChange={(e) => setLeaseCoTenantName(e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none font-bold focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">租約起效日</label>
                      <input
                        type="date"
                        value={leaseStartDate}
                        onChange={(e) => setLeaseStartDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 font-semibold text-slate-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">租約到期日</label>
                      <input
                        type="date"
                        value={leaseEndDate}
                        onChange={(e) => setLeaseEndDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 font-semibold text-slate-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">履約押金金額 (NT$)</label>
                    <input
                      type="number"
                      placeholder="請輸入押金金額"
                      value={leaseDeposit}
                      onChange={(e) => setLeaseDeposit(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      required
                    />
                  </div>

                  {/* Three Calculation Fields: (月/年)租金 * 合約期(月/年) = 合約總租金 */}
                  <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                        <span>📐 租金與合約總額計算</span>
                      </label>
                      <span className="text-[11px] text-indigo-600 font-medium">
                        (月/年)租金 × 合約期 = 合約總租金
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      {/* Field 1: (月/年)租金 */}
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          (月/年)租金 (NT$)
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            placeholder="例如：15000"
                            value={leaseUnitRent}
                            onChange={(e) => handleUnitRentChange(e.target.value)}
                            className="w-full border border-slate-200 bg-white rounded-xl pl-3 pr-16 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-600 font-mono"
                            required
                          />
                          <select
                            value={leaseUnitType}
                            onChange={(e) => handleUnitTypeChange(e.target.value)}
                            className="absolute right-1 top-1 bottom-1 bg-slate-100 hover:bg-slate-200 border-0 rounded-lg px-2 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                          >
                            <option value="monthly">/ 月</option>
                            <option value="yearly">/ 年</option>
                          </select>
                        </div>
                      </div>

                      {/* Multiplier Operator */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center pb-2.5 text-slate-400 font-black text-lg">
                        ×
                      </div>

                      {/* Field 2: 合約期(月/年) */}
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          合約期 ({leaseUnitType === 'yearly' ? '年數' : '月數'})
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            placeholder="例如：12"
                            value={leasePeriodCount}
                            onChange={(e) => handlePeriodCountChange(e.target.value)}
                            className="w-full border border-slate-200 bg-white rounded-xl pl-3 pr-10 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-600 font-mono"
                            required
                          />
                          <span className="absolute right-3 top-2 text-xs text-slate-400 font-medium pointer-events-none">
                            {leaseUnitType === 'yearly' ? '年' : '個月'}
                          </span>
                        </div>
                      </div>

                      {/* Equals Operator */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center pb-2.5 text-slate-400 font-black text-lg">
                        =
                      </div>

                      {/* Field 3: 合約總租金 */}
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-indigo-900 mb-1">
                          合約總租金 (NT$)
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="合約總租金"
                          value={leaseTotalRent}
                          onChange={(e) => setLeaseTotalRent(e.target.value)}
                          className="w-full border-2 border-indigo-200 bg-indigo-50/70 rounded-xl px-3 py-2 text-sm font-black text-indigo-950 outline-none focus:border-indigo-600 font-mono"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 font-medium bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    💡 提示：「合約總租金」將做為此租約的應收基準記錄在「尚餘租金」，隨著租客繳費入帳逐期扣減。
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">備註紀錄 / 約定說明 (選填)</label>
                    <textarea
                      rows={3}
                      placeholder="例如：租金含水網路費，電費每度5元、附機車位B1-12號..."
                      value={leaseNote}
                      onChange={(e) => setLeaseNote(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2 text-xs outline-none focus:border-indigo-500 font-medium text-slate-800 resize-none leading-relaxed"
                    />
                  </div>

                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-500 focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-xs focus:outline-none"
                    >
                      儲存租約紀錄
                    </button>
                  </div>
                </form>
              )}

              {/* Edit Lease Record */}
              {activeModal === 'editLease' && editingLease && (
                <form onSubmit={handleEditLeaseSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">聯絡電話</label>
                      <input
                        type="text"
                        placeholder="例如：0912345678"
                        value={leasePhone}
                        onChange={(e) => handlePhoneInputChange(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">承租人姓名</label>
                      <input
                        type="text"
                        placeholder="輸入承租人姓名..."
                        value={leaseTenantName}
                        onChange={(e) => setLeaseTenantName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none font-bold focus:border-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">同住人電話 (選填)</label>
                      <input
                        type="text"
                        placeholder="例如：0912345678"
                        value={leaseCoPhone}
                        onChange={(e) => handleCoPhoneInputChange(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">同住人姓名 (選填)</label>
                      <input
                        type="text"
                        placeholder="輸入同住人姓名..."
                        value={leaseCoTenantName}
                        onChange={(e) => setLeaseCoTenantName(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-900 outline-none font-bold focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">租約起效日</label>
                      <input
                        type="date"
                        value={leaseStartDate}
                        onChange={(e) => setLeaseStartDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">租約到期日</label>
                      <input
                        type="date"
                        value={leaseEndDate}
                        onChange={(e) => setLeaseEndDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 font-semibold"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">履約押金 (NT$)</label>
                    <input
                      type="number"
                      value={leaseDeposit}
                      onChange={(e) => setLeaseDeposit(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                    />
                  </div>

                  {/* Three Calculation Fields: (月/年)租金 * 合約期(月/年) = 合約總租金 */}
                  <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                        <span>📐 租金與合約總額計算</span>
                      </label>
                      <span className="text-[11px] text-indigo-600 font-medium">
                        (月/年)租金 × 合約期 = 合約總租金
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      {/* Field 1: (月/年)租金 */}
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          (月/年)租金 (NT$)
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            placeholder="例如：15000"
                            value={leaseUnitRent}
                            onChange={(e) => handleUnitRentChange(e.target.value)}
                            className="w-full border border-slate-200 bg-white rounded-xl pl-3 pr-16 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-600 font-mono"
                            required
                          />
                          <select
                            value={leaseUnitType}
                            onChange={(e) => handleUnitTypeChange(e.target.value)}
                            className="absolute right-1 top-1 bottom-1 bg-slate-100 hover:bg-slate-200 border-0 rounded-lg px-2 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
                          >
                            <option value="monthly">/ 月</option>
                            <option value="yearly">/ 年</option>
                          </select>
                        </div>
                      </div>

                      {/* Multiplier Operator */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center pb-2.5 text-slate-400 font-black text-lg">
                        ×
                      </div>

                      {/* Field 2: 合約期(月/年) */}
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          合約期 ({leaseUnitType === 'yearly' ? '年數' : '月數'})
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            placeholder="例如：12"
                            value={leasePeriodCount}
                            onChange={(e) => handlePeriodCountChange(e.target.value)}
                            className="w-full border border-slate-200 bg-white rounded-xl pl-3 pr-10 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-600 font-mono"
                            required
                          />
                          <span className="absolute right-3 top-2 text-xs text-slate-400 font-medium pointer-events-none">
                            {leaseUnitType === 'yearly' ? '年' : '個月'}
                          </span>
                        </div>
                      </div>

                      {/* Equals Operator */}
                      <div className="hidden sm:flex sm:col-span-1 items-center justify-center pb-2.5 text-slate-400 font-black text-lg">
                        =
                      </div>

                      {/* Field 3: 合約總租金 */}
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-indigo-900 mb-1">
                          合約總租金 (NT$)
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="合約總租金"
                          value={leaseTotalRent}
                          onChange={(e) => setLeaseTotalRent(e.target.value)}
                          className="w-full border-2 border-indigo-200 bg-indigo-50/70 rounded-xl px-3 py-2 text-sm font-black text-indigo-950 outline-none focus:border-indigo-600 font-mono"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">備註紀錄 / 約定說明</label>
                    <textarea
                      rows={3}
                      value={leaseNote}
                      onChange={(e) => setLeaseNote(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2 text-xs outline-none focus:border-indigo-500 font-medium text-slate-800 resize-none leading-relaxed"
                    />
                  </div>

                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-500 focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors focus:outline-none shadow-xs"
                    >
                      儲存變更
                    </button>
                  </div>
                </form>
              )}

              {/* View Lease Details */}
              {activeModal === 'viewLease' && viewingLease && (
                <div className="space-y-4 text-xs sm:text-sm">
                  {(() => {
                    const prop = properties.find(p => p.id === viewingLease.propertyId);
                    return (
                      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                          <span className="text-slate-500 font-medium">租賃房源</span>
                          <span className="font-bold text-slate-800">{prop ? (prop.name + (prop.deletedAt ? ' (已下架)' : '')) : (viewingLease.propertyName || viewingLease.propertyId || '歷史房源')} ({prop?.address || '未填寫地址'})</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                          <span className="text-slate-500 font-medium">主承租人</span>
                          <span className="font-bold text-slate-800">{viewingLease.tenantName} (電話: {viewingLease.phone})</span>
                        </div>
                        {viewingLease.coTenantName && (
                          <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                            <span className="text-slate-500 font-medium">同住承租人</span>
                            <span className="font-bold text-slate-800">{viewingLease.coTenantName} (電話: {viewingLease.coPhone || '無'})</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                          <span className="text-slate-500 font-medium">租賃期間</span>
                          <span className="font-semibold text-slate-800">{viewingLease.startDate} ~ {viewingLease.endDate}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                          <span className="text-slate-500 font-medium">每月租金</span>
                          <span className="font-bold text-indigo-600">NT$ {getLeaseMonthlyRent(viewingLease).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                          <span className="text-slate-500 font-medium">履約押金</span>
                          <span className="font-bold text-slate-800">NT$ {viewingLease.deposit.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-200 bg-indigo-50/70 p-3 rounded-xl border border-indigo-100">
                          <span className="text-indigo-900 font-bold flex items-center">
                            <Wallet size={14} className="mr-1 text-indigo-600" />
                            合約總租金 (尚餘計算基準)
                          </span>
                          <span className="font-black text-indigo-700 text-base">
                            NT$ {(viewingLease.totalContractRent || (getLeaseMonthlyRent(viewingLease) * calculateMonths(viewingLease.startDate, viewingLease.endDate))).toLocaleString()}
                          </span>
                        </div>
                        {viewingLease.note && (
                          <div className="pt-1">
                            <span className="text-slate-500 font-medium block mb-1">備註說明：</span>
                            <p className="bg-white p-3 rounded-xl border border-slate-200 text-slate-700 leading-relaxed font-medium">
                              {viewingLease.note}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleEditLeaseOpen(viewingLease);
                      }}
                      className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs sm:text-sm font-semibold transition-colors focus:outline-none"
                    >
                      編輯此筆租約
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors focus:outline-none"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              )}

              {/* Manage Photos Modal */}
              {activeModal === 'managePhotos' && photoModalProperty && (
                <div className="space-y-4">
                  <div className="bg-slate-50 p-3 sm:p-4 rounded-2xl border border-slate-100 flex justify-between items-center">
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm sm:text-base">
                        {photoModalProperty.name} · 房源實景照片
                      </h4>
                      <p className="text-xs text-slate-500 font-medium">
                        {photoModalProperty.address || '無地址'} · 共 {tempPhotos.length} 張照片
                      </p>
                    </div>
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full font-bold">
                      {tempPhotos.some(p => p.isCover) ? '已設封面' : '尚未設封面'}
                    </span>
                  </div>

                  {/* Photo Upload Dropzone */}
                  <label className="border-2 border-dashed border-indigo-300 hover:border-indigo-500 bg-indigo-50/40 hover:bg-indigo-50/80 rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2.5 group shadow-2xs">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotoFileUpload}
                      className="hidden"
                    />
                    <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
                      <Upload size={28} />
                    </div>
                    <div>
                      <p className="font-bold text-sm sm:text-base text-slate-800">
                        點擊此處選擇照片上傳 <span className="text-indigo-600 font-extrabold">(支援多張批次選取)</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1">支援手機相簿拍照或電腦 JPG, PNG, WEBP 照片檔</p>
                    </div>
                  </label>

                  {/* Photo Grid with Direct Drag and Drop Reordering */}
                  {tempPhotos.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
                      目前尚未上傳任何照片，請點擊上方按鈕選擇相片上傳。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-xs font-semibold text-slate-500 px-1">
                        <span>已選照片 ({tempPhotos.length} 張)</span>
                        <span>⭐ 設為封面主圖</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-80 overflow-y-auto p-1">
                        {tempPhotos.map((img, i) => {
                          const isDragging = draggedPhotoId === img.id || touchPhotoId === img.id;
                          const isOver = dragOverPhotoId === img.id && !isDragging;

                          return (
                            <div
                              key={img.id || i}
                              draggable="true"
                              data-photo-id={img.id}
                              onDragStart={(e) => handlePhotoDragStart(e, img.id)}
                              onDragOver={(e) => handlePhotoDragOver(e, img.id)}
                              onDrop={(e) => handlePhotoDrop(e, img.id)}
                              onDragEnd={handlePhotoDragEnd}
                              onTouchStart={() => handlePhotoTouchStart(img.id)}
                              onTouchMove={handlePhotoTouchMove}
                              onTouchEnd={handlePhotoTouchEnd}
                              className={`relative group rounded-2xl overflow-hidden border-2 transition-all cursor-grab active:cursor-grabbing select-none bg-white shadow-2xs ${
                                isDragging
                                  ? 'opacity-40 border-dashed border-indigo-500 scale-95'
                                  : isOver
                                  ? 'border-indigo-600 ring-4 ring-indigo-200 scale-105'
                                  : img.isCover
                                  ? 'border-indigo-600 ring-2 ring-indigo-200'
                                  : 'border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <div className="aspect-video relative bg-slate-100">
                                <img src={img.url} alt="房源照片" className="w-full h-full object-cover pointer-events-none" />

                                {/* Cover Badge & Selector */}
                                {img.isCover ? (
                                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold shadow-xs flex items-center gap-1 pointer-events-none">
                                    <Star size={11} className="fill-current" /> 封面主圖
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSetCoverPhoto(img.id);
                                    }}
                                    className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 hover:bg-indigo-600 text-white rounded-lg text-[10px] font-bold shadow-xs transition-colors opacity-90 sm:opacity-0 sm:group-hover:opacity-100"
                                  >
                                    設為封面
                                  </button>
                                )}

                                {/* Index Order Badge */}
                                <span className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 text-white rounded text-[10px] font-mono font-bold pointer-events-none">
                                  #{i + 1}
                                </span>

                                {/* Delete Button */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeletePhoto(img.id);
                                  }}
                                  className="absolute top-2 right-2 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors focus:outline-none shadow-sm"
                                  title="刪除此照片"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-medium">調整完成後請點擊儲存</span>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => setActiveModal(null)}
                        className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-500 focus:outline-none hover:bg-slate-50"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePhotos}
                        className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors focus:outline-none shadow-xs"
                      >
                        儲存照片變更
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* View Landlord Properties */}
              {activeModal === 'viewLandlordProperties' && viewingLandlordProps && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div>
                      <h4 className="font-bold text-slate-800">{viewingLandlordProps.name} 的房源清單</h4>
                      <p className="text-xs text-slate-500">電話：{viewingLandlordProps.phone}</p>
                    </div>
                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-150 text-xs px-2.5 py-1 rounded-lg font-bold">
                      總計 {properties.filter(p => p.landlordId === viewingLandlordProps.id).length} 間
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
                    {properties.filter(p => p.landlordId === viewingLandlordProps.id).length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">目前尚無房源</div>
                    ) : (
                      properties.filter(p => p.landlordId === viewingLandlordProps.id).map(prop => (
                        <div key={prop.id} className="p-3 flex justify-between items-center hover:bg-slate-50/50">
                          <div>
                            <p className="font-bold text-slate-800 text-xs sm:text-sm">{prop.name}</p>
                            <p className="text-[11px] text-slate-400">{prop.address || '無地址'} · {prop.type}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-slate-800 text-xs sm:text-sm">NT$ {prop.rent.toLocaleString()}</p>
                            <StatusBadge status={prop.status} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition-colors focus:outline-none"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              )}

              {/* Record Payment Modal (Landlord) */}
              {activeModal === 'recordPayment' && recordingPayment && (
                <form onSubmit={handleSaveRecordedPayment} className="space-y-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium">承租人：</span>
                      <span className="text-sm font-bold text-slate-800">{recordingPayment.tenantName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium">帳單項目：</span>
                      <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                        {recordingPayment.title || `${recordingPayment.dueDate.slice(0, 7)} 期租金`}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium">應繳金額：</span>
                      <span className="text-base font-extrabold text-slate-900">NT$ {recordingPayment.amount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500 font-medium">應繳期限：</span>
                      <span className="text-xs text-slate-600 font-semibold">{recordingPayment.dueDate}</span>
                    </div>
                    {recordingPayment.transferLast5 && (
                      <div className="flex justify-between items-center bg-amber-50 p-2 rounded-lg border border-amber-200">
                        <span className="text-xs text-amber-800 font-semibold">租客回報轉帳後五碼：</span>
                        <span className="text-xs font-bold text-amber-900 font-mono bg-white px-2 py-0.5 rounded border border-amber-300">
                          {recordingPayment.transferLast5}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">實際收款方式</label>
                    <select
                      value={recordPaymentMethod}
                      onChange={(e) => setRecordPaymentMethod(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                    >
                      <option value="bank">銀行轉帳</option>
                      <option value="cash">現金交付</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">入帳確認日期</label>
                    <input
                      type="date"
                      value={recordPaymentDate}
                      onChange={(e) => setRecordPaymentDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">對帳備註 (選填)</label>
                    <input
                      type="text"
                      placeholder="例如：玉山銀行 88291 已查核入帳"
                      value={recordPaymentNote}
                      onChange={(e) => setRecordPaymentNote(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="pt-3 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors focus:outline-none shadow-xs flex items-center"
                    >
                      <CheckCircle size={16} className="mr-1.5" />
                      <span>確認收款並入帳</span>
                    </button>
                  </div>
                </form>
              )}

              {/* View Official Receipt Modal */}
              {activeModal === 'viewReceipt' && receiptPayment && (() => {
                const targetLease = leases.find(l => l.id === receiptPayment.leaseId);
                const targetProp = properties.find(p => p.id === targetLease?.propertyId);
                const currentLandlord = landlords.find(l => l.id === targetProp?.landlordId);

                return (
                  <div className="space-y-6">
                    {/* Official Receipt Card */}
                    <div id="printable-receipt" className="bg-white border-2 border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6 relative overflow-hidden shadow-xs">
                      <div className="absolute top-4 right-4 opacity-5 pointer-events-none">
                        <Receipt size={140} />
                      </div>

                      {/* Receipt Header */}
                      <div className="text-center border-b-2 border-slate-800 pb-4">
                        <h2 className="text-xl sm:text-2xl font-black tracking-wider text-slate-900">
                          房屋租賃租金繳納收據憑單
                        </h2>
                        <p className="text-xs text-slate-500 font-serif tracking-widest mt-1">
                          OFFICIAL RENT PAYMENT RECEIPT
                        </p>
                      </div>

                      {/* Receipt Top Info */}
                      <div className="flex justify-between items-center text-xs text-slate-600">
                        <div>
                          <span className="text-slate-400">收據編號：</span>
                          <span className="font-mono font-bold text-slate-800">{receiptPayment.id}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">開立日期：</span>
                          <span className="font-semibold text-slate-800">{receiptPayment.paidDate || new Date().toISOString().split('T')[0]}</span>
                        </div>
                      </div>

                      {/* Receipt Details Table */}
                      <div className="border border-slate-300 rounded-xl overflow-hidden text-xs sm:text-sm">
                        <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/70 p-3">
                          <span className="text-slate-500 font-semibold">承租人 (繳款人)</span>
                          <span className="col-span-2 font-bold text-slate-900">{receiptPayment.tenantName} {targetLease?.phone ? `(${targetLease.phone})` : ''}</span>
                        </div>
                        <div className="grid grid-cols-3 border-b border-slate-200 p-3">
                          <span className="text-slate-500 font-semibold">租賃標的物</span>
                          <span className="col-span-2 font-semibold text-slate-800">
                            {receiptPayment.propertyName || targetProp?.name || '租賃房間'}
                            {targetProp?.address ? ` · ${targetProp.address}` : ''}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/70 p-3">
                          <span className="text-slate-500 font-semibold">繳納項目/期別</span>
                          <span className="col-span-2 font-bold text-indigo-700">
                            {(() => {
                              const cat = getCategoryInfo(receiptPayment.billType);
                              return `${cat.label}${receiptPayment.title ? ` (${receiptPayment.title})` : ` (${receiptPayment.dueDate.slice(0, 7)}期)`}`;
                            })()}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 border-b border-slate-200 p-3">
                          <span className="text-slate-500 font-semibold">收款方式</span>
                          <span className="col-span-2 text-slate-800 font-medium">
                            {formatPaymentMethod(receiptPayment.paymentMethod)}
                            {receiptPayment.transferLast5 ? ` (轉帳末5碼: ${receiptPayment.transferLast5})` : ''}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 bg-emerald-50/50 p-4 items-center">
                          <span className="text-slate-700 font-bold">實收總金額</span>
                          <div className="col-span-2 space-y-1">
                            <span className="font-extrabold text-emerald-800 text-base sm:text-lg block">
                              {formatChineseCurrency(receiptPayment.amount)}
                            </span>
                            <span className="text-xs font-mono text-emerald-700 font-bold block">
                              (NT$ {receiptPayment.amount.toLocaleString()})
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Signatures & Seal */}
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200 text-xs">
                        <div className="space-y-1.5">
                          <p className="text-slate-400">備註說明：</p>
                          <p className="text-slate-600 font-medium">{receiptPayment.note || '本收據經由租賃管理系統自動開立，款項已全額入帳核銷。'}</p>
                        </div>
                        <div className="text-right flex flex-col items-end justify-center">
                          <div className="border-2 border-dashed border-rose-400 bg-rose-50/60 text-rose-700 font-bold px-4 py-2 rounded-xl text-center inline-block">
                            <p className="text-[10px] tracking-wider uppercase">電子核銷專用章</p>
                            <p className="text-xs font-black tracking-widest mt-0.5">{currentLandlord?.name || '出租人'}</p>
                            <p className="text-[9px] text-rose-500 font-mono">PAID & VERIFIED</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Receipt Action Buttons */}
                    <div className="flex justify-between items-center pt-2">
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-sm font-bold transition-colors flex items-center"
                      >
                        <Printer size={16} className="mr-1.5" />
                        <span>列印 / 另存 PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveModal(null)}
                        className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold transition-colors"
                      >
                        關閉
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Add Custom Bill / Direct Record Modal (Landlord) */}
              {activeModal === 'addCustomBill' && (
                <form onSubmit={handleSaveCustomBill} className="space-y-4">
                  {/* Mode Selector */}
                  <div className="bg-slate-100 p-1.5 rounded-xl flex gap-1">
                    <button
                      type="button"
                      onClick={() => setCustomBillPaymentType('paid')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${customBillPaymentType === 'paid'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      <CheckCircle size={14} />
                      <span>直接登記為已收訖 (立即入帳)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomBillPaymentType('pending')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${customBillPaymentType === 'pending'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      <Clock size={14} />
                      <span>開立待繳帳單 (未入帳)</span>
                    </button>
                  </div>

                  <div className={`p-3 rounded-xl text-xs font-medium border ${customBillPaymentType === 'paid'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                    }`}>
                    {customBillPaymentType === 'paid'
                      ? '⚡ 房東直接記錄已收到的費用，系統將直接標記為「已繳清」並可隨時開立電子收據，不需房客審核。'
                      : '📝 房東開立應繳帳單，房客端將收到即時提醒並計入「尚餘租金/待繳費用」。'}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">選擇承租合約與房客</label>
                    <select
                      value={customBillLeaseId}
                      onChange={(e) => {
                        setCustomBillLeaseId(e.target.value);
                        const selLease = leases.find(l => l.id === e.target.value);
                        if (selLease && customBillCategory === 'rent') setCustomBillAmount(getLeaseMonthlyRent(selLease).toString());
                      }}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      required
                    >
                      {leases.filter(l => landlordPropertyIds.includes(l.propertyId) && l.status === 'active').map(l => {
                        const p = properties.find(prop => prop.id === l.propertyId);
                        return (
                          <option key={l.id} value={l.id}>
                            {l.tenantName} · {p ? p.name : '未知房源'} ({l.startDate} ~ {l.endDate})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">費用類別</label>
                      <select
                        value={customBillCategory}
                        onChange={(e) => {
                          setCustomBillCategory(e.target.value);
                          if (e.target.value === 'rent') {
                            const selLease = leases.find(l => l.id === customBillLeaseId);
                            if (selLease) setCustomBillAmount(getLeaseMonthlyRent(selLease).toString());
                          }
                        }}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      >
                        <option value="rent">🏠 租金</option>
                        <option value="deposit">🔒 押金保證金</option>
                        <option value="utilities">⚡ 水電費</option>
                        <option value="management">🏢 管理費</option>
                        <option value="other">📦 其他</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">金額 (NT$)</label>
                      <input
                        type="number"
                        placeholder="例如：3500"
                        value={customBillAmount}
                        onChange={(e) => setCustomBillAmount(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                        required
                        min="1"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">項目名稱 / 備註</label>
                      <input
                        type="text"
                        placeholder="例如：月份 (如：8月份)"
                        value={customBillTitle}
                        onChange={(e) => setCustomBillTitle(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        {customBillPaymentType === 'paid' ? '收款/入帳日期' : '應繳截止日期'}
                      </label>
                      <input
                        type="date"
                        value={customBillDueDate}
                        onChange={(e) => setCustomBillDueDate(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                        required
                      />
                    </div>
                  </div>

                  {customBillPaymentType === 'paid' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">收款管道方式</label>
                      <select
                        value={customBillPaymentMethod}
                        onChange={(e) => setCustomBillPaymentMethod(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500 font-semibold"
                      >
                        <option value="bank">銀行轉帳</option>
                        <option value="cash">現金交付</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">備註說明 (選填)</label>
                    <textarea
                      rows="2"
                      placeholder="例如：電表度數 1240 -> 1450，共 210 度..."
                      value={customBillNote}
                      onChange={(e) => setCustomBillNote(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="pt-3 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className={`px-5 py-2 text-sm font-semibold text-white rounded-xl transition-colors focus:outline-none shadow-xs flex items-center space-x-1.5 ${customBillPaymentType === 'paid' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                    >
                      <CheckCircle size={15} />
                      <span>{customBillPaymentType === 'paid' ? '直接記錄已收款入帳' : '確認開立待繳帳單'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Role Onboarding Modal: 我是房客 vs 我是房東 */}
              {activeModal === 'roleOnboarding' && (
                <div className="space-y-6">
                  <div className="text-center space-y-1.5 border-b border-slate-100 pb-4">
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-2 shadow-xs">
                      <Sparkles size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">
                      歡迎，{onboardingUser?.name || '新會員'}！請選擇您的系統身分
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                      請依據您的使用需求選擇身分，系統將即刻為您開啟專屬的租屋或管理專區。
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Option 1: Tenant */}
                    <div className="bg-emerald-50/50 border-2 border-emerald-200 hover:border-emerald-500 rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-sm">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl">
                            <Home size={24} />
                          </div>
                          <span className="bg-emerald-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-2xs">
                            ⚡ 即開即用・免審核
                          </span>
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-emerald-950">我是房客 (Tenant)</h4>
                          <p className="text-xs text-emerald-850 mt-1 leading-relaxed">
                            適合找房、承租中的房客，享有個人化專屬中心。
                          </p>
                        </div>
                        <ul className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-emerald-200/60 font-medium">
                          <li className="flex items-center gap-1.5">
                            <CheckCircle size={13} className="text-emerald-600 flex-shrink-0" />
                            <span>線上即時查看合約細節與履約押金</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <CheckCircle size={13} className="text-emerald-600 flex-shrink-0" />
                            <span>查閱每月租金與水電帳單明細</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <CheckCircle size={13} className="text-emerald-600 flex-shrink-0" />
                            <span>回報已繳費用與電子收據下載</span>
                          </li>
                        </ul>
                      </div>

                      <button
                        type="button"
                        onClick={handleSelectTenantRole}
                        disabled={onboardingLoading}
                        className="mt-5 w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>{onboardingLoading ? '開通中...' : '開通房客專區 (直接進入)'}</span>
                        <ArrowRight size={15} />
                      </button>
                    </div>

                    {/* Option 2: Landlord */}
                    <div className="bg-indigo-50/50 border-2 border-indigo-200 hover:border-indigo-500 rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-sm">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl">
                            <Building size={24} />
                          </div>
                          <span className="bg-indigo-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-2xs">
                            🛡️ 填寫認證・管理員審核
                          </span>
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-indigo-950">我是房東 (Landlord)</h4>
                          <p className="text-xs text-indigo-850 mt-1 leading-relaxed">
                            適合屋主、房產管理者、包租代管。
                          </p>
                        </div>
                        <ul className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-indigo-200/60 font-medium">
                          <li className="flex items-center gap-1.5">
                            <CheckCircle size={13} className="text-indigo-600 flex-shrink-0" />
                            <span>房源房間號與專屬地址庫管理</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <CheckCircle size={13} className="text-indigo-600 flex-shrink-0" />
                            <span>建立租約、自動出帳與租金對帳</span>
                          </li>
                          <li className="flex items-center gap-1.5">
                            <CheckCircle size={13} className="text-indigo-600 flex-shrink-0" />
                            <span>租金收款入帳審核與收據開立</span>
                          </li>
                        </ul>
                      </div>

                      <button
                        type="button"
                        onClick={handleSelectLandlordRole}
                        className="mt-5 w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>下一步：填寫房東審核資料</span>
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Landlord Application Form Modal */}
              {activeModal === 'landlordApplication' && (
                <div className="space-y-4">
                  <div className="bg-indigo-50/70 p-4 rounded-2xl border border-indigo-100 flex items-start gap-3">
                    <div className="p-2 bg-indigo-600 text-white rounded-xl flex-shrink-0">
                      <ShieldCheck size={20} />
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="text-sm font-bold text-indigo-950">房東身分真實性查核</h4>
                      <p className="text-xs text-indigo-800 leading-relaxed">
                        為維護全平台租賃安全與租客權益，房東身分需填寫基本查核資料，送出後由平台管理員確認後方可開通完整房東權限。
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleSubmitLandlordApplication} className="space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          房東姓名 / 負責人姓名 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={onboardingUser?.name || currentTenantName || currentUser?.user_metadata?.name || myLandlordAccount?.name || ''}
                          disabled
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-600 font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          聯絡電話號碼 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={onboardingUser?.phone || activeUserPhone || currentTenantPhone || ''}
                          disabled
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2 text-sm text-slate-600 font-semibold"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        身分證字號 / 居留證號 / 統一編號 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="例如：A123456789 或 公司統編 8 碼"
                        value={landlordAppForm.idNumber}
                        onChange={(e) => setLandlordAppForm(prev => ({ ...prev, idNumber: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white font-semibold uppercase"
                        required
                      />
                      <span className="text-[11px] text-slate-400 mt-0.5 block">
                        供平台總管理員查核身分真實性與租屋合規，資料採高規格嚴密保護。
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        通訊聯絡地址 / 戶籍地址 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="例如：台北市中正區忠孝東路一段 100 號 5 樓"
                        value={landlordAppForm.contactAddress}
                        onChange={(e) => setLandlordAppForm(prev => ({ ...prev, contactAddress: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white font-semibold"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          公司抬頭 / 物業品牌名稱 (選填)
                        </label>
                        <input
                          type="text"
                          placeholder="例如：安居物業管理 或 個人"
                          value={landlordAppForm.companyName}
                          onChange={(e) => setLandlordAppForm(prev => ({ ...prev, companyName: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-indigo-500 focus:bg-white font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          預設收款銀行機構與帳號 (選填)
                        </label>
                        <input
                          type="text"
                          placeholder="例如：玉山銀行(808) 1234567890"
                          value={landlordAppForm.bankAccount}
                          onChange={(e) => setLandlordAppForm(prev => ({ ...prev, bankAccount: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-indigo-500 focus:bg-white font-semibold"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        補充說明 / 備註 (選填)
                      </label>
                      <textarea
                        rows="2"
                        placeholder="可填寫管理物業座落區域或額外說明..."
                        value={landlordAppForm.notes}
                        onChange={(e) => setLandlordAppForm(prev => ({ ...prev, notes: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-indigo-500 focus:bg-white"
                      />
                    </div>

                    <div className="pt-3 flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (lineFirstLoginUser) {
                            setActiveModal('lineFirstLogin');
                          } else {
                            setActiveModal('roleOnboarding');
                          }
                        }}
                        className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors focus:outline-none cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <ArrowLeft size={16} />
                        <span>返回上一步</span>
                      </button>
                      <button
                        type="submit"
                        disabled={landlordAppLoading}
                        className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm shadow-md transition-all focus:outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        <ShieldCheck size={16} />
                        <span>{landlordAppLoading ? '申請送出中...' : '確認送出申請 (等待管理員開通)'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* First-Time LINE Login Profile Completion Modal */}
              {activeModal === 'lineFirstLogin' && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 p-4 sm:p-5 rounded-2xl border border-emerald-200 text-center space-y-2">
                    <div className="w-12 h-12 bg-[#06C755] text-white rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                      <svg className="w-7 h-7 fill-current" viewBox="0 0 24 24">
                        <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.122.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.646 1.281-.54 6.911-4.069 9.428-6.967 1.739-1.907 2.572-3.843 2.572-5.993z" />
                      </svg>
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-emerald-950">歡迎首次使用 LINE 登入！</h3>
                    <p className="text-xs text-emerald-800 leading-relaxed max-w-sm mx-auto">
                      請填寫您的姓名、聯絡電話並選擇您的系統身分，以開通專屬功能。
                    </p>
                  </div>

                  <form onSubmit={handleSaveLineFirstLogin} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          真實姓名 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="請輸入姓名（例如：林小美）"
                          value={lineFirstLoginName}
                          onChange={(e) => setLineFirstLoginName(e.target.value)}
                          autoFocus
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white font-semibold transition-colors"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          聯絡電話 / 手機號碼 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="tel"
                          placeholder="請輸入手機號碼（例如：0912345678）"
                          value={lineFirstLoginPhone}
                          onChange={(e) => setLineFirstLoginPhone(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white font-semibold transition-colors"
                          required
                        />
                      </div>
                    </div>

                    {/* Role Selection Option Cards */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2">
                        請選擇您的會員身分 <span className="text-rose-500">*</span>
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Tenant Card */}
                        <div
                          onClick={() => setLineFirstLoginRole('tenant')}
                          className={`border-2 rounded-2xl p-3.5 sm:p-4 cursor-pointer transition-all flex flex-col justify-between ${
                            lineFirstLoginRole === 'tenant'
                              ? 'border-emerald-500 bg-emerald-50/70 shadow-xs ring-2 ring-emerald-400/20'
                              : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className={`p-2 rounded-xl ${lineFirstLoginRole === 'tenant' ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                              <Home size={18} />
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                              ⚡ 免審核・即開即用
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                              <span>我是房客 (Tenant)</span>
                              {lineFirstLoginRole === 'tenant' && <CheckCircle size={14} className="text-emerald-600" />}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                              查閱租金帳單、線上合約明細與回報繳費。
                            </p>
                          </div>
                        </div>

                        {/* Landlord Card */}
                        <div
                          onClick={() => setLineFirstLoginRole('landlord')}
                          className={`border-2 rounded-2xl p-3.5 sm:p-4 cursor-pointer transition-all flex flex-col justify-between ${
                            lineFirstLoginRole === 'landlord'
                              ? 'border-indigo-500 bg-indigo-50/70 shadow-xs ring-2 ring-indigo-400/20'
                              : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className={`p-2 rounded-xl ${lineFirstLoginRole === 'landlord' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                              <Building size={18} />
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                              🛡️ 管理員審核
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                              <span>我是房東 (Landlord)</span>
                              {lineFirstLoginRole === 'landlord' && <CheckCircle size={14} className="text-indigo-600" />}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1 leading-normal">
                              管理房間房號、自動出帳、收款入帳審核。
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* When Landlord is selected, expand landlord verification fields directly */}
                    {lineFirstLoginRole === 'landlord' && (
                      <div className="space-y-3 p-4 bg-indigo-50/60 rounded-2xl border border-indigo-100 animate-in fade-in duration-200">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 pb-1 border-b border-indigo-100">
                          <ShieldCheck size={16} className="text-indigo-600" />
                          <span>請填寫房東身分查核資料</span>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            身分證字號 / 居留證號 / 統一編號 <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="例如：A123456789 或 公司統編 8 碼"
                            value={landlordAppForm.idNumber}
                            onChange={(e) => setLandlordAppForm(prev => ({ ...prev, idNumber: e.target.value }))}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-indigo-500 font-semibold uppercase"
                            required
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            通訊聯絡地址 / 戶籍地址 <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            placeholder="例如：台北市中正區忠孝東路一段 100 號 5 樓"
                            value={landlordAppForm.contactAddress}
                            onChange={(e) => setLandlordAppForm(prev => ({ ...prev, contactAddress: e.target.value }))}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-sm outline-none focus:border-indigo-500 font-semibold"
                            required
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                              公司抬頭 / 物業名稱 (選填)
                            </label>
                            <input
                              type="text"
                              placeholder="例如：安居物業管理 或 個人"
                              value={landlordAppForm.companyName}
                              onChange={(e) => setLandlordAppForm(prev => ({ ...prev, companyName: e.target.value }))}
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 font-semibold"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                              預設收款機構與帳號 (選填)
                            </label>
                            <input
                              type="text"
                              placeholder="例如：玉山銀行 1234567890"
                              value={landlordAppForm.bankAccount}
                              onChange={(e) => setLandlordAppForm(prev => ({ ...prev, bankAccount: e.target.value }))}
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 font-semibold"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            補充說明 / 備註 (選填)
                          </label>
                          <textarea
                            rows="2"
                            placeholder="可填寫管理物業座落區域或額外說明..."
                            value={landlordAppForm.notes}
                            onChange={(e) => setLandlordAppForm(prev => ({ ...prev, notes: e.target.value }))}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-indigo-500 font-medium"
                          />
                        </div>
                      </div>
                    )}

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={lineFirstLoginLoading}
                        className={`w-full py-3 text-white font-bold rounded-xl shadow-md transition-all text-sm focus:outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                          lineFirstLoginRole === 'tenant'
                            ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                            : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                        }`}
                      >
                        {lineFirstLoginRole === 'tenant' ? (
                          <>
                            <CheckCircle size={16} />
                            <span>{lineFirstLoginLoading ? '帳號開通中...' : '🎉 確認送出・開通房客會員專區'}</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={16} />
                            <span>{lineFirstLoginLoading ? '申請送出中...' : '🏢 確認送出房東身分申請 (等待管理員開通)'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* LINE Account One-Click Quick Login Modal */}
              {activeModal === 'lineLogin' && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-200 text-center space-y-2">
                    <div className="w-12 h-12 bg-[#06C755] text-white rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                      <svg className="w-7 h-7 fill-current" viewBox="0 0 24 24">
                        <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.122.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.646 1.281-.54 6.911-4.069 9.428-6.967 1.739-1.907 2.572-3.843 2.572-5.993z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-emerald-950">LINE 帳號快速登入</h3>
                    <p className="text-xs text-emerald-800 leading-relaxed max-w-sm mx-auto">
                      您可以透過已綁定的 LINE 帳號、LINE 官方驗證碼或已綁定之手機號碼一鍵完成快速身分驗證。
                    </p>
                  </div>

                  <form onSubmit={handleExecuteLineLogin} className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        請輸入您的 LINE 綁定驗證碼 或 已綁定手機號碼：
                      </label>
                      <input
                        type="text"
                        placeholder="例如：0912345678 或 6 碼驗證碼"
                        value={lineLoginInput}
                        onChange={(e) => setLineLoginInput(e.target.value)}
                        autoFocus
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:bg-white font-semibold"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={lineLoginLoading}
                      className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white font-bold py-3 rounded-xl shadow-xs transition-colors text-sm focus:outline-none flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>{lineLoginLoading ? '驗證登入中...' : '確認並以 LINE 快速登入'}</span>
                    </button>
                  </form>

                  <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 flex items-center justify-between text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={16} className="text-[#06C755]" />
                      <span>尚未加入系統 LINE 官方帳號？</span>
                    </div>
                    <a
                      href="https://line.me/R/ti/p/@888mppnm"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1 bg-white hover:bg-slate-100 text-emerald-700 font-bold rounded-lg border border-slate-200 shadow-2xs transition-colors"
                    >
                      加入 @888mppnm
                    </a>
                  </div>

                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 text-slate-500 hover:text-slate-800 text-xs font-semibold"
                    >
                      返回密碼登入
                    </button>
                  </div>
                </div>
              )}
              {activeModal === 'lineBinding' && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-200 text-center space-y-2">
                    <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto shadow-xs">
                      <MessageSquare size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-emerald-950">LINE 官方帳號安全綁定</h3>
                    <p className="text-xs text-emerald-800 leading-relaxed max-w-sm mx-auto">
                      為確保帳號安全，系統已產生一組 <b>10 分鐘有效</b> 的一次性驗證碼。
                    </p>
                  </div>

                  {lineBindingTokenData && (
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 text-center space-y-3">
                      <span className="text-xs text-slate-500 font-bold block">您的一次性專屬綁定代碼：</span>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-3xl font-black font-mono tracking-widest text-indigo-600 bg-white px-5 py-2 rounded-xl border border-indigo-200 shadow-xs">
                          {lineBindingTokenData.token}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(`綁定 ${lineBindingTokenData.token}`);
                            showToast('已複製綁定指令「綁定 ' + lineBindingTokenData.token + '」！', 'success');
                          }}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 p-2.5 rounded-xl border border-indigo-200 transition-colors"
                          title="複製指令"
                        >
                          <Copy size={18} />
                        </button>
                      </div>
                      <p className="text-[11px] text-amber-700 font-semibold bg-amber-50 py-1.5 px-3 rounded-lg border border-amber-200 inline-block">
                        ⏰ 有效期限：10 分鐘（經由 LINE 輸入使用後立即銷毀失效）
                      </p>
                    </div>
                  )}

                  <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-2 text-xs text-slate-700">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <CheckCircle size={14} className="text-emerald-600" />
                      <span>綁定操作 3 步驟：</span>
                    </h4>
                    <ol className="list-decimal pl-5 space-y-1 text-slate-600 leading-relaxed">
                      <li>開啟手機 LINE 並進入系統官方帳號對話視窗。</li>
                      <li>在對話框中輸入並送出：<code className="bg-slate-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded font-mono">綁定 {lineBindingTokenData?.token || '代碼'}</code></li>
                      <li>系統 Edge Function 驗證成功後，即可隨時在 LINE 查詢帳單與接收繳費提醒！</li>
                    </ol>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold transition-colors focus:outline-none"
                    >
                      我已了解，關閉視窗
                    </button>
                  </div>
                </div>
              )}
              {(activeModal === 'tenantReportPayment' || activeModal === 'tenantPay') && (
                <form onSubmit={handleTenantSubmitReport} className="space-y-4">
                  {/* Bill Summary Banner */}
                  <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white p-5 rounded-2xl shadow-sm flex justify-between items-center">
                    <div>
                      <span className="text-xs text-indigo-300 font-medium block">
                        {(() => {
                          const cat = getCategoryInfo(tenantReportCategory);
                          return `${cat.icon} ${cat.label}${tenantReportTitle ? ` (${tenantReportTitle})` : ''}`;
                        })()}
                      </span>
                      <h3 className="text-3xl font-black text-white mt-1 font-mono tracking-tight">
                        NT$ {parseInt(tenantReportAmount || 0, 10).toLocaleString()}
                      </h3>
                      <p className="text-xs text-indigo-200 mt-1">
                        回報繳費日期：{tenantReportDate || new Date().toISOString().split('T')[0]}
                      </p>
                    </div>
                    <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-xs text-indigo-200">
                      <Wallet size={32} />
                    </div>
                  </div>

                  {/* Category & Amount Detail Fields */}
                  <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                    {tenantReportTargetBill && (
                      <div className="flex items-center justify-between text-xs text-amber-900 bg-amber-50/90 px-3 py-1.5 rounded-xl border border-amber-200 font-medium">
                        <span className="flex items-center gap-1.5">
                          <Lock size={13} className="text-amber-700" />
                          <span>帳單資訊由房東開立，此處為鎖定唯讀項目</span>
                        </span>
                        <span className="text-[10px] text-amber-800 font-bold bg-amber-100 px-1.5 py-0.5 rounded border border-amber-300">
                          不可更改
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                          <span>費用類別</span>
                          {tenantReportTargetBill && <Lock size={11} className="text-slate-400" />}
                        </label>
                        {tenantReportTargetBill ? (
                          <div className="w-full border border-slate-200 bg-slate-100/90 text-slate-700 rounded-xl px-3.5 py-2 text-xs font-bold flex items-center gap-1.5 cursor-not-allowed">
                            <span>{getCategoryInfo(tenantReportCategory).icon}</span>
                            <span>{getCategoryInfo(tenantReportCategory).label}</span>
                          </div>
                        ) : (
                          <select
                            value={tenantReportCategory}
                            onChange={(e) => setTenantReportCategory(e.target.value)}
                            className="w-full border border-slate-200 bg-white rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-indigo-600"
                          >
                            <option value="rent">🏠 租金</option>
                            <option value="deposit">🔒 押金保證金</option>
                            <option value="utilities">⚡ 水電費</option>
                            <option value="management">🏢 管理費</option>
                            <option value="other">📦 其他</option>
                          </select>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                          <span>已繳金額 (NT$)</span>
                          {tenantReportTargetBill && <Lock size={11} className="text-slate-400" />}
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={tenantReportAmount}
                          onChange={(e) => setTenantReportAmount(e.target.value)}
                          placeholder="請輸入金額"
                          readOnly={!!tenantReportTargetBill}
                          disabled={!!tenantReportTargetBill}
                          className={`w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold outline-none font-mono ${tenantReportTargetBill
                            ? 'bg-slate-100/90 text-slate-700 cursor-not-allowed'
                            : 'bg-white text-slate-900 focus:border-indigo-600'
                            }`}
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                          <span>項目名稱 / 期別</span>
                          {tenantReportTargetBill && <Lock size={11} className="text-slate-400" />}
                        </label>
                        <input
                          type="text"
                          placeholder="例如：8月份租金"
                          value={tenantReportTitle}
                          onChange={(e) => setTenantReportTitle(e.target.value)}
                          readOnly={!!tenantReportTargetBill}
                          disabled={!!tenantReportTargetBill}
                          className={`w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs outline-none ${tenantReportTargetBill
                            ? 'bg-slate-100/90 text-slate-700 font-semibold cursor-not-allowed'
                            : 'bg-white text-slate-900 focus:border-indigo-600'
                            }`}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                          <span>實際繳納日期</span>
                          {tenantReportTargetBill && <Lock size={11} className="text-slate-400" />}
                        </label>
                        <input
                          type="date"
                          value={tenantReportDate}
                          onChange={(e) => setTenantReportDate(e.target.value)}
                          readOnly={!!tenantReportTargetBill}
                          disabled={!!tenantReportTargetBill}
                          className={`w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-semibold outline-none ${tenantReportTargetBill
                            ? 'bg-slate-100/90 text-slate-700 cursor-not-allowed'
                            : 'bg-white text-slate-900 focus:border-indigo-600'
                            }`}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Payment Channel Tabs (Bank Transfer & Cash) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-2">請選擇繳費管道方式：</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setTenantReportMethod('bank')}
                        className={`p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center space-y-1 ${tenantReportMethod === 'bank'
                          ? 'bg-indigo-50 border-indigo-600 text-indigo-900 font-bold shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                      >
                        <Building size={20} className={tenantReportMethod === 'bank' ? 'text-indigo-600' : 'text-slate-400'} />
                        <span className="text-sm font-bold">銀行轉帳</span>
                        <span className="text-[11px] font-normal text-slate-500">ATM / 網路網銀轉帳</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTenantReportMethod('cash')}
                        className={`p-3.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center space-y-1 ${tenantReportMethod === 'cash'
                          ? 'bg-emerald-50 border-emerald-600 text-emerald-900 font-bold shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                      >
                        <DollarSign size={20} className={tenantReportMethod === 'cash' ? 'text-emerald-600' : 'text-slate-400'} />
                        <span className="text-sm font-bold">現金交付</span>
                        <span className="text-[11px] font-normal text-slate-500">現場繳交 / 現金面交</span>
                      </button>
                    </div>
                  </div>

                  {/* Channel 1: Bank Transfer Details */}
                  {tenantReportMethod === 'bank' && (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                      {(landlordBankInfo?.bankAccount || landlordBankInfo?.bankName) ? (
                        <div className="space-y-1.5 text-xs text-slate-700">
                          {landlordBankInfo.bankName && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">收款銀行：</span>
                              <span className="font-bold text-slate-800">{landlordBankInfo.bankName}</span>
                            </div>
                          )}
                          {landlordBankInfo.bankAccount && (
                            <div className="flex justify-between items-center">
                              <span className="text-slate-500">收款帳號：</span>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 text-xs">
                                  {landlordBankInfo.bankAccount}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard?.writeText(landlordBankInfo.bankAccount.replace(/\D/g, ''));
                                    showToast('已複製銀行帳號至剪貼簿！', 'success');
                                  }}
                                  className="text-indigo-600 hover:text-indigo-800 p-1"
                                  title="複製帳號"
                                >
                                  <Copy size={14} />
                                </button>
                              </div>
                            </div>
                          )}
                          {landlordBankInfo.accountName && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">戶名：</span>
                              <span className="font-semibold text-slate-800">{landlordBankInfo.accountName}</span>
                            </div>
                          )}
                          {landlordBankInfo.note && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">轉帳備註：</span>
                              <span className="text-slate-600">{landlordBankInfo.note}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200/70 text-xs text-amber-900 space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-amber-800">
                            <AlertCircle size={14} />
                            <span>房東目前尚未設定收款帳戶資訊</span>
                          </div>
                          <p className="text-[11px] text-amber-700 leading-relaxed">
                            若您已與房東確認線下轉帳帳號並完成匯款，請直接於下方填寫您的「匯款帳號末五碼」以供核帳。
                          </p>
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-200">
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          請輸入您的匯款帳號末五碼 (供房東對帳)：
                        </label>
                        <input
                          type="text"
                          maxLength="5"
                          placeholder="例如：88291"
                          value={tenantReportTransferLast5}
                          onChange={(e) => setTenantReportTransferLast5(e.target.value.replace(/\D/g, ''))}
                          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm font-mono font-bold outline-none focus:border-indigo-600 bg-white"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* Channel 2: Cash Payment Instructions */}
                  {tenantReportMethod === 'cash' && (
                    <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200 space-y-2 text-center">
                      <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-xs">
                        <DollarSign size={20} />
                      </div>
                      <h4 className="text-sm font-bold text-emerald-950">現金交付繳納指引</h4>
                      <p className="text-xs text-emerald-800 leading-relaxed max-w-sm mx-auto">
                        請於約定時間將現金款項親自交付房東收取。送出繳費回報後，房東點交確認收到即可核准入帳並開立電子收據憑單。
                      </p>
                    </div>
                  )}

                  {/* Additional Note */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">備註說明 (選填)</label>
                    <textarea
                      rows="2"
                      placeholder="例如：已於今日中午透過網銀轉帳..."
                      value={tenantReportNote}
                      onChange={(e) => setTenantReportNote(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3.5 py-2 text-xs outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="pt-2 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors focus:outline-none"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors focus:outline-none shadow-md flex items-center space-x-2"
                    >
                      <Send size={16} />
                      <span>確認送出繳費回報 (NT$ {parseInt(tenantReportAmount || 0, 10).toLocaleString()})</span>
                    </button>
                  </div>
                </form>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Pending & Rejected Landlord Notice Dialog */}
      {pendingLandlordNotice.open && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 p-6 sm:p-8 text-center space-y-5">
            {pendingLandlordNotice.status === 'rejected' ? (
              <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner border border-rose-200">
                <XCircle size={32} />
              </div>
            ) : (
              <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-3xl flex items-center justify-center mx-auto shadow-inner border border-amber-200">
                <Clock size={32} />
              </div>
            )}

            <div className="space-y-2">
              {pendingLandlordNotice.status === 'rejected' ? (
                <>
                  <span className="inline-block bg-rose-100 text-rose-800 text-xs font-bold px-3 py-1 rounded-full border border-rose-300">
                    ❌ 房東身分審核未通過 (Application Rejected)
                  </span>
                  <h3 className="text-xl font-bold text-slate-900">很抱歉，您的房東身分審核未獲通過</h3>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
                    可能因身分證字號／統編有誤、通訊地址不完整或資料需要補充。您可以重新修正資料後再次送審，或先切換為房客身分立即使用系統。
                  </p>
                </>
              ) : (
                <>
                  <span className="inline-block bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full border border-amber-300">
                    ⏳ 房東身分審核中 (Pending Approval)
                  </span>
                  <h3 className="text-xl font-bold text-slate-800">您的房東帳號申請已送出！</h3>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
                    為了保障全平台租屋真實性與租客權益，管理員將於 24 小時內確認您的身分資訊。開通後即可登入使用完整房東管理系統。
                  </p>
                </>
              )}
            </div>

            {pendingLandlordNotice.data && (
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-left text-xs space-y-2 text-slate-600 font-medium">
                <div className="flex justify-between">
                  <span className="text-slate-400">申請人姓名：</span>
                  <span className="font-bold text-slate-800">{pendingLandlordNotice.data.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">聯絡電話：</span>
                  <span className="font-semibold text-slate-800">{pendingLandlordNotice.data.phone}</span>
                </div>
                {pendingLandlordNotice.data.idNumber && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">身分證/統編：</span>
                    <span className="font-mono text-slate-800">{pendingLandlordNotice.data.idNumber}</span>
                  </div>
                )}
                {pendingLandlordNotice.data.contactAddress && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">通訊地址：</span>
                    <span className="font-medium text-slate-800 text-right truncate max-w-[200px]">{pendingLandlordNotice.data.contactAddress}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-slate-200/60 text-[11px] text-slate-400">
                  <span>送出時間：</span>
                  <span>{pendingLandlordNotice.data.submittedAt || '近期'}</span>
                </div>
              </div>
            )}

            {pendingLandlordNotice.status === 'rejected' ? (
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const d = pendingLandlordNotice.data;
                    let appDetails = null;
                    try {
                      if (d?.companyName && d.companyName.startsWith('{')) {
                        appDetails = JSON.parse(d.companyName);
                      }
                    } catch (e) {}

                    setOnboardingUser({
                      id: d?.id,
                      phone: d?.phone,
                      name: d?.name,
                    });
                    setLandlordAppForm({
                      companyName: appDetails?.companyName || (!d?.companyName?.startsWith('{') ? d?.companyName : '') || '',
                      idNumber: appDetails?.idNumber || d?.idNumber || '',
                      contactAddress: appDetails?.contactAddress || d?.contactAddress || '',
                      bankName: appDetails?.bankName || d?.bankName || '',
                      bankAccount: appDetails?.bankAccount || d?.bankAccount || '',
                      notes: appDetails?.notes || '',
                    });
                    setPendingLandlordNotice({ open: false, data: null });
                    setActiveModal('landlordApplication');
                  }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw size={15} />
                  <span>修改認證資料並重新送審</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const d = pendingLandlordNotice.data;
                    if (!d?.id) return;
                    try {
                      await completeTenantOnboarding({
                        userId: d.id,
                        phone: d.phone,
                        name: d.name,
                      });
                      setCurrentUser({
                        id: d.id,
                        phone: d.phone,
                        user_metadata: { role: 'tenant', name: d.name }
                      });
                      setRole('tenant');
                      setCurrentTenantPhone(d.phone);
                      setActiveTab('portal');
                      try {
                        localStorage.setItem('app_auth_session', JSON.stringify({
                          id: d.id,
                          phone: d.phone,
                          name: d.name,
                          role: 'tenant'
                        }));
                      } catch (e) {}
                      setPendingLandlordNotice({ open: false, data: null });
                      showToast('🎉 已成功切換為房客身分！歡迎使用租客專區。', 'success');
                      fetchSupabaseData();
                    } catch (err) {
                      showToast('切換身分失敗: ' + (err.message || '請重試'), 'error');
                    }
                  }}
                  className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl border border-emerald-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Home size={14} />
                  <span>先切換為房客身分 (免審核即開即用)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPendingLandlordNotice({ open: false, data: null });
                    setRole('portal');
                  }}
                  className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-semibold cursor-pointer"
                >
                  返回首頁
                </button>
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingLandlordNotice({ open: false, data: null });
                    setRole('portal');
                  }}
                  className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  我知道了，返回首頁
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
