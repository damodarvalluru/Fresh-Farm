# Fresh Farm

A responsive farm-to-door chicken storefront built with Next.js 16, React, and Tailwind CSS, backed by an Express API and a TiDB Cloud database. It includes a live product catalogue, category filtering, search, a shopping bag, guest checkout with Razorpay online payment or cash on delivery, order tracking, newsletter signup, and a password-protected staff dashboard for orders.

## Run the storefront

```sh
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The Next.js rewrite forwards `/api/backend/:path*` to `API_INTERNAL_URL` (default `http://localhost:4000`). Firebase customer sign-in is optional: with no Firebase web config in `.env.local`, the shop still works and checkout uses the guest flow. See [Firebase setup](docs/FIREBASE_SETUP.md).

## Run the API

```sh
cd server
npm install
npm run dev
```

The API listens on `http://localhost:4000` and serves the catalogue, orders, payments, newsletter, and staff endpoints. Follow [installation](docs/INSTALLATION.md) to configure TiDB, Razorpay, session secrets, and the admin password hash, then apply `database/schema.sql` and `database/seed.sql` to the `fresh_farm` database.

## What works now

- **Catalogue** — `GET /api/products` reads active products, categories, images, and store delivery settings from TiDB. The storefront loads them at runtime and falls back to built-in sample data if the API is offline.
- **Checkout** — `POST /api/orders` prices the cart server-side, creates or reuses a customer by email, writes the order, order items, address, payment row, and status event in one transaction, and returns the order number. Guests are stored with a hashed `guest:<sha256(email)>` Firebase UID. A client-generated `clientOrderId` plus a unique `(customer_id, client_order_id)` index makes retries idempotent, and every confirmed order gets a globally unique `FF-YYYYMMDD-XXXXXXXXXXXX` number even under concurrent checkouts.
- **Online payment** — `POST /api/orders` (or `POST /api/orders/:orderNumber/payment` to retry) creates a Razorpay order. The browser opens Razorpay Checkout and posts the signed result to `POST /api/payments/razorpay/verify`, which verifies the HMAC signature and re-checks the captured amount before marking the order paid.
- **Webhook** — `POST /api/payments/razorpay/webhook` verifies `x-razorpay-signature` against the raw body and handles `payment.captured`, `order.paid`, and `payment.failed`. See [payments](docs/PAYMENTS.md).
- **Customer dashboard** — `/dashboard` signs customers in with Firebase (Google or email), then shows only their own orders, payments, receipts, saved bag, delivery tracking and cancellation options. Receipts are generated server-side as PDFs behind short-lived signed links.
- **Order tracking** — `GET /api/orders/:orderNumber?email=...` returns status, payment state, address, and line items for guests. The `/account` page keeps this public tracking form.
- **Staff dashboard** — `/admin/dashboard` is the operational back office: live analytics (daily/weekly/monthly/annual orders, revenue, profit, costs and savings with SVG charts and CSV exports), all-order search and detail drawers, kitchen status workflow, delivery-agent assignment and monitoring, rider workload/capacity, operating-expense tracking, and a staff profile with photo, password and PIN management. Role-based guards keep finance and agent management away from order managers.
- **Newsletter** — `POST /api/newsletter` stores subscribers idempotently.
- **Notifications** — order receipts use Resend and owner alerts use Twilio WhatsApp on a best-effort basis, so a provider outage never blocks an order.

## Staff access

Staff credentials are never seeded with defaults. Provision an owner once with:

```sh
cd server
node scripts/create-admin.js --email owner@example.com --name "Shop Owner" --password "a-strong-password" --pin 864209
```

The script stores Argon2id hashes in the `admins` table and revokes existing sessions. Sign in at `/admin/login` with the password or the PIN. On a brand-new database you can also use **First-time owner setup** on that screen with the bootstrap password from `ADMIN_PASSWORD_HASH`. `ADMIN_PASSWORD_HASH` is now an optional fallback; `--print-hash` prints a hash without touching the database. Read [admin security](docs/ADMIN_SECURITY.md) before enabling staff access in production.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Payments](docs/PAYMENTS.md)
- [Firebase setup](docs/FIREBASE_SETUP.md)
- [Authentication architecture](docs/AUTHENTICATION.md)
- [Admin security](docs/ADMIN_SECURITY.md)
- [TiDB setup](docs/TIDB_SETUP.md)
