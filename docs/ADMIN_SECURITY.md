# Admin security, setup and recovery

The staff area has no default password and no unauthenticated reset endpoint. Passwords and PINs are stored only as Argon2id hashes in the `admins` table. `ADMIN_PASSWORD_HASH` in the environment is optional: keep it as a bootstrap/fallback secret for a brand-new database, or leave it empty once the owner has saved a database password.

Provision or rotate the owner from the server folder:

```sh
node scripts/create-admin.js --email owner@example.com --name "Shop Owner" --password "a-strong-password" --pin 864209
```

The script creates the user + admin rows, promotes the account to ADMIN, stores the hashes in the database, and revokes every existing session for that admin. The plaintext password and PIN are never stored or printed. Re-running it rotates the credentials instead of creating a duplicate. Add `--print-hash` to print an `ADMIN_PASSWORD_HASH=...` line without writing to the database.

## Signing in

`/admin/login` offers three paths:

- **Password** — email + password, verified against the database hash (or the bootstrap hash when no database password exists yet).
- **PIN** — email + a 6–10 digit PIN, for fast sign-in on a trusted device. A PIN never replaces the password: changing it requires the current password.
- **Google** — staff accounts that already have a Firebase identity can sign in with Google; the server checks that the verified email belongs to an active admin.

On a new owner account with no database password, the screen shows **First-time owner setup**. It accepts the bootstrap password from `ADMIN_PASSWORD_HASH` and lets the owner save a password and PIN to the database.

All login, setup and reset attempts share a rate limit of 5 requests per 15 minutes per client. Failed attempts return a generic error so email existence is not revealed.

## Sessions

A successful login issues a short-lived signed token only in an HTTP-only cookie and stores its hash in `admin_sessions` for server-side revocation. Production cookies require HTTPS. Set a unique random `SESSION_SECRET` of at least 32 characters in the server secret manager.

Changing or resetting a password revokes outstanding sessions. Signing out revokes the current session. Role checks run on every `/api/admin/*` request: ADMIN/MANAGER can reach finance, expenses, analytics and reports; ADMIN/MANAGER/ORDER_MANAGER can manage orders and agents; only ADMIN can delete delivery agents or change staff-level configuration.

## Rotation / recovery

1. **Signed in** — open **My profile → Change password**, enter the current password and a new one of at least 12 characters. Use **Change sign-in PIN** for a 6–10 digit PIN. Other devices are signed out immediately.
2. **Locked out but have the owner bootstrap password** — use **Reset with owner password** on `/admin/login`. It requires `ADMIN_PASSWORD_HASH` to match, rotates the password (and optionally the PIN), and revokes every existing staff session.
3. **No bootstrap secret** — run `node scripts/create-admin.js` with the owner email and a new password. It writes the new hash and revokes sessions.
4. Remove old secrets from the secret manager's active version and confirm the new login.

Never enable a public password reset, create a default credential, or store plaintext passwords, hashes, PINs or session tokens in source control, frontend configuration, logs or chat.

## Staff profile

**My profile** lets staff update their display name, full name, phone and profile photo (PNG/JPEG/WebP up to 900 KB, stored as a data URL in the database). The role and email are read-only. Order timelines and expense records show the display name, so keep it recognizable.
