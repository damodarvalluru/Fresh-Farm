const express = require('express')
const db = require('../config/db')
const { requireRoles } = require('../middleware/require-admin')
const { beginTransaction } = require('../lib/tx')

const router = express.Router()
const VEHICLES = ['bike', 'scooter', 'car', 'van', 'other']
const OPEN_DELIVERY_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery']
const PHONE = /^[0-9+\-\s()]{6,32}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function mapAgent(row) {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    email: row.email,
    vehicleType: row.vehicle_type,
    vehicleNumber: row.vehicle_number,
    serviceArea: row.service_area,
    capacity: Number(row.max_active_orders),
    isActive: Boolean(row.is_active),
    notes: row.notes,
    activeOrders: row.active_orders === undefined ? undefined : Number(row.active_orders),
    completedDeliveries: row.completed_deliveries === undefined ? undefined : Number(row.completed_deliveries),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readAgent(body) {
  const name = text(body?.name, 160)
  const phone = text(body?.phone, 32)
  const email = text(body?.email, 254).toLowerCase() || null
  const vehicleType = VEHICLES.includes(body?.vehicleType) ? body.vehicleType : 'bike'
  const vehicleNumber = text(body?.vehicleNumber, 40) || null
  const serviceArea = text(body?.serviceArea, 160) || null
  const notes = text(body?.notes, 500) || null
  const capacity = Number(body?.capacity)
  const isActive = body?.isActive === undefined ? true : Boolean(body.isActive)
  const errors = []
  if (name.length < 2) errors.push('Enter the delivery agent name.')
  if (!PHONE.test(phone)) errors.push('Enter a valid phone number.')
  if (email && !EMAIL.test(email)) errors.push('Enter a valid email address or leave it blank.')
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) errors.push('Capacity must be a whole number between 1 and 50.')
  return { values: { name, phone, email, vehicleType, vehicleNumber, serviceArea, notes, capacity, isActive }, errors }
}

async function agentSummary(id) {
  const [rows] = await db.query(
    `SELECT da.*,
            (SELECT COUNT(*) FROM orders o WHERE o.delivery_agent_id = da.id AND o.status IN (?)) AS active_orders,
            (SELECT COUNT(*) FROM orders o WHERE o.delivery_agent_id = da.id AND o.status = 'delivered') AS completed_deliveries
     FROM delivery_agents da WHERE da.id = ? LIMIT 1`,
    [OPEN_DELIVERY_STATUSES, id],
  )
  return rows[0] || null
}

router.get('/agents', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    const [rows] = await db.query(
      `SELECT da.*,
              (SELECT COUNT(*) FROM orders o WHERE o.delivery_agent_id = da.id AND o.status IN (?)) AS active_orders,
              (SELECT COUNT(*) FROM orders o WHERE o.delivery_agent_id = da.id AND o.status = 'delivered') AS completed_deliveries
       FROM delivery_agents da
       ${includeInactive ? '' : 'WHERE da.is_active = 1'}
       ORDER BY da.is_active DESC, da.name`,
      [OPEN_DELIVERY_STATUSES],
    )
    res.json({ agents: rows.map(mapAgent) })
  } catch (error) { next(error) }
})

router.get('/agents/:id', async (req, res, next) => {
  try {
    const row = await agentSummary(Number(req.params.id))
    if (!row) return res.status(404).json({ error: 'Delivery agent not found.' })
    const [assignments] = await db.execute(
      `SELECT oa.id, oa.status, oa.note, oa.assigned_at, oa.ended_at,
              o.order_number, o.status AS order_status, o.total_estimated, u.full_name AS customer_name
       FROM order_assignments oa
       JOIN orders o ON o.id = oa.order_id
       JOIN users u ON u.id = o.customer_id
       WHERE oa.agent_id = ?
       ORDER BY oa.assigned_at DESC LIMIT 50`,
      [row.id],
    )
    res.json({
      agent: mapAgent(row),
      assignments: assignments.map(item => ({
        id: Number(item.id),
        orderNumber: item.order_number,
        orderStatus: item.order_status,
        customerName: item.customer_name,
        total: Number(item.total_estimated),
        status: item.status,
        note: item.note,
        assignedAt: item.assigned_at,
        endedAt: item.ended_at,
      })),
    })
  } catch (error) { next(error) }
})

router.post('/agents', requireRoles('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { values, errors } = readAgent(req.body)
    if (errors.length) return res.status(400).json({ error: errors[0] })
    try {
      const [created] = await db.execute(
        `INSERT INTO delivery_agents (name, phone, email, vehicle_type, vehicle_number, service_area, max_active_orders, is_active, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [values.name, values.phone, values.email, values.vehicleType, values.vehicleNumber, values.serviceArea, values.capacity, values.isActive, values.notes],
      )
      const row = await agentSummary(created.insertId)
      return res.status(201).json({ agent: mapAgent(row) })
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A delivery agent with this phone number already exists.' })
      throw error
    }
  } catch (error) { next(error) }
})

router.patch('/agents/:id', requireRoles('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [existingRows] = await db.execute('SELECT * FROM delivery_agents WHERE id = ? LIMIT 1', [id])
    if (!existingRows.length) return res.status(404).json({ error: 'Delivery agent not found.' })
    const existing = existingRows[0]
    const merged = {
      name: req.body?.name === undefined ? existing.name : req.body.name,
      phone: req.body?.phone === undefined ? existing.phone : req.body.phone,
      email: req.body?.email === undefined ? existing.email : req.body.email,
      vehicleType: req.body?.vehicleType === undefined ? existing.vehicle_type : req.body.vehicleType,
      vehicleNumber: req.body?.vehicleNumber === undefined ? existing.vehicle_number : req.body.vehicleNumber,
      serviceArea: req.body?.serviceArea === undefined ? existing.service_area : req.body.serviceArea,
      notes: req.body?.notes === undefined ? existing.notes : req.body.notes,
      capacity: req.body?.capacity === undefined ? existing.max_active_orders : req.body.capacity,
      isActive: req.body?.isActive === undefined ? existing.is_active : req.body.isActive,
    }
    const { values, errors } = readAgent(merged)
    if (errors.length) return res.status(400).json({ error: errors[0] })

    if (!values.isActive) {
      const [load] = await db.query('SELECT COUNT(*) AS active_orders FROM orders WHERE delivery_agent_id = ? AND status IN (?)', [id, OPEN_DELIVERY_STATUSES])
      if (Number(load[0].active_orders) > 0) {
        return res.status(409).json({ error: 'Reassign this agent’s active orders before deactivating the account.' })
      }
    }
    try {
      await db.execute(
        `UPDATE delivery_agents SET name = ?, phone = ?, email = ?, vehicle_type = ?, vehicle_number = ?,
                service_area = ?, max_active_orders = ?, is_active = ?, notes = ? WHERE id = ?`,
        [values.name, values.phone, values.email, values.vehicleType, values.vehicleNumber, values.serviceArea, values.capacity, values.isActive, values.notes, id],
      )
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A delivery agent with this phone number already exists.' })
      throw error
    }
    const row = await agentSummary(id)
    return res.json({ agent: mapAgent(row) })
  } catch (error) { next(error) }
})

router.delete('/agents/:id', requireRoles('ADMIN'), async (req, res, next) => {
  let connection
  try {
    const id = Number(req.params.id)
    connection = await db.getConnection()
    await beginTransaction(connection)
    const [existing] = await connection.execute(
      'SELECT id, name, is_active FROM delivery_agents WHERE id = ? LIMIT 1 FOR UPDATE',
      [id],
    )
    if (!existing.length) {
      await connection.rollback()
      return res.status(404).json({ error: 'Delivery agent not found.' })
    }
    const [used] = await connection.execute('SELECT COUNT(*) AS total FROM order_assignments WHERE agent_id = ?', [id])
    if (Number(used[0].total) > 0) {
      await connection.rollback()
      return res.status(409).json({ error: `This agent has ${used[0].total} assignment records. Deactivate the account instead of deleting it so delivery history stays intact.` })
    }
    await connection.execute('DELETE FROM delivery_agents WHERE id = ?', [id])
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
