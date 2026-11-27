import { doc, getDoc, getDocFromServer, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type {
  ArchivedBillEntry,
  CustomerLedgerDoc,
  EnrichedCustomerReceipt,
  SalesPlayCustomerReceipt,
} from '../types';

const LOCAL_ARCHIVE_PREFIX = 'makarem_cust_bills_v1_';
const MAX_LOCAL_RECEIPTS = 10000;
const MAX_LOCAL_WITH_ITEMS = 250;
const MAX_FIRESTORE_ARCHIVED_BILLS = 350;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function toLedgerDocId(customerCode: string): string {
  const clean = String(customerCode || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_');
  return (clean || 'unknown').slice(0, 128);
}

export interface LocalBillArchive {
  customerCode: string;
  lastFinalizedAt: string;
  receipts: SalesPlayCustomerReceipt[];
  updatedAt: string;
}

export interface CustomerLedgerMeta {
  customerName?: string;
  customerPhone?: string;
  creditLimit?: number | null;
  totalVisits?: number;
  totalSpent?: number;
  firstVisit?: string;
  authoritativeWindowStart?: string;
  forceServerRead?: boolean;
}

export function loadLocalBillArchive(customerCode: string): LocalBillArchive | null {
  const keyCode = toLedgerDocId(customerCode);
  if (!keyCode || keyCode === 'unknown') return null;

  try {
    const raw = localStorage.getItem(`${LOCAL_ARCHIVE_PREFIX}${keyCode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalBillArchive;
    if (!parsed || !Array.isArray(parsed.receipts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalBillArchive(
  customerCode: string,
  receipts: SalesPlayCustomerReceipt[],
  lastFinalizedAt: string
): void {
  const keyCode = toLedgerDocId(customerCode);
  if (!keyCode || keyCode === 'unknown') return;

  try {
    const compactReceipts = receipts.slice(0, MAX_LOCAL_RECEIPTS).map((rec, idx) => {
      if (idx < MAX_LOCAL_WITH_ITEMS) return rec;
      return {
        ...rec,
        items: [],
      };
    });

    const payload: LocalBillArchive = {
      customerCode: String(customerCode).trim(),
      lastFinalizedAt,
      receipts: compactReceipts,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${LOCAL_ARCHIVE_PREFIX}${keyCode}`, JSON.stringify(payload));
  } catch (err) {
    try {
      const tiny = receipts.slice(0, 500).map((rec) => ({ ...rec, items: [] }));
      localStorage.setItem(
        `${LOCAL_ARCHIVE_PREFIX}${keyCode}`,
        JSON.stringify({
          customerCode: String(customerCode).trim(),
          lastFinalizedAt,
          receipts: tiny,
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      console.warn('Could not persist local bill archive:', err);
    }
  }
}

/**
 * Reads a customer's single compact Firestore ledger document (1 read total).
 * Uses getDocFromServer when fromServer=true so stale client cache never hides new/deleted bills.
 */
export async function fetchCustomerLedgerDoc(
  customerCode: string,
  fromServer = false
): Promise<CustomerLedgerDoc | null> {
  const docId = toLedgerDocId(customerCode);
  if (!docId || docId === 'unknown') return null;

  const ref = doc(db, 'customer_ledgers', docId);
  try {
    const snap = fromServer
      ? await getDocFromServer(ref).catch(() => getDoc(ref))
      : await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as CustomerLedgerDoc;
  } catch (err) {
    console.warn('Could not read customer ledger doc:', err);
    return null;
  }
}

/**
 * Live 1-doc listener on a customer's Firestore ledger snapshot so any Admin sync
 * (new bills, edited amounts, or deleted POS bills) updates open dashboards in real time.
 */
export function subscribeToCustomerLedgerDoc(
  customerCode: string,
  callback: (ledgerDoc: CustomerLedgerDoc | null) => void
): Unsubscribe {
  const docId = toLedgerDocId(customerCode);
  if (!docId || docId === 'unknown') {
    return () => {};
  }

  return onSnapshot(
    doc(db, 'customer_ledgers', docId),
    (snap) => {
      callback(snap.exists() ? (snap.data() as CustomerLedgerDoc) : null);
    },
    (err) => {
      console.warn('Customer ledger listener notice:', err);
    }
  );
}

function archivedEntryToReceipt(entry: ArchivedBillEntry): SalesPlayCustomerReceipt {
  const isRefund =
    entry.billStatus === 'refund' || String(entry.receiptType).toUpperCase() === 'REFUND';
  const creditAmt = round3(Math.max(0, Number(entry.creditAmount || 0)));
  const paidAmt = round3(Math.max(0, Number(entry.paidAmount || 0)));
  const isOpenDue =
    !isRefund &&
    (entry.billStatus === 'due' || entry.billStatus === 'partial' || creditAmt > 0);
  const isSettled = entry.billStatus === 'settled';

  const payments: SalesPlayCustomerReceipt['payments'] = [];
  if (!isRefund) {
    if (isOpenDue && creditAmt > 0) {
      if (paidAmt > 0) {
        payments.push({
          type: 'Cash',
          amount: paidAmt,
          paidAt: entry.dateTime,
          isAdvance: false,
        });
      }
      payments.push({
        type: 'Credit',
        amount: creditAmt,
        paidAt: entry.dateTime,
        isAdvance: false,
      });
    } else {
      const payLabel = entry.paymentSummary || (isSettled ? 'Settled' : 'Paid');
      payments.push({
        type: payLabel,
        amount: paidAmt || Number(entry.totalMoney || 0),
        paidAt: entry.dateTime,
        isAdvance: isSettled,
      });
    }
  }

  return {
    receiptNumber: entry.receiptNumber,
    receiptType: entry.receiptType || 'SALE',
    dateTime: entry.dateTime,
    totalMoney: Number(entry.totalMoney || 0),
    totalDiscount: 0,
    cashierName: '',
    note: '',
    creditAmount: isRefund ? 0 : creditAmt,
    paidAmount: isRefund ? 0 : paidAmt || (isOpenDue ? 0 : Number(entry.totalMoney || 0)),
    hasAdvance: isSettled,
    payments,
    items: [],
  };
}

/**
 * Merges Firestore ledger archive + local browser archive + fresh delta POS receipts.
 * When authoritativeCloudSnapshot=true (launched static hosts where POS backend is unreachable),
 * Firestore ledgerDoc is treated as sole truth so deleted/edited POS bills NEVER survive in localStorage.
 */
export function mergeArchivedAndDeltaReceipts(params: {
  ledgerDoc: CustomerLedgerDoc | null;
  localArchive: LocalBillArchive | null;
  deltaReceipts: SalesPlayCustomerReceipt[];
  activeReceiptNumbers?: string[];
  windowStartDate?: string;
  authoritativeCloudSnapshot?: boolean;
}): {
  mergedReceipts: SalesPlayCustomerReceipt[];
  openBillNumbers: string[];
  lastFinalizedAt: string;
} {
  const byReceiptNo = new Map<string, SalesPlayCustomerReceipt>();

  if (params.authoritativeCloudSnapshot && params.ledgerDoc) {
    const localByRecNo = new Map<string, SalesPlayCustomerReceipt>();
    for (const rec of params.localArchive?.receipts || []) {
      if (rec?.receiptNumber) {
        localByRecNo.set(rec.receiptNumber, rec);
      }
    }

    for (const entry of params.ledgerDoc.archivedBills || []) {
      if (!entry?.receiptNumber) continue;
      const cloudRec = archivedEntryToReceipt(entry);
      const cached = localByRecNo.get(entry.receiptNumber);
      // Only reuse cached line-items if totals and credit amounts still match identically
      if (
        cached &&
        Array.isArray(cached.items) &&
        cached.items.length > 0 &&
        Math.abs(Number(cached.totalMoney || 0) - Number(cloudRec.totalMoney || 0)) < 0.001 &&
        Math.abs(Number(cached.creditAmount || 0) - Number(cloudRec.creditAmount || 0)) < 0.001
      ) {
        cloudRec.items = cached.items;
      }
      byReceiptNo.set(entry.receiptNumber, cloudRec);
    }
  } else {
    // 1. Seed from Firestore ledger snapshot (works on offline/launched devices & new browsers)
    if (params.ledgerDoc?.archivedBills?.length) {
      for (const entry of params.ledgerDoc.archivedBills) {
        if (entry.receiptNumber) {
          byReceiptNo.set(entry.receiptNumber, archivedEntryToReceipt(entry));
        }
      }
    }

    // 2. Overlay local browser archive (preserves line-item breakdown on this device)
    if (params.localArchive?.receipts?.length) {
      for (const rec of params.localArchive.receipts) {
        if (rec.receiptNumber) {
          byReceiptNo.set(rec.receiptNumber, rec);
        }
      }
    }

    // 3. Overlay live delta receipts from SalesPlay POS (newest truth always wins!)
    for (const rec of params.deltaReceipts) {
      if (rec.receiptNumber) {
        byReceiptNo.set(rec.receiptNumber, rec);
      }
    }

    // 4. Prune any bills inside the authoritative POS window that were deleted from SalesPlay POS
    if (Array.isArray(params.activeReceiptNumbers)) {
      const activeSet = new Set(params.activeReceiptNumbers.map((n) => String(n).trim()).filter(Boolean));
      const cutoff = String(params.windowStartDate || '').trim();
      for (const [recNo, rec] of byReceiptNo.entries()) {
        const inPosWindow = !cutoff || !rec.dateTime || rec.dateTime >= cutoff;
        if (inPosWindow && !activeSet.has(recNo)) {
          byReceiptNo.delete(recNo);
        }
      }
    }
  }

  const mergedReceipts = Array.from(byReceiptNo.values()).sort((a, b) =>
    a.dateTime < b.dateTime ? 1 : -1
  );

  // Determine open bills (creditAmount > 0) and newest finalized timestamp
  const openBillNumbers: string[] = [];
  let lastFinalizedAt =
    params.ledgerDoc?.lastFinalizedAt || params.localArchive?.lastFinalizedAt || '';

  for (const rec of mergedReceipts) {
    const isOpenCredit =
      Number(rec.creditAmount || 0) > 0 &&
      String(rec.receiptType).toUpperCase() !== 'REFUND';
    if (isOpenCredit) {
      openBillNumbers.push(rec.receiptNumber);
    } else if (rec.dateTime && rec.dateTime > lastFinalizedAt) {
      lastFinalizedAt = rec.dateTime;
    }
  }

  return {
    mergedReceipts,
    openBillNumbers,
    lastFinalizedAt,
  };
}

export type LedgerSyncOutcome = 'written' | 'unchanged' | 'unauthorized' | 'unverified' | 'invalid';

/**
 * Admin-only: Syncs BOTH open due/partial bills AND finalized Paid/Settled bills plus credit metadata
 * into the single-doc `/customer_ledgers/{customerCode}` snapshot so customer dashboards work
 * reliably even on static/launched sites without backend POS access.
 */
export async function syncCustomerLedgerToFirestore(
  customerCode: string,
  enrichedBills: EnrichedCustomerReceipt[],
  meta?: CustomerLedgerMeta
): Promise<LedgerSyncOutcome> {
  await auth.authStateReady();
  if (!auth.currentUser?.email) return 'unauthorized';
  if (!auth.currentUser.emailVerified) return 'unverified';
  const docId = toLedgerDocId(customerCode);
  if (!docId || docId === 'unknown') return 'invalid';

  const now = new Date().toISOString();
  const billMap = new Map<string, ArchivedBillEntry>();

  let existingDoc: CustomerLedgerDoc | null = null;
  const authoritativeCutoff = String(meta?.authoritativeWindowStart || '').trim();
  const ledgerRef = doc(db, 'customer_ledgers', docId);
  try {
    const snap = meta?.forceServerRead
      ? await getDocFromServer(ledgerRef).catch(() => getDoc(ledgerRef))
      : await getDoc(ledgerRef);
    if (snap.exists()) {
      existingDoc = snap.data() as CustomerLedgerDoc;
      for (const oldEntry of existingDoc.archivedBills || []) {
        if (!oldEntry?.receiptNumber) continue;
        // If this sync has an authoritative POS window start, prune bills inside that window
        // so deleted SalesPlay POS receipts are cleanly removed from Firestore too!
        if (authoritativeCutoff && (!oldEntry.dateTime || oldEntry.dateTime >= authoritativeCutoff)) {
          continue;
        }
        billMap.set(oldEntry.receiptNumber, oldEntry);
      }
    }
  } catch {
    // ignore read miss
  }

  for (const bill of enrichedBills) {
    const recNo = String(bill.receiptNumber || '').trim();
    if (!recNo) continue;

    const isDue = bill.billStatus === 'due' || bill.billStatus === 'partial';
    const payMethods =
      bill.settlements.length > 0
        ? bill.settlements.map((s) => s.settlementMethod.toUpperCase()).join('+')
        : bill.payments
            .map((p) => p.type)
            .filter(Boolean)
            .join(', ') || (isDue ? 'Credit' : 'Cash');

    billMap.set(recNo, {
      receiptNumber: recNo.slice(0, 64),
      receiptType: String(bill.receiptType || 'SALE').slice(0, 32),
      dateTime: String(bill.dateTime || '').slice(0, 64),
      totalMoney: round3(Math.max(0, Number(bill.totalMoney || 0))),
      creditAmount: isDue
        ? round3(Math.max(0, Number(bill.originalCreditAmount || bill.creditAmount || 0)))
        : 0,
      paidAmount: isDue
        ? round3(Math.max(0, Number(bill.posPaidAmount || bill.paidAmount || 0)))
        : round3(
            Math.max(0, Number(bill.billStatus === 'refund' ? 0 : bill.totalMoney || 0))
          ),
      billStatus: bill.billStatus,
      paymentSummary: payMethods.slice(0, 64),
      itemCount: Array.isArray(bill.items) ? bill.items.length : 0,
      archivedAt: now,
    });
  }

  // Prioritize open due/partial bills first, then sort newest-first within cap of 350
  const allBills = Array.from(billMap.values()).sort((a, b) => {
    const aDue = a.billStatus === 'due' || a.billStatus === 'partial' ? 1 : 0;
    const bDue = b.billStatus === 'due' || b.billStatus === 'partial' ? 1 : 0;
    if (aDue !== bDue) return bDue - aDue;
    return a.dateTime < b.dateTime ? 1 : -1;
  });

  const cappedBills = allBills.slice(0, MAX_FIRESTORE_ARCHIVED_BILLS).sort((a, b) =>
    a.dateTime < b.dateTime ? 1 : -1
  );

  const finalizedOnly = allBills.filter(
    (b) => b.billStatus !== 'due' && b.billStatus !== 'partial'
  );
  const lastFinalizedAt = finalizedOnly
    .map((b) => b.dateTime)
    .sort((a, b) => (a < b ? 1 : -1))[0] || '';

  const totalArchivedBills = authoritativeCutoff
    ? allBills.length
    : Math.max(allBills.length, Number(existingDoc?.totalArchivedBills || 0));
  const totalArchivedPaidAmount = round3(
    finalizedOnly
      .filter((b) => b.billStatus !== 'refund')
      .reduce((s, b) => s + Number(b.totalMoney || 0), 0)
  );

  const rawCreditLimit =
    meta?.creditLimit !== undefined ? meta.creditLimit : existingDoc?.creditLimit ?? null;
  const nextCreditLimit =
    rawCreditLimit !== null && rawCreditLimit !== undefined && Number.isFinite(Number(rawCreditLimit))
      ? round3(Math.max(0, Number(rawCreditLimit)))
      : null;
  const nextHasCreditLimit = nextCreditLimit !== null;
  const nextTotalVisits =
    meta?.totalVisits !== undefined
      ? Math.max(0, Math.floor(Number(meta.totalVisits || 0)))
      : existingDoc?.totalVisits;
  const nextTotalSpent =
    meta?.totalSpent !== undefined
      ? round3(Math.max(0, Number(meta.totalSpent || 0)))
      : existingDoc?.totalSpent;
  const nextFirstVisit =
    meta?.firstVisit !== undefined ? String(meta.firstVisit || '').slice(0, 64) : existingDoc?.firstVisit;
  const nextCustomerName =
    meta?.customerName !== undefined
      ? String(meta.customerName || '').slice(0, 120)
      : existingDoc?.customerName;
  const nextCustomerPhone =
    meta?.customerPhone !== undefined
      ? String(meta.customerPhone || '').slice(0, 30)
      : existingDoc?.customerPhone;

  const digestEntries = (list: ArchivedBillEntry[] = []) =>
    list
      .map(
        (b) =>
          `${b.receiptNumber}:${b.billStatus}:${Number(b.creditAmount || 0).toFixed(3)}:${Number(
            b.totalMoney || 0
          ).toFixed(3)}`
      )
      .join('|');

  // Skip write if archive & metadata state is already identical
  if (
    existingDoc &&
    existingDoc.lastFinalizedAt === lastFinalizedAt &&
    existingDoc.totalArchivedBills === totalArchivedBills &&
    digestEntries(existingDoc.archivedBills) === digestEntries(cappedBills) &&
    (existingDoc.creditLimit ?? null) === (nextCreditLimit ?? null) &&
    (existingDoc.totalVisits ?? null) === (nextTotalVisits ?? null) &&
    Math.abs(Number(existingDoc.totalSpent || 0) - Number(nextTotalSpent || 0)) < 0.001 &&
    (existingDoc.customerName || '') === (nextCustomerName || '') &&
    (existingDoc.customerPhone || '') === (nextCustomerPhone || '') &&
    Math.abs(Number(existingDoc.totalArchivedPaidAmount || 0) - totalArchivedPaidAmount) < 0.001
  ) {
    return 'unchanged';
  }

  const payload: CustomerLedgerDoc = {
    customerCode: String(customerCode).trim().slice(0, 32),
    ...(nextCustomerName ? { customerName: nextCustomerName } : {}),
    ...(nextCustomerPhone ? { customerPhone: nextCustomerPhone } : {}),
    creditLimit: nextHasCreditLimit ? nextCreditLimit : null,
    hasCreditLimit: nextHasCreditLimit,
    ...(nextTotalVisits !== undefined ? { totalVisits: nextTotalVisits } : {}),
    ...(nextTotalSpent !== undefined ? { totalSpent: nextTotalSpent } : {}),
    ...(nextFirstVisit ? { firstVisit: nextFirstVisit } : {}),
    lastFinalizedAt: lastFinalizedAt.slice(0, 64),
    totalArchivedBills,
    totalArchivedPaidAmount,
    archivedBills: cappedBills,
    createdAt: String(existingDoc?.createdAt || now).slice(0, 64),
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'customer_ledgers', docId), payload);
    return 'written';
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `customer_ledgers/${docId}`);
  }
}
