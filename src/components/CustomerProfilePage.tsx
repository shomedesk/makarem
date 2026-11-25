import React, { useState, useEffect, useMemo } from 'react';
import {
  User,
  Phone,
  Hash,
  LogOut,
  ShoppingBag,
  Receipt,
  RefreshCw,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Calendar,
  AlertCircle,
  CheckCircle2,
  QrCode,
  ChevronDown,
  ChevronUp,
  Clock,
  BadgeCheck,
} from 'lucide-react';
import type {
  CreditSettlementRecord,
  CustomerProfile,
  Order,
  SalesPlayCustomerProfileResponse,
  SalesPlayCustomerReceipt,
} from '../types';
import {
  fetchCustomerOrders,
  fetchSalesPlayCustomerProfile,
} from '../services/customerService';
import {
  computeEnrichedCustomerBills,
  fetchCustomerSettlements,
  subscribeToCustomerSettlements,
} from '../services/creditSettlementService';
import {
  fetchCustomerLedgerDoc,
  loadLocalBillArchive,
  mergeArchivedAndDeltaReceipts,
  saveLocalBillArchive,
} from '../services/billArchiveService';
import { CreditPieChart } from './CreditPieChart';
import { QrBarcodeScannerModal } from './QrBarcodeScannerModal';

const BILLS_PAGE_SIZE = 30;

interface CustomerProfilePageProps {
  profile: CustomerProfile | null;
  onLogin: (identifier: string) => Promise<CustomerProfile>;
  onLogout: () => void;
  onBackToShop: () => void;
  onTrackOrder: (order: Order) => void;
  isAutoLoggingIn?: boolean;
  autoLoginError?: string | null;
  language: 'en' | 'ar';
}

export const CustomerProfilePage: React.FC<CustomerProfilePageProps> = ({
  profile,
  onLogin,
  onLogout,
  onBackToShop,
  onTrackOrder,
  isAutoLoggingIn = false,
  autoLoginError = null,
  language,
}) => {
  const isAr = language === 'ar';
  const [loginInput, setLoginInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const [activeTab, setActiveTab] = useState<'receipts' | 'orders'>('receipts');
  const [billFilter, setBillFilter] = useState<'all' | 'due' | 'settled_paid'>('all');
  const [visibleBillCount, setVisibleBillCount] = useState<number>(BILLS_PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(false);
  const [appOrders, setAppOrders] = useState<Order[]>([]);
  const [posProfile, setPosProfile] = useState<SalesPlayCustomerProfileResponse | null>(null);
  const [mergedReceipts, setMergedReceipts] = useState<SalesPlayCustomerReceipt[]>([]);
  const [settlements, setSettlements] = useState<CreditSettlementRecord[]>([]);
  const [expandedBills, setExpandedBills] = useState<Record<string, boolean>>({});

  const loadFullDashboard = async (cust: CustomerProfile, forcePosRefresh = false) => {
    setIsLoading(true);
    try {
      const localArchive = loadLocalBillArchive(cust.customerCode);

      // Hydrate immediately from device archive if available so UI renders without waiting
      if (localArchive?.receipts?.length) {
        setMergedReceipts(localArchive.receipts);
      }

      // 1-doc Firestore ledger read + customer online orders + initial settlements
      const [ordersList, ledgerDoc, initialSettlements] = await Promise.all([
        fetchCustomerOrders(cust.phone, cust.customerCode),
        fetchCustomerLedgerDoc(cust.customerCode),
        fetchCustomerSettlements(cust.customerCode),
      ]);

      setAppOrders(ordersList);
      setSettlements(initialSettlements);

      // Compute baseline archive state to ask SalesPlay ONLY for new + open DUE bills
      const preMerge = mergeArchivedAndDeltaReceipts({
        ledgerDoc,
        localArchive,
        deltaReceipts: [],
      });

      if (preMerge.mergedReceipts.length > 0) {
        setMergedReceipts(preMerge.mergedReceipts);
      }

      const spData = await fetchSalesPlayCustomerProfile(cust.phone, cust.customerCode, {
        since: preMerge.lastFinalizedAt || undefined,
        openBills: preMerge.openBillNumbers,
        force: forcePosRefresh,
      });

      if (spData) {
        setPosProfile(spData);
        const canonicalCode = spData.customer?.customerCode || cust.customerCode;

        // If canonical POS customerCode differs from profile code, merge its ledger/local archive too
        let canonicalLedger = ledgerDoc;
        let canonicalLocal = localArchive;
        if (canonicalCode && canonicalCode !== cust.customerCode) {
          const [extraLedger, extraSettlements] = await Promise.all([
            fetchCustomerLedgerDoc(canonicalCode),
            fetchCustomerSettlements(canonicalCode),
          ]);
          canonicalLedger = extraLedger || ledgerDoc;
          canonicalLocal = loadLocalBillArchive(canonicalCode) || localArchive;
          if (extraSettlements.length > 0) {
            setSettlements(extraSettlements);
          }
        }

        const postMerge = mergeArchivedAndDeltaReceipts({
          ledgerDoc: canonicalLedger,
          localArchive: canonicalLocal,
          deltaReceipts: spData.receipts || [],
        });

        setMergedReceipts(postMerge.mergedReceipts);
        saveLocalBillArchive(
          canonicalCode,
          postMerge.mergedReceipts,
          postMerge.lastFinalizedAt
        );
      }
    } catch (err) {
      console.warn('Error loading customer profile dashboard:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setVisibleBillCount(BILLS_PAGE_SIZE);
    if (profile) {
      loadFullDashboard(profile, false);
    } else {
      setAppOrders([]);
      setPosProfile(null);
      setMergedReceipts([]);
      setSettlements([]);
    }
  }, [profile?.id, profile?.customerCode, profile?.phone]);

  useEffect(() => {
    setVisibleBillCount(BILLS_PAGE_SIZE);
  }, [billFilter]);

  // Scoped real-time listener attached ONLY when this customer has open Due bills or recorded settlements
  const effectiveCustomerCode =
    posProfile?.customer?.customerCode || profile?.customerCode || '';
  const hasOpenCreditOrSettlements = useMemo(
    () =>
      settlements.length > 0 ||
      mergedReceipts.some(
        (r) =>
          Number(r.creditAmount || 0) > 0 &&
          String(r.receiptType || '').toUpperCase() !== 'REFUND'
      ),
    [mergedReceipts, settlements.length]
  );

  useEffect(() => {
    if (!effectiveCustomerCode || !hasOpenCreditOrSettlements) {
      return;
    }
    const unsub = subscribeToCustomerSettlements(effectiveCustomerCode, (records) => {
      setSettlements(records);
    });
    return () => unsub();
  }, [effectiveCustomerCode, hasOpenCreditOrSettlements]);

  const enrichedSummary = useMemo(() => {
    const limitVal = posProfile?.creditSummary?.creditLimit ?? null;
    return computeEnrichedCustomerBills(mergedReceipts, settlements, limitVal);
  }, [mergedReceipts, posProfile?.creditSummary?.creditLimit, settlements]);

  const displayedBills = useMemo(() => {
    if (billFilter === 'due') return enrichedSummary.dueBills;
    if (billFilter === 'settled_paid') return enrichedSummary.settledAndPaidBills;
    return enrichedSummary.bills;
  }, [billFilter, enrichedSummary]);

  const paginatedBills = useMemo(
    () => displayedBills.slice(0, visibleBillCount),
    [displayedBills, visibleBillCount]
  );
  const remainingBillCount = Math.max(0, displayedBills.length - paginatedBills.length);

  const executeLogin = async (rawValue: string) => {
    if (!rawValue.trim()) return;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await onLogin(rawValue.trim());
      setLoginInput('');
    } catch (err: any) {
      setLoginError(
        err?.message ||
          (isAr
            ? 'تعذر العثور على الحساب. أدخل رقم جوال صحيح أو رقم عميل مثل 001'
            : 'Could not sign in. Enter a valid Mobile Number or Customer ID (e.g. 001).')
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeLogin(loginInput);
  };

  const toggleBillItems = (billNo: string) => {
    setExpandedBills((prev) => ({ ...prev, [billNo]: !prev[billNo] }));
  };

  if (isAutoLoggingIn) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-3 bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-emerald-700" />
        <h2 className="font-extrabold text-base text-slate-900">
          {isAr ? 'جاري فتح حساب العميل...' : 'Opening Customer Profile...'}
        </h2>
        <p className="text-xs text-slate-500">
          {isAr
            ? 'يرجى الانتظار لحظة، جاري التحقق من بطاقة العائلة والفواتير.'
            : 'Verifying your Family Card ID and loading bills...'}
        </p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-md mx-auto py-8 space-y-6">
        <button
          type="button"
          onClick={onBackToShop}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          {isAr ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          <span>{isAr ? 'العودة للمتجر' : 'Back to Shop'}</span>
        </button>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 bg-slate-900 text-white space-y-2">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <User className="w-6 h-6" />
            </div>
            <h2 className="font-extrabold text-lg">
              {isAr ? 'بطاقة العائلة وحساب العميل' : 'Family Credit Card & Profile'}
            </h2>
            <p className="text-xs text-slate-300 font-['Cairo',sans-serif]">
              {isAr
                ? 'امسح رمز QR لبطاقة العائلة أو سجل الدخول برقم الجوال أو رقم العميل (مثل 001).'
                : 'Scan your Family Card QR/Barcode or sign in using your Mobile Number or Customer ID (e.g. 001).'}
            </p>
          </div>

          <div className="p-6 space-y-5">
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="w-full py-3.5 px-4 rounded-2xl bg-slate-900 hover:bg-black text-white font-extrabold text-sm transition flex items-center justify-center gap-2.5 cursor-pointer shadow-xs"
            >
              <QrCode className="w-5 h-5 text-emerald-400" />
              <span>
                {isAr ? 'مسح QR بطاقة العائلة / الباركود' : 'Scan Family Card QR / Barcode'}
              </span>
            </button>

            <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400">
              <div className="h-px bg-slate-200 flex-1" />
              <span>{isAr ? 'أو الدخول بالرقم' : 'OR SIGN IN MANUALLY'}</span>
              <div className="h-px bg-slate-200 flex-1" />
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'رقم الجوال أو رقم العميل *' : 'Mobile Number or Customer ID *'}
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute start-3.5 top-3.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={loginInput}
                    onChange={(e) => setLoginInput(e.target.value)}
                    placeholder={isAr ? 'مثال: 72095796 أو 001' : 'e.g. 72095796 or 001'}
                    className="w-full ps-10 pe-3 py-3 text-sm bg-slate-50 border border-slate-300 rounded-xl font-mono font-semibold focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30"
                  />
                </div>
              </div>

              {(loginError || autoLoginError) && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{loginError || autoLoginError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isLoggingIn && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{isAr ? 'دخول لحسابي' : 'Sign In to My Profile'}</span>
              </button>
            </form>
          </div>
        </div>

        <QrBarcodeScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScanResult={(decoded) => executeLogin(decoded)}
          language={language}
        />
      </div>
    );
  }

  const spCustomer = posProfile?.customer;
  const credit = posProfile?.creditSummary;
  const displayName =
    spCustomer?.name ||
    profile.name ||
    (isAr ? `عميل مكارم #${profile.customerCode}` : `Makarem Customer #${profile.customerCode}`);

  return (
    <div className="max-w-5xl mx-auto py-4 space-y-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToShop}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
        >
          {isAr ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
          <span>{isAr ? 'العودة للتسوق' : 'Back to Store'}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isAr ? 'مسح بطاقة أخرى' : 'Scan Card QR'}</span>
          </button>

          <button
            type="button"
            onClick={() => loadFullDashboard(profile, true)}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isAr ? 'تحديث البيانات' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 text-xs font-bold text-rose-700 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{isAr ? 'تسجيل خروج' : 'Logout'}</span>
          </button>
        </div>
      </div>

      {/* Customer Identity Banner */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 sm:p-7 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center text-white font-black text-xl font-mono shrink-0">
            #{spCustomer?.customerCode || profile.customerCode}
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-extrabold">{displayName}</h1>
              {posProfile?.matched && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[11px] font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{isAr ? 'بطاقة عائلة موثقة' : 'Verified Member'}</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 font-mono">
              <span className="inline-flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-emerald-400" />
                ID: {spCustomer?.customerCode || profile.customerCode}
              </span>
              {(spCustomer?.phone || profile.phone) && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  {spCustomer?.phone || profile.phone}
                </span>
              )}
              {spCustomer?.firstVisit && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  {isAr ? 'أول زيارة:' : 'Member since'} {spCustomer.firstVisit}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-5 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-800">
          <div>
            <div className="text-[11px] text-slate-400">
              {isAr ? 'حالة البطاقة' : 'Card Status'}
            </div>
            <div className="text-sm font-extrabold text-emerald-400 mt-0.5">
              {enrichedSummary.dueBills.length === 0
                ? isAr
                  ? 'ممتاز · لا مستحقات'
                  : 'All Clear'
                : isAr
                ? `${enrichedSummary.dueBills.length} فواتير مستحقة`
                : `${enrichedSummary.dueBills.length} Open Bill${
                    enrichedSummary.dueBills.length > 1 ? 's' : ''
                  }`}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">
              {isAr ? 'الزيارات' : 'Visits'}
            </div>
            <div className="text-lg font-black text-white font-mono tabular-nums">
              {spCustomer?.totalVisits ?? appOrders.length}
            </div>
          </div>
        </div>
      </div>

      {/* Credit Pie / Donut Chart synced 1:1 with live settlement state */}
      <CreditPieChart
        hasCreditLimit={Boolean(credit?.hasCreditLimit)}
        creditLimit={credit?.creditLimit ?? null}
        creditUsed={enrichedSummary.totalDueNow}
        remainingCredit={enrichedSummary.remainingCredit}
        dueBillsCount={enrichedSummary.dueBills.length}
        settledAmount={enrichedSummary.totalSettledViaAdmin}
        language={language}
      />

      {/* Purchase History Section with Separate Due Bills & Settlement Status */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 pt-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('receipts')}
              className={`pb-3 px-2 text-xs sm:text-sm font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'receipts'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {isAr
                ? `فواتير المتجر (${enrichedSummary.bills.length})`
                : `Store Bills (${enrichedSummary.bills.length})`}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`pb-3 px-2 text-xs sm:text-sm font-bold border-b-2 transition cursor-pointer ${
                activeTab === 'orders'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {isAr
                ? `الطلبات الإلكترونية (${appOrders.length})`
                : `Online Orders (${appOrders.length})`}
            </button>
          </div>

          {activeTab === 'receipts' && enrichedSummary.bills.length > 0 && (
            <div className="flex items-center gap-1.5 pb-2.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setBillFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                  billFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {isAr
                  ? `الكل (${enrichedSummary.bills.length})`
                  : `All (${enrichedSummary.bills.length})`}
              </button>

              <button
                type="button"
                onClick={() => setBillFilter('due')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  billFilter === 'due'
                    ? 'bg-amber-600 text-white'
                    : enrichedSummary.dueBills.length > 0
                    ? 'bg-amber-50 border border-amber-300 text-amber-900 hover:bg-amber-100'
                    : 'bg-white border border-slate-200 text-slate-500'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>
                  {isAr
                    ? `فواتير مستحقة (${enrichedSummary.dueBills.length})`
                    : `Due Bills (${enrichedSummary.dueBills.length})`}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setBillFilter('settled_paid')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  billFilter === 'settled_paid'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <BadgeCheck className="w-3 h-3" />
                <span>
                  {isAr
                    ? `مدفوعة / مسددة (${enrichedSummary.settledAndPaidBills.length})`
                    : `Paid / Settled (${enrichedSummary.settledAndPaidBills.length})`}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700" />
              <p className="text-xs">{isAr ? 'جاري تحميل السجل...' : 'Loading purchase history...'}</p>
            </div>
          ) : activeTab === 'receipts' ? (
            displayedBills.length === 0 ? (
              <div className="py-10 text-center text-slate-400 space-y-2">
                <Receipt className="w-9 h-9 mx-auto text-slate-300" />
                <p className="text-sm font-bold text-slate-700">
                  {billFilter === 'due'
                    ? isAr
                      ? 'ممتاز! لا توجد فواتير مستحقة غير مسددة'
                      : 'All clear! No unpaid due bills'
                    : isAr
                    ? 'لا توجد فواتير متجر حديثة'
                    : 'No store bills found'}
                </p>
                <p className="text-xs">
                  {billFilter === 'due'
                    ? isAr
                      ? 'تمت تسوية جميع فواتير الائتمان الخاصة بك.'
                      : 'All your credit bills have been settled.'
                    : isAr
                    ? 'ستظهر جميع فواتير الكاشير برقم الفاتورة والتاريخ والحالة هنا تلقائياً'
                    : 'All store bills with bill number, date, status, and amount appear here automatically.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm text-start">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase">
                      <th className="py-2.5 px-3 text-start">
                        {isAr ? 'رقم الفاتورة' : 'Bill No.'}
                      </th>
                      <th className="py-2.5 px-3 text-start">
                        {isAr ? 'التاريخ' : 'Date'}
                      </th>
                      <th className="py-2.5 px-3 text-start">
                        {isAr ? 'الحالة والدفع' : 'Status & Payment'}
                      </th>
                      <th className="py-2.5 px-3 text-end">
                        {isAr ? 'الإجمالي' : 'Total / Due'}
                      </th>
                      <th className="py-2.5 px-2 text-end">
                        {isAr ? 'التفاصيل' : 'Details'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedBills.map((rec) => {
                      const isExpanded = Boolean(expandedBills[rec.receiptNumber]);
                      const isDue = rec.billStatus === 'due' || rec.billStatus === 'partial';
                      const isSettled = rec.billStatus === 'settled';
                      const lastSettlement = rec.settlements[0];

                      return (
                        <React.Fragment key={rec.receiptNumber}>
                          <tr
                            className={`transition ${
                              isDue
                                ? 'bg-amber-50/55 hover:bg-amber-50/90 border-s-4 border-s-amber-500'
                                : isSettled
                                ? 'bg-emerald-50/35 hover:bg-emerald-50/60 border-s-4 border-s-emerald-600'
                                : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="py-3 px-3 font-mono font-extrabold text-slate-900 whitespace-nowrap">
                              <div>#{rec.receiptNumber}</div>
                            </td>
                            <td className="py-3 px-3 font-mono text-xs text-slate-600 whitespace-nowrap">
                              {rec.dateTime}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {rec.billStatus === 'due' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 border border-rose-200 text-rose-900 text-[11px] font-extrabold">
                                    <Clock className="w-3 h-3" />
                                    {isAr ? 'مستحق (آجل)' : 'DUE · UNPAID'}
                                  </span>
                                )}
                                {rec.billStatus === 'partial' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-extrabold">
                                    <Clock className="w-3 h-3" />
                                    {isAr ? 'مدفوع جزئياً' : 'PARTIAL DUE'}
                                  </span>
                                )}
                                {rec.billStatus === 'settled' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-900 text-[11px] font-extrabold">
                                    <CheckCircle2 className="w-3 h-3" />
                                    {isAr ? 'تمت التسوية' : 'SETTLED'}
                                  </span>
                                )}
                                {rec.billStatus === 'paid' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold">
                                    {rec.payments.map((p) => p.type).join(', ') || 'Paid'}
                                  </span>
                                )}
                                {rec.billStatus === 'refund' && (
                                  <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-900 text-[11px] font-bold">
                                    {isAr ? 'مرتجع' : 'REFUND'}
                                  </span>
                                )}

                                {isSettled && lastSettlement && (
                                  <span className="text-[11px] text-emerald-700 font-semibold">
                                    {isAr ? 'سُدد عبر' : 'via'}{' '}
                                    <span className="uppercase">{lastSettlement.settlementMethod}</span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-end font-mono tabular-nums whitespace-nowrap">
                              <div className="font-black text-slate-900">
                                {rec.totalMoney.toFixed(3)} OMR
                              </div>
                              {isDue && (
                                <div className="text-[11px] font-extrabold text-rose-700">
                                  {isAr ? 'متبقي:' : 'Due:'} {rec.remainingDue.toFixed(3)} OMR
                                </div>
                              )}
                              {isSettled && rec.originalCreditAmount > 0 && (
                                <div className="text-[10px] font-bold text-emerald-700">
                                  {isAr ? 'مدفوع بالكامل' : '0.000 Due'}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-2 text-end">
                              {(rec.items.length > 0 || rec.settlements.length > 0) && (
                                <button
                                  type="button"
                                  onClick={() => toggleBillItems(rec.receiptNumber)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer"
                                >
                                  <span>{rec.items.length}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={5} className="bg-slate-50/95 px-4 py-3 space-y-3">
                                {rec.items.length > 0 && (
                                  <div className="divide-y divide-slate-200/70">
                                    {rec.items.map((it, idx) => (
                                      <div
                                        key={idx}
                                        className="py-1.5 flex items-center justify-between text-xs"
                                      >
                                        <span className="text-slate-700 font-medium">
                                          {it.quantity} × {it.name}
                                        </span>
                                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                                          {it.total.toFixed(3)} OMR
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {rec.settlements.length > 0 && (
                                  <div className="pt-2 border-t border-emerald-200/80 space-y-1">
                                    <div className="text-[11px] font-extrabold text-emerald-800">
                                      {isAr ? 'سجل التسوية:' : 'Settlement Payments:'}
                                    </div>
                                    {rec.settlements.map((st) => (
                                      <div
                                        key={st.id}
                                        className="flex items-center justify-between text-[11px] text-emerald-900 bg-emerald-50 px-2.5 py-1.5 rounded-lg"
                                      >
                                        <span>
                                          {new Date(st.settledAt).toLocaleString()} ·{' '}
                                          <span className="uppercase font-bold">
                                            {st.settlementMethod}
                                          </span>
                                          {st.note ? ` (${st.note})` : ''}
                                        </span>
                                        <span className="font-mono font-extrabold tabular-nums">
                                          -{st.settledAmount.toFixed(3)} OMR
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>

                {remainingBillCount > 0 && (
                  <div className="pt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setVisibleBillCount((prev) => prev + BILLS_PAGE_SIZE)}
                      className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold transition cursor-pointer"
                    >
                      {isAr
                        ? `عرض فواتير أقدم (متبقي ${remainingBillCount})`
                        : `Load Older Bills (${remainingBillCount} more)`}
                    </button>
                  </div>
                )}
              </div>
            )
          ) : appOrders.length === 0 ? (
            <div className="py-10 text-center text-slate-400 space-y-2">
              <ShoppingBag className="w-9 h-9 mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-700">
                {isAr ? 'لا توجد طلبات إلكترونية سابقة' : 'No online orders yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {appOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm font-mono text-slate-900">
                        {ord.orderNumber}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                        {ord.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(ord.createdAt).toLocaleString()} •{' '}
                      {ord.items
                        .map((i) => `${i.quantity}x ${isAr ? i.arabicName || i.name : i.name}`)
                        .join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-extrabold text-sm text-emerald-800 font-mono tabular-nums">
                      {ord.totalAmount.toFixed(3)} OMR
                    </span>
                    <button
                      type="button"
                      onClick={() => onTrackOrder(ord)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer"
                    >
                      {isAr ? 'التفاصيل' : 'View'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <QrBarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanResult={(decoded) => executeLogin(decoded)}
        language={language}
      />
    </div>
  );
};
