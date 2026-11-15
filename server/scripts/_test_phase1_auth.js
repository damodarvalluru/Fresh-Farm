/*
 * Temporary Phase 1 authenticated end-to-end check.
 *
 * Runs the real Express app in-process on an ephemeral port with only the
 * Firebase signature check replaced by deterministic test identities. Routes,
 * middleware, SQL, receipts and cancellation logic are the production code.
 * Every credential-independent auth rejection is also checked separately by
 * _test_phase1.js against the live server.
 */
require('dotenv').config()
const { once } = require('node:events')
const { randomBytes } = require('node:crypto')

const TOKENS = new Map()
let nextUid = 0
function makeToken(email, verified = true) {
  nextUid += 1
  const token = `test-token-${Date.now()}-${randomBytes(6).toString('hex')}`
  const identity = { uid: `test-uid-${nextUid}-${Date.now()}`, email, email_verified: verified }
  TOKENS.set(token, identity)
  return { token, identity }
}

// Replace only remote token verification *before* middleware and routes load,
// so every handler in this process uses the deterministic test identities.
const firebaseAuth = require('../src/services/firebase-auth')
firebaseAuth.verifyIdToken = async token => {
  const identity = TOKENS.get(token)
  if (!identity) {
    const error = new Error('The Firebase token is invalid or expired.')
    error.status = 401
    error.code = 'auth/invalid-token'
    throw error
  }
  return identity
}

const { signReceiptToken } = require('../src/middleware/require-customer')
const db = require('../src/config/db')
const app = require('../src/app')

let BASE = ''
let failures = 0
function pass(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures += 1
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return { status: response.status, body: await response.json().catch(() => null), contentType }
  }
  return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()), contentType }
}

function orderBody(suffix, extra = {}) {
  return {
    clientOrderId: `phase1-${suffix}-${Date.now()}-${randomBytes(3).toString('hex')}`,
    customer: { fullName: 'Phase One Check', email: `phase1-${suffix}@example.com`, phone: '9876500000' },
    fulfilment: 'delivery',
    paymentMethod: 'cash_on_delivery',
    address: { recipientName: 'Phase One Check', phone: '9876500000', line1: '3 Test Lane', city: 'Bengaluru', postalCode: '560003' },
    items: [{ productId: 1, quantity: 2 }],
    ...extra,
  }
}

async function main() {
  const server = app.listen(0)
  await once(server, 'listening')
  BASE = `http://127.0.0.1:${server.address().port}/api`

  const emailA = `ff-check-a-${Date.now()}@example.com`
  const emailB = `ff-check-b-${Date.now()}@example.com`
  const emailGuest = `ff-guest-${Date.now()}@example.com`
  const emails = [emailA, emailB, emailGuest]
  const a = makeToken(emailA)
  const b = makeToken(emailB)
  let orderNumber = null
  let paymentId = null

  try {
    const session = await request('/auth/customer/session', { method: 'POST', body: { idToken: a.token, fullName: 'Check User A', phone: '9000000001' } })
    pass('Customer session created', session.status === 200 || session.status === 201, `status ${session.status}`)
    const [userARows] = await db.execute('SELECT id, firebase_uid, email FROM users WHERE email = ?', [emailA])
    const userAId = userARows[0]?.id
    pass('Customer row linked to verified uid', Boolean(userAId) && userARows[0].firebase_uid === a.identity.uid)

    const me = await request('/customer/me', { token: a.token })
    pass('GET /customer/me returns own profile', me.status === 200 && me.body?.customer?.email === emailA, `status ${me.status}`)
    pass('Stats start at zero orders', me.body?.stats?.totalOrders === 0, String(me.body?.stats?.totalOrders))

    const order = await request('/orders', {
      token: a.token,
      method: 'POST',
      body: orderBody('auth'),
    })
    pass('Authenticated order created', order.status === 201, `status ${order.status}`)
    orderNumber = order.body.order.orderNumber
    const [ownedRows] = await db.execute('SELECT customer_id FROM orders WHERE order_number = ?', [orderNumber])
    pass('Order stored against the signed-in customer', Number(ownedRows[0].customer_id) === Number(userAId), `${ownedRows[0].customer_id} vs ${userAId}`)

    const orderList = await request('/customer/orders', { token: a.token })
    pass('Own order listed in dashboard', orderList.body?.orders?.some(item => item.orderNumber === orderNumber))

    const detail = await request(`/customer/orders/${encodeURIComponent(orderNumber)}`, { token: a.token })
    pass('Own order detail includes items and timeline', detail.status === 200 && detail.body?.order?.items?.length === 1 && Array.isArray(detail.body?.timeline), `status ${detail.status}`)

    const payments = await request('/customer/payments', { token: a.token })
    const payment = payments.body?.payments?.[0]
    paymentId = payment?.id
    pass('Payment history lists the payment', payments.status === 200 && payment?.orderNumber === orderNumber, `status ${payments.status}`)
    pass('Payment shows transaction id, amount, method, status', Boolean(payment?.transactionId) && payment?.amount === 539 && Boolean(payment?.method) && payment?.status === 'pending', JSON.stringify(payment))

    const profile = await request('/customer/me', { token: a.token, method: 'PATCH', body: { fullName: 'Check User A Updated', phone: '9000000002' } })
    pass('Profile update accepted', profile.status === 200 && profile.body?.customer?.fullName === 'Check User A Updated', `status ${profile.status}`)

    // Another signed-in customer must never see or touch this order.
    const sessionB = await request('/auth/customer/session', { method: 'POST', body: { idToken: b.token, fullName: 'Check User B' } })
    pass('Second customer session created', sessionB.status === 200 || sessionB.status === 201, `status ${sessionB.status}`)
    const foreignDetail = await request(`/customer/orders/${encodeURIComponent(orderNumber)}`, { token: b.token })
    pass('Foreign order detail rejected (404)', foreignDetail.status === 404, `status ${foreignDetail.status}`)
    const foreignPayments = await request('/customer/payments', { token: b.token })
    pass('Foreign payment list empty', foreignPayments.status === 200 && foreignPayments.body.payments.length === 0, `${foreignPayments.body.payments.length} rows`)
    const foreignReceipt = await request(`/customer/payments/${paymentId}/receipt-link`, { token: b.token, method: 'POST' })
    pass('Foreign receipt link rejected (404)', foreignReceipt.status === 404, `status ${foreignReceipt.status}`)
    const foreignCancel = await request(`/customer/orders/${encodeURIComponent(orderNumber)}/cancel`, { token: b.token, method: 'POST', body: {} })
    pass('Foreign customer cannot cancel (404)', foreignCancel.status === 404, `status ${foreignCancel.status}`)

    // Receipts are only issued once the payment is confirmed.
    const earlyLink = await request(`/customer/payments/${paymentId}/receipt-link`, { token: a.token, method: 'POST' })
    const earlyDownload = await request(`/customer/receipts/${paymentId}?format=pdf&token=${encodeURIComponent(earlyLink.body.token)}`)
    pass('Receipt withheld before payment confirmation (409)', earlyDownload.status === 409, `status ${earlyDownload.status}`)

    await db.execute("UPDATE payments SET status = 'captured', provider_payment_id = ?, confirmed_at = UTC_TIMESTAMP() WHERE id = ?", [`pay_phase1_${Date.now()}`, paymentId])
    await db.execute("UPDATE orders SET payment_status = 'paid' WHERE order_number = ?", [orderNumber])

    const paidPayments = await request('/customer/payments', { token: a.token })
    pass('Paid status reflected in history', paidPayments.body?.payments?.[0]?.status === 'captured', paidPayments.body?.payments?.[0]?.status)

    const receiptLink = await request(`/customer/payments/${paymentId}/receipt-link`, { token: a.token, method: 'POST' })
    pass('Receipt link issued', receiptLink.status === 200 && Boolean(receiptLink.body?.token), `status ${receiptLink.status}`)
    const pdf = await request(`/customer/receipts/${paymentId}?format=pdf&token=${encodeURIComponent(receiptLink.body.token)}`)
    pass('PDF receipt downloads as PDF', pdf.status === 200 && pdf.contentType.includes('application/pdf') && pdf.buffer.subarray(0, 4).toString() === '%PDF', `${pdf.status} ${pdf.contentType}`)
    pass('PDF receipt has content', pdf.buffer.length > 1000, `${pdf.buffer.length} bytes`)

    const html = await request(`/customer/receipts/${paymentId}?format=html&token=${encodeURIComponent(receiptLink.body.token)}`)
    const htmlText = html.buffer.toString('utf8')
    pass('HTML receipt downloads', html.status === 200 && html.contentType.includes('text/html'), `${html.status}`)
    pass('HTML receipt includes transaction and total', /pay_phase1_\d+/.test(htmlText) && htmlText.includes(orderNumber) && htmlText.includes('539.00'), `${/pay_phase1_\d+/.test(htmlText) ? 'txn-ok' : 'txn-missing'} ${htmlText.includes(orderNumber) ? 'order-ok' : 'order-missing (' + (htmlText.match(/Order:<\/strong>[^<]*/) || ['none'])[0] + ')'} ${htmlText.includes('539.00') ? 'total-ok' : 'total-missing'}`)

    const wrongId = await request(`/customer/receipts/${Number(paymentId) + 1}?format=pdf&token=${encodeURIComponent(receiptLink.body.token)}`)
    pass('Receipt token cannot be reused for another payment (403)', wrongId.status === 403, `status ${wrongId.status}`)
    const forged = signReceiptToken(paymentId, Number(userAId) + 1000, 'X')
    const forgedReceipt = await request(`/customer/receipts/${paymentId}?format=pdf&token=${encodeURIComponent(forged)}`)
    pass('Receipt token for another customer cannot read the file (404)', forgedReceipt.status === 404, `status ${forgedReceipt.status}`)

    // Cancellation rules: unpaid pending can cancel once, paid cannot.
    const cancelOrder = await request('/orders', {
      token: a.token,
      method: 'POST',
      body: orderBody('cancel', { fulfilment: 'pickup', items: [{ productId: 1, quantity: 1 }] }),
    })
    const cancelNumber = cancelOrder.body.order.orderNumber
    const cancel = await request(`/customer/orders/${encodeURIComponent(cancelNumber)}/cancel`, { token: a.token, method: 'POST', body: { reason: 'Verification test' } })
    pass('Unpaid pending order can be cancelled', cancel.status === 200 && cancel.body?.status === 'cancelled', `status ${cancel.status}`)
    const [cancelRows] = await db.execute('SELECT status, cancellation_reason, cancelled_at FROM orders WHERE order_number = ?', [cancelNumber])
    pass('Cancellation persisted in database', cancelRows[0].status === 'cancelled' && cancelRows[0].cancellation_reason === 'Verification test' && Boolean(cancelRows[0].cancelled_at), JSON.stringify(cancelRows[0]))
    const cancelAgain = await request(`/customer/orders/${encodeURIComponent(cancelNumber)}/cancel`, { token: a.token, method: 'POST', body: {} })
    pass('Second cancellation rejected (409)', cancelAgain.status === 409, `status ${cancelAgain.status}`)
    const paidCancel = await request(`/customer/orders/${encodeURIComponent(orderNumber)}/cancel`, { token: a.token, method: 'POST', body: {} })
    pass('Paid order cancellation blocked (409)', paidCancel.status === 409, `status ${paidCancel.status}`)

    // Guest checkout links to the verified identity with the same email.
    const guest = await request('/orders', {
      method: 'POST',
      body: orderBody('guest', { customer: { fullName: 'Guest Check', email: emailGuest, phone: '9876500001' } }),
    })
    const guestOrderNumber = guest.body.order.orderNumber
    const guestToken = makeToken(emailGuest, true)
    const link = await request('/auth/customer/session', { method: 'POST', body: { idToken: guestToken.token } })
    const [linkedUser] = await db.execute('SELECT id FROM users WHERE email = ?', [emailGuest])
    pass('Verified login links the earlier guest order', (link.status === 200 || link.status === 201) && Boolean(linkedUser.length), `status ${link.status}`)
    const linkedOrders = await request('/customer/orders', { token: guestToken.token })
    pass('Linked guest order visible after sign-in', linkedOrders.body?.orders?.some(item => item.orderNumber === guestOrderNumber))

    // An unverified sign-in must not claim a guest history by email; it is
    // rejected by the unique email key instead of taking over the account.
    const unverifiedEmail = `ff-unverified-${Date.now()}@example.com`
    emails.push(unverifiedEmail)
    const unverifiedGuest = await request('/orders', {
      method: 'POST',
      body: orderBody('unverified', { customer: { fullName: 'Unverified Guest', email: unverifiedEmail, phone: '9876500002' } }),
    })
    pass('Guest order for unverified email created', unverifiedGuest.status === 201, `status ${unverifiedGuest.status}`)
    const unverified = makeToken(unverifiedEmail, false)
    const blocked = await request('/auth/customer/session', {
      method: 'POST',
      body: { idToken: unverified.token, fullName: 'Unverified' },
    })
    pass('Unverified email cannot claim guest history (409)', blocked.status === 409, `status ${blocked.status}`)
  } finally {
    server.close()
    const [testUsers] = await db.query('SELECT id FROM users WHERE email IN (?)', [emails])
    const ids = testUsers.map(row => Number(row.id))
    if (ids.length) {
      const [testOrders] = await db.query('SELECT id FROM orders WHERE customer_id IN (?)', [ids])
      const orderIds = testOrders.map(row => Number(row.id))
      if (orderIds.length) {
        await db.query('DELETE FROM order_status_events WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM order_assignments WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM payments WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM order_items WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM orders WHERE id IN (?)', [orderIds])
      }
      await db.query('DELETE FROM addresses WHERE user_id IN (?)', [ids])
      await db.query('DELETE FROM users WHERE id IN (?)', [ids])
    }
    const [left] = await db.query('SELECT COUNT(*) AS c FROM users WHERE email IN (?)', [emails])
    pass('Test data fully cleaned up', Number(left[0].c) === 0, `${left[0].c} leftover users`)
    await db.end()
  }

  console.log(failures === 0 ? '\nAll Phase 1 checks passed.' : `\n${failures} Phase 1 check(s) failed.`)
  if (failures) process.exitCode = 1
}

main().catch(async error => {
  console.error('TEST ERROR', error)
  try { await db.end() } catch {}
  process.exit(1)
})
