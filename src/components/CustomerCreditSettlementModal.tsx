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
} from 'lucide-react';
import type {
  AdminCustomerRecord,
  CreditSettlementRecord,
  EnrichedCustomerReceipt,
  SalesPlayCustomerProfileResponse,
} from '../types';
import { fetchSalesPlayCustomerProfile } from '../services/customerService';
import {
  computeEnrichedCustomerBills,
  recordBillSettlement,
  subscribeToCustomerSettlements,
  undoBillSettlement,
} from '../services/creditSettlementService';
import {
  fetchCustomerLedgerDoc,
  mergeArchivedAndDeltaReceipts,
  syncCustomerLedgerToFirestore,
} from '../services/billArchiveService';

interface CustomerCreditSettlementModalProps {
  customer: AdminCustomerRecord | null;
  onClose: () => void;
  language: 'en' | 'ar';
}

export const CustomerCreditSettlementModal: React.FC<CustomerCreditSettlementModalProps> = ({
  customer,
  onClose,
  language,
}) => {
  const isAr = language === 'ar';
  const [isLoading, setIsLoading] = useState(false);
  const [posProfile, setPosProfile] = useState<SalesPlayCustomerProfileResponse | null>(null);
  const [settlements, setSettlements] = useState<CreditSettlementRecord[]>([]);
  const [filterMode, setFilterMode] = useState<'due' | 'all'>('due');
  const [method, setMethod] = useState<'cash' | 'card' | 'online'>('cash');
  const [busyReceipt, setBusyReceipt] = useState<string | null>(null);
  const [busyUndoId, setBusyUndoId] = useState<string | null>(null);
  const [partialBillNo, setPartialBillNo] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState<string>('');
  const [partialNote, setPartialNote] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadPosData = async (cust: AdminCustomerRecord, forceRefresh = false) => {
    setIsLoading(true);
    try {
      const [ledgerDoc, data] = await Promise.all([
        fetchCustomerLedgerDoc(cust.customerCode),
        fetchSalesPlayCustomerProfile(cust.phone, cust.customerCode, {
          full: true,
          force: forceRefresh,
        }),
      ]);
      if (data && ledgerDoc?.archivedBills?.length) {
        const merged = mergeArchivedAndDeltaReceipts({
          ledgerDoc,
          localArchive: null,
          deltaReceipts: data.receipts || [],
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

  const enriched = useMemo(() => {
    const rawReceipts = posProfile?.receipts || [];
    const limitVal =
      posProfile?.creditSummary?.creditLimit ?? customer?.creditLimit ?? null;
    return computeEnrichedCustomerBills(rawReceipts, settlements, limitVal);
  }, [posProfile, settlements, customer?.creditLimit]);

  // Keep Firestore 1-doc ledger archive synchronized when Admin views or modifies settlements
  useEffect(() => {
    if (!customer?.customerCode || !posProfile || enriched.bills.length === 0) return;
    const code = posProfile.customer?.customerCode || customer.customerCode;
    syncCustomerLedgerToFirestore(code, enriched.bills).catch((err) =>
      console.warn('Ledger archive sync skipped:', err)
    );
  }, [customer?.customerCode, posProfile, enriched.bills]);

  if (!customer) return null;

  const creditLimitVal =
    posProfile?.creditSummary?.creditLimit ?? customer.creditLimit ?? null;

  const displayed =
    filterMode === 'due' ? enriched.dueBills : enriched.bills;

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

    setBusyReceipt(bill.receiptNumber);
    setStatusMsg(null);
    try {
      await recordBillSettlement({
        customerCode: customer.customerCode,
        receiptNumber: bill.receiptNumber,
        receiptDateTime: bill.dateTime,
        billTotal: bill.totalMoney,
        originalCreditAmount: bill.originalCreditAmount,
        settledAmount: Math.min(rounded, bill.remainingDue),
        settlementMethod: method,
        note: noteText,
      });
      setPartialBillNo(null);
      setPartialAmount('');
      setPartialNote('');
      setStatusMsg({
        type: 'ok',
        text: isAr
          ? `تمت تسوية ${Math.min(rounded, bill.remainingDue).toFixed(3)} OMR من الفاتورة #${bill.receiptNumber}`
          : `Settled ${Math.min(rounded, bill.remainingDue).toFixed(3)} OMR on Bill #${bill.receiptNumber}. Customer dashboard updated live.`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Failed to record settlement',
      });
    } finally {
      setBusyReceipt(null);
    }
  };

  const handleUndo = async (settlementId: string) => {
    setBusyUndoId(settlementId);
    setStatusMsg(null);
    try {
      await undoBillSettlement(settlementId);
      setStatusMsg({
        type: 'ok',
        text: isAr
          ? 'تم التراجع عن التسوية وإعادة الفاتورة كمستحقة'
          : 'Settlement undone — bill reverted to Due.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Failed to undo settlement',
      });
    } finally {
      setBusyUndoId(null);
    }
  };

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
              <h3 className="font-extrabold text-sm sm:text-base">{customer.name}</h3>
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
              title={isAr ? 'تحديث من POS' : 'Refresh from POS'}
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
              {isAr ? 'المتبقي / المسدد' : 'Remaining Credit'}
            </div>
            <div className="font-black text-sm sm:text-base text-emerald-800 font-mono tabular-nums mt-0.5">
              {enriched.remainingCredit !== null
                ? `${enriched.remainingCredit.toFixed(3)} OMR`
                : `Settled ${enriched.totalSettledViaAdmin.toFixed(3)}`}
            </div>
          </div>
        </div>

        {/* Settlement Method Selector & Filter Bar */}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white shrink-0">
          <div className="flex items-center gap-1.5">
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
            className={`mx-4 mt-3 px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between shrink-0 ${
              statusMsg.type === 'ok'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            <span>{statusMsg.text}</span>
            <button type="button" onClick={() => setStatusMsg(null)} className="cursor-pointer">
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
                    ? 'لا توجد فواتير مستحقة لهذا العميل'
                    : 'No unpaid due bills for this customer'
                  : isAr
                  ? 'لا توجد فواتير مسجلة'
                  : 'No receipts found'}
              </p>
            </div>
          ) : (
            displayed.map((bill) => {
              const isDue = bill.billStatus === 'due' || bill.billStatus === 'partial';
              const isBusy = busyReceipt === bill.receiptNumber;
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
                            onClick={() => handleUndo(st.id)}
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
