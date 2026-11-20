# Admin security, setup and recovery

Admin access uses **only the provisioned admin email and password**. There are no temporary default credentials, PINs, public registration, password-reset links, OTP/SMS codes, or Google staff sign-in. Customer email/password and Google sign-in remain separate and unchanged.

The stored credential is a salted **Argon2id** hash in the `admins` table. Plaintext passwords and hashes are never placed in frontend configuration, logs, chat, or source control.

Provision or rotate the owner from the `backend/` folder (`cd backend` first):

```sh
node scripts/create-admin.js --email owner@example.com --name "Shop Owner" --password "a-strong-password"
```

The script creates the user + admin rows, promotes the account to ADMIN, stores only the password hash, and revokes every existing session for that admin. The plaintext password is never stored or printed. Re-running it rotates the password instead of creating a duplicate.

## Signing in

`/admin/login` has one form: admin email + password.

- The server looks up only active staff accounts with an allowed role (`ADMIN`, `MANAGER`, `ORDER_MANAGER`) whose email exactly matches the submitted address. An arbitrary visitor email can never authenticate.
- The password is verified on the backend against the Argon2id hash with `argon2.verify`. No hash or verification logic is exposed to the browser.
- Failed sign-ins return a generic error so email existence is not revealed.
- Failed attempts are throttled to 10 per 15 minutes per client IP; successful sign-ins do not consume the budget.

## Sessions

A successful login issues a signed JWT only in an HTTP-only cookie and stores its hash in `admin_sessions` for server-side revocation. Cookies are `Secure` in production and `SameSite=Lax`. Tokens expire after eight hours. Set a unique random `SESSION_SECRET` of at least 32 bytes in the server secret manager.

Role checks run on every `/api/admin/*` request: ADMIN/MANAGER can reach finance, expenses, analytics and reports; ADMIN/MANAGER/ORDER_MANAGER can manage orders and agents; only ADMIN can delete delivery agents or change staff-level configuration.

## Changing credentials while signed in

**My profile → Change sign-in credentials** requires the current password before accepting changes. The admin may update:

- the sign-in email (new address must be valid and not already used by another user), and/or
- the password (minimum 12 characters).

The new password is re-hashed with Argon2id. Both changes are written in one transaction. Every other session is revoked immediately; the current session stays valid so the admin is not interrupted. The response reports which fields changed and clear success/error messages are shown in the dashboard.

## Recovery

1. **Signed in** — rotate the email and/or password in **My profile → Change sign-in credentials**.
2. **Locked out** — run `node scripts/create-admin.js` with the owner email and a new password. It rewrites the hash and revokes all sessions.
3. Remove old secrets from the secret manager's active version and confirm the new login.

Never store plaintext passwords, hashes, or session tokens in source control, frontend configuration, logs or chat. Only the Argon2id hash belongs in the database.

## Staff profile

**My profile** lets the admin update display name, full name, phone and profile photo (PNG/JPEG/WebP up to 900 KB, stored as a data URL in the database). The role is read-only; the sign-in email is changed through the credential form after confirming the current password. Order timelines and expense records show the display name, so keep it recognizable.
