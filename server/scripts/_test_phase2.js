/*
 * Temporary Phase 2 end-to-end stock verification.
 *
 * Runs the real Express app in-process on an ephemeral port. Only Firebase
 * signature verification is replaced, so customer cancellation and every stock
 * movement uses the production routes and SQL. All test rows are removed at
 * the end.
 */
require('dotenv').config()
process.env.RESEND_API_KEY = ''
process.env.TWILIO_SID = ''
process.env.TWILIO_AUTH_TOKEN = ''

const { once } = require('node:events')
const { randomBytes } = require('node:crypto')
const argon2 = require('argon2')

const TOKENS = new Map()
function makeToken(email) {
  const token = `phase2-token-${Date.now()}-${randomBytes(6).toString('hex')}`
  TOKENS.set(token, { uid: `phase2-uid-${Date.now()}-${randomBytes(3).toString('hex')}`, email, email_verified: true })
  return token
}
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

const db = require('../src/config/db')
const app = require('../src/app')

let BASE = ''
let failures = 0
const createdEmails = []
function pass(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures += 1
}

async function request(path, { token, cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let parsed = text
  try { parsed = JSON.parse(text) } catch { /* non-JSON response */ }
  return { status: response.status, body: parsed, setCookie: response.headers.get('set-cookie') }
}

async function stockOf(productId) {
  const [rows] = await db.execute('SELECT available_quantity FROM inventory WHERE product_id = ? LIMIT 1', [productId])
  return rows.length ? Number(rows[0].available_quantity) : null
}

function orderBody(suffix, productId, quantity, extra = {}) {
  return {
    clientOrderId: `phase2-${suffix}-${Date.now()}-${randomBytes(3).toString('hex')}`,
    customer: { fullName: 'Phase Two Check', email: `phase2-${suffix}-${Date.now()}@example.com`, phone: '9876500000' },
    fulfilment: 'pickup',
    paymentMethod: 'cash_on_delivery',
    items: [{ productId, quantity }],
    ...extra,
  }
}

async function main() {
  const server = app.listen(0)
  await once(server, 'listening')
  BASE = `http://127.0.0.1:${server.address().port}/api`

  const [[rohu]] = await db.execute("SELECT id, name FROM products WHERE slug = 'live-rohu' LIMIT 1")
  const [[chicken]] = await db.execute("SELECT id, name FROM products WHERE slug = 'farm-fresh-whole-chicken' LIMIT 1")
  const [[adminRole]] = await db.execute("SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1")
  const fishId = Number(rohu.id)
  const chickenId = Number(chicken.id)
  const fishStart = await stockOf(fishId)
  const chickenStart = await stockOf(chickenId)
  let adminPassword = ''

  const adminEmail = `phase2-admin-${Date.now()}@example.com`
  const customerEmail = `phase2-customer-${Date.now()}@example.com`
  createdEmails.push(adminEmail, customerEmail)
  let adminUserId = null
  let adminId = null
  let customerToken = null

  try {
    // --- catalogue ---------------------------------------------------------
    const catalogue = await request('/products')
    const products = catalogue.body?.products || []
    const fishProducts = products.filter(product => product.section === 'fish')
    const chickenProducts = products.filter(product => product.section === 'chicken')
    pass('Products API returns both sections', catalogue.status === 200 && chickenProducts.length === 6 && fishProducts.length === 7, `chicken ${chickenProducts.length}, fish ${fishProducts.length}`)
    pass('Every fish product is raw/live/fresh catalogue data', fishProducts.every(product => product.availableQuantity !== undefined && product.unit === 'kg'), fishProducts.map(product => product.name).join(', '))
    const apiRohu = products.find(product => product.id === fishId)
    pass('Products API exposes live stock', apiRohu?.availableQuantity === fishStart, `${apiRohu?.availableQuantity} vs ${fishStart}`)

    // --- oversell guard ----------------------------------------------------
    const oversellBody = orderBody('oversell', fishId, Math.min(50, fishStart + 5))
    createdEmails.push(oversellBody.customer.email)
    const oversell = await request('/orders', { method: 'POST', body: oversellBody })
    pass('Order above available stock is rejected (409)', oversell.status === 409, `status ${oversell.status}`)
    pass('Oversell rejection explains remaining stock', /left in stock/i.test(String(oversell.body?.error || '')), oversell.body?.error)
    pass('Rejected checkout leaves fish stock unchanged', (await stockOf(fishId)) === fishStart, `${await stockOf(fishId)} vs ${fishStart}`)
    const [oversellOrders] = await db.execute('SELECT COUNT(*) AS count FROM orders WHERE client_order_id = ?', [oversellBody.clientOrderId])
    pass('Rejected checkout creates no order row', Number(oversellOrders[0].count) === 0, String(oversellOrders[0].count))

    // --- mixed chicken + fish order ---------------------------------------
    const mixed = orderBody('mixed', fishId, 2)
    mixed.items.push({ productId: chickenId, quantity: 1 })
    createdEmails.push(mixed.customer.email)
    const created = await request('/orders', { method: 'POST', body: mixed })
    pass('Mixed chicken + fish order is created (201)', created.status === 201, `status ${created.status}`)
    const mixedNumber = created.body?.order?.orderNumber
    pass('Order returns both line items', created.body?.order?.items?.length === 2, JSON.stringify(created.body?.order?.items))
    pass('Fish stock decremented by ordered quantity', (await stockOf(fishId)) === fishStart - 2, `${await stockOf(fishId)} vs ${fishStart - 2}`)
    pass('Chicken stock decremented by ordered quantity', (await stockOf(chickenId)) === chickenStart - 1, `${await stockOf(chickenId)} vs ${chickenStart - 1}`)

    const duplicate = await request('/orders', { method: 'POST', body: mixed })
    pass('Idempotent retry returns the same order (200)', duplicate.status === 200 && duplicate.body?.duplicate === true && duplicate.body?.order?.orderNumber === mixedNumber, `status ${duplicate.status}`)
    pass('Idempotent retry does not decrement stock again', (await stockOf(fishId)) === fishStart - 2, String(await stockOf(fishId)))

    // --- temporary admin session ------------------------------------------
    const [adminUser] = await db.execute(
      "INSERT INTO users (firebase_uid, email, full_name, role_id, is_active) VALUES (?, ?, ?, ?, 1)",
      [`phase2-admin:${adminEmail}`, adminEmail, 'Phase Two Admin', adminRole.id],
    )
    adminUserId = adminUser.insertId
    adminPassword = `Phase2-Stock-${randomBytes(4).toString('hex')}`
    const [adminRow] = await db.execute(
      'INSERT INTO admins (user_id, role_id, password_hash, password_updated_at, is_active) VALUES (?, ?, ?, UTC_TIMESTAMP(), 1)',
      [adminUserId, adminRole.id, await argon2.hash(adminPassword, { type: argon2.argon2id })],
    )
    adminId = adminRow.insertId
    const adminLogin = await request('/auth/admin/password-login', { method: 'POST', body: { email: adminEmail, password: adminPassword } })
    const adminCookie = String(adminLogin.setCookie || '').split(';')[0]
    pass('Temporary admin can sign in', adminLogin.status === 200 && adminCookie.startsWith('ff-admin='), `status ${adminLogin.status}`)

    // --- admin cancellation restores stock ---------------------------------
    const cancel = await request(`/admin/orders/${encodeURIComponent(mixedNumber)}/status`, { cookie: adminCookie, method: 'PATCH', body: { status: 'cancelled', note: 'Phase 2 stock test' } })
    pass('Admin can cancel a pending order', cancel.status === 200, `status ${cancel.status}`)
    pass('Fish stock restored on cancellation', (await stockOf(fishId)) === fishStart, `${await stockOf(fishId)} vs ${fishStart}`)
    pass('Chicken stock restored on cancellation', (await stockOf(chickenId)) === chickenStart, `${await stockOf(chickenId)} vs ${chickenStart}`)

    const repeatCancel = await request(`/admin/orders/${encodeURIComponent(mixedNumber)}/status`, { cookie: adminCookie, method: 'PATCH', body: { status: 'cancelled' } })
    pass('Cancelling twice is rejected (409)', repeatCancel.status === 409, `status ${repeatCancel.status}`)
    pass('Repeated cancellation does not double-restore stock', (await stockOf(fishId)) === fishStart, String(await stockOf(fishId)))

    // --- customer cancellation restores stock ------------------------------
    customerToken = makeToken(customerEmail)
    const customerSession = await request('/auth/customer/session', { method: 'POST', body: { idToken: customerToken, fullName: 'Phase Two Customer', phone: '9000000009' } })
    pass('Customer session created for stock check', customerSession.status === 200 || customerSession.status === 201, `status ${customerSession.status}`)
    const customerOrderBody = orderBody('customer', fishId, 3)
    const customerOrder = await request('/orders', { token: customerToken, method: 'POST', body: customerOrderBody })
    pass('Signed-in customer can order fish (201)', customerOrder.status === 201, `status ${customerOrder.status}`)
    const customerOrderNumber = customerOrder.body?.order?.orderNumber
    pass('Fish stock decremented for customer order', (await stockOf(fishId)) === fishStart - 3, `${await stockOf(fishId)} vs ${fishStart - 3}`)
    const customerCancel = await request(`/customer/orders/${encodeURIComponent(customerOrderNumber)}/cancel`, { token: customerToken, method: 'POST', body: { reason: 'Phase 2 customer cancel test' } })
    pass('Customer can cancel their pending order', customerCancel.status === 200, `status ${customerCancel.status}`)
    pass('Fish stock restored on customer cancellation', (await stockOf(fishId)) === fishStart, `${await stockOf(fishId)} vs ${fishStart}`)

    // --- admin rejection restores stock ------------------------------------
    const rejectBody = orderBody('reject', fishId, 2)
    createdEmails.push(rejectBody.customer.email)
    const rejectOrder = await request('/orders', { method: 'POST', body: rejectBody })
    pass('Second fish order created for rejection check', rejectOrder.status === 201, `status ${rejectOrder.status}`)
    const rejectNumber = rejectOrder.body?.order?.orderNumber
    pass('Fish stock decremented before rejection', (await stockOf(fishId)) === fishStart - 2, String(await stockOf(fishId)))
    const reject = await request(`/admin/orders/${encodeURIComponent(rejectNumber)}/status`, { cookie: adminCookie, method: 'PATCH', body: { status: 'rejected', note: 'Phase 2 stock test' } })
    pass('Admin can reject a pending order', reject.status === 200, `status ${reject.status}`)
    pass('Fish stock restored on rejection', (await stockOf(fishId)) === fishStart, `${await stockOf(fishId)} vs ${fishStart}`)

    // --- catalogue matches stock again -------------------------------------
    const after = await request('/products')
    const afterRohu = after.body?.products?.find(product => product.id === fishId)
    const afterChicken = after.body?.products?.find(product => product.id === chickenId)
    pass('Products API reflects restored fish stock', afterRohu?.availableQuantity === fishStart, `${afterRohu?.availableQuantity} vs ${fishStart}`)
    pass('Products API reflects restored chicken stock', afterChicken?.availableQuantity === chickenStart, `${afterChicken?.availableQuantity} vs ${chickenStart}`)
    pass('All inventory movements net to the starting values', (await stockOf(fishId)) === fishStart && (await stockOf(chickenId)) === chickenStart, `${await stockOf(fishId)} / ${await stockOf(chickenId)}`)
  } finally {
    // --- cleanup -----------------------------------------------------------
    try {
      const placeholders = createdEmails.map(() => '?').join(',')
      const [users] = await db.execute(`SELECT id FROM users WHERE email IN (${placeholders})`, createdEmails)
      const userIds = users.map(row => Number(row.id))
      if (userIds.length) {
        const userPlaceholders = userIds.map(() => '?').join(',')
        const [orders] = await db.execute(`SELECT id FROM orders WHERE customer_id IN (${userPlaceholders})`, userIds)
        const orderIds = orders.map(row => Number(row.id))
        if (orderIds.length) {
          const orderPlaceholders = orderIds.map(() => '?').join(',')
          await db.execute(`DELETE FROM payments WHERE order_id IN (${orderPlaceholders})`, orderIds)
          await db.execute(`DELETE FROM reviews WHERE order_id IN (${orderPlaceholders})`, orderIds)
          await db.execute(`DELETE FROM orders WHERE id IN (${orderPlaceholders})`, orderIds)
        }
        if (adminId) await db.execute('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId])
        if (adminId) await db.execute('DELETE FROM admins WHERE id = ?', [adminId])
        await db.execute(`DELETE FROM users WHERE id IN (${userPlaceholders})`, userIds)
      }
      const [remaining] = await db.execute("SELECT COUNT(*) AS count FROM users WHERE email LIKE 'phase2-%@example.com'")
      pass('Temporary Phase 2 users removed', Number(remaining[0].count) === 0, String(remaining[0].count))
    } catch (error) {
      console.error('Cleanup failed:', error.message)
      failures += 1
    }
    server.close()
    await db.end()
  }

  console.log(failures === 0 ? '\nALL PHASE 2 STOCK CHECKS PASSED' : `\n${failures} PHASE 2 STOCK CHECK(S) FAILED`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch(error => {
  console.error(error)
  db.end().finally(() => process.exit(1))
})
