import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { InventoryItem } from '../types';

export const DEFAULT_WHATSAPP_NUMBER = '72095796';
const LS_WHATSAPP_KEY = 'makarem_whatsapp_number_v1';

export interface PublicStoreConfig {
  whatsappNumber: string;
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

export function loadCachedWhatsAppNumber(): string {
  try {
    const val = localStorage.getItem(LS_WHATSAPP_KEY);
    if (val && val.trim()) return val.trim();
  } catch {
    // ignore storage errors
  }
  return DEFAULT_WHATSAPP_NUMBER;
}

export async function fetchPublicStoreConfig(): Promise<PublicStoreConfig> {
  const fallback = loadCachedWhatsAppNumber();
  try {
    const snap = await getDoc(doc(db, 'store_settings', 'public_config'));
    if (snap.exists()) {
      const data = snap.data();
      const num = String(data?.whatsappNumber || '').trim() || DEFAULT_WHATSAPP_NUMBER;
      try {
        localStorage.setItem(LS_WHATSAPP_KEY, num);
      } catch {
        // ignore
      }
      return {
        whatsappNumber: num,
        updatedAt: String(data?.updatedAt || ''),
      };
    }
  } catch (err) {
    console.warn('Could not fetch public store config:', err);
  }
  return { whatsappNumber: fallback, updatedAt: '' };
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
  try {
    localStorage.setItem(LS_WHATSAPP_KEY, cleaned);
  } catch {
    // ignore
  }
  return cleaned;
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

    const products: InventoryItem[] = parsed.map((p: any) => ({
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

    return {
      catalogSyncVersion: String(data?.catalogSyncVersion || data?.updatedAt || ''),
      products,
    };
  } catch (err) {
    console.warn('Failed to parse catalog snapshot:', err);
    return null;
  }
}

export async function pushCatalogToCustomerDevices(
  items: InventoryItem[],
  syncVersion: string
): Promise<void> {
  const now = new Date().toISOString();
  // Store compact keys so 500+ items easily stay under ~100 KB (limit 1 MB)
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
