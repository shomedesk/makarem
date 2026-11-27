import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AdminCustomerRecord,
  CustomerLedgerDoc,
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
  const timeoutId = window.setTimeout(() => controller.abort(), 25000);
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
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) return null;
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
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
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
    const candidates = Array.from(new Set([paddedCode, raw]));

    // 1. Check Firestore customers by direct doc ID & customerCode query
    for (const candidateCode of candidates) {
      try {
        const directSnap = await getDoc(
          doc(db, 'customers', `cust_${candidateCode.replace(/[^a-zA-Z0-9_\-]/g, '_')}`)
        );
        if (directSnap.exists()) {
          const profile = { id: directSnap.id, ...directSnap.data() } as CustomerProfile;
          saveLocalCustomerProfile(profile);
          return profile;
        }
      } catch {
        // continue to query
      }

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

    // 2. Fallback: Check customer_ledgers/{code} snapshot in Firestore (works on launched static hosts!)
    for (const candidateCode of candidates) {
      try {
        const ledgerSnap = await getDoc(
          doc(db, 'customer_ledgers', candidateCode.replace(/[^a-zA-Z0-9_\-]/g, '_'))
        );
        if (ledgerSnap.exists()) {
          const ld = ledgerSnap.data() as CustomerLedgerDoc;
          const nowIso = new Date().toISOString();
          const hydrated: CustomerProfile = {
            id: `cust_${candidateCode.replace(/[^a-zA-Z0-9_\-]/g, '_')}`,
            customerCode: ld.customerCode || candidateCode,
            phone: ld.customerPhone || '',
            phoneNormalized: normalizePhoneNumber(ld.customerPhone || ''),
            ...(ld.customerName ? { name: ld.customerName } : {}),
            ...(ld.creditLimit !== undefined ? { creditLimit: ld.creditLimit } : {}),
            ...(ld.totalVisits !== undefined ? { totalVisits: ld.totalVisits } : {}),
            ...(ld.totalSpent !== undefined ? { totalSpent: ld.totalSpent } : {}),
            ...(ld.firstVisit ? { firstVisit: ld.firstVisit } : {}),
            createdAt: ld.createdAt || nowIso,
            updatedAt: nowIso,
          };
          saveLocalCustomerProfile(hydrated);
          return hydrated;
        }
      } catch {
        // continue to POS check
      }
    }

    // 3. Fallback: Check SalesPlay POS by customerCode -> create/link Firestore profile cleanly
    const spMatch = await fetchSalesPlayCustomerProfile(undefined, paddedCode);
    if (spMatch?.matched && spMatch.customer) {
      const linked = await upsertSalesPlayMatchedCustomer(
        spMatch.customer,
        '',
        spMatch.creditSummary?.creditLimit ?? null
      );
      saveLocalCustomerProfile(linked);
      return linked;
    }

    throw new Error(`No customer account found for ID #${paddedCode}`);
  }

  // Otherwise treat input as Mobile Number
  if (normDigits.length < 7) {
    throw new Error('Please enter a valid mobile number (at least 7 digits)');
  }

  // 1. Search Firestore customers by phoneNormalized (and raw phone fallback)
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

  const qRawPhone = query(
    collection(db, 'customers'),
    where('phone', '==', raw)
  );
  const rawPhoneSnap = await getDocs(qRawPhone);
  if (!rawPhoneSnap.empty) {
    const docSnap = rawPhoneSnap.docs[0];
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
      ...(data.creditLimit !== undefined ? { creditLimit: data.creditLimit } : {}),
      ...(data.totalVisits !== undefined ? { totalVisits: data.totalVisits } : {}),
      ...(data.totalSpent !== undefined ? { totalSpent: data.totalSpent } : {}),
      ...(data.firstVisit ? { firstVisit: data.firstVisit } : {}),
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
    const linked = await upsertSalesPlayMatchedCustomer(
      spMatch.customer,
      raw,
      spMatch.creditSummary?.creditLimit ?? null
    );
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
  fallbackPhone: string,
  creditLimit: number | null = null
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
      ...(creditLimit !== null && creditLimit !== undefined
        ? { creditLimit }
        : data.creditLimit !== undefined
        ? { creditLimit: data.creditLimit }
        : {}),
      ...(spCustomer.totalVisits !== undefined ? { totalVisits: spCustomer.totalVisits } : {}),
      ...(spCustomer.totalSpent !== undefined ? { totalSpent: spCustomer.totalSpent } : {}),
      ...(spCustomer.firstVisit ? { firstVisit: spCustomer.firstVisit } : {}),
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
    ...(creditLimit !== null && creditLimit !== undefined ? { creditLimit } : {}),
    ...(spCustomer.totalVisits !== undefined ? { totalVisits: spCustomer.totalVisits } : {}),
    ...(spCustomer.totalSpent !== undefined ? { totalSpent: spCustomer.totalSpent } : {}),
    ...(spCustomer.firstVisit ? { firstVisit: spCustomer.firstVisit } : {}),
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

export async function refreshCustomerProfileFromFirestore(
  current: CustomerProfile,
  fromServer = false
): Promise<CustomerProfile | null> {
  try {
    let matchedDoc: CustomerProfile | null = null;
    const readDoc = async (ref: ReturnType<typeof doc>) =>
      fromServer ? getDocFromServer(ref).catch(() => getDoc(ref)) : getDoc(ref);

    if (current.id) {
      const direct = await readDoc(doc(db, 'customers', current.id));
      if (direct.exists()) {
        matchedDoc = { id: direct.id, ...direct.data() } as CustomerProfile;
      }
    }

    if (!matchedDoc && current.customerCode) {
      const safeId = `cust_${current.customerCode.trim().replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
      const byCustId = await readDoc(doc(db, 'customers', safeId));
      if (byCustId.exists()) {
        matchedDoc = { id: byCustId.id, ...byCustId.data() } as CustomerProfile;
      } else {
        const snap = await getDocs(
          query(collection(db, 'customers'), where('customerCode', '==', current.customerCode.trim()))
        );
        if (!snap.empty) {
          const d = snap.docs[0];
          matchedDoc = { id: d.id, ...d.data() } as CustomerProfile;
        }
      }
    }

    if (!matchedDoc && current.phone) {
      const norm = normalizePhoneNumber(current.phone);
      if (norm) {
        const snap = await getDocs(
          query(collection(db, 'customers'), where('phoneNormalized', '==', norm))
        );
        if (!snap.empty) {
          const d = snap.docs[0];
          matchedDoc = { id: d.id, ...d.data() } as CustomerProfile;
        }
      }
    }

    if (matchedDoc) {
      const merged: CustomerProfile = { ...current, ...matchedDoc };
      saveLocalCustomerProfile(merged);
      return merged;
    }
  } catch (err) {
    console.warn('Could not refresh customer profile from Firestore:', err);
  }
  return null;
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
      const norm = normalizePhoneNumber(cleanPhone);
      const phoneCandidates = Array.from(
        new Set([cleanPhone, norm, norm ? `968${norm}` : '', norm ? `+968${norm}` : ''].filter(Boolean))
      );
      for (const pCandidate of phoneCandidates) {
        const qPhone = query(
          collection(db, 'orders'),
          where('customerPhone', '==', pCandidate)
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
      .then(async (r) => {
        const ct = r.headers.get('content-type') || '';
        return r.ok && ct.includes('application/json') ? r.json() : { customers: [] };
      })
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
      if (existingMatch.creditLimit === null && data.creditLimit !== undefined) {
        existingMatch.creditLimit = data.creditLimit;
      }
      if (!existingMatch.totalSpent && data.totalSpent !== undefined) {
        existingMatch.totalSpent = Number(data.totalSpent || 0);
      }
      if (!existingMatch.totalVisits && data.totalVisits !== undefined) {
        existingMatch.totalVisits = Number(data.totalVisits || 0);
      }
      if (!existingMatch.firstVisit && data.firstVisit) {
        existingMatch.firstVisit = data.firstVisit;
      }
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
        creditLimit: data.creditLimit !== undefined ? data.creditLimit : null,
        totalSpent: Number(data.totalSpent || 0),
        totalVisits: Number(data.totalVisits || 0),
        firstVisit: data.firstVisit || '',
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

export interface CustomerFirestoreSyncResult {
  customersSynced: number;
  ledgersWritten: number;
  ledgersTotal: number;
  failedLedgers: number;
  posConnected: boolean;
  requiresAuth?: boolean;
  requiresVerifiedEmail?: boolean;
  errors?: string[];
}

const lastSyncedProfileDigests = new Map<string, string>();
const lastSyncedLedgerDigests = new Map<string, string>();
const knownCustomerDocMeta = new Map<
  string,
  { firestoreId: string; createdAt: string; phone?: string; phoneNormalized?: string }
>();

/**
 * Admin-only: Imports & refreshes all SalesPlay POS customers AND their bill/credit ledgers into Firestore
 * so Customer Dashboards work seamlessly even when offline or launched on static hosts.
 */
export async function syncAllSalesPlayCustomersToFirestore(options?: {
  syncLedgers?: boolean;
  forcePosRebuild?: boolean;
  onlyChanged?: boolean;
}): Promise<CustomerFirestoreSyncResult> {
  const shouldSyncLedgers = options?.syncLedgers !== false;
  const forcePosRebuild = options?.forcePosRebuild !== false;
  const onlyChanged = Boolean(options?.onlyChanged);

  let snapshots: any[] = [];
  let windowStartDate = '';
  let posConnected = false;
  const errors: string[] = [];

  if (shouldSyncLedgers) {
    try {
      const url = forcePosRebuild
        ? '/api/salesplay/export-customer-snapshots?force=1'
        : '/api/salesplay/export-customer-snapshots';
      const res = await fetch(url, { cache: 'no-store' });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (data?.success && Array.isArray(data?.snapshots)) {
          snapshots = data.snapshots;
          windowStartDate = String(data?.windowStartDate || '').trim();
          posConnected = true;
        }
      }
    } catch {
      // fall back below
    }
  }

  // Only fetch Firestore customers collection when doing full manual sync or initial cache warm
  const existingByCode = new Map<string, AdminCustomerRecord>();
  let posCustomers: AdminCustomerRecord[] = [];
  if (!onlyChanged || snapshots.length === 0 || lastSyncedProfileDigests.size === 0) {
    const all = await fetchAllCustomersForAdmin();
    // CRITICAL: Only treat genuine live SalesPlay records (source !== 'firestore') as POS-connected!
    posCustomers = all.filter(
      (c) => c.source !== 'firestore' && Boolean(c.salesplayId && c.customerCode)
    );
    if (posCustomers.length > 0) {
      posConnected = true;
    }
    for (const c of all) {
      if (c.customerCode) {
        existingByCode.set(c.customerCode, c);
        knownCustomerDocMeta.set(c.customerCode, {
          firestoreId: c.firestoreId || `cust_${c.customerCode.replace(/[^a-zA-Z0-9_\-]/g, '_')}`,
          createdAt: c.createdAt || '',
          phone: c.phone || '',
          phoneNormalized: c.phoneNormalized || '',
        });
      }
    }
  }

  if (!posConnected || (posCustomers.length === 0 && snapshots.length === 0)) {
    return {
      customersSynced: 0,
      ledgersWritten: 0,
      ledgersTotal: 0,
      failedLedgers: 0,
      posConnected: false,
      errors,
    };
  }

  const now = new Date().toISOString();
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

  // Write customers collection in safe chunks of 400 docs (skip unchanged during onlyChanged auto-sync)
  let customersSynced = 0;
  for (let i = 0; i < sourceList.length; i += 400) {
    const chunk = sourceList.slice(i, i + 400);
    const batch = writeBatch(db);
    let chunkWrites = 0;
    const committedCodes: Array<{ code: string; digest: string; meta: { firestoreId: string; createdAt: string; phone: string; phoneNormalized: string } }> = [];

    for (const c of chunk) {
      const code = String(c.customerCode || '').trim();
      if (!code) continue;
      const existing = existingByCode.get(code);
      const cachedMeta = knownCustomerDocMeta.get(code);
      const docId =
        existing?.firestoreId ||
        cachedMeta?.firestoreId ||
        `cust_${code.replace(/[^a-zA-Z0-9_\-]/g, '_')}`;
      const phone = String(c.phone || existing?.phone || cachedMeta?.phone || '').trim();
      const phoneNormalized =
        normalizePhoneNumber(phone) || existing?.phoneNormalized || cachedMeta?.phoneNormalized || '';
      const profileDigest = `${code}|${phone}|${c.name || ''}|${c.creditLimit ?? ''}|${
        c.totalVisits ?? ''
      }|${c.totalSpent ?? ''}|${c.firstVisit || ''}`;

      if (onlyChanged && lastSyncedProfileDigests.get(code) === profileDigest) {
        continue;
      }

      // Always preserve existing createdAt so firestore.rules immutability check passes across auto-sync runs
      let preservedCreatedAt = existing?.createdAt || cachedMeta?.createdAt || '';
      if (!preservedCreatedAt) {
        try {
          const snap = await getDoc(doc(db, 'customers', docId));
          if (snap.exists() && snap.data()?.createdAt) {
            preservedCreatedAt = String(snap.data()?.createdAt);
          }
        } catch {
          // treat as new doc
        }
      }
      const createdAtToWrite = String(preservedCreatedAt || now).slice(0, 64);

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
          createdAt: createdAtToWrite,
          updatedAt: now,
        },
        { merge: true }
      );
      committedCodes.push({
        code,
        digest: profileDigest,
        meta: {
          firestoreId: docId,
          createdAt: createdAtToWrite,
          phone,
          phoneNormalized,
        },
      });
      chunkWrites++;
    }

    if (chunkWrites > 0) {
      try {
        await batch.commit();
        customersSynced += chunkWrites;
        for (const item of committedCodes) {
          knownCustomerDocMeta.set(item.code, item.meta);
          lastSyncedProfileDigests.set(item.code, item.digest);
        }
      } catch (err: any) {
        const msg = err?.message || 'Could not write customers to Firestore';
        errors.push(`customers: ${msg}`);
        console.warn('Customers batch write error:', err);
      }
    }
  }

  let ledgersWritten = 0;
  let ledgersTotal = 0;
  let failedLedgers = 0;
  let requiresAuth = false;
  let requiresVerifiedEmail = false;

  // Sync each customer's bills & credit metadata into customer_ledgers/{customerCode}
  if (shouldSyncLedgers && snapshots.length > 0) {
    await auth.authStateReady();
    if (!auth.currentUser?.email) {
      requiresAuth = true;
    } else if (!auth.currentUser.emailVerified) {
      requiresVerifiedEmail = true;
    } else {
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

      const validSnapshots = snapshots.filter((s) => Boolean(String(s.customerCode || '').trim()));
      const snapshotsToProcess = validSnapshots.filter((s) => {
        const code = String(s.customerCode || '').trim();
        const custSettlements = settlementsByCode.get(code) || [];
        const receiptSig = (s.receipts || [])
          .map(
            (r: any) =>
              `${r.receiptNumber}:${r.receiptType}:${r.dateTime || ''}:${Number(
                r.creditAmount || 0
              ).toFixed(3)}:${Number(r.paidAmount || 0).toFixed(3)}:${Number(
                r.totalMoney || 0
              ).toFixed(3)}`
          )
          .join(',');
        const settleSig = custSettlements.map((st: any) => `${st.id}:${st.settledAmount}`).join(',');
        const ledgerDigest = `${s.name || ''}|${s.phone || ''}|${s.creditLimit ?? ''}|${
          s.totalVisits ?? 0
        }|${Number(s.totalSpent || 0).toFixed(3)}|${receiptSig}|${settleSig}`;
        if (onlyChanged && lastSyncedLedgerDigests.get(code) === ledgerDigest) {
          ledgersTotal++;
          return false;
        }
        (s as any).__ledgerDigest = ledgerDigest;
        return true;
      });

      for (let i = 0; i < snapshotsToProcess.length; i += 8) {
        const chunk = snapshotsToProcess.slice(i, i + 8);
        const outcomes = await Promise.all(
          chunk.map(async (s) => {
            const code = String(s.customerCode || '').trim();
            const custSettlements = settlementsByCode.get(code) || [];
            const enriched = computeEnrichedCustomerBills(
              s.receipts || [],
              custSettlements,
              s.creditLimit ?? null
            );
            try {
              const outcome = await syncCustomerLedgerToFirestore(code, enriched.bills, {
                customerName: s.name || undefined,
                customerPhone: s.phone || undefined,
                creditLimit: s.creditLimit ?? null,
                totalVisits: Number(s.totalVisits || 0),
                totalSpent: Number(s.totalSpent || 0),
                firstVisit: s.firstVisit || undefined,
                authoritativeWindowStart: windowStartDate || undefined,
                forceServerRead: !onlyChanged,
              });
              if (outcome === 'written' || outcome === 'unchanged') {
                lastSyncedLedgerDigests.set(code, (s as any).__ledgerDigest || '');
              } else if (outcome === 'unauthorized') {
                requiresAuth = true;
              } else if (outcome === 'unverified') {
                requiresVerifiedEmail = true;
              } else {
                failedLedgers++;
                errors.push(`#${code}: invalid ledger payload`);
              }
              return outcome;
            } catch (err: any) {
              failedLedgers++;
              const msg = err?.message || 'Permission denied or write failed';
              errors.push(`#${code}: ${msg}`);
              console.warn(`Ledger sync failed for #${code}:`, err);
              return 'invalid' as const;
            }
          })
        );

        for (const out of outcomes) {
          if (out === 'written') {
            ledgersWritten++;
            ledgersTotal++;
          } else if (out === 'unchanged') {
            ledgersTotal++;
          }
        }
      }
    }
  }

  return {
    customersSynced,
    ledgersWritten,
    ledgersTotal,
    failedLedgers,
    posConnected,
    requiresAuth,
    requiresVerifiedEmail,
    errors,
  };
}
