/*
 * Temporary Phase 1 verification script. Creates a COD test order through the
 * public API, proves idempotency and auth rejection, then removes every test row.
 */
require('dotenv').config()
const db = require('../src/config/db')

const BASE = 'http://localhost:4000/api'

async function json(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body, headers: response.headers }
}

function pass(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!condition) process.exitCode = 1
}

async function main() {
  const email = `phase1-check-${Date.now()}@example.com`
  const clientOrderId = `phase1-${Date.now()}-check`
  const payload = {
    clientOrderId,
    customer: { fullName: 'Phase One Check', email, phone: '9876543210' },
    fulfilment: 'delivery',
    paymentMethod: 'cash_on_delivery',
    address: { recipientName: 'Phase One Check', phone: '9876543210', line1: '1 Test Lane', city: 'Bengaluru', postalCode: '560001' },
    items: [{ productId: 1, quantity: 2 }],
  }

  const first = await json('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  pass('Order created (201)', first.status === 201, `status ${first.status}`)
  pass('Order number format FF-YYYYMMDD-12HEX', /^FF-\d{8}-[0-9A-F]{12}$/.test(first.body?.order?.orderNumber || ''), first.body?.order?.orderNumber)
  pass('Server-computed total 539 (490 + 49 delivery)', first.body?.order?.total === 539, String(first.body?.order?.total))

  const second = await json('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  pass('Duplicate request returns 200', second.status === 200, `status ${second.status}`)
  pass('Duplicate returns same order number', second.body?.order?.orderNumber === first.body?.order?.orderNumber, second.body?.order?.orderNumber)
  pass('Duplicate flagged', second.body?.duplicate === true, String(second.body?.duplicate))

  const [orderRows] = await db.execute('SELECT id, order_number, client_order_id, total_estimated, payment_status FROM orders WHERE order_number = ?', [first.body.order.orderNumber])
  pass('Exactly one DB order for the clientOrderId', orderRows.length === 1, `${orderRows.length} rows`)
  const [dupRows] = await db.execute('SELECT COUNT(*) AS c FROM orders WHERE client_order_id = ?', [clientOrderId])
  pass('No duplicate orders in DB', Number(dupRows[0].c) === 1, `${dupRows[0].c} rows`)
  const [itemRows] = await db.execute('SELECT product_name_snapshot, requested_quantity, cost_snapshot FROM order_items WHERE order_id = ?', [orderRows[0].id])
  pass('Order items persisted', itemRows.length === 1 && Number(itemRows[0].requested_quantity) === 2, `${itemRows.length} rows`)
  const [payRows] = await db.execute("SELECT provider, status, amount FROM payments WHERE order_id = ?", [orderRows[0].id])
  pass('Payment record persisted', payRows.length === 1 && payRows[0].provider === 'cash_on_delivery', JSON.stringify(payRows))

  const noAuth = [
    ['/customer/me', 'GET'],
    ['/customer/orders', 'GET'],
    ['/customer/payments', 'GET'],
    ['/customer/receipts/1', 'GET'],
  ]
  for (const [path, method] of noAuth) {
    const result = await json(path, { method })
    pass(`${method} ${path} without auth rejected (401)`, result.status === 401, `status ${result.status}`)
  }

  const badToken = await json('/customer/me', { headers: { Authorization: 'Bearer not-a-real-token' } })
  pass('Invalid bearer token rejected (401)', badToken.status === 401, `status ${badToken.status}`)

  const invalidClientId = await json('/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, clientOrderId: 'bad id!' }),
  })
  pass('Malformed clientOrderId rejected (400)', invalidClientId.status === 400, `status ${invalidClientId.status}`)

  // Clean up only the rows this script created.
  const orderId = orderRows[0].id
  const [userRows] = await db.execute('SELECT customer_id FROM orders WHERE id = ?', [orderId])
  const customerId = userRows[0].customer_id
  await db.execute('DELETE FROM order_status_events WHERE order_id = ?', [orderId])
  await db.execute('DELETE FROM payments WHERE order_id = ?', [orderId])
  await db.execute('DELETE FROM order_items WHERE order_id = ?', [orderId])
  await db.execute('DELETE FROM orders WHERE id = ?', [orderId])
  await db.execute('DELETE FROM addresses WHERE user_id = ?', [customerId])
  const [remainingOrders] = await db.execute('SELECT COUNT(*) AS c FROM orders WHERE customer_id = ?', [customerId])
  if (Number(remainingOrders[0].c) === 0) await db.execute("DELETE FROM users WHERE id = ? AND firebase_uid LIKE 'guest:%'", [customerId])
  const [check] = await db.execute('SELECT COUNT(*) AS c FROM orders WHERE order_number = ?', [first.body.order.orderNumber])
  pass('Test data cleaned up', Number(check[0].c) === 0, `${check[0].c} leftover rows`)

  await db.end()
}

main().catch(async error => {
  console.error('TEST ERROR', error)
  try { await db.end() } catch {}
  process.exit(1)
})
