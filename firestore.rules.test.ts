/**
 * Firestore Security Rules Test Vectors (Dirty Dozen Verification Spec)
 * Validates invariants documented in security_spec.md against firestore.rules.
 */
export const DIRTY_DOZEN_TEST_CASES = [
  { name: 'Unauthenticated delete on /orders/order_1', expected: 'PERMISSION_DENIED' },
  { name: 'Non-whitelisted email update on /orders/order_1', expected: 'PERMISSION_DENIED' },
  { name: 'Unverified admin email (email_verified: false) write', expected: 'PERMISSION_DENIED' },
  { name: 'Create /orders/order_1 with pre-set status="completed"', expected: 'PERMISSION_DENIED' },
  { name: 'Create /orders/order_1 with paymentStatus="received"', expected: 'PERMISSION_DENIED' },
  { name: 'Create /orders/order_1 with negative totalAmount=-5', expected: 'PERMISSION_DENIED' },
  { name: 'Create doc with invalid/oversized ID (>128 chars)', expected: 'PERMISSION_DENIED' },
  { name: 'Unauthenticated write to /product_translations/p1', expected: 'PERMISSION_DENIED' },
  { name: 'Unauthenticated write to /product_media/p1', expected: 'PERMISSION_DENIED' },
  { name: 'Unauthenticated write to /store_settings/general', expected: 'PERMISSION_DENIED' },
  { name: 'Decrement /counters/customers.lastSeq below existing+1', expected: 'PERMISSION_DENIED' },
  { name: 'Write to unlisted collection /arbitrary/doc', expected: 'PERMISSION_DENIED' },
] as const;
