import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Minus,
  ShoppingBag,
  Package,
  X,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import type { InventoryItem, OrderItem } from '../types';
import { CATEGORY_ARABIC_MAP } from '../data/preTranslatedArabic';

interface ShopStorefrontProps {
  catalog: InventoryItem[];
  isLoadingCatalog: boolean;
  selectedItems: OrderItem[];
  onUpdateQuantity: (item: InventoryItem, delta: number) => void;
  onOpenCart: () => void;
  language: 'en' | 'ar';
}

export const ShopStorefront: React.FC<ShopStorefrontProps> = ({
  catalog,
  isLoadingCatalog,
  selectedItems,
  onUpdateQuantity,
  onOpenCart,
  language,
}) => {
  const isAr = language === 'ar';
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [visibleCount, setVisibleCount] = useState<number>(48);

  const qtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of selectedItems) {
      map[item.productId] = item.quantity;
    }
    return map;
  }, [selectedItems]);

  const categories = useMemo(() => {
    const counts: Record<string, number> = {};
    const arNames: Record<string, string> = {};
    for (const item of catalog) {
      const cat =
        !item.category || item.category === 'No category'
          ? 'Uncategorized'
          : item.category;
      counts[cat] = (counts[cat] || 0) + 1;
      if (item.arabicCategory && !arNames[cat]) {
        arNames[cat] = item.arabicCategory;
      }
    }

    const getCategoryPriorityRank = (catName: string): number => {
      const lower = catName.trim().toLowerCase();
      if (lower === 'snacks') return 1;
      if (lower === 'heavy snacks') return 2;
      if (lower === 'chips') return 3;
      if (lower === 'drink' || lower === 'drinks') return 4;
      if (lower === 'milk & dairy items' || lower === 'milk & dairy' || lower === 'dairy') return 5;
      if (lower === 'water') return 6;
      if (lower === 'icecream' || lower === 'ice cream') return 7;
      if (lower === 'grocery') return 8;
      if (lower === 'other') return 98;
      if (lower === 'uncategorized') return 99;
      return 20;
    };

    // Sort: Snacks -> Heavy Snacks -> Chips -> Drinks -> Milk & Dairy -> rest by count -> Uncategorized last
    return Object.entries(counts)
      .sort((a, b) => {
        const rankA = getCategoryPriorityRank(a[0]);
        const rankB = getCategoryPriorityRank(b[0]);
        if (rankA !== rankB) return rankA - rankB;
        return b[1] - a[1];
      })
      .map(([name, count]) => ({
        key: name,
        labelEn: name,
        labelAr:
          name === 'Uncategorized'
            ? 'غير مصنف'
            : CATEGORY_ARABIC_MAP[name] || arNames[name] || name,
        count,
      }));
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((item) => {
      const normalizedCat =
        !item.category || item.category === 'No category'
          ? 'Uncategorized'
          : item.category;
      const matchesCat =
        selectedCategory === 'ALL' || normalizedCat === selectedCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.arabicName && item.arabicName.toLowerCase().includes(q)) ||
        (item.barcode && item.barcode.includes(q)) ||
        (item.productCode && item.productCode.toLowerCase().includes(q))
      );
    });
  }, [catalog, selectedCategory, searchQuery]);

  const displayedItems = useMemo(() => {
    if (searchQuery.trim() || selectedCategory !== 'ALL') {
      return filteredCatalog.slice(0, Math.max(visibleCount, 120));
    }
    return filteredCatalog.slice(0, visibleCount);
  }, [filteredCatalog, visibleCount, searchQuery, selectedCategory]);

  const totalItemsCount = selectedItems.reduce((acc, i) => acc + i.quantity, 0);
  const totalAmount = selectedItems.reduce((acc, i) => acc + i.total, 0);

  return (
    <div className="space-y-4 pb-24">
      {/* Direct Search & Category Filter Controls */}
      <section className="sticky top-[56px] sm:top-[64px] z-30 bg-slate-100/95 backdrop-blur-md py-2 space-y-2.5 -mx-3 px-3 sm:mx-0 sm:px-0">
        <div className="relative">
          <Search className="w-4 h-4 absolute start-3.5 top-3 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setVisibleCount(48);
            }}
            placeholder={
              isAr
                ? 'ابحث عن أي منتج (ماء، بيبسي، إندومي، شيبس، حليب...)'
                : 'Search products by name, brand, or barcode...'
            }
            className="w-full ps-10 pe-10 py-2.5 text-sm bg-white border border-slate-200 rounded-xl shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute end-3 top-2.5 p-0.5 rounded-md text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category Filter Tabs (including dedicated Uncategorized tab) */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('ALL');
                setVisibleCount(48);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 whitespace-nowrap transition cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isAr ? `الكل (${catalog.length})` : `All (${catalog.length})`}
            </button>

            {categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.key);
                  setVisibleCount(48);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 whitespace-nowrap transition cursor-pointer ${
                  selectedCategory === cat.key
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {isAr ? cat.labelAr : cat.labelEn} ({cat.count})
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Catalog Grid */}
      {isLoadingCatalog && catalog.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl border border-slate-200 p-3 space-y-3 animate-pulse"
            >
              <div className="aspect-square rounded-xl bg-slate-200" />
              <div className="h-4 bg-slate-200 rounded w-3/4" />
              <div className="h-4 bg-slate-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-2">
          <Package className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-bold text-slate-800 text-sm">
            {isAr ? 'لم يتم العثور على منتجات مطابقة' : 'No matching products found'}
          </h3>
          <p className="text-xs text-slate-500">
            {isAr
              ? 'جرب البحث بكلمة أخرى أو اختر قسم آخر'
              : 'Try another search keyword or switch category tab'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {displayedItems.map((item) => {
              const qty = qtyMap[item.id] || 0;
              const isOutOfStock = Boolean(item.stockControl) && item.stock <= 0;
              const maxReached = Boolean(item.stockControl) && qty >= item.stock;
              const displayName = isAr ? item.arabicName || item.name : item.name;
              const normalizedCat =
                !item.category || item.category === 'No category'
                  ? 'Uncategorized'
                  : item.category;
              const displayCat = isAr
                ? normalizedCat === 'Uncategorized'
                  ? 'غير مصنف'
                  : item.arabicCategory || CATEGORY_ARABIC_MAP[normalizedCat] || normalizedCat
                : normalizedCat;

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-2xl border transition flex flex-col overflow-hidden ${
                    qty > 0
                      ? 'border-emerald-600 ring-1 ring-emerald-600/20 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300'
                  } ${isOutOfStock ? 'opacity-65' : ''}`}
                >
                  <div className="aspect-square bg-slate-50 relative flex items-center justify-center p-3 border-b border-slate-100">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={displayName}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Package className="w-10 h-10 text-slate-300 stroke-1" />
                    )}

                    {isOutOfStock && (
                      <span className="absolute top-2 start-2 px-2 py-0.5 rounded-md bg-slate-900/85 text-white text-[10px] font-bold">
                        {isAr ? 'نفذت الكمية' : 'Out of Stock'}
                      </span>
                    )}
                  </div>

                  <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-slate-400 truncate">
                        {displayCat}
                      </div>
                      <h3
                        className="font-bold text-xs sm:text-sm text-slate-900 line-clamp-2 leading-snug min-h-[2.4em]"
                        title={displayName}
                      >
                        {displayName}
                      </h3>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-extrabold text-sm sm:text-base text-emerald-800 font-mono tabular-nums">
                          {item.price.toFixed(3)}{' '}
                          <span className="text-[10px] font-bold text-slate-500">OMR</span>
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          / {item.unit || 'pcs'}
                        </span>
                      </div>

                      {qty === 0 ? (
                        <button
                          type="button"
                          disabled={isOutOfStock}
                          onClick={() => onUpdateQuantity(item, 1)}
                          className="w-full py-2 rounded-xl bg-slate-900 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isAr ? 'أضف للسلة' : 'Add to Cart'}</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 p-1">
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(item, -1)}
                            className="w-8 h-7 rounded-lg bg-white hover:bg-rose-50 text-slate-800 hover:text-rose-700 flex items-center justify-center shadow-2xs transition cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <span className="font-extrabold text-sm text-emerald-900 font-mono tabular-nums px-2">
                            {qty}
                          </span>

                          <button
                            type="button"
                            disabled={maxReached}
                            onClick={() => onUpdateQuantity(item, 1)}
                            className="w-8 h-7 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center shadow-2xs transition cursor-pointer disabled:opacity-40"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {displayedItems.length < filteredCatalog.length && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + 48)}
                className="px-6 py-2.5 rounded-xl bg-white border border-slate-300 hover:border-emerald-600 text-slate-800 font-bold text-xs shadow-2xs transition cursor-pointer"
              >
                {isAr
                  ? `عرض المزيد (${filteredCatalog.length - displayedItems.length} متبقي)`
                  : `Load More Products (${filteredCatalog.length - displayedItems.length} more)`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Sticky Bottom Cart Checkout Bar */}
      {totalItemsCount > 0 && (
        <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:end-6 sm:w-96 z-40">
          <button
            type="button"
            onClick={onOpenCart}
            className="w-full p-3.5 sm:p-4 rounded-2xl bg-slate-900 hover:bg-black text-white shadow-xl flex items-center justify-between gap-3 transition cursor-pointer ring-1 ring-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center font-extrabold text-sm font-mono tabular-nums">
                {totalItemsCount}
              </div>
              <div className="text-start">
                <div className="text-xs text-slate-300 font-medium">
                  {isAr ? 'إجمالي السلة' : 'Cart Total'}
                </div>
                <div className="text-base font-extrabold font-mono tabular-nums text-emerald-400">
                  {totalAmount.toFixed(3)} OMR
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 font-bold text-xs">
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{isAr ? 'إتمام الطلب' : 'Checkout'}</span>
              {isAr ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
            </div>
          </button>
        </div>
      )}
    </div>
  );
};
