import React from 'react';

interface CreditPieChartProps {
  creditLimit: number | null;
  creditUsed: number;
  remainingCredit: number | null;
  hasCreditLimit: boolean;
  dueBillsCount?: number;
  settledAmount?: number;
  language: 'en' | 'ar';
}

export const CreditPieChart: React.FC<CreditPieChartProps> = ({
  creditLimit,
  creditUsed,
  remainingCredit,
  hasCreditLimit,
  dueBillsCount = 0,
  settledAmount = 0,
  language,
}) => {
  const isAr = language === 'ar';

  const limitVal = creditLimit !== null && creditLimit > 0 ? creditLimit : 0;
  const dueVal = Math.max(0, creditUsed || 0);
  const remainVal =
    remainingCredit !== null && remainingCredit !== undefined
      ? Math.max(0, remainingCredit)
      : Math.max(0, limitVal - dueVal);

  const denominator = hasCreditLimit && limitVal > 0 ? Math.max(limitVal, dueVal) : dueVal || 1;
  const duePct = Math.min(100, Math.max(0, (dueVal / denominator) * 100));
  const remainPct = hasCreditLimit && limitVal > 0 ? Math.max(0, 100 - duePct) : dueVal === 0 ? 100 : 0;

  // SVG Donut Geometry
  const size = 180;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const dueDash = (duePct / 100) * circumference;
  const remainDash = circumference - dueDash;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
      <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
        {/* SVG Donut Pie Chart */}
        <div className="relative w-[180px] h-[180px] shrink-0 flex items-center justify-center">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
            {/* Base track (Remaining Credit / Clear - Emerald) */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={hasCreditLimit || dueVal === 0 ? '#10b981' : '#e2e8f0'}
              strokeWidth={strokeWidth}
            />
            {/* Used / Total Due slice (Amber / Rose if near or over limit) */}
            {duePct > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={duePct >= 85 ? '#dc2626' : '#f59e0b'}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dueDash} ${remainDash}`}
                strokeLinecap="butt"
              />
            )}
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
            <span className="text-[11px] font-bold text-slate-500">
              {hasCreditLimit
                ? isAr
                  ? 'المتبقي'
                  : 'Remaining'
                : isAr
                ? 'المستحق'
                : 'Total Due'}
            </span>
            <span className="text-lg font-black text-slate-900 font-mono tabular-nums leading-tight mt-0.5">
              {hasCreditLimit ? remainVal.toFixed(3) : dueVal.toFixed(3)}
            </span>
            <span className="text-[10px] font-bold text-slate-400">OMR</span>
          </div>
        </div>

        {/* Breakdown Legend & Tabular Stats */}
        <div className="flex-1 w-full space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                {isAr ? 'ملخص بطاقة الائتمان العائلية' : 'Family Credit Card Summary'}
              </h3>
              <p className="text-xs text-slate-500">
                {isAr
                  ? 'الحد الائتماني والمبلغ المستحق غير المسدد والرصيد المتاح'
                  : 'Credit limit, unpaid due balance, and remaining available credit'}
              </p>
            </div>

            {dueBillsCount > 0 ? (
              <span className="px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 text-xs font-extrabold">
                {isAr ? `${dueBillsCount} فاتورة مستحقة` : `${dueBillsCount} Due Bill${dueBillsCount > 1 ? 's' : ''}`}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-200 text-emerald-900 text-xs font-extrabold">
                {isAr ? 'لا توجد مستحقات معلقة' : 'All Clear · 0 Due'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-800 shrink-0" />
                <span>{isAr ? 'حد الائتمان' : 'Credit Limit'}</span>
              </div>
              <div className="text-base font-black text-slate-900 font-mono tabular-nums">
                {hasCreditLimit && creditLimit !== null
                  ? `${creditLimit.toFixed(3)} OMR`
                  : isAr
                  ? 'مفتوح'
                  : 'Open'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    dueVal === 0 ? 'bg-emerald-500' : duePct >= 85 ? 'bg-red-600' : 'bg-amber-500'
                  }`}
                />
                <span>{isAr ? 'إجمالي المستحق' : 'Total Due'}</span>
              </div>
              <div className="text-base font-black text-amber-950 font-mono tabular-nums">
                {dueVal.toFixed(3)} OMR
              </div>
              {settledAmount > 0 ? (
                <div className="text-[10px] font-bold text-emerald-700 font-mono tabular-nums">
                  {isAr ? `مسدد: ${settledAmount.toFixed(3)} OMR` : `Settled: ${settledAmount.toFixed(3)} OMR`}
                </div>
              ) : (
                hasCreditLimit &&
                limitVal > 0 && (
                  <div className="text-[10px] font-bold text-amber-700 font-mono tabular-nums">
                    {duePct.toFixed(1)}% {isAr ? 'مستخدم' : 'used'}
                  </div>
                )
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{isAr ? 'الرصيد المتبقي' : 'Remaining Credit'}</span>
              </div>
              <div className="text-base font-black text-emerald-800 font-mono tabular-nums">
                {hasCreditLimit ? `${remainVal.toFixed(3)} OMR` : '—'}
              </div>
              {hasCreditLimit && limitVal > 0 && (
                <div className="text-[10px] font-bold text-emerald-700 font-mono tabular-nums">
                  {remainPct.toFixed(1)}% {isAr ? 'متاح' : 'available'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
