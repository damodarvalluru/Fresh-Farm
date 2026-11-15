# Fresh Farm setup

## What runs here

The workspace is a Next.js 16 App Router storefront plus a separate Express API in `server/`. The storefront can render on its own, but checkout, payments, order history, the newsletter, and the staff dashboard need the API and a TiDB database. This guide takes you from a fresh checkout to a working local shop.

## 1. Install dependencies

```sh
pnpm install
cd server
npm install
```

## 2. Configure the API (`server/.env`)

Copy `server/.env.example` to `server/.env` and fill in:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port. Use `4000`; `3000` is taken by Next.js. |
| `CLIENT_ORIGIN` | Storefront origin, e.g. `http://localhost:3000`. Required. |
| `TRUST_PROXY` | Set `true` only behind a trusted reverse proxy. |
| `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE` | TiDB Cloud Serverless connection. TLS is enforced by the driver. |
| `ADMIN_PASSWORD_HASH` | Optional bootstrap/fallback Argon2id hash. Normal staff passwords and PINs live hashed in the `admins` table. |
| `SESSION_SECRET` | Random value of at least 32 characters. Required. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys. Use test keys locally; live keys move real money. |
| `RAZORPAY_WEBHOOK_SECRET` | Secret you set on the Razorpay webhook. Without it the webhook rejects every call. |
| `RESEND_API_KEY`, `RESEND_FROM` | Optional email receipts and alerts. |
| `TWILIO_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | Optional WhatsApp order alerts. |
| `CONTACT_NOTIFY_EMAIL`, `CONTACT_NOTIFY_WHATSAPP` | Where owner notifications are sent. |

`POSTGRES`-style TLS options are not needed; `server/src/config/db.js` already enables TLS for TiDB.

The API refuses to start without `CLIENT_ORIGIN` or a `SESSION_SECRET` of at least 32 characters.

## 3. Create the database

Create a `fresh_farm` database on your TiDB cluster (or reuse the name in `TIDB_DATABASE`), then apply the schema and seed:

```sh
mysql --host <host> --port 4000 --user <user> -p < database/schema.sql
mysql --host <host> --port 4000 --user <user> -p < database/seed.sql
```

Both files are idempotent (`CREATE TABLE IF NOT EXISTS`, `ON DUPLICATE KEY UPDATE`), so re-running them is safe. `schema.sql` also seeds roles, permissions, role mappings, and the `store` settings row. `seed.sql` seeds the starter catalogue and inventory but no users, admins, or production orders. On a shared cluster, keep the Fresh Farm database separate from other projects' databases.

## 4. Provision the owner account

```sh
cd server
node scripts/create-admin.js --email owner@example.com --name "Shop Owner" --password "a-strong-password" --pin 864209
```

The script creates the user and admin rows, stores Argon2id hashes in the `admins` table, and revokes existing sessions. It never stores or prints the plaintext password or PIN. Sign in at `/admin/login` with the password or PIN. On a new database you can also use **First-time owner setup** with a bootstrap `ADMIN_PASSWORD_HASH`; run the script with `--print-hash` to generate that value without touching the database.

## 5. Configure the storefront (`.env.local`)

Copy `.env.example` to `.env.local`:

- `API_INTERNAL_URL` — where the Next.js rewrite sends `/api/backend/*` (default `http://localhost:4000`).
- `NEXT_PUBLIC_FIREBASE_*` — optional Firebase web config for customer sign-in. Leave blank for guest-only checkout.

## 6. Run both services

```sh
# terminal 1
pnpm dev

# terminal 2
cd server
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

- Deploy `server/` as an independent Node service and point `API_INTERNAL_URL` at its HTTPS origin.
- Serve the storefront over HTTPS so the API's secure session cookie (`__Host-ff-admin`) works.
- Register the Razorpay webhook at `https://<your-domain>/api/backend/payments/razorpay/webhook` and use the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- Resend's `onboarding@resend.dev` sender can only email the account owner. Verify a domain at <https://resend.com/domains> and change `RESEND_FROM` before sending customer receipts.
- Never commit `.env` files. Rotate any key that has been shared in plain text.
