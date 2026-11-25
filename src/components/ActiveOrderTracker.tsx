import React, { useEffect, useRef } from 'react';
import {
  CheckCircle2,
  Phone,
  CreditCard,
  Banknote,
  Smartphone,
  Sparkles,
  ArrowRight,
  Hash,
} from 'lucide-react';
import type { Order } from '../types';
import { playOrderReadyChime, playSuccessChime } from '../utils/audio';

interface ActiveOrderTrackerProps {
  order: Order;
  onNewOrder: () => void;
  language: 'en' | 'ar';
}

export const ActiveOrderTracker: React.FC<ActiveOrderTrackerProps> = ({
  order,
  onNewOrder,
  language,
}) => {
  const isAr = language === 'ar';
  const prevStatusRef = useRef(order.status);

  useEffect(() => {
    if (prevStatusRef.current !== order.status) {
      if (order.status === 'ready') {
        playOrderReadyChime();
      } else if (order.status === 'completed') {
        playSuccessChime();
      }
      prevStatusRef.current = order.status;
    }
  }, [order.status]);

  const [countdown, setCountdown] = React.useState<number | null>(null);
  const onNewOrderRef = useRef(onNewOrder);

  useEffect(() => {
    onNewOrderRef.current = onNewOrder;
  }, [onNewOrder]);

  useEffect(() => {
    if (order.status === 'completed' && order.paymentStatus === 'received') {
      setCountdown(3);
    } else {
      setCountdown(null);
    }
  }, [order.status, order.paymentStatus]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      onNewOrderRef.current();
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const isReady = order.status === 'ready';
  const isCompleted = order.status === 'completed';

  const steps = [
    {
      key: 'pending',
      titleEn: 'Order Received',
      titleAr: 'تم استلام الطلب',
      descEn: 'Sent directly to store counter',
      descAr: 'وصل الطلب إلى المتجر',
    },
    {
      key: 'processing',
      titleEn: 'Packing Items',
      titleAr: 'جاري التجهيز والتعبئة',
      descEn: 'Staff is preparing your groceries',
      descAr: 'يتم تجهيز مشترياتك الآن',
    },
    {
      key: 'ready',
      titleEn: 'Ready for Pickup / Handover',
      titleAr: 'جاهز للاستلام',
      descEn: 'Your order is packed and ready',
      descAr: 'تم تجهيز طلبك بالكامل',
    },
    {
      key: 'completed',
      titleEn: 'Completed & Paid',
      titleAr: 'مكتمل ومدفوع',
      descEn: 'Thank you for shopping with us!',
      descAr: 'شكراً لتسوقك من مكارم الخير!',
    },
  ];

  const getStepIndex = (status: string) => {
    switch (status) {
      case 'pending':
        return 0;
      case 'processing':
        return 1;
      case 'ready':
        return 2;
      case 'completed':
        return 3;
      default:
        return 0;
    }
  };

  const currentStepIndex = getStepIndex(order.status);

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-2">
      {/* Status Banner */}
      {isReady ? (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h3 className="font-extrabold text-lg">
                {isAr ? 'طلبك جاهز الآن!' : 'Your Order is Ready!'}
              </h3>
              <p className="text-xs sm:text-sm text-emerald-100 font-['Cairo',sans-serif]">
                {isAr
                  ? 'تم تجهيز مشترياتك في بقالة مكارم الخير الحديثة.'
                  : 'Your order is packed and ready at Makarem Al-Khair.'}
              </p>
            </div>
          </div>
        </div>
      ) : isCompleted ? (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-700 to-teal-700 text-white shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 text-amber-300" />
              </div>
              <div>
                <h3 className="font-extrabold text-base sm:text-lg">
                  {isAr ? 'تم إكمال الطلب بنجاح' : 'Order Completed Successfully'}
                </h3>
                <p className="text-xs text-emerald-100">
                  {isAr
                    ? 'شكراً لتسوقك من مكارم الخير الحديثة'
                    : 'Thank you for shopping at Makarem Al-Khair'}
                </p>
              </div>
            </div>
            {countdown !== null && (
              <span className="text-xs font-mono font-bold bg-white/20 px-2.5 py-1 rounded-lg">
                {countdown}s
              </span>
            )}
          </div>

          <div className="pt-2 flex items-center justify-between gap-2 border-t border-white/20">
            <span className="text-xs text-white/90">
              {isAr ? 'العودة للمتجر تلقائياً...' : 'Returning to storefront...'}
            </span>
            <button
              type="button"
              onClick={onNewOrder}
              className="px-4 py-2 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 font-extrabold text-xs transition cursor-pointer"
            >
              {isAr ? 'تسوق الآن' : 'Back to Shop'}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-white border border-slate-200 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-slate-900">
              {isAr ? 'متابعة حالة الطلب المباشرة' : 'Live Order Status'}
            </div>
            <div className="text-[11px] text-slate-500">
              {isAr ? 'يتم تحديث الحالة تلقائياً من المتجر' : 'Updates automatically as your order is prepared'}
            </div>
          </div>
          <span className="px-2.5 py-1 text-xs font-bold bg-amber-100 text-amber-800 rounded-lg">
            {order.status === 'processing'
              ? isAr
                ? 'جاري التجهيز'
                : 'Packing'
              : isAr
              ? 'في الانتظار'
              : 'Pending'}
          </span>
        </div>
      )}

      {/* Main Card */}
      <div className="bg-white rounded-2xl p-5 sm:p-7 border border-slate-200 space-y-6">
        <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-100 gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {isAr ? 'رقم الطلب' : 'Order Reference'}
            </span>
            <div className="text-2xl sm:text-3xl font-black text-emerald-700 font-mono">
              {order.orderNumber}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {order.customerCode && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-mono font-bold">
                <Hash className="w-3.5 h-3.5 text-emerald-700" />
                {order.customerCode}
              </span>
            )}
            {order.customerPhone && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-mono font-bold">
                <Phone className="w-3.5 h-3.5" />
                {order.customerPhone}
              </span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="relative ps-6 space-y-5 border-s-2 border-slate-200 ms-3">
          {steps.map((st, idx) => {
            const isPast = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            return (
              <div key={st.key} className="relative">
                <div
                  className={`absolute -start-[31px] top-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    isPast || isCurrent
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {isPast ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                </div>
                <h5
                  className={`text-sm font-bold ${
                    isCurrent
                      ? 'text-emerald-800'
                      : isPast
                      ? 'text-slate-900'
                      : 'text-slate-400'
                  }`}
                >
                  {isAr ? st.titleAr : st.titleEn}
                </h5>
                <p className="text-xs text-slate-500">{isAr ? st.descAr : st.descEn}</p>
              </div>
            );
          })}
        </div>

        {/* Payment Method */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-semibold">
            {isAr ? 'طريقة الدفع:' : 'Payment Method:'}
          </span>
          <span className="font-bold text-slate-900 flex items-center gap-1.5">
            {order.paymentMethod === 'card' && <CreditCard className="w-3.5 h-3.5 text-emerald-600" />}
            {order.paymentMethod === 'cash' && <Banknote className="w-3.5 h-3.5 text-emerald-600" />}
            {order.paymentMethod === 'online' && <Smartphone className="w-3.5 h-3.5 text-emerald-600" />}
            <span>
              {order.paymentMethod === 'card'
                ? isAr
                  ? 'بطاقة'
                  : 'Card'
                : order.paymentMethod === 'cash'
                ? isAr
                  ? 'نقداً (كاش)'
                  : 'Cash'
                : isAr
                ? 'تحويل إلكتروني'
                : 'Online Transfer'}
            </span>
          </span>
        </div>

        {/* Ordered Items */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {isAr ? 'الأصناف المطلوبة' : 'Order Items'}
          </h4>
          {order.items.length > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {order.items.map((it) => (
                <div key={it.productId || it.name} className="p-3 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900">
                      {isAr ? it.arabicName || it.name : it.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {it.quantity} × {it.price.toFixed(3)} OMR
                    </div>
                  </div>
                  <div className="font-bold text-slate-900 font-mono tabular-nums">
                    {it.total.toFixed(3)} OMR
                  </div>
                </div>
              ))}
            </div>
          )}

          {order.customNotes && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950">
              <span className="font-bold block mb-0.5">{isAr ? 'ملاحظات:' : 'Notes:'}</span>
              <p className="whitespace-pre-wrap">{order.customNotes}</p>
            </div>
          )}

          <div className="p-3.5 bg-slate-900 text-white rounded-xl flex items-center justify-between">
            <span className="text-xs font-semibold">{isAr ? 'الإجمالي:' : 'Total:'}</span>
            <span className="text-lg font-extrabold text-emerald-400 font-mono tabular-nums">
              {order.totalAmount.toFixed(3)} OMR
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onNewOrder}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition cursor-pointer"
        >
          <span>{isAr ? 'العودة إلى المتجر لطلب جديد' : 'Return to Storefront'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
