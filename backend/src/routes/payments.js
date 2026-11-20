const express = require('express')
const { rateLimit } = require('express-rate-limit')
const db = require('../config/db')
const razorpay = require('../services/razorpay')
const { notifyOrderPlaced } = require('../services/notify')

const router = express.Router()
const paymentLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false })

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function loadOrderByGatewayOrderId(gatewayOrderId) {
  const [rows] = await db.execute(`
    SELECT p.id AS payment_id, p.amount, p.status AS payment_row_status, p.provider_payment_id,
           o.id AS order_id, o.order_number, o.payment_status, o.total_estimated,
           o.delivery_fee, o.subtotal_estimated,
           u.email, u.full_name, u.phone
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    JOIN users u ON u.id = o.customer_id
    WHERE p.provider = 'razorpay' AND p.provider_order_id = ? LIMIT 1
  `, [gatewayOrderId])
  return rows[0] || null
}

async function loadOrderBundle(order) {
  const [items] = await db.execute('SELECT product_name_snapshot, requested_quantity, estimated_line_total FROM order_items WHERE order_id = ?', [order.order_id])
  return {
    orderNumber: order.order_number,
    email: order.email,
    phone: order.phone,
    customerName: order.full_name,
    subtotal: Number(order.subtotal_estimated),
    deliveryFee: Number(order.delivery_fee),
    total: Number(order.total_estimated),
    paymentStatus: 'paid',
    items: items.map(item => ({
      name: item.product_name_snapshot,
      quantity: Number(item.requested_quantity),
      lineTotal: Number(item.estimated_line_total),
    })),
  }
}

async function markPaid(order, providerPaymentId, providerReference) {
  if (order.payment_status !== 'paid') {
    await db.execute('UPDATE payments SET status = ?, provider_payment_id = COALESCE(provider_payment_id, ?), provider_reference = ?, confirmed_at = UTC_TIMESTAMP() WHERE id = ?', ['captured', providerPaymentId || null, providerReference || providerPaymentId || null, order.payment_id])
    await db.execute('UPDATE orders SET payment_status = ?, total_final = total_estimated WHERE id = ?', ['paid', order.order_id])
    await db.execute('INSERT INTO order_status_events (order_id, status, note) VALUES (?, ?, ?)', [order.order_id, 'pending', `Payment captured via Razorpay (${providerPaymentId || 'webhook'}).`])
    void notifyOrderPlaced(await loadOrderBundle(order))
  }
  return order.order_number
}

router.post('/razorpay/verify', paymentLimit, async (req, res, next) => {
  try {
    const gatewayOrderId = text(req.body?.razorpay_order_id, 180)
    const providerPaymentId = text(req.body?.razorpay_payment_id, 180)
    const signature = text(req.body?.razorpay_signature, 255)
    if (!gatewayOrderId || !providerPaymentId || !signature) {
      return res.status(400).json({ error: 'Payment verification details are missing.' })
    }
    if (!razorpay.verifyCheckoutSignature({ orderId: gatewayOrderId, paymentId: providerPaymentId, signature })) {
      return res.status(400).json({ error: 'Payment signature verification failed.' })
    }
    const order = await loadOrderByGatewayOrderId(gatewayOrderId)
    if (!order) return res.status(404).json({ error: 'Payment record not found for this order.' })
    if (order.payment_status === 'paid') return res.json({ ok: true, orderNumber: order.order_number })

    const gatewayPayment = await razorpay.fetchPayment(providerPaymentId)
    const expectedAmount = Math.round(Number(order.amount) * 100)
    if (Number(gatewayPayment.amount) !== expectedAmount || String(gatewayPayment.order_id) !== gatewayOrderId) {
      return res.status(409).json({ error: 'The captured amount does not match this order.' })
    }
    if (!['captured', 'authorized'].includes(gatewayPayment.status)) {
      await db.execute('UPDATE payments SET status = ?, failure_reason = ? WHERE id = ?', ['failed', `Gateway status: ${gatewayPayment.status}`, order.payment_id])
      return res.status(409).json({ error: 'The payment was not completed. Please try again.' })
    }

    const orderNumber = await markPaid(order, gatewayPayment.id, gatewayPayment.order_id)
    return res.json({ ok: true, orderNumber })
  } catch (error) { next(error) }
})

async function razorpayWebhook(req, res) {
  try {
    const signature = req.get('x-razorpay-signature')
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}))
    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature.' })
    }
    let event
    try { event = JSON.parse(rawBody.toString('utf8')) } catch { return res.status(400).json({ error: 'Invalid webhook payload.' }) }
    const payment = event?.payload?.payment?.entity
    if (!payment?.order_id) return res.json({ ok: true })
    const order = await loadOrderByGatewayOrderId(payment.order_id)
    if (!order) return res.json({ ok: true })

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      await markPaid(order, payment.id, payment.order_id)
    } else if (event.event === 'payment.failed') {
      await db.execute('UPDATE payments SET status = ?, failure_reason = ? WHERE id = ? AND status <> ?', ['failed', text(payment.error_description, 500) || 'Payment failed at the gateway.', order.payment_id, 'captured'])
      await db.execute('UPDATE orders SET payment_status = ? WHERE id = ? AND payment_status <> ?', ['failed', order.order_id, 'paid'])
    }
    return res.json({ ok: true })
  } catch (error) {
    console.error('Razorpay webhook failed:', error.message)
    return res.status(500).json({ error: 'Webhook processing failed.' })
  }
}

module.exports = { router, razorpayWebhook }
