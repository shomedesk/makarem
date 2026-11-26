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
  Flame,
  Tag,
  Cookie,
  CupSoda,
  Milk,
  Droplets,
  IceCream,
  ShoppingBasket,
  Baby,
  Sparkles,
  LayoutGrid,
} from 'lucide-react';
import type { InventoryItem, OrderItem, StoreOffer } from '../types';
import { CATEGORY_ARABIC_MAP } from '../data/preTranslatedArabic';

interface ShopStorefrontProps {
  catalog: InventoryItem[];
  isLoadingCatalog: boolean;
  selectedItems: OrderItem[];
  onUpdateQuantity: (item: InventoryItem, delta: number) => void;
  onOpenCart: () => void;
  offers?: StoreOffer[];
  language: 'en' | 'ar';
}

function getCategoryIcon(catName: string) {
  const lower = catName.trim().toLowerCase();
  if (lower === 'all') return LayoutGrid;
  if (lower.includes('snack') || lower.includes('chip')) return Cookie;
  if (lower.includes('drink') || lower.includes('juice') || lower.includes('soda')) return CupSoda;
  if (lower.includes('milk') || lower.includes('dairy')) return Milk;
  if (lower.includes('water')) return Droplets;
  if (lower.includes('ice')) return IceCream;
  if (lower.includes('baby')) return Baby;
  if (lower.includes('cosmetic')) return Sparkles;
  if (lower.includes('grocery')) return ShoppingBasket;
  return Package;
}

export const ShopStorefront: React.FC<ShopStorefrontProps> = ({
  catalog,
  isLoadingCatalog,
  selectedItems,
  onUpdateQuantity,
  onOpenCart,
  offers = [],
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

  const catalogById = useMemo(() => {
    const map: Record<string, InventoryItem> = {};
    for (const item of catalog) {
      map[item.id] = item;
    }
    return map;
  }, [catalog]);

  const activeOffers = useMemo(
    () => offers.filter((o) => o && o.active),
    [offers]
  );

  // Map productId -> lowest active offer (to badge items in grid & show original vs deal price)
  const offerByProductId = useMemo(() => {
    const map: Record<string, StoreOffer> = {};
    for (const o of activeOffers) {
      if (o.productId && !map[o.productId]) {
        map[o.productId] = o;
      }
    }
    return map;
  }, [activeOffers]);

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

  const getEffectiveItem = (item: InventoryItem): InventoryItem => {
    const linkedOffer = offerByProductId[item.id];
    if (
      linkedOffer &&
      typeof linkedOffer.offerPrice === 'number' &&
      linkedOffer.offerPrice > 0
    ) {
      return { ...item, price: linkedOffer.offerPrice };
    }
    return item;
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Direct Search & Quick-Commerce Category Rail */}
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
                : 'Search groceries, snacks, drinks, milk, barcode...'
            }
            className="w-full ps-10 pe-10 py-2.5 text-sm bg-white border border-slate-200 rounded-2xl shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 transition"
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

        {/* Quick-Commerce Category Strip (Snacks -> Heavy Snacks -> Chips -> Drink -> Milk & Dairy -> ...) */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('ALL');
                setVisibleCount(48);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold shrink-0 whitespace-nowrap transition cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>{isAr ? `الكل (${catalog.length})` : `All (${catalog.length})`}</span>
            </button>

            {categories.map((cat) => {
              const Icon = getCategoryIcon(cat.key);
              const isSelected = selectedCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat.key);
                    setVisibleCount(48);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 whitespace-nowrap transition cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-700 text-white shadow-2xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-emerald-200' : 'text-emerald-700'}`} />
                  <span>{isAr ? cat.labelAr : cat.labelEn}</span>
                  <span className={`text-[10px] font-mono ${isSelected ? 'text-emerald-200' : 'text-slate-400'}`}>
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* TODAY'S OFFERS STRIP (Blinkit / Flipkart Minutes / BigBasket Deal Strip) */}
      {activeOffers.length > 0 && !searchQuery.trim() && selectedCategory === 'ALL' && (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-2xs">
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-black text-sm sm:text-base text-slate-900 leading-tight">
                  {isAr ? 'عروض اليوم الخاصة' : "Today's Hot Deals"}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {isAr ? 'أضف العرض مباشرة بضغطة واحدة' : 'Tap to add featured deals or jump to offer'}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
              {activeOffers.length} {isAr ? 'عروض نشطة' : 'Deals'}
            </span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1.5 snap-x scrollbar-none">
            {activeOffers.map((offer) => {
              const linkedProd = offer.productId ? catalogById[offer.productId] : undefined;
              const effectiveLinked = linkedProd ? getEffectiveItem(linkedProd) : undefined;
              const linkedQty = linkedProd ? qtyMap[linkedProd.id] || 0 : 0;
              const hasOfferPrice =
                typeof offer.offerPrice === 'number' && offer.offerPrice > 0;

              const accentStyles =
                offer.accentColor === 'rose'
                  ? 'from-rose-600 to-rose-700 border-rose-500 text-white'
                  : offer.accentColor === 'amber'
                  ? 'from-amber-400 to-amber-500 border-amber-400 text-slate-950'
                  : offer.accentColor === 'slate'
                  ? 'from-slate-800 to-slate-950 border-slate-700 text-white'
                  : 'from-emerald-700 to-emerald-800 border-emerald-600 text-white';

              const isLightText = offer.accentColor !== 'amber';

              return (
                <div
                  key={offer.id}
                  onClick={() => {
                    if (!linkedProd && offer.categoryFilter) {
                      setSelectedCategory(offer.categoryFilter);
                      setVisibleCount(48);
                    }
                  }}
                  className={`snap-start shrink-0 w-72 sm:w-80 rounded-2xl bg-gradient-to-br border p-3.5 shadow-sm flex items-center justify-between gap-3 ${accentStyles} ${
                    !linkedProd && offer.categoryFilter ? 'cursor-pointer hover:brightness-105' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                        isLightText
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-950 text-amber-300'
                      }`}
                    >
                      <Tag className="w-3 h-3" />
                      <span>{offer.badgeText || (isAr ? 'عرض' : 'DEAL')}</span>
                    </span>

                    <div className="font-black text-sm leading-snug line-clamp-2">
                      {isAr ? offer.titleAr || offer.titleEn : offer.titleEn || offer.titleAr}
                    </div>

                    {(offer.subtitleAr || offer.subtitleEn) && (
                      <div
                        className={`text-[11px] line-clamp-1 ${
                          isLightText ? 'text-white/85' : 'text-slate-900/80 font-semibold'
                        }`}
                      >
                        {isAr
                          ? offer.subtitleAr || offer.subtitleEn
                          : offer.subtitleEn || offer.subtitleAr}
                      </div>
                    )}

                    {effectiveLinked && (
                      <div className="flex items-baseline gap-2 pt-0.5">
                        <span className="font-mono font-black text-sm">
                          {effectiveLinked.price.toFixed(3)} OMR
                        </span>
                        {linkedProd && hasOfferPrice && linkedProd.price > effectiveLinked.price && (
                          <span
                            className={`font-mono text-[11px] line-through ${
                              isLightText ? 'text-white/65' : 'text-slate-900/60'
                            }`}
                          >
                            {linkedProd.price.toFixed(3)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right action / thumbnail */}
                  <div className="shrink-0 flex flex-col items-center gap-2">
                    {linkedProd?.imageUrl && (
                      <div className="w-14 h-14 rounded-xl bg-white p-1.5 flex items-center justify-center shadow-2xs">
                        <img
                          src={linkedProd.imageUrl}
                          alt={linkedProd.name}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}

                    {effectiveLinked ? (
                      linkedQty === 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateQuantity(effectiveLinked, 1);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black shadow-2xs transition cursor-pointer ${
                            isLightText
                              ? 'bg-white text-slate-900 hover:bg-slate-100'
                              : 'bg-slate-950 text-white hover:bg-black'
                          }`}
                        >
                          + {isAr ? 'أضف' : 'ADD'}
                        </button>
                      ) : (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 bg-white text-slate-900 rounded-xl p-1 shadow-2xs"
                        >
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(effectiveLinked, -1)}
                            className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-rose-50 flex items-center justify-center cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="font-mono font-black text-xs px-1">{linkedQty}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(effectiveLinked, 1)}
                            className="w-6 h-6 rounded-lg bg-emerald-700 text-white flex items-center justify-center cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      )
                    ) : offer.categoryFilter ? (
                      <span
                        className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black ${
                          isLightText ? 'bg-white/20 text-white' : 'bg-slate-950 text-white'
                        }`}
                      >
                        {isAr ? 'تصفح القسم' : 'Shop Now'}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Category Header */}
      {selectedCategory !== 'ALL' && (
        <div className="flex items-center justify-between bg-white px-3.5 py-2 rounded-xl border border-slate-200 text-xs">
          <span className="font-extrabold text-slate-800">
            {isAr
              ? `القسم: ${CATEGORY_ARABIC_MAP[selectedCategory] || selectedCategory}`
              : `Category: ${selectedCategory}`}
            {' · '}
            <span className="text-emerald-700 font-mono">{filteredCatalog.length}</span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className="font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            {isAr ? 'عرض كل الأقسام' : 'Show All'}
          </button>
        </div>
      )}

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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {displayedItems.map((item) => {
              const effectiveItem = getEffectiveItem(item);
              const linkedOffer = offerByProductId[item.id];
              const hasDealPrice =
                linkedOffer &&
                typeof linkedOffer.offerPrice === 'number' &&
                linkedOffer.offerPrice > 0 &&
                linkedOffer.offerPrice < item.price;

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
                  <div className="aspect-[4/3] sm:aspect-square bg-slate-50 relative flex items-center justify-center p-2.5 border-b border-slate-100">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={displayName}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Package className="w-9 h-9 text-slate-300 stroke-1" />
                    )}

                    {linkedOffer && !isOutOfStock && (
                      <span className="absolute top-2 start-2 px-2 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-black shadow-2xs">
                        {linkedOffer.badgeText || (isAr ? 'عرض' : 'DEAL')}
                      </span>
                    )}

                    {isOutOfStock && (
                      <span className="absolute top-2 start-2 px-2 py-0.5 rounded-md bg-slate-900/85 text-white text-[10px] font-bold">
                        {isAr ? 'نفذت الكمية' : 'Out of Stock'}
                      </span>
                    )}
                  </div>

                  <div className="p-2.5 sm:p-3.5 flex-1 flex flex-col justify-between gap-2">
                    <div className="space-y-0.5">
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

                    {/* Quick-commerce compact Price + Add / Stepper row */}
                    <div className="space-y-2 pt-0.5">
                      <div className="flex items-baseline justify-between gap-1">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="font-black text-sm sm:text-base text-emerald-800 font-mono tabular-nums">
                            {effectiveItem.price.toFixed(3)}
                            <span className="text-[10px] font-bold text-slate-500 ms-1">OMR</span>
                          </span>
                          {hasDealPrice && (
                            <span className="text-[10px] font-mono text-slate-400 line-through">
                              {item.price.toFixed(3)}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium shrink-0">
                          / {item.unit || 'pcs'}
                        </span>
                      </div>

                      {qty === 0 ? (
                        <button
                          type="button"
                          disabled={isOutOfStock}
                          onClick={() => onUpdateQuantity(effectiveItem, 1)}
                          className="w-full py-2 rounded-xl bg-emerald-50 hover:bg-emerald-700 border border-emerald-600 text-emerald-800 hover:text-white text-xs font-black transition flex items-center justify-center gap-1 cursor-pointer disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{isAr ? 'أضف' : 'ADD'}</span>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between rounded-xl bg-emerald-700 text-white p-1 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(effectiveItem, -1)}
                            className="w-8 h-7 rounded-lg bg-emerald-800/70 hover:bg-rose-600 text-white flex items-center justify-center transition cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>

                          <span className="font-black text-sm font-mono tabular-nums px-2">
                            {qty}
                          </span>

                          <button
                            type="button"
                            disabled={maxReached}
                            onClick={() => onUpdateQuantity(effectiveItem, 1)}
                            className="w-8 h-7 rounded-lg bg-emerald-800/70 hover:bg-emerald-900 text-white flex items-center justify-center transition cursor-pointer disabled:opacity-40"
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
