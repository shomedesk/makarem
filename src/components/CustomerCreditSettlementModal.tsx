import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Receipt,
  CheckCircle2,
  Clock,
  Loader2,
  Banknote,
  CreditCard,
  Smartphone,
  RotateCcw,
  RefreshCw,
  CheckCheck,
} from 'lucide-react';
import type {
  AdminCustomerRecord,
  CreditSettlementRecord,
  CustomerLedgerDoc,
  EnrichedCustomerReceipt,
  SalesPlayCustomerProfileResponse,
  SalesPlayCustomerReceipt,
} from '../types';
import { fetchSalesPlayCustomerProfile } from '../services/customerService';
import {
  computeEnrichedCustomerBills,
  fetchCustomerSettlements,
  recordBillSettlement,
  subscribeToCustomerSettlements,
  undoBillSettlement,
} from '../services/creditSettlementService';
import {
  fetchCustomerLedgerDoc,
  ledgerDocToReceipts,
  mergeArchivedAndDeltaReceipts,
  syncCustomerLedgerToFirestore,
} from '../services/billArchiveService';

interface CustomerCreditSettlementModalProps {
  customer: AdminCustomerRecord | null;
  onClose: () => void;
  onSettledChange?: () => void;
  language: 'en' | 'ar';
}

function formatSettlementError(err: unknown, isAr: boolean): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const inner = String(parsed?.error || '');
      if (inner.toLowerCase().includes('permission')) {
        return isAr
          ? 'تم رفض الإذن: يرجى تسجيل الدخول بحساب Google المعتمد للإدارة لتسوية الفواتير.'
          : 'Permission denied: Please sign in with your verified Admin Google Account to record settlements.';
      }
      if (inner) return inner;
    } catch {
      // fall back to raw message
    }
  }
  return raw || (isAr ? 'حدث خطأ أثناء الحفظ' : 'Operation failed');
}

export const CustomerCreditSettlementModal: React.FC<CustomerCreditSettlementModalProps> = ({
  customer,
  onClose,
  onSettledChange,
  language,
}) => {
  const isAr = language === 'ar';
  const [isLoading, setIsLoading] = useState(false);
  const [posProfile, setPosProfile] = useState<SalesPlayCustomerProfileResponse | null>(null);
  const [cloudLedger, setCloudLedger] = useState<CustomerLedgerDoc | null>(null);
  const [settlements, setSettlements] = useState<CreditSettlementRecord[]>([]);
  const [filterMode, setFilterMode] = useState<'due' | 'all'>('due');
  const [method, setMethod] = useState<'cash' | 'card' | 'online'>('cash');
  const [busyReceipt, setBusyReceipt] = useState<string | null>(null);
  const [isSettlingAll, setIsSettlingAll] = useState(false);
  const [busyUndoId, setBusyUndoId] = useState<string | null>(null);
  const [partialBillNo, setPartialBillNo] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [partialNote, setPartialNote] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadPosData = async (cust: AdminCustomerRecord, forceRefresh = false) => {
    setIsLoading(true);
    try {
      const [ledgerDoc, data, freshSettlements] = await Promise.all([
        fetchCustomerLedgerDoc(cust.customerCode, true),
        fetchSalesPlayCustomerProfile(cust.phone, cust.customerCode, {
          full: true,
          force: forceRefresh,
        }),
        fetchCustomerSettlements(cust.customerCode, true),
      ]);
      setCloudLedger(ledgerDoc);
      setSettlements(freshSettlements);

      if (data && data.matched && ledgerDoc?.archivedBills?.length) {
        const merged = mergeArchivedAndDeltaReceipts({
          ledgerDoc,
          localArchive: null,
          deltaReceipts: data.receipts || [],
          activeReceiptNumbers: data.activeReceiptNumbers,
          windowStartDate: data.windowStartDate,
        });
        setPosProfile({ ...data, receipts: merged.mergedReceipts });
      } else {
        setPosProfile(data);
      }
    } catch (err) {
      console.warn('Failed to fetch customer POS receipts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!customer) {
      setPosProfile(null);
      setCloudLedger(null);
      setSettlements([]);
      setStatusMsg(null);
      setPartialBillNo(null);
      return;
    }
    loadPosData(customer, false);

    const unsub = subscribeToCustomerSettlements(customer.customerCode, (records) => {
      setSettlements(records);
    });
    return () => unsub();
  }, [customer?.id, customer?.customerCode]);

  const rawReceipts: SalesPlayCustomerReceipt[] = useMemo(() => {
    if (posProfile?.matched && Array.isArray(posProfile.receipts)) {
      return posProfile.receipts;
    }
    return ledgerDocToReceipts(cloudLedger);
  }, [posProfile, cloudLedger]);

  const creditLimitVal =
    posProfile?.creditSummary?.creditLimit ??
    cloudLedger?.creditLimit ??
    customer?.creditLimit ??
    null;

  const enriched = useMemo(() => {
    return computeEnrichedCustomerBills(rawReceipts, settlements, creditLimitVal);
  }, [rawReceipts, settlements, creditLimitVal]);

  // Keep Firestore 1-doc ledger archive synchronized whenever POS data updates on Dev Admin
  useEffect(() => {
    if (!customer?.customerCode || !posProfile?.matched) return;
    const code = posProfile.customer?.customerCode || customer.customerCode;
    syncCustomerLedgerToFirestore(code, enriched.bills, {
      customerName: posProfile.customer?.name || customer.name,
      customerPhone: posProfile.customer?.phone || customer.phone,
      creditLimit: creditLimitVal,
      totalVisits: posProfile.customer?.totalVisits ?? customer.totalVisits,
      totalSpent: posProfile.customer?.totalSpent ?? customer.totalSpent,
      firstVisit: posProfile.customer?.firstVisit || customer.firstVisit,
      authoritativeWindowStart: posProfile.windowStartDate || undefined,
    }).catch((err) => console.warn('Ledger archive sync skipped:', err));
  }, [
    customer?.customerCode,
    customer?.name,
    customer?.phone,
    customer?.totalVisits,
    customer?.totalSpent,
    customer?.firstVisit,
    creditLimitVal,
    posProfile,
    enriched.bills,
  ]);

  if (!customer) return null;

  const persistLedgerAfterMutation = async (
    nextSettlements: CreditSettlementRecord[],
    receiptsSource: SalesPlayCustomerReceipt[]
  ) => {
    const code = posProfile?.customer?.customerCode || customer.customerCode;
    const nextEnriched = computeEnrichedCustomerBills(
      receiptsSource,
      nextSettlements,
      creditLimitVal
    );
    const outcome = await syncCustomerLedgerToFirestore(code, nextEnriched.bills, {
      customerName: posProfile?.customer?.name || cloudLedger?.customerName || customer.name,
      customerPhone: posProfile?.customer?.phone || cloudLedger?.customerPhone || customer.phone,
      creditLimit: creditLimitVal,
      totalVisits: posProfile?.customer?.totalVisits ?? cloudLedger?.totalVisits ?? customer.totalVisits,
      totalSpent: posProfile?.customer?.totalSpent ?? cloudLedger?.totalSpent ?? customer.totalSpent,
      firstVisit: posProfile?.customer?.firstVisit || cloudLedger?.firstVisit || customer.firstVisit,
      authoritativeWindowStart: posProfile?.matched ? posProfile.windowStartDate || undefined : undefined,
      forceServerRead: true,
    });
    if (outcome === 'unauthorized' || outcome === 'unverified') {
      throw new Error(
        isAr
          ? 'يلزم تسجيل الدخول بحساب Google المعتمد لتحديث سجل العميل في السحابة.'
          : 'Verified Admin Google Sign-In is required to update the cloud customer ledger.'
      );
    }
    const refreshedLedger = await fetchCustomerLedgerDoc(code, true);
    if (refreshedLedger) {
      setCloudLedger(refreshedLedger);
    }
    onSettledChange?.();
    return nextEnriched;
  };

  const displayed = filterMode === 'due' ? enriched.dueBills : enriched.bills;

  const handleSettle = async (
    bill: EnrichedCustomerReceipt,
    amountToSettle: number,
    noteText?: string
  ) => {
    const rounded = Math.round(amountToSettle * 1000) / 1000;
    if (!Number.isFinite(rounded) || rounded <= 0 || rounded > bill.remainingDue + 0.0005) {
      setStatusMsg({
        type: 'err',
        text: isAr
          ? 'يرجى إدخال مبلغ صحيح لا يتجاوز المبلغ المتبقي'
          : 'Enter a valid amount up to the remaining due balance.',
      });
      return;
    }

    const settleVal = Math.min(rounded, bill.remainingDue);
    setBusyReceipt(bill.receiptNumber);
    setStatusMsg(null);
    try {
      const created = await recordBillSettlement({
        customerCode: customer.customerCode,
        receiptNumber: bill.receiptNumber,
        receiptDateTime: bill.dateTime,
        billTotal: bill.totalMoney,
        originalCreditAmount: bill.originalCreditAmount || bill.creditAmount || bill.totalMoney,
        settledAmount: settleVal,
        settlementMethod: method,
        note: noteText,
      });

      const nextSettlements = [created, ...settlements.filter((s) => s.id !== created.id)];
      setSettlements(nextSettlements);
      const nextEnriched = await persistLedgerAfterMutation(nextSettlements, rawReceipts);

      setPartialBillNo(null);
      setPartialAmount('');
      setPartialNote('');
      const allCleared = nextEnriched.dueBills.length === 0;
      setStatusMsg({
        type: 'ok',
        text: isAr
          ? `تمت تسوية ${settleVal.toFixed(3)} OMR من الفاتورة #${bill.receiptNumber}${
              allCleared ? ' · الحساب الآن خالٍ من أي مستحقات (Clear)' : ''
            }`
          : `Settled ${settleVal.toFixed(3)} OMR on Bill #${bill.receiptNumber}${
              allCleared ? ' · Account is now ALL CLEAR!' : '. Customer dashboard updated live.'
            }`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: formatSettlementError(err, isAr),
      });
    } finally {
      setBusyReceipt(null);
    }
  };

  const handleSettleAllDue = async () => {
    if (enriched.dueBills.length === 0) return;
    setIsSettlingAll(true);
    setStatusMsg(null);
    try {
      const createdRecords: CreditSettlementRecord[] = [];
      for (const bill of enriched.dueBills) {
        if (bill.remainingDue <= 0.0005) continue;
        const created = await recordBillSettlement({
          customerCode: customer.customerCode,
          receiptNumber: bill.receiptNumber,
          receiptDateTime: bill.dateTime,
          billTotal: bill.totalMoney,
          originalCreditAmount: bill.originalCreditAmount || bill.creditAmount || bill.totalMoney,
          settledAmount: bill.remainingDue,
          settlementMethod: method,
          note: 'Full account settlement',
        });
        createdRecords.push(created);
      }

      const nextSettlements = [...createdRecords, ...settlements];
      setSettlements(nextSettlements);
      await persistLedgerAfterMutation(nextSettlements, rawReceipts);

      setPartialBillNo(null);
      setStatusMsg({
        type: 'ok',
        text: isAr
          ? `تمت تسوية جميع الفواتير (${createdRecords.length}) بالكامل — الحساب الآن خالٍ من المستحقات!`
          : `Settled all ${createdRecords.length} due bill(s) — Customer dashboard is now ALL CLEAR!`,
      });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: formatSettlementError(err, isAr),
      });
    } finally {
      setIsSettlingAll(false);
    }
  };

  const handleUndo = async (st: CreditSettlementRecord) => {
    setBusyUndoId(st.id);
    setStatusMsg(null);
    try {
      await undoBillSettlement(st.id);
      const nextSettlements = settlements.filter((item) => item.id !== st.id);
      setSettlements(nextSettlements);

      // On Cloud Snapshot mode (launched static host), restore original creditAmount on the undone bill
      const restoredReceipts = rawReceipts.map((rec) => {
        if (rec.receiptNumber !== st.receiptNumber) return rec;
        const hasPosCredit = Number(rec.creditAmount || 0) > 0;
        if (hasPosCredit) return rec;
        const restoredCredit = Math.max(0, Number(st.originalCreditAmount || rec.totalMoney || 0));
        return {
          ...rec,
          creditAmount: restoredCredit,
          paidAmount: Math.max(0, Number(rec.totalMoney || 0) - restoredCredit),
          hasAdvance: false,
          payments: [
            {
              type: 'Credit',
              amount: restoredCredit,
              paidAt: rec.dateTime,
              isAdvance: false,
            },
          ],
        };
      });

      await persistLedgerAfterMutation(nextSettlements, restoredReceipts);
      setStatusMsg({
        type: 'ok',
        text: isAr
          ? 'تم التراجع عن التسوية وإعادة الفاتورة كمستحقة'
          : 'Settlement undone — bill reverted to Due on customer dashboard.',
      });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: formatSettlementError(err, isAr),
      });
    } finally {
      setBusyUndoId(null);
    }
  };

  const isCloudSnapshotMode = !posProfile?.matched && Boolean(cloudLedger);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200">
        {/* Modal Header */}
        <div className="p-5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-black font-mono flex items-center justify-center text-sm shrink-0">
              #{customer.customerCode}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-extrabold text-sm sm:text-base">{customer.name}</h3>
                {isCloudSnapshotMode && (
                  <span className="px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-200 text-[10px] font-bold">
                    {isAr ? 'وضع السحابة' : 'Cloud Mode'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 font-mono">
                {customer.phone || 'No mobile'} ·{' '}
                {isAr ? 'إدارة الفواتير المستحقة والتسوية' : 'Credit & Due Bills Settlement'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadPosData(customer, true)}
              disabled={isLoading}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              title={isAr ? 'تحديث البيانات' : 'Refresh Bills'}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-3 gap-2.5 p-4 bg-slate-50 border-b border-slate-200 shrink-0 text-xs">
          <div className="p-3 rounded-xl bg-white border border-slate-200">
            <div className="text-[11px] font-bold text-slate-500">
              {isAr ? 'حد الائتمان' : 'Credit Limit'}
            </div>
            <div className="font-black text-sm sm:text-base text-slate-900 font-mono tabular-nums mt-0.5">
              {creditLimitVal !== null ? `${creditLimitVal.toFixed(3)} OMR` : 'Open'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <div className="text-[11px] font-bold text-amber-900">
              {isAr ? 'إجمالي المستحق' : 'Unpaid Due'}
            </div>
            <div className="font-black text-sm sm:text-base text-rose-700 font-mono tabular-nums mt-0.5">
              {enriched.totalDueNow.toFixed(3)} OMR
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="text-[11px] font-bold text-emerald-900">
              {isAr ? 'المتبقي / الحالة' : creditLimitVal !== null ? 'Remaining Credit' : 'Status'}
            </div>
            <div className="font-black text-sm sm:text-base text-emerald-800 font-mono tabular-nums mt-0.5">
              {enriched.remainingCredit !== null
                ? `${enriched.remainingCredit.toFixed(3)} OMR`
                : enriched.totalDueNow <= 0.0005
                ? 'ALL CLEAR'
                : `Settled ${enriched.totalSettledViaAdmin.toFixed(3)}`}
            </div>
          </div>
        </div>

        {/* Settlement Method Selector, Filter Bar & Settle All CTA */}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white shrink-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterMode('due')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                filterMode === 'due'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {isAr
                ? `الفواتير المستحقة (${enriched.dueBills.length})`
                : `Due Bills (${enriched.dueBills.length})`}
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                filterMode === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {isAr
                ? `كل الفواتير (${enriched.bills.length})`
                : `All Bills (${enriched.bills.length})`}
            </button>

            {enriched.dueBills.length > 0 && (
              <button
                type="button"
                disabled={isSettlingAll || Boolean(busyReceipt)}
                onClick={handleSettleAllDue}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
              >
                {isSettlingAll ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="w-3.5 h-3.5" />
                )}
                <span>
                  {isAr
                    ? `تسوية الكل (${enriched.totalDueNow.toFixed(3)} OMR)`
                    : `Clear All (${enriched.totalDueNow.toFixed(3)} OMR)`}
                </span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-bold text-slate-500">
              {isAr ? 'طريقة التسوية:' : 'Settle via:'}
            </span>
            {[
              { id: 'cash' as const, label: isAr ? 'كاش' : 'Cash', icon: Banknote },
              { id: 'card' as const, label: isAr ? 'بطاقة' : 'Card', icon: CreditCard },
              { id: 'online' as const, label: isAr ? 'تحويل' : 'Online', icon: Smartphone },
            ].map((pm) => {
              const Icon = pm.icon;
              return (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => setMethod(pm.id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-bold cursor-pointer ${
                    method === pm.id
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{pm.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Message */}
        {statusMsg && (
          <div
            className={`mx-4 mt-3 px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 shrink-0 ${
              statusMsg.type === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            <span>{statusMsg.text}</span>
            <button type="button" onClick={() => setStatusMsg(null)} className="cursor-pointer shrink-0">
              ✕
            </button>
          </div>
        )}

        {/* Bills List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Receipt className="w-9 h-9 mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-700">
                {filterMode === 'due'
                  ? isAr
                    ? 'لا توجد فواتير مستحقة لهذا العميل · الحساب سليم'
                    : 'All Clear — No unpaid due bills for this customer'
                  : isAr
                  ? 'لا توجد فواتير مسجلة'
                  : 'No receipts synced yet'}
              </p>
            </div>
          ) : (
            displayed.map((bill) => {
              const isDue = bill.billStatus === 'due' || bill.billStatus === 'partial';
              const isBusy = busyReceipt === bill.receiptNumber || isSettlingAll;
              const isPartialOpen = partialBillNo === bill.receiptNumber;

              return (
                <div
                  key={bill.receiptNumber}
                  className={`p-4 rounded-2xl border space-y-3 ${
                    isDue
                      ? 'bg-amber-50/50 border-amber-300'
                      : bill.billStatus === 'settled'
                      ? 'bg-emerald-50/40 border-emerald-200'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-black text-sm text-slate-900">
                          #{bill.receiptNumber}
                        </span>
                        {bill.billStatus === 'due' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-900 text-[10px] font-extrabold">
                            <Clock className="w-3 h-3" />
                            {isAr ? 'مستحق' : 'DUE'}
                          </span>
                        )}
                        {bill.billStatus === 'partial' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-950 text-[10px] font-extrabold">
                            <Clock className="w-3 h-3" />
                            {isAr ? 'مدفوع جزئياً' : 'PARTIAL'}
                          </span>
                        )}
                        {bill.billStatus === 'settled' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 text-[10px] font-extrabold">
                            <CheckCircle2 className="w-3 h-3" />
                            {isAr ? 'تمت التسوية' : 'SETTLED'}
                          </span>
                        )}
                        {bill.billStatus === 'paid' && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                            {bill.payments.map((p) => p.type).join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {bill.dateTime}
                      </div>
                    </div>

                    <div className="text-end font-mono tabular-nums">
                      <div className="text-sm font-black text-slate-900">
                        {bill.totalMoney.toFixed(3)} OMR
                      </div>
                      {isDue && (
                        <div className="text-xs font-extrabold text-rose-700">
                          {isAr ? 'متبقي:' : 'Due:'} {bill.remainingDue.toFixed(3)} OMR
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Admin Settlement Actions on Due Bills */}
                  {isDue && (
                    <div className="pt-2 border-t border-amber-200/80 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSettle(bill, bill.remainingDue)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isAr
                              ? `تسوية كاملة (${bill.remainingDue.toFixed(3)} OMR)`
                              : `Settle Full (${bill.remainingDue.toFixed(3)} OMR)`}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isPartialOpen) {
                              setPartialBillNo(null);
                            } else {
                              setPartialBillNo(bill.receiptNumber);
                              setPartialAmount(bill.remainingDue.toFixed(3));
                              setPartialNote('');
                            }
                          }}
                          className="px-3 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer"
                        >
                          {isAr ? 'تسوية جزئية' : 'Partial Pay'}
                        </button>
                      </div>

                      {isPartialOpen && (
                        <div className="p-3 rounded-xl bg-white border border-slate-200 flex flex-col sm:flex-row gap-2">
                          <input
                            type="number"
                            step="0.001"
                            min="0.001"
                            max={bill.remainingDue}
                            value={partialAmount}
                            onChange={(e) => setPartialAmount(e.target.value)}
                            placeholder={bill.remainingDue.toFixed(3)}
                            className="sm:w-32 px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                          />
                          <input
                            type="text"
                            value={partialNote}
                            onChange={(e) => setPartialNote(e.target.value)}
                            placeholder={isAr ? 'ملاحظة (اختياري)' : 'Optional note'}
                            className="flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              handleSettle(bill, parseFloat(partialAmount), partialNote)
                            }
                            className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                          >
                            {isAr ? 'تأكيد' : 'Confirm'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recorded Settlement History + Undo Option */}
                  {bill.settlements.length > 0 && (
                    <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                      {bill.settlements.map((st) => (
                        <div
                          key={st.id}
                          className="flex items-center justify-between gap-2 text-[11px] bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl text-emerald-950"
                        >
                          <div>
                            <span className="font-mono font-extrabold">
                              {st.settledAmount.toFixed(3)} OMR
                            </span>{' '}
                            <span className="uppercase font-bold">({st.settlementMethod})</span> ·{' '}
                            <span className="text-emerald-700">
                              {new Date(st.settledAt).toLocaleString()}
                            </span>
                            {st.note ? ` · ${st.note}` : ''}
                          </div>

                          <button
                            type="button"
                            disabled={busyUndoId === st.id}
                            onClick={() => handleUndo(st)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-300 text-slate-600 hover:text-rose-700 font-bold cursor-pointer shrink-0"
                            title={isAr ? 'تراجع عن التسوية' : 'Undo settlement'}
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{isAr ? 'تراجع' : 'Undo'}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
