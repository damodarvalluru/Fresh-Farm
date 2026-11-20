import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

let app: FirebaseApp | undefined
let auth: Auth | null | undefined

export function getFirebaseAuth(): Auth | null {
  if (auth !== undefined) return auth
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : undefined)
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID

  // Only the public web API key and project id are required. The auth domain
  // has a standard default, and the app id is optional for Authentication.
  if (!apiKey || !projectId || !authDomain) {
    auth = null
    return auth
  }
  app = getApps().length ? getApp() : initializeApp({ apiKey, authDomain, projectId, appId })
  auth = getAuth(app)
  return auth
}

export function getFirebaseApiUrl() {
  return '/api/backend'
}
