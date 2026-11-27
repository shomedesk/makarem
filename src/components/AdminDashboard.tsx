import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  Package,
  CreditCard,
  Banknote,
  Smartphone,
  Volume2,
  VolumeX,
  RefreshCw,
  Search,
  Check,
  Phone,
  Zap,
  Plus,
  Loader2,
  Camera,
  Image as ImageIcon,
  Trash2,
  Hash,
  Languages,
  Printer,
  Bluetooth,
  BluetoothConnected,
  Users,
  Edit3,
  QrCode,
  X,
  UserPlus,
  Receipt,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  Tag,
  Video,
  Flame,
  Play,
  Eye,
  Pause,
} from 'lucide-react';
import QRCode from 'qrcode';
import type {
  AdminCustomerRecord,
  AdminInsightsResponse,
  CreditSettlementRecord,
  Order,
  OrderStatus,
  InventoryItem,
  SalesPlayShop,
  StoreOffer,
} from '../types';
import {
  updateOrderInFirestore,
  deleteSingleOrderInFirestore,
  clearAllOrdersInFirestore,
} from '../services/orderService';
import {
  fetchAllCustomersForAdmin,
  adminUpdateCustomerRecord,
  syncAllSalesPlayCustomersToFirestore,
  extractCustomerIdentifier,
  normalizePhoneNumber,
} from '../services/customerService';
import { fetchAllSettlementsForAdmin } from '../services/creditSettlementService';
import { playNewOrderChime } from '../utils/audio';
import {
  connectBluetooth58mmPrinter,
  connectSerial58mmPrinter,
  disconnectBluetoothPrinter,
  getConnectedPrinterName,
  isRawBtModeEnabled,
  isRunningInsideIframe,
  isWebBluetoothSupported,
  isWebSerialSupported,
  printOrderTo58mmPrinter,
  printTest58mmBluetoothSlip,
  setRawBtModeEnabled,
} from '../utils/thermalPrinter';
import { ImageUploadModal } from './ImageUploadModal';
import { QrBarcodeScannerModal } from './QrBarcodeScannerModal';
import { CustomerCreditSettlementModal } from './CustomerCreditSettlementModal';
import { IntroVideoModal } from './IntroVideoModal';

interface AdminDashboardProps {
  orders: Order[];
  catalog: InventoryItem[];
  onRefreshAndTranslateCatalog: () => Promise<{
    totalItems: number;
    translatedNew: number;
    translationError?: string;
    pushedToDevices?: boolean;
    customersSynced?: number;
    ledgersSynced?: number;
    ledgersWritten?: number;
    failedLedgers?: number;
    posConnected?: boolean;
    requiresAuth?: boolean;
    requiresVerifiedEmail?: boolean;
    syncError?: string;
  }>;
  onUpdateProductImage?: (productId: string, imageUrl: string) => void;
  autoPrintEnabled: boolean;
  onToggleAutoPrint: (enabled: boolean) => void;
  whatsappNumber: string;
  onSaveWhatsAppNumber: (phone: string) => Promise<string>;
  introVideoUrl: string;
  onSaveIntroVideo: (url: string) => Promise<{
    introVideoUrl: string;
    introVideoVersion: string;
  }>;
  offers: StoreOffer[];
  onSaveOffers: (offers: StoreOffer[]) => Promise<StoreOffer[]>;
  language: 'en' | 'ar';
  salesplayShop: SalesPlayShop | null;
  isFirebaseAdminSignedIn?: boolean;
  isAdminEmailVerified?: boolean;
  onReauthenticateAdmin?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  orders,
  catalog,
  onRefreshAndTranslateCatalog,
  onUpdateProductImage,
  autoPrintEnabled,
  onToggleAutoPrint,
  whatsappNumber,
  onSaveWhatsAppNumber,
  introVideoUrl,
  onSaveIntroVideo,
  offers,
  onSaveOffers,
  language,
  salesplayShop,
  isFirebaseAdminSignedIn = true,
  isAdminEmailVerified = true,
  onReauthenticateAdmin,
}) => {
  const isAr = language === 'ar';
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'customers' | 'reports' | 'inventory' | 'offers' | 'salesplay'>('orders');
  const [inventoryFilter, setInventoryFilter] = useState<'all' | 'low_stock' | 'out_of_stock' | 'no_arabic' | 'no_photo'>('all');
  const [customerFilter, setCustomerFilter] = useState<'all' | 'with_due' | 'near_limit' | 'synced'>('all');
  const [reportPeriod, setReportPeriod] = useState<'today' | 'd7' | 'd30' | 'd90'>('today');

  // Admin Store Insights & Credit Settlements state
  const [insights, setInsights] = useState<AdminInsightsResponse | null>(null);
  const [allSettlements, setAllSettlements] = useState<CreditSettlementRecord[]>([]);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);

  // Clear Old Orders confirmation state
  const [confirmClearOrders, setConfirmClearOrders] = useState(false);
  const [isClearingOrders, setIsClearingOrders] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);

  // Refresh & Translate Catalog state
  const [isRefreshingSync, setIsRefreshingSync] = useState(false);
  const [syncBannerMsg, setSyncBannerMsg] = useState<string | null>(null);
  const [syncBannerTone, setSyncBannerTone] = useState<'success' | 'warning' | 'error'>('success');
  const [autoPosCloudSync, setAutoPosCloudSync] = useState<boolean>(() => {
    try {
      return localStorage.getItem('makarem_auto_pos_cloud_sync_v1') === '1';
    } catch {
      return false;
    }
  });
  const [isAutoSyncTicking, setIsAutoSyncTicking] = useState(false);

  // 58mm Thermal Printer state
  const [printerName, setPrinterName] = useState<string | null>(() => getConnectedPrinterName());
  const [isConnectingPrinter, setIsConnectingPrinter] = useState(false);
  const [printerMsg, setPrinterMsg] = useState<string | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);

  // Store WhatsApp Support Number editor state
  const [waInput, setWaInput] = useState<string>(whatsappNumber);
  const [isSavingWa, setIsSavingWa] = useState(false);
  const [waStatusMsg, setWaStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setWaInput(whatsappNumber);
  }, [whatsappNumber]);

  // Customer Intro Video editor state
  const [videoInput, setVideoInput] = useState<string>(introVideoUrl);
  const [isSavingVideo, setIsSavingVideo] = useState(false);
  const [videoStatusMsg, setVideoStatusMsg] = useState<string | null>(null);
  const [showPreviewVideo, setShowPreviewVideo] = useState(false);

  useEffect(() => {
    setVideoInput(introVideoUrl);
  }, [introVideoUrl]);

  // Today's Offers manager state
  const [offerTitleEn, setOfferTitleEn] = useState('');
  const [offerTitleAr, setOfferTitleAr] = useState('');
  const [offerSubtitleEn, setOfferSubtitleEn] = useState('');
  const [offerSubtitleAr, setOfferSubtitleAr] = useState('');
  const [offerBadge, setOfferBadge] = useState('HOT DEAL');
  const [offerAccent, setOfferAccent] = useState<'emerald' | 'amber' | 'rose' | 'slate'>('rose');
  const [offerProductId, setOfferProductId] = useState('');
  const [offerProdSearch, setOfferProdSearch] = useState('');
  const [offerPriceInput, setOfferPriceInput] = useState('');
  const [offerCategoryFilter, setOfferCategoryFilter] = useState('');
  const [isSavingOffers, setIsSavingOffers] = useState(false);
  const [offerStatusMsg, setOfferStatusMsg] = useState<string | null>(null);

  // Customers Management Tab state
  const [customers, setCustomers] = useState<AdminCustomerRecord[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerScanner, setShowCustomerScanner] = useState(false);
  const [isSyncingCustomers, setIsSyncingCustomers] = useState(false);

  // Edit / Create Customer Modal state
  const [editingCustomer, setEditingCustomer] = useState<{
    firestoreId?: string;
    salesplayId?: string;
    customerCode: string;
    phone: string;
    name: string;
  } | null>(null);
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [customerEditError, setCustomerEditError] = useState<string | null>(null);

  // Family Credit Card QR Modal state
  const [qrCardCustomer, setQrCardCustomer] = useState<AdminCustomerRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Customer Credit & Settlement Modal state
  const [creditCustomerModal, setCreditCustomerModal] = useState<AdminCustomerRecord | null>(null);

  // Product Image Upload Modal state
  const [selectedProductForImage, setSelectedProductForImage] = useState<InventoryItem | null>(null);

  // Add Product to SalesPlay Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('Grocery');
  const [newProdStock, setNewProdStock] = useState('20');
  const [newProdCost, setNewProdCost] = useState('');
  const [isAddingProd, setIsAddingProd] = useState(false);
  const [addProdError, setAddProdError] = useState<string | null>(null);
  const [addProdSuccess, setAddProdSuccess] = useState<string | null>(null);

  const loadCustomersDirectory = async () => {
    setIsLoadingCustomers(true);
    try {
      const list = await fetchAllCustomersForAdmin();
      setCustomers(list);
    } catch (err) {
      console.warn('Failed to fetch customer directory:', err);
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  const loadAdminAnalytics = async (forceRefresh = false) => {
    setIsLoadingInsights(true);
    try {
      const [insightsRes, settlementsList, custList] = await Promise.all([
        fetch(`/api/salesplay/admin-insights${forceRefresh ? '?force=1' : ''}`, {
          cache: 'no-store',
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetchAllSettlementsForAdmin(),
        customers.length === 0 || forceRefresh
          ? fetchAllCustomersForAdmin()
          : Promise.resolve(customers),
      ]);
      if (insightsRes?.success) {
        setInsights(insightsRes as AdminInsightsResponse);
      }
      setAllSettlements(settlementsList);
      if (Array.isArray(custList) && custList.length > 0) {
        setCustomers(custList);
      }
    } catch (err) {
      console.warn('Failed to load admin analytics:', err);
    } finally {
      setIsLoadingInsights(false);
    }
  };

  useEffect(() => {
    loadAdminAnalytics(false);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('makarem_auto_pos_cloud_sync_v1', autoPosCloudSync ? '1' : '0');
    } catch {
      // ignore storage errors
    }
    if (!autoPosCloudSync) return;

    let cancelled = false;
    const runDeltaBridge = async () => {
      if (cancelled) return;
      setIsAutoSyncTicking(true);
      try {
        const res = await syncAllSalesPlayCustomersToFirestore({
          syncLedgers: true,
          forcePosRebuild: false,
          onlyChanged: true,
        });
        if (cancelled) return;
        if (!res.posConnected) {
          setAutoPosCloudSync(false);
          setSyncBannerTone('warning');
          setSyncBannerMsg(
            isAr
              ? 'المزامنة التلقائية متاحة فقط من رابط التطوير (Dev) أو الخادم المتصل بالكاشير.'
              : 'Auto-Sync requires the POS backend (open Dev Admin on your counter PC/tablet to push live SalesPlay bills).'
          );
          return;
        }
        if (res.requiresAuth || res.requiresVerifiedEmail) {
          setAutoPosCloudSync(false);
          setSyncBannerTone('error');
          setSyncBannerMsg(
            isAr
              ? 'تعذر حفظ فواتير العملاء: يرجى تسجيل الدخول بحساب Google المعتمد للإدارة.'
              : 'Auto-Sync blocked: Please sign in with your verified Admin Google Account to write customer bill ledgers.'
          );
          return;
        }
        if (res.failedLedgers > 0 || (res.errors && res.errors.length > 0)) {
          setSyncBannerTone('error');
          setSyncBannerMsg(
            `Auto-Sync error (${res.failedLedgers} failed): ${res.errors?.[0] || 'Check Firestore permissions'}`
          );
          return;
        }
        if (res.ledgersWritten > 0 || res.customersSynced > 0) {
          setSyncBannerTone('success');
          setSyncBannerMsg(
            isAr
              ? `مزامنة تلقائية: تم تحديث ${res.ledgersWritten} سجل عميل جديد/محذوف على الأجهزة المنشورة.`
              : `Auto-Sync updated ${res.ledgersWritten} changed customer ledger(s) & ${res.customersSynced} profile(s) to cloud.`
          );
          loadCustomersDirectory();
        }
      } catch (err: any) {
        if (!cancelled) {
          setSyncBannerTone('error');
          setSyncBannerMsg(`Auto-Sync error: ${err?.message || 'Unknown error'}`);
        }
      } finally {
        if (!cancelled) setIsAutoSyncTicking(false);
      }
    };

    runDeltaBridge();
    const timerId = window.setInterval(runDeltaBridge, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [autoPosCloudSync]);

  useEffect(() => {
    if (activeTab === 'customers' && customers.length === 0) {
      loadCustomersDirectory();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!qrCardCustomer) {
      setQrDataUrl('');
      return;
    }
    const profileUrl = `${window.location.origin}/profile/${encodeURIComponent(
      qrCardCustomer.customerCode
    )}`;
    QRCode.toDataURL(profileUrl, {
      width: 280,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [qrCardCustomer]);

  const filteredOrders = orders.filter((ord) => {
    const matchesStatus = filterStatus === 'all' || ord.status === filterStatus;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      ord.orderNumber.toLowerCase().includes(q) ||
      (ord.customerCode && ord.customerCode.toLowerCase().includes(q)) ||
      (ord.customerName && ord.customerName.toLowerCase().includes(q)) ||
      (ord.customerPhone && ord.customerPhone.includes(searchQuery));
    return matchesStatus && matchesSearch;
  });

  const settlementsByCustomerCode = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const st of allSettlements) {
      const code = String(st.customerCode || '').trim();
      if (!code) continue;
      map[code] = Math.round(((map[code] || 0) + Number(st.settledAmount || 0)) * 1000) / 1000;
    }
    return map;
  }, [allSettlements]);

  const enrichedCustomers = React.useMemo(() => {
    const stats = insights?.customerStats || {};
    return customers.map((cust) => {
      const stat =
        (cust.customerCode && stats[cust.customerCode]) ||
        (cust.salesplayId && stats[cust.salesplayId]) ||
        null;
      const posCredit = Number(stat?.posGrossCredit || 0);
      const adminSettled = Number(settlementsByCustomerCode[cust.customerCode] || 0);
      const netDue = Math.max(0, Math.round((posCredit - Math.min(posCredit, adminSettled)) * 1000) / 1000);
      const limitPct =
        cust.creditLimit !== null && cust.creditLimit > 0
          ? Math.min(100, Math.round((netDue / cust.creditLimit) * 1000) / 10)
          : 0;
      const effectiveSpent = Math.max(Number(cust.totalSpent || 0), Number(stat?.spent90d || 0));
      return {
        ...cust,
        netDue,
        posGrossCredit: posCredit,
        adminSettled,
        dueBillsCount: stat?.dueBillsCount || 0,
        spent90d: Number(stat?.spent90d || 0),
        effectiveSpent,
        lastPurchaseDate: stat?.lastPurchaseDate || '',
        limitPct,
      };
    });
  }, [customers, insights?.customerStats, settlementsByCustomerCode]);

  const totalStoreOutstandingDue = React.useMemo(
    () =>
      Math.round(
        enrichedCustomers.reduce((s, c) => s + c.netDue, 0) * 1000
      ) / 1000,
    [enrichedCustomers]
  );

  const debtorsCount = React.useMemo(
    () => enrichedCustomers.filter((c) => c.netDue > 0.0005).length,
    [enrichedCustomers]
  );

  const totalAdminSettlementsCollected = React.useMemo(
    () =>
      Math.round(
        allSettlements.reduce((s, st) => s + Number(st.settledAmount || 0), 0) * 1000
      ) / 1000,
    [allSettlements]
  );

  const filteredCatalog = catalog.filter((item) => {
    if (inventoryFilter === 'low_stock' && !(item.stockControl && item.stock > 0 && item.stock <= 5)) {
      return false;
    }
    if (inventoryFilter === 'out_of_stock' && !(item.stockControl && item.stock <= 0)) {
      return false;
    }
    if (inventoryFilter === 'no_arabic' && item.hasArabicTranslation) {
      return false;
    }
    if (inventoryFilter === 'no_photo' && item.imageUrl) {
      return false;
    }
    const q = inventorySearch.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      (item.arabicName && item.arabicName.toLowerCase().includes(q)) ||
      (item.productCode && item.productCode.toLowerCase().includes(q)) ||
      (item.barcode && item.barcode.includes(q))
    );
  });

  const filteredCustomers = enrichedCustomers
    .filter((c) => {
      if (customerFilter === 'with_due' && c.netDue <= 0.0005) return false;
      if (customerFilter === 'near_limit' && !(c.creditLimit !== null && c.creditLimit > 0 && c.limitPct >= 80)) {
        return false;
      }
      if (customerFilter === 'synced' && c.source !== 'both') return false;

      const rawQ = customerSearch.trim();
      if (!rawQ) return true;
      const extracted = extractCustomerIdentifier(rawQ).toLowerCase();
      const normQ = normalizePhoneNumber(extracted);
      return (
        c.customerCode.toLowerCase().includes(extracted) ||
        c.name.toLowerCase().includes(extracted) ||
        c.phone.toLowerCase().includes(extracted) ||
        (normQ.length >= 4 && c.phoneNormalized.includes(normQ))
      );
    })
    .sort((a, b) => {
      if (customerFilter === 'with_due' || customerFilter === 'near_limit') {
        return b.netDue - a.netDue;
      }
      return a.customerCode.localeCompare(b.customerCode, undefined, { numeric: true });
    });

  const pendingCount = orders.filter((o) => o.status === 'pending').length;
  const processingCount = orders.filter((o) => o.status === 'processing').length;
  const readyCount = orders.filter((o) => o.status === 'ready').length;
  const completedCount = orders.filter((o) => o.status === 'completed').length;
  const activeOrdersCount = pendingCount + processingCount + readyCount;
  const activeOrdersTotalOmr = orders
    .filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
    .reduce((s, o) => s + Number(o.totalAmount || 0), 0);
  const untranslatedCount = catalog.filter((i) => !i.hasArabicTranslation).length;
  const lowStockCount = catalog.filter((i) => i.stockControl && i.stock <= 5).length;

  const handleSetStatus = async (order: Order, newStatus: OrderStatus) => {
    setActionLoadingId(order.id);
    try {
      await updateOrderInFirestore(order.id, { status: newStatus });
    } catch (err) {
      console.error('Failed to update order status:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Mark billed inside SalesPlay POS counter directly (NEVER modifies SalesPlay inventory/receipts)
  const handleCompleteOrder = async (order: Order) => {
    setActionLoadingId(order.id);
    try {
      await updateOrderInFirestore(order.id, {
        status: 'completed',
        paymentStatus: 'received',
        salesplaySyncStatus: 'synced',
        salesplaySyncMessage: 'Billed inside SalesPlay POS counter',
      });
    } catch (err) {
      console.error('Failed to complete order:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteSingleOrder = async (orderId: string) => {
    setActionLoadingId(orderId);
    try {
      await deleteSingleOrderInFirestore(orderId);
    } catch (err) {
      console.error('Failed to delete order:', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleClearAllOrders = async () => {
    setIsClearingOrders(true);
    try {
      const deletedCount = await clearAllOrdersInFirestore();
      setClearNotice(
        isAr
          ? `تم تنظيف لوحة الطلبات وحذف ${deletedCount} طلب.`
          : `Dashboard cleaned: removed ${deletedCount} order(s).`
      );
      setConfirmClearOrders(false);
      setTimeout(() => setClearNotice(null), 4000);
    } catch (err: any) {
      setClearNotice(err?.message || 'Failed to clear orders');
    } finally {
      setIsClearingOrders(false);
    }
  };

  const handleRefreshAndTranslate = async () => {
    setIsRefreshingSync(true);
    setSyncBannerMsg(null);
    try {
      const res = await onRefreshAndTranslateCatalog();

      if (res.requiresAuth || res.requiresVerifiedEmail) {
        setSyncBannerTone('error');
        setSyncBannerMsg(
          isAr
            ? 'تعذر حفظ فواتير العملاء في السحابة: يرجى تسجيل الدخول بحساب Google المعتمد للإدارة.'
            : 'Customer bills NOT synced: Please re-sign in using your verified Admin Google Account (Firestore rules require verified email).'
        );
        return;
      }

      if (res.syncError || (res.failedLedgers && res.failedLedgers > 0)) {
        setSyncBannerTone('error');
        setSyncBannerMsg(
          isAr
            ? `خطأ في المزامنة (${res.failedLedgers || 1} فشل): ${res.syncError || 'فشل الحفظ'}`
            : `Sync error (${res.failedLedgers || 0} failed ledger(s)): ${res.syncError || 'Write failed'}`
        );
        return;
      }

      if (res.posConnected === false) {
        setSyncBannerTone('warning');
        setSyncBannerMsg(
          isAr
            ? 'تنبيه: هذا الرابط لا يتصل مباشرة بجهاز POS — تم تحديث الأصناف فقط. لمزامنة فواتير العملاء افتح لوحة الإدارة من رابط التطوير (Dev).'
            : 'POS backend is offline on this launched URL — customer POS bills were NOT updated. Open Dev Admin to push new/deleted SalesPlay bills to Firestore.'
        );
        await loadCustomersDirectory();
        return;
      }

      setSyncBannerTone('success');
      const ledgerPart =
        typeof res.ledgersSynced === 'number' && res.ledgersSynced > 0
          ? isAr
            ? ` + ${res.customersSynced || res.ledgersSynced} عميل و${res.ledgersSynced} سجل فواتير (${res.ledgersWritten ?? 0} محدّث)`
            : ` + ${res.customersSynced || res.ledgersSynced} customers & ${res.ledgersSynced} bill ledgers (${res.ledgersWritten ?? 0} updated)`
          : '';

      const pushNote = res.pushedToDevices
        ? isAr
          ? ` وتم إرسال التحديث${ledgerPart} لجميع أجهزة العملاء!`
          : ` & pushed${ledgerPart} to all customer devices!`
        : ledgerPart;

      if (res.translationError) {
        setSyncBannerMsg(
          isAr
            ? `تم تحديث ${res.totalItems} صنف${pushNote}. ملاحظة الترجمة: ${res.translationError}`
            : `Synced ${res.totalItems} items${pushNote}. Translation notice: ${res.translationError}`
        );
      } else if (res.translatedNew > 0) {
        setSyncBannerMsg(
          isAr
            ? `تم تحديث ${res.totalItems} صنف وترجمة ${res.translatedNew} صنف جديد${pushNote}`
            : `Synced ${res.totalItems} items & translated ${res.translatedNew} new item(s)${pushNote}`
        );
      } else {
        setSyncBannerMsg(
          isAr
            ? `تم تحديث ${res.totalItems} صنف من المتجر${pushNote}`
            : `Synced ${res.totalItems} live items${pushNote}`
        );
      }
      await loadCustomersDirectory();
    } finally {
      setIsRefreshingSync(false);
    }
  };

  const handleSaveWhatsAppSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWa(true);
    setWaStatusMsg(null);
    try {
      const saved = await onSaveWhatsAppNumber(waInput);
      setWaStatusMsg(
        isAr
          ? `تم حفظ رقم الواتساب (${saved}) لجميع العملاء بنجاح.`
          : `Saved store WhatsApp number (${saved}) for all customers.`
      );
      setTimeout(() => setWaStatusMsg(null), 4000);
    } catch (err: any) {
      setWaStatusMsg(err?.message || 'Could not save WhatsApp number');
    } finally {
      setIsSavingWa(false);
    }
  };

  const handleSaveIntroVideoSetting = async (e?: React.FormEvent, explicitUrl?: string) => {
    if (e) e.preventDefault();
    setIsSavingVideo(true);
    setVideoStatusMsg(null);
    try {
      const target = explicitUrl !== undefined ? explicitUrl : videoInput;
      const saved = await onSaveIntroVideo(target);
      setVideoInput(saved.introVideoUrl);
      setVideoStatusMsg(
        saved.introVideoUrl
          ? isAr
            ? 'تم حفظ الفيديو الترحيبي — سيظهر مرة واحدة فقط للعملاء عند الفتح القادم.'
            : 'Saved intro video! All customers will see it 1 time only on their next app open.'
          : isAr
          ? 'تم إيقاف الفيديو الترحيبي بنجاح.'
          : 'Intro video disabled.'
      );
      setTimeout(() => setVideoStatusMsg(null), 5000);
    } catch (err: any) {
      setVideoStatusMsg(err?.message || 'Could not save intro video URL');
    } finally {
      setIsSavingVideo(false);
    }
  };

  const handleAddOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerTitleEn.trim() && !offerTitleAr.trim()) return;
    setIsSavingOffers(true);
    setOfferStatusMsg(null);
    try {
      const parsedOfferPrice = offerPriceInput.trim()
        ? Math.round(parseFloat(offerPriceInput) * 1000) / 1000
        : undefined;

      const newOffer: StoreOffer = {
        id: `offer_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        titleEn: offerTitleEn.trim() || offerTitleAr.trim(),
        titleAr: offerTitleAr.trim() || offerTitleEn.trim(),
        subtitleEn: offerSubtitleEn.trim() || undefined,
        subtitleAr: offerSubtitleAr.trim() || undefined,
        badgeText: offerBadge.trim() || 'HOT DEAL',
        accentColor: offerAccent,
        productId: offerProductId || undefined,
        categoryFilter: !offerProductId && offerCategoryFilter ? offerCategoryFilter : undefined,
        offerPrice:
          parsedOfferPrice && !Number.isNaN(parsedOfferPrice) && parsedOfferPrice > 0
            ? parsedOfferPrice
            : undefined,
        active: true,
        createdAt: new Date().toISOString(),
      };

      await onSaveOffers([newOffer, ...offers]);
      setOfferTitleEn('');
      setOfferTitleAr('');
      setOfferSubtitleEn('');
      setOfferSubtitleAr('');
      setOfferProductId('');
      setOfferProdSearch('');
      setOfferPriceInput('');
      setOfferCategoryFilter('');
      setOfferStatusMsg(
        isAr ? 'تم نشر العرض على واجهة العملاء!' : 'Offer published to customer storefront!'
      );
      setTimeout(() => setOfferStatusMsg(null), 4000);
    } catch (err: any) {
      setOfferStatusMsg(err?.message || 'Could not save offer');
    } finally {
      setIsSavingOffers(false);
    }
  };

  const handleToggleOfferActive = async (offerId: string) => {
    setIsSavingOffers(true);
    try {
      const next = offers.map((o) => (o.id === offerId ? { ...o, active: !o.active } : o));
      await onSaveOffers(next);
    } finally {
      setIsSavingOffers(false);
    }
  };

  const handleDeleteOffer = async (offerId: string) => {
    setIsSavingOffers(true);
    try {
      const next = offers.filter((o) => o.id !== offerId);
      await onSaveOffers(next);
    } finally {
      setIsSavingOffers(false);
    }
  };

  const handleConnectPrinter = async () => {
    setIsConnectingPrinter(true);
    setPrinterMsg(null);
    try {
      const name = await connectBluetooth58mmPrinter();
      setPrinterName(name);
      setPrinterMsg(
        isAr ? `تم توصيل الطابعة: ${name}` : `Connected 58mm BLE Printer: ${name}`
      );
    } catch (err: any) {
      setPrinterMsg(err?.message || 'Could not connect Bluetooth printer');
    } finally {
      setIsConnectingPrinter(false);
    }
  };

  const handleConnectSerialPrinter = async () => {
    setIsConnectingPrinter(true);
    setPrinterMsg(null);
    try {
      const name = await connectSerial58mmPrinter(9600);
      setPrinterName(name);
      setPrinterMsg(
        isAr ? `تم توصيل الطابعة عبر المنفذ: ${name}` : `Connected 58mm Serial Printer: ${name}`
      );
    } catch (err: any) {
      setPrinterMsg(err?.message || 'Could not connect Serial/COM printer');
    } finally {
      setIsConnectingPrinter(false);
    }
  };

  const handleToggleRawBtMode = () => {
    const next = !isRawBtModeEnabled();
    setRawBtModeEnabled(next);
    setPrinterName(getConnectedPrinterName());
    setPrinterMsg(
      next
        ? isAr
          ? 'تم تفعيل وضع Android RawBT للطباعة عبر البلوتوث الكلاسيكي 58mm.'
          : 'Android RawBT mode enabled! Clicking Print will send ESC/POS straight to your paired 58mm Classic Bluetooth printer via RawBT.'
        : isAr
        ? 'تم إيقاف وضع Android RawBT'
        : 'Android RawBT mode turned off'
    );
  };

  const handleDisconnectPrinter = () => {
    disconnectBluetoothPrinter();
    setPrinterName(null);
    onToggleAutoPrint(false);
    setPrinterMsg(isAr ? 'تم فصل الطابعة' : 'Printer disconnected');
  };

  const handleTestPrinter = async () => {
    setPrinterMsg(null);
    try {
      const mode = await printTest58mmBluetoothSlip();
      setPrinterMsg(
        isAr ? `تم إرسال فاتورة تجريبية (${mode})` : `Sent test 58mm thermal slip via ${mode}`
      );
    } catch (err: any) {
      setPrinterMsg(err?.message || 'Test print failed');
    }
  };

  const handlePrintOrder = async (order: Order) => {
    setPrintingOrderId(order.id);
    setPrinterMsg(null);
    try {
      const mode = await printOrderTo58mmPrinter(order, language, true);
      if (mode === 'bluetooth') {
        setPrinterMsg(
          isAr
            ? `تمت طباعة الطلب ${order.orderNumber} على الطابعة الحرارية 58mm`
            : `Printed ${order.orderNumber} via Bluetooth 58mm printer`
        );
      }
    } catch (err: any) {
      setPrinterMsg(err?.message || 'Print error');
    } finally {
      setPrintingOrderId(null);
    }
  };

  const handleSaveCustomerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    setIsSavingCustomer(true);
    setCustomerEditError(null);
    try {
      const res = await adminUpdateCustomerRecord(editingCustomer);
      setClearNotice(
        isAr
          ? `تم تحديث بيانات العميل #${editingCustomer.customerCode} بنجاح${
              res.salesplaySynced ? ' (ومزامنته مع POS)' : ''
            }.`
          : `Updated Customer #${editingCustomer.customerCode}${
              res.salesplaySynced ? ' and synced with SalesPlay POS' : ' in Firestore'
            }.`
      );
      setEditingCustomer(null);
      await loadCustomersDirectory();
      setTimeout(() => setClearNotice(null), 4000);
    } catch (err: any) {
      setCustomerEditError(err?.message || 'Failed to update customer');
    } finally {
      setIsSavingCustomer(false);
    }
  };

  const handleSyncCustomersFromPos = async () => {
    setIsSyncingCustomers(true);
    try {
      const res = await syncAllSalesPlayCustomersToFirestore({ syncLedgers: true });
      await loadCustomersDirectory();
      if (!res.posConnected) {
        setSyncBannerTone('warning');
        setSyncBannerMsg(
          isAr
            ? 'تعذر الاتصال بخادم POS من هذا الرابط المنشور. يرجى الضغط على "مزامنة" من لوحة التحكم في رابط التطوير (Dev).'
            : 'POS backend is not reachable on this launched URL. Open Dev Admin to push customer bills to Firestore.'
        );
      } else if (res.requiresAuth || res.requiresVerifiedEmail) {
        setSyncBannerTone('error');
        setSyncBannerMsg(
          isAr
            ? `تم حفظ ${res.customersSynced} عميل — يرجى تسجيل الدخول بحساب Google المعتمد لحفظ سجلات الفواتير.`
            : `Saved ${res.customersSynced} profiles — please re-sign in with verified Admin Google Account to write bill ledgers.`
        );
      } else if (res.failedLedgers > 0 || (res.errors && res.errors.length > 0)) {
        setSyncBannerTone('error');
        setSyncBannerMsg(
          `Synced ${res.customersSynced} customers, but ${res.failedLedgers} ledger(s) failed: ${
            res.errors?.[0] || 'Firestore error'
          }`
        );
      } else {
        setSyncBannerTone('success');
        setSyncBannerMsg(
          isAr
            ? `تمت مزامنة ${res.customersSynced} عميل و ${res.ledgersTotal} سجل فواتير (${res.ledgersWritten} محدّث) إلى Firestore للعمل على الموقع المنشور.`
            : `Synced ${res.customersSynced} customers & ${res.ledgersTotal} bill ledgers (${res.ledgersWritten} updated) to Firestore for launched devices.`
        );
      }
    } finally {
      setIsSyncingCustomers(false);
    }
  };

  const handleAddProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim() || !newProdPrice) return;

    setIsAddingProd(true);
    setAddProdError(null);
    setAddProdSuccess(null);

    try {
      const priceNum = parseFloat(newProdPrice);
      const costNum = newProdCost
        ? parseFloat(newProdCost)
        : Math.round(priceNum * 0.7 * 100) / 100;
      const stockNum = newProdStock ? parseInt(newProdStock, 10) : 20;

      const res = await fetch('/api/salesplay/create-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProdName.trim(),
          category: newProdCategory.trim() || 'Grocery',
          price: priceNum,
          cost: costNum,
          stock: stockNum,
          unit: 'pcs',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setAddProdSuccess(
          isAr
            ? `تم إضافة "${newProdName}" بنجاح!`
            : `Product "${newProdName}" created successfully!`
        );
        setNewProdName('');
        setNewProdPrice('');
        setNewProdCost('');
        await onRefreshAndTranslateCatalog();
        setTimeout(() => {
          setShowAddModal(false);
          setAddProdSuccess(null);
        }, 1200);
      } else {
        setAddProdError(data.error ? JSON.stringify(data.error) : 'Failed to create product');
      }
    } catch (err) {
      setAddProdError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsAddingProd(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Executive Store KPI Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setActiveTab('reports')}
          className="text-start bg-white p-4 rounded-2xl border border-slate-200 hover:border-emerald-400 transition shadow-2xs cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {isAr ? 'مبيعات اليوم (POS)' : "Today's POS Sales"}
            </span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono tabular-nums">
            {(insights?.periods.today.salesTotal ?? 0).toFixed(3)}{' '}
            <span className="text-xs font-bold text-slate-500">OMR</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
            {insights
              ? `${insights.periods.today.billCount} ${isAr ? 'فاتورة' : 'bills'} · Cash ${insights.periods.today.cashTotal.toFixed(3)}`
              : isLoadingInsights
              ? isAr
                ? 'جاري التحميل...'
                : 'Loading POS data...'
              : '—'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('customers');
            setCustomerFilter('with_due');
          }}
          className="text-start bg-amber-50/60 p-4 rounded-2xl border border-amber-200 hover:border-amber-400 transition shadow-2xs cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">
              {isAr ? 'إجمالي المستحق للتحصيل' : 'Total Unpaid Credit'}
            </span>
            <Receipt className="w-4 h-4 text-amber-700" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-rose-700 mt-1 font-mono tabular-nums">
            {totalStoreOutstandingDue.toFixed(3)}{' '}
            <span className="text-xs font-bold text-rose-500">OMR</span>
          </div>
          <div className="text-[11px] text-amber-900 font-semibold mt-0.5">
            {isAr
              ? `${debtorsCount} عميل لديهم مستحقات`
              : `${debtorsCount} customer(s) with due balance`}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className="text-start bg-white p-4 rounded-2xl border border-slate-200 hover:border-slate-400 transition shadow-2xs cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {isAr ? 'الطلبات النشطة' : 'Active Online Orders'}
            </span>
            <Package className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono tabular-nums">
            {activeOrdersCount}
            {pendingCount > 0 && (
              <span className="ms-2 text-xs font-extrabold text-rose-600">
                ({pendingCount} {isAr ? 'جديد' : 'new'})
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
            {activeOrdersTotalOmr.toFixed(3)} OMR · {completedCount} {isAr ? 'مكتمل' : 'done'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('inventory');
            setInventoryFilter('low_stock');
          }}
          className="text-start bg-white p-4 rounded-2xl border border-slate-200 hover:border-amber-400 transition shadow-2xs cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {isAr ? 'تنبيهات المخزون' : 'Stock & Catalog Health'}
            </span>
            <AlertTriangle className={`w-4 h-4 ${lowStockCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`} />
          </div>
          <div className={`text-xl sm:text-2xl font-black mt-1 font-mono tabular-nums ${lowStockCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {lowStockCount}
            <span className="text-xs font-bold text-slate-500 ms-1.5">
              {isAr ? 'منخفض المخزون' : 'low stock'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {catalog.length} {isAr ? 'صنف' : 'items'}
            {untranslatedCount > 0 ? ` · ${untranslatedCount} ${isAr ? 'بانتظار الترجمة' : 'untranslated'}` : ''}
          </div>
        </button>
      </div>

      {/* 58mm Bluetooth / Serial / RawBT Thermal Printer Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 space-y-2.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                printerName
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {printerName ? (
                <BluetoothConnected className="w-5 h-5" />
              ) : (
                <Printer className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="text-xs sm:text-sm font-extrabold text-slate-900">
                {printerName
                  ? isAr
                    ? `طابعة 58mm جاهزة: ${printerName}`
                    : `58mm Printer Ready: ${printerName}`
                  : isAr
                  ? 'طابعة الفواتير الحرارية 58mm (بلوتوث / USB)'
                  : '58mm Thermal Printer (Bluetooth / USB / RawBT)'}
              </div>
              <div className="text-[11px] text-slate-500">
                {isRunningInsideIframe()
                  ? isAr
                    ? 'تنبيه: المتصفح يحظر البلوتوث داخل إطار المعاينة — افتح صفحة الإدارة في تبويب مستقل للاتصال.'
                    : 'Preview frame blocks Web Bluetooth — open Admin in a standalone tab to scan & pair.'
                  : isWebBluetoothSupported()
                  ? isAr
                    ? 'يدعم بلوتوث BLE، ومنافذ USB/BT COM على الكمبيوتر، وتطبيق RawBT لطابعات البلوتوث على الأندرويد.'
                    : 'Supports BLE Bluetooth, USB/Paired BT Serial (PC), & Android RawBT (Classic BT like RPP02N / MTP-2).'
                  : isAr
                  ? 'يمكنك استخدام Android RawBT أو الطباعة الحرارية 58mm للنظام مباشرة.'
                  : 'Use Android RawBT mode (Classic BT) or 58mm System Print.'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isRunningInsideIframe() && (
              <a
                href={typeof window !== 'undefined' ? window.location.href : '/'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 text-xs font-extrabold"
              >
                <span>{isAr ? 'فتح في تبويب مستقل للبلوتوث' : 'Open Full Tab for BT'}</span>
              </a>
            )}

            {!printerName ? (
              <>
                <button
                  type="button"
                  onClick={handleConnectPrinter}
                  disabled={isConnectingPrinter}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition cursor-pointer disabled:opacity-60"
                >
                  {isConnectingPrinter ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Bluetooth className="w-3.5 h-3.5 text-sky-400" />
                  )}
                  <span>{isAr ? 'بلوتوث BLE 58mm' : 'Connect BLE BT'}</span>
                </button>

                {isWebSerialSupported() && (
                  <button
                    type="button"
                    onClick={handleConnectSerialPrinter}
                    disabled={isConnectingPrinter}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer disabled:opacity-60"
                  >
                    <Printer className="w-3.5 h-3.5 text-emerald-700" />
                    <span>{isAr ? 'USB / منفذ COM' : 'USB / BT Serial COM'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleToggleRawBtMode}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-bold transition cursor-pointer"
                >
                  <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
                  <span>{isAr ? 'تفعيل Android RawBT' : 'Android RawBT (Classic BT)'}</span>
                </button>
              </>
            ) : (
              <>
                <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoPrintEnabled}
                    onChange={(e) => onToggleAutoPrint(e.target.checked)}
                    className="accent-emerald-700 w-3.5 h-3.5"
                  />
                  <span>{isAr ? 'طباعة تلقائية للطلب الجديد' : 'Auto-Print New Orders'}</span>
                </label>

                <button
                  type="button"
                  onClick={handleTestPrinter}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
                >
                  {isAr ? 'طباعة تجريبية' : 'Test 58mm'}
                </button>

                <button
                  type="button"
                  onClick={handleDisconnectPrinter}
                  className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                >
                  {isAr ? 'فصل' : 'Disconnect'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {printerMsg && (
        <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-bold flex items-center justify-between gap-2">
          <span>{printerMsg}</span>
          <button type="button" onClick={() => setPrinterMsg(null)} className="cursor-pointer shrink-0">
            ✕
          </button>
        </div>
      )}

      {/* Admin Tabs Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl transition whitespace-nowrap cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {isAr ? 'لوحة الطلبات' : 'Orders Board'}
            {pendingCount > 0 && (
              <span className="ms-1.5 px-1.5 py-0.5 text-[10px] rounded-full bg-rose-500 text-white font-mono">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('customers')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'customers'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{isAr ? 'العملاء والائتمان' : 'Customers & Credit'}</span>
            {debtorsCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-400 text-slate-950 font-mono font-bold">
                {debtorsCount} due
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>{isAr ? 'التقارير والتحليلات' : 'Reports & Analytics'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'inventory'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{isAr ? `المنتجات (${catalog.length})` : `Inventory (${catalog.length})`}</span>
            {untranslatedCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-amber-400 text-slate-950 font-mono font-bold">
                {untranslatedCount} new
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('offers')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'offers'
                ? 'bg-rose-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{isAr ? 'العروض والفيديو' : 'Offers & Video'}</span>
            {offers.filter((o) => o.active).length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-white text-rose-700 font-mono font-black">
                {offers.filter((o) => o.active).length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('salesplay')}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-xl transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'salesplay'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>{isAr ? 'ربط الكاشير' : 'POS Status'}</span>
          </button>
        </div>

        {/* Sync to Customer Devices & Auto-Sync Bridge & Audio Controls */}
        <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setAutoPosCloudSync((prev) => !prev)}
            title={
              isAr
                ? 'تشغيل المزامنة التلقائية كل 60 ثانية للفواتير الجديدة والمحذوفة'
                : 'Auto-push new or deleted POS bills to launched customer dashboards every 60s'
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition cursor-pointer whitespace-nowrap ${
              autoPosCloudSync
                ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoPosCloudSync
                  ? isAutoSyncTicking
                    ? 'bg-amber-500 animate-ping'
                    : 'bg-emerald-600'
                  : 'bg-slate-400'
              }`}
            />
            <span>
              {isAr
                ? `مزامنة تلقائية 60ث: ${autoPosCloudSync ? 'تعمل' : 'متوقفة'}`
                : `Auto-Sync 60s: ${autoPosCloudSync ? 'ON' : 'OFF'}`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRefreshAndTranslate}
            disabled={isRefreshingSync}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition cursor-pointer disabled:opacity-60 whitespace-nowrap shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSync ? 'animate-spin' : ''}`} />
            <span>
              {isRefreshingSync
                ? isAr
                  ? 'جاري التحديث والإرسال...'
                  : 'Syncing & Pushing...'
                : isAr
                ? 'مزامنة وإرسال لأجهزة العملاء'
                : 'Sync to Customer Devices'}
            </span>
          </button>

          <button
            type="button"
            onClick={playNewOrderChime}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
          >
            🔔
          </button>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              soundEnabled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-slate-100 border-slate-200 text-slate-400'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {(!isFirebaseAdminSignedIn || !isAdminEmailVerified) && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold flex flex-wrap items-center justify-between gap-2">
          <span>
            {!isFirebaseAdminSignedIn
              ? isAr
                ? 'تنبيه: جلسة الإدارة في Firebase غير نشطة — لن يتم حفظ فواتير العملاء في السحابة حتى تسجيل الدخول.'
                : 'Firebase Admin session expired — customer bills & settings cannot sync until you sign in again.'
              : isAr
              ? 'تنبيه: تم تسجيل الدخول ببريد غير موثق — قواعد الأمان تتطلب الدخول بحساب Google المعتمد لحفظ الفواتير.'
              : 'Unverified Email session — Firestore rules require Google Sign-In (verified email) to push customer bill ledgers.'}
          </span>
          {onReauthenticateAdmin && (
            <button
              type="button"
              onClick={onReauthenticateAdmin}
              className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-extrabold cursor-pointer shrink-0"
            >
              {isAr ? 'تسجيل الدخول بـ Google' : 'Sign in with Google'}
            </button>
          )}
        </div>
      )}

      {syncBannerMsg && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between gap-2 ${
            syncBannerTone === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-900'
              : syncBannerTone === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <span>{syncBannerMsg}</span>
          <button
            type="button"
            onClick={() => setSyncBannerMsg(null)}
            className="font-bold cursor-pointer shrink-0 opacity-75 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {clearNotice && (
        <div className="p-3.5 rounded-2xl bg-slate-900 text-white text-xs font-bold flex items-center justify-between">
          <span>{clearNotice}</span>
          <button type="button" onClick={() => setClearNotice(null)} className="cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: ORDERS BOARD */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
              {[
                { key: 'all', labelEn: 'All', labelAr: 'الكل' },
                { key: 'pending', labelEn: 'Pending', labelAr: 'جديدة' },
                { key: 'processing', labelEn: 'Packing', labelAr: 'تعبئة' },
                { key: 'ready', labelEn: 'Ready', labelAr: 'جاهزة' },
                { key: 'completed', labelEn: 'Completed', labelAr: 'مكتملة' },
              ].map((st) => (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => setFilterStatus(st.key)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition shrink-0 cursor-pointer ${
                    filterStatus === st.key
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {isAr ? st.labelAr : st.labelEn}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-60">
                <Search className="w-3.5 h-3.5 absolute start-3 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={isAr ? 'بحث برقم الطلب / الجوال / العميل...' : 'Search order #, phone, ID...'}
                  className="w-full ps-8 pe-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              {orders.length > 0 &&
                (!confirmClearOrders ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClearOrders(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isAr ? 'مسح جميع الطلبات القديمة' : 'Clean All Orders'}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-300 px-2.5 py-1 rounded-xl shrink-0">
                    <button
                      type="button"
                      disabled={isClearingOrders}
                      onClick={handleClearAllOrders}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer disabled:opacity-50"
                    >
                      {isClearingOrders ? '...' : isAr ? 'تأكيد المسح النهائي' : 'Confirm Clean'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearOrders(false)}
                      className="px-2 py-1 text-[11px] font-bold text-slate-600 cursor-pointer"
                    >
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredOrders.map((order) => {
              const isPending = order.status === 'pending';
              const isProcessing = order.status === 'processing';
              const isReady = order.status === 'ready';
              const isCompleted = order.status === 'completed';

              return (
                <div
                  key={order.id}
                  className={`bg-white rounded-2xl p-5 border-2 transition space-y-4 ${
                    isPending
                      ? 'border-rose-400 bg-rose-50/15'
                      : isReady
                      ? 'border-emerald-500 bg-emerald-50/15'
                      : isProcessing
                      ? 'border-amber-300'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-lg text-slate-900 font-mono">
                          {order.orderNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-md ${
                            isPending
                              ? 'bg-rose-100 text-rose-800'
                              : isProcessing
                              ? 'bg-amber-100 text-amber-800'
                              : isReady
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {order.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(order.createdAt).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-end">
                        <div className="font-extrabold text-base text-emerald-800 font-mono tabular-nums">
                          {order.totalAmount.toFixed(3)} OMR
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handlePrintOrder(order)}
                        disabled={printingOrderId === order.id}
                        title={isAr ? 'طباعة 58mm' : 'Print 58mm Receipt'}
                        className="p-2 rounded-xl bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 transition cursor-pointer"
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteSingleOrder(order.id)}
                        disabled={actionLoadingId === order.id}
                        title={isAr ? 'حذف الطلب' : 'Delete Order'}
                        className="p-2 rounded-xl bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-600 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Customer Info Highlight + Quick Actions */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      {order.customerCode && (
                        <button
                          type="button"
                          onClick={() => {
                            const matched = enrichedCustomers.find(
                              (c) => c.customerCode === order.customerCode
                            ) || {
                              id: `ord_${order.customerCode}`,
                              customerCode: order.customerCode || '',
                              phone: order.customerPhone || '',
                              phoneNormalized: normalizePhoneNumber(order.customerPhone || ''),
                              name: order.customerName || `Customer #${order.customerCode}`,
                              creditLimit: null,
                              totalSpent: 0,
                              totalVisits: 0,
                              source: 'firestore' as const,
                            };
                            setCreditCustomerModal(matched);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-mono font-bold cursor-pointer"
                          title={isAr ? 'عرض الفواتير والمستحقات' : 'View customer credit & bills'}
                        >
                          <Hash className="w-3 h-3" />
                          {order.customerCode}
                        </button>
                      )}
                      <span className="font-bold text-slate-900">{order.customerName}</span>
                    </div>
                    {order.customerPhone ? (
                      <a
                        href={`tel:${order.customerPhone}`}
                        className="inline-flex items-center gap-1.5 font-mono font-bold text-emerald-800 hover:underline"
                      >
                        <Phone className="w-3.5 h-3.5 text-emerald-700" />
                        <span>{order.customerPhone}</span>
                      </a>
                    ) : (
                      <span className="font-mono text-slate-400">—</span>
                    )}
                  </div>

                  {/* Items List */}
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {order.items.map((it) => (
                      <div
                        key={it.productId || it.name}
                        className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-xs"
                      >
                        <span className="font-semibold text-slate-800">
                          {it.quantity} × {isAr ? it.arabicName || it.name : it.name}
                        </span>
                        <span className="font-bold text-slate-900 font-mono tabular-nums">
                          {it.total.toFixed(3)} OMR
                        </span>
                      </div>
                    ))}
                  </div>

                  {order.customNotes && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950">
                      <span className="font-bold block mb-0.5">{isAr ? 'ملاحظات:' : 'Notes:'}</span>
                      <p className="whitespace-pre-wrap">{order.customNotes}</p>
                    </div>
                  )}

                  {/* Payment Info + Clear POS Billing Note (Zero Auto Stock Deduction) */}
                  <div className="p-3 rounded-xl bg-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-slate-700">
                      {order.paymentMethod === 'card' && <CreditCard className="w-4 h-4 text-emerald-700" />}
                      {order.paymentMethod === 'cash' && <Banknote className="w-4 h-4 text-emerald-700" />}
                      {order.paymentMethod === 'online' && <Smartphone className="w-4 h-4 text-emerald-700" />}
                      <span className="uppercase">{order.paymentMethod}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          order.paymentStatus === 'received'
                            ? 'bg-emerald-200 text-emerald-900'
                            : 'bg-amber-200 text-amber-900'
                        }`}
                      >
                        {order.paymentStatus === 'received' ? 'PAID' : 'UNPAID'}
                      </span>
                    </div>

                    <span className="text-[11px] font-medium text-slate-500">
                      {isAr ? 'الفوترة النهائية داخل SalesPlay POS' : 'Bill inside SalesPlay POS'}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => handleSetStatus(order, 'processing')}
                        disabled={actionLoadingId === order.id}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Package className="w-4 h-4" />
                        <span>{isAr ? 'بدء التجهيز' : 'Start Packing'}</span>
                      </button>
                    )}

                    {(isPending || isProcessing) && (
                      <button
                        type="button"
                        onClick={() => handleSetStatus(order, 'ready')}
                        disabled={actionLoadingId === order.id}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Check className="w-4 h-4" />
                        <span>{isAr ? 'جاهز للاستلام' : 'Mark Ready'}</span>
                      </button>
                    )}

                    {isReady && (
                      <button
                        type="button"
                        onClick={() => handleCompleteOrder(order)}
                        disabled={actionLoadingId === order.id}
                        className="flex-1 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>
                          {isAr ? 'تمت الفوترة في POS وإغلاق الطلب' : 'Billed in POS & Complete'}
                        </span>
                      </button>
                    )}

                    {isCompleted && (
                      <div className="w-full text-center py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 rounded-lg">
                        ✓ {isAr ? 'مكتمل (مفوتر عبر POS)' : 'Completed (Billed in POS)'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filteredOrders.length === 0 && (
            <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
              <Package className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <h4 className="font-bold text-slate-800">
                {isAr ? 'لوحة الطلبات نظيفة ولا توجد طلبات' : 'Order board is clean'}
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                {isAr
                  ? 'ستظهر طلبات العملاء الجديدة هنا فور إرسالها.'
                  : 'New customer online orders will appear here immediately.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SMART CUSTOMERS DIRECTORY + BARCODE/QR SEARCH + ID/MOBILE EDITOR */}
      {activeTab === 'customers' && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-bold text-base text-slate-900">
                {isAr
                  ? `إدارة العملاء وبطاقات العائلة (${customers.length})`
                  : `Customer Directory & Family Cards (${customers.length})`}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAr
                  ? 'ابحث أو امسح الباركود/QR لتعديل رقم العميل ورقم الجوال أو طباعة بطاقة العائلة.'
                  : 'Search or scan Barcode/QR to edit Customer ID & Mobile Number or print Family Credit QR Cards.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSyncCustomersFromPos}
                disabled={isSyncingCustomers}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCustomers ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'مزامنة عملاء POS' : 'Sync POS Customers'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setEditingCustomer({
                    customerCode: '',
                    phone: '',
                    name: '',
                  })
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-black text-white cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{isAr ? 'إضافة عميل' : 'Add Customer'}</span>
              </button>
            </div>
          </div>

          {/* Search + Barcode/QR Scan + Credit Status Filters */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute start-3 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={
                    isAr
                      ? 'امسح الباركود هنا أو ابحث برقم العميل (001) أو الجوال أو الاسم...'
                      : 'Scan barcode here or search by Customer ID (001), mobile, or name...'
                  }
                  className="w-full ps-9 pe-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-600 font-mono"
                />
                {customerSearch && (
                  <button
                    type="button"
                    onClick={() => setCustomerSearch('')}
                    className="absolute end-2.5 top-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowCustomerScanner(true)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer shrink-0"
              >
                <QrCode className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? 'مسح باركود / QR العميل' : 'Scan Barcode / QR'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all' as const, label: isAr ? `الكل (${enrichedCustomers.length})` : `All (${enrichedCustomers.length})` },
                { id: 'with_due' as const, label: isAr ? `عليهم مستحقات (${debtorsCount})` : `With Unpaid Due (${debtorsCount})` },
                { id: 'near_limit' as const, label: isAr ? 'قريب من الحد (≥80%)' : 'Near Credit Limit (≥80%)' },
                { id: 'synced' as const, label: isAr ? 'مرتبط POS + ويب' : 'Synced POS + Web' },
              ].map((cf) => (
                <button
                  key={cf.id}
                  type="button"
                  onClick={() => setCustomerFilter(cf.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                    customerFilter === cf.id
                      ? cf.id === 'with_due'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cf.label}
                </button>
              ))}
            </div>
          </div>

          {isLoadingCustomers ? (
            <div className="py-12 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700" />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {filteredCustomers.map((cust) => (
                <div
                  key={cust.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-xl text-white font-black font-mono flex items-center justify-center shrink-0 text-sm ${
                        cust.netDue > 0 ? 'bg-amber-600' : 'bg-emerald-700'
                      }`}
                    >
                      #{cust.customerCode || '—'}
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-sm text-slate-900 flex flex-wrap items-center gap-2">
                        <span>{cust.name}</span>
                        {cust.netDue > 0.0005 ? (
                          <span className="px-2 py-0.5 rounded-md bg-rose-100 border border-rose-200 text-rose-900 text-[11px] font-mono font-extrabold">
                            Due: {cust.netDue.toFixed(3)} OMR
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                            Clear
                          </span>
                        )}
                        <span className="text-[11px] font-semibold text-slate-400">
                          {cust.source === 'both'
                            ? 'POS + Web'
                            : cust.source === 'salesplay'
                            ? 'POS'
                            : 'Web'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 font-mono flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="w-3 h-3 text-emerald-700" />
                          {cust.phone || 'No mobile set'}
                        </span>
                        {cust.creditLimit !== null && (
                          <span className="text-slate-700 font-bold">
                            Limit: {cust.creditLimit.toFixed(3)} OMR ({cust.limitPct.toFixed(0)}%)
                          </span>
                        )}
                        {cust.effectiveSpent > 0 && (
                          <span className="text-emerald-800 font-bold">
                            Spent: {cust.effectiveSpent.toFixed(3)} OMR
                          </span>
                        )}
                        {cust.totalVisits > 0 && (
                          <span className="text-slate-400">
                            {cust.totalVisits} visits
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setCreditCustomerModal(cust)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold cursor-pointer ${
                        cust.netDue > 0.0005
                          ? 'bg-amber-600 hover:bg-amber-700 border-amber-700 text-white'
                          : 'bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-950'
                      }`}
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>
                        {cust.netDue > 0.0005
                          ? isAr
                            ? 'تسوية المستحق'
                            : 'Settle Due'
                          : isAr
                          ? 'الفواتير والمستحقات'
                          : 'Credit & Bills'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setQrCardCustomer(cust)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5 text-emerald-700" />
                      <span>{isAr ? 'بطاقة QR' : 'Family QR Card'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setEditingCustomer({
                          firestoreId: cust.firestoreId,
                          salesplayId: cust.salesplayId,
                          customerCode: cust.customerCode,
                          phone: cust.phone,
                          name: cust.name,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-900 font-bold cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isAr ? 'تعديل الرقم والهاتف' : 'Edit ID / Mobile'}</span>
                    </button>
                  </div>
                </div>
              ))}

              {filteredCustomers.length === 0 && (
                <div className="py-10 text-center text-slate-400 text-xs">
                  {isAr ? 'لا يوجد عملاء مطابقون للبحث.' : 'No matching customers found.'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2B: ADMIN REPORTS & ANALYTICS (SPENDING REPORTS & DEBTORS LEADERBOARD) */}
      {activeTab === 'reports' && (() => {
        const periodData = insights?.periods[reportPeriod];
        const topSpenders = [...enrichedCustomers]
          .filter((c) => c.effectiveSpent > 0)
          .sort((a, b) => b.effectiveSpent - a.effectiveSpent)
          .slice(0, 12);
        const topDebtors = [...enrichedCustomers]
          .filter((c) => c.netDue > 0.0005)
          .sort((a, b) => b.netDue - a.netDue);

        const cashPct =
          periodData && periodData.salesTotal > 0
            ? Math.min(100, (periodData.cashTotal / periodData.salesTotal) * 100)
            : 0;
        const cardPct =
          periodData && periodData.salesTotal > 0
            ? Math.min(100, (periodData.cardTotal / periodData.salesTotal) * 100)
            : 0;
        const creditPct =
          periodData && periodData.salesTotal > 0
            ? Math.min(100, (periodData.creditIssuedTotal / periodData.salesTotal) * 100)
            : 0;

        return (
          <div className="space-y-5">
            {/* Period Controls & Header */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-base text-slate-900">
                  {isAr ? 'تقارير المبيعات والائتمان وكبار العملاء' : 'Store Sales, Credit & Customer Reports'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isAr
                    ? 'تقارير إجمالي الإنفاق والديون والأصناف الأكثر مبيعاً (متاحة للإدارة فقط)'
                    : 'Private admin-only revenue breakdown, customer total spend leaderboard, and unpaid credit control.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                  {[
                    { id: 'today' as const, label: isAr ? 'اليوم' : 'Today' },
                    { id: 'd7' as const, label: isAr ? '7 أيام' : '7 Days' },
                    { id: 'd30' as const, label: isAr ? '30 يوم' : '30 Days' },
                    { id: 'd90' as const, label: isAr ? '90 يوم' : '90 Days' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setReportPeriod(p.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                        reportPeriod === p.id
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => loadAdminAnalytics(true)}
                  disabled={isLoadingInsights}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingInsights ? 'animate-spin' : ''}`} />
                  <span>{isAr ? 'تحديث التقرير' : 'Refresh Report'}</span>
                </button>
              </div>
            </div>

            {/* Financial Metrics Breakdown */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-slate-900 text-white p-4 rounded-2xl">
                <div className="text-[11px] font-bold text-slate-300">
                  {isAr ? 'إجمالي المبيعات' : 'POS Gross Sales'}
                </div>
                <div className="text-xl font-black text-emerald-400 font-mono tabular-nums mt-1">
                  {(periodData?.salesTotal ?? 0).toFixed(3)} OMR
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                  {periodData?.billCount ?? 0} bills · Avg {(periodData?.avgBillValue ?? 0).toFixed(3)}
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200">
                <div className="text-[11px] font-bold text-slate-500">
                  {isAr ? 'نقدي (Cash)' : 'Cash Sales'}
                </div>
                <div className="text-xl font-black text-emerald-800 font-mono tabular-nums mt-1">
                  {(periodData?.cashTotal ?? 0).toFixed(3)} OMR
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-emerald-600" style={{ width: `${cashPct}%` }} />
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-slate-200">
                <div className="text-[11px] font-bold text-slate-500">
                  {isAr ? 'بطاقة (Card)' : 'Card Sales'}
                </div>
                <div className="text-xl font-black text-sky-800 font-mono tabular-nums mt-1">
                  {(periodData?.cardTotal ?? 0).toFixed(3)} OMR
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-sky-600" style={{ width: `${cardPct}%` }} />
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-amber-200">
                <div className="text-[11px] font-bold text-amber-800">
                  {isAr ? 'مبيعات آجل (Credit)' : 'Credit Issued'}
                </div>
                <div className="text-xl font-black text-amber-700 font-mono tabular-nums mt-1">
                  {(periodData?.creditIssuedTotal ?? 0).toFixed(3)} OMR
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-amber-100 overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${creditPct}%` }} />
                </div>
              </div>

              <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 col-span-2 lg:col-span-1">
                <div className="text-[11px] font-bold text-emerald-900">
                  {isAr ? 'تسويات محصلة (Admin)' : 'Collected Settlements'}
                </div>
                <div className="text-xl font-black text-emerald-800 font-mono tabular-nums mt-1">
                  {totalAdminSettlementsCollected.toFixed(3)} OMR
                </div>
                <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                  {allSettlements.length} {isAr ? 'عملية تسوية' : 'settlement record(s)'}
                </div>
              </div>
            </div>

            {/* Debtors & Top Spenders Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Unpaid Credit / Debtors Priority List */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">
                      {isAr ? 'قائمة المستحقات والمتأخرات للتحصيل' : 'Unpaid Credit & Collection Priority'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {isAr
                        ? 'مرتبة من أعلى مبلغ مستحق إلى الأقل'
                        : 'Sorted highest net due balance first (POS credit minus settlements)'}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-900 font-mono text-xs font-extrabold">
                    {totalStoreOutstandingDue.toFixed(3)} OMR
                  </span>
                </div>

                {topDebtors.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    {isAr ? 'لا توجد مستحقات غير مسددة حالياً.' : 'Zero unpaid credit balances across all customers.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {topDebtors.map((d) => (
                      <div key={d.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-extrabold text-slate-900">
                            <span className="font-mono text-amber-700 me-1.5">#{d.customerCode}</span>
                            {d.name}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {d.dueBillsCount} due bill(s)
                            {d.creditLimit !== null ? ` · Limit ${d.creditLimit.toFixed(3)}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-black text-rose-700">
                            {d.netDue.toFixed(3)} OMR
                          </span>
                          <button
                            type="button"
                            onClick={() => setCreditCustomerModal(d)}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-black text-white text-[11px] font-bold cursor-pointer"
                          >
                            {isAr ? 'تسوية' : 'Settle'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Admin-Only Customer Total Spending Leaderboard */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">
                      {isAr ? 'أكثر العملاء شراءً (إجمالي الإنفاق)' : 'Top Customers by Total Spent'}
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      {isAr
                        ? 'تقرير خاص بالإدارة فقط — مخفي عن لوحة العميل'
                        : 'Admin-only lifetime & 90-day spending report (hidden from customer view)'}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 text-[11px] font-bold">
                    Top {topSpenders.length}
                  </span>
                </div>

                {topSpenders.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    {isAr ? 'لا توجد بيانات مبيعات مسجلة بعد.' : 'No customer spend data available yet.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {topSpenders.map((c, idx) => (
                      <div key={c.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2.5">
                          <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 font-mono font-extrabold flex items-center justify-center text-[11px]">
                            {idx + 1}
                          </span>
                          <div>
                            <div className="font-extrabold text-slate-900">
                              <span className="font-mono text-emerald-700 me-1">#{c.customerCode}</span>
                              {c.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              {c.totalVisits} visits · 90d: {c.spent90d.toFixed(3)} OMR
                            </div>
                          </div>
                        </div>

                        <div className="text-end font-mono shrink-0">
                          <div className="font-black text-emerald-800">
                            {c.effectiveSpent.toFixed(3)} OMR
                          </div>
                          {c.netDue > 0 && (
                            <div className="text-[10px] font-bold text-rose-600">
                              Due: {c.netDue.toFixed(3)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Top Moving Products & Category Mix */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h4 className="font-extrabold text-sm text-slate-900 border-b border-slate-100 pb-2.5">
                  {isAr ? 'الأصناف الأكثر مبيعاً' : 'Top Selling Products'}
                </h4>
                <div className="divide-y divide-slate-100">
                  {(periodData?.topProducts || []).map((prod, idx) => (
                    <div key={prod.name} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-mono font-bold text-slate-400 w-5">
                          {idx + 1}.
                        </span>
                        <div className="truncate">
                          <div className="font-bold text-slate-900 truncate">{prod.name}</div>
                          <div className="text-[10px] text-slate-500">{prod.category}</div>
                        </div>
                      </div>
                      <div className="text-end font-mono shrink-0">
                        <div className="font-extrabold text-slate-900">{prod.revenue.toFixed(3)} OMR</div>
                        <div className="text-[10px] text-emerald-700 font-bold">{prod.quantity} sold</div>
                      </div>
                    </div>
                  ))}
                  {(!periodData || periodData.topProducts.length === 0) && (
                    <div className="py-6 text-center text-xs text-slate-400">
                      {isAr ? 'لا توجد مبيعات في هذه الفترة' : 'No product sales recorded in this period'}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
                <h4 className="font-extrabold text-sm text-slate-900 border-b border-slate-100 pb-2.5">
                  {isAr ? 'المبيعات حسب القسم' : 'Sales by Category'}
                </h4>
                <div className="space-y-3">
                  {(periodData?.topCategories || []).map((cat) => {
                    const maxRev = periodData?.topCategories[0]?.revenue || 1;
                    const widthPct = Math.min(100, (cat.revenue / maxRev) * 100);
                    return (
                      <div key={cat.category} className="space-y-1 text-xs">
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-slate-800">{cat.category}</span>
                          <span className="font-mono text-slate-900">
                            {cat.revenue.toFixed(3)} OMR{' '}
                            <span className="text-[10px] text-slate-400">({cat.billCount} bills)</span>
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${widthPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {(!periodData || periodData.topCategories.length === 0) && (
                    <div className="py-6 text-center text-xs text-slate-400">
                      {isAr ? 'لا توجد بيانات أقسام في هذه الفترة' : 'No category sales in this period'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAB 3: SALESPLAY REAL INVENTORY + TRANSLATION */}
      {activeTab === 'inventory' && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900">
                  {isAr ? 'مخزون المتجر المباشر' : 'Live Store Inventory'}
                </h3>
                <span className="px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800 rounded-md font-mono">
                  {catalog.length} items
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAr
                  ? 'أي صنف جديد يظهر بالإنجليزية حتى تضغط "تحديث وترجمة الأصناف".'
                  : 'Newly added items appear in English until you click Refresh & Update Items to translate them.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-black text-white transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isAr ? 'إضافة منتج جديد' : 'Add Product'}</span>
              </button>

              <button
                type="button"
                disabled={isRefreshingSync}
                onClick={handleRefreshAndTranslate}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white transition cursor-pointer disabled:opacity-60"
              >
                <Languages className="w-3.5 h-3.5" />
                <span>
                  {isRefreshingSync
                    ? isAr
                      ? 'جاري المزامنة والإرسال...'
                      : 'Syncing & Pushing...'
                    : isAr
                    ? 'مزامنة وإرسال لأجهزة العملاء'
                    : 'Sync to Customer Devices'}
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 absolute start-3 top-2.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder={isAr ? 'بحث في الأصناف...' : 'Search inventory by name, Arabic, code, barcode...'}
                className="w-full ps-9 pe-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all' as const, label: isAr ? `الكل (${catalog.length})` : `All (${catalog.length})` },
                { id: 'low_stock' as const, label: isAr ? `مخزون منخفض ≤5 (${catalog.filter((i) => i.stockControl && i.stock > 0 && i.stock <= 5).length})` : `Low Stock ≤5 (${catalog.filter((i) => i.stockControl && i.stock > 0 && i.stock <= 5).length})` },
                { id: 'out_of_stock' as const, label: isAr ? `نفد المخزون (${catalog.filter((i) => i.stockControl && i.stock <= 0).length})` : `Out of Stock (${catalog.filter((i) => i.stockControl && i.stock <= 0).length})` },
                { id: 'no_arabic' as const, label: isAr ? `بدون ترجمة (${untranslatedCount})` : `Missing Arabic (${untranslatedCount})` },
                { id: 'no_photo' as const, label: isAr ? `بدون صورة (${catalog.filter((i) => !i.imageUrl).length})` : `Missing Photo (${catalog.filter((i) => !i.imageUrl).length})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setInventoryFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                    inventoryFilter === f.id
                      ? f.id === 'out_of_stock'
                        ? 'bg-rose-600 text-white'
                        : f.id === 'low_stock'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {showAddModal && (
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-emerald-950 uppercase tracking-wider">
                  {isAr ? 'إضافة منتج جديد لنظام SalesPlay POS' : 'Add Product to SalesPlay POS'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAddProductSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'اسم المنتج *' : 'Product Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={newProdName}
                    onChange={(e) => setNewProdName(e.target.value)}
                    placeholder="e.g. Almarai Milk 2L"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'القسم *' : 'Category *'}
                  </label>
                  <input
                    type="text"
                    value={newProdCategory}
                    onChange={(e) => setNewProdCategory(e.target.value)}
                    placeholder="Drink, Snacks, Grocery..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'السعر (OMR) *' : 'Price (OMR) *'}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={newProdPrice}
                    onChange={(e) => setNewProdPrice(e.target.value)}
                    placeholder="0.250"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'الكمية المبدئية' : 'Initial Stock'}
                  </label>
                  <input
                    type="number"
                    value={newProdStock}
                    onChange={(e) => setNewProdStock(e.target.value)}
                    placeholder="20"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-mono"
                  />
                </div>

                {addProdError && (
                  <div className="sm:col-span-2 text-xs text-rose-600 font-semibold">{addProdError}</div>
                )}
                {addProdSuccess && (
                  <div className="sm:col-span-2 text-xs text-emerald-700 font-bold">{addProdSuccess}</div>
                )}

                <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 cursor-pointer"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    disabled={isAddingProd}
                    className="px-4 py-1.5 text-xs font-bold rounded-lg bg-emerald-700 text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    {isAddingProd && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{isAr ? 'حفظ' : 'Save Product'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
            {filteredCatalog.slice(0, 150).map((item) => (
              <div
                key={item.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center shrink-0 relative group">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-slate-300 stroke-1" />
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedProductForImage(item)}
                      className="absolute inset-0 bg-slate-900/60 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>

                  <div>
                    <div className="font-extrabold text-sm text-slate-900 flex flex-wrap items-center gap-2">
                      <span>{item.name}</span>
                      {!item.hasArabicTranslation && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-900 rounded font-bold">
                          Pending Arabic
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-['Cairo',sans-serif]">
                      {item.arabicName} • {item.category}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div className="text-end">
                    <div className="font-extrabold text-sm text-slate-900 font-mono tabular-nums">
                      {item.price.toFixed(3)} OMR
                    </div>
                    <div className="text-[11px] font-semibold text-emerald-700 font-mono">
                      {item.stock} in stock
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedProductForImage(item)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 hover:border-emerald-600 bg-white hover:bg-emerald-50 text-slate-700 transition cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5 text-emerald-700" />
                    <span>{isAr ? 'صورة' : 'Photo'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3B: TODAY'S OFFERS & CUSTOMER INTRO VIDEO POPUP */}
      {activeTab === 'offers' && (() => {
        const distinctCategories = Array.from(
          new Set(
            catalog
              .map((c) => (!c.category || c.category === 'No category' ? 'Uncategorized' : c.category))
              .filter(Boolean)
          )
        ).sort();

        const offerProductMatches = offerProdSearch.trim()
          ? catalog
              .filter((p) => {
                const q = offerProdSearch.toLowerCase();
                return (
                  p.name.toLowerCase().includes(q) ||
                  (p.arabicName && p.arabicName.toLowerCase().includes(q)) ||
                  (p.barcode && p.barcode.includes(q))
                );
              })
              .slice(0, 40)
          : catalog.slice(0, 40);

        return (
          <div className="space-y-5">
            {/* TODAY'S OFFERS MANAGER (Blinkit / Flipkart Minutes / Temu Deal Cards) */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
                    <Tag className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-slate-900">
                      {isAr ? 'إدارة عروض اليوم (تظهر في واجهة المتجر)' : "Today's Offers & Flash Deals"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {isAr
                        ? 'أضف عروضاً مميزة أو خصومات يومية تظهر بأعلى صفحة المتجر للعملاء بضغطة زر.'
                        : 'Publish daily deal cards on the storefront (Blinkit / Flipkart Minutes style) with 1-tap Add or category jump.'}
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleAddOffer} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'عنوان العرض (إنجليزي) *' : 'Offer Title (English) *'}
                  </label>
                  <input
                    type="text"
                    required={!offerTitleAr.trim()}
                    value={offerTitleEn}
                    onChange={(e) => setOfferTitleEn(e.target.value)}
                    placeholder="e.g. Pepsi 6-Pack Super Saver"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'عنوان العرض (عربي) *' : 'Offer Title (Arabic) *'}
                  </label>
                  <input
                    type="text"
                    value={offerTitleAr}
                    onChange={(e) => setOfferTitleAr(e.target.value)}
                    placeholder="مثال: عرض خاص على بيبسي 6 علب"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'شارة العرض (Badge)' : 'Badge Label'}
                  </label>
                  <input
                    type="text"
                    value={offerBadge}
                    onChange={(e) => setOfferBadge(e.target.value)}
                    placeholder="HOT DEAL / 25% OFF"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-extrabold uppercase"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'وصف إضافي (إنجليزي)' : 'Subtitle (English, optional)'}
                  </label>
                  <input
                    type="text"
                    value={offerSubtitleEn}
                    onChange={(e) => setOfferSubtitleEn(e.target.value)}
                    placeholder="Limited time today only"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'وصف إضافي (عربي)' : 'Subtitle (Arabic, optional)'}
                  </label>
                  <input
                    type="text"
                    value={offerSubtitleAr}
                    onChange={(e) => setOfferSubtitleAr(e.target.value)}
                    placeholder="عرض ساري لليوم فقط"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'لون بطاقة العرض' : 'Card Theme Color'}
                  </label>
                  <select
                    value={offerAccent}
                    onChange={(e) => setOfferAccent(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-bold"
                  >
                    <option value="rose">Crimson Red (Flash Deal)</option>
                    <option value="emerald">Store Emerald Green</option>
                    <option value="amber">Bright Yellow Gold (Blinkit)</option>
                    <option value="slate">Dark Premium Slate</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    {isAr ? 'ربط بمنتج معين (اختياري للإضافة السريعة)' : 'Link to Product (optional, enables 1-tap ADD)'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={offerProdSearch}
                      onChange={(e) => setOfferProdSearch(e.target.value)}
                      placeholder={isAr ? 'ابحث عن منتج...' : 'Filter product list...'}
                      className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl"
                    />
                    <select
                      value={offerProductId}
                      onChange={(e) => setOfferProductId(e.target.value)}
                      className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-medium"
                    >
                      <option value="">{isAr ? '-- بدون منتج محدد --' : '-- No specific product --'}</option>
                      {offerProductMatches.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.price.toFixed(3)} OMR)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {offerProductId ? (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {isAr ? 'سعر العرض الخاص (OMR)' : 'Special Offer Price (OMR)'}
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      value={offerPriceInput}
                      onChange={(e) => setOfferPriceInput(e.target.value)}
                      placeholder="0.150"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-mono font-bold"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      {isAr ? 'أو ربط بقسم عند الضغط' : 'Or Link to Category'}
                    </label>
                    <select
                      value={offerCategoryFilter}
                      onChange={(e) => setOfferCategoryFilter(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl font-medium"
                    >
                      <option value="">{isAr ? '-- بدون قسم --' : '-- Any category --'}</option>
                      {distinctCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="sm:col-span-2 lg:col-span-3 flex items-center justify-between pt-1">
                  {offerStatusMsg ? (
                    <span className="text-xs font-bold text-emerald-700">{offerStatusMsg}</span>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      {isAr ? 'تظهر العروض النشطة فوراً في الصفحة الرئيسية للعملاء.' : 'Active deals appear immediately at top of the shop.'}
                    </span>
                  )}

                  <button
                    type="submit"
                    disabled={isSavingOffers}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
                  >
                    {isSavingOffers ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{isAr ? 'نشر العرض الآن' : 'Publish Offer'}</span>
                  </button>
                </div>
              </form>

              {/* Existing Offers List */}
              <div className="space-y-2">
                <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  {isAr ? `العروض الحالية (${offers.length})` : `Configured Offers (${offers.length})`}
                </h4>
                {offers.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    {isAr ? 'لم يتم إضافة عروض اليوم بعد.' : 'No offers published yet. Create your first daily deal above!'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {offers.map((o) => {
                      const prod = o.productId ? catalog.find((p) => p.id === o.productId) : undefined;
                      return (
                        <div
                          key={o.id}
                          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                            o.active ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-black">
                                {o.badgeText}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  o.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                {o.active ? (isAr ? 'نشط' : 'Active') : isAr ? 'متوقف' : 'Paused'}
                              </span>
                            </div>
                            <div className="font-extrabold text-sm text-slate-900 truncate">
                              {o.titleEn} / {o.titleAr}
                            </div>
                            {prod && (
                              <div className="text-[11px] text-slate-500 font-mono truncate">
                                Linked: {prod.name} → {o.offerPrice ? `${o.offerPrice.toFixed(3)} OMR` : `${prod.price.toFixed(3)} OMR`}
                              </div>
                            )}
                            {!prod && o.categoryFilter && (
                              <div className="text-[11px] text-slate-500">
                                Category: {o.categoryFilter}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleOfferActive(o.id)}
                              disabled={isSavingOffers}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                            >
                              {o.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                              <span>{o.active ? (isAr ? 'إيقاف' : 'Pause') : isAr ? 'تشغيل' : 'Enable'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteOffer(o.id)}
                              disabled={isSavingOffers}
                              className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* CUSTOMER INTRO VIDEO POPUP CONTROL */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center">
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">
                    {isAr ? 'فيديو الترحيب التلقائي للعملاء (مرة واحدة فقط)' : 'Customer Welcome Video Popup'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {isAr
                      ? 'يفتح بالمنتصف مع الصوت لأول مرة فقط، ويُغلق تلقائياً عند انتهاء الفيديو (مع زر إغلاق). عند تغيير الرابط سيظهر مرة واحدة فقط لكل عميل.'
                      : 'Plays centered with sound on first open before login & auto-closes when finished (with Close button). Updating the link shows it 1 time to each customer.'}
                  </p>
                </div>
              </div>

              <form onSubmit={(e) => handleSaveIntroVideoSetting(e)} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    {isAr ? 'رابط الفيديو (YouTube أو MP4 مباشر)' : 'YouTube or MP4 Video URL'}
                  </label>
                  <input
                    type="url"
                    value={videoInput}
                    onChange={(e) => setVideoInput(e.target.value)}
                    placeholder="https://youtu.be/jShbHCCsW60?si=fcuFhWytTMLxSQkD"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl font-mono focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={isSavingVideo}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
                  >
                    {isSavingVideo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>{isAr ? 'حفظ وإظهار مرة واحدة للعملاء' : 'Save & Show Once to Customers'}</span>
                  </button>

                  {videoInput.trim() && (
                    <button
                      type="button"
                      onClick={() => setShowPreviewVideo(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{isAr ? 'معاينة الفيديو' : 'Preview Popup'}</span>
                    </button>
                  )}

                  {videoInput.trim() && (
                    <button
                      type="button"
                      disabled={isSavingVideo}
                      onClick={() => handleSaveIntroVideoSetting(undefined, '')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                    >
                      <span>{isAr ? 'إيقاف الفيديو' : 'Disable Video'}</span>
                    </button>
                  )}
                </div>

                {videoStatusMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold">
                    {videoStatusMsg}
                  </div>
                )}
              </form>
            </div>
          </div>
        );
      })()}

      {/* TAB 4: SALESPLAY LIVE SYNC & STORE WHATSAPP SETTINGS */}
      {activeTab === 'salesplay' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  {isAr ? 'تكامل SalesPlay POS (قراءة الأصناف والفواتير فقط)' : 'SalesPlay Cloud POS (Read-Only Catalog & Credit Sync)'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isAr
                    ? 'الطلبات الإلكترونية لا تغيّر مخزون SalesPlay — الفوترة النهائية تتم داخل جهاز POS بالمحل.'
                    : 'Online orders never modify SalesPlay stock or receipts — final billing happens inside SalesPlay POS.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="font-bold text-slate-500 uppercase tracking-wider block">
                  {isAr ? 'اسم المتجر' : 'Shop Name'}
                </span>
                <div className="font-extrabold text-sm text-slate-900">
                  {salesplayShop?.shop_name || 'MAKAREM ALKHAIR MODERN'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  Synced Items: {catalog.length}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="font-bold text-slate-500 uppercase tracking-wider block">
                  {isAr ? 'وضع المزامنة الاقتصادي' : 'Push-Triggered Customer Sync'}
                </span>
                <div className="font-bold text-emerald-700">Admin Push Sync (Zero Wasted Reads)</div>
                <div className="text-[11px] text-slate-600">
                  {isAr
                    ? 'أجهزة العملاء تتحدث مرة واحدة فقط بعد ضغط "مزامنة وإرسال لأجهزة العملاء".'
                    : 'Customer apps pull updated items & categories once whenever you click Sync to Customer Devices.'}
                </div>
              </div>
            </div>
          </div>

          {/* Customer Floating WhatsApp Number Setting */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">
                  {isAr ? 'رقم واتساب خدمة العملاء (الزر العائم)' : 'Customer WhatsApp Support Number'}
                </h3>
                <p className="text-xs text-slate-500">
                  {isAr
                    ? 'الرقم المستخدم في زر الواتساب العائم بزاوية الشاشة ليتواصل العملاء مع البقالة مباشرة.'
                    : 'Phone number linked to the floating corner WhatsApp chat button visible to customers.'}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveWhatsAppSetting} className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {isAr ? 'رقم الواتساب (عماني 8 أرقام أو دولي)' : 'WhatsApp Phone Number'}
                </label>
                <input
                  type="tel"
                  required
                  value={waInput}
                  onChange={(e) => setWaInput(e.target.value)}
                  placeholder="72095796"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingWa}
                className="px-5 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1EBE5D] text-white font-extrabold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isSavingWa && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isAr ? 'حفظ رقم الواتساب' : 'Save WhatsApp Number'}</span>
              </button>
            </form>

            {waStatusMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold">
                {waStatusMsg}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit / Create Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200 animate-fadeIn">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="font-extrabold text-sm">
                {editingCustomer.firestoreId || editingCustomer.salesplayId
                  ? isAr
                    ? 'تعديل بيانات العميل'
                    : 'Edit Customer ID & Mobile'
                  : isAr
                  ? 'إضافة عميل جديد'
                  : 'Add New Customer'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomerEdit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'رقم العميل (Customer ID) *' : 'Customer ID (Code) *'}
                </label>
                <input
                  type="text"
                  required
                  value={editingCustomer.customerCode}
                  onChange={(e) =>
                    setEditingCustomer({ ...editingCustomer, customerCode: e.target.value })
                  }
                  placeholder="001"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'رقم الجوال (Mobile Number)' : 'Mobile Number'}
                </label>
                <input
                  type="tel"
                  value={editingCustomer.phone}
                  onChange={(e) =>
                    setEditingCustomer({ ...editingCustomer, phone: e.target.value })
                  }
                  placeholder="72095796"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isAr ? 'اسم العميل' : 'Customer Name'}
                </label>
                <input
                  type="text"
                  value={editingCustomer.name}
                  onChange={(e) =>
                    setEditingCustomer({ ...editingCustomer, name: e.target.value })
                  }
                  placeholder="Customer Name"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl font-medium"
                />
              </div>

              {customerEditError && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold">
                  {customerEditError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSavingCustomer}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {isSavingCustomer && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isAr ? 'حفظ التعديلات' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Family Credit Card QR Code Modal */}
      {qrCardCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-200 animate-fadeIn">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-400" />
                <span className="font-extrabold text-sm">
                  {isAr ? 'بطاقة العائلة - رمز QR' : 'Family Credit QR Card'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setQrCardCustomer(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 text-center space-y-4">
              <div className="p-4 rounded-2xl border-2 border-slate-900 bg-slate-50 space-y-2">
                <div className="text-xs font-black text-emerald-800">
                  MAKAREM AL-KHAIR MODERN
                </div>
                <div className="text-lg font-black text-slate-900">{qrCardCustomer.name}</div>
                <div className="text-xs font-mono font-bold text-slate-600">
                  Cust ID: #{qrCardCustomer.customerCode} • {qrCardCustomer.phone || '—'}
                </div>

                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt={`QR ${qrCardCustomer.customerCode}`}
                    className="w-48 h-48 mx-auto rounded-xl border border-slate-200 bg-white p-2"
                  />
                )}

                <div className="text-[10px] text-slate-500 font-mono break-all">
                  {`${window.location.origin}/profile/${qrCardCustomer.customerCode}`}
                </div>
              </div>

              <div className="flex gap-2">
                {qrDataUrl && (
                  <a
                    href={qrDataUrl}
                    download={`makarem-card-${qrCardCustomer.customerCode}.png`}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold text-center"
                  >
                    {isAr ? 'تحميل QR' : 'Download QR'}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer"
                >
                  {isAr ? 'طباعة البطاقة' : 'Print Card'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Barcode / QR Scanner Modal */}
      <QrBarcodeScannerModal
        isOpen={showCustomerScanner}
        onClose={() => setShowCustomerScanner(false)}
        onScanResult={(decoded) => {
          const parsed = extractCustomerIdentifier(decoded);
          setCustomerSearch(parsed);
        }}
        title={isAr ? 'بحث بالباركود أو QR العميل' : 'Scan Customer Barcode / QR'}
        subtitle={
          isAr
            ? 'امسح بطاقة العميل لعرض حسابه وتعديله فوراً'
            : 'Scan customer card QR or barcode to locate and edit profile immediately'
        }
        language={language}
      />

      <ImageUploadModal
        isOpen={Boolean(selectedProductForImage)}
        product={selectedProductForImage}
        onClose={() => setSelectedProductForImage(null)}
        onImageSaved={(productId, newUrl) => {
          if (onUpdateProductImage) {
            onUpdateProductImage(productId, newUrl);
          }
        }}
        language={language}
      />

      <CustomerCreditSettlementModal
        customer={creditCustomerModal}
        onClose={() => {
          setCreditCustomerModal(null);
          loadAdminAnalytics(false);
        }}
        language={language}
      />

      <IntroVideoModal
        videoUrl={videoInput}
        isOpen={showPreviewVideo}
        onClose={() => setShowPreviewVideo(false)}
        language={language}
      />
    </div>
  );
};
