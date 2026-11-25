import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { InventoryItem } from '../types';

const LS_TRANSLATIONS_KEY = 'makarem_fs_translations_v1';
const LS_MEDIA_KEY = 'makarem_fs_media_v1';
const LS_META_DATE_KEY = 'makarem_fs_sync_date_v1';
const LS_META_TS_KEY = 'makarem_fs_meta_updated_v1';

export interface ProductTranslationRecord {
  productId: string;
  arabicName: string;
  arabicCategory: string;
  updatedAt: string;
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadCachedFirestoreTranslations(): Record<
  string,
  { arabicName: string; arabicCategory: string }
> {
  try {
    const raw = localStorage.getItem(LS_TRANSLATIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore storage parse error
  }
  return {};
}

export function loadCachedFirestoreMedia(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_MEDIA_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore storage parse error
  }
  return {};
}

/**
 * Bumps single lightweight catalog metadata timestamp (1 Firestore write)
 * when Admin translates items or updates custom images, so customers only check 1 doc/day.
 */
export async function bumpCatalogMetaTimestamp(): Promise<void> {
  try {
    const now = new Date().toISOString();
    await setDoc(doc(db, 'store_settings', 'catalog_meta'), { updatedAt: now }, { merge: true });
    localStorage.setItem(LS_META_TS_KEY, now);
  } catch (err) {
    console.warn('Could not bump catalog_meta:', err);
  }
}

/**
 * Smart Firestore read-budget sync for translations + custom product media:
 * - For normal customers: checks Firestore AT MOST ONCE PER DAY (using localStorage date).
 * - Checks 1 single doc `store_settings/catalog_meta` first: if timestamp unchanged, 0 extra reads!
 * - Only queries updated documents (`where('updatedAt', '>', lastTs)`) when something changed.
 */
export async function syncFirestoreCatalogEnhancements(options?: {
  force?: boolean;
}): Promise<{
  translations: Record<string, { arabicName: string; arabicCategory: string }>;
  media: Record<string, string>;
}> {
  const today = getTodayKey();
  const cachedTranslations = loadCachedFirestoreTranslations();
  const cachedMedia = loadCachedFirestoreMedia();

  const lastSyncDate = localStorage.getItem(LS_META_DATE_KEY);
  const lastMetaTs = localStorage.getItem(LS_META_TS_KEY) || '';

  if (!options?.force && lastSyncDate === today) {
    return { translations: cachedTranslations, media: cachedMedia };
  }

  try {
    const metaSnap = await getDoc(doc(db, 'store_settings', 'catalog_meta'));
    const remoteUpdatedAt = metaSnap.exists()
      ? String(metaSnap.data()?.updatedAt || '')
      : '';

    // If metadata matches what we already synced and we have synced before today, skip collection reads!
    if (!options?.force && lastSyncDate && remoteUpdatedAt && remoteUpdatedAt === lastMetaTs) {
      localStorage.setItem(LS_META_DATE_KEY, today);
      return { translations: cachedTranslations, media: cachedMedia };
    }

    // Fetch only delta documents if we already have a previous sync timestamp
    const trQuery =
      lastMetaTs && !options?.force
        ? query(
            collection(db, 'product_translations'),
            where('updatedAt', '>', lastMetaTs),
            limit(1000)
          )
        : query(collection(db, 'product_translations'), limit(1000));

    const mediaQuery =
      lastMetaTs && !options?.force
        ? query(
            collection(db, 'product_media'),
            where('updatedAt', '>', lastMetaTs),
            limit(1000)
          )
        : query(collection(db, 'product_media'), limit(1000));

    const [trSnap, mediaSnap] = await Promise.all([
      getDocs(trQuery).catch(() => null),
      getDocs(mediaQuery).catch(() => null),
    ]);

    const mergedTranslations = { ...cachedTranslations };
    if (trSnap) {
      trSnap.forEach((d) => {
        const data = d.data();
        if (data.arabicName) {
          mergedTranslations[d.id] = {
            arabicName: String(data.arabicName),
            arabicCategory: String(data.arabicCategory || 'أصناف متنوعة'),
          };
        }
      });
    }

    const mergedMedia = { ...cachedMedia };
    if (mediaSnap) {
      mediaSnap.forEach((d) => {
        const data = d.data();
        if (data.imageUrl) {
          mergedMedia[d.id] = String(data.imageUrl);
        }
      });
    }

    try {
      localStorage.setItem(LS_TRANSLATIONS_KEY, JSON.stringify(mergedTranslations));
      localStorage.setItem(LS_MEDIA_KEY, JSON.stringify(mergedMedia));
      localStorage.setItem(LS_META_DATE_KEY, today);
      localStorage.setItem(LS_META_TS_KEY, remoteUpdatedAt || new Date().toISOString());
    } catch {
      // ignore storage quota
    }

    return { translations: mergedTranslations, media: mergedMedia };
  } catch (err) {
    console.warn('Smart Firestore catalog enhancement sync notice:', err);
    return { translations: cachedTranslations, media: cachedMedia };
  }
}

export async function saveProductTranslationsToFirestore(
  translations: Record<string, { arabicName: string; arabicCategory: string }>
): Promise<void> {
  const entries = Object.entries(translations);
  if (entries.length === 0) return;

  const now = new Date().toISOString();
  const BATCH_LIMIT = 400;

  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const chunk = entries.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const [productId, tr] of chunk) {
      const safeId = productId.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const docRef = doc(db, 'product_translations', safeId);
      batch.set(
        docRef,
        {
          productId,
          arabicName: tr.arabicName,
          arabicCategory: tr.arabicCategory || 'أصناف متنوعة',
          updatedAt: now,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }

  // Update local cache & meta timestamp
  const merged = { ...loadCachedFirestoreTranslations(), ...translations };
  try {
    localStorage.setItem(LS_TRANSLATIONS_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
  await bumpCatalogMetaTimestamp();
}

/**
 * Calls server-side Gemini translator for any newly added products lacking Arabic translation,
 * persists results to Firestore product_translations, and returns the new translations map.
 */
export async function translateMissingProducts(
  untranslatedItems: InventoryItem[]
): Promise<{
  success: boolean;
  translatedCount: number;
  translations: Record<string, { arabicName: string; arabicCategory: string }>;
  error?: string;
}> {
  if (untranslatedItems.length === 0) {
    return { success: true, translatedCount: 0, translations: {} };
  }

  try {
    const res = await fetch('/api/salesplay/translate-products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: untranslatedItems.map((it) => ({
          id: it.id,
          name: it.name,
          category: it.category,
        })),
      }),
    });

    const data = await res.json();
    if (!data.success || !data.translations) {
      return {
        success: false,
        translatedCount: 0,
        translations: {},
        error: data.error || 'Translation request failed',
      };
    }

    const translations = data.translations as Record<
      string,
      { arabicName: string; arabicCategory: string }
    >;

    if (Object.keys(translations).length > 0) {
      await saveProductTranslationsToFirestore(translations).catch((err) =>
        console.warn('Firestore save translations notice:', err)
      );
    }

    return {
      success: true,
      translatedCount: Object.keys(translations).length,
      translations,
    };
  } catch (err) {
    return {
      success: false,
      translatedCount: 0,
      translations: {},
      error: err instanceof Error ? err.message : 'Network error during translation',
    };
  }
}
