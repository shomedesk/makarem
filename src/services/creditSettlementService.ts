import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type {
  BillSettlementStatus,
  CreditSettlementRecord,
  EnrichedCustomerReceipt,
  SalesPlayCustomerReceipt,
} from '../types';

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Fetches all recorded bill settlements for a specific customerCode.
 */
export async function fetchCustomerSettlements(
  customerCode: string
): Promise<CreditSettlementRecord[]> {
  const cleanCode = String(customerCode || '').trim();
  if (!cleanCode) return [];

  const q = query(
    collection(db, 'credit_settlements'),
    where('customerCode', '==', cleanCode),
    limit(200)
  );

  try {
    const snap = await getDocs(q);
    const items: CreditSettlementRecord[] = [];
    snap.forEach((d) => {
      items.push({ id: d.id, ...(d.data() as Omit<CreditSettlementRecord, 'id'>) });
    });
    return items.sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
  } catch (err) {
    console.warn('Could not load customer settlements:', err);
    return [];
  }
}

/**
 * Admin-only: Fetches all credit settlements so the Admin Reports & Debtors dashboard
 * shows exact Net Unpaid Credit across every customer.
 */
export async function fetchAllSettlementsForAdmin(): Promise<CreditSettlementRecord[]> {
  try {
    const q = query(collection(db, 'credit_settlements'), limit(500));
    const snap = await getDocs(q);
    const items: CreditSettlementRecord[] = [];
    snap.forEach((d) => {
      items.push({ id: d.id, ...(d.data() as Omit<CreditSettlementRecord, 'id'>) });
    });
    return items.sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
  } catch (err) {
    console.warn('Could not load admin settlements:', err);
    return [];
  }
}

/**
 * Live scoped listener for a single customer's credit settlements (used while viewing /profile
 * or Admin customer credit modal so bill statuses flip immediately when settled).
 */
export function subscribeToCustomerSettlements(
  customerCode: string,
  callback: (records: CreditSettlementRecord[]) => void
): Unsubscribe {
  const cleanCode = String(customerCode || '').trim();
  if (!cleanCode) {
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, 'credit_settlements'),
    where('customerCode', '==', cleanCode),
    limit(200)
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: CreditSettlementRecord[] = [];
      snap.forEach((d) => {
        items.push({ id: d.id, ...(d.data() as Omit<CreditSettlementRecord, 'id'>) });
      });
      items.sort((a, b) => (a.settledAt < b.settledAt ? 1 : -1));
      callback(items);
    },
    (err) => {
      console.warn('Settlement listener error:', err);
    }
  );
}

/**
 * Admin-only: Records a full or partial settlement against a specific SalesPlay Credit bill.
 */
export async function recordBillSettlement(params: {
  customerCode: string;
  receiptNumber: string;
  receiptDateTime: string;
  billTotal: number;
  originalCreditAmount: number;
  settledAmount: number;
  settlementMethod: 'cash' | 'card' | 'online';
  note?: string;
}): Promise<CreditSettlementRecord> {
  const cleanCode = String(params.customerCode || '').trim();
  const cleanReceipt = String(params.receiptNumber || '').trim();
  const amount = round3(Number(params.settledAmount || 0));

  if (!cleanCode || !cleanReceipt) {
    throw new Error('Customer code and receipt number are required');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Settlement amount must be greater than zero');
  }

  const now = new Date().toISOString();
  const safeReceipt = cleanReceipt.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const settlementId = `stl_${cleanCode.replace(/[^a-zA-Z0-9_\-]/g, '_')}_${safeReceipt}_${Date.now()}`;

  const payload: CreditSettlementRecord = {
    id: settlementId,
    customerCode: cleanCode,
    receiptNumber: cleanReceipt,
    receiptDateTime: String(params.receiptDateTime || now).slice(0, 64),
    billTotal: round3(Math.max(0, Number(params.billTotal || 0))),
    originalCreditAmount: round3(Math.max(0, Number(params.originalCreditAmount || 0))),
    settledAmount: amount,
    settlementMethod: params.settlementMethod,
    ...(params.note && params.note.trim() ? { note: params.note.trim().slice(0, 300) } : {}),
    ...(auth.currentUser?.email ? { settledByEmail: auth.currentUser.email } : {}),
    settledAt: now,
    createdAt: now,
  };

  try {
    await setDoc(doc(db, 'credit_settlements', settlementId), payload);
    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `credit_settlements/${settlementId}`);
  }
}

/**
 * Admin-only: Removes a mistakenly recorded settlement so the bill reverts cleanly to DUE.
 */
export async function undoBillSettlement(settlementId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'credit_settlements', settlementId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `credit_settlements/${settlementId}`);
  }
}

/**
 * Pure deterministic calculator merging SalesPlay POS receipts + Admin Firestore settlements.
 * Guarantees pie chart totals, summary counts, and row statuses are always 100% consistent.
 */
export function computeEnrichedCustomerBills(
  receipts: SalesPlayCustomerReceipt[],
  settlements: CreditSettlementRecord[],
  creditLimit: number | null
): {
  bills: EnrichedCustomerReceipt[];
  dueBills: EnrichedCustomerReceipt[];
  settledAndPaidBills: EnrichedCustomerReceipt[];
  totalDueNow: number;
  totalSettledViaAdmin: number;
  remainingCredit: number | null;
} {
  const settlementsByReceipt = new Map<string, CreditSettlementRecord[]>();
  for (const st of settlements) {
    const key = String(st.receiptNumber || '').trim();
    const list = settlementsByReceipt.get(key) || [];
    list.push(st);
    settlementsByReceipt.set(key, list);
  }

  let totalDueNow = 0;
  let totalSettledViaAdmin = 0;

  const bills: EnrichedCustomerReceipt[] = receipts.map((rec) => {
    const recNo = String(rec.receiptNumber || '').trim();
    const isRefund = String(rec.receiptType || '').toUpperCase() === 'REFUND';

    const posCredit = round3(Math.max(0, Number(rec.creditAmount || 0)));
    const posPaid =
      rec.paidAmount !== undefined
        ? round3(Math.max(0, Number(rec.paidAmount)))
        : round3(
            rec.payments
              .filter((p) => String(p.type || '').trim().toLowerCase() !== 'credit')
              .reduce((s, p) => s + Number(p.amount || 0), 0)
          );

    const recSettlements = settlementsByReceipt.get(recNo) || [];
    const rawAdminSettled = recSettlements.reduce(
      (s, st) => s + Math.max(0, Number(st.settledAmount || 0)),
      0
    );

    // If POS receipt no longer carries Credit (already paid/updated inside SalesPlay POS),
    // remainingDue is 0 so we never double-count or show false due.
    const effectiveAdminSettled = round3(Math.min(posCredit, rawAdminSettled));
    const remainingDue = isRefund ? 0 : round3(Math.max(0, posCredit - effectiveAdminSettled));

    if (isRefund) {
      totalDueNow = round3(Math.max(0, totalDueNow - posCredit));
    } else {
      totalDueNow = round3(totalDueNow + remainingDue);
      totalSettledViaAdmin = round3(totalSettledViaAdmin + effectiveAdminSettled);
    }

    let billStatus: BillSettlementStatus = 'paid';
    if (isRefund) {
      billStatus = 'refund';
    } else if (posCredit === 0) {
      billStatus = rec.hasAdvance || recSettlements.length > 0 ? 'settled' : 'paid';
    } else if (remainingDue <= 0.0005) {
      billStatus = 'settled';
    } else if (effectiveAdminSettled > 0 || posPaid > 0) {
      billStatus = 'partial';
    } else {
      billStatus = 'due';
    }

    return {
      ...rec,
      billStatus,
      originalCreditAmount: posCredit,
      posPaidAmount: posPaid,
      adminSettledAmount: effectiveAdminSettled,
      remainingDue: remainingDue <= 0.0005 ? 0 : remainingDue,
      settlements: recSettlements,
    };
  });

  const dueBills = bills.filter((b) => b.billStatus === 'due' || b.billStatus === 'partial');
  const settledAndPaidBills = bills.filter(
    (b) => b.billStatus === 'settled' || b.billStatus === 'paid' || b.billStatus === 'refund'
  );

  const remainingCredit =
    creditLimit !== null ? round3(Math.max(0, creditLimit - totalDueNow)) : null;

  return {
    bills,
    dueBills,
    settledAndPaidBills,
    totalDueNow: round3(Math.max(0, totalDueNow)),
    totalSettledViaAdmin,
    remainingCredit,
  };
}
