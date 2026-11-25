# Firestore Security Specification

## 1. Data Invariants
1. **Admin Authority**: Only Google-authenticated users with `email_verified == true` and email in `['imshomesantu@gmail.com', 'makarembakkala@gmail.com', 'shomedesk@gmail.com']` may delete orders, change order lifecycle status (`processing`, `ready`, `completed`), or update `product_media`, `product_translations`, and `store_settings`.
2. **Valid Document IDs**: All single-document operations (`get`, `create`, `update`, `delete`) must pass `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
3. **Order Integrity**: Orders must have valid `orderNumber` (max 64), `orderType` in `['ecommerce', 'curbside', 'neighborhood_delivery']`, valid `paymentMethod` in `['cash', 'card', 'online']`, `status` starting at `'pending'` on creation, and `totalAmount >= 0`. Customers cannot forge `completed` status or `received` payment status on creation.
4. **Customer Code Integrity**: Customers have a 3+ digit `customerCode` (`001`, `002`, ...) and normalized phone number bounded in size. Sequential `counters/customers` only allows monotonic increment (`nextSeq == current + 1` or initial `1`).
5. **No Shadow Fields / Bounded Strings**: All string fields have explicit `.size()` bounds to prevent resource exhaustion.

## 2. Dirty Dozen Payloads (Must Fail)
1. Unauthenticated order `delete` -> `PERMISSION_DENIED`
2. Non-whitelisted email attempting order `update` -> `PERMISSION_DENIED`
3. Whitelisted email with `email_verified: false` attempting admin write -> `PERMISSION_DENIED`
4. Order creation with pre-completed `status: 'completed'` -> `PERMISSION_DENIED`
5. Order creation with `paymentStatus: 'received'` -> `PERMISSION_DENIED`
6. Order creation with negative `totalAmount: -10` -> `PERMISSION_DENIED`
7. Oversized `orderId` (> 128 chars) or invalid characters -> `PERMISSION_DENIED`
8. Unauthenticated write to `product_translations` -> `PERMISSION_DENIED`
9. Unauthenticated write to `product_media` -> `PERMISSION_DENIED`
10. Unauthenticated write to `store_settings` -> `PERMISSION_DENIED`
11. Decreasing `counters/customers.lastSeq` -> `PERMISSION_DENIED`
12. Unlisted/unknown collection write `/hack/doc` -> `PERMISSION_DENIED`
