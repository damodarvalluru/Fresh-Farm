const express = require('express')
const db = require('../config/db')
const { requireCustomer, requireReceipt, signReceiptToken, customerApiLimit, receiptLimit } = require('../middleware/require-customer')
const { writeReceiptHtml, receiptPdfBuffer } = require('../services/receipt')
const { restoreStock } = require('../services/inventory')

const router = express.Router()
const COLUMNS = `o.id, o.order_number, o.status, o.fulfilment, o.payment_method, o.payment_status,
  o.subtotal_estimated, o.delivery_fee, o.discount_amount, o.total_estimated, o.total_final,
  o.customer_notes, o.created_at, o.updated_at, o.assigned_at, o.delivered_at, o.cancelled_at, o.cancellation_reason,
  o.delivery_agent_id, da.name AS agent_name, da.phone AS agent_phone, da.vehicle_type AS agent_vehicle,
  p.id AS payment_id, p.provider, p.provider_order_id, p.provider_payment_id, p.status AS payment_row_status,
  p.confirmed_at AS payment_confirmed_at, p.created_at AS payment_created_at,
  a.recipient_name, a.line1, a.line2, a.landmark, a.city, a.postal_code`

const CANCELLABLE = new Set(['pending', 'accepted', 'preparing'])

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function itemsForOrders(orderIds) {
  if (!orderIds.length) return new Map()
  const [items] = await db.query(
    `SELECT order_id, product_id, product_name_snapshot, unit_snapshot, price_snapshot,
            requested_quantity, actual_quantity, estimated_line_total, final_line_total
     FROM order_items WHERE order_id IN (?) ORDER BY id`,
    [orderIds],
  )
  return items.reduce((map, item) => {
    const list = map.get(Number(item.order_id)) || []
    list.push({
      productId: Number(item.product_id),
      name: item.product_name_snapshot,
      unit: item.unit_snapshot,
      price: Number(item.price_snapshot),
      quantity: Number(item.requested_quantity),
      actualQuantity: item.actual_quantity === null ? null : Number(item.actual_quantity),
      lineTotal: Number(item.estimated_line_total),
      finalLineTotal: item.final_line_total === null ? null : Number(item.final_line_total),
    })
    map.set(Number(item.order_id), list)
    return map
  }, new Map())
}

function mapOrder(row, items = []) {
  return {
    orderNumber: row.order_number,
    status: row.status,
    fulfilment: row.fulfilment,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    subtotal: Number(row.subtotal_estimated),
    deliveryFee: Number(row.delivery_fee),
    discount: Number(row.discount_amount),
    total: Number(row.total_estimated),
    totalFinal: row.total_final === null ? null : Number(row.total_final),
    notes: row.customer_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedAt: row.assigned_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    canCancel: CANCELLABLE.has(row.status) && row.payment_status !== 'paid',
    address: row.line1 ? {
      recipientName: row.recipient_name,
      line1: row.line1,
      line2: row.line2,
      landmark: row.landmark,
      city: row.city,
      postalCode: row.postal_code,
    } : null,
    deliveryAgent: row.agent_name ? {
      name: row.agent_name,
      phone: row.agent_phone,
      vehicle: row.agent_vehicle,
    } : null,
    payment: row.payment_id ? {
      id: Number(row.payment_id),
      provider: row.provider,
      transactionId: row.provider_payment_id || row.provider_order_id || null,
      status: row.payment_row_status,
      confirmedAt: row.payment_confirmed_at,
      createdAt: row.payment_created_at,
    } : null,
    items,
  }
}

async function loadOrderBundle(paymentId, customerId) {
  const [rows] = await db.execute(
    `SELECT ${COLUMNS}
     FROM orders o
     JOIN users u ON u.id = o.customer_id
     LEFT JOIN addresses a ON a.id = o.address_id
     LEFT JOIN payments p ON p.order_id = o.id
     LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
     WHERE p.id = ? AND o.customer_id = ? LIMIT 1`,
    [paymentId, customerId],
  )
  const row = rows[0]
  if (!row) return null
  const items = (await itemsForOrders([row.id])).get(Number(row.id)) || []
  const [users] = await db.execute('SELECT full_name, email, phone FROM users WHERE id = ? LIMIT 1', [customerId])
  return {
    order: mapOrder(row, items),
    customer: { name: users[0]?.full_name || '', email: users[0]?.email || '', phone: users[0]?.phone || '' },
    payment: {
      id: Number(row.payment_id),
      provider: row.provider,
      provider_order_id: row.provider_order_id,
      provider_payment_id: row.provider_payment_id,
      status: row.payment_row_status,
      confirmed_at: row.payment_confirmed_at,
      created_at: row.payment_created_at,
    },
  }
}

router.get('/me', customerApiLimit, requireCustomer, async (req, res) => {
  const [stats] = await db.execute(
    `SELECT COUNT(*) AS total_orders,
            SUM(status IN ('pending','accepted','preparing','ready','out_for_delivery')) AS active_orders,
            SUM(status = 'delivered') AS delivered_orders,
            SUM(status = 'cancelled') AS cancelled_orders,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_estimated ELSE 0 END), 0) AS lifetime_spend
     FROM orders WHERE customer_id = ?`,
    [req.customer.id],
  )
  const row = stats[0] || {}
  res.json({
    customer: {
      id: Number(req.customer.id),
      email: req.customer.email,
      fullName: req.customer.full_name,
      phone: req.customer.phone,
      memberSince: req.customer.created_at,
    },
    stats: {
      totalOrders: Number(row.total_orders || 0),
      activeOrders: Number(row.active_orders || 0),
      deliveredOrders: Number(row.delivered_orders || 0),
      cancelledOrders: Number(row.cancelled_orders || 0),
      lifetimeSpend: Number(row.lifetime_spend || 0),
    },
  })
})

router.patch('/me', customerApiLimit, requireCustomer, async (req, res, next) => {
  try {
    const fullName = text(req.body?.fullName, 160)
    const phone = text(req.body?.phone, 32)
    if (fullName && fullName.length < 2) return res.status(400).json({ error: 'Enter your full name.' })
    await db.execute(
      `UPDATE users SET full_name = COALESCE(NULLIF(?, ''), full_name), phone = COALESCE(NULLIF(?, ''), phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [fullName, phone, req.customer.id],
    )
    const [rows] = await db.execute('SELECT id, email, full_name, phone, created_at FROM users WHERE id = ? LIMIT 1', [req.customer.id])
    res.json({ customer: { id: Number(rows[0].id), email: rows[0].email, fullName: rows[0].full_name, phone: rows[0].phone, memberSince: rows[0].created_at } })
  } catch (error) { next(error) }
})

router.get('/orders', customerApiLimit, requireCustomer, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)
    const scope = req.query.scope === 'active' ? 'active' : req.query.scope === 'history' ? 'history' : null
    const params = [req.customer.id]
    let extra = ''
    if (scope === 'active') extra = " AND o.status IN ('pending','accepted','preparing','ready','out_for_delivery')"
    if (scope === 'history') extra = " AND o.status IN ('delivered','cancelled','rejected')"
    const [rows] = await db.query(
      `SELECT ${COLUMNS}
       FROM orders o
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN payments p ON p.order_id = o.id
       LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
       WHERE o.customer_id = ?${extra}
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [...params, limit],
    )
    const items = await itemsForOrders(rows.map(row => Number(row.id)))
    res.json({ orders: rows.map(row => mapOrder(row, items.get(Number(row.id)) || [])) })
  } catch (error) { next(error) }
})

router.get('/orders/:orderNumber', customerApiLimit, requireCustomer, async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT ${COLUMNS}
       FROM orders o
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN payments p ON p.order_id = o.id
       LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
       WHERE o.order_number = ? AND o.customer_id = ? LIMIT 1`,
      [text(req.params.orderNumber, 32), req.customer.id],
    )
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' })
    const items = (await itemsForOrders([Number(rows[0].id)])).get(Number(rows[0].id)) || []
    const [events] = await db.execute(
      'SELECT status, note, created_at FROM order_status_events WHERE order_id = ? ORDER BY created_at, id',
      [rows[0].id],
    )
    res.json({
      order: mapOrder(rows[0], items),
      timeline: events.map(event => ({ status: event.status, note: event.note, at: event.created_at })),
    })
  } catch (error) { next(error) }
})

router.post('/orders/:orderNumber/cancel', customerApiLimit, requireCustomer, async (req, res, next) => {
  const connection = await db.getConnection()
  try {
    const reason = text(req.body?.reason, 500) || 'Cancelled by the customer from their dashboard.'
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      'SELECT id, status, payment_status FROM orders WHERE order_number = ? AND customer_id = ? FOR UPDATE',
      [text(req.params.orderNumber, 32), req.customer.id],
    )
    const order = rows[0]
    if (!order) {
      await connection.rollback()
      return res.status(404).json({ error: 'Order not found.' })
    }
    if (!CANCELLABLE.has(order.status)) {
      await connection.rollback()
      return res.status(409).json({ error: `This order is already ${String(order.status).replaceAll('_', ' ')} and can no longer be cancelled online. Please contact the store.` })
    }
    if (order.payment_status === 'paid') {
      await connection.rollback()
      return res.status(409).json({ error: 'This order is already paid. Contact the store so we can process a refund and cancel it safely.' })
    }
    const [result] = await connection.execute(
      `UPDATE orders SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), cancellation_reason = ? WHERE id = ? AND status IN ('pending','accepted','preparing')`,
      [reason, order.id],
    )
    if (result.affectedRows !== 1) {
      await connection.rollback()
      return res.status(409).json({ error: 'The order changed while cancelling. Refresh and try again.' })
    }
    await connection.execute('UPDATE payments SET status = ?, failure_reason = ? WHERE order_id = ? AND status = ?', ['failed', 'Order cancelled by the customer before payment.', order.id, 'pending'])
    await connection.execute('INSERT INTO order_status_events (order_id, status, note) VALUES (?, ?, ?)', [order.id, 'cancelled', reason])
    await restoreStock(connection, order.id)
    await connection.commit()
    res.json({ ok: true, status: 'cancelled' })
  } catch (error) {
    try { await connection.rollback() } catch { /* already closed */ }
    next(error)
  } finally {
    connection.release()
  }
})

router.get('/payments', customerApiLimit, requireCustomer, async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT p.id, p.provider, p.provider_order_id, p.provider_payment_id, p.provider_reference,
              p.amount, p.currency, p.status, p.failure_reason, p.confirmed_at, p.created_at,
              o.order_number, o.status AS order_status, o.payment_status, o.total_estimated
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.customer_id = ?
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [req.customer.id],
    )
    res.json({
      payments: rows.map(row => ({
        id: Number(row.id),
        orderNumber: row.order_number,
        orderStatus: row.order_status,
        paymentStatus: row.payment_status,
        provider: row.provider,
        method: row.provider === 'razorpay' ? 'Razorpay online' : row.provider === 'cash_on_delivery' ? 'Cash on delivery' : String(row.provider).replaceAll('_', ' '),
        transactionId: row.provider_payment_id || row.provider_order_id || row.provider_reference || `FF-PAY-${row.id}`,
        gatewayOrderId: row.provider_order_id,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        failureReason: row.failure_reason,
        paidAt: row.confirmed_at,
        createdAt: row.created_at,
      })),
    })
  } catch (error) { next(error) }
})

router.post('/payments/:paymentId/receipt-link', customerApiLimit, requireCustomer, async (req, res, next) => {
  try {
    const paymentId = Number(req.params.paymentId)
    const [rows] = await db.execute(
      'SELECT p.id, o.order_number FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ? AND o.customer_id = ? LIMIT 1',
      [paymentId, req.customer.id],
    )
    if (!rows.length) return res.status(404).json({ error: 'Payment not found.' })
    const token = signReceiptToken(rows[0].id, req.customer.id, rows[0].order_number)
    res.json({ token, filename: `Fresh-Farm-receipt-${rows[0].order_number}.pdf` })
  } catch (error) { next(error) }
})

router.get('/receipts/:paymentId', receiptLimit, requireReceipt, async (req, res, next) => {
  try {
    if (Number(req.params.paymentId) !== req.receiptPaymentId) return res.status(403).json({ error: 'This receipt link is not valid for that payment.' })
    const bundle = await loadOrderBundle(req.receiptPaymentId, req.receiptCustomerId)
    if (!bundle) return res.status(404).json({ error: 'Receipt not found.' })
    if (!['captured', 'authorized', 'refunded'].includes(bundle.payment.status) && bundle.order.paymentStatus !== 'paid') {
      return res.status(409).json({ error: 'A receipt is available once the payment is confirmed.' })
    }
    const format = req.query.format === 'html' ? 'html' : 'pdf'
    const filename = `Fresh-Farm-receipt-${bundle.order.orderNumber}`
    if (format === 'html') {
      res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}.html"`, 'Cache-Control': 'private, no-store' })
      return res.send(writeReceiptHtml(bundle))
    }
    const pdf = await receiptPdfBuffer(bundle)
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}.pdf"`, 'Cache-Control': 'private, no-store' })
    return res.send(pdf)
  } catch (error) { next(error) }
})

module.exports = router
module.exports.loadOrderBundle = loadOrderBundle
