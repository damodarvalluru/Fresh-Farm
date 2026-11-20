const crypto = require('node:crypto')

const API_BASE = 'https://api.razorpay.com/v1'

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  return keyId && keySecret ? { keyId, keySecret } : null
}

function isConfigured() {
  return Boolean(credentials())
}

function httpError(message, status = 502) {
  const error = new Error(message)
  error.status = status
  return error
}

async function request(path, { method = 'GET', body } = {}) {
  const config = credentials()
  if (!config) throw httpError('Online payments are not configured yet.', 503)
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw httpError(data?.error?.description || 'The payment gateway request failed.', 502)
  }
  return data
}

function createOrder({ amount, receipt, notes }) {
  return request('/orders', {
    method: 'POST',
    body: { amount, currency: 'INR', receipt, notes, payment_capture: 1 },
  })
}

function fetchPayment(paymentId) {
  return request(`/payments/${encodeURIComponent(paymentId)}`)
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
}

function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  const config = credentials()
  if (!config) return false
  const expected = crypto.createHmac('sha256', config.keySecret).update(`${orderId}|${paymentId}`).digest('hex')
  return safeEqual(expected, signature)
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqual(expected, signature)
}

module.exports = {
  isConfigured,
  createOrder,
  fetchPayment,
  verifyCheckoutSignature,
  verifyWebhookSignature,
}
