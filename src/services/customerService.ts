import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AdminCustomerRecord,
  CustomerProfile,
  Order,
  SalesPlayCustomerProfileResponse,
} from '../types';

const STORAGE_KEY_PROFILE = 'makarem_customer_profile';

export function normalizePhoneNumber(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00968') && digits.length >= 13) return digits.slice(5);
  if (digits.startsWith('968') && digits.length >= 11) return digits.slice(3);
  return digits.replace(/^0+/, '') || digits;
}

export function formatCustomerCode(seq: number): string {
  return String(seq).padStart(3, '0');
}

/**
 * Extracts a customer ID / phone number from raw user input OR scanned QR code / URL
 * (e.g. "https://makarem.shop/profile?cid=001" -> "001", "#001" -> "001", "72095796" -> "72095796")
 */
export function extractCustomerIdentifier(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/profile')) {
    try {
      const url = new URL(
        trimmed.startsWith('http') ? trimmed : `https://makarem.shop${trimmed.startsWith('/') ? '' : '/'}${trimmed}`
      );
      const cid =
        url.searchParams.get('cid') ||
        url.searchParams.get('code') ||
        url.searchParams.get('id') ||
        url.searchParams.get('phone') ||
        url.searchParams.get('q');
      if (cid) return cid.trim();

      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last.toLowerCase() !== 'profile') {
        return last.trim();
      }
    } catch {
      // fall through
    }
  }

  return trimmed.replace(/^#/, '').trim();
}

export function loadLocalCustomerProfile(): CustomerProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.phone || parsed.customerCode)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to parse local customer profile:', err);
  }
  return null;
}

export function saveLocalCustomerProfile(profile: CustomerProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile));
  } catch (err) {
    console.warn('Failed to save local customer profile:', err);
  }
}

export function clearLocalCustomerProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_PROFILE);
  } catch (err) {
    console.warn('Failed to clear local customer profile:', err);
  }
}

export interface CustomerProfileFetchOptions {
  since?: string;
  openBills?: string[];
  force?: boolean;
  full?: boolean;
}

export async function fetchSalesPlayCustomerProfile(
  phone?: string,
  customerCode?: string,
  options?: CustomerProfileFetchOptions
): Promise<SalesPlayCustomerProfileResponse | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams();
    if (phone) params.set('phone', phone);
    if (customerCode) params.set('customerCode', customerCode);
    if (options?.since) params.set('since', options.since);
    if (options?.openBills && options.openBills.length > 0) {
      params.set('openBills', options.openBills.join(','));
    }
    if (options?.force) params.set('force', '1');
    if (options?.full) params.set('full', '1');
    const res = await fetch(`/api/salesplay/customer-profile?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as SalesPlayCustomerProfileResponse;
  } catch (err) {
    console.warn('SalesPlay customer profile fetch failed:', err);
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchSalesPlayUsedCodes(): Promise<Set<string>> {
  const used = new Set<string>();
  try {
    const res = await fetch('/api/salesplay/customers', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      for (const c of data.customers || []) {
        if (c.customerCode) {
          used.add(String(c.customerCode).trim());
        }
      }
    }
  } catch {
    // non-fatal
  }
  return used;
}

/**
 * Logs in or registers a customer using Mobile Number, Customer ID (e.g. "001"), OR scanned QR URL.
 * Guarantees NO duplicate accounts when an existing SalesPlay POS customer logs in via phone OR customer code!
 */
export async function loginOrRegisterCustomer(
  identifierInput: string
): Promise<CustomerProfile> {
  const raw = extractCustomerIdentifier(identifierInput);
  if (!raw) {
    throw new Error('Please enter your mobile number or Customer ID');
  }

  const normDigits = normalizePhoneNumber(raw);
  const isOmaniMobile = /^(7|9)\d{7}$/.test(normDigits);
  const looksLikeCode =
    !isOmaniMobile &&
    ((/^\d{1,6}$/.test(raw) && raw.length <= 6) || /^[a-zA-Z0-9_-]{1,12}$/.test(raw) && /[a-zA-Z]/.test(raw));

  if (looksLikeCode) {
    const paddedCode = /^\d{1,3}$/.test(raw) ? formatCustomerCode(Number(raw)) : raw;

    // 1. Check Firestore by customerCode
    for (const candidateCode of Array.from(new Set([paddedCode, raw]))) {
      const qCode = query(
        collection(db, 'customers'),
        where('customerCode', '==', candidateCode)
      );
      const snap = await getDocs(qCode);
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const profile = { id: docSnap.id, ...docSnap.data() } as CustomerProfile;
        saveLocalCustomerProfile(profile);
        return profile;
      }
    }

    // 2. Fallback: Check SalesPlay POS by customerCode -> create/link Firestore profile cleanly
    const spMatch = await fetchSalesPlayCustomerProfile(undefined, paddedCode);
    if (spMatch?.matched && spMatch.customer) {
      const linked = await upsertSalesPlayMatchedCustomer(spMatch.customer, '');
      saveLocalCustomerProfile(linked);
      return linked;
    }

    throw new Error(`No customer account found for ID #${paddedCode}`);
  }

  // Otherwise treat input as Mobile Number
  if (normDigits.length < 7) {
    throw new Error('Please enter a valid mobile number (at least 7 digits)');
  }

  // 1. Search Firestore customers by phoneNormalized
  const qPhone = query(
    collection(db, 'customers'),
    where('phoneNormalized', '==', normDigits)
  );
  const phoneSnap = await getDocs(qPhone);
  if (!phoneSnap.empty) {
    const docSnap = phoneSnap.docs[0];
    const profile = { id: docSnap.id, ...docSnap.data() } as CustomerProfile;
    saveLocalCustomerProfile(profile);
    return profile;
  }

  // Also check legacy doc keyed by phone digits
  const legacyRef = doc(db, 'customers', normDigits);
  const legacySnap = await getDoc(legacyRef);
  if (legacySnap.exists()) {
    const data = legacySnap.data();
    const profile: CustomerProfile = {
      id: legacySnap.id,
      customerCode: data.customerCode || formatCustomerCode(1),
      phone: data.phone || raw,
      phoneNormalized: normDigits,
      name: data.name,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!data.customerCode) {
      const spReserved = await fetchSalesPlayUsedCodes();
      return await allocateNextCustomerCode(profile, spReserved);
    }
    saveLocalCustomerProfile(profile);
    return profile;
  }

  // 2. Check if customer ALREADY exists in SalesPlay POS by Mobile Number (prevent duplicate!)
  const spMatch = await fetchSalesPlayCustomerProfile(raw, undefined);
  if (spMatch?.matched && spMatch.customer) {
    const linked = await upsertSalesPlayMatchedCustomer(spMatch.customer, raw);
    saveLocalCustomerProfile(linked);
    return linked;
  }

  // 3. Brand new customer -> allocate next unused sequential ID starting from 001 (skipping SalesPlay POS codes)
  const spReservedCodes = await fetchSalesPlayUsedCodes();
  return await allocateNextCustomerCode(
    {
      id: '',
      customerCode: '',
      phone: raw,
      phoneNormalized: normDigits,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    spReservedCodes
  );
}

/**
 * Ensures a SalesPlay POS customer maps 1:1 to a single Firestore customer record without duplicates.
 */
async function upsertSalesPlayMatchedCustomer(
  spCustomer: NonNullable<SalesPlayCustomerProfileResponse['customer']>,
  fallbackPhone: string
): Promise<CustomerProfile> {
  const now = new Date().toISOString();
  const code = String(spCustomer.customerCode || '').trim() || '001';
  const phone = spCustomer.phone || fallbackPhone || '';
  const phoneNormalized = normalizePhoneNumber(phone);

  // Check if Firestore already has a record with this customerCode
  const existingByCode = await getDocs(
    query(collection(db, 'customers'), where('customerCode', '==', code))
  );
  if (!existingByCode.empty) {
    const d = existingByCode.docs[0];
    const data = d.data();
    const updated: CustomerProfile = {
      id: d.id,
      customerCode: code,
      phone: phone || data.phone || '',
      phoneNormalized: phoneNormalized || data.phoneNormalized || '',
      ...(spCustomer.name || data.name ? { name: spCustomer.name || data.name } : {}),
      salesplayCustomerId: spCustomer.id,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
    await setDoc(d.ref, updated, { merge: true });
    return updated;
  }

  const docId = `cust_${code.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
  const customerRef = doc(db, 'customers', docId);
  const existingSnap = await getDoc(customerRef);
  const existingCreatedAt = existingSnap.exists() ? existingSnap.data()?.createdAt : undefined;

  const profile: CustomerProfile = {
    id: docId,
    customerCode: code,
    phone,
    phoneNormalized,
    ...(spCustomer.name ? { name: spCustomer.name } : {}),
    salesplayCustomerId: spCustomer.id,
    createdAt: existingCreatedAt || now,
    updatedAt: now,
  };
  await setDoc(customerRef, profile, { merge: true });
  return profile;
}

async function allocateNextCustomerCode(
  baseProfile: CustomerProfile,
  reservedCodes: Set<string> = new Set()
): Promise<CustomerProfile> {
  const counterRef = doc(db, 'counters', 'customers');
  const now = new Date().toISOString();

  const createdProfile = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const currentSeq = counterSnap.exists()
      ? Number(counterSnap.data()?.lastSeq || 0)
      : 0;
    let nextSeq = currentSeq + 1;
    let customerCode = formatCustomerCode(nextSeq);
    let docId = `cust_${customerCode}`;
    let customerRef = doc(db, 'customers', docId);

    for (let attempt = 0; attempt < 40; attempt++) {
      const codeUsedInPos = reservedCodes.has(customerCode);
      const existingSnap = await tx.get(customerRef);
      if (!codeUsedInPos && !existingSnap.exists()) break;
      nextSeq += 1;
      customerCode = formatCustomerCode(nextSeq);
      docId = `cust_${customerCode}`;
      customerRef = doc(db, 'customers', docId);
    }

    const profileToSave: CustomerProfile = {
      id: docId,
      customerCode,
      phone: baseProfile.phone,
      phoneNormalized: baseProfile.phoneNormalized || normalizePhoneNumber(baseProfile.phone),
      ...(baseProfile.name ? { name: baseProfile.name } : {}),
      createdAt: baseProfile.createdAt || now,
      updatedAt: now,
    };

    tx.set(counterRef, { lastSeq: nextSeq, updatedAt: now }, { merge: true });
    tx.set(customerRef, profileToSave);
    return profileToSave;
  });

  saveLocalCustomerProfile(createdProfile);
  return createdProfile;
}

export async function fetchCustomerOrders(
  phone?: string,
  customerCode?: string
): Promise<Order[]> {
  const ordersMap = new Map<string, Order>();

  try {
    if (customerCode && customerCode.trim()) {
      const qCode = query(
        collection(db, 'orders'),
        where('customerCode', '==', customerCode.trim())
      );
      const snap = await getDocs(qCode);
      snap.forEach((d) => {
        const data = d.data();
        ordersMap.set(d.id, {
          id: d.id,
          ...data,
          items: data.items || (data.itemsSerialized ? JSON.parse(data.itemsSerialized) : []),
        } as Order);
      });
    }

    if (phone && phone.trim()) {
      const cleanPhone = phone.trim();
      const qPhone = query(
        collection(db, 'orders'),
        where('customerPhone', '==', cleanPhone)
      );
      const snap = await getDocs(qPhone);
      snap.forEach((d) => {
        const data = d.data();
        ordersMap.set(d.id, {
          id: d.id,
          ...data,
          items: data.items || (data.itemsSerialized ? JSON.parse(data.itemsSerialized) : []),
        } as Order);
      });
    }
  } catch (err) {
    console.warn('Error fetching customer orders:', err);
  }

  return Array.from(ordersMap.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
}

/**
 * Admin-only: Merges all Firestore customers and SalesPlay POS customers without duplicates.
 */
export async function fetchAllCustomersForAdmin(): Promise<AdminCustomerRecord[]> {
  const [fsSnap, spRes] = await Promise.all([
    getDocs(collection(db, 'customers')),
    fetch('/api/salesplay/customers', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .catch(() => ({ customers: [] })),
  ]);

  const byCode = new Map<string, AdminCustomerRecord>();
  const byPhone = new Map<string, AdminCustomerRecord>();

  const spCustomers: any[] = spRes?.customers || [];
  for (const sp of spCustomers) {
    const code = String(sp.customerCode || '').trim();
    const phone = String(sp.phone || '').trim();
    const phoneNorm = normalizePhoneNumber(phone);
    const rec: AdminCustomerRecord = {
      id: `sp_${sp.id}`,
      salesplayId: sp.id,
      customerCode: code,
      phone,
      phoneNormalized: phoneNorm,
      name: sp.name || (code ? `Customer #${code}` : 'POS Customer'),
      creditLimit: sp.creditLimit ?? null,
      totalSpent: Number(sp.totalSpent || 0),
      totalVisits: Number(sp.totalVisits || 0),
      firstVisit: sp.firstVisit || '',
      source: 'salesplay',
    };
    if (code) byCode.set(code, rec);
    if (phoneNorm) byPhone.set(phoneNorm, rec);
  }

  const fsOnly: AdminCustomerRecord[] = [];
  fsSnap.forEach((d) => {
    const data = d.data();
    const code = String(data.customerCode || '').trim();
    const phone = String(data.phone || '').trim();
    const phoneNorm = normalizePhoneNumber(phone || data.phoneNormalized || '');

    const existingMatch =
      (code && byCode.get(code)) || (phoneNorm && byPhone.get(phoneNorm));

    if (existingMatch) {
      existingMatch.id = d.id;
      existingMatch.firestoreId = d.id;
      existingMatch.source = 'both';
      if (phone) existingMatch.phone = phone;
      if (phoneNorm) existingMatch.phoneNormalized = phoneNorm;
      if (data.name) existingMatch.name = data.name;
      existingMatch.createdAt = data.createdAt;
      existingMatch.updatedAt = data.updatedAt;
    } else {
      fsOnly.push({
        id: d.id,
        firestoreId: d.id,
        salesplayId: data.salesplayCustomerId,
        customerCode: code,
        phone,
        phoneNormalized: phoneNorm,
        name: data.name || (code ? `Customer #${code}` : 'Online Customer'),
        creditLimit: null,
        totalSpent: 0,
        totalVisits: 0,
        source: 'firestore',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    }
  });

  const combined = [...Array.from(new Set([...byCode.values(), ...byPhone.values()])), ...fsOnly];
  return combined.sort((a, b) => a.customerCode.localeCompare(b.customerCode, undefined, { numeric: true }));
}

/**
 * Admin-only: Updates customer's Customer ID (customerCode), Mobile Number, and Name
 * in both Firestore and SalesPlay POS without leaving duplicate docs.
 */
export async function adminUpdateCustomerRecord(input: {
  firestoreId?: string;
  salesplayId?: string;
  customerCode: string;
  phone: string;
  name: string;
}): Promise<{ salesplaySynced: boolean }> {
  const cleanCode = input.customerCode.trim().replace(/^#/, '');
  if (!cleanCode) {
    throw new Error('Customer ID is required');
  }
  const cleanPhone = input.phone.trim();
  const phoneNorm = normalizePhoneNumber(cleanPhone);
  const cleanName = input.name.trim() || `Customer #${cleanCode}`;
  const now = new Date().toISOString();

  const targetDocId = `cust_${cleanCode.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;

  // Preserve original createdAt if editing an existing Firestore doc
  let createdAt = now;
  if (input.firestoreId) {
    const oldSnap = await getDoc(doc(db, 'customers', input.firestoreId));
    if (oldSnap.exists() && oldSnap.data()?.createdAt) {
      createdAt = oldSnap.data()?.createdAt;
    }
  } else {
    const targetSnap = await getDoc(doc(db, 'customers', targetDocId));
    if (targetSnap.exists() && targetSnap.data()?.createdAt) {
      createdAt = targetSnap.data()?.createdAt;
    }
  }

  const docIdToWrite = input.firestoreId || targetDocId;
  const payload: CustomerProfile = {
    id: docIdToWrite,
    customerCode: cleanCode,
    phone: cleanPhone,
    phoneNormalized: phoneNorm,
    name: cleanName,
    ...(input.salesplayId ? { salesplayCustomerId: input.salesplayId } : {}),
    createdAt,
    updatedAt: now,
  };

  await setDoc(doc(db, 'customers', docIdToWrite), payload, { merge: true });

  // Clean up duplicate doc if a new targetDocId differs from old firestoreId and code changed
  if (input.firestoreId && input.firestoreId !== targetDocId) {
    // Keep same document ID so createdAt & references remain intact, unless empty
  }

  // Sync to SalesPlay POS too
  let salesplaySynced = false;
  try {
    const res = await fetch('/api/salesplay/update-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salesplayId: input.salesplayId,
        customerCode: cleanCode,
        phone: cleanPhone,
        name: cleanName,
      }),
    });
    const data = await res.json();
    salesplaySynced = Boolean(data?.updatedSalesPlay);
  } catch {
    salesplaySynced = false;
  }

  return { salesplaySynced };
}

/**
 * Admin-only: Deletes a duplicate Firestore customer document cleanly.
 */
export async function adminDeleteCustomerDoc(firestoreId: string): Promise<void> {
  await deleteDoc(doc(db, 'customers', firestoreId));
}

/**
 * Admin-only: Imports & refreshes all SalesPlay POS customers AND their bill/credit ledgers into Firestore
 * so Customer Dashboards work seamlessly even when offline or launched on static hosts.
 */
export async function syncAllSalesPlayCustomersToFirestore(options?: {
  syncLedgers?: boolean;
}): Promise<number> {
  const shouldSyncLedgers = options?.syncLedgers !== false;
  let snapshots: any[] = [];

  if (shouldSyncLedgers) {
    try {
      const res = await fetch('/api/salesplay/export-customer-snapshots', {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.snapshots)) {
          snapshots = data.snapshots;
        }
      }
    } catch {
      // fall back below
    }
  }

  const all = await fetchAllCustomersForAdmin();
  const posCustomers = all.filter((c) => Boolean(c.salesplayId && c.customerCode));
  if (posCustomers.length === 0 && snapshots.length === 0) return 0;

  const existingByCode = new Map<string, AdminCustomerRecord>();
  for (const c of all) {
    if (c.customerCode) {
      existingByCode.set(c.customerCode, c);
    }
  }

  const now = new Date().toISOString();
  const batch = writeBatch(db);
  let count = 0;

  const sourceList =
    snapshots.length > 0
      ? snapshots
      : posCustomers.map((c) => ({
          id: c.salesplayId,
          customerCode: c.customerCode,
          name: c.name,
          phone: c.phone,
          phoneNormalized: c.phoneNormalized,
          creditLimit: c.creditLimit,
          totalVisits: c.totalVisits,
          totalSpent: c.totalSpent,
          firstVisit: c.firstVisit || '',
          receipts: [],
        }));

  for (const c of sourceList) {
    const code = String(c.customerCode || '').trim();
    if (!code) continue;
    const existing = existingByCode.get(code);
    const docId =
      existing?.firestoreId || `cust_${code.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
    const phone = String(c.phone || existing?.phone || '').trim();
    const phoneNormalized = normalizePhoneNumber(phone) || existing?.phoneNormalized || '';

    batch.set(
      doc(db, 'customers', docId),
      {
        id: docId,
        customerCode: code,
        phone,
        phoneNormalized,
        ...(c.name ? { name: String(c.name).slice(0, 120) } : {}),
        ...(c.id ? { salesplayCustomerId: String(c.id).slice(0, 128) } : {}),
        ...(c.creditLimit !== null && c.creditLimit !== undefined
          ? { creditLimit: Number(c.creditLimit) }
          : {}),
        ...(c.totalVisits !== undefined ? { totalVisits: Number(c.totalVisits || 0) } : {}),
        ...(c.totalSpent !== undefined ? { totalSpent: Number(c.totalSpent || 0) } : {}),
        ...(c.firstVisit ? { firstVisit: String(c.firstVisit).slice(0, 64) } : {}),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      },
      { merge: true }
    );
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }

  // Sync each customer's bills & credit metadata into customer_ledgers/{customerCode}
  if (shouldSyncLedgers && snapshots.length > 0) {
    const [{ fetchAllSettlementsForAdmin, computeEnrichedCustomerBills }, { syncCustomerLedgerToFirestore }] =
      await Promise.all([
        import('./creditSettlementService'),
        import('./billArchiveService'),
      ]);

    const allSettlements = await fetchAllSettlementsForAdmin().catch(() => []);
    const settlementsByCode = new Map<string, any[]>();
    for (const st of allSettlements) {
      const k = String(st.customerCode || '').trim();
      if (!k) continue;
      const arr = settlementsByCode.get(k) || [];
      arr.push(st);
      settlementsByCode.set(k, arr);
    }

    for (const s of snapshots) {
      const code = String(s.customerCode || '').trim();
      if (!code) continue;
      const custSettlements = settlementsByCode.get(code) || [];
      const enriched = computeEnrichedCustomerBills(
        s.receipts || [],
        custSettlements,
        s.creditLimit ?? null
      );
      await syncCustomerLedgerToFirestore(code, enriched.bills, {
        customerName: s.name || undefined,
        customerPhone: s.phone || undefined,
        creditLimit: s.creditLimit ?? null,
        totalVisits: Number(s.totalVisits || 0),
        totalSpent: Number(s.totalSpent || 0),
        firstVisit: s.firstVisit || undefined,
      }).catch((err) => console.warn(`Ledger sync skipped for #${code}:`, err));
    }
  }

  return count;
}
