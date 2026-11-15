const express = require('express')
const { rateLimit } = require('express-rate-limit')
const { createHash, randomBytes } = require('node:crypto')
const db = require('../config/db')
const razorpay = require('../services/razorpay')
const { optionalCustomer } = require('../middleware/require-customer')
const { notifyOrderPlaced } = require('../services/notify')
const { reserveStock } = require('../services/inventory')

const router = express.Router()
const orderLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many order attempts. Please try again in a few minutes.' } })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CLIENT_ORDER_ID = /^[A-Za-z0-9_-]{8,80}$/
const MAX_QUANTITY = 50

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

/**
 * Order numbers combine the UTC order date with 48 bits of cryptographic
 * randomness. The database UNIQUE index on orders.order_number is the final
 * authority: if two simultaneous requests ever collide, the insert retries
 * with a brand-new number instead of reusing the existing record.
 */
function newOrderNumber() {
  const date = new Date()
  const stamp = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('')
  return `FF-${stamp}-${randomBytes(6).toString('hex').toUpperCase()}`
}

function parseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 30) return null
  const merged = new Map()
  for (const item of rawItems) {
    const productId = Number(item?.productId)
    const quantity = Number(item?.quantity)
    if (!Number.isInteger(productId) || productId <= 0) return null
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) return null
    merged.set(productId, round((merged.get(productId) || 0) + quantity))
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }))
}

async function loadOrderForPayment(orderNumber) {
  const [rows] = await db.execute(`
    SELECT o.id, o.order_number, o.total_estimated, o.payment_status, o.customer_notes,
           u.email, u.full_name, u.phone,
           p.id AS payment_id
    FROM orders o
    JOIN users u ON u.id = o.customer_id
    LEFT JOIN payments p ON p.order_id = o.id AND p.provider = 'razorpay'
    WHERE o.order_number = ? LIMIT 1
  `, [orderNumber])
  return rows[0] || null
}

async function loadExistingIdempotentOrder(customerId, clientOrderId) {
  const [rows] = await db.execute(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_method, o.total_estimated,
            p.id AS payment_id, p.provider
     FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.customer_id = ? AND o.client_order_id = ? LIMIT 1`,
    [customerId, clientOrderId],
  )
  return rows[0] || null
}

async function loadOrderItems(orderId) {
  const [items] = await db.execute(
    'SELECT product_name_snapshot, requested_quantity, unit_snapshot, estimated_line_total FROM order_items WHERE order_id = ? ORDER BY id',
    [orderId],
  )
  return items.map(item => ({
    name: item.product_name_snapshot,
    quantity: Number(item.requested_quantity),
    unit: item.unit_snapshot,
    lineTotal: Number(item.estimated_line_total),
  }))
}

async function startRazorpayPayment(order) {
  const gatewayOrder = await razorpay.createOrder({
    amount: Math.round(Number(order.total_estimated) * 100),
    receipt: order.order_number,
    notes: { orderNumber: order.order_number, customerEmail: order.email },
  })
  await db.execute('UPDATE payments SET provider_order_id = ?, provider_reference = ?, status = ? WHERE id = ?', [gatewayOrder.id, gatewayOrder.id, 'pending', order.payment_id])
  return {
    provider: 'razorpay',
    keyId: process.env.RAZORPAY_KEY_ID,
    razorpayOrderId: gatewayOrder.id,
    amount: Number(gatewayOrder.amount),
    currency: gatewayOrder.currency,
    orderNumber: order.order_number,
    customer: { name: order.full_name, email: order.email, contact: order.phone || undefined },
  }
}

async function respondWithExistingOrder(res, existing, email) {
  const items = await loadOrderItems(existing.id)
  const order = {
    orderNumber: existing.order_number,
    status: existing.status,
    paymentMethod: existing.payment_method,
    paymentStatus: existing.payment_status,
    total: Number(existing.total_estimated),
    email,
    items,
    duplicate: true,
  }
  if (existing.payment_method === 'online' && existing.payment_status !== 'paid' && existing.payment_id && razorpay.isConfigured()) {
    try {
      const payment = await startRazorpayPayment({
        id: existing.id,
        order_number: existing.order_number,
        total_estimated: Number(existing.total_estimated),
        email,
        full_name: '',
        phone: '',
        payment_id: existing.payment_id,
      })
      return res.status(200).json({ order, payment, duplicate: true })
    } catch (error) {
      if (error.status === 503) return res.status(200).json({ order, payment: null, paymentUnavailable: true, duplicate: true })
      return res.status(200).json({ order, payment: null, duplicate: true })
    }
  }
  return res.status(200).json({ order, payment: null, duplicate: true })
}

router.post('/', orderLimit, optionalCustomer, async (req, res, next) => {
  let connection
  try {
    const body = req.body || {}
    const items = parseItems(body.items)
    if (!items) return res.status(400).json({ error: 'Add at least one valid product to the bag.' })

    const clientOrderId = text(body.clientOrderId, 80) || null
    if (clientOrderId && !CLIENT_ORDER_ID.test(clientOrderId)) return res.status(400).json({ error: 'The checkout reference is not valid. Refresh the page and try again.' })

    const authenticatedCustomer = req.customer || null
    const email = authenticatedCustomer ? String(authenticatedCustomer.email).toLowerCase() : text(body.customer?.email, 254).toLowerCase()
    const fullName = authenticatedCustomer ? String(authenticatedCustomer.full_name).slice(0, 160) : text(body.customer?.fullName, 160)
    const phone = text(body.customer?.phone, 32) || (authenticatedCustomer?.phone ? String(authenticatedCustomer.phone) : '')
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' })
    if (fullName.length < 2) return res.status(400).json({ error: 'Enter the name for this order.' })

    const fulfilment = body.fulfilment === 'pickup' ? 'pickup' : 'delivery'
    const paymentMethod = body.paymentMethod === 'online' ? 'online' : 'cash_on_delivery'
    const notes = text(body.notes, 1000) || null

    const addressInput = body.address || {}
    let address = null
    if (fulfilment === 'delivery') {
      address = {
        recipientName: text(addressInput.recipientName, 160) || fullName,
        phone: text(addressInput.phone, 32) || phone,
        line1: text(addressInput.line1, 255),
        line2: text(addressInput.line2, 255) || null,
        landmark: text(addressInput.landmark, 160) || null,
        city: text(addressInput.city, 120),
        postalCode: text(addressInput.postalCode, 20),
        instructions: text(addressInput.instructions, 500) || null,
      }
      if (!address.line1 || !address.city || !address.postalCode || !address.phone) {
        return res.status(400).json({ error: 'Enter a delivery address, phone number, city and postal code.' })
      }
    }

    const placeholders = items.map(() => '?').join(',')
    const [products] = await db.query(`SELECT id, name, selling_unit, price, cost_price FROM products WHERE id IN (${placeholders}) AND is_active = 1 AND is_available = 1`, items.map(item => item.productId))
    if (products.length !== items.length) return res.status(409).json({ error: 'One or more products are no longer available. Refresh the shop and try again.' })

    const lines = items.map(item => {
      const product = products.find(row => Number(row.id) === item.productId)
      const price = Number(product.price)
      return {
        productId: product.id,
        name: product.name,
        unit: product.selling_unit,
        price,
        cost: Number(product.cost_price || 0),
        quantity: item.quantity,
        lineTotal: round(price * item.quantity),
      }
    })
    const subtotal = round(lines.reduce((sum, line) => sum + line.lineTotal, 0))
    const [settings] = await db.query("SELECT setting_value FROM shop_settings WHERE setting_key = 'store' LIMIT 1")
    const store = settings[0]?.setting_value || {}
    const freeAbove = Number(store.freeDeliveryAbove ?? 999)
    const fee = Number(store.deliveryFee ?? 49)
    const deliveryFee = fulfilment === 'pickup' || subtotal >= freeAbove ? 0 : fee
    const total = round(subtotal + deliveryFee)

    connection = await db.getConnection()
    await connection.beginTransaction()

    let customerId
    if (authenticatedCustomer) {
      customerId = authenticatedCustomer.id
      await connection.execute(
        "UPDATE users SET full_name = COALESCE(NULLIF(?, ''), full_name), phone = COALESCE(NULLIF(?, ''), phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [fullName, phone, customerId],
      )
    } else {
      const guestUid = `guest:${createHash('sha256').update(email).digest('hex').slice(0, 40)}`
      // Atomic upsert: concurrent guest checkouts for the same email reuse the
      // same customer row instead of failing on the unique email key. The role
      // is looked up in a subquery so the insert column list stays unambiguous.
      const [created] = await connection.execute(
        `INSERT INTO users (firebase_uid, email, full_name, phone, role_id)
         VALUES (?, ?, ?, ?, (SELECT id FROM roles WHERE name = 'CUSTOMER' LIMIT 1))
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id),
           full_name = COALESCE(NULLIF(VALUES(full_name), ''), full_name),
           phone = COALESCE(NULLIF(VALUES(phone), ''), phone)`,
        [guestUid, email, fullName, phone || null],
      )
      customerId = created.insertId
    }

    if (clientOrderId) {
      const existing = await loadExistingIdempotentOrder(customerId, clientOrderId)
      if (existing) {
        await connection.commit()
        return await respondWithExistingOrder(res, existing, email)
      }
    }

    // Reserve stock before the order row exists. The update and the inserts
    // share this transaction, so a failed checkout never loses stock.
    await reserveStock(connection, lines)

    let addressId = null
    if (address) {
      const [createdAddress] = await connection.execute(
        'INSERT INTO addresses (user_id, recipient_name, phone, line1, line2, landmark, city, postal_code, delivery_instructions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [customerId, address.recipientName, address.phone, address.line1, address.line2, address.landmark, address.city, address.postalCode, address.instructions],
      )
      addressId = createdAddress.insertId
    }

    let orderNumber = newOrderNumber()
    let orderId = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const [createdOrder] = await connection.execute(
          `INSERT INTO orders (order_number, client_order_id, customer_id, address_id, fulfilment, status, payment_method, payment_status, subtotal_estimated, delivery_fee, discount_amount, total_estimated, customer_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [orderNumber, clientOrderId, customerId, addressId, fulfilment, 'pending', paymentMethod, 'pending', subtotal, deliveryFee, 0, total, notes],
        )
        orderId = createdOrder.insertId
        break
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY' && clientOrderId) {
          const existing = await loadExistingIdempotentOrder(customerId, clientOrderId)
          if (existing) {
            await connection.commit()
            return await respondWithExistingOrder(res, existing, email)
          }
        }
        if (error.code === 'ER_DUP_ENTRY' && attempt < 4) {
          orderNumber = newOrderNumber()
          continue
        }
        throw error
      }
    }
    if (!orderId) throw new Error('Could not allocate a unique order number.')

    const itemSql = lines.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(',')
    const itemParams = lines.flatMap(line => [
      orderId, line.productId, line.name, line.unit, line.price, line.cost, line.quantity, line.lineTotal,
    ])
    await connection.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_snapshot, price_snapshot, cost_snapshot, requested_quantity, estimated_line_total) VALUES ${itemSql}`,
      itemParams,
    )

    const [paymentResult] = await connection.execute(
      'INSERT INTO payments (order_id, provider, amount, currency, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      [orderId, paymentMethod === 'online' ? 'razorpay' : 'cash_on_delivery', total, 'INR', 'pending', `order:${orderNumber}`],
    )
    await connection.execute('INSERT INTO order_status_events (order_id, status, note) VALUES (?, ?, ?)', [orderId, 'pending', 'Order created from the website.'])

    await connection.commit()

    const order = {
      orderNumber, status: 'pending', paymentMethod, paymentStatus: 'pending',
      subtotal, deliveryFee, total, email, phone, customerName: fullName,
      items: lines.map(line => ({ name: line.name, quantity: line.quantity, lineTotal: line.lineTotal })),
    }

    if (paymentMethod === 'online') {
      try {
        const payment = await startRazorpayPayment({
          id: orderId, order_number: orderNumber, total_estimated: total,
          email, full_name: fullName, phone, payment_id: paymentResult.insertId,
        })
        return res.status(201).json({ order, payment })
      } catch (error) {
        if (error.status === 503) {
          return res.status(201).json({ order, payment: null, paymentUnavailable: true })
        }
        return res.status(502).json({ error: 'Your order was saved but the payment could not be started. Please retry payment from your dashboard.', orderNumber })
      }
    }

    void notifyOrderPlaced({ ...order, paymentStatus: 'pending' })
    return res.status(201).json({ order, payment: null })
  } catch (error) {
    if (connection) {
      try { await connection.rollback() } catch { /* transaction may already be closed */ }
    }
    next(error)
  } finally {
    if (connection) connection.release()
  }
})

router.post('/:orderNumber/payment', orderLimit, async (req, res, next) => {
  try {
    const orderNumber = text(req.params.orderNumber, 32)
    const order = await loadOrderForPayment(orderNumber)
    if (!order) return res.status(404).json({ error: 'Order not found.' })
    const email = text(req.body?.email, 254).toLowerCase()
    if (email !== String(order.email).toLowerCase()) return res.status(403).json({ error: 'The email does not match this order.' })
    if (order.payment_status === 'paid') return res.status(409).json({ error: 'This order is already paid.' })
    if (!razorpay.isConfigured()) return res.status(503).json({ error: 'Online payments are not configured yet.' })
    const payment = await startRazorpayPayment(order)
    return res.json({ payment })
  } catch (error) { next(error) }
})

router.get('/:orderNumber', orderLimit, async (req, res, next) => {
  try {
    const email = text(req.query.email, 254).toLowerCase()
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Provide the email used for this order.' })
    const [orders] = await db.execute(`
      SELECT o.order_number, o.status, o.payment_method, o.payment_status, o.fulfilment,
             o.subtotal_estimated, o.delivery_fee, o.total_estimated, o.customer_notes, o.created_at,
             u.full_name, u.email, u.phone,
             a.recipient_name, a.line1, a.line2, a.landmark, a.city, a.postal_code
      FROM orders o
      JOIN users u ON u.id = o.customer_id
      LEFT JOIN addresses a ON a.id = o.address_id
      WHERE o.order_number = ? LIMIT 1
    `, [text(req.params.orderNumber, 32)])
    const order = orders[0]
    if (!order || String(order.email).toLowerCase() !== email) return res.status(404).json({ error: 'Order not found.' })
    const [items] = await db.execute('SELECT product_name_snapshot, unit_snapshot, price_snapshot, requested_quantity, estimated_line_total FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_number = ? LIMIT 1)', [order.order_number])
    res.json({
      order: {
        orderNumber: order.order_number,
        status: order.status,
        paymentMethod: order.payment_method,
        paymentStatus: order.payment_status,
        fulfilment: order.fulfilment,
        subtotal: Number(order.subtotal_estimated),
        deliveryFee: Number(order.delivery_fee),
        total: Number(order.total_estimated),
        notes: order.customer_notes,
        createdAt: order.created_at,
        customer: { name: order.full_name, email: order.email, phone: order.phone },
        address: order.line1 ? { recipientName: order.recipient_name, line1: order.line1, line2: order.line2, landmark: order.landmark, city: order.city, postalCode: order.postal_code } : null,
        items: items.map(item => ({
          name: item.product_name_snapshot,
          unit: item.unit_snapshot,
          price: Number(item.price_snapshot),
          quantity: Number(item.requested_quantity),
          lineTotal: Number(item.estimated_line_total),
        })),
      },
    })
  } catch (error) { next(error) }
})

module.exports = router
