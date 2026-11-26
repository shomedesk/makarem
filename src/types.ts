export type OrderType = 'ecommerce' | 'curbside' | 'neighborhood_delivery';

export type PaymentMethod = 'cash' | 'card' | 'online';

export type PaymentStatus = 'pending' | 'received';

export type OrderStatus = 'pending' | 'processing' | 'ready' | 'completed' | 'cancelled';

export type SalesPlaySyncStatus = 'pending' | 'synced' | 'failed' | 'skipped';

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  arabicName: string;
  unit: string;
  price: number;
  quantity: number;
  total: number;
  salesplayProductId?: string;
  barcode?: string;
}

export interface LocationCoordinates {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  mapUrl?: string;
  addressHint?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  orderType: OrderType;
  customerId?: string;
  customerCode?: string;
  customerName: string;
  customerPhone: string;
  vehicleNumber?: string;
  parkingSpot?: string;
  houseNumber?: string;
  locationCoordinates?: LocationCoordinates;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  items: OrderItem[];
  customNotes?: string;
  subtotal: number;
  tax: number;
  totalAmount: number;
  salesplaySyncStatus: SalesPlaySyncStatus;
  salesplayReceiptId?: string;
  salesplaySyncMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  productCode?: string;
  name: string;
  arabicName: string;
  category: string;
  arabicCategory?: string;
  price: number;
  unit: string;
  stock: number;
  stockControl?: boolean;
  barcode?: string;
  salesplayItemId?: string;
  imageUrl?: string;
  hasArabicTranslation?: boolean;
}

export interface CustomerProfile {
  id: string;
  customerCode: string; // e.g. "001", "002", ...
  phone: string;
  phoneNormalized?: string;
  name?: string;
  salesplayCustomerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCustomerRecord {
  id: string; // Firestore doc ID if present, else `sp_${salesplayId}`
  firestoreId?: string;
  salesplayId?: string;
  customerCode: string;
  phone: string;
  phoneNormalized: string;
  name: string;
  creditLimit: number | null;
  totalSpent: number;
  totalVisits: number;
  source: 'both' | 'salesplay' | 'firestore';
  createdAt?: string;
  updatedAt?: string;
}

export interface SalesPlayCustomerReceipt {
  receiptNumber: string;
  receiptType: string;
  dateTime: string;
  totalMoney: number;
  totalDiscount: number;
  cashierName: string;
  note: string;
  creditAmount: number;
  paidAmount?: number;
  hasAdvance?: boolean;
  payments: Array<{
    type: string;
    amount: number;
    paidAt: string;
    isAdvance?: boolean;
  }>;
  items: Array<{
    productId: string;
    productCode: string;
    name: string;
    category: string;
    quantity: number;
    price: number;
    total: number;
  }>;
}

export type BillSettlementStatus = 'due' | 'partial' | 'settled' | 'paid' | 'refund';

export interface CreditSettlementRecord {
  id: string;
  customerCode: string;
  receiptNumber: string;
  receiptDateTime: string;
  billTotal: number;
  originalCreditAmount: number;
  settledAmount: number;
  settlementMethod: 'cash' | 'card' | 'online';
  note?: string;
  settledByEmail?: string;
  settledAt: string;
  createdAt: string;
}

export interface ArchivedBillEntry {
  receiptNumber: string;
  receiptType: string;
  dateTime: string;
  totalMoney: number;
  creditAmount: number;
  paidAmount: number;
  billStatus: 'paid' | 'settled' | 'refund';
  paymentSummary: string;
  itemCount: number;
  archivedAt: string;
}

export interface CustomerLedgerDoc {
  customerCode: string;
  lastFinalizedAt: string;
  totalArchivedBills: number;
  totalArchivedPaidAmount: number;
  archivedBills: ArchivedBillEntry[];
  updatedAt: string;
  createdAt: string;
}

export interface EnrichedCustomerReceipt extends SalesPlayCustomerReceipt {
  billStatus: BillSettlementStatus;
  originalCreditAmount: number;
  posPaidAmount: number;
  adminSettledAmount: number;
  remainingDue: number;
  settlements: CreditSettlementRecord[];
  isArchived?: boolean;
}

export interface SalesPlayCustomerProfileResponse {
  success: boolean;
  matched: boolean;
  deltaMode?: boolean;
  latestReceiptAt?: string;
  totalIndexedBills?: number;
  skippedArchivedCount?: number;
  customer: {
    id: string;
    customerCode: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    region: string;
    countryCode: string;
    firstVisit: string;
    lastVisit: string;
    totalVisits: number;
    totalSpent: number;
    totalPoints: number;
    membershipStatus: boolean;
  } | null;
  creditSummary: {
    hasCreditLimit: boolean;
    creditLimit: number | null;
    creditUsed: number;
    remainingCredit: number | null;
  } | null;
  receipts: SalesPlayCustomerReceipt[];
}

export interface SalesPlayShop {
  id: string;
  shop_name: string;
  terminal_list: Array<{ pos_name: string; pos_key: string }>;
  is_enable: string;
}

export interface SalesPlaySyncLog {
  id: string;
  orderId?: string;
  orderNumber?: string;
  timestamp: string;
  action: string;
  status: 'success' | 'error' | 'warning';
  details: string;
}

export interface AdminPeriodMetrics {
  salesTotal: number;
  billCount: number;
  cashTotal: number;
  cardTotal: number;
  creditIssuedTotal: number;
  refundTotal: number;
  avgBillValue: number;
  topProducts: Array<{
    name: string;
    category: string;
    quantity: number;
    revenue: number;
  }>;
  topCategories: Array<{
    category: string;
    revenue: number;
    billCount: number;
  }>;
}

export interface AdminCustomerCreditStat {
  customerCode: string;
  customerId: string;
  posGrossCredit: number;
  dueBillsCount: number;
  billsCount90d: number;
  spent90d: number;
  lastPurchaseDate: string;
}

export interface AdminInsightsResponse {
  success: boolean;
  generatedAt: string;
  omanTodayDate: string;
  periods: {
    today: AdminPeriodMetrics;
    d7: AdminPeriodMetrics;
    d30: AdminPeriodMetrics;
    d90: AdminPeriodMetrics;
  };
  customerStats: Record<string, AdminCustomerCreditStat>;
}

export interface StoreOffer {
  id: string;
  titleEn: string;
  titleAr: string;
  subtitleEn?: string;
  subtitleAr?: string;
  badgeText: string;
  accentColor?: 'emerald' | 'amber' | 'rose' | 'slate';
  productId?: string;
  categoryFilter?: string;
  offerPrice?: number;
  active: boolean;
  createdAt: string;
}
