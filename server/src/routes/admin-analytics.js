const express = require('express')
const db = require('../config/db')

const router = express.Router()
const RANGES = ['daily', 'weekly', 'monthly', 'annual']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000
const MAX_BUCKETS = 400

const ACTIVE_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery']

function pad(value) {
  return String(value).padStart(2, '0')
}

function ymd(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function mondayOf(date) {
  const copy = new Date(date.getTime())
  const day = copy.getUTCDay() || 7
  copy.setUTCDate(copy.getUTCDate() - (day - 1))
  return copy
}

function firstOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/**
 * Resolves the requested reporting window into a start/end date plus a stable
 * set of buckets. Bucket keys are produced both in JavaScript and as SQL date
 * expressions so chart series and SQL aggregates always line up.
 */
function resolveRange(query) {
  const range = RANGES.includes(query.range) ? query.range : 'daily'
  const today = new Date()
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  let to = parseDate(query.to)
  if (!to) to = todayUtc
  if (to > todayUtc) to = todayUtc
  let from = parseDate(query.from)
  if (!from) {
    if (range === 'daily') from = new Date(to.getTime() - 29 * DAY_MS)
    else if (range === 'weekly') from = mondayOf(new Date(to.getTime() - 11 * 7 * DAY_MS))
    else if (range === 'monthly') from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1))
    else from = new Date(Date.UTC(to.getUTCFullYear() - 4, 0, 1))
  }
  if (range === 'weekly') from = mondayOf(from)
  if (range === 'monthly') from = firstOfMonth(from)
  if (range === 'annual') from = new Date(Date.UTC(from.getUTCFullYear(), 0, 1))
  if (from > to) return { error: 'The start date must be before the end date.' }

  const buckets = []
  if (range === 'daily') {
    for (let cursor = new Date(from.getTime()); cursor <= to && buckets.length < MAX_BUCKETS; cursor = new Date(cursor.getTime() + DAY_MS)) {
      buckets.push({ key: ymd(cursor), label: `${pad(cursor.getUTCDate())} ${MONTHS[cursor.getUTCMonth()]}` })
    }
  } else if (range === 'weekly') {
    for (let cursor = new Date(from.getTime()); cursor <= to && buckets.length < MAX_BUCKETS; cursor = new Date(cursor.getTime() + 7 * DAY_MS)) {
      buckets.push({ key: ymd(cursor), label: `Week of ${pad(cursor.getUTCDate())} ${MONTHS[cursor.getUTCMonth()]}` })
    }
  } else if (range === 'monthly') {
    for (let cursor = firstOfMonth(from); cursor <= to && buckets.length < MAX_BUCKETS; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
      buckets.push({ key: `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}`, label: `${MONTHS[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}` })
    }
  } else {
    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear() && buckets.length < MAX_BUCKETS; year += 1) {
      buckets.push({ key: String(year), label: String(year) })
    }
  }
  if (!buckets.length) buckets.push({ key: range === 'annual' ? String(to.getUTCFullYear()) : range === 'monthly' ? ymd(to).slice(0, 7) : ymd(to), label: ymd(to) })

  const bucketOrder = range === 'daily'
    ? "DATE_FORMAT(o.created_at, '%Y-%m-%d')"
    : range === 'weekly'
      ? "DATE_FORMAT(DATE_SUB(DATE(o.created_at), INTERVAL WEEKDAY(o.created_at) DAY), '%Y-%m-%d')"
      : range === 'monthly'
        ? "DATE_FORMAT(o.created_at, '%Y-%m')"
        : "DATE_FORMAT(o.created_at, '%Y')"
  const bucketExpense = range === 'daily'
    ? "DATE_FORMAT(e.expense_date, '%Y-%m-%d')"
    : range === 'weekly'
      ? "DATE_FORMAT(DATE_SUB(DATE(e.expense_date), INTERVAL WEEKDAY(e.expense_date) DAY), '%Y-%m-%d')"
      : range === 'monthly'
        ? "DATE_FORMAT(e.expense_date, '%Y-%m')"
        : "DATE_FORMAT(e.expense_date, '%Y')"

  const span = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1
  const previousTo = new Date(from.getTime() - DAY_MS)
  const previousFrom = new Date(previousTo.getTime() - (span - 1) * DAY_MS)
  return {
    range,
    from,
    to,
    fromDay: ymd(from),
    toDay: ymd(to),
    fromTimestamp: `${ymd(from)} 00:00:00`,
    toTimestamp: `${ymd(to)} 00:00:00`,
    toExclusive: `${ymd(new Date(to.getTime() + DAY_MS))} 00:00:00`,
    previousFromDay: ymd(previousFrom),
    previousToDay: ymd(previousTo),
    previousFromTimestamp: `${ymd(previousFrom)} 00:00:00`,
    previousToExclusive: `${ymd(new Date(previousTo.getTime() + DAY_MS))} 00:00:00`,
    buckets,
    bucketOrder,
    bucketExpense,
  }
}

async function orderSeries(window) {
  const [rows] = await db.query(
    `SELECT ${window.bucketOrder} AS bucket,
            COUNT(*) AS orders,
            SUM(o.status = 'delivered') AS delivered,
            SUM(o.status = 'cancelled') AS cancelled,
            SUM(CASE WHEN o.status <> 'cancelled' THEN COALESCE(o.total_final, o.total_estimated) ELSE 0 END) AS revenue,
            SUM(CASE WHEN o.payment_status = 'paid' AND o.status <> 'cancelled' THEN COALESCE(o.total_final, o.total_estimated) ELSE 0 END) AS collected,
            SUM(CASE WHEN o.payment_status <> 'paid' AND o.status <> 'cancelled' THEN COALESCE(o.total_final, o.total_estimated) ELSE 0 END) AS outstanding,
            SUM(CASE WHEN o.status <> 'cancelled' THEN o.discount_amount ELSE 0 END) AS customer_savings,
            SUM(CASE WHEN o.payment_status = 'paid' AND o.status <> 'cancelled' THEN 1 ELSE 0 END) AS paid_orders
     FROM orders o
     WHERE o.created_at >= ? AND o.created_at < ?
     GROUP BY bucket ORDER BY bucket`,
    [window.fromTimestamp, window.toExclusive],
  )
  return rows
}

async function cogsSeries(window) {
  const [rows] = await db.query(
    `SELECT ${window.bucketOrder} AS bucket,
            SUM(i.cost_snapshot * COALESCE(i.actual_quantity, i.requested_quantity)) AS cogs
     FROM order_items i
     JOIN orders o ON o.id = i.order_id
     WHERE o.status <> 'cancelled' AND o.created_at >= ? AND o.created_at < ?
     GROUP BY bucket ORDER BY bucket`,
    [window.fromTimestamp, window.toExclusive],
  )
  return rows
}

async function expenseSeries(window) {
  const [rows] = await db.query(
    `SELECT ${window.bucketExpense} AS bucket, e.category, SUM(e.amount) AS amount, COUNT(*) AS entries
     FROM operating_expenses e
     WHERE e.expense_date >= ? AND e.expense_date < ?
     GROUP BY bucket, e.category ORDER BY bucket`,
    [window.fromDay, ymd(new Date(parseDate(window.toDay).getTime() + DAY_MS))],
  )
  return rows
}

async function totalsFor(fromTimestamp, toExclusive) {
  const [orders] = await db.query(
    `SELECT COUNT(*) AS orders,
            SUM(status = 'cancelled') AS cancelled,
            SUM(status = 'delivered') AS delivered,
            SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS revenue,
            SUM(CASE WHEN payment_status = 'paid' AND status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS collected
     FROM orders WHERE created_at >= ? AND created_at < ?`,
    [fromTimestamp, toExclusive],
  )
  const [cogs] = await db.query(
    `SELECT SUM(i.cost_snapshot * COALESCE(i.actual_quantity, i.requested_quantity)) AS cogs
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.status <> 'cancelled' AND o.created_at >= ? AND o.created_at < ?`,
    [fromTimestamp, toExclusive],
  )
  const [expenses] = await db.query(
    'SELECT SUM(amount) AS total FROM operating_expenses WHERE expense_date >= ? AND expense_date < ?',
    [fromTimestamp.slice(0, 10), toExclusive.slice(0, 10)],
  )
  const revenue = round2(orders[0]?.revenue || 0)
  const cogsTotal = round2(cogs[0]?.cogs || 0)
  const expenseTotal = round2(expenses[0]?.total || 0)
  return {
    orders: Number(orders[0]?.orders || 0),
    cancelled: Number(orders[0]?.cancelled || 0),
    delivered: Number(orders[0]?.delivered || 0),
    revenue,
    collected: round2(orders[0]?.collected || 0),
    cogs: cogsTotal,
    expenses: expenseTotal,
    netProfit: round2(revenue - cogsTotal - expenseTotal),
  }
}

function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

/**
 * Lifetime order rhythm: total, today, this week, this month and this year.
 * Windows use the same UTC day boundaries as the rest of analytics so the
 * numbers always reconcile with the requested report range.
 */
async function orderRhythm() {
  const today = new Date()
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const weekStart = mondayOf(todayStart)
  const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1))
  const yearStart = new Date(Date.UTC(todayStart.getUTCFullYear(), 0, 1))
  const stamp = date => `${ymd(date)} 00:00:00`

  const [[allTime], [windows]] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS orders,
              SUM(status = 'delivered') AS delivered,
              SUM(status = 'cancelled') AS cancelled,
              SUM(status = 'rejected') AS rejected,
              SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS revenue,
              MIN(created_at) AS first_order_at
       FROM orders`,
    ),
    db.query(
      `SELECT
         SUM(created_at >= ?) AS today_orders,
         SUM(CASE WHEN created_at >= ? AND status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS today_revenue,
         SUM(created_at >= ?) AS week_orders,
         SUM(CASE WHEN created_at >= ? AND status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS week_revenue,
         SUM(created_at >= ?) AS month_orders,
         SUM(CASE WHEN created_at >= ? AND status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS month_revenue,
         SUM(created_at >= ?) AS year_orders,
         SUM(CASE WHEN created_at >= ? AND status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS year_revenue
       FROM orders`,
      [stamp(todayStart), stamp(todayStart), stamp(weekStart), stamp(weekStart), stamp(monthStart), stamp(monthStart), stamp(yearStart), stamp(yearStart)],
    ),
  ])

  const firstOrderAt = allTime[0]?.first_order_at ? new Date(allTime[0].first_order_at) : null
  const activeDays = firstOrderAt ? Math.max(1, Math.floor((todayStart.getTime() - Date.UTC(firstOrderAt.getUTCFullYear(), firstOrderAt.getUTCMonth(), firstOrderAt.getUTCDate())) / DAY_MS) + 1) : 1
  const elapsed = start => Math.max(1, Math.floor((todayStart.getTime() - start.getTime()) / DAY_MS) + 1)
  const totalOrders = Number(allTime[0]?.orders || 0)
  const totalRevenue = round2(allTime[0]?.revenue || 0)
  const shape = (orders, revenue, days) => ({
    orders,
    revenue,
    averageOrdersPerDay: Math.round((orders / days) * 100) / 100,
    averageRevenuePerDay: round2(revenue / days),
  })

  return {
    allTime: {
      ...shape(totalOrders, totalRevenue, activeDays),
      delivered: Number(allTime[0]?.delivered || 0),
      cancelled: Number(allTime[0]?.cancelled || 0),
      rejected: Number(allTime[0]?.rejected || 0),
      activeDays,
      firstOrderAt: firstOrderAt ? firstOrderAt.toISOString() : null,
    },
    today: { from: ymd(todayStart), ...shape(Number(windows[0]?.today_orders || 0), round2(windows[0]?.today_revenue || 0), 1) },
    week: { from: ymd(weekStart), ...shape(Number(windows[0]?.week_orders || 0), round2(windows[0]?.week_revenue || 0), elapsed(weekStart)) },
    month: { from: ymd(monthStart), ...shape(Number(windows[0]?.month_orders || 0), round2(windows[0]?.month_revenue || 0), elapsed(monthStart)) },
    year: { from: ymd(yearStart), ...shape(Number(windows[0]?.year_orders || 0), round2(windows[0]?.year_revenue || 0), elapsed(yearStart)) },
  }
}

// ---------------------------------------------------------------------------
// Analytics summary
// ---------------------------------------------------------------------------
router.get('/analytics', async (req, res, next) => {
  try {
    const window = resolveRange(req.query)
    if (window.error) return res.status(400).json({ error: window.error })

    const [orderRows, cogsRows, expenseRows, rhythm] = await Promise.all([
      orderSeries(window),
      cogsSeries(window),
      expenseSeries(window),
      orderRhythm(),
    ])
    const orderByBucket = new Map(orderRows.map(row => [row.bucket, row]))
    const cogsByBucket = new Map(cogsRows.map(row => [row.bucket, Number(row.cogs)]))
    const expensesByBucket = new Map()
    const categoryTotals = new Map()
    for (const row of expenseRows) {
      const bucket = expensesByBucket.get(row.bucket) || { total: 0, delivery: 0, entries: 0 }
      bucket.total += Number(row.amount)
      bucket.entries += Number(row.entries)
      if (row.category === 'delivery') bucket.delivery += Number(row.amount)
      expensesByBucket.set(row.bucket, bucket)
      categoryTotals.set(row.category, (categoryTotals.get(row.category) || 0) + Number(row.amount))
    }

    const series = window.buckets.map(bucket => {
      const orders = orderByBucket.get(bucket.key)
      const expenses = expensesByBucket.get(bucket.key) || { total: 0, delivery: 0 }
      const revenue = round2(orders?.revenue || 0)
      const cogs = round2(cogsByBucket.get(bucket.key) || 0)
      const expenseTotal = round2(expenses.total)
      const orderCount = Number(orders?.orders || 0)
      return {
        key: bucket.key,
        label: bucket.label,
        orders: orderCount,
        delivered: Number(orders?.delivered || 0),
        cancelled: Number(orders?.cancelled || 0),
        revenue,
        collected: round2(orders?.collected || 0),
        outstanding: round2(orders?.outstanding || 0),
        cogs,
        expenses: expenseTotal,
        deliveryCosts: round2(expenses.delivery),
        operatingCosts: round2(expenseTotal - expenses.delivery),
        grossProfit: round2(revenue - cogs),
        netProfit: round2(revenue - cogs - expenseTotal),
        customerSavings: round2(orders?.customer_savings || 0),
        averageOrderValue: orderCount ? round2(revenue / orderCount) : 0,
      }
    })

    const totals = series.reduce((acc, bucket) => {
      acc.orders += bucket.orders
      acc.delivered += bucket.delivered
      acc.cancelled += bucket.cancelled
      acc.revenue = round2(acc.revenue + bucket.revenue)
      acc.collected = round2(acc.collected + bucket.collected)
      acc.outstanding = round2(acc.outstanding + bucket.outstanding)
      acc.cogs = round2(acc.cogs + bucket.cogs)
      acc.expenses = round2(acc.expenses + bucket.expenses)
      acc.deliveryCosts = round2(acc.deliveryCosts + bucket.deliveryCosts)
      acc.operatingCosts = round2(acc.operatingCosts + bucket.operatingCosts)
      acc.grossProfit = round2(acc.grossProfit + bucket.grossProfit)
      acc.netProfit = round2(acc.netProfit + bucket.netProfit)
      acc.customerSavings = round2(acc.customerSavings + bucket.customerSavings)
      return acc
    }, {
      orders: 0, delivered: 0, cancelled: 0, revenue: 0, collected: 0, outstanding: 0,
      cogs: 0, expenses: 0, deliveryCosts: 0, operatingCosts: 0,
      grossProfit: 0, netProfit: 0, customerSavings: 0,
    })
    totals.averageOrderValue = totals.orders ? round2(totals.revenue / totals.orders) : 0
    totals.profitMargin = totals.revenue ? Math.round((totals.netProfit / totals.revenue) * 1000) / 10 : 0

    const [previous, previousOrders] = await Promise.all([
      totalsFor(window.previousFromTimestamp, window.previousToExclusive),
      db.query(
        `SELECT COUNT(*) AS orders, SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(total_final, total_estimated) ELSE 0 END) AS revenue
         FROM orders WHERE created_at >= ? AND created_at < ?`,
        [window.previousFromTimestamp, window.previousToExclusive],
      ).then(([rows]) => rows[0]),
    ])

    const [statusBreakdown] = await db.query(
      `SELECT status, COUNT(*) AS count, SUM(COALESCE(total_final, total_estimated)) AS total
       FROM orders WHERE created_at >= ? AND created_at < ?
       GROUP BY status ORDER BY count DESC`,
      [window.fromTimestamp, window.toExclusive],
    )
    const [paymentBreakdown] = await db.query(
      `SELECT payment_method AS method, COUNT(*) AS count, SUM(COALESCE(total_final, total_estimated)) AS total
       FROM orders WHERE created_at >= ? AND created_at < ? AND status <> 'cancelled'
       GROUP BY payment_method ORDER BY count DESC`,
      [window.fromTimestamp, window.toExclusive],
    )
    const [fulfilmentBreakdown] = await db.query(
      `SELECT fulfilment AS type, COUNT(*) AS count FROM orders
       WHERE created_at >= ? AND created_at < ? GROUP BY fulfilment`,
      [window.fromTimestamp, window.toExclusive],
    )

    const [products] = await db.query(
      `SELECT i.product_name_snapshot AS name,
              SUM(COALESCE(i.actual_quantity, i.requested_quantity)) AS quantity,
              SUM(COALESCE(i.final_line_total, i.estimated_line_total)) AS revenue,
              SUM(i.cost_snapshot * COALESCE(i.actual_quantity, i.requested_quantity)) AS cost
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status <> 'cancelled' AND o.created_at >= ? AND o.created_at < ?
       GROUP BY i.product_name_snapshot
       ORDER BY revenue DESC LIMIT 8`,
      [window.fromTimestamp, window.toExclusive],
    )

    const [agents] = await db.query(
      `SELECT da.id, da.name, COUNT(*) AS deliveries,
              SUM(COALESCE(o.total_final, o.total_estimated)) AS revenue,
              AVG(TIMESTAMPDIFF(MINUTE, o.assigned_at, o.delivered_at)) AS average_minutes
       FROM orders o JOIN delivery_agents da ON da.id = o.delivery_agent_id
       WHERE o.status = 'delivered' AND o.assigned_at IS NOT NULL AND o.delivered_at IS NOT NULL
         AND o.created_at >= ? AND o.created_at < ?
       GROUP BY da.id, da.name ORDER BY deliveries DESC LIMIT 8`,
      [window.fromTimestamp, window.toExclusive],
    )

    const [delivery] = await db.query(
      `SELECT COUNT(*) AS delivered_with_agent,
              AVG(TIMESTAMPDIFF(MINUTE, assigned_at, delivered_at)) AS average_minutes
       FROM orders WHERE status = 'delivered' AND assigned_at IS NOT NULL AND delivered_at IS NOT NULL
         AND created_at >= ? AND created_at < ?`,
      [window.fromTimestamp, window.toExclusive],
    )
    const [customers] = await db.query(
      `SELECT SUM(created_at >= ? AND created_at < ?) AS new_customers, COUNT(*) AS total_customers
       FROM users WHERE is_active = 1`,
      [window.fromTimestamp, window.toExclusive],
    )
    const [active] = await db.query('SELECT COUNT(*) AS active_orders FROM orders WHERE status IN (?)', [ACTIVE_STATUSES])

    res.json({
      range: window.range,
      from: window.fromDay,
      to: window.toDay,
      previous: {
        from: window.previousFromDay,
        to: window.previousToDay,
        orders: previous.orders,
        revenue: previous.revenue,
        netProfit: previous.netProfit,
      },
      changes: {
        ordersPercent: percentChange(totals.orders, Number(previousOrders?.orders || 0)),
        revenuePercent: percentChange(totals.revenue, Number(previousOrders?.revenue || 0)),
        profitPercent: percentChange(totals.netProfit, previous.netProfit),
      },
      totals: {
        ...totals,
        activeOrders: Number(active[0]?.active_orders || 0),
        newCustomers: Number(customers[0]?.new_customers || 0),
        totalCustomers: Number(customers[0]?.total_customers || 0),
        deliveredWithAgent: Number(delivery[0]?.delivered_with_agent || 0),
        averageDeliveryMinutes: delivery[0]?.average_minutes === null || delivery[0]?.average_minutes === undefined ? null : Math.round(Number(delivery[0].average_minutes)),
      },
      series,
      rhythm,
      breakdown: {
        status: statusBreakdown.map(row => ({ status: row.status, count: Number(row.count), total: round2(row.total || 0) })),
        paymentMethod: paymentBreakdown.map(row => ({ method: row.method, count: Number(row.count), total: round2(row.total || 0) })),
        fulfilment: fulfilmentBreakdown.map(row => ({ type: row.type, count: Number(row.count) })),
      },
      products: products.map(row => ({
        name: row.name,
        quantity: Number(row.quantity),
        revenue: round2(row.revenue),
        cost: round2(row.cost),
        profit: round2(Number(row.revenue) - Number(row.cost)),
      })),
      agents: agents.map(row => ({
        id: Number(row.id),
        name: row.name,
        deliveries: Number(row.deliveries),
        revenue: round2(row.revenue),
        averageMinutes: row.average_minutes === null ? null : Math.round(Number(row.average_minutes)),
      })),
      expensesByCategory: [...categoryTotals.entries()]
        .map(([category, total]) => ({ category, total: round2(total) }))
        .sort((a, b) => b.total - a.total),
    })
  } catch (error) { next(error) }
})

// ---------------------------------------------------------------------------
// CSV reports
// ---------------------------------------------------------------------------
function csvValue(value) {
  const string = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
}

function sendCsv(res, filename, header, rows) {
  const body = [header, ...rows].map(row => row.map(csvValue).join(',')).join('\r\n')
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  })
  return res.send(`\uFEFF${body}`)
}

router.get('/reports/orders.csv', async (req, res, next) => {
  try {
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to)
    const status = ACTIVE_STATUSES.concat(['delivered', 'rejected', 'cancelled']).includes(req.query.status) ? req.query.status : null
    const where = []
    const params = []
    if (from) { where.push('o.created_at >= ?'); params.push(`${ymd(from)} 00:00:00`) }
    if (to) { where.push('o.created_at < ?'); params.push(`${ymd(new Date(to.getTime() + DAY_MS))} 00:00:00`) }
    if (status) { where.push('o.status = ?'); params.push(status) }
    const [rows] = await db.query(
      `SELECT o.order_number, o.created_at, o.status, o.fulfilment, o.payment_method, o.payment_status,
              o.subtotal_estimated, o.delivery_fee, o.discount_amount, o.total_estimated, o.total_final,
              u.full_name, u.email, u.phone, a.city, a.postal_code, da.name AS agent_name
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN delivery_agents da ON da.id = o.delivery_agent_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY o.created_at DESC LIMIT 5000`,
      params,
    )
    return sendCsv(res, `fresh-farm-orders-${ymd(new Date())}.csv`, [
      'Order number', 'Placed at (UTC)', 'Status', 'Fulfilment', 'Payment method', 'Payment status',
      'Subtotal', 'Delivery fee', 'Discount', 'Total', 'Final total', 'Customer', 'Email', 'Phone',
      'City', 'Postal code', 'Delivery agent',
    ], rows.map(row => [
      row.order_number, new Date(row.created_at).toISOString(), row.status, row.fulfilment,
      row.payment_method, row.payment_status, Number(row.subtotal_estimated), Number(row.delivery_fee),
      Number(row.discount_amount), Number(row.total_estimated),
      row.total_final === null ? '' : Number(row.total_final), row.full_name, row.email, row.phone,
      row.city || '', row.postal_code || '', row.agent_name || '',
    ]))
  } catch (error) { next(error) }
})

router.get('/reports/analytics.csv', async (req, res, next) => {
  try {
    const window = resolveRange(req.query)
    if (window.error) return res.status(400).json({ error: window.error })
    const [orderRows, cogsRows, expenseRows] = await Promise.all([
      orderSeries(window),
      cogsSeries(window),
      expenseSeries(window),
    ])
    const orderByBucket = new Map(orderRows.map(row => [row.bucket, row]))
    const cogsByBucket = new Map(cogsRows.map(row => [row.bucket, Number(row.cogs)]))
    const expensesByBucket = new Map()
    for (const row of expenseRows) {
      const bucket = expensesByBucket.get(row.bucket) || { total: 0, delivery: 0 }
      bucket.total += Number(row.amount)
      if (row.category === 'delivery') bucket.delivery += Number(row.amount)
      expensesByBucket.set(row.bucket, bucket)
    }
    const rows = window.buckets.map(bucket => {
      const orders = orderByBucket.get(bucket.key)
      const expenses = expensesByBucket.get(bucket.key) || { total: 0, delivery: 0 }
      const revenue = round2(orders?.revenue || 0)
      const cogs = round2(cogsByBucket.get(bucket.key) || 0)
      return [
        bucket.key,
        Number(orders?.orders || 0),
        Number(orders?.delivered || 0),
        Number(orders?.cancelled || 0),
        revenue,
        round2(orders?.collected || 0),
        round2(orders?.outstanding || 0),
        cogs,
        round2(expenses.total),
        round2(expenses.delivery),
        round2(expenses.total - expenses.delivery),
        round2(revenue - cogs),
        round2(revenue - cogs - expenses.total),
        round2(orders?.customer_savings || 0),
      ]
    })
    return sendCsv(res, `fresh-farm-analytics-${window.range}-${window.fromDay}-to-${window.toDay}.csv`, [
      'Period', 'Orders', 'Delivered', 'Cancelled', 'Revenue', 'Collected', 'Outstanding',
      'COGS', 'Operating expenses', 'Delivery costs', 'Other operating costs',
      'Gross profit', 'Net profit', 'Customer savings',
    ], rows)
  } catch (error) { next(error) }
})

router.get('/reports/expenses.csv', async (req, res, next) => {
  try {
    const from = parseDate(req.query.from)
    const to = parseDate(req.query.to)
    const where = []
    const params = []
    if (from) { where.push('e.expense_date >= ?'); params.push(ymd(from)) }
    if (to) { where.push('e.expense_date <= ?'); params.push(ymd(to)) }
    const [rows] = await db.query(
      `SELECT e.expense_date, e.category, e.title, e.amount, e.notes
       FROM operating_expenses e
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.expense_date DESC, e.id DESC LIMIT 5000`,
      params,
    )
    return sendCsv(res, `fresh-farm-expenses-${ymd(new Date())}.csv`, [
      'Expense date', 'Category', 'Title', 'Amount', 'Notes',
    ], rows.map(row => [
      row.expense_date instanceof Date ? ymd(new Date(row.expense_date.getTime() + 12 * 60 * 60 * 1000)) : String(row.expense_date).slice(0, 10),
      row.category, row.title, Number(row.amount), row.notes || '',
    ]))
  } catch (error) { next(error) }
})

module.exports = router
