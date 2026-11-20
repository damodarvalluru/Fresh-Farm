/*
 * Temporary concurrency verification for checkout.
 *
 * Fires simultaneous order requests at the real Express app (in-process) and
 * proves that duplicate client references create exactly one order, unique
 * requests never collide on order numbers, and concurrent guest upserts create
 * a single customer. Every created row is removed afterwards.
 */
require('dotenv').config()
const { once } = require('node:events')
const { randomBytes } = require('node:crypto')
const db = require('../src/config/db')
const app = require('../src/app')

let BASE = ''
let failures = 0
function pass(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures += 1
}

async function place(body) {
  const response = await fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => null)
  return { status: response.status, body: json }
}

function payload(email, clientOrderId, quantity = 1) {
  return {
    clientOrderId,
    customer: { fullName: 'Concurrency Check', email, phone: '9800011122' },
    fulfilment: 'delivery',
    paymentMethod: 'cash_on_delivery',
    address: { recipientName: 'Concurrency Check', phone: '9800011122', line1: '5 Race Lane', city: 'Bengaluru', postalCode: '560005' },
    items: [{ productId: 1, quantity }],
  }
}

async function main() {
  const server = app.listen(0)
  await once(server, 'listening')
  BASE = `http://127.0.0.1:${server.address().port}`

  const stamp = Date.now()
  const duplicateEmail = `ff-race-dup-${stamp}@example.com`
  const uniqueEmail = `ff-race-unique-${stamp}@example.com`
  const sharedEmail = `ff-race-shared-${stamp}@example.com`
  const emails = [duplicateEmail, uniqueEmail, sharedEmail]
  const clientOrderId = `race-dup-${stamp}-${randomBytes(3).toString('hex')}`

  try {
    // 1. Ten simultaneous submissions of the same checkout reference.
    const duplicateResults = await Promise.all(
      Array.from({ length: 10 }, () => place(payload(duplicateEmail, clientOrderId, 2))),
    )
    const created = duplicateResults.filter(result => result.status === 201)
    const replays = duplicateResults.filter(result => result.status === 200 && result.body?.duplicate === true)
    const serverErrors = duplicateResults.filter(result => result.status >= 500)
    pass('Duplicate race: every request succeeds (201 or 200)', serverErrors.length === 0, `${serverErrors.length} server errors`)
    pass('Duplicate race: exactly one request creates the order', created.length === 1, `${created.length} created, ${replays.length} replayed`)
    const duplicateNumbers = new Set(duplicateResults.map(result => result.body?.order?.orderNumber).filter(Boolean))
    pass('Duplicate race: all responses carry the same order number', duplicateNumbers.size === 1, `${duplicateNumbers.size} distinct numbers`)

    const [duplicateRows] = await db.execute('SELECT id, order_number, customer_id FROM orders WHERE client_order_id = ?', [clientOrderId])
    pass('Duplicate race: one order row in the database', duplicateRows.length === 1, `${duplicateRows.length} rows`)
    const [customerRows] = await db.execute('SELECT id FROM users WHERE email = ?', [duplicateEmail])
    pass('Duplicate race: one customer row for the email', customerRows.length === 1, `${customerRows.length} rows`)
    const [duplicateItems] = await db.execute('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?', [duplicateRows[0]?.id])
    pass('Duplicate race: order items stored once', Number(duplicateItems[0].c) === 1, `${duplicateItems[0].c} rows`)

    // 2. Ten distinct checkouts at once must all get different order numbers.
    const uniqueResults = await Promise.all(
      Array.from({ length: 10 }, (_, index) => place(payload(uniqueEmail, `race-unique-${stamp}-${index}`))),
    )
    pass('Unique race: all ten orders created', uniqueResults.every(result => result.status === 201), uniqueResults.map(result => result.status).join(','))
    const orderNumbers = uniqueResults.map(result => result.body?.order?.orderNumber)
    pass('Unique race: order numbers are unique', new Set(orderNumbers).size === 10, `${new Set(orderNumbers).size} distinct of ${orderNumbers.length}`)
    pass('Unique race: order number format holds', orderNumbers.every(number => /^FF-\d{8}-[0-9A-F]{12}$/.test(number || '')), orderNumbers[0])
    const [uniqueRows] = await db.query('SELECT COUNT(*) AS c FROM orders WHERE order_number IN (?)', [orderNumbers])
    pass('Unique race: ten order rows persisted', Number(uniqueRows[0].c) === 10, `${uniqueRows[0].c} rows`)
    const [uniqueUsers] = await db.execute('SELECT COUNT(*) AS c FROM users WHERE email = ?', [uniqueEmail])
    pass('Unique race: concurrent guest upsert creates one customer', Number(uniqueUsers[0].c) === 1, `${uniqueUsers[0].c} rows`)
    const [uniqueItems] = await db.query('SELECT COUNT(*) AS c FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE order_number IN (?))', [orderNumbers])
    pass('Unique race: every order has its item row', Number(uniqueItems[0].c) === 10, `${uniqueItems[0].c} rows`)

    // 3. Mixed traffic: a duplicate reference racing a brand-new reference.
    const mixedEmail = sharedEmail
    const sharedReference = `race-shared-${stamp}`
    const mixed = await Promise.all([
      ...Array.from({ length: 5 }, () => place(payload(mixedEmail, sharedReference))),
      ...Array.from({ length: 5 }, (_, index) => place(payload(mixedEmail, `race-mixed-${stamp}-${index}`))),
    ])
    pass('Mixed race: no request fails', mixed.every(result => result.status < 500), mixed.map(result => result.status).join(','))
    const [sharedRows] = await db.execute('SELECT COUNT(*) AS c FROM orders WHERE client_order_id = ?', [sharedReference])
    pass('Mixed race: shared reference created once', Number(sharedRows[0].c) === 1, `${sharedRows[0].c} rows`)
    const [mixedRows] = await db.execute('SELECT COUNT(*) AS c FROM orders WHERE customer_id = (SELECT id FROM users WHERE email = ?)', [mixedEmail])
    pass('Mixed race: six orders recorded for the customer', Number(mixedRows[0].c) === 6, `${mixedRows[0].c} rows`)

    const [paymentRows] = await db.query(
      'SELECT COUNT(*) AS c FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN (SELECT id FROM users WHERE email IN (?)))',
      [emails],
    )
    pass('Concurrency: one payment per order', Number(paymentRows[0].c) === 17, `${paymentRows[0].c} payments`)
  } finally {
    server.close()
    const [users] = await db.query('SELECT id FROM users WHERE email IN (?)', [emails])
    const userIds = users.map(row => Number(row.id))
    if (userIds.length) {
      const [orders] = await db.query('SELECT id FROM orders WHERE customer_id IN (?)', [userIds])
      const orderIds = orders.map(row => Number(row.id))
      if (orderIds.length) {
        await db.query('DELETE FROM order_status_events WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM order_assignments WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM payments WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM order_items WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM orders WHERE id IN (?)', [orderIds])
      }
      await db.query('DELETE FROM addresses WHERE user_id IN (?)', [userIds])
      await db.query('DELETE FROM users WHERE id IN (?)', [userIds])
    }
    const [leftOrders] = await db.query('SELECT COUNT(*) AS c FROM orders WHERE customer_id IN (SELECT id FROM users WHERE email IN (?))', [emails])
    const [leftUsers] = await db.query('SELECT COUNT(*) AS c FROM users WHERE email IN (?)', [emails])
    pass('Concurrency test data cleaned up', Number(leftOrders[0].c) === 0 && Number(leftUsers[0].c) === 0, `${leftUsers[0].c} users, ${leftOrders[0].c} orders`)
    await db.end()
  }

  console.log(failures === 0 ? '\nAll concurrency checks passed.' : `\n${failures} concurrency check(s) failed.`)
  if (failures) process.exitCode = 1
}

main().catch(async error => {
  console.error('TEST ERROR', error)
  try { await db.end() } catch { /* pool already closed */ }
  process.exit(1)
})
