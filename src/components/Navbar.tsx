import React from 'react';
import { Store, User, ShoppingBag, ShieldCheck, LogOut } from 'lucide-react';
import type { CustomerProfile } from '../types';

interface NavbarProps {
  currentRoute: 'shop' | 'profile' | 'admin';
  onNavigate: (route: 'shop' | 'profile' | 'admin') => void;
  language: 'en' | 'ar';
  onLanguageChange: (lang: 'en' | 'ar') => void;
  customerProfile: CustomerProfile | null;
  cartCount: number;
  onOpenCart: () => void;
  isAdminLoggedIn: boolean;
  onAdminLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRoute,
  onNavigate,
  language,
  onLanguageChange,
  customerProfile,
  cartCount,
  onOpenCart,
  isAdminLoggedIn,
  onAdminLogout,
}) => {
  const isAr = language === 'ar';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/90 pt-[env(safe-area-inset-top,0px)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-15 sm:h-16 gap-3">
          {/* Zone 1: Brand Identity */}
          <button
            type="button"
            onClick={() => onNavigate('shop')}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer text-start"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-700 flex items-center justify-center text-white shadow-xs shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight truncate">
                  {isAr ? 'مكارم الخير الحديثة' : 'Makarem Al-Khair'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-['Cairo',sans-serif] truncate">
                {isAr ? 'متجر البقالة والمستلزمات اليومية' : 'Modern Grocery & Essentials'}
              </p>
            </div>
          </button>

          {/* Zone 2 & 3: Navigation Links & Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Shop Link */}
            <button
              type="button"
              onClick={() => onNavigate('shop')}
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                currentRoute === 'shop'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>{isAr ? 'المتجر' : 'Shop'}</span>
            </button>

            {/* Language Switcher */}
            <button
              type="button"
              onClick={() => onLanguageChange(isAr ? 'en' : 'ar')}
              className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 transition cursor-pointer"
            >
              {isAr ? 'EN' : 'عربي'}
            </button>

            {/* Customer /profile Route Button */}
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-bold transition cursor-pointer ${
                currentRoute === 'profile'
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/80 text-emerald-900'
              }`}
            >
              <User className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[110px] sm:max-w-none font-mono">
                {customerProfile
                  ? `#${customerProfile.customerCode}`
                  : isAr
                  ? 'حسابي'
                  : 'Profile'}
              </span>
            </button>

            {/* Cart Button */}
            {currentRoute !== 'admin' && (
              <button
                type="button"
                onClick={onOpenCart}
                className="relative inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <ShoppingBag className="w-4 h-4" />
                <span className="hidden xs:inline">{isAr ? 'السلة' : 'Cart'}</span>
                {cartCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md bg-white text-emerald-800 font-mono text-[11px] font-extrabold tabular-nums">
                    {cartCount}
                  </span>
                )}
              </button>
            )}

            {/* Admin Controls when signed in */}
            {isAdminLoggedIn && (
              <div className="flex items-center gap-1 pl-1">
                <button
                  type="button"
                  onClick={() => onNavigate(currentRoute === 'admin' ? 'shop' : 'admin')}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-900 text-white transition flex items-center gap-1 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">
                    {currentRoute === 'admin'
                      ? isAr
                        ? 'المتجر'
                        : 'Store'
                      : isAr
                      ? 'الإدارة'
                      : 'Admin'}
                  </span>
                </button>
                {currentRoute === 'admin' && (
                  <button
                    type="button"
                    onClick={onAdminLogout}
                    title={isAr ? 'تسجيل خروج الإدارة' : 'Logout Admin'}
                    className="p-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
