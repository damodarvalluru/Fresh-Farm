# Firebase setup

Google sign-in needs a Firebase project. The browser uses the public web config; the API verifies the Google/Firebase ID token against Google's published signing certificates, so **no service-account private key is required**. A service account is optional and only adds token-revocation checks.

## 1. Create the project

1. Open <https://console.firebase.google.com/> and sign in with the Google account that should own the shop.
2. Choose **Create a project**.
3. Enter a display name such as `Fresh Farm`. Accept or edit the globally unique **project ID** (for example `fresh-farm-1a2b3`). You will need this ID.
4. Google Analytics is optional; it can be disabled.
5. Accept the terms and create the project.

## 2. Enable Google sign-in

1. In the left menu open **Build → Authentication** and choose **Get started**.
2. Open the **Sign-in method** tab and choose **Add new provider → Google**.
3. Enable it, pick a support email, and save.
4. If prompted to configure the OAuth consent screen, choose **External**, enter an app name and support email, and save. While the app is in **Testing**, add the Google account you will sign in with under **Test users**, or publish the app.

Optionally enable **Email/Password** as well. The storefront also supports email/password customer accounts and password reset when that provider is on.

## 3. Register the web app and copy the config

1. Open **Project settings** (gear icon) → **General**.
2. Under **Your apps**, choose the **Web** platform (`</>`).
3. Give it a nickname such as `Fresh Farm Web`, skip Firebase Hosting, and register.
4. Copy the values from the `firebaseConfig` block:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "fresh-farm-1a2b3.firebaseapp.com",
  projectId: "fresh-farm-1a2b3",
  appId: "1:1234567890:web:abcdef"
};
```

Only `apiKey` and `projectId` are required. `authDomain` defaults to `<projectId>.firebaseapp.com`, and `appId` is optional for Authentication.

## 4. Configure localhost

Open **Authentication → Settings → Authorized domains**. `localhost` is included by default, so `http://localhost:3000` works immediately. Add your real domain before deploying.

## 5. Put the values in both env files

Frontend `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=fresh-farm-1a2b3
# Optional:
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=fresh-farm-1a2b3.firebaseapp.com
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

Server `backend/.env`:

```dotenv
FIREBASE_PROJECT_ID=fresh-farm-1a2b3
```

The API uses the same project ID to verify tokens. Leave `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` blank unless you want revocation checks.

## 6. Restart and test

Restart `pnpm dev` and `cd backend && npm run dev` so both processes read the new environment. Then open <http://localhost:3000/login> and choose **Continue with Google**.

Admin staff access does **not** use Google sign-in. It uses only the provisioned admin email and Argon2id-hashed password described in [admin security](ADMIN_SECURITY.md). Firebase/Google remains customer-only.

## Optional: stricter revocation checks

To reject tokens that were revoked before they expire, create a service account under **Project settings → Service accounts → Generate new private key** and add to `backend/.env`:

```dotenv
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@<project>.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Keep that key out of source control. When present, the API uses the Firebase Admin SDK instead of public-key verification.

## Troubleshooting

- **"Google sign-in needs Firebase"** — `frontend/.env.local` is missing `NEXT_PUBLIC_FIREBASE_API_KEY` or `NEXT_PUBLIC_FIREBASE_PROJECT_ID`; restart the Next dev server after adding them.
- **"The Google sign-in could not be verified"** — `backend/.env` has a different `FIREBASE_PROJECT_ID` than the web app, or the API was not restarted.
- **`auth/operation-not-allowed`** — Google provider is not enabled in Authentication → Sign-in method.
- **`auth/unauthorized-domain`** — add the hostname under Authentication → Settings → Authorized domains.
- **`auth/popup-blocked`** — allow popups for the site, or use the email/password form.
- **`403 This Google account is not authorized`** — the Google email is not an active admin. Provision it or use the owner account.
