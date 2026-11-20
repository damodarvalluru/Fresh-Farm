const express = require('express')
const db = require('../config/db')

const router = express.Router()
const CATEGORIES = ['delivery', 'packaging', 'salaries', 'utilities', 'marketing', 'rent', 'other']

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function dateOnly(value) {
  const raw = text(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : raw
}

function mapExpense(row) {
  return {
    id: Number(row.id),
    category: row.category,
    title: row.title,
    amount: Number(row.amount),
    expenseDate: row.expense_date instanceof Date ? row.expense_date.toISOString().slice(0, 10) : String(row.expense_date).slice(0, 10),
    notes: row.notes,
    createdBy: row.created_by_name || 'Staff',
    createdAt: row.created_at,
  }
}

const EXPENSE_SELECT = `
  SELECT e.id, e.category, e.title, e.amount, e.expense_date, e.notes, e.created_at,
         COALESCE(ad.display_name, u.full_name) AS created_by_name
  FROM operating_expenses e
  LEFT JOIN admins ad ON ad.id = e.created_by
  LEFT JOIN users u ON u.id = ad.user_id
`

router.get('/expenses', async (req, res, next) => {
  try {
    const from = dateOnly(req.query.from)
    const to = dateOnly(req.query.to)
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null
    const where = []
    const params = []
    if (from) { where.push('e.expense_date >= ?'); params.push(from) }
    if (to) { where.push('e.expense_date <= ?'); params.push(to) }
    if (category) { where.push('e.category = ?'); params.push(category) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [rows] = await db.query(`${EXPENSE_SELECT} ${whereSql} ORDER BY e.expense_date DESC, e.id DESC LIMIT 500`, params)
    const [totals] = await db.query(
      `SELECT e.category, SUM(e.amount) AS total, COUNT(*) AS entries
       FROM operating_expenses e ${whereSql}
       GROUP BY e.category ORDER BY total DESC`,
      params,
    )
    res.json({
      expenses: rows.map(mapExpense),
      totals: totals.map(row => ({ category: row.category, total: Number(row.total), entries: Number(row.entries) })),
      grandTotal: Math.round(totals.reduce((sum, row) => sum + Number(row.total), 0) * 100) / 100,
    })
  } catch (error) { next(error) }
})

router.post('/expenses', async (req, res, next) => {
  try {
    const category = CATEGORIES.includes(req.body?.category) ? req.body.category : null
    const title = text(req.body?.title, 160)
    const amount = Number(req.body?.amount)
    const expenseDate = dateOnly(req.body?.expenseDate)
    const notes = text(req.body?.notes, 500) || null
    if (!category) return res.status(400).json({ error: 'Choose an expense category.' })
    if (title.length < 2) return res.status(400).json({ error: 'Enter a short expense title.' })
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return res.status(400).json({ error: 'Enter an amount greater than zero.' })
    if (!expenseDate) return res.status(400).json({ error: 'Choose the expense date.' })

    const [created] = await db.execute(
      'INSERT INTO operating_expenses (category, title, amount, expense_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [category, title, Math.round(amount * 100) / 100, expenseDate, notes, req.admin.id],
    )
    const [rows] = await db.execute(`${EXPENSE_SELECT} WHERE e.id = ? LIMIT 1`, [created.insertId])
    res.status(201).json({ expense: mapExpense(rows[0]) })
  } catch (error) { next(error) }
})

router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const [existing] = await db.execute('SELECT id FROM operating_expenses WHERE id = ? LIMIT 1', [id])
    if (!existing.length) return res.status(404).json({ error: 'Expense not found.' })

    const category = CATEGORIES.includes(req.body?.category) ? req.body.category : null
    const title = text(req.body?.title, 160)
    const amount = Number(req.body?.amount)
    const expenseDate = dateOnly(req.body?.expenseDate)
    const notes = text(req.body?.notes, 500) || null
    if (!category) return res.status(400).json({ error: 'Choose an expense category.' })
    if (title.length < 2) return res.status(400).json({ error: 'Enter a short expense title.' })
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return res.status(400).json({ error: 'Enter an amount greater than zero.' })
    if (!expenseDate) return res.status(400).json({ error: 'Choose the expense date.' })

    await db.execute(
      'UPDATE operating_expenses SET category = ?, title = ?, amount = ?, expense_date = ?, notes = ? WHERE id = ?',
      [category, title, Math.round(amount * 100) / 100, expenseDate, notes, id],
    )
    const [rows] = await db.execute(`${EXPENSE_SELECT} WHERE e.id = ? LIMIT 1`, [id])
    res.json({ expense: mapExpense(rows[0]) })
  } catch (error) { next(error) }
})

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const [result] = await db.execute('DELETE FROM operating_expenses WHERE id = ?', [Number(req.params.id)])
    if (!result.affectedRows) return res.status(404).json({ error: 'Expense not found.' })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

module.exports = router
