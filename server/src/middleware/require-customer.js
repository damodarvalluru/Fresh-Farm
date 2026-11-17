const jwt = require('jsonwebtoken')
const { rateLimit } = require('express-rate-limit')
const db = require('../config/db')
const { verifyIdToken } = require('../services/firebase-auth')

function bearerToken(req) {
  const header = req.get('authorization') || ''
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  return token.length > 0 && token.length <= 10000 ? token : null
}

async function loadCustomer(uid) {
  const [rows] = await db.execute(
    `SELECT u.id, u.email, u.full_name, u.phone, u.created_at, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.firebase_uid = ? AND u.is_active = 1 AND r.name = 'CUSTOMER' LIMIT 1`,
    [uid],
  )
  return rows[0] || null
}

/**
 * Verifies the Firebase ID token supplied in the Authorization header and
 * attaches the matching Fresh Farm customer to req.customer. Every private
 * dashboard query must scope by req.customer.id so a signed-in customer can
 * never read another customer's orders or payments.
 */
async function requireCustomer(req, res, next) {
  try {
    const token = bearerToken(req)
    if (!token) return res.status(401).json({ error: 'Sign in to access your account.', code: 'auth-required' })
    const decoded = await verifyIdToken(token)
    if (typeof decoded.uid !== 'string' || decoded.uid.length === 0 || decoded.uid.length > 128) {
      return res.status(401).json({ error: 'The customer identity could not be verified.', code: 'invalid-token' })
    }
    const customer = await loadCustomer(decoded.uid)
    if (!customer) {
      return res.status(401).json({ error: 'Your customer profile is not set up yet. Sign in again to finish creating it.', code: 'profile-required' })
    }
    req.customer = customer
    return next()
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ error: error.message })
    if (error.status === 401 || error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError' || error.code?.startsWith('auth/')) {
      return res.status(401).json({ error: 'Your session expired. Sign in again to continue.', code: 'invalid-token' })
    }
    return next(error)
  }
}

/**
 * Attaches req.customer when a valid Bearer token is present, but still allows
 * guest checkout when there is no token. An invalid token is rejected instead
 * of silently placing the order as a guest.
 */
async function optionalCustomer(req, res, next) {
  const header = req.get('authorization')
  if (!header) return next()
  return requireCustomer(req, res, next)
}

/** Required for payment receipts opened directly in a tab (no fetch helper). */
function signReceiptToken(paymentId, customerId, orderNumber) {
  return jwt.sign({ pid: String(paymentId), cid: String(customerId), orderNumber }, process.env.SESSION_SECRET, {
    expiresIn: '10m',
    issuer: 'fresh-farm-api',
    audience: 'fresh-farm-receipt',
  })
}

async function requireReceipt(req, res, next) {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    let paymentId = null
    if (token) {
      const claims = jwt.verify(token, process.env.SESSION_SECRET, { issuer: 'fresh-farm-api', audience: 'fresh-farm-receipt' })
      paymentId = claims.pid
      req.receiptCustomerId = Number(claims.cid)
    }
    if (paymentId === null) {
      const auth = bearerToken(req)
      if (!auth) return res.status(401).json({ error: 'Sign in to download this receipt.', code: 'auth-required' })
      const decoded = await verifyIdToken(auth)
      const customer = await loadCustomer(decoded.uid)
      if (!customer) return res.status(401).json({ error: 'Customer profile not found.', code: 'profile-required' })
      req.receiptCustomerId = Number(customer.id)
    }
    req.receiptPaymentId = Number(paymentId)
    if (!Number.isInteger(req.receiptPaymentId) || req.receiptPaymentId <= 0) return res.status(400).json({ error: 'A valid payment is required.' })
    return next()
  } catch (error) {
    if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') return res.status(401).json({ error: 'This receipt link expired. Sign in and download it again.' })
    if (error.status === 503) return res.status(503).json({ error: error.message })
    return next(error)
  }
}

const customerApiLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false })
const receiptLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })

module.exports = { requireCustomer, optionalCustomer, requireReceipt, signReceiptToken, customerApiLimit, receiptLimit, bearerToken, loadCustomer }
