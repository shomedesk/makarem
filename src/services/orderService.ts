import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { Order } from '../types';

export function generateOrderNumber(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `MAK-${num}`;
}

function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return null as any;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject) as any;
  }
  if (typeof obj === 'object') {
    const clean: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        clean[key] = sanitizeObject(value);
      }
    }
    return clean;
  }
  return obj;
}

export async function createOrderInFirestore(order: Order): Promise<void> {
  const collectionPath = 'orders';
  try {
    const docRef = doc(db, collectionPath, order.id);
    const cleanedOrder = sanitizeObject({
      ...order,
      itemsSerialized: JSON.stringify(order.items),
    });
    await setDoc(docRef, cleanedOrder);
  } catch (error) {
    console.error('Error creating order in Firestore:', error);
    handleFirestoreError(error, OperationType.CREATE, `${collectionPath}/${order.id}`);
  }
}

export async function updateOrderInFirestore(
  orderId: string,
  updates: Partial<Order>
): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    const docRef = doc(db, 'orders', orderId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSingleOrderInFirestore(orderId: string): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    await deleteDoc(doc(db, 'orders', orderId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearAllOrdersInFirestore(): Promise<number> {
  const path = 'orders';
  try {
    const snap = await getDocs(collection(db, path));
    if (snap.empty) return 0;

    const docs = snap.docs;
    let deleted = 0;
    const BATCH_LIMIT = 400;
    for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + BATCH_LIMIT);
      for (const d of chunk) {
        batch.delete(d.ref);
        deleted++;
      }
      await batch.commit();
    }
    return deleted;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToOrders(
  onData: (orders: Order[]) => void,
  onError?: (err: Error) => void
) {
  const path = 'orders';
  try {
    const q = query(collection(db, path), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(
      q,
      (snapshot) => {
        const orders: Order[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          orders.push({
            id: d.id,
            orderNumber: data.orderNumber || d.id,
            orderType: data.orderType || 'ecommerce',
            customerId: data.customerId,
            customerCode: data.customerCode,
            customerName: data.customerName || 'Customer',
            customerPhone: data.customerPhone || '',
            vehicleNumber: data.vehicleNumber,
            parkingSpot: data.parkingSpot,
            houseNumber: data.houseNumber,
            locationCoordinates: data.locationCoordinates,
            paymentMethod: data.paymentMethod || 'cash',
            paymentStatus: data.paymentStatus || 'pending',
            status: data.status || 'pending',
            items: data.items || (data.itemsSerialized ? JSON.parse(data.itemsSerialized) : []),
            customNotes: data.customNotes || '',
            subtotal: Number(data.subtotal || 0),
            tax: Number(data.tax || 0),
            totalAmount: Number(data.totalAmount || 0),
            salesplaySyncStatus: data.salesplaySyncStatus || 'pending',
            salesplayReceiptId: data.salesplayReceiptId,
            salesplaySyncMessage: data.salesplaySyncMessage,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
          });
        });
        onData(orders);
      },
      (error) => {
        if (onError) onError(error);
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToSingleOrder(
  orderId: string,
  onData: (order: Order | null) => void,
  onError?: (err: Error) => void
) {
  const path = `orders/${orderId}`;
  try {
    const docRef = doc(db, 'orders', orderId);
    return onSnapshot(
      docRef,
      (docSnap) => {
        if (!docSnap.exists()) {
          onData(null);
          return;
        }
        const data = docSnap.data();
        onData({
          id: docSnap.id,
          orderNumber: data.orderNumber || docSnap.id,
          orderType: data.orderType || 'ecommerce',
          customerId: data.customerId,
          customerCode: data.customerCode,
          customerName: data.customerName || 'Customer',
          customerPhone: data.customerPhone || '',
          vehicleNumber: data.vehicleNumber,
          parkingSpot: data.parkingSpot,
          houseNumber: data.houseNumber,
          locationCoordinates: data.locationCoordinates,
          paymentMethod: data.paymentMethod || 'cash',
          paymentStatus: data.paymentStatus || 'pending',
          status: data.status || 'pending',
          items: data.items || (data.itemsSerialized ? JSON.parse(data.itemsSerialized) : []),
          customNotes: data.customNotes || '',
          subtotal: Number(data.subtotal || 0),
          tax: Number(data.tax || 0),
          totalAmount: Number(data.totalAmount || 0),
          salesplaySyncStatus: data.salesplaySyncStatus || 'pending',
          salesplayReceiptId: data.salesplayReceiptId,
          salesplaySyncMessage: data.salesplaySyncMessage,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      },
      (error) => {
        if (onError) onError(error);
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function syncOrderWithSalesPlayAPI(order: Order): Promise<{
  success: boolean;
  message: string;
  syncedCount?: number;
}> {
  try {
    const response = await fetch('/api/salesplay/sync-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: order.orderNumber,
        items: order.items,
        paymentMethod: order.paymentMethod,
        totalAmount: order.totalAmount,
      }),
    });

    const result = await response.json();
    if (response.ok && result.success) {
      await updateOrderInFirestore(order.id, {
        salesplaySyncStatus: 'synced',
        salesplaySyncMessage: result.log?.details || 'Billed on POS counter terminal',
      });
      return {
        success: true,
        message: result.log?.details || 'Successfully recorded and billed on POS',
        syncedCount: result.syncedCount,
      };
    } else {
      await updateOrderInFirestore(order.id, {
        salesplaySyncStatus: 'failed',
        salesplaySyncMessage: result.error || 'POS sync error',
      });
      return {
        success: false,
        message: result.error || 'Failed to sync with POS',
      };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Network error connecting to POS API';
    await updateOrderInFirestore(order.id, {
      salesplaySyncStatus: 'failed',
      salesplaySyncMessage: msg,
    });
    return { success: false, message: msg };
  }
}
