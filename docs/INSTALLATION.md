# Fresh Farm setup

## What runs here

The workspace is a Next.js 16 App Router storefront plus a separate Express API in `backend/`. The storefront can render on its own, but checkout, payments, order history, the newsletter, and the staff dashboard need the API and a TiDB database. This guide takes you from a fresh checkout to a working local shop.

## 1. Install dependencies

```sh
pnpm install
cd backend
npm install
```

## 2. Configure the API (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port. Use `4000`; `3000` is taken by Next.js. |
| `CLIENT_ORIGIN` | Storefront origin, e.g. `http://localhost:3000`. Required. |
| `TRUST_PROXY` | Set `true` only behind a trusted reverse proxy. |
| `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE` | TiDB Cloud Serverless connection. TLS is enforced by the driver. |
| Admin credentials | Provisioned email + Argon2id password hash stored in the `admins` table; no environment credential or default account. |
| `SESSION_SECRET` | Random value of at least 32 characters. Required. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys. Use test keys locally; live keys move real money. |
| `RAZORPAY_WEBHOOK_SECRET` | Secret you set on the Razorpay webhook. Without it the webhook rejects every call. |
| `RESEND_API_KEY`, `RESEND_FROM` | Optional email receipts and alerts. |
| `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Optional WhatsApp order alerts. |
| `CONTACT_NOTIFY_EMAIL`, `CONTACT_NOTIFY_WHATSAPP` | Where owner notifications are sent. |

`POSTGRES`-style TLS options are not needed; `backend/src/config/db.js` already enables TLS for TiDB.

The API refuses to start without `CLIENT_ORIGIN` or a `SESSION_SECRET` of at least 32 characters.

## 3. Create the database

Create a `fresh_farm` database on your TiDB cluster (or reuse the name in `TIDB_DATABASE`), then apply the schema and seed:

```sh
mysql --host <host> --port 4000 --user <user> -p < backend/database/schema.sql
mysql --host <host> --port 4000 --user <user> -p < backend/database/seed.sql
```

Both files are idempotent (`CREATE TABLE IF NOT EXISTS`, `ON DUPLICATE KEY UPDATE`), so re-running them is safe. `schema.sql` also seeds roles, permissions, role mappings, and the `store` settings row. `seed.sql` seeds the starter catalogue and inventory but no users, admins, or production orders. On a shared cluster, keep the Fresh Farm database separate from other projects' databases.

## 4. Provision the owner account

```sh
cd backend
node scripts/create-admin.js --email owner@example.com --name "Shop Owner" --password "a-strong-password"
```

The script creates the user and admin rows, stores only the Argon2id password hash in the `admins` table, and revokes existing sessions. It never stores or prints the plaintext password. Sign in at `/admin/login` with that email and password. The admin can change the sign-in email and/or password later from **My profile → Change sign-in credentials** after confirming the current password.

## 5. Configure the storefront (`frontend/.env.local`)

Copy `frontend/.env.example` to `frontend/.env.local`:

- `API_INTERNAL_URL` — where the Next.js rewrite sends `/api/backend/*` (default `http://localhost:4000`).
- `NEXT_PUBLIC_FIREBASE_*` — optional Firebase web config for customer sign-in. Leave blank for guest-only checkout.

## 6. Run both services

```sh
# terminal 1
pnpm dev

# terminal 2
cd backend
npm run dev
```

Open `http://localhost:3000`. The API prints `Fresh Farm API listening on port 4000`.

## 7. Verify

```sh
curl http://localhost:4000/api/health
curl http://localhost:4000/api/products
```

Then place a cash-on-delivery test order from the shop and confirm it appears at `http://localhost:3000/admin/dashboard` after staff sign-in.

## Deployment notes

- Deploy `backend/` as an independent Node service and point `API_INTERNAL_URL` at its HTTPS origin.
- Serve the storefront over HTTPS so the API's secure session cookie (`__Host-ff-admin`) works.
- Register the Razorpay webhook at `https://<your-domain>/api/backend/payments/razorpay/webhook` and use the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- Resend's `onboarding@resend.dev` sender can only email the account owner. Verify a domain at <https://resend.com/domains> and change `RESEND_FROM` before sending customer receipts.
- Never commit `.env` files. Rotate any key that has been shared in plain text.
