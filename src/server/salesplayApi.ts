import crypto from 'crypto';
import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';
import { translateProductsWithGemini } from './geminiTranslate.ts';

const SALESPLAY_HOST = 'api.salesplaypos.com';
const SALESPLAY_BASE_PATH = '/v1.0';
const DEFAULT_TOKEN =
  process.env.SALESPLAY_API_TOKEN ||
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJsb2dpbl9uYW1lIjoibWFrYXJlbWJha2thbGFAZ21haWwuY29tIiwiZGF0ZSI6IkZyaWRheSAyNXRoIDIwMjZmIFNlcHRlbWJlciAyMDI2IDAxOjA1OjU1IEFNIn0.wmzb6XXPzLK_xsmyML7KA8U9_NNC9W0m26nlM29afsU';

export const SHOP_ID = 'VEpoaG9WaHlTZ0Nocko4ekcwVFpqZz09';

interface SyncLogEntry {
  id: string;
  timestamp: string;
  orderNumber?: string;
  action: string;
  status: 'success' | 'error' | 'warning';
  details: string;
}

const recentLogs: SyncLogEntry[] = [
  {
    id: 'log-init',
    timestamp: new Date().toISOString(),
    action: 'POS Store Connection Ready',
    status: 'success',
    details: 'Connected to Makarem Al-Khair Modern store catalog.',
  },
];

export function addSyncLog(entry: Omit<SyncLogEntry, 'id' | 'timestamp'>) {
  const newEntry: SyncLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  recentLogs.unshift(newEntry);
  if (recentLogs.length > 50) recentLogs.pop();
  return newEntry;
}

export function getSyncLogs() {
  return recentLogs;
}

/**
 * SalesPlay POS REST API expects parameters (limit, cursor, created_at_min, etc.)
 * as a JSON body even on GET requests. Node's native https.request supports GET + body.
 */
function salesplayRequestOnce(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  bodyObj?: Record<string, any> | null
): Promise<{ status: number; ok: boolean; data: any }> {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers: Record<string, string | number> = {
      Authorization: `Bearer ${DEFAULT_TOKEN}`,
      'Content-Type': 'application/json',
    };
    if (body) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(
      {
        hostname: SALESPLAY_HOST,
        path: `${SALESPLAY_BASE_PATH}${endpoint}`,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          const status = res.statusCode || 500;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            data: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(25000, () => {
      req.destroy(new Error(`SalesPlay request timeout on ${endpoint}`));
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function salesplayRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  bodyObj?: Record<string, any> | null
): Promise<{ status: number; ok: boolean; data: any }> {
  try {
    const first = await salesplayRequestOnce(endpoint, method, bodyObj);
    if (first.status >= 500) {
      await new Promise((r) => setTimeout(r, 400));
      return await salesplayRequestOnce(endpoint, method, bodyObj);
    }
    return first;
  } catch (err) {
    await new Promise((r) => setTimeout(r, 400));
    return await salesplayRequestOnce(endpoint, method, bodyObj);
  }
}

async function fetchAllPaginated<T>(
  endpoint: string,
  listKey: string,
  baseBody: Record<string, any> = {}
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined = undefined;
  let pages = 0;

  while (pages < 40) {
    const body: Record<string, any> = { limit: 100, ...baseBody };
    if (cursor) body.cursor = cursor;

    const res = await salesplayRequest(endpoint, 'GET', body);
    const items: T[] = res.data?.[listKey] || [];
    if (!Array.isArray(items) || items.length === 0) {
      break;
    }
    results.push(...items);

    const nextCursor = res.data?.cursor;
    if (!nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
    pages++;
  }

  return results;
}

async function parseBody(req: IncomingMessage): Promise<any> {
  if ((req as any).body && typeof (req as any).body === 'object') {
    return (req as any).body;
  }
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function normalizePhoneDigits(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  // Handle Oman country code +968 / 00968
  if (digits.startsWith('00968') && digits.length >= 13) return digits.slice(5);
  if (digits.startsWith('968') && digits.length >= 11) return digits.slice(3);
  return digits.replace(/^0+/, '') || digits;
}

function formatDateSql(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function normalizeCategory(rawCategory: unknown): string {
  const cat = String(rawCategory || '').trim();
  if (
    !cat ||
    cat.toLowerCase() === 'no category' ||
    cat.toLowerCase() === 'uncategorized'
  ) {
    return 'Uncategorized';
  }
  return cat;
}

// In-memory overrides, translation cache & smart delta product cache
const productImageOverrides: Record<string, string> = {};
const serverTranslationCache: Record<string, { arabicName: string; arabicCategory: string }> = {};

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes smart server cache
let cachedCatalog: {
  catalogVersion: string;
  fetchedAt: string;
  cachedAtMs: number;
  products: any[];
} | null = null;

function invalidateCatalogCache() {
  if (cachedCatalog) {
    cachedCatalog.cachedAtMs = 0;
  }
}

export function setProductImageOverride(productId: string, imageUrl: string) {
  productImageOverrides[productId] = imageUrl;
  invalidateCatalogCache();
}

export function getProductImageOverrides() {
  return productImageOverrides;
}

// --- Incremental Server-Side Customers & Receipts Store (scales cleanly to 10,000+ bills) ---
interface IndexedReceiptRecord {
  receiptNumber: string;
  receiptType: string;
  dateTime: string;
  customerId: string;
  customerCode: string;
  totalMoney: number;
  totalDiscount: number;
  cashierName: string;
  note: string;
  creditAmount: number;
  paidAmount: number;
  hasAdvance: boolean;
  payments: Array<{
    type: string;
    amount: number;
    paidAt: string;
    isAdvance: boolean;
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

const CUSTOMER_LIST_CACHE_TTL_MS = 10 * 1000;
let cachedCustomersList: { items: any[]; fetchedAtMs: number } | null = null;

async function getCustomersCached(forceRefresh = false): Promise<any[]> {
  const nowMs = Date.now();
  if (
    !forceRefresh &&
    cachedCustomersList &&
    nowMs - cachedCustomersList.fetchedAtMs < CUSTOMER_LIST_CACHE_TTL_MS
  ) {
    return cachedCustomersList.items;
  }
  const items = await fetchAllPaginated<any>('/customers', 'customers');
  cachedCustomersList = { items, fetchedAtMs: nowMs };
  return items;
}

const RECEIPT_INCREMENTAL_COOLDOWN_MS = 5 * 1000;
const RECEIPT_FULL_REBUILD_INTERVAL_MS = 10 * 60 * 1000;
const receiptIndex = {
  byNumber: new Map<string, IndexedReceiptRecord>(),
  bootstrappedAtMs: 0,
  lastIncrementalSyncMs: 0,
  latestDateTimeSql: '',
  windowStartDateSql: '',
  inFlight: null as Promise<void> | null,
};

function parseReceiptDateMs(dt: string): number | null {
  if (!dt) return null;
  const isoCandidate = dt.includes('T') ? dt : dt.replace(' ', 'T');
  const t = Date.parse(isoCandidate);
  if (!Number.isNaN(t)) return t;
  const tFallback = Date.parse(dt);
  return Number.isNaN(tFallback) ? null : tFallback;
}

function normalizeRawReceipt(r: any): IndexedReceiptRecord {
  const payments = Array.isArray(r.payments) ? r.payments : [];
  const creditAmount = payments
    .filter((p: any) => String(p.payment_type || '').trim().toLowerCase() === 'credit')
    .reduce((sum: number, p: any) => sum + Number(p.money_amount || 0), 0);
  const paidAmount = payments
    .filter((p: any) => String(p.payment_type || '').trim().toLowerCase() !== 'credit')
    .reduce((sum: number, p: any) => sum + Number(p.money_amount || 0), 0);
  const hasAdvance = payments.some((p: any) => Boolean(p.is_advance));
  const rCust = r.customer?.[0];

  return {
    receiptNumber: String(r.receipt_number || '').trim(),
    receiptType: r.receipt_type || 'SALE',
    dateTime: r.receipt_date_time || `${r.receipt_date} ${r.receipt_time}`,
    customerId: String(r.customer_id || rCust?.id || ''),
    customerCode: String(rCust?.customer_code || ''),
    totalMoney: Number(r.total_money || 0),
    totalDiscount: Number(r.total_discount || 0),
    cashierName: r.cashier_name || '',
    note: r.note || '',
    creditAmount: Number(creditAmount.toFixed(3)),
    paidAmount: Number(paidAmount.toFixed(3)),
    hasAdvance,
    payments: payments.map((p: any) => ({
      type: p.payment_type || 'Cash',
      amount: Number(p.money_amount || 0),
      paidAt: p.paid_at || '',
      isAdvance: Boolean(p.is_advance),
    })),
    items: (r.line_products || []).map((lp: any) => ({
      productId: lp.product_id,
      productCode: lp.product_code,
      name: lp.product_name,
      category: lp.category_name || '',
      quantity: Number(lp.quantity || 1),
      price: Number(lp.price || 0),
      total: Number(lp.total_money || 0),
    })),
  };
}

function ingestRawReceipts(rawList: any[]): Set<string> {
  const activeNumbers = new Set<string>();
  for (const r of rawList) {
    const recNo = String(r.receipt_number || '').trim();
    if (!recNo) continue;
    if (r.receipt_delete_status) {
      receiptIndex.byNumber.delete(recNo);
      continue;
    }
    const normalized = normalizeRawReceipt(r);
    receiptIndex.byNumber.set(recNo, normalized);
    activeNumbers.add(recNo);
    if (normalized.dateTime && normalized.dateTime > receiptIndex.latestDateTimeSql) {
      receiptIndex.latestDateTimeSql = normalized.dateTime;
    }
  }
  return activeNumbers;
}

async function ensureReceiptsSynced(
  forceRefresh = false,
  openBillsToCheck: string[] = [],
  forceFullRebuild = false
): Promise<void> {
  if (receiptIndex.inFlight) {
    return receiptIndex.inFlight;
  }

  const nowMs = Date.now();
  const needsBootstrap =
    receiptIndex.bootstrappedAtMs === 0 ||
    forceFullRebuild ||
    nowMs - receiptIndex.bootstrappedAtMs >= RECEIPT_FULL_REBUILD_INTERVAL_MS;
  const needsIncremental =
    forceRefresh || nowMs - receiptIndex.lastIncrementalSyncMs >= RECEIPT_INCREMENTAL_COOLDOWN_MS;

  if (!needsBootstrap && !needsIncremental) {
    return;
  }

  const run = async () => {
    const now = new Date();
    const maxWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    if (needsBootstrap) {
      // Full 90-day authoritative rebuild in three parallel 30-day windows (removes any deleted POS bills!)
      const d30 = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      const d60 = new Date(now.getTime() - 58 * 24 * 60 * 60 * 1000);
      const d90 = new Date(now.getTime() - 87 * 24 * 60 * 60 * 1000);
      const d30Minus1s = new Date(d30.getTime() - 1000);
      const d60Minus1s = new Date(d60.getTime() - 1000);

      const [rWin1, rWin2, rWin3] = await Promise.all([
        fetchAllPaginated<any>('/receipts', 'receipts', {
          created_at_min: formatDateSql(d30),
          created_at_max: formatDateSql(maxWindow),
        }).catch(() => null),
        fetchAllPaginated<any>('/receipts', 'receipts', {
          created_at_min: formatDateSql(d60),
          created_at_max: formatDateSql(d30Minus1s),
        }).catch(() => null),
        fetchAllPaginated<any>('/receipts', 'receipts', {
          created_at_min: formatDateSql(d90),
          created_at_max: formatDateSql(d60Minus1s),
        }).catch(() => null),
      ]);

      // Only clear existing index if all 3 windows succeeded cleanly so transient network blips don't wipe data
      if (rWin1 && rWin2 && rWin3) {
        receiptIndex.byNumber.clear();
        receiptIndex.latestDateTimeSql = '';
        receiptIndex.windowStartDateSql = formatDateSql(d90);
        ingestRawReceipts([...rWin1, ...rWin2, ...rWin3]);
      } else {
        receiptIndex.windowStartDateSql = receiptIndex.windowStartDateSql || formatDateSql(d90);
        ingestRawReceipts([...(rWin1 || []), ...(rWin2 || []), ...(rWin3 || [])]);
      }

      receiptIndex.bootstrappedAtMs = Date.now();
      receiptIndex.lastIncrementalSyncMs = Date.now();
      return;
    }

    // Incremental sync: fetch recent 48h window AND reconcile any bills deleted from POS inside that window
    const dRecent = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const recentCutoffSql = formatDateSql(dRecent);
    const recentReceipts = await fetchAllPaginated<any>('/receipts', 'receipts', {
      created_at_min: recentCutoffSql,
      created_at_max: formatDateSql(maxWindow),
    }).catch(() => null);

    if (Array.isArray(recentReceipts)) {
      const seenInRecent = ingestRawReceipts(recentReceipts);
      for (const [recNo, existing] of receiptIndex.byNumber.entries()) {
        if (existing.dateTime && existing.dateTime >= recentCutoffSql && !seenInRecent.has(recNo)) {
          receiptIndex.byNumber.delete(recNo);
        }
      }
    }

    // If caller passes open DUE bills (or >48h old credit receipts), fetch them directly by
    // receipt_numbers in 1 fast request so any settlement or deletion inside SalesPlay POS updates immediately.
    if (openBillsToCheck.length > 0) {
      const uniqueOpen = Array.from(
        new Set(openBillsToCheck.map((b) => String(b || '').trim()).filter(Boolean))
      );
      const minWindow =
        receiptIndex.windowStartDateSql ||
        formatDateSql(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
      const maxWindowSql = formatDateSql(maxWindow);

      const batchPromises: Array<{ chunk: string[]; promise: Promise<any[] | null> }> = [];
      for (let i = 0; i < uniqueOpen.length; i += 40) {
        const chunk = uniqueOpen.slice(i, i + 40);
        batchPromises.push({
          chunk,
          promise: fetchAllPaginated<any>('/receipts', 'receipts', {
            created_at_min: minWindow,
            created_at_max: maxWindowSql,
            receipt_numbers: chunk.join(','),
          }).catch(() => null),
        });
      }

      const batchResults = await Promise.all(
        batchPromises.map(async (bp) => ({ chunk: bp.chunk, list: await bp.promise }))
      );
      for (const { chunk, list } of batchResults) {
        if (!Array.isArray(list)) continue;
        ingestRawReceipts(list);
        const returnedNos = new Set(
          list.map((r: any) => String(r?.receipt_number || '').trim()).filter(Boolean)
        );
        for (const recNo of chunk) {
          if (!returnedNos.has(recNo)) {
            const existing = receiptIndex.byNumber.get(recNo);
            if (existing && (!existing.dateTime || existing.dateTime >= minWindow)) {
              receiptIndex.byNumber.delete(recNo);
            }
          }
        }
      }
    }

    receiptIndex.lastIncrementalSyncMs = Date.now();
  };

  receiptIndex.inFlight = run().finally(() => {
    receiptIndex.inFlight = null;
  });
  return receiptIndex.inFlight;
}

export function warmupSalesPlayCache(): void {
  // Non-blocking background pre-warm so customer-profile & catalog endpoints answer in ~10ms
  setTimeout(() => {
    Promise.allSettled([getCustomersCached(false), ensureReceiptsSynced(false)]).catch(() => null);
  }, 500);
}

export async function handleSalesPlayRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = parsedUrl.pathname;

  if (!pathname.startsWith('/api/salesplay')) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  try {
    // 1. Connection status & shop details
    if (pathname === '/api/salesplay/status' && req.method === 'GET') {
      const shopRes = await salesplayRequest('/shops', 'GET');
      if (shopRes.ok && shopRes.data?.shops?.length > 0) {
        const shop = shopRes.data.shops[0];
        sendJson(res, 200, {
          connected: true,
          shopName: shop.shop_name,
          shopId: shop.id,
          terminals: shop.terminal_list,
          lastChecked: new Date().toISOString(),
        });
      } else {
        sendJson(res, 200, {
          connected: false,
          error: shopRes.data || 'Failed to verify shop status',
          lastChecked: new Date().toISOString(),
        });
      }
      return true;
    }

    // 2. Fetch live products & inventory stock with smart server cache + delta version check
    if (pathname === '/api/salesplay/products' && req.method === 'GET') {
      const forceRefresh = parsedUrl.searchParams.get('force') === '1';
      const sinceVersion = parsedUrl.searchParams.get('sinceVersion') || '';
      const nowMs = Date.now();

      if (
        !forceRefresh &&
        cachedCatalog &&
        nowMs - cachedCatalog.cachedAtMs < CATALOG_CACHE_TTL_MS
      ) {
        if (sinceVersion && sinceVersion === cachedCatalog.catalogVersion) {
          sendJson(res, 200, {
            success: true,
            unchanged: true,
            catalogVersion: cachedCatalog.catalogVersion,
            count: cachedCatalog.products.length,
            fetchedAt: cachedCatalog.fetchedAt,
          });
          return true;
        }
        sendJson(res, 200, {
          success: true,
          unchanged: false,
          catalogVersion: cachedCatalog.catalogVersion,
          count: cachedCatalog.products.length,
          fetchedAt: cachedCatalog.fetchedAt,
          products: cachedCatalog.products,
        });
        return true;
      }

      const [allProducts, inventoryLevels] = await Promise.all([
        fetchAllPaginated<any>('/products', 'products'),
        fetchAllPaginated<any>('/inventory', 'inventory_levels'),
      ]);

      const stockMap: Record<string, number> = {};
      for (const item of inventoryLevels) {
        if (!item.shop_id || item.shop_id === SHOP_ID) {
          stockMap[item.product_id] = Number(item.in_stock ?? 0);
        }
      }

      const seenIds = new Set<string>();
      const uniqueProducts: any[] = [];
      for (const prod of allProducts) {
        if (prod.delete_date) continue;
        const key = prod.id || prod.product_code;
        if (key && !seenIds.has(key)) {
          seenIds.add(key);
          uniqueProducts.push(prod);
        }
      }

      const enrichedProducts = uniqueProducts
        .map((prod: any) => {
          const defaultShop =
            prod.shops?.find((s: any) => s.shop_id === SHOP_ID) || prod.shops?.[0];
          if (defaultShop && defaultShop.available_for_sale === false) {
            return null;
          }
          const customImg =
            productImageOverrides[prod.id] || productImageOverrides[prod.product_code];
          const hasStockControl = Boolean(prod.stock_control);
          const rawStock = stockMap[prod.id];
          const computedStock = hasStockControl
            ? rawStock !== undefined
              ? Math.max(0, Math.floor(rawStock))
              : 0
            : rawStock !== undefined
            ? Math.max(0, Math.floor(rawStock))
            : 99;

          const cachedTranslation = serverTranslationCache[prod.id];

          return {
            id: prod.id,
            productCode: prod.product_code || '',
            name: prod.product_name || '',
            arabicName: cachedTranslation?.arabicName || undefined,
            arabicCategory: cachedTranslation?.arabicCategory || undefined,
            category: normalizeCategory(prod.category),
            price: Number(defaultShop?.price ?? 0),
            stock: computedStock,
            stockControl: hasStockControl,
            barcode: prod.barcode || '',
            imageUrl: customImg || prod.image_url || '',
            unit: prod.measurement || 'pcs',
            updatedDate: prod.updated_date || prod.created_date || '',
          };
        })
        .filter(Boolean);

      const digestInput = enrichedProducts
        .map(
          (p: any) =>
            `${p.id}:${p.name}:${p.category}:${p.price}:${p.stock}:${p.imageUrl}:${p.updatedDate}`
        )
        .join('|');
      const catalogVersion = crypto.createHash('sha1').update(digestInput).digest('hex').slice(0, 16);
      const fetchedAt = new Date().toISOString();

      cachedCatalog = {
        catalogVersion,
        fetchedAt,
        cachedAtMs: nowMs,
        products: enrichedProducts,
      };

      if (sinceVersion && sinceVersion === catalogVersion && !forceRefresh) {
        sendJson(res, 200, {
          success: true,
          unchanged: true,
          catalogVersion,
          count: enrichedProducts.length,
          fetchedAt,
        });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        unchanged: false,
        catalogVersion,
        count: enrichedProducts.length,
        fetchedAt,
        products: enrichedProducts,
      });
      return true;
    }

    // 2.1 Translate new/untranslated products into Arabic using Gemini
    if (pathname === '/api/salesplay/translate-products' && req.method === 'POST') {
      const body = await parseBody(req);
      const items = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) {
        sendJson(res, 200, { success: true, translations: {} });
        return true;
      }

      try {
        const translations = await translateProductsWithGemini(
          items.map((it: any) => ({
            id: String(it.id),
            name: String(it.name || ''),
            category: String(it.category || 'General'),
          }))
        );
        Object.assign(serverTranslationCache, translations);
        addSyncLog({
          action: 'Arabic Catalog Translation Updated',
          status: 'success',
          details: `Translated ${Object.keys(translations).length} product(s) to Arabic.`,
        });
        sendJson(res, 200, { success: true, translations });
      } catch (err: any) {
        console.warn('Gemini translation error:', err?.message || err);
        sendJson(res, 200, {
          success: false,
          error: err?.message || 'Translation failed',
          translations: {},
        });
      }
      return true;
    }

    // 2.2 Lookup Customer Profile + Credit Limit + Smart Delta Receipts from SalesPlay
    if (pathname === '/api/salesplay/customer-profile' && req.method === 'GET') {
      const phoneParam = parsedUrl.searchParams.get('phone') || '';
      const codeParam = parsedUrl.searchParams.get('customerCode') || '';
      const sinceParam = (parsedUrl.searchParams.get('since') || '').trim();
      const openBillsParam = (parsedUrl.searchParams.get('openBills') || '').trim();
      const forceRefresh = parsedUrl.searchParams.get('force') === '1';
      const forceFull = parsedUrl.searchParams.get('full') === '1';

      const openBillsList = openBillsParam
        ? openBillsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const openBillSet = new Set<string>(openBillsList);

      const targetPhoneNorm = normalizePhoneDigits(phoneParam);
      const targetCodeTrim = codeParam.trim();
      const targetCodeNoZero = targetCodeTrim.replace(/^0+/, '');

      const [customers] = await Promise.all([
        getCustomersCached(forceRefresh),
        ensureReceiptsSynced(forceRefresh, openBillsList, forceRefresh && forceFull),
      ]);

      // Match by phone_number or customer_code (exact or numeric-stripped)
      const matchedCustomer = customers.find((c: any) => {
        const cPhone = normalizePhoneDigits(c.phone_number || '');
        const cCode = String(c.customer_code || '').trim();
        const cCodeNoZero = cCode.replace(/^0+/, '');

        const phoneMatch =
          Boolean(targetPhoneNorm) &&
          Boolean(cPhone) &&
          (cPhone === targetPhoneNorm ||
            cPhone.endsWith(targetPhoneNorm) ||
            targetPhoneNorm.endsWith(cPhone));

        const codeMatch =
          Boolean(targetCodeTrim) &&
          Boolean(cCode) &&
          (cCode === targetCodeTrim || cCodeNoZero === targetCodeNoZero);

        return phoneMatch || codeMatch;
      });

      if (!matchedCustomer) {
        sendJson(res, 200, {
          success: true,
          matched: false,
          deltaMode: false,
          latestReceiptAt: '',
          totalIndexedBills: 0,
          skippedArchivedCount: 0,
          customer: null,
          creditSummary: null,
          receipts: [],
        });
        return true;
      }

      // Collect all indexed receipts belonging to this customer sorted newest-first
      const matchedCustId = String(matchedCustomer.id || '');
      const matchedCustCode = String(matchedCustomer.customer_code || '').trim();

      const fullCustomerReceipts = Array.from(receiptIndex.byNumber.values())
        .filter((r) => {
          if (matchedCustId && r.customerId === matchedCustId) return true;
          if (matchedCustCode && r.customerCode === matchedCustCode) return true;
          return false;
        })
        .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1))
        .map(({ customerId: _cid, customerCode: _ccode, ...rest }) => rest);

      const useDeltaMode = Boolean(sinceParam && !forceFull);
      const receiptsToReturn = useDeltaMode
        ? fullCustomerReceipts.filter((rec) => {
            if (rec.dateTime > sinceParam) return true;
            if (openBillSet.has(rec.receiptNumber)) return true;
            if (rec.creditAmount > 0) return true;
            return false;
          })
        : fullCustomerReceipts;

      const creditLimitRaw = matchedCustomer.credit_limit;
      const hasCreditLimit =
        creditLimitRaw !== undefined &&
        creditLimitRaw !== null &&
        String(creditLimitRaw).trim() !== '' &&
        !Number.isNaN(Number(creditLimitRaw));
      const creditLimit = hasCreditLimit ? Number(creditLimitRaw) : null;

      // Calculate baseline credit used over all indexed customer receipts
      const creditUsed = fullCustomerReceipts.reduce((sum, rec) => {
        if (String(rec.receiptType).toUpperCase() === 'REFUND') {
          return sum - rec.creditAmount;
        }
        return sum + rec.creditAmount;
      }, 0);

      const safeCreditUsed = Number(Math.max(0, creditUsed).toFixed(3));
      const remainingCredit =
        creditLimit !== null ? Number(Math.max(0, creditLimit - safeCreditUsed).toFixed(3)) : null;

      sendJson(res, 200, {
        success: true,
        matched: true,
        deltaMode: useDeltaMode,
        latestReceiptAt: fullCustomerReceipts[0]?.dateTime || '',
        totalIndexedBills: fullCustomerReceipts.length,
        skippedArchivedCount: Math.max(0, fullCustomerReceipts.length - receiptsToReturn.length),
        activeReceiptNumbers: fullCustomerReceipts.map((r) => r.receiptNumber),
        windowStartDate: receiptIndex.windowStartDateSql,
        customer: {
          id: matchedCustomer.id,
          customerCode: matchedCustomer.customer_code || '',
          name: matchedCustomer.name || '',
          phone: matchedCustomer.phone_number || '',
          email: matchedCustomer.email || '',
          address: matchedCustomer.address || '',
          city: matchedCustomer.city || '',
          region: matchedCustomer.region || '',
          countryCode: matchedCustomer.country_code || 'OM',
          firstVisit: matchedCustomer.first_visit || '',
          lastVisit: matchedCustomer.last_visit || '',
          totalVisits: Number(matchedCustomer.total_visits || 0),
          totalSpent: Number(matchedCustomer.total_spent || 0),
          totalPoints: Number(matchedCustomer.total_points || 0),
          membershipStatus: Boolean(matchedCustomer.membership_status),
        },
        creditSummary: {
          hasCreditLimit,
          creditLimit,
          creditUsed: safeCreditUsed,
          remainingCredit,
        },
        receipts: receiptsToReturn,
      });
      return true;
    }

    // 2.2b List all customers from SalesPlay POS (for Admin & duplicate-prevention code checks)
    if (pathname === '/api/salesplay/customers' && req.method === 'GET') {
      const customers = await fetchAllPaginated<any>('/customers', 'customers');
      const normalized = customers.map((c: any) => {
        const creditLimitRaw = c.credit_limit;
        const hasLimit =
          creditLimitRaw !== undefined &&
          creditLimitRaw !== null &&
          String(creditLimitRaw).trim() !== '' &&
          !Number.isNaN(Number(creditLimitRaw));

        return {
          id: c.id,
          customerCode: String(c.customer_code || '').trim(),
          name: String(c.name || '').trim(),
          phone: String(c.phone_number || '').trim(),
          phoneNormalized: normalizePhoneDigits(c.phone_number || ''),
          creditLimit: hasLimit ? Number(creditLimitRaw) : null,
          totalVisits: Number(c.total_visits || 0),
          totalSpent: Number(c.total_spent || 0),
          totalPoints: Number(c.total_points || 0),
          firstVisit: c.first_visit || '',
          lastVisit: c.last_visit || '',
        };
      });

      sendJson(res, 200, {
        success: true,
        count: normalized.length,
        customers: normalized,
      });
      return true;
    }

    // 2.2b1 Bulk export of all customers + their POS receipts for Admin Firestore sync
    if (pathname === '/api/salesplay/export-customer-snapshots' && req.method === 'GET') {
      const forceRefresh = parsedUrl.searchParams.get('force') === '1';
      const openCreditBills = Array.from(receiptIndex.byNumber.values())
        .filter((r) => r.creditAmount > 0 && String(r.receiptType).toUpperCase() !== 'REFUND')
        .map((r) => r.receiptNumber);
      const [customers] = await Promise.all([
        getCustomersCached(forceRefresh),
        ensureReceiptsSynced(forceRefresh, openCreditBills, forceRefresh),
      ]);

      const snapshots = customers.map((c: any) => {
        const custId = String(c.id || '').trim();
        const custCode = String(c.customer_code || '').trim();
        const creditLimitRaw = c.credit_limit;
        const hasCreditLimit =
          creditLimitRaw !== undefined &&
          creditLimitRaw !== null &&
          String(creditLimitRaw).trim() !== '' &&
          !Number.isNaN(Number(creditLimitRaw));
        const creditLimit = hasCreditLimit ? Number(creditLimitRaw) : null;

        const custReceipts = Array.from(receiptIndex.byNumber.values())
          .filter((r) => {
            if (custId && r.customerId === custId) return true;
            if (custCode && r.customerCode === custCode) return true;
            return false;
          })
          .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1))
          .map(({ customerId: _cid, customerCode: _ccode, ...rest }) => rest);

        return {
          id: custId,
          customerCode: custCode,
          name: String(c.name || '').trim(),
          phone: String(c.phone_number || '').trim(),
          phoneNormalized: normalizePhoneDigits(c.phone_number || ''),
          creditLimit,
          hasCreditLimit,
          totalVisits: Number(c.total_visits || 0),
          totalSpent: Number(c.total_spent || 0),
          firstVisit: String(c.first_visit || ''),
          lastVisit: String(c.last_visit || ''),
          receipts: custReceipts,
        };
      });

      sendJson(res, 200, {
        success: true,
        windowStartDate: receiptIndex.windowStartDateSql,
        count: snapshots.length,
        snapshots,
      });
      return true;
    }

    // 2.2b2 Admin Store & Credit Analytics (powered by incremental receiptIndex, zero extra Firestore reads)
    if (pathname === '/api/salesplay/admin-insights' && req.method === 'GET') {
      const forceRefresh = parsedUrl.searchParams.get('force') === '1';
      const openCreditBills = Array.from(receiptIndex.byNumber.values())
        .filter((r) => r.creditAmount > 0 && String(r.receiptType).toUpperCase() !== 'REFUND')
        .map((r) => r.receiptNumber);
      const [customers] = await Promise.all([
        getCustomersCached(forceRefresh),
        ensureReceiptsSynced(forceRefresh, openCreditBills, false),
      ]);

      const customerIdToCode = new Map<string, string>();
      for (const c of customers) {
        const cid = String(c.id || '').trim();
        const ccode = String(c.customer_code || '').trim();
        if (cid && ccode) {
          customerIdToCode.set(cid, ccode);
        }
      }

      const omanMs = Date.now() + 4 * 60 * 60 * 1000;
      const omanDateStr = (offsetDays: number) =>
        new Date(omanMs - offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const todayStr = omanDateStr(0);
      const d7Str = omanDateStr(6);
      const d30Str = omanDateStr(29);
      const d90Str = omanDateStr(89);

      const round3 = (n: number) => Math.round(n * 1000) / 1000;

      const buildPeriodStats = (minDateStr: string) => {
        let salesTotal = 0;
        let billCount = 0;
        let cashTotal = 0;
        let cardTotal = 0;
        let creditIssuedTotal = 0;
        let refundTotal = 0;

        const productMap = new Map<
          string,
          { name: string; category: string; quantity: number; revenue: number }
        >();
        const categoryMap = new Map<
          string,
          { category: string; revenue: number; bills: Set<string> }
        >();

        for (const rec of receiptIndex.byNumber.values()) {
          const recDate = String(rec.dateTime || '').slice(0, 10);
          if (!recDate || recDate < minDateStr) continue;

          const isRefund = String(rec.receiptType || '').toUpperCase() === 'REFUND';
          if (isRefund) {
            refundTotal += Number(rec.totalMoney || 0);
            continue;
          }

          billCount += 1;
          salesTotal += Number(rec.totalMoney || 0);
          creditIssuedTotal += Number(rec.creditAmount || 0);

          for (const p of rec.payments) {
            const pType = String(p.type || '').trim().toLowerCase();
            if (pType === 'credit') continue;
            if (pType.includes('card') || pType.includes('visa') || pType.includes('master')) {
              cardTotal += Number(p.amount || 0);
            } else {
              cashTotal += Number(p.amount || 0);
            }
          }

          for (const it of rec.items) {
            const pName = String(it.name || 'Item').trim();
            const catName = normalizeCategory(it.category);
            const qty = Number(it.quantity || 0);
            const rev = Number(it.total || 0);

            const prevProd = productMap.get(pName) || {
              name: pName,
              category: catName,
              quantity: 0,
              revenue: 0,
            };
            prevProd.quantity += qty;
            prevProd.revenue += rev;
            productMap.set(pName, prevProd);

            const prevCat = categoryMap.get(catName) || {
              category: catName,
              revenue: 0,
              bills: new Set<string>(),
            };
            prevCat.revenue += rev;
            prevCat.bills.add(rec.receiptNumber);
            categoryMap.set(catName, prevCat);
          }
        }

        const topProducts = Array.from(productMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
          .map((p) => ({
            ...p,
            quantity: Number(p.quantity.toFixed(2)),
            revenue: round3(p.revenue),
          }));

        const topCategories = Array.from(categoryMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8)
          .map((c) => ({
            category: c.category,
            revenue: round3(c.revenue),
            billCount: c.bills.size,
          }));

        return {
          salesTotal: round3(salesTotal),
          billCount,
          cashTotal: round3(cashTotal),
          cardTotal: round3(cardTotal),
          creditIssuedTotal: round3(creditIssuedTotal),
          refundTotal: round3(refundTotal),
          avgBillValue: billCount > 0 ? round3(salesTotal / billCount) : 0,
          topProducts,
          topCategories,
        };
      };

      // Per-customer credit & 90d spend aggregation
      const customerStats: Record<
        string,
        {
          customerCode: string;
          customerId: string;
          posGrossCredit: number;
          dueBillsCount: number;
          billsCount90d: number;
          spent90d: number;
          lastPurchaseDate: string;
        }
      > = {};

      for (const rec of receiptIndex.byNumber.values()) {
        const code =
          (rec.customerCode && rec.customerCode.trim()) ||
          (rec.customerId ? customerIdToCode.get(rec.customerId) || '' : '');
        const key = code || rec.customerId;
        if (!key) continue;

        const entry = customerStats[key] || {
          customerCode: code,
          customerId: rec.customerId,
          posGrossCredit: 0,
          dueBillsCount: 0,
          billsCount90d: 0,
          spent90d: 0,
          lastPurchaseDate: '',
        };

        const isRefund = String(rec.receiptType || '').toUpperCase() === 'REFUND';
        if (isRefund) {
          entry.posGrossCredit = round3(Math.max(0, entry.posGrossCredit - rec.creditAmount));
        } else {
          entry.billsCount90d += 1;
          entry.spent90d = round3(entry.spent90d + rec.totalMoney);
          if (rec.creditAmount > 0) {
            entry.posGrossCredit = round3(entry.posGrossCredit + rec.creditAmount);
            entry.dueBillsCount += 1;
          }
        }
        if (rec.dateTime && rec.dateTime > entry.lastPurchaseDate) {
          entry.lastPurchaseDate = rec.dateTime;
        }

        customerStats[key] = entry;
      }

      sendJson(res, 200, {
        success: true,
        generatedAt: new Date().toISOString(),
        omanTodayDate: todayStr,
        periods: {
          today: buildPeriodStats(todayStr),
          d7: buildPeriodStats(d7Str),
          d30: buildPeriodStats(d30Str),
          d90: buildPeriodStats(d90Str),
        },
        customerStats,
      });
      return true;
    }

    // 2.2c Admin update or register customer in SalesPlay POS
    if (pathname === '/api/salesplay/update-customer' && req.method === 'POST') {
      const body = await parseBody(req);
      const { salesplayId, customerCode, phone, name } = body;

      if (!customerCode && !phone) {
        sendJson(res, 400, { success: false, error: 'customerCode or phone required' });
        return true;
      }

      const payload: Record<string, any> = {
        customer_code: String(customerCode || '').trim(),
        phone_number: String(phone || '').trim(),
        name: String(name || `Customer #${customerCode || ''}`).trim(),
      };

      let spRes: { status: number; ok: boolean; data: any } = {
        status: 0,
        ok: false,
        data: null,
      };

      try {
        if (salesplayId) {
          spRes = await salesplayRequest(`/customers/${salesplayId}`, 'PUT', payload);
          if (!spRes.ok) {
            spRes = await salesplayRequest('/customers', 'PUT', {
              id: salesplayId,
              ...payload,
            });
          }
        } else {
          spRes = await salesplayRequest('/customers', 'POST', payload);
        }
      } catch (err: any) {
        spRes = { status: 500, ok: false, data: err?.message || 'SalesPlay request error' };
      }

      sendJson(res, 200, {
        success: true,
        updatedSalesPlay: spRes.ok,
        salesplayResponse: spRes.data,
      });
      return true;
    }

    // 2.3 Update/Upload Product Image Override
    if (pathname === '/api/salesplay/update-image' && req.method === 'POST') {
      const body = await parseBody(req);
      const { productId, imageUrl } = body;
      if (!productId || !imageUrl) {
        sendJson(res, 400, { success: false, error: 'productId and imageUrl are required' });
        return true;
      }
      setProductImageOverride(productId, imageUrl);
      addSyncLog({
        action: 'Product Image Updated',
        status: 'success',
        details: `Saved new visual image for product ID ${productId}`,
      });
      sendJson(res, 200, { success: true, productId, imageUrl });
      return true;
    }

    // 2.5 Add new product to SalesPlay POS
    if (pathname === '/api/salesplay/create-product' && req.method === 'POST') {
      const body = await parseBody(req);
      const { productCode, name, category, price, cost, stock, unit, barcode } = body;

      const code = productCode || `PRD-${Date.now().toString().slice(-5)}`;
      const prodRes = await salesplayRequest('/products', 'POST', {
        product_code: code,
        product_name: name,
        category: category || 'General',
        sub_category: '',
        stock_control: true,
        expire_mode: false,
        safety_stock: 0,
        product_price_change: false,
        cost: Number(cost || Number(price) * 0.7),
        qty_change_option: false,
        barcode: barcode || '',
        measurement: unit || 'pcs',
        tax_codes: [],
        is_vat_product: false,
        is_composite: false,
        use_production: false,
        components: [],
        is_combo: false,
        combo_sets: [],
        modifier_group_ids: [],
        is_ingredient: false,
        is_variant: false,
        shops: [{ shop_id: SHOP_ID, price: Number(price), available_for_sale: true, safety_stock: 0 }],
      });

      if (prodRes.ok && Array.isArray(prodRes.data) && prodRes.data[0]?.product_ids?.[0]) {
        const newProductId = prodRes.data[0].product_ids[0].product_id;
        if (stock !== undefined && stock > 0) {
          await salesplayRequest('/inventory', 'POST', {
            inventory_levels: [{ product_id: newProductId, shop_id: SHOP_ID, in_stock: Number(stock) }],
          });
        }
        invalidateCatalogCache();
        addSyncLog({
          action: 'Product Added to SalesPlay POS',
          status: 'success',
          details: `Created "${name}" (${price} OMR) with code ${code} in SalesPlay Back Office.`,
        });
        sendJson(res, 200, { success: true, product_id: newProductId, code });
      } else {
        sendJson(res, 400, {
          success: false,
          error: prodRes.data || 'Failed to create product in SalesPlay',
        });
      }
      return true;
    }

    // 3. Complete transaction log
    if (pathname === '/api/salesplay/sync-transaction' && req.method === 'POST') {
      const body = await parseBody(req);
      const { orderNumber, items, paymentMethod, totalAmount, posReceiptNumber } = body;

      const itemsSummary = (items || []).map((i: any) => `${i.quantity}x ${i.name}`).join(', ');
      const formattedTotal = Number(totalAmount || 0).toFixed(3);
      const receiptNote = posReceiptNumber ? ` [POS Bill #${posReceiptNumber}]` : '';
      const detailsMessage = `Order ${orderNumber} (${formattedTotal} OMR via ${paymentMethod})${receiptNote}. Billed on POS terminal (${itemsSummary || 'Order'}).`;

      const log = addSyncLog({
        orderNumber,
        action: 'Order Completed & Billed on POS',
        status: 'success',
        details: detailsMessage,
      });

      sendJson(res, 200, {
        success: true,
        orderNumber,
        log,
      });
      return true;
    }

    // 4. Fetch recent sync logs
    if (pathname === '/api/salesplay/logs' && req.method === 'GET') {
      sendJson(res, 200, {
        logs: getSyncLogs(),
      });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (error) {
    console.error('Error handling SalesPlay request:', error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Internal Server Error',
    });
    return true;
  }
}
