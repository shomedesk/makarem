import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { InventoryItem, StoreOffer } from '../types';

export const DEFAULT_WHATSAPP_NUMBER = '72095796';
export const DEFAULT_INTRO_VIDEO_URL = 'https://youtu.be/jShbHCCsW60?si=fcuFhWytTMLxSQkD';
export const DEFAULT_INTRO_VIDEO_VERSION = 'v1_default';

const LS_PUBLIC_CONFIG_KEY = 'makarem_public_config_v2';

export interface PublicStoreConfig {
  whatsappNumber: string;
  introVideoUrl: string;
  introVideoVersion: string;
  offers: StoreOffer[];
  updatedAt: string;
}

export interface CatalogMetaConfig {
  catalogSyncVersion: string;
  itemCount: number;
  updatedAt: string;
}

export function normalizeWhatsAppDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '96872095796';
  if (digits.startsWith('00')) return digits.slice(2);
  // 8-digit Oman mobile (e.g. 72095796 or 9xxxxxxx)
  if (digits.length === 8 && (digits.startsWith('7') || digits.startsWith('9'))) {
    return `968${digits}`;
  }
  return digits;
}

export function formatWhatsAppUrl(rawPhone: string, message?: string): string {
  const fullDigits = normalizeWhatsAppDigits(rawPhone || DEFAULT_WHATSAPP_NUMBER);
  const base = `https://wa.me/${fullDigits}`;
  if (message && message.trim()) {
    return `${base}?text=${encodeURIComponent(message.trim())}`;
  }
  return base;
}

export function loadCachedPublicConfig(): PublicStoreConfig {
  try {
    const raw = localStorage.getItem(LS_PUBLIC_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        whatsappNumber: String(parsed?.whatsappNumber || DEFAULT_WHATSAPP_NUMBER),
        introVideoUrl: String(parsed?.introVideoUrl ?? DEFAULT_INTRO_VIDEO_URL),
        introVideoVersion: String(parsed?.introVideoVersion || DEFAULT_INTRO_VIDEO_VERSION),
        offers: Array.isArray(parsed?.offers) ? parsed.offers : [],
        updatedAt: String(parsed?.updatedAt || ''),
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    whatsappNumber: DEFAULT_WHATSAPP_NUMBER,
    introVideoUrl: DEFAULT_INTRO_VIDEO_URL,
    introVideoVersion: DEFAULT_INTRO_VIDEO_VERSION,
    offers: [],
    updatedAt: '',
  };
}

function saveCachedPublicConfig(cfg: PublicStoreConfig): void {
  try {
    localStorage.setItem(LS_PUBLIC_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // ignore storage errors
  }
}

export async function fetchPublicStoreConfig(): Promise<PublicStoreConfig> {
  const fallback = loadCachedPublicConfig();
  try {
    const snap = await getDoc(doc(db, 'store_settings', 'public_config'));
    if (snap.exists()) {
      const data = snap.data();
      let offers: StoreOffer[] = [];
      if (typeof data?.offersSerialized === 'string' && data.offersSerialized.trim()) {
        try {
          const parsed = JSON.parse(data.offersSerialized);
          if (Array.isArray(parsed)) offers = parsed;
        } catch {
          offers = [];
        }
      }

      const cfg: PublicStoreConfig = {
        whatsappNumber: String(data?.whatsappNumber || '').trim() || DEFAULT_WHATSAPP_NUMBER,
        introVideoUrl:
          data?.introVideoUrl !== undefined
            ? String(data.introVideoUrl || '').trim()
            : DEFAULT_INTRO_VIDEO_URL,
        introVideoVersion:
          String(data?.introVideoVersion || '').trim() || DEFAULT_INTRO_VIDEO_VERSION,
        offers,
        updatedAt: String(data?.updatedAt || ''),
      };
      saveCachedPublicConfig(cfg);
      return cfg;
    }
  } catch (err) {
    console.warn('Could not fetch public store config:', err);
  }
  return fallback;
}

export async function saveWhatsAppNumberInFirestore(phoneInput: string): Promise<string> {
  const cleaned = phoneInput.trim() || DEFAULT_WHATSAPP_NUMBER;
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'store_settings', 'public_config'),
    {
      whatsappNumber: cleaned,
      updatedAt: now,
    },
    { merge: true }
  );
  const current = loadCachedPublicConfig();
  saveCachedPublicConfig({ ...current, whatsappNumber: cleaned, updatedAt: now });
  return cleaned;
}

export async function saveIntroVideoInFirestore(videoUrlInput: string): Promise<{
  introVideoUrl: string;
  introVideoVersion: string;
}> {
  const cleaned = videoUrlInput.trim();
  const newVersion = cleaned ? `vid_${Date.now()}` : `off_${Date.now()}`;
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'store_settings', 'public_config'),
    {
      introVideoUrl: cleaned,
      introVideoVersion: newVersion,
      updatedAt: now,
    },
    { merge: true }
  );
  const current = loadCachedPublicConfig();
  saveCachedPublicConfig({
    ...current,
    introVideoUrl: cleaned,
    introVideoVersion: newVersion,
    updatedAt: now,
  });
  return { introVideoUrl: cleaned, introVideoVersion: newVersion };
}

export async function saveStoreOffersInFirestore(offers: StoreOffer[]): Promise<StoreOffer[]> {
  const now = new Date().toISOString();
  const offersSerialized = JSON.stringify(offers);
  await setDoc(
    doc(db, 'store_settings', 'public_config'),
    {
      offersSerialized,
      updatedAt: now,
    },
    { merge: true }
  );
  const current = loadCachedPublicConfig();
  saveCachedPublicConfig({ ...current, offers, updatedAt: now });
  return offers;
}

export async function fetchCatalogPushMeta(): Promise<CatalogMetaConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'store_settings', 'catalog_meta'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      catalogSyncVersion: String(data?.catalogSyncVersion || data?.updatedAt || ''),
      itemCount: Number(data?.itemCount || 0),
      updatedAt: String(data?.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

function parseCompactCatalogItems(parsed: any[]): InventoryItem[] {
  return parsed.map((p: any) => ({
    id: String(p.i || p.id || ''),
    productCode: String(p.c || p.productCode || ''),
    name: String(p.n || p.name || ''),
    arabicName: String(p.an || p.arabicName || ''),
    category: String(p.g || p.category || 'Uncategorized'),
    price: Number(p.p ?? p.price ?? 0),
    stock: Number(p.s ?? p.stock ?? 0),
    stockControl: Boolean(p.sc ?? p.stockControl),
    unit: String(p.u || p.unit || 'pcs'),
    barcode: String(p.b || p.barcode || ''),
    salesplayItemId: String(p.i || p.id || ''),
    imageUrl: String(p.m || p.imageUrl || ''),
  }));
}

export async function fetchCatalogSnapshotFromFirestore(): Promise<{
  catalogSyncVersion: string;
  products: InventoryItem[];
} | null> {
  try {
    const snap = await getDoc(doc(db, 'store_settings', 'catalog_snapshot'));
    if (!snap.exists()) return null;
    const data = snap.data();
    const rawStr = String(data?.itemsSerialized || '');
    if (!rawStr) return null;
    const parsed = JSON.parse(rawStr);
    if (!Array.isArray(parsed)) return null;

    return {
      catalogSyncVersion: String(data?.catalogSyncVersion || data?.updatedAt || ''),
      products: parseCompactCatalogItems(parsed),
    };
  } catch (err) {
    console.warn('Failed to parse catalog snapshot:', err);
    return null;
  }
}

export async function fetchBundledCatalogSeed(): Promise<InventoryItem[]> {
  try {
    const res = await fetch('/catalog-seed.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const parsed = await res.json();
    if (!Array.isArray(parsed)) return [];
    return parseCompactCatalogItems(parsed);
  } catch (err) {
    console.warn('Failed to load bundled catalog seed:', err);
    return [];
  }
}

export async function pushCatalogToCustomerDevices(
  items: InventoryItem[],
  syncVersion: string
): Promise<void> {
  const now = new Date().toISOString();
  // Store compact keys so 500+ items easily stay under ~120 KB (limit 1 MB)
  const compactList = items.map((p) => ({
    i: p.id,
    c: p.productCode || '',
    n: p.name,
    g: p.category || 'Uncategorized',
    p: Number(p.price || 0),
    s: Number(p.stock || 0),
    sc: p.stockControl ? 1 : 0,
    u: p.unit || 'pcs',
    b: p.barcode || '',
    ...(p.imageUrl && p.imageUrl.length < 400 ? { m: p.imageUrl } : {}),
  }));

  const itemsSerialized = JSON.stringify(compactList);

  await setDoc(
    doc(db, 'store_settings', 'catalog_snapshot'),
    {
      catalogSyncVersion: syncVersion,
      itemCount: items.length,
      itemsSerialized,
      updatedAt: now,
    },
    { merge: true }
  );

  await setDoc(
    doc(db, 'store_settings', 'catalog_meta'),
    {
      catalogSyncVersion: syncVersion,
      itemCount: items.length,
      updatedAt: now,
    },
    { merge: true }
  );
}
