import { doc, getDoc, setDoc } from 'firebase/firestore';
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
    // Keep line-item detail for the most recent 250 bills, and header-only compact rows up to 10,000
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
    // Fallback if storage quota is tight: save only most recent 500 bills without items
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
 */
export async function fetchCustomerLedgerDoc(
  customerCode: string
): Promise<CustomerLedgerDoc | null> {
  const docId = toLedgerDocId(customerCode);
  if (!docId || docId === 'unknown') return null;

  try {
    const snap = await getDoc(doc(db, 'customer_ledgers', docId));
    if (!snap.exists()) return null;
    return snap.data() as CustomerLedgerDoc;
  } catch (err) {
    console.warn('Could not read customer ledger doc:', err);
    return null;
  }
}

function archivedEntryToReceipt(entry: ArchivedBillEntry): SalesPlayCustomerReceipt {
  const isRefund = entry.billStatus === 'refund' || String(entry.receiptType).toUpperCase() === 'REFUND';
  const isSettled = entry.billStatus === 'settled';
  const payLabel = entry.paymentSummary || (isSettled ? 'Settled' : 'Paid');

  return {
    receiptNumber: entry.receiptNumber,
    receiptType: entry.receiptType || 'SALE',
    dateTime: entry.dateTime,
    totalMoney: Number(entry.totalMoney || 0),
    totalDiscount: 0,
    cashierName: '',
    note: '',
    creditAmount: 0,
    paidAmount: isRefund ? 0 : Number(entry.paidAmount || entry.totalMoney || 0),
    hasAdvance: isSettled,
    payments: isRefund
      ? []
      : [
          {
            type: payLabel,
            amount: Number(entry.paidAmount || entry.totalMoney || 0),
            paidAt: entry.dateTime,
            isAdvance: isSettled,
          },
        ],
    items: [],
  };
}

/**
 * Merges Firestore ledger archive + local browser archive + fresh delta POS receipts.
 * Guarantees latest server/settlement data overwrites archived summaries without duplicates.
 */
export function mergeArchivedAndDeltaReceipts(params: {
  ledgerDoc: CustomerLedgerDoc | null;
  localArchive: LocalBillArchive | null;
  deltaReceipts: SalesPlayCustomerReceipt[];
}): {
  mergedReceipts: SalesPlayCustomerReceipt[];
  openBillNumbers: string[];
  lastFinalizedAt: string;
} {
  const byReceiptNo = new Map<string, SalesPlayCustomerReceipt>();

  // 1. Seed from Firestore ledger archived entries (oldest baseline, works across new devices)
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

  const mergedReceipts = Array.from(byReceiptNo.values()).sort((a, b) =>
    a.dateTime < b.dateTime ? 1 : -1
  );

  // Determine open bills (creditAmount > 0) and newest finalized timestamp
  const openBillNumbers: string[] = [];
  let lastFinalizedAt = params.ledgerDoc?.lastFinalizedAt || params.localArchive?.lastFinalizedAt || '';

  for (const rec of mergedReceipts) {
    const isOpenCredit = Number(rec.creditAmount || 0) > 0 && String(rec.receiptType).toUpperCase() !== 'REFUND';
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

/**
 * Admin-only: Syncs finalized Paid/Settled bills into the single-doc `/customer_ledgers/{customerCode}`
 * archive so customers never cause 10,000-bill Firestore reads across devices.
 */
export async function syncCustomerLedgerToFirestore(
  customerCode: string,
  enrichedBills: EnrichedCustomerReceipt[]
): Promise<boolean> {
  if (!auth.currentUser?.email) return false;
  const docId = toLedgerDocId(customerCode);
  if (!docId || docId === 'unknown') return false;

  const now = new Date().toISOString();
  const finalizedMap = new Map<string, ArchivedBillEntry>();

  // Preserve any historical archived bills beyond POS's 90-day window
  let existingDoc: CustomerLedgerDoc | null = null;
  try {
    const snap = await getDoc(doc(db, 'customer_ledgers', docId));
    if (snap.exists()) {
      existingDoc = snap.data() as CustomerLedgerDoc;
      for (const oldEntry of existingDoc.archivedBills || []) {
        if (oldEntry?.receiptNumber) {
          finalizedMap.set(oldEntry.receiptNumber, oldEntry);
        }
      }
    }
  } catch {
    // ignore read miss
  }

  // Upsert / remove entries based on live enriched bills
  for (const bill of enrichedBills) {
    const recNo = String(bill.receiptNumber || '').trim();
    if (!recNo) continue;

    if (bill.billStatus === 'due' || bill.billStatus === 'partial') {
      // If a bill was reverted via Undo settlement, ensure it is removed from settled archive
      finalizedMap.delete(recNo);
      continue;
    }

    const payMethods = bill.settlements.length > 0
      ? bill.settlements.map((s) => s.settlementMethod.toUpperCase()).join('+')
      : bill.payments.map((p) => p.type).filter(Boolean).join(', ') || 'Cash';

    finalizedMap.set(recNo, {
      receiptNumber: recNo.slice(0, 64),
      receiptType: String(bill.receiptType || 'SALE').slice(0, 32),
      dateTime: String(bill.dateTime || '').slice(0, 64),
      totalMoney: round3(Math.max(0, Number(bill.totalMoney || 0))),
      creditAmount: 0,
      paidAmount: round3(Math.max(0, Number(bill.billStatus === 'refund' ? 0 : bill.totalMoney || 0))),
      billStatus: bill.billStatus,
      paymentSummary: payMethods.slice(0, 64),
      itemCount: Array.isArray(bill.items) ? bill.items.length : 0,
      archivedAt: now,
    });
  }

  const allFinalized = Array.from(finalizedMap.values()).sort((a, b) =>
    a.dateTime < b.dateTime ? 1 : -1
  );
  const cappedArchived = allFinalized.slice(0, MAX_FIRESTORE_ARCHIVED_BILLS);
  const lastFinalizedAt = cappedArchived[0]?.dateTime || '';
  const totalArchivedBills = Math.max(
    allFinalized.length,
    Number(existingDoc?.totalArchivedBills || 0)
  );
  const totalArchivedPaidAmount = round3(
    allFinalized
      .filter((b) => b.billStatus !== 'refund')
      .reduce((s, b) => s + Number(b.totalMoney || 0), 0)
  );

  // Skip write if archive state is already identical
  if (
    existingDoc &&
    existingDoc.lastFinalizedAt === lastFinalizedAt &&
    existingDoc.totalArchivedBills === totalArchivedBills &&
    existingDoc.archivedBills?.length === cappedArchived.length &&
    existingDoc.archivedBills?.[0]?.billStatus === cappedArchived[0]?.billStatus &&
    Math.abs(Number(existingDoc.totalArchivedPaidAmount || 0) - totalArchivedPaidAmount) < 0.001
  ) {
    return false;
  }

  const payload: CustomerLedgerDoc = {
    customerCode: String(customerCode).trim().slice(0, 32),
    lastFinalizedAt: lastFinalizedAt.slice(0, 64),
    totalArchivedBills,
    totalArchivedPaidAmount,
    archivedBills: cappedArchived,
    createdAt: existingDoc?.createdAt || now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'customer_ledgers', docId), payload);
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `customer_ledgers/${docId}`);
  }
}
