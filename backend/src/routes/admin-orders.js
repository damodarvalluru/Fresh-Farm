const express = require('express')
const db = require('../config/db')
const { beginTransaction } = require('../lib/tx')
const { restoreStock } = require('../services/inventory')

const router = express.Router()

const STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled']
const PAYMENT_STATUSES = ['pending', 'authorized', 'paid', 'failed', 'refunded']
// Any order that still needs a rider occupies a rider's capacity. A freshly
// assigned order stays `pending` until staff accept it, so pending must count.
const OPEN_DELIVERY_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery']

/**
 * Allowed workflow. Staff can move an order forward one realistic step at a
 * time, so a delivered order can never silently fall back to pending and
 * analytics reporting stays trustworthy.
 */
const TRANSITIONS = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'rejected', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  rejected: [],
  cancelled: [],
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function money(value) {
  return value === null || value === undefined ? 0 : Number(value)
}

function intOr(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function dateOnly(value) {
  const raw = text(value, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

const ORDER_SELECT = `
  o.id, o.order_number, o.client_order_id, o.status, o.fulfilment, o.payment_method, o.payment_status,
  o.subtotal_estimated, o.delivery_fee, o.discount_amount, o.total_estimated, o.total_final,
  o.customer_notes, o.created_at, o.updated_at, o.assigned_at, o.delivered_at, o.cancelled_at, o.cancellation_reason,
  o.delivery_agent_id,
  u.full_name, u.email, u.phone, u.created_at AS customer_since,
  a.recipient_name, a.phone AS address_phone, a.line1, a.line2, a.landmark, a.city, a.postal_code,
  da.name AS agent_name, da.phone AS agent_phone, da.vehicle_type AS agent_vehicle, da.vehicle_number AS agent_vehicle_number,
  p.id AS payment_id, p.provider, p.provider_order_id, p.provider_payment_id, p.status AS payment_row_status,
  p.amount AS payment_amount, p.confirmed_at AS payment_confirmed_at, p.created_at AS payment_created_at, p.failure_reason
`

function mapOrder(row) {
  return {
    orderNumber: row.order_number,
    status: row.status,
    fulfilment: row.fulfilment,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    subtotal: money(row.subtotal_estimated),
    deliveryFee: money(row.delivery_fee),
    discount: money(row.discount_amount),
    total: money(row.total_estimated),
    totalFinal: row.total_final === null ? null : money(row.total_final),
    notes: row.customer_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignedAt: row.assigned_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    customer: {
      name: row.full_name,
      email: row.email,
      phone: row.phone,
      customerSince: row.customer_since,
    },
    address: row.line1 ? {
      recipientName: row.recipient_name,
      phone: row.address_phone,
      line1: row.line1,
      line2: row.line2,
      landmark: row.landmark,
      city: row.city,
      postalCode: row.postal_code,
    } : null,
    deliveryAgent: row.agent_name ? {
      id: Number(row.delivery_agent_id),
      name: row.agent_name,
      phone: row.agent_phone,
      vehicle: row.agent_vehicle,
      vehicleNumber: row.agent_vehicle_number,
    } : null,
    payment: row.payment_id ? {
      id: Number(row.payment_id),
      provider: row.provider,
      orderId: row.provider_order_id,
      transactionId: row.provider_payment_id || row.provider_order_id || null,
      amount: money(row.payment_amount),
      status: row.payment_row_status,
      confirmedAt: row.payment_confirmed_at,
      createdAt: row.payment_created_at,
      failureReason: row.failure_reason,
    } : null,
  }
}

async function loadItems(orderIds) {
  if (!orderIds.length) return new Map()
  const [rows] = await db.query(
    `SELECT order_id, product_id, product_name_snapshot, unit_snapshot, price_snapshot, cost_snapshot,
            requested_quantity, actual_quantity, estimated_line_total, final_line_total
     FROM order_items WHERE order_id IN (?) ORDER BY id`,
    [orderIds],
  )
  return rows.reduce((map, item) => {
    const list = map.get(Number(item.order_id)) || []
    const quantity = Number(item.requested_quantity)
    const cost = money(item.cost_snapshot) * (item.actual_quantity === null ? quantity : Number(item.actual_quantity))
    list.push({
      productId: Number(item.product_id),
      name: item.product_name_snapshot,
      unit: item.unit_snapshot,
      price: money(item.price_snapshot),
      cost: money(item.cost_snapshot),
      quantity,
      actualQuantity: item.actual_quantity === null ? null : Number(item.actual_quantity),
      lineTotal: money(item.estimated_line_total),
      finalLineTotal: item.final_line_total === null ? null : money(item.final_line_total),
      costTotal: Math.round(cost * 100) / 100,
    })
    map.set(Number(item.order_id), list)
    return map
  }, new Map())
}

// ---------------------------------------------------------------------------
// Order list with filters and paging
// ---------------------------------------------------------------------------
router.get('/orders', async (req, res, next) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null
    const paymentStatus = PAYMENT_STATUSES.includes(req.query.paymentStatus) ? req.query.paymentStatus : null
    const fulfilment = ['delivery', 'pickup'].includes(req.query.fulfilment) ? req.query.fulfilment : null
    const agentId = Number(req.query.agentId)
    const from = dateOnly(req.query.from)
    const to = dateOnly(req.query.to)
    const search = text(req.query.search, 120)
    const limit = Math.min(Math.max(intOr(req.query.limit, 25), 1), 100)
    const page = Math.max(intOr(req.query.page, 1), 1)
    const offset = (page - 1) * limit

    const where = []
    const params = []
    if (status) { where.push('o.status = ?'); params.push(status) }
    if (paymentStatus) { where.push('o.payment_status = ?'); params.push(paymentStatus) }
    if (fulfilment) { where.push('o.fulfilment = ?'); params.push(fulfilment) }
    if (Number.isInteger(agentId) && agentId > 0) { where.push('o.delivery_agent_id = ?'); params.push(agentId) }
    if (from) { where.push('o.created_at >= ?'); params.push(`${from} 00:00:00`) }
    if (to) { where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(to) }
    if (search) {
      where.push('(o.order_number LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)')
      const like = `%${search}%`
      params.push(like, like, like, like)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM orders o JOIN users u ON u.id = o.customer_id ${whereSql}`,
      params,
    )
    const [rows] = await db.query(
      `SELECT ${ORDER_SELECT}
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
       LEFT JOIN payments p ON p.order_id = o.id
       ${whereSql}
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    const itemsByOrder = await loadItems(rows.map(row => Number(row.id)))

    // Small aggregate strip shown above the table.
    const [summary] = await db.query(
      `SELECT
         COUNT(*) AS total,
         SUM(o.status = 'pending') AS pending,
         SUM(o.status IN ('accepted','preparing','ready')) AS in_kitchen,
         SUM(o.status = 'out_for_delivery') AS out_for_delivery,
         SUM(o.status = 'delivered') AS delivered,
         SUM(o.status = 'cancelled') AS cancelled,
         SUM(CASE WHEN o.payment_status = 'paid' AND o.status <> 'cancelled' THEN COALESCE(o.total_final, o.total_estimated) ELSE 0 END) AS collected
       FROM orders o JOIN users u ON u.id = o.customer_id ${whereSql}`,
      params,
    )

    res.json({
      orders: rows.map(row => ({
        ...mapOrder(row),
        items: itemsByOrder.get(Number(row.id)) || [],
      })),
      summary: {
        total: Number(summary[0]?.total || 0),
        pending: Number(summary[0]?.pending || 0),
        inKitchen: Number(summary[0]?.in_kitchen || 0),
        outForDelivery: Number(summary[0]?.out_for_delivery || 0),
        delivered: Number(summary[0]?.delivered || 0),
        cancelled: Number(summary[0]?.cancelled || 0),
        collected: money(summary[0]?.collected),
      },
      paging: { page, limit, total: Number(countRows[0]?.total || 0), pages: Math.max(Math.ceil(Number(countRows[0]?.total || 0) / limit), 1) },
    })
  } catch (error) { next(error) }
})

// ---------------------------------------------------------------------------
// Assignment monitoring (active + recent history)
// ---------------------------------------------------------------------------
router.get('/assignments', async (req, res, next) => {
  try {
    const activeOnly = req.query.active !== 'false'
    const limit = Math.min(Math.max(intOr(req.query.limit, 100), 1), 300)
    const where = activeOnly ? "WHERE oa.status = 'active'" : ''
    const [rows] = await db.query(
      `SELECT oa.id, oa.order_id, oa.agent_id, oa.status AS assignment_status, oa.note,
              oa.assigned_at, oa.ended_at, o.order_number, o.status AS order_status,
              o.fulfilment, o.payment_status, o.total_estimated,
              u.full_name AS customer_name, a.city,
              da.name AS agent_name, da.phone AS agent_phone, da.max_active_orders,
              ab.display_name AS assigned_by_name, abu.full_name AS assigned_by_full_name
       FROM order_assignments oa
       JOIN orders o ON o.id = oa.order_id
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN addresses a ON a.id = o.address_id
       JOIN delivery_agents da ON da.id = oa.agent_id
       LEFT JOIN admins ab ON ab.id = oa.assigned_by
       LEFT JOIN users abu ON abu.id = ab.user_id
       ${where}
       ORDER BY oa.assigned_at DESC
       LIMIT ?`,
      [limit],
    )

    const [workload] = await db.query(
      `SELECT da.id, da.name, da.phone, da.is_active, da.max_active_orders, da.service_area,
              COUNT(o.id) AS active_orders
       FROM delivery_agents da
       LEFT JOIN orders o ON o.delivery_agent_id = da.id AND o.status IN (?)
       GROUP BY da.id, da.name, da.phone, da.is_active, da.max_active_orders, da.service_area
       ORDER BY da.name`,
      [OPEN_DELIVERY_STATUSES],
    )

    const now = Date.now()
    res.json({
      assignments: rows.map(row => ({
        id: Number(row.id),
        orderNumber: row.order_number,
        orderStatus: row.order_status,
        fulfilment: row.fulfilment,
        paymentStatus: row.payment_status,
        total: money(row.total_estimated),
        customerName: row.customer_name,
        city: row.city,
        assignmentStatus: row.assignment_status,
        note: row.note,
        assignedAt: row.assigned_at,
        endedAt: row.ended_at,
        minutesActive: Math.max(Math.round((now - new Date(row.assigned_at).getTime()) / 60000), 0),
        agent: {
          id: Number(row.agent_id),
          name: row.agent_name,
          phone: row.agent_phone,
          capacity: Number(row.max_active_orders),
        },
        assignedBy: row.assigned_by_name || row.assigned_by_full_name || 'System',
      })),
      workload: workload.map(row => ({
        id: Number(row.id),
        name: row.name,
        phone: row.phone,
        isActive: Boolean(row.is_active),
        serviceArea: row.service_area,
        capacity: Number(row.max_active_orders),
        activeOrders: Number(row.active_orders),
        available: Math.max(Number(row.max_active_orders) - Number(row.active_orders), 0),
      })),
    })
  } catch (error) { next(error) }
})

// ---------------------------------------------------------------------------
// Order detail
// ---------------------------------------------------------------------------
router.get('/orders/:orderNumber', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT ${ORDER_SELECT}
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
       LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.order_number = ? LIMIT 1`,
      [text(req.params.orderNumber, 32)],
    )
    const row = rows[0]
    if (!row) return res.status(404).json({ error: 'Order not found.' })

    const itemsByOrder = await loadItems([Number(row.id)])
    const [timeline] = await db.execute(
      `SELECT e.status, e.note, e.created_at, COALESCE(ad.display_name, u.full_name) AS actor
       FROM order_status_events e
       LEFT JOIN admins ad ON ad.id = e.created_by
       LEFT JOIN users u ON u.id = ad.user_id
       WHERE e.order_id = ? ORDER BY e.created_at, e.id`,
      [row.id],
    )
    const [assignments] = await db.execute(
      `SELECT oa.id, oa.status, oa.note, oa.assigned_at, oa.ended_at,
              da.name AS agent_name, da.phone AS agent_phone,
              COALESCE(ad.display_name, u.full_name) AS assigned_by
       FROM order_assignments oa
       JOIN delivery_agents da ON da.id = oa.agent_id
       LEFT JOIN admins ad ON ad.id = oa.assigned_by
       LEFT JOIN users u ON u.id = ad.user_id
       WHERE oa.order_id = ? ORDER BY oa.assigned_at DESC, oa.id DESC`,
      [row.id],
    )

    res.json({
      order: {
        ...mapOrder(row),
        items: itemsByOrder.get(Number(row.id)) || [],
        timeline: timeline.map(event => ({
          status: event.status,
          note: event.note,
          actor: event.actor || 'System',
          at: event.created_at,
        })),
        assignments: assignments.map(item => ({
          id: Number(item.id),
          status: item.status,
          note: item.note,
          agent: item.agent_name,
          agentPhone: item.agent_phone,
          assignedBy: item.assigned_by || 'System',
          assignedAt: item.assigned_at,
          endedAt: item.ended_at,
        })),
        allowedNextStatuses: TRANSITIONS[row.status] || [],
      },
    })
  } catch (error) { next(error) }
})

// ---------------------------------------------------------------------------
// Status workflow
// ---------------------------------------------------------------------------
router.patch('/orders/:orderNumber/status', async (req, res, next) => {
  let connection
  try {
    const status = req.body?.status
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Choose a valid order status.' })
    const note = text(req.body?.note, 500) || null

    connection = await db.getConnection()
    await beginTransaction(connection)
    const [rows] = await connection.execute(
      'SELECT id, status, fulfilment, delivery_agent_id FROM orders WHERE order_number = ? LIMIT 1 FOR UPDATE',
      [text(req.params.orderNumber, 32)],
    )
    const order = rows[0]
    if (!order) {
      await connection.rollback()
      return res.status(404).json({ error: 'Order not found.' })
    }
    if (order.status === status) {
      await connection.rollback()
      return res.status(409).json({ error: `This order is already ${status.replaceAll('_', ' ')}.` })
    }
    if (!(TRANSITIONS[order.status] || []).includes(status)) {
      await connection.rollback()
      return res.status(409).json({ error: `An order that is ${order.status.replaceAll('_', ' ')} cannot move to ${status.replaceAll('_', ' ')}.` })
    }
    if (status === 'out_for_delivery' && order.fulfilment === 'delivery' && !order.delivery_agent_id) {
      await connection.rollback()
      return res.status(409).json({ error: 'Assign a delivery agent before marking the order out for delivery.' })
    }

    const sets = ['status = ?']
    const params = [status]
    if (status === 'delivered') { sets.push('delivered_at = UTC_TIMESTAMP()'); sets.push('total_final = COALESCE(total_final, total_estimated)') }
    if (status === 'cancelled') { sets.push('cancelled_at = UTC_TIMESTAMP()'); sets.push('cancellation_reason = ?'); params.push(note || 'Cancelled by staff') }
    if (status === 'cancelled' || status === 'rejected') {
      await connection.execute(
        "UPDATE order_assignments SET status = 'cancelled', ended_at = UTC_TIMESTAMP(6) WHERE order_id = ? AND status = 'active'",
        [order.id],
      )
      sets.push('delivery_agent_id = NULL')
    }
    if (status === 'delivered') {
      await connection.execute(
        "UPDATE order_assignments SET status = 'completed', ended_at = UTC_TIMESTAMP(6) WHERE order_id = ? AND status = 'active'",
        [order.id],
      )
    }
    params.push(order.id)
    await connection.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, params)
    await connection.execute(
      'INSERT INTO order_status_events (order_id, status, note, created_by) VALUES (?, ?, ?, ?)',
      [order.id, status, note, req.admin.id],
    )
    if (status === 'cancelled' || status === 'rejected') {
      await restoreStock(connection, order.id)
    }
    await connection.commit()

    res.json({ ok: true, status, allowedNextStatuses: TRANSITIONS[status] || [] })
  } catch (error) {
    if (connection) { try { await connection.rollback() } catch { /* already closed */ } }
    next(error)
  } finally {
    if (connection) connection.release()
  }
})

// ---------------------------------------------------------------------------
// Delivery assignment / reassignment
// ---------------------------------------------------------------------------
router.post('/orders/:orderNumber/assign', async (req, res, next) => {
  let connection
  try {
    const agentId = Number(req.body?.agentId)
    if (!Number.isInteger(agentId) || agentId <= 0) return res.status(400).json({ error: 'Choose a delivery agent.' })
    const note = text(req.body?.note, 500) || null

    connection = await db.getConnection()
    await beginTransaction(connection)
    const [orders] = await connection.execute(
      'SELECT id, order_number, status, fulfilment, delivery_agent_id FROM orders WHERE order_number = ? LIMIT 1 FOR UPDATE',
      [text(req.params.orderNumber, 32)],
    )
    const order = orders[0]
    if (!order) {
      await connection.rollback()
      return res.status(404).json({ error: 'Order not found.' })
    }
    if (order.fulfilment !== 'delivery') {
      await connection.rollback()
      return res.status(409).json({ error: 'Pickup orders do not need a delivery agent.' })
    }
    if (['delivered', 'cancelled', 'rejected'].includes(order.status)) {
      await connection.rollback()
      return res.status(409).json({ error: 'This order is closed and cannot be assigned.' })
    }

    // Lock the agent row so two admins cannot oversubscribe the same rider at
    // the same instant. The count below is the capacity authority.
    const [agents] = await connection.execute(
      'SELECT id, name, phone, max_active_orders, is_active FROM delivery_agents WHERE id = ? LIMIT 1 FOR UPDATE',
      [agentId],
    )
    const agent = agents[0]
    if (!agent) {
      await connection.rollback()
      return res.status(404).json({ error: 'Delivery agent not found.' })
    }
    if (!agent.is_active) {
      await connection.rollback()
      return res.status(409).json({ error: 'This delivery agent is inactive.' })
    }

    // Lock the agent's active order rows so the capacity count reads the very
    // latest committed assignments (a plain SELECT would use the transaction's
    // older snapshot and let two riders be oversubscribed).
    const [agentOrders] = await connection.query(
      `SELECT id FROM orders
       WHERE delivery_agent_id = ? AND status IN (?) AND id <> ? FOR UPDATE`,
      [agentId, OPEN_DELIVERY_STATUSES, order.id],
    )
    const load = agentOrders.length
    if (load >= Number(agent.max_active_orders)) {
      await connection.rollback()
      return res.status(409).json({ error: `${agent.name} already has ${load} active orders (limit ${agent.max_active_orders}).` })
    }

    if (Number(order.delivery_agent_id) === agentId) {
      const [active] = await connection.execute(
        "SELECT id FROM order_assignments WHERE order_id = ? AND status = 'active' LIMIT 1",
        [order.id],
      )
      if (active.length) {
        await connection.commit()
        return res.json({ ok: true, unchanged: true, agent: { id: agentId, name: agent.name, phone: agent.phone } })
      }
    }

    // Close the previous active assignment before inserting the next one. The
    // sentinel ended_at + unique index makes a double active row impossible.
    await connection.execute(
      "UPDATE order_assignments SET status = 'completed', ended_at = UTC_TIMESTAMP(6) WHERE order_id = ? AND status = 'active'",
      [order.id],
    )
    await connection.execute(
      'INSERT INTO order_assignments (order_id, agent_id, assigned_by, status, note) VALUES (?, ?, ?, ?, ?)',
      [order.id, agentId, req.admin.id, 'active', note],
    )
    await connection.execute('UPDATE orders SET delivery_agent_id = ?, assigned_at = UTC_TIMESTAMP() WHERE id = ?', [agentId, order.id])
    await connection.execute(
      "INSERT INTO order_status_events (order_id, status, note, created_by) VALUES (?, ?, ?, ?)",
      [order.id, order.status, `Delivery assigned to ${agent.name}${note ? ` — ${note}` : ''}`, req.admin.id],
    )
    await connection.commit()

    res.json({
      ok: true,
      agent: { id: agentId, name: agent.name, phone: agent.phone, activeOrders: load + 1, capacity: Number(agent.max_active_orders) },
    })
  } catch (error) {
    if (connection) { try { await connection.rollback() } catch { /* already closed */ } }
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Another assignment was saved at the same moment. Refresh and try again.' })
    next(error)
  } finally {
    if (connection) connection.release()
  }
})

router.post('/orders/:orderNumber/unassign', async (req, res, next) => {
  let connection
  try {
    connection = await db.getConnection()
    await beginTransaction(connection)
    const [orders] = await connection.execute(
      'SELECT id, status, delivery_agent_id FROM orders WHERE order_number = ? LIMIT 1 FOR UPDATE',
      [text(req.params.orderNumber, 32)],
    )
    const order = orders[0]
    if (!order) {
      await connection.rollback()
      return res.status(404).json({ error: 'Order not found.' })
    }
    if (['delivered', 'cancelled', 'rejected'].includes(order.status)) {
      await connection.rollback()
      return res.status(409).json({ error: 'This order is closed and its assignment cannot change.' })
    }
    const [active] = await connection.execute(
      "SELECT id FROM order_assignments WHERE order_id = ? AND status = 'active' LIMIT 1",
      [order.id],
    )
    if (!active.length) {
      await connection.rollback()
      return res.status(409).json({ error: 'This order has no active delivery assignment.' })
    }
    await connection.execute(
      "UPDATE order_assignments SET status = 'cancelled', ended_at = UTC_TIMESTAMP(6) WHERE order_id = ? AND status = 'active'",
      [order.id],
    )
    await connection.execute('UPDATE orders SET delivery_agent_id = NULL, assigned_at = NULL WHERE id = ?', [order.id])
    await connection.execute(
      'INSERT INTO order_status_events (order_id, status, note, created_by) VALUES (?, ?, ?, ?)',
      [order.id, order.status, text(req.body?.note, 500) || 'Delivery assignment removed', req.admin.id],
    )
    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    if (connection) { try { await connection.rollback() } catch { /* already closed */ } }
    next(error)
  } finally {
    if (connection) connection.release()
  }
})

module.exports = router
