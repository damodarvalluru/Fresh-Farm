/*
 * Temporary admin backend verification.
 *
 * Runs the real Express app in-process on an ephemeral port against the live
 * database. It temporarily sets the owner password/PIN, exercises setup, login,
 * reset, credential change, role permissions, agent CRUD, delivery assignment
 * concurrency, the status workflow, analytics math, CSV reports and profile
 * updates — then restores every row it touched.
 */
require('dotenv').config()
const { once } = require('node:events')
const { randomUUID, createHash } = require('node:crypto')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const db = require('../src/config/db')

const BOOTSTRAP = 'Bootstrap-Test-Password-2026'
const ADMIN_PASS = 'Admin-Test-Password-2026'
const NEW_PASS = 'Admin-Reset-Password-2026'
const FINAL_PASS = 'Admin-Final-Password-2026'
const PIN = '482913'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

process.env.ADMIN_PASSWORD_HASH = ''
const app = require('../src/app')

let BASE = ''
let failures = 0
const createdEmails = []
const createdAgentIds = []
const createdOrderNumbers = []
const createdExpenseIds = []
const tempStaff = []

function pass(name, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!condition) failures += 1
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function cookieOf(response) {
  const list = response.headers.getSetCookie ? response.headers.getSetCookie() : []
  const raw = list.find(item => item.startsWith('ff-admin=')) || list[0]
  return raw ? raw.split(';')[0] : ''
}

async function request(path, { method = 'GET', cookie, body, raw = false } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const contentType = response.headers.get('content-type') || ''
  if (raw || !contentType.includes('application/json')) {
    const text = await response.text()
    return { status: response.status, body: text, contentType, cookie: cookieOf(response) }
  }
  const json = await response.json().catch(() => null)
  return { status: response.status, body: json, contentType, cookie: cookieOf(response) }
}

async function createOrder(label, { fulfilment = 'delivery', productId = 1, quantity = 1 } = {}) {
  const email = `ff-admin-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  createdEmails.push(email)
  const payload = {
    clientOrderId: `admin-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    customer: { fullName: `Admin Test ${label}`, email, phone: '9812345670' },
    fulfilment,
    paymentMethod: 'cash_on_delivery',
    items: [{ productId, quantity }],
  }
  if (fulfilment === 'delivery') {
    payload.address = { recipientName: `Admin Test ${label}`, phone: '9812345670', line1: '9 Admin Lane', city: 'Bengaluru', postalCode: '560009' }
  }
  const result = await request('/api/orders', { method: 'POST', body: payload })
  if (result.status !== 201) throw new Error(`Order ${label} failed: ${result.status} ${JSON.stringify(result.body)}`)
  createdOrderNumbers.push(result.body.order.orderNumber)
  return { orderNumber: result.body.order.orderNumber, total: result.body.order.total, email }
}

async function createAgent(label, overrides = {}) {
  const body = {
    name: `Test Agent ${label}`,
    phone: `98123${String(Math.floor(Math.random() * 90000) + 10000)}`,
    vehicleType: 'bike',
    capacity: 5,
    ...overrides,
  }
  const result = await request('/api/admin/agents', { method: 'POST', cookie: adminCookie, body })
  if (result.status !== 201) throw new Error(`Agent ${label} failed: ${result.status} ${JSON.stringify(result.body)}`)
  createdAgentIds.push(result.body.agent.id)
  return result.body.agent
}

async function createStaff(role) {
  const email = `ff-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`
  createdEmails.push(email)
  const [user] = await db.execute(
    "INSERT INTO users (firebase_uid, email, full_name, role_id) VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = ? LIMIT 1))",
    [`test-staff:${email}`, email, `Test ${role}`, role],
  )
  const [admin] = await db.execute(
    "INSERT INTO admins (user_id, role_id) VALUES (?, (SELECT id FROM roles WHERE name = ? LIMIT 1))",
    [user.insertId, role],
  )
  const sid = randomUUID()
  const token = jwt.sign({ sub: String(admin.insertId), role, sid }, process.env.SESSION_SECRET, { expiresIn: '1h', issuer: 'fresh-farm-api', audience: 'fresh-farm-admin' })
  await db.execute('INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [sid, admin.insertId, createHash('sha256').update(token).digest('hex')])
  const staff = { role, adminId: admin.insertId, userId: user.insertId, email, cookie: `ff-admin=${token}` }
  tempStaff.push(staff)
  return staff
}

let adminCookie = ''
let realAdmin = null

async function testAuthAndSetup() {
  const status = await request('/api/auth/admin/setup-status')
  pass('Setup status reports a pending owner setup', status.status === 200 && status.body.setupRequired === true && status.body.adminProvisioned === true, JSON.stringify(status.body))

  const wrongBootstrap = await request('/api/auth/admin/setup', { method: 'POST', body: { bootstrapPassword: 'wrong-password', password: ADMIN_PASS, pin: PIN } })
  pass('Setup rejects a wrong bootstrap password (401)', wrongBootstrap.status === 401, `status ${wrongBootstrap.status}`)

  const setup = await request('/api/auth/admin/setup', { method: 'POST', body: { bootstrapPassword: BOOTSTRAP, password: ADMIN_PASS, pin: PIN } })
  pass('Owner setup creates credentials and a session (201)', setup.status === 201 && Boolean(setup.cookie), `status ${setup.status}`)
  adminCookie = setup.cookie
  const [hashed] = await db.execute('SELECT password_hash, pin_hash FROM admins WHERE id = ?', [realAdmin.id])
  pass('Password and PIN stored as Argon2id hashes', String(hashed[0].password_hash).startsWith('$argon2id$') && String(hashed[0].pin_hash).startsWith('$argon2id$'))

  const session = await request('/api/admin/session', { cookie: adminCookie })
  pass('Setup session can read its own session', session.status === 200 && session.body?.admin?.role === 'ADMIN', `status ${session.status}`)

  const repeat = await request('/api/auth/admin/setup', { method: 'POST', body: { bootstrapPassword: BOOTSTRAP, password: ADMIN_PASS, pin: PIN } })
  pass('Setup is refused once credentials exist (409)', repeat.status === 409, `status ${repeat.status}`)

  const wrongLogin = await request('/api/auth/admin/password-login', { method: 'POST', body: { password: 'not-the-password' } })
  pass('Wrong password rejected (401)', wrongLogin.status === 401, `status ${wrongLogin.status}`)

  const login = await request('/api/auth/admin/password-login', { method: 'POST', body: { password: ADMIN_PASS } })
  pass('Password login succeeds (200)', login.status === 200 && Boolean(login.cookie), `status ${login.status}`)
  const sessionB = login.cookie

  const pinLogin = await request('/api/auth/admin/pin-login', { method: 'POST', body: { pin: PIN } })
  pass('PIN login succeeds (200)', pinLogin.status === 200 && Boolean(pinLogin.cookie), `status ${pinLogin.status}`)
  const sessionC = pinLogin.cookie

  const reset = await request('/api/auth/admin/password-reset', { method: 'POST', body: { bootstrapPassword: BOOTSTRAP, newPassword: NEW_PASS, newPin: '519273' } })
  pass('Bootstrap password reset succeeds (200)', reset.status === 200 && Boolean(reset.cookie), `status ${reset.status}`)
  const sessionD = reset.cookie

  const oldSession = await request('/api/admin/session', { cookie: adminCookie })
  pass('Reset revokes previously issued sessions (401)', oldSession.status === 401, `status ${oldSession.status}`)
  const oldB = await request('/api/admin/session', { cookie: sessionB })
  pass('Reset revokes the password-login session (401)', oldB.status === 401, `status ${oldB.status}`)
  const oldC = await request('/api/admin/session', { cookie: sessionC })
  pass('Reset revokes the PIN session (401)', oldC.status === 401, `status ${oldC.status}`)

  const newPasswordLogin = await request('/api/auth/admin/password-login', { method: 'POST', body: { password: NEW_PASS } })
  pass('New password works (200)', newPasswordLogin.status === 200 && Boolean(newPasswordLogin.cookie), `status ${newPasswordLogin.status}`)
  const sessionE = newPasswordLogin.cookie

  const change = await request('/api/auth/admin/credentials', { method: 'POST', cookie: sessionE, body: { currentPassword: NEW_PASS, newPassword: FINAL_PASS, newPin: PIN } })
  pass('Credential change accepted (200)', change.status === 200, `status ${change.status}`)
  const revokedOther = await request('/api/admin/session', { cookie: sessionD })
  pass('Credential change revokes other sessions (401)', revokedOther.status === 401, `status ${revokedOther.status}`)
  const kept = await request('/api/admin/session', { cookie: sessionE })
  pass('Current session stays valid after change (200)', kept.status === 200, `status ${kept.status}`)

  const wrongCurrent = await request('/api/auth/admin/credentials', { method: 'POST', cookie: sessionE, body: { currentPassword: 'nope', newPassword: 'Another-Password-2026' } })
  pass('Credential change requires the current password (401)', wrongCurrent.status === 401, `status ${wrongCurrent.status}`)

  const weakPassword = await request('/api/auth/admin/credentials', { method: 'POST', cookie: sessionE, body: { currentPassword: FINAL_PASS, newPassword: 'short' } })
  pass('Weak replacement password rejected (400)', weakPassword.status === 400, `status ${weakPassword.status}`)

  adminCookie = sessionE
}

async function testPermissions() {
  const noCookie = await request('/api/admin/orders')
  pass('Admin API without a session is rejected (401)', noCookie.status === 401, `status ${noCookie.status}`)
  const badCookie = await request('/api/admin/orders', { cookie: 'ff-admin=not-a-token' })
  pass('Admin API with a forged cookie is rejected (401)', badCookie.status === 401, `status ${badCookie.status}`)

  const manager = await createStaff('MANAGER')
  const orderManager = await createStaff('ORDER_MANAGER')

  const omOrders = await request('/api/admin/orders', { cookie: orderManager.cookie })
  pass('ORDER_MANAGER can list orders (200)', omOrders.status === 200, `status ${omOrders.status}`)
  const omAgents = await request('/api/admin/agents', { cookie: orderManager.cookie })
  pass('ORDER_MANAGER can list agents (200)', omAgents.status === 200, `status ${omAgents.status}`)
  const omAnalytics = await request('/api/admin/analytics', { cookie: orderManager.cookie })
  pass('ORDER_MANAGER cannot read analytics (403)', omAnalytics.status === 403, `status ${omAnalytics.status}`)
  const omExpenses = await request('/api/admin/expenses', { cookie: orderManager.cookie })
  pass('ORDER_MANAGER cannot read expenses (403)', omExpenses.status === 403, `status ${omExpenses.status}`)
  const omCreateAgent = await request('/api/admin/agents', { method: 'POST', cookie: orderManager.cookie, body: { name: 'Nope', phone: '9812340000', capacity: 2 } })
  pass('ORDER_MANAGER cannot create agents (403)', omCreateAgent.status === 403, `status ${omCreateAgent.status}`)

  const mgrAnalytics = await request('/api/admin/analytics', { cookie: manager.cookie })
  pass('MANAGER can read analytics (200)', mgrAnalytics.status === 200, `status ${mgrAnalytics.status}`)
  const mgrProfile = await request('/api/admin/profile', { cookie: manager.cookie })
  pass('MANAGER can read their own profile (200)', mgrProfile.status === 200, `status ${mgrProfile.status}`)
}

async function testAgentsAndWorkflow() {
  const agent1 = await createAgent('One')
  const agent2 = await createAgent('Two')
  const agentSpare = await createAgent('Spare')
  const agentCap = await createAgent('Cap', { capacity: 1 })

  const dup = await request('/api/admin/agents', { method: 'POST', cookie: adminCookie, body: { name: 'Duplicate', phone: agent1.phone, capacity: 3 } })
  pass('Duplicate agent phone rejected (409)', dup.status === 409, `status ${dup.status}`)
  const badAgent = await request('/api/admin/agents', { method: 'POST', cookie: adminCookie, body: { name: 'X', phone: 'abc', capacity: 0 } })
  pass('Invalid agent payload rejected (400)', badAgent.status === 400, `status ${badAgent.status}`)

  const orderA = await createOrder('a')
  const orderB = await createOrder('b')
  const orderC = await createOrder('c')
  const orderD = await createOrder('d')
  const pickupOrder = await createOrder('pickup', { fulfilment: 'pickup' })

  const pickupAssign = await request(`/api/admin/orders/${pickupOrder.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agent1.id } })
  pass('Pickup orders cannot be assigned an agent (409)', pickupAssign.status === 409, `status ${pickupAssign.status}`)

  const assign = await request(`/api/admin/orders/${orderA.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agent1.id, note: 'First run' } })
  pass('Delivery agent assigned (200)', assign.status === 200 && assign.body?.agent?.id === agent1.id, `status ${assign.status}`)
  const detail = await request(`/api/admin/orders/${orderA.orderNumber}`, { cookie: adminCookie })
  pass('Order detail shows the assigned agent', detail.body?.order?.deliveryAgent?.name === agent1.name, detail.body?.order?.deliveryAgent?.name)
  pass('Order detail shows an active assignment', detail.body?.order?.assignments?.[0]?.status === 'active', detail.body?.order?.assignments?.[0]?.status)

  // Two admins reassigning the same order at the same instant must never leave
  // two active assignments behind.
  const [r1, r2] = await Promise.all([
    request(`/api/admin/orders/${orderA.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agent2.id } }),
    request(`/api/admin/orders/${orderA.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agentSpare.id } }),
  ])
  const [activeA] = await db.execute("SELECT COUNT(*) AS c FROM order_assignments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?) AND status = 'active'", [orderA.orderNumber])
  pass('Parallel reassignment leaves exactly one active assignment', Number(activeA[0].c) === 1, `${activeA[0].c} active (statuses ${r1.status}, ${r2.status})`)

  // Capacity-1 agent: only one of two simultaneous assignments may win.
  const [c1, c2] = await Promise.all([
    request(`/api/admin/orders/${orderB.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agentCap.id } }),
    request(`/api/admin/orders/${orderC.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agentCap.id } }),
  ])
  const capStatuses = [c1.status, c2.status].sort()
  pass('Capacity limit enforced under concurrency (one 200, one 409)', capStatuses[0] === 200 && capStatuses[1] === 409, `statuses ${c1.status}, ${c2.status}`)
  const [capLoad] = await db.execute("SELECT COUNT(*) AS c FROM orders WHERE delivery_agent_id = ? AND status IN ('pending','accepted','preparing','ready','out_for_delivery')", [agentCap.id])
  pass('Capacity-1 agent holds at most one active order', Number(capLoad[0].c) <= 1, `${capLoad[0].c} active`)

  const failedOrder = c1.status === 409 ? orderB : orderC
  const retry = await request(`/api/admin/orders/${failedOrder.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agent2.id } })
  pass('Rejected assignment succeeds with a free agent (200)', retry.status === 200, `status ${retry.status}`)

  const unassign = await request(`/api/admin/orders/${failedOrder.orderNumber}/unassign`, { method: 'POST', cookie: adminCookie, body: {} })
  pass('Assignment removed (200)', unassign.status === 200, `status ${unassign.status}`)
  const unassignAgain = await request(`/api/admin/orders/${failedOrder.orderNumber}/unassign`, { method: 'POST', cookie: adminCookie, body: {} })
  pass('Second unassign rejected (409)', unassignAgain.status === 409, `status ${unassignAgain.status}`)

  const skip = await request(`/api/admin/orders/${orderB.orderNumber}/status`, { method: 'PATCH', cookie: adminCookie, body: { status: 'delivered' } })
  pass('Illegal status jump rejected (409)', skip.status === 409, `status ${skip.status}`)

  // Walk order D to ready, then prove delivery cannot start without an agent.
  for (const status of ['accepted', 'preparing', 'ready']) {
    const step = await request(`/api/admin/orders/${orderD.orderNumber}/status`, { method: 'PATCH', cookie: adminCookie, body: { status } })
    if (step.status !== 200) throw new Error(`Workflow ${status} failed: ${step.status} ${JSON.stringify(step.body)}`)
  }
  const noAgent = await request(`/api/admin/orders/${orderD.orderNumber}/status`, { method: 'PATCH', cookie: adminCookie, body: { status: 'out_for_delivery' } })
  pass('Out for delivery requires an assigned agent (409)', noAgent.status === 409, `status ${noAgent.status}`)

  const cancel = await request(`/api/admin/orders/${orderD.orderNumber}/status`, { method: 'PATCH', cookie: adminCookie, body: { status: 'cancelled', note: 'Test cancellation' } })
  pass('Order cancelled from ready (200)', cancel.status === 200, `status ${cancel.status}`)
  const [cancelled] = await db.execute('SELECT status, cancelled_at, cancellation_reason FROM orders WHERE order_number = ?', [orderD.orderNumber])
  pass('Cancellation persisted with timestamp and reason', cancelled[0].status === 'cancelled' && Boolean(cancelled[0].cancelled_at) && cancelled[0].cancellation_reason === 'Test cancellation', JSON.stringify(cancelled[0]))

  // Deliver order A through the full flow.
  const [activeAssignment] = await db.execute("SELECT agent_id FROM order_assignments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?) AND status = 'active'", [orderA.orderNumber])
  const deliveryAgentId = Number(activeAssignment[0].agent_id)
  for (const status of ['accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered']) {
    const step = await request(`/api/admin/orders/${orderA.orderNumber}/status`, { method: 'PATCH', cookie: adminCookie, body: { status } })
    if (step.status !== 200) throw new Error(`Workflow ${status} failed: ${step.status} ${JSON.stringify(step.body)}`)
  }
  const [delivered] = await db.execute('SELECT status, delivered_at, total_final, delivery_agent_id FROM orders WHERE order_number = ?', [orderA.orderNumber])
  pass('Delivered order stores timestamp and final total', delivered[0].status === 'delivered' && Boolean(delivered[0].delivered_at) && Number(delivered[0].total_final) > 0, JSON.stringify(delivered[0]))
  const [closedAssignment] = await db.execute("SELECT status FROM order_assignments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?) ORDER BY id DESC LIMIT 1", [orderA.orderNumber])
  pass('Delivery closes the active assignment as completed', closedAssignment[0].status === 'completed', closedAssignment[0].status)
  pass('Delivered order keeps its agent for history', Number(delivered[0].delivery_agent_id) === deliveryAgentId, `${delivered[0].delivery_agent_id} vs ${deliveryAgentId}`)

  const deleteUsed = await request(`/api/admin/agents/${agent1.id}`, { method: 'DELETE', cookie: adminCookie })
  pass('Agent with assignment history cannot be deleted (409)', deleteUsed.status === 409, `status ${deleteUsed.status}`)
  const deactivateFree = await request(`/api/admin/agents/${agent2.id}`, { method: 'PATCH', cookie: adminCookie, body: { isActive: false } })
  pass('Free agent can be deactivated (200)', deactivateFree.status === 200 && deactivateFree.body?.agent?.isActive === false, `status ${deactivateFree.status}`)
  const assignInactive = await request(`/api/admin/orders/${orderC.orderNumber}/assign`, { method: 'POST', cookie: adminCookie, body: { agentId: agent2.id } })
  pass('Inactive agent cannot be assigned (409)', assignInactive.status === 409, `status ${assignInactive.status}`)

  const throwaway = await createAgent('Throwaway')
  const deleted = await request(`/api/admin/agents/${throwaway.id}`, { method: 'DELETE', cookie: adminCookie })
  pass('Unused agent can be deleted (200)', deleted.status === 200, `status ${deleted.status}`)
  createdAgentIds.splice(createdAgentIds.indexOf(throwaway.id), 1)

  const list = await request('/api/admin/agents?includeInactive=true', { cookie: adminCookie })
  pass('Agent list reports workloads', list.status === 200 && list.body.agents.every(agent => agent.activeOrders !== undefined), `status ${list.status}`)

  const monitoring = await request('/api/admin/assignments', { cookie: adminCookie })
  pass('Assignment monitoring lists active work and workload', monitoring.status === 200 && Array.isArray(monitoring.body.assignments) && Array.isArray(monitoring.body.workload), `status ${monitoring.status}`)

  const search = await request(`/api/admin/orders?search=${encodeURIComponent(orderA.orderNumber)}`, { cookie: adminCookie })
  pass('Order search finds the order', search.status === 200 && search.body.orders.some(order => order.orderNumber === orderA.orderNumber), `status ${search.status}`)
  const filtered = await request('/api/admin/orders?status=delivered&limit=5', { cookie: adminCookie })
  pass('Order status filter returns only delivered orders', filtered.status === 200 && filtered.body.orders.every(order => order.status === 'delivered'), `status ${filtered.status}`)
}

async function testExpensesAndAnalytics() {
  const created = await request('/api/admin/expenses', { method: 'POST', cookie: adminCookie, body: { category: 'delivery', title: 'Test fuel', amount: 100, expenseDate: today(), notes: 'automated test' } })
  pass('Expense created (201)', created.status === 201 && created.body.expense.amount === 100, `status ${created.status}`)
  createdExpenseIds.push(created.body.expense.id)
  const updated = await request(`/api/admin/expenses/${created.body.expense.id}`, { method: 'PATCH', cookie: adminCookie, body: { category: 'delivery', title: 'Test fuel', amount: 120, expenseDate: today() } })
  pass('Expense updated (200)', updated.status === 200 && updated.body.expense.amount === 120, `status ${updated.status}`)
  const badExpense = await request('/api/admin/expenses', { method: 'POST', cookie: adminCookie, body: { category: 'delivery', title: 'Bad', amount: 0, expenseDate: today() } })
  pass('Zero-amount expense rejected (400)', badExpense.status === 400, `status ${badExpense.status}`)

  const salary = await request('/api/admin/expenses', { method: 'POST', cookie: adminCookie, body: { category: 'salaries', title: 'Test wages', amount: 250, expenseDate: today() } })
  createdExpenseIds.push(salary.body.expense.id)
  pass('Second expense created (201)', salary.status === 201, `status ${salary.status}`)

  const day = today()
  const analytics = await request(`/api/admin/analytics?range=daily&from=${day}&to=${day}`, { cookie: adminCookie })
  pass('Analytics summary loads (200)', analytics.status === 200, `status ${analytics.status}`)
  const summary = analytics.body

  const [orderCount] = await db.query('SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)', [`${day} 00:00:00`, day])
  pass('Order count matches the database', summary.totals.orders === Number(orderCount[0].c), `${summary.totals.orders} vs ${orderCount[0].c}`)

  const [revenue] = await db.query("SELECT SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS revenue FROM orders WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)", [`${day} 00:00:00`, day])
  pass('Revenue matches the database', Math.abs(summary.totals.revenue - Number(revenue[0].revenue || 0)) < 0.01, `${summary.totals.revenue} vs ${revenue[0].revenue}`)

  const [cogs] = await db.query("SELECT SUM(i.cost_snapshot * COALESCE(i.actual_quantity, i.requested_quantity)) AS cogs FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status <> 'cancelled' AND o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)", [`${day} 00:00:00`, day])
  pass('COGS matches the database', Math.abs(summary.totals.cogs - Number(cogs[0].cogs || 0)) < 0.01, `${summary.totals.cogs} vs ${cogs[0].cogs}`)

  const [expenseTotal] = await db.query('SELECT SUM(amount) AS total FROM operating_expenses WHERE expense_date = ?', [day])
  pass('Expenses match the database', Math.abs(summary.totals.expenses - Number(expenseTotal[0].total || 0)) < 0.01, `${summary.totals.expenses} vs ${expenseTotal[0].total}`)
  pass('Net profit = revenue − COGS − expenses', Math.abs(summary.totals.netProfit - (summary.totals.revenue - summary.totals.cogs - summary.totals.expenses)) < 0.01, String(summary.totals.netProfit))

  pass('Daily series has one bucket for a single day', summary.series.length === 1 && summary.series[0].key === day, `${summary.series.length} buckets`)
  const seriesRevenue = Math.round(summary.series.reduce((sum, bucket) => sum + bucket.revenue, 0) * 100) / 100
  pass('Series revenue sums to the totals', Math.abs(seriesRevenue - summary.totals.revenue) < 0.01, `${seriesRevenue} vs ${summary.totals.revenue}`)
  const statusCount = summary.breakdown.status.reduce((sum, row) => sum + row.count, 0)
  pass('Status breakdown covers every order', statusCount === summary.totals.orders, `${statusCount} vs ${summary.totals.orders}`)
  pass('Top products include the ordered product', summary.products.some(product => product.name === 'Farm Fresh Whole Chicken' && product.revenue > 0), JSON.stringify(summary.products[0] || null))
  pass('Delivery performance measured for delivered orders', summary.totals.deliveredWithAgent >= 1 && summary.totals.averageDeliveryMinutes !== null, JSON.stringify({ delivered: summary.totals.deliveredWithAgent, minutes: summary.totals.averageDeliveryMinutes }))
  pass('Agent performance lists a delivery', summary.agents.some(agent => agent.deliveries >= 1), JSON.stringify(summary.agents))
  pass('Changes comparison is numeric', typeof summary.changes.ordersPercent === 'number' && typeof summary.changes.revenuePercent === 'number', JSON.stringify(summary.changes))

  const monthly = await request('/api/admin/analytics?range=monthly', { cookie: adminCookie })
  pass('Monthly range loads with month buckets', monthly.status === 200 && monthly.body.series.length >= 1 && /^\d{4}-\d{2}$/.test(monthly.body.series.at(-1).key), `status ${monthly.status}`)
  const annual = await request('/api/admin/analytics?range=annual', { cookie: adminCookie })
  pass('Annual range loads with year buckets', annual.status === 200 && /^\d{4}$/.test(annual.body.series.at(-1).key), `status ${annual.status}`)
  const weekly = await request('/api/admin/analytics?range=weekly', { cookie: adminCookie })
  pass('Weekly range loads with Monday buckets', weekly.status === 200 && weekly.body.series.length >= 1, `status ${weekly.status}`)
  const badRange = await request(`/api/admin/analytics?range=daily&from=${day}&to=2020-01-01`, { cookie: adminCookie })
  pass('Invalid date window rejected (400)', badRange.status === 400, `status ${badRange.status}`)

  const expenseList = await request(`/api/admin/expenses?from=${day}&to=${day}`, { cookie: adminCookie })
  pass('Expense list filters by date', expenseList.status === 200 && expenseList.body.expenses.length >= 2, `${expenseList.body.expenses?.length} rows`)
  const removed = await request(`/api/admin/expenses/${created.body.expense.id}`, { method: 'DELETE', cookie: adminCookie })
  pass('Expense deleted (200)', removed.status === 200, `status ${removed.status}`)
  createdExpenseIds.splice(createdExpenseIds.indexOf(created.body.expense.id), 1)
}

async function testReportsAndProfile() {
  const day = today()
  const ordersCsv = await request('/api/admin/reports/orders.csv', { cookie: adminCookie, raw: true })
  pass('Orders CSV downloads', ordersCsv.status === 200 && ordersCsv.contentType.includes('text/csv') && ordersCsv.body.includes('Order number'), `status ${ordersCsv.status}`)
  pass('Orders CSV includes a real order', createdOrderNumbers.some(number => ordersCsv.body.includes(number)))

  const analyticsCsv = await request(`/api/admin/reports/analytics.csv?range=daily&from=${day}&to=${day}`, { cookie: adminCookie, raw: true })
  pass('Analytics CSV downloads with the period row', analyticsCsv.status === 200 && analyticsCsv.body.includes(day), `status ${analyticsCsv.status}`)

  const expensesCsv = await request('/api/admin/reports/expenses.csv', { cookie: adminCookie, raw: true })
  pass('Expenses CSV downloads with the test expense', expensesCsv.status === 200 && expensesCsv.body.includes('Test wages'), `status ${expensesCsv.status}`)

  const orderManager = tempStaff.find(staff => staff.role === 'ORDER_MANAGER')
  const forbiddenCsv = await request('/api/admin/reports/orders.csv', { cookie: orderManager.cookie, raw: true })
  pass('ORDER_MANAGER cannot download finance reports (403)', forbiddenCsv.status === 403, `status ${forbiddenCsv.status}`)

  const profile = await request('/api/admin/profile', { cookie: adminCookie })
  pass('Profile loads for the signed-in admin', profile.status === 200 && profile.body.profile.email === realAdmin.email, `status ${profile.status}`)
  const updated = await request('/api/admin/profile', { method: 'PATCH', cookie: adminCookie, body: { displayName: 'Test Owner', phone: '9800000001', profileImageUrl: PNG } })
  pass('Profile update stores name, phone and avatar', updated.status === 200 && updated.body.profile.displayName === 'Test Owner' && updated.body.profile.profileImageUrl === PNG, `status ${updated.status}`)
  const badAvatar = await request('/api/admin/profile', { method: 'PATCH', cookie: adminCookie, body: { profileImageUrl: 'data:text/html;base64,AAAA' } })
  pass('Non-image avatar rejected (400)', badAvatar.status === 400, `status ${badAvatar.status}`)
  const shortName = await request('/api/admin/profile', { method: 'PATCH', cookie: adminCookie, body: { displayName: 'x' } })
  pass('Too-short display name rejected (400)', shortName.status === 400, `status ${shortName.status}`)
}

async function main() {
  process.env.ADMIN_PASSWORD_HASH = await argon2.hash(BOOTSTRAP, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  const server = app.listen(0)
  await once(server, 'listening')
  BASE = `http://127.0.0.1:${server.address().port}`

  const [admins] = await db.execute('SELECT a.id, a.display_name, a.profile_image_url, a.password_hash, a.pin_hash, a.password_updated_at, a.last_login_at, u.full_name, u.email, u.phone FROM admins a JOIN users u ON u.id = a.user_id WHERE a.is_active = 1 ORDER BY a.id LIMIT 1')
  realAdmin = admins[0]
  if (!realAdmin) throw new Error('No admin row to test against.')

  // Clear the owner's database credentials so the first-time setup flow is
  // testable, then put the exact same hashes back in the finally block.
  await db.execute('UPDATE admins SET password_hash = NULL, pin_hash = NULL WHERE id = ?', [realAdmin.id])
  await db.query('DELETE FROM admin_sessions WHERE admin_id = ?', [realAdmin.id])

  try {
    await testAuthAndSetup()
    await testPermissions()
    await testAgentsAndWorkflow()
    await testExpensesAndAnalytics()
    await testReportsAndProfile()
  } finally {
    server.close()
    // Remove every disposable row this test created.
    const staffAdminIds = tempStaff.map(staff => staff.adminId)
    if (staffAdminIds.length) await db.query('DELETE FROM admin_sessions WHERE admin_id IN (?)', [staffAdminIds])
    if (staffAdminIds.length) await db.query('DELETE FROM admins WHERE id IN (?)', [staffAdminIds])
    if (createdOrderNumbers.length) {
      const [orders] = await db.query('SELECT id, customer_id FROM orders WHERE order_number IN (?)', [createdOrderNumbers])
      const orderIds = orders.map(row => Number(row.id))
      const customerIds = [...new Set(orders.map(row => Number(row.customer_id)))]
      if (orderIds.length) {
        await db.query('DELETE FROM order_status_events WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM order_assignments WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM payments WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM order_items WHERE order_id IN (?)', [orderIds])
        await db.query('DELETE FROM orders WHERE id IN (?)', [orderIds])
      }
      if (customerIds.length) {
        await db.query('DELETE FROM addresses WHERE user_id IN (?)', [customerIds])
        await db.query('DELETE FROM users WHERE id IN (?) AND (firebase_uid LIKE ? OR firebase_uid LIKE ?)', [customerIds, 'guest:%', 'test-staff:%'])
      }
    }
    if (createdEmails.length) {
      const [leftover] = await db.query('SELECT id FROM users WHERE email IN (?)', [createdEmails])
      const ids = leftover.map(row => Number(row.id))
      if (ids.length) {
        await db.query('DELETE FROM admin_sessions WHERE admin_id IN (SELECT id FROM admins WHERE user_id IN (?))', [ids])
        await db.query('DELETE FROM admins WHERE user_id IN (?)', [ids])
        await db.query('DELETE FROM users WHERE id IN (?)', [ids])
      }
    }
    if (createdAgentIds.length) await db.query('DELETE FROM delivery_agents WHERE id IN (?)', [createdAgentIds])
    if (createdExpenseIds.length) await db.query('DELETE FROM operating_expenses WHERE id IN (?)', [createdExpenseIds])

    // Restore the owner account exactly as it was found.
    await db.execute('UPDATE admins SET password_hash = ?, pin_hash = ?, display_name = ?, profile_image_url = ?, password_updated_at = ?, last_login_at = ? WHERE id = ?', [realAdmin.password_hash, realAdmin.pin_hash, realAdmin.display_name, realAdmin.profile_image_url, realAdmin.password_updated_at, realAdmin.last_login_at, realAdmin.id])
    await db.execute('UPDATE users SET full_name = ?, phone = ? WHERE id = (SELECT user_id FROM admins WHERE id = ?)', [realAdmin.full_name, realAdmin.phone, realAdmin.id])
    await db.query('DELETE FROM admin_sessions WHERE admin_id = ?', [realAdmin.id])

    const [verifyUsers] = await db.query('SELECT COUNT(*) AS c FROM users WHERE email IN (?)', [createdEmails.length ? createdEmails : ['']])
    const [verifyOrders] = await db.query('SELECT COUNT(*) AS c FROM orders WHERE order_number IN (?)', [createdOrderNumbers.length ? createdOrderNumbers : ['']])
    const [verifyAgents] = await db.query('SELECT COUNT(*) AS c FROM delivery_agents WHERE id IN (?)', [createdAgentIds.length ? createdAgentIds : ['']])
    const [verifyAdmin] = await db.execute('SELECT password_hash, pin_hash, display_name, profile_image_url FROM admins WHERE id = ?', [realAdmin.id])
    const clean = Number(verifyUsers[0].c) === 0 && Number(verifyOrders[0].c) === 0 && Number(verifyAgents[0].c) === 0 && verifyAdmin[0].password_hash === realAdmin.password_hash && verifyAdmin[0].pin_hash === realAdmin.pin_hash && verifyAdmin[0].display_name === realAdmin.display_name
    pass('Test data cleaned up and owner account restored', clean, JSON.stringify({ users: verifyUsers[0].c, orders: verifyOrders[0].c, agents: verifyAgents[0].c, credentials: verifyAdmin[0].password_hash !== null }))
    await db.end()
  }

  console.log(failures === 0 ? '\nAll admin checks passed.' : `\n${failures} admin check(s) failed.`)
  if (failures) process.exitCode = 1
}

main().catch(async error => {
  console.error('TEST ERROR', error)
  try { await db.end() } catch { /* pool already closed */ }
  process.exit(1)
})
