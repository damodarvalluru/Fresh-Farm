# Payments and order flow

Fresh Farm takes orders through the Express API in `server/`. Prices are always recalculated on the server; the browser never supplies a trusted amount.

## Order creation

`POST /api/orders`

```json
{
  "customer": { "fullName": "Asha Rao", "email": "asha@example.com", "phone": "+919000000000" },
  "address": { "recipientName": "Asha Rao", "phone": "+919000000000", "line1": "12 Market Road", "city": "Visakhapatnam", "postalCode": "530001" },
  "fulfilment": "delivery",
  "paymentMethod": "online",
  "notes": "Curry cut",
  "items": [{ "productId": 1, "quantity": 2 }]
}
```

The API:

1. Validates contact details, address (for delivery), and item quantities.
2. Loads products from TiDB and computes the subtotal, delivery fee (free at or above `store.freeDeliveryAbove`, free for pickup), and total.
3. Creates or reuses a customer by email. Guests get `firebase_uid = guest:<sha256(email)>`.
4. Writes `users`, `addresses`, `orders`, `order_items`, `payments`, and the first `order_status_events` row in one transaction.
5. For `paymentMethod: "cash_on_delivery"`, returns `201` with the order.
6. For `paymentMethod: "online"`, creates a Razorpay order and returns a `payment` object with `keyId`, `razorpayOrderId`, `amount` (paise), `currency`, and customer prefill data. If Razorpay is not configured, it returns the saved order with `paymentUnavailable: true`.

## Razorpay checkout

The browser loads `https://checkout.razorpay.com/v1/checkout.js`, opens Checkout with the returned order id, and on success posts:

```json
{ "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." }
```

to `POST /api/payments/razorpay/verify`. The server:

1. Recomputes the HMAC-SHA256 signature with `RAZORPAY_KEY_SECRET` and compares it in constant time.
2. Finds the local payment row by `provider_order_id`.
3. Fetches the payment from Razorpay and confirms `order_id` and `amount` match the stored order.
4. Marks the payment `captured`, the order `paid`, records a status event, and fires notifications.

If the customer closes Checkout, the order stays saved. The browser shows a **Retry online payment** button, which calls:

`POST /api/orders/:orderNumber/payment` with `{ "email": "asha@example.com" }`

That endpoint re-checks the email, refuses already-paid orders, and creates a fresh Razorpay order.

## Webhook

`POST /api/payments/razorpay/webhook`

- Mounted before the JSON body parser so the raw bytes are available for signature verification.
- Requires header `x-razorpay-signature`, verified with `RAZORPAY_WEBHOOK_SECRET`.
- Handles `payment.captured` and `order.paid` by marking the order paid, and `payment.failed` by recording the failure.
- Returns `{ "ok": true }` for unrelated or unknown orders so Razorpay stops retrying.
- Rejects every call with `400` until `RAZORPAY_WEBHOOK_SECRET` is set.

Register the endpoint in the Razorpay dashboard as:

```
https://<your-domain>/api/backend/payments/razorpay/webhook
```

The `/api/backend` prefix is the Next.js rewrite to the API. Use `/api/payments/razorpay/webhook` if you call the API host directly.

## Database tables

| Table | Role |
| --- | --- |
| `orders` | Order header, totals, fulfilment, status, payment status. |
| `order_items` | Line snapshots of name, unit, price, requested and actual quantity. |
| `payments` | One row per attempt provider, Razorpay ids, amount, status, failure reason, confirmation time. |
| `order_status_events` | Append-only status history with the staff admin who changed it. |
| `addresses` | Delivery address for the order. |
| `users` | Customer record, including guests. |

`order_items.price_snapshot` and `estimated_line_total` preserve what the customer saw even if catalogue prices change later.

## Money and units

- Razorpay amounts are integer paise: `Math.round(total * 100)`.
- Database amounts are `DECIMAL(10,2)`.
- Currency is INR.

## Notifications

Order creation and confirmed online payments call `server/src/services/notify.js`:

- Resend sends the customer receipt from `RESEND_FROM`.
- Twilio sends the owner a WhatsApp alert to `CONTACT_NOTIFY_WHATSAPP`, from `TWILIO_WHATSAPP_FROM`.

Both are best-effort: failures are logged and never block an order. Resend's shared `onboarding@resend.dev` sender only delivers to the account owner; verify a domain at <https://resend.com/domains> and update `RESEND_FROM` to send real customer receipts.

## Security notes

- Never expose `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, or `SESSION_SECRET` to the browser. Only the public `RAZORPAY_KEY_ID` is returned in the payment payload.
- Use Razorpay test keys in development. Live keys (`rzp_live_...`) charge real cards.
- Keep `.env` files out of source control.
- If a payment is captured but verification fails on the client, the webhook still reconciles the order. Ask the customer for the order number and confirm the payment in the Razorpay dashboard.
