import React, { useState } from 'react';
import {
  X,
  Plus,
  Minus,
  Trash2,
  Banknote,
  CreditCard,
  Smartphone,
  Phone,
  CheckCircle2,
  Loader2,
  ShoppingBag,
  UserCheck,
  AlertCircle,
} from 'lucide-react';
import type { CustomerProfile, OrderItem, PaymentMethod } from '../types';

interface CartCheckoutDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: OrderItem[];
  onUpdateQtyById: (productId: string, delta: number) => void;
  customerProfile: CustomerProfile | null;
  onLoginCustomer: (identifier: string) => Promise<CustomerProfile>;
  onConfirmOrder: (params: {
    customer: CustomerProfile;
    paymentMethod: PaymentMethod;
    notes: string;
  }) => Promise<void>;
  language: 'en' | 'ar';
}

export const CartCheckoutDrawer: React.FC<CartCheckoutDrawerProps> = ({
  isOpen,
  onClose,
  items,
  onUpdateQtyById,
  customerProfile,
  onLoginCustomer,
  onConfirmOrder,
  language,
}) => {
  const isAr = language === 'ar';
  const [identifierInput, setIdentifierInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const subtotal = items.reduce((sum, it) => sum + it.total, 0);

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;
    setErrorMsg(null);
    setIsSubmitting(true);

    try {
      let activeCustomer = customerProfile;
      if (!activeCustomer) {
        if (!identifierInput.trim()) {
          setErrorMsg(
            isAr
              ? 'يرجى إدخال رقم الجوال أو رقم العميل لإتمام الطلب'
              : 'Please enter your mobile number or Customer ID to continue'
          );
          setIsSubmitting(false);
          return;
        }
        activeCustomer = await onLoginCustomer(identifierInput.trim());
      }

      await onConfirmOrder({
        customer: activeCustomer,
        paymentMethod,
        notes: notes.trim(),
      });

      setIdentifierInput('');
      setNotes('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || (isAr ? 'حدث خطأ أثناء تأكيد الطلب' : 'Failed to place order'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl border-s border-slate-200">
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-emerald-400" />
            <h3 className="font-extrabold text-base">
              {isAr ? 'سلة التسوق وإتمام الطلب' : 'Shopping Cart & Checkout'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Items & Checkout Form */}
        <form onSubmit={handleCheckoutSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
            {items.length === 0 ? (
              <div className="py-16 text-center space-y-2 text-slate-400">
                <ShoppingBag className="w-10 h-10 mx-auto text-slate-300" />
                <p className="font-bold text-slate-700 text-sm">
                  {isAr ? 'سلتك فارغة حالياً' : 'Your cart is empty'}
                </p>
                <p className="text-xs">
                  {isAr
                    ? 'أضف منتجات من المتجر لبدء الطلب'
                    : 'Add products from the store to place an order'}
                </p>
              </div>
            ) : (
              <>
                {/* Item List */}
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                  {items.map((it) => (
                    <div key={it.productId} className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                          {isAr ? it.arabicName || it.name : it.name}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          {it.price.toFixed(3)} OMR × {it.quantity}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50">
                          <button
                            type="button"
                            onClick={() => onUpdateQtyById(it.productId, -1)}
                            className="p-1.5 text-slate-600 hover:text-rose-600 cursor-pointer"
                          >
                            {it.quantity === 1 ? (
                              <Trash2 className="w-3.5 h-3.5" />
                            ) : (
                              <Minus className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <span className="px-2 text-xs font-extrabold font-mono tabular-nums">
                            {it.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateQtyById(it.productId, 1)}
                            className="p-1.5 text-slate-600 hover:text-emerald-700 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="w-16 text-end font-extrabold text-xs text-slate-900 font-mono tabular-nums">
                          {it.total.toFixed(3)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Customer Authentication Block */}
                {customerProfile ? (
                  <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-700 text-white flex items-center justify-center shrink-0">
                        <UserCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-extrabold text-emerald-950">
                          {customerProfile.name ||
                            (isAr ? 'عميل مسجل' : 'Signed-in Customer')}{' '}
                          <span className="font-mono text-emerald-700">
                            (#{customerProfile.customerCode})
                          </span>
                        </div>
                        <div className="text-[11px] text-emerald-800 font-mono">
                          {customerProfile.phone || `#${customerProfile.customerCode}`}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-800 bg-white px-2 py-1 rounded-lg border border-emerald-200">
                      {isAr ? 'طلب فوري' : 'Ready'}
                    </span>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                    <label className="block text-xs font-extrabold text-slate-800">
                      {isAr
                        ? 'رقم الجوال (أو رقم العميل للعودة) *'
                        : 'Mobile Number (or Customer ID) *'}
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 absolute start-3 top-3 text-slate-400 pointer-events-none" />
                      <input
                        type="tel"
                        required
                        value={identifierInput}
                        onChange={(e) => setIdentifierInput(e.target.value)}
                        placeholder={isAr ? 'مثال: 9xxxxxxx أو 001' : 'e.g. 9xxxxxxx or 001'}
                        className="w-full ps-9 pe-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono font-semibold focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {isAr
                        ? 'سيتم إنشاء رقم عميل خاص بك تلقائياً ولن يُطلب منك الرقم في الطلبات القادمة.'
                        : 'A dedicated Customer ID is created on first order so future orders skip login.'}
                    </p>
                  </div>
                )}

                {/* Payment Method */}
                <div className="space-y-2">
                  <label className="block text-xs font-extrabold text-slate-800">
                    {isAr ? 'طريقة الدفع' : 'Payment Method'}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        id: 'cash' as PaymentMethod,
                        labelEn: 'Cash',
                        labelAr: 'كاش',
                        icon: Banknote,
                      },
                      {
                        id: 'card' as PaymentMethod,
                        labelEn: 'Card',
                        labelAr: 'بطاقة',
                        icon: CreditCard,
                      },
                      {
                        id: 'online' as PaymentMethod,
                        labelEn: 'Transfer',
                        labelAr: 'تحويل',
                        icon: Smartphone,
                      },
                    ].map((pm) => {
                      const Icon = pm.icon;
                      const active = paymentMethod === pm.id;
                      return (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => setPaymentMethod(pm.id)}
                          className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition cursor-pointer ${
                            active
                              ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-700'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>{isAr ? pm.labelAr : pm.labelEn}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional Note */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700">
                    {isAr ? 'ملاحظات إضافية (اختياري)' : 'Order Notes (Optional)'}
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      isAr ? 'أي ملاحظات أو أصناف إضافية...' : 'Any extra instructions or items...'
                    }
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30"
                  />
                </div>

                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Drawer Footer */}
          {items.length > 0 && (
            <div className="p-4 sm:p-5 border-t border-slate-200 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">
                  {isAr ? 'المبلغ الإجمالي:' : 'Order Total:'}
                </span>
                <span className="text-xl font-extrabold text-emerald-800 font-mono tabular-nums">
                  {subtotal.toFixed(3)} OMR
                </span>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>{isAr ? 'تأكيد الطلب الآن' : 'Confirm Order Now'}</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
