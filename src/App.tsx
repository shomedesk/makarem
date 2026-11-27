import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { ShopStorefront } from './components/ShopStorefront';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer';
import { CustomerProfilePage } from './components/CustomerProfilePage';
import { ActiveOrderTracker } from './components/ActiveOrderTracker';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLoginModal } from './components/AdminLoginModal';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { FloatingWhatsAppButton } from './components/FloatingWhatsAppButton';
import { IntroVideoModal } from './components/IntroVideoModal';
import { PRE_TRANSLATED_PRODUCTS, CATEGORY_ARABIC_MAP } from './data/preTranslatedArabic';
import {
  generateOrderNumber,
  createOrderInFirestore,
  subscribeToOrders,
  subscribeToSingleOrder,
} from './services/orderService';
import {
  syncFirestoreCatalogEnhancements,
  loadCachedFirestoreTranslations,
  loadCachedFirestoreMedia,
  translateMissingProducts,
} from './services/translationService';
import {
  loadLocalCustomerProfile,
  clearLocalCustomerProfile,
  loginOrRegisterCustomer,
  extractCustomerIdentifier,
  syncAllSalesPlayCustomersToFirestore,
} from './services/customerService';
import {
  subscribeToAdminState,
  logoutAdmin,
  isEmailAuthorizedAdmin,
} from './services/adminAuthService';
import {
  DEFAULT_WHATSAPP_NUMBER,
  DEFAULT_INTRO_VIDEO_URL,
  DEFAULT_INTRO_VIDEO_VERSION,
  loadCachedPublicConfig,
  fetchPublicStoreConfig,
  saveWhatsAppNumberInFirestore,
  saveIntroVideoInFirestore,
  saveStoreOffersInFirestore,
  fetchCatalogPushMeta,
  fetchCatalogSnapshotFromFirestore,
  fetchBundledCatalogSeed,
  pushCatalogToCustomerDevices,
} from './services/storeConfigService';
import { testFirestoreConnection } from './firebase';
import { playNewOrderChime } from './utils/audio';
import { printOrderTo58mmPrinter } from './utils/thermalPrinter';
import type {
  Order,
  PaymentMethod,
  OrderItem,
  InventoryItem,
  SalesPlayShop,
  CustomerProfile,
  StoreOffer,
} from './types';

const CATALOG_CACHE_KEY = 'makarem_salesplay_catalog_v2';
const CATALOG_VERSION_KEY = 'makarem_salesplay_catalog_version';
const PUSH_VERSION_KEY = 'makarem_admin_push_sync_version_v1';
const SEEN_VIDEO_VER_KEY = 'makarem_seen_intro_video_ver_v1';

type AppRoute = 'shop' | 'profile' | 'admin';

function getInitialRoute(): AppRoute {
  if (typeof window !== 'undefined') {
    if (window.location.pathname.startsWith('/profile')) {
      return 'profile';
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has('cid') || params.has('code')) {
      return 'profile';
    }
  }
  return 'shop';
}

function getUrlCustomerIdentifier(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const hasQrParam =
    params.has('cid') ||
    params.has('code') ||
    params.has('id') ||
    params.has('phone') ||
    params.has('q') ||
    (window.location.pathname.startsWith('/profile/') &&
      window.location.pathname.replace(/\/+$/, '').length > '/profile'.length);

  if (!hasQrParam) return null;
  const id = extractCustomerIdentifier(window.location.href);
  return id || null;
}

function loadCachedCatalog(): InventoryItem[] {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(getInitialRoute);
  const [language, setLanguage] = useState<'en' | 'ar'>('ar');
  const isAr = language === 'ar';
  const languageRef = useRef(language);
  languageRef.current = language;

  // Customer Auth State (persisted across sessions; logout clears it)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(() =>
    loadLocalCustomerProfile()
  );
  const [isUrlAutoLoggingIn, setIsUrlAutoLoggingIn] = useState<boolean>(() =>
    Boolean(getUrlCustomerIdentifier())
  );
  const [urlAutoLoginError, setUrlAutoLoginError] = useState<string | null>(null);

  // Cart & Checkout Drawer
  const [selectedItems, setSelectedItems] = useState<OrderItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Admin Login & Auth State
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => {
    const savedEmail = localStorage.getItem('makarem_admin_email');
    return isEmailAuthorizedAdmin(savedEmail);
  });
  const [isAdminAuthConfirmed, setIsAdminAuthConfirmed] = useState<boolean>(false);
  const [isAdminEmailVerified, setIsAdminEmailVerified] = useState<boolean>(true);

  // Store public config (WhatsApp, Intro Video popup, Today's Offers)
  const initialPublicCfg = React.useMemo(() => loadCachedPublicConfig(), []);
  const [whatsappNumber, setWhatsappNumber] = useState<string>(
    () => initialPublicCfg.whatsappNumber || DEFAULT_WHATSAPP_NUMBER
  );
  const [introVideoUrl, setIntroVideoUrl] = useState<string>(
    () => initialPublicCfg.introVideoUrl ?? DEFAULT_INTRO_VIDEO_URL
  );
  const [, setIntroVideoVersion] = useState<string>(
    () => initialPublicCfg.introVideoVersion || DEFAULT_INTRO_VIDEO_VERSION
  );
  const [offers, setOffers] = useState<StoreOffer[]>(() => initialPublicCfg.offers || []);
  const [showIntroVideo, setShowIntroVideo] = useState<boolean>(false);

  // 58mm Thermal Auto-Print Toggle (when printer is paired in Admin Panel)
  const [autoPrintEnabled, setAutoPrintEnabled] = useState<boolean>(false);
  const autoPrintRef = useRef(autoPrintEnabled);
  autoPrintRef.current = autoPrintEnabled;

  // Catalog loaded from SalesPlay POS + Firestore snapshot fallback + push-triggered sync
  const [rawSalesPlayItems, setRawSalesPlayItems] = useState<InventoryItem[]>(loadCachedCatalog);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(
    () => loadCachedCatalog().length === 0
  );
  const [productMediaMap, setProductMediaMap] = useState<Record<string, string>>(
    loadCachedFirestoreMedia
  );
  const [firestoreTranslations, setFirestoreTranslations] = useState<
    Record<string, { arabicName: string; arabicCategory: string }>
  >(loadCachedFirestoreTranslations);

  // Active customer order tracker
  const [activeOrderId, setActiveOrderId] = useState<string | null>(() => {
    return localStorage.getItem('makarem_active_order_id') || null;
  });
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);

  // Store orders (for Admin Dashboard)
  const [orders, setOrders] = useState<Order[]>([]);
  const knownOrderIdsRef = useRef<Set<string> | null>(null);

  // SalesPlay shop metadata
  const [salesplayShop, setSalesplayShop] = useState<SalesPlayShop | null>(null);

  // URL Navigation synced with History API (/, /profile, /profile/:custid)
  const navigateTo = useCallback(
    (route: AppRoute) => {
      if (route === 'admin' && !isAdminLoggedIn) {
        setShowAdminLoginModal(true);
        return;
      }
      setCurrentRoute(route);
      const targetPath = route === 'profile' ? '/profile' : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ route }, '', targetPath);
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [isAdminLoggedIn]
  );

  // Resolve /profile/:custid (e.g. /profile/001, /profile/1001, /profile/002) or ?cid=001
  const resolveUrlCustomerLogin = useCallback(async (identifier: string) => {
    setIsUrlAutoLoggingIn(true);
    setUrlAutoLoginError(null);
    setCurrentRoute('profile');
    try {
      const profile = await loginOrRegisterCustomer(identifier);
      setCustomerProfile(profile);
      const cleanPath = `/profile/${encodeURIComponent(profile.customerCode)}`;
      if (window.location.pathname !== cleanPath || window.location.search) {
        window.history.replaceState({ route: 'profile' }, '', cleanPath);
      }
    } catch (err: any) {
      console.warn('URL customer auto-login notice:', err);
      setCustomerProfile(null);
      setUrlAutoLoginError(
        err?.message || `No customer account found for ID #${identifier}`
      );
    } finally {
      setIsUrlAutoLoggingIn(false);
    }
  }, []);

  useEffect(() => {
    const initialId = getUrlCustomerIdentifier();
    if (initialId) {
      resolveUrlCustomerLogin(initialId);
    }

    const onPopState = () => {
      if (window.location.pathname.startsWith('/profile')) {
        setCurrentRoute('profile');
        const nextId = getUrlCustomerIdentifier();
        if (nextId) {
          resolveUrlCustomerLogin(nextId);
        }
      } else {
        setCurrentRoute('shop');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [resolveUrlCustomerLogin]);

  // Listen to Firebase Admin Auth state
  useEffect(() => {
    const unsub = subscribeToAdminState((isAdmin, user) => {
      setIsAdminLoggedIn(isAdmin);
      setIsAdminAuthConfirmed(Boolean(isAdmin && user));
      setIsAdminEmailVerified(Boolean(user?.emailVerified));
      if (!isAdmin && currentRoute === 'admin') {
        setCurrentRoute('shop');
      }
    });
    return () => unsub();
  }, [currentRoute]);

  // Build enriched catalog from real SalesPlay items + pre-translations + Firestore translations
  const catalog: InventoryItem[] = React.useMemo(() => {
    return rawSalesPlayItems.map((item) => {
      const safeKey = item.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const fsTr = firestoreTranslations[safeKey] || firestoreTranslations[item.id];
      const staticAr = PRE_TRANSLATED_PRODUCTS[item.id];
      const normalizedCat =
        !item.category || item.category === 'No category' ? 'Uncategorized' : item.category;

      const hasArabicTranslation = Boolean(fsTr?.arabicName || staticAr || item.arabicName);
      const arabicName = fsTr?.arabicName || staticAr || item.arabicName || item.name;
      const arabicCategory =
        normalizedCat === 'Uncategorized'
          ? 'غير مصنف'
          : CATEGORY_ARABIC_MAP[normalizedCat] ||
            fsTr?.arabicCategory ||
            item.arabicCategory ||
            normalizedCat;

      const customImg =
        productMediaMap[item.id] ||
        (item.productCode ? productMediaMap[item.productCode] : undefined) ||
        item.imageUrl ||
        '';

      return {
        ...item,
        category: normalizedCat,
        arabicName,
        arabicCategory,
        hasArabicTranslation,
        imageUrl: customImg,
      };
    });
  }, [rawSalesPlayItems, productMediaMap, firestoreTranslations]);

  // Fetch live SalesPlay POS catalog with retry + Firestore snapshot fallback (guarantees launch NEVER shows empty!)
  const fetchSalesPlayProducts = useCallback(
    async (_showSpinner = false, forcePosRefresh = false): Promise<InventoryItem[]> => {
      const tryBackendFetch = async (attempt: number): Promise<InventoryItem[] | null> => {
        try {
          const localVersion = localStorage.getItem(CATALOG_VERSION_KEY) || '';
          const hasCached = loadCachedCatalog().length > 0;
          const params = new URLSearchParams();
          if (forcePosRefresh) {
            params.set('force', '1');
          } else if (hasCached && localVersion) {
            params.set('sinceVersion', localVersion);
          }

          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 12000);
          const res = await fetch(`/api/salesplay/products?${params.toString()}`, {
            cache: 'no-store',
            signal: controller.signal,
          }).finally(() => window.clearTimeout(timeoutId));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          if (data.success && data.unchanged) {
            return loadCachedCatalog();
          }

          if (data.success && Array.isArray(data.products) && data.products.length > 0) {
            const loaded: InventoryItem[] = data.products.map((sp: any) => ({
              id: sp.id,
              productCode: sp.productCode || '',
              name: sp.name,
              arabicName: sp.arabicName || '',
              category:
                !sp.category || sp.category === 'No category'
                  ? 'Uncategorized'
                  : sp.category,
              arabicCategory: sp.arabicCategory || '',
              price: Number(sp.price || 0),
              unit: sp.unit || 'pcs',
              stock: sp.stock !== undefined ? Number(sp.stock) : 0,
              stockControl: Boolean(sp.stockControl),
              barcode: sp.barcode || '',
              salesplayItemId: sp.id,
              imageUrl: sp.imageUrl || '',
            }));

            setRawSalesPlayItems(loaded);
            try {
              localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(loaded));
              if (data.catalogVersion) {
                localStorage.setItem(CATALOG_VERSION_KEY, String(data.catalogVersion));
              }
            } catch {
              // ignore storage quota errors
            }
            return loaded;
          }
          return null;
        } catch (err) {
          if (attempt < 1) {
            await new Promise((r) => setTimeout(r, 1200));
            return tryBackendFetch(attempt + 1);
          }
          console.warn('SalesPlay products fetch error:', err);
          return null;
        }
      };

      try {
        // Hydrate immediately from bundled seed on cold launch if cache is empty so store never flashes blank
        let seedItems: InventoryItem[] = [];
        if (loadCachedCatalog().length === 0) {
          fetchBundledCatalogSeed()
            .then((seeded) => {
              if (seeded.length > 0) {
                seedItems = seeded;
                setRawSalesPlayItems((prev) => (prev.length === 0 ? seeded : prev));
                setIsLoadingCatalog(false);
              }
            })
            .catch(() => null);
        }

        const backendProducts = await tryBackendFetch(0);
        if (backendProducts && backendProducts.length > 0) {
          return backendProducts;
        }

        // Resilience fallback 1: compact catalog snapshot stored in Firestore
        const snapshot = await fetchCatalogSnapshotFromFirestore();
        if (snapshot && snapshot.products.length > 0) {
          setRawSalesPlayItems(snapshot.products);
          try {
            localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(snapshot.products));
            if (snapshot.catalogSyncVersion) {
              localStorage.setItem(PUSH_VERSION_KEY, snapshot.catalogSyncVersion);
            }
          } catch {
            // ignore storage errors
          }
          return snapshot.products;
        }

        // Resilience fallback 2: static /catalog-seed.json bundled with the build
        const bundled = seedItems.length > 0 ? seedItems : await fetchBundledCatalogSeed();
        if (bundled.length > 0) {
          setRawSalesPlayItems(bundled);
          try {
            localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(bundled));
          } catch {
            // ignore storage errors
          }
          return bundled;
        }
        return [];
      } finally {
        setIsLoadingCatalog(false);
      }
    },
    []
  );

  // Admin "Sync to Customer Devices": refreshes SalesPlay POS + translates new items + pushes snapshot/version + customer ledgers
  const handleSyncToCustomerDevices = useCallback(async () => {
    const [freshItems, freshFs] = await Promise.all([
      fetchSalesPlayProducts(true, true),
      syncFirestoreCatalogEnhancements({ force: true }),
    ]);
    setFirestoreTranslations(freshFs.translations);
    setProductMediaMap(freshFs.media);

    const itemsToCheck = freshItems.length > 0 ? freshItems : rawSalesPlayItems;

    const untranslated = itemsToCheck.filter((it) => {
      const safeKey = it.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const hasFs = Boolean(
        freshFs.translations[safeKey]?.arabicName || freshFs.translations[it.id]?.arabicName
      );
      const hasPre = Boolean(PRE_TRANSLATED_PRODUCTS[it.id]);
      return !hasFs && !hasPre;
    });

    let translatedNew = 0;
    let translationError: string | undefined;

    if (untranslated.length > 0) {
      const trRes = await translateMissingProducts(untranslated);
      translatedNew = trRes.translatedCount;
      if (!trRes.success) {
        translationError = trRes.error;
      }
      if (trRes.translatedCount > 0) {
        setFirestoreTranslations((prev) => ({ ...prev, ...trRes.translations }));
      }
    }

    let pushedToDevices = false;
    let customersSynced = 0;
    let ledgersSynced = 0;
    let ledgersWritten = 0;
    let failedLedgers = 0;
    let posConnected: boolean | undefined = undefined;
    let requiresAuth = false;
    let requiresVerifiedEmail = false;
    let syncError: string | undefined;

    const newPushVersion = String(Date.now());
    const [catalogPushResult, custSyncResult] = await Promise.allSettled([
      itemsToCheck.length > 0
        ? pushCatalogToCustomerDevices(itemsToCheck, newPushVersion)
        : Promise.resolve(),
      syncAllSalesPlayCustomersToFirestore({ syncLedgers: true }),
    ]);

    if (catalogPushResult.status === 'fulfilled') {
      if (itemsToCheck.length > 0) {
        try {
          localStorage.setItem(PUSH_VERSION_KEY, newPushVersion);
        } catch {
          // ignore
        }
        pushedToDevices = true;
      }
    } else {
      const errMsg = catalogPushResult.reason?.message || 'Could not push catalog to Firestore';
      syncError = errMsg;
      console.warn('Catalog push failed:', catalogPushResult.reason);
    }

    if (custSyncResult.status === 'fulfilled') {
      const custSync = custSyncResult.value;
      customersSynced = custSync.customersSynced;
      ledgersSynced = custSync.ledgersTotal;
      ledgersWritten = custSync.ledgersWritten;
      failedLedgers = custSync.failedLedgers;
      posConnected = custSync.posConnected;
      requiresAuth = Boolean(custSync.requiresAuth);
      requiresVerifiedEmail = Boolean(custSync.requiresVerifiedEmail);
      if (custSync.errors && custSync.errors.length > 0) {
        syncError = custSync.errors[0];
      }
      if (custSync.posConnected && custSync.ledgersTotal > 0) {
        try {
          localStorage.setItem('makarem_cust_ledger_sync_v3', '1');
        } catch {
          // ignore
        }
      }
    } else {
      const errMsg = custSyncResult.reason?.message || 'Customer ledger sync failed';
      syncError = syncError ? `${syncError}; ${errMsg}` : errMsg;
      console.warn('Customer sync failed:', custSyncResult.reason);
    }

    return {
      totalItems: itemsToCheck.length,
      translatedNew,
      translationError,
      pushedToDevices,
      customersSynced,
      ledgersSynced,
      ledgersWritten,
      failedLedgers,
      posConnected,
      requiresAuth,
      requiresVerifiedEmail,
      syncError,
    };
  }, [fetchSalesPlayProducts, rawSalesPlayItems]);

  // Bootstrap store settings, WhatsApp number, and Smart Push-Triggered Catalog Sync on app open/refresh
  useEffect(() => {
    testFirestoreConnection();

    fetchPublicStoreConfig()
      .then((cfg) => {
        setWhatsappNumber(cfg.whatsappNumber || DEFAULT_WHATSAPP_NUMBER);
        setIntroVideoUrl(cfg.introVideoUrl);
        setIntroVideoVersion(cfg.introVideoVersion);
        setOffers(cfg.offers || []);

        const hasVideo = Boolean(cfg.introVideoUrl && cfg.introVideoUrl.trim());
        const ver = cfg.introVideoVersion || DEFAULT_INTRO_VIDEO_VERSION;
        let seenVer = '';
        try {
          seenVer = localStorage.getItem(SEEN_VIDEO_VER_KEY) || '';
        } catch {
          seenVer = '';
        }

        const isAdminView = window.location.pathname.startsWith('/admin');
        const hasQrDirectLogin = Boolean(getUrlCustomerIdentifier());
        const isFirstDefaultVideo = ver === DEFAULT_INTRO_VIDEO_VERSION;
        const alreadyLoggedIn = Boolean(loadLocalCustomerProfile());

        if (hasVideo && !isAdminView && !hasQrDirectLogin && seenVer !== ver) {
          if (isFirstDefaultVideo && alreadyLoggedIn) {
            try {
              localStorage.setItem(SEEN_VIDEO_VER_KEY, ver);
            } catch {
              // ignore storage error
            }
          } else {
            setShowIntroVideo(true);
            try {
              localStorage.setItem(SEEN_VIDEO_VER_KEY, ver);
            } catch {
              // ignore storage error
            }
          }
        }
      })
      .catch(() => null);

    fetch('/api/salesplay/status', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (data.connected) {
          setSalesplayShop({
            id: data.shopId,
            shop_name: data.shopName,
            terminal_list: data.terminals || [],
            is_enable: '1',
          });
        }
      })
      .catch(() => null);

    const bootstrapCatalogSmartly = async () => {
      const cachedItems = loadCachedCatalog();
      const localPushVer = localStorage.getItem(PUSH_VERSION_KEY) || '';
      const remoteMeta = await fetchCatalogPushMeta();
      const remotePushVer = remoteMeta?.catalogSyncVersion || '';

      const isColdLaunch = cachedItems.length === 0;
      const adminPushedUpdate = Boolean(remotePushVer && remotePushVer !== localPushVer);

      if (isColdLaunch || adminPushedUpdate) {
        // First time ever OR Admin clicked "Sync to Customer Devices": fetch full items, categories, translations & media once!
        await Promise.all([
          fetchSalesPlayProducts(false, adminPushedUpdate),
          syncFirestoreCatalogEnhancements({ force: true }).then(({ translations, media }) => {
            setFirestoreTranslations(translations);
            setProductMediaMap(media);
          }),
        ]);
        if (remotePushVer) {
          try {
            localStorage.setItem(PUSH_VERSION_KEY, remotePushVer);
          } catch {
            // ignore
          }
        }
      } else {
        // Already synced up to Admin's latest push -> zero POS API calls & zero extra Firestore reads!
        setIsLoadingCatalog(false);
      }
    };

    bootstrapCatalogSmartly();
  }, [fetchSalesPlayProducts]);

  // Ensure Firestore catalog_snapshot & POS customer ledgers exist ONLY after Firebase Admin Auth token is ready
  useEffect(() => {
    if (!isAdminAuthConfirmed) return;

    fetchCatalogPushMeta()
      .then(async (meta) => {
        if (!meta) {
          const items =
            rawSalesPlayItems.length > 0 ? rawSalesPlayItems : await fetchSalesPlayProducts(false, false);
          if (items.length > 0) {
            const ver = String(Date.now());
            await pushCatalogToCustomerDevices(items, ver).catch(() => null);
            try {
              localStorage.setItem(PUSH_VERSION_KEY, ver);
            } catch {
              // ignore
            }
          }
        }
        const ledgerBootstrapDone = localStorage.getItem('makarem_cust_ledger_sync_v3') === '1';
        if (!meta || !ledgerBootstrapDone) {
          const custRes = await syncAllSalesPlayCustomersToFirestore({ syncLedgers: true }).catch(
            () => null
          );
          if (custRes && custRes.posConnected && custRes.ledgersTotal > 0) {
            try {
              localStorage.setItem('makarem_cust_ledger_sync_v3', '1');
            } catch {
              // ignore
            }
          }
        }
      })
      .catch(() => null);
  }, [isAdminAuthConfirmed]);

  // Real-time orders listener (Admin only) + Sound Chime + 58mm Auto-Print
  useEffect(() => {
    if (!isAdminLoggedIn) {
      setOrders([]);
      knownOrderIdsRef.current = null;
      return;
    }

    const unsubscribe = subscribeToOrders((newOrders) => {
      setOrders(newOrders);

      if (knownOrderIdsRef.current === null) {
        knownOrderIdsRef.current = new Set(newOrders.map((o) => o.id));
        return;
      }

      const newlyArrivedPending = newOrders.filter(
        (o) => !knownOrderIdsRef.current!.has(o.id) && o.status === 'pending'
      );

      for (const ord of newOrders) {
        knownOrderIdsRef.current.add(ord.id);
      }

      if (newlyArrivedPending.length > 0) {
        playNewOrderChime();
        if (autoPrintRef.current) {
          for (const ord of newlyArrivedPending) {
            printOrderTo58mmPrinter(ord, languageRef.current, false).catch(() => null);
          }
        }
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isAdminLoggedIn]);

  // Real-time listener for active customer order
  useEffect(() => {
    if (!activeOrderId) return;
    const unsubscribe = subscribeToSingleOrder(activeOrderId, (order) => {
      if (order) {
        setActiveOrder(order);
      } else {
        localStorage.removeItem('makarem_active_order_id');
        setActiveOrder(null);
        setActiveOrderId(null);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeOrderId]);

  const handleUpdateQuantity = (item: InventoryItem, delta: number) => {
    setSelectedItems((prev) => {
      const existing = prev.find((i) => i.productId === item.id);
      const currentQty = existing ? existing.quantity : 0;
      const availableStock = item.stockControl ? Number(item.stock) : 9999;

      if (delta > 0 && currentQty + delta > availableStock) {
        return prev;
      }

      if (!existing && delta > 0) {
        return [
          ...prev,
          {
            id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            productId: item.id,
            name: item.name,
            arabicName: item.arabicName,
            unit: item.unit,
            price: item.price,
            quantity: 1,
            total: Number(item.price.toFixed(3)),
            salesplayProductId: item.salesplayItemId,
            barcode: item.barcode,
          },
        ];
      }

      if (existing) {
        const newQty = existing.quantity + delta;
        if (newQty <= 0) {
          return prev.filter((i) => i.productId !== item.id);
        }
        return prev.map((i) =>
          i.productId === item.id
            ? { ...i, quantity: newQty, total: Number((newQty * i.price).toFixed(3)) }
            : i
        );
      }
      return prev;
    });
  };

  const handleUpdateQtyById = (productId: string, delta: number) => {
    const matched = catalog.find((c) => c.id === productId);
    if (matched) {
      handleUpdateQuantity(matched, delta);
      return;
    }
    setSelectedItems((prev) =>
      prev
        .map((i) => {
          if (i.productId !== productId) return i;
          const nextQ = i.quantity + delta;
          if (nextQ <= 0) return null;
          return { ...i, quantity: nextQ, total: Number((nextQ * i.price).toFixed(3)) };
        })
        .filter(Boolean) as OrderItem[]
    );
  };

  const handleCustomerLogin = async (identifier: string): Promise<CustomerProfile> => {
    const loggedIn = await loginOrRegisterCustomer(identifier);
    setCustomerProfile(loggedIn);
    setUrlAutoLoginError(null);
    return loggedIn;
  };

  const handleCustomerLogout = () => {
    clearLocalCustomerProfile();
    setCustomerProfile(null);
    setUrlAutoLoginError(null);
    if (window.location.pathname !== '/profile') {
      window.history.replaceState({ route: 'profile' }, '', '/profile');
    }
  };

  const handleSaveWhatsAppNumber = async (phone: string) => {
    const saved = await saveWhatsAppNumberInFirestore(phone);
    setWhatsappNumber(saved);
    return saved;
  };

  const handleSaveIntroVideo = async (url: string) => {
    const saved = await saveIntroVideoInFirestore(url);
    setIntroVideoUrl(saved.introVideoUrl);
    setIntroVideoVersion(saved.introVideoVersion);
    return saved;
  };

  const handleSaveOffers = async (nextOffers: StoreOffer[]) => {
    const saved = await saveStoreOffersInFirestore(nextOffers);
    setOffers(saved);
    return saved;
  };

  const handleConfirmOrder = async ({
    customer,
    paymentMethod,
    notes,
  }: {
    customer: CustomerProfile;
    paymentMethod: PaymentMethod;
    notes: string;
  }) => {
    const subtotal = selectedItems.reduce((acc, i) => acc + i.total, 0);
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const orderNum = generateOrderNumber();
    const now = new Date().toISOString();

    // Note: Online orders NEVER modify SalesPlay stock or receipts; final billing is done inside SalesPlay POS.
    const newOrder: Order = {
      id: orderId,
      orderNumber: orderNum,
      orderType: 'ecommerce',
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.name || `Customer #${customer.customerCode}`,
      customerPhone: customer.phone || `#${customer.customerCode}`,
      paymentMethod,
      paymentStatus: 'pending',
      status: 'pending',
      items: selectedItems,
      customNotes: notes,
      subtotal: Number(subtotal.toFixed(3)),
      tax: 0,
      totalAmount: Number(subtotal.toFixed(3)),
      salesplaySyncStatus: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await createOrderInFirestore(newOrder);
    setActiveOrderId(orderId);
    setActiveOrder(newOrder);
    localStorage.setItem('makarem_active_order_id', orderId);
    setSelectedItems([]);
  };

  const handleStartNewOrder = () => {
    localStorage.removeItem('makarem_active_order_id');
    setActiveOrderId(null);
    setActiveOrder(null);
    navigateTo('shop');
  };

  const handleAdminLogout = async () => {
    await logoutAdmin();
    setIsAdminLoggedIn(false);
    navigateTo('shop');
  };

  const cartItemCount = selectedItems.reduce((acc, i) => acc + i.quantity, 0);
  const showStickyCartBar =
    currentRoute === 'shop' && !activeOrder && cartItemCount > 0;

  return (
    <div
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-slate-100/80 text-slate-900 flex flex-col font-sans"
    >
      <PwaInstallPrompt language={language} />

      <Navbar
        currentRoute={currentRoute}
        onNavigate={navigateTo}
        language={language}
        onLanguageChange={setLanguage}
        customerProfile={customerProfile}
        cartCount={cartItemCount}
        onOpenCart={() => setIsCartOpen(true)}
        isAdminLoggedIn={isAdminLoggedIn}
        onAdminLogout={handleAdminLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6">
        {currentRoute === 'admin' && isAdminLoggedIn ? (
          <AdminDashboard
            orders={orders}
            catalog={catalog}
            onRefreshAndTranslateCatalog={handleSyncToCustomerDevices}
            onUpdateProductImage={(productId, imageUrl) =>
              setProductMediaMap((prev) => ({ ...prev, [productId]: imageUrl }))
            }
            autoPrintEnabled={autoPrintEnabled}
            onToggleAutoPrint={setAutoPrintEnabled}
            whatsappNumber={whatsappNumber}
            onSaveWhatsAppNumber={handleSaveWhatsAppNumber}
            introVideoUrl={introVideoUrl}
            onSaveIntroVideo={handleSaveIntroVideo}
            offers={offers}
            onSaveOffers={handleSaveOffers}
            language={language}
            salesplayShop={salesplayShop}
            isFirebaseAdminSignedIn={isAdminAuthConfirmed}
            isAdminEmailVerified={isAdminEmailVerified}
            onReauthenticateAdmin={() => setShowAdminLoginModal(true)}
          />
        ) : currentRoute === 'profile' ? (
          <CustomerProfilePage
            profile={customerProfile}
            onLogin={handleCustomerLogin}
            onLogout={handleCustomerLogout}
            onBackToShop={() => navigateTo('shop')}
            onTrackOrder={(ord) => {
              setActiveOrderId(ord.id);
              setActiveOrder(ord);
              navigateTo('shop');
            }}
            onProfileRefreshed={(updated) => setCustomerProfile(updated)}
            isAutoLoggingIn={isUrlAutoLoggingIn}
            autoLoginError={urlAutoLoginError}
            language={language}
          />
        ) : activeOrder ? (
          <ActiveOrderTracker
            order={activeOrder}
            onNewOrder={handleStartNewOrder}
            language={language}
          />
        ) : (
          <ShopStorefront
            catalog={catalog}
            isLoadingCatalog={isLoadingCatalog}
            selectedItems={selectedItems}
            onUpdateQuantity={handleUpdateQuantity}
            onOpenCart={() => setIsCartOpen(true)}
            offers={offers}
            language={language}
          />
        )}
      </main>

      <footer className="mt-auto py-5 border-t border-slate-200 bg-white text-xs text-slate-500 font-['Cairo',sans-serif]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-slate-900 text-sm">
              {isAr ? 'مكارم الخير الحديثة' : 'Makarem Al-Khair Modern Grocery'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigateTo('profile')}
              className="text-xs font-semibold text-slate-500 hover:text-emerald-700 cursor-pointer"
            >
              {isAr ? 'حسابي والمشتريات' : 'My Profile'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (isAdminLoggedIn) {
                  navigateTo('admin');
                } else {
                  setShowAdminLoginModal(true);
                }
              }}
              className="text-xs text-slate-400 hover:text-emerald-700 underline font-mono cursor-pointer"
            >
              Admin
            </button>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp Corner Support Button (Customer Views) */}
      {currentRoute !== 'admin' && (
        <FloatingWhatsAppButton
          whatsappNumber={whatsappNumber}
          language={language}
          liftForCartBar={showStickyCartBar}
        />
      )}

      <CartCheckoutDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={selectedItems}
        onUpdateQtyById={handleUpdateQtyById}
        customerProfile={customerProfile}
        onLoginCustomer={handleCustomerLogin}
        onConfirmOrder={handleConfirmOrder}
        language={language}
      />

      <AdminLoginModal
        isOpen={showAdminLoginModal}
        onClose={() => setShowAdminLoginModal(false)}
        onLoginSuccess={() => {
          setIsAdminLoggedIn(true);
          navigateTo('admin');
        }}
        language={language}
      />

      {currentRoute !== 'admin' && (
        <IntroVideoModal
          videoUrl={introVideoUrl}
          isOpen={showIntroVideo}
          onClose={() => setShowIntroVideo(false)}
          language={language}
        />
      )}
    </div>
  );
}
