# Authentication architecture

## Customer identities

Firebase Authentication is the identity provider for customer email/password and Google sign-in. The browser must obtain an ID token from Firebase; the API must verify it with Firebase Admin before any private data request. Use the verified Firebase `uid` as the application identity and scope order/address queries to the corresponding database user ID. Never accept a client-supplied role, user ID, product price, or order total as authoritative.

Customer login and registration use Firebase email/password or Google popup authentication. After sign-in, the browser sends an ID token to the API, which verifies it and creates or finds the corresponding CUSTOMER profile. Password reset is handled by Firebase, not a custom endpoint. Firebase configuration and a running API/database are required; until configured, the app clearly reports that sign-in is unavailable.

The app keeps the admin session cookie on the storefront host by proxying `/api/backend/*` requests through a Next.js rewrite to `API_INTERNAL_URL`. Keep the backend origin server-side; do not expose database credentials or Firebase service-account credentials to the browser.

## Staff identities

Admin email/password login is a distinct server route and does not use the customer login form. The API verifies the submitted password against the Argon2id hash stored in the `admins` table and issues an HTTP-only, Secure-in-production, SameSite=Lax cookie. The server persists a token hash in `admin_sessions`, checks revocation and database role on each protected request, and clears/revokes the session on logout. Only active staff records with permitted roles can sign in; Google login is customer-only and is not accepted for staff access.

All staff APIs must use `requireAdmin` and action-specific `requireRoles`/permission checks. Hiding a dashboard route in the browser is not authorization. Do not add public staff registration.
