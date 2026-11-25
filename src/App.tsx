import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { ShopStorefront } from './components/ShopStorefront';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer';
import { CustomerProfilePage } from './components/CustomerProfilePage';
import { ActiveOrderTracker } from './components/ActiveOrderTracker';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLoginModal } from './components/AdminLoginModal';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
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
} from './services/customerService';
import {
  subscribeToAdminState,
  logoutAdmin,
  isEmailAuthorizedAdmin,
} from './services/adminAuthService';
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
} from './types';

const CATALOG_CACHE_KEY = 'makarem_salesplay_catalog_v2';
const CATALOG_VERSION_KEY = 'makarem_salesplay_catalog_version';

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

  // Cart & Checkout Drawer
  const [selectedItems, setSelectedItems] = useState<OrderItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Admin Login & Auth State
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(() => {
    const savedEmail = localStorage.getItem('makarem_admin_email');
    return isEmailAuthorizedAdmin(savedEmail);
  });

  // 58mm Thermal Auto-Print Toggle (when Bluetooth printer is paired in Admin Panel)
  const [autoPrintEnabled, setAutoPrintEnabled] = useState<boolean>(false);
  const autoPrintRef = useRef(autoPrintEnabled);
  autoPrintRef.current = autoPrintEnabled;

  // Catalog loaded EXCLUSIVELY from SalesPlay POS + smart daily-cached Firestore media/translations
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

  // URL Navigation synced with History API (/ and /profile)
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

  useEffect(() => {
    const onPopState = () => {
      setCurrentRoute(window.location.pathname.startsWith('/profile') ? 'profile' : 'shop');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Auto-login & redirect cleanly when scanning Family Credit Card QR URL (/profile?cid=001)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const hasQrParam =
      params.has('cid') ||
      params.has('code') ||
      params.has('id') ||
      params.has('phone') ||
      params.has('q') ||
      (window.location.pathname.startsWith('/profile/') &&
        window.location.pathname.length > '/profile/'.length);

    if (!hasQrParam) return;
    const identifier = extractCustomerIdentifier(window.location.href);
    if (!identifier) return;

    loginOrRegisterCustomer(identifier)
      .then((profile) => {
        setCustomerProfile(profile);
        setCurrentRoute('profile');
        window.history.replaceState({ route: 'profile' }, '', '/profile');
      })
      .catch((err) => {
        console.warn('QR redirect login notice:', err);
        setCurrentRoute('profile');
      });
  }, []);

  // Listen to Firebase Admin Auth state
  useEffect(() => {
    const unsub = subscribeToAdminState((isAdmin) => {
      setIsAdminLoggedIn(isAdmin);
      if (!isAdmin && currentRoute === 'admin') {
        setCurrentRoute('shop');
      }
    });
    return () => unsub();
  }, [currentRoute]);

  // Smart daily Firestore sync for Arabic translations & custom product photos (max 1 meta doc check/day per customer)
  useEffect(() => {
    syncFirestoreCatalogEnhancements({ force: false })
      .then(({ translations, media }) => {
        setFirestoreTranslations(translations);
        setProductMediaMap(media);
      })
      .catch(() => null);
  }, []);

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
          : fsTr?.arabicCategory ||
            item.arabicCategory ||
            CATEGORY_ARABIC_MAP[normalizedCat] ||
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

  // Smart delta SalesPlay product sync: only pulls full payload if catalogVersion changed
  const fetchSalesPlayProducts = useCallback(
    async (_showSpinner = false, forcePosRefresh = false): Promise<InventoryItem[]> => {
      try {
        const localVersion = localStorage.getItem(CATALOG_VERSION_KEY) || '';
        const hasCached = loadCachedCatalog().length > 0;
        const params = new URLSearchParams();
        if (forcePosRefresh) {
          params.set('force', '1');
        } else if (hasCached && localVersion) {
          params.set('sinceVersion', localVersion);
        }

        const res = await fetch(`/api/salesplay/products?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await res.json();

        if (data.success && data.unchanged) {
          return loadCachedCatalog();
        }

        if (data.success && Array.isArray(data.products)) {
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
            // ignore quota errors
          }
          return loaded;
        }
        return [];
      } catch (err) {
        console.warn('SalesPlay products fetch error:', err);
        return [];
      } finally {
        setIsLoadingCatalog(false);
      }
    },
    []
  );

  // Admin Refresh & Update Items -> bypass server cache, force Firestore sync, & translate new items via Gemini
  const handleAdminRefreshAndTranslate = useCallback(async () => {
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

    if (untranslated.length === 0) {
      return { totalItems: itemsToCheck.length, translatedNew: 0 };
    }

    const trRes = await translateMissingProducts(untranslated);
    if (trRes.translatedCount > 0) {
      setFirestoreTranslations((prev) => ({ ...prev, ...trRes.translations }));
    }
    return {
      totalItems: itemsToCheck.length,
      translatedNew: trRes.translatedCount,
      translationError: trRes.success ? undefined : trRes.error,
    };
  }, [fetchSalesPlayProducts, rawSalesPlayItems]);

  // Bootstrap Firebase & one-shot delta catalog sync on page open/refresh (no aggressive polling)
  useEffect(() => {
    testFirestoreConnection();

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

    fetchSalesPlayProducts(false, false);
  }, [fetchSalesPlayProducts]);

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
    return loggedIn;
  };

  const handleCustomerLogout = () => {
    clearLocalCustomerProfile();
    setCustomerProfile(null);
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
            onRefreshAndTranslateCatalog={handleAdminRefreshAndTranslate}
            onUpdateProductImage={(productId, imageUrl) =>
              setProductMediaMap((prev) => ({ ...prev, [productId]: imageUrl }))
            }
            autoPrintEnabled={autoPrintEnabled}
            onToggleAutoPrint={setAutoPrintEnabled}
            language={language}
            salesplayShop={salesplayShop}
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
    </div>
  );
}
