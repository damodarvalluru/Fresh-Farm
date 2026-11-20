const jwt = require('jsonwebtoken')
const { getAuth } = require('firebase-admin/auth')
const { getFirebaseAdmin } = require('../config/firebase')

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
let certCache = { certs: {}, expiresAt: 0 }

function authError(message, status = 401) {
  const error = new Error(message)
  error.status = status
  error.code = 'auth/invalid-token'
  return error
}

function adminSdkConfigured() {
  return Boolean(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
}

async function fetchSigningKeys(force = false) {
  if (!force && certCache.expiresAt > Date.now()) return certCache.certs
  const response = await fetch(CERTS_URL)
  if (!response.ok) throw authError('Could not download Firebase signing keys.', 503)
  const maxAge = Number((response.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600)
  const certs = await response.json()
  certCache = { certs, expiresAt: Date.now() + Math.max(60, maxAge - 60) * 1000 }
  return certs
}

async function verifyWithPublicKeys(idToken) {
  const projectId = process.env.FIREBASE_PROJECT_ID
  if (!projectId) throw authError('Firebase is not configured on the API. Set FIREBASE_PROJECT_ID.', 503)

  const parsed = jwt.decode(idToken, { complete: true })
  const kid = parsed?.header?.kid
  if (!kid) throw authError('The Firebase token has no signing key id.')

  let certs = await fetchSigningKeys()
  let publicKey = certs[kid]
  if (!publicKey) {
    certs = await fetchSigningKeys(true)
    publicKey = certs[kid]
  }
  if (!publicKey) throw authError('The Firebase token was signed with an unknown key.')

  let payload
  try {
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      clockTolerance: 5,
    })
  } catch {
    throw authError('The Firebase token is invalid or expired.')
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    throw authError('The Firebase token has an invalid subject.')
  }

  return { ...payload, uid: payload.sub }
}

/**
 * Verify a Firebase ID token.
 *
 * When a service account is configured we use the Admin SDK (which also checks
 * token revocation). Otherwise we verify the RS256 signature against Google's
 * published secure-token certificates, so only the public project id is needed.
 */
async function verifyIdToken(idToken) {
  if (adminSdkConfigured()) {
    return getAuth(getFirebaseAdmin()).verifyIdToken(idToken, true)
  }
  return verifyWithPublicKeys(idToken)
}

module.exports = { verifyIdToken }
