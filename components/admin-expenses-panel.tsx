'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, Pencil, Plus, ReceiptText, RefreshCw, Trash2 } from 'lucide-react'
import { adminDate, adminFetch, adminMoney, buildQuery, todayInputValue, type ExpenseList, type OperatingExpense } from '@/lib/admin-api'
import { EmptyBlock, ErrorBlock, LoadingBlock, Modal } from './admin-ui'

const CATEGORIES = ['delivery', 'packaging', 'salaries', 'utilities', 'marketing', 'rent', 'other']

type ExpenseForm = {
  category: string
  title: string
  amount: string
  expenseDate: string
  notes: string
}

function emptyForm(): ExpenseForm {
  return { category: 'delivery', title: '', amount: '', expenseDate: todayInputValue(), notes: '' }
}

export default function AdminExpensesPanel({ onNotify, onUnauthorized }: {
  onNotify: (message: string) => void
  onUnauthorized: () => void
}) {
  const [data, setData] = useState<ExpenseList | null>(null)
  const [filters, setFilters] = useState({ from: '', to: '', category: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<OperatingExpense | 'new' | null>(null)
  const [form, setForm] = useState<ExpenseForm>(emptyForm())
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await adminFetch<ExpenseList>(`/admin/expenses${buildQuery(filters)}`))
    } catch (loadError) {
      const typed = loadError as Error & { status?: number }
      if (typed.status === 401 || typed.status === 403) return onUnauthorized()
      setError(typed.message)
    } finally {
      setLoading(false)
    }
  }, [filters, reloadKey, onUnauthorized])

  useEffect(() => { void load() }, [load])

  function openCreate() {
    setEditing('new')
    setForm(emptyForm())
    setFormError('')
  }

  function openEdit(expense: OperatingExpense) {
    setEditing(expense)
    setForm({
      category: expense.category,
      title: expense.title,
      amount: String(expense.amount),
      expenseDate: expense.expenseDate,
      notes: expense.notes || '',
    })
    setFormError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFormError('')
    try {
      const body = { ...form, amount: Number(form.amount) }
      if (editing === 'new') {
        await adminFetch('/admin/expenses', { method: 'POST', body: JSON.stringify(body) })
        onNotify('Expense recorded.')
      } else if (editing) {
        await adminFetch(`/admin/expenses/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        onNotify('Expense updated.')
      }
      setEditing(null)
      setReloadKey(key => key + 1)
    } catch (saveError) {
      setFormError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(expense: OperatingExpense) {
    if (!window.confirm(`Delete “${expense.title}” (${adminMoney(expense.amount)})?`)) return
    setBusy(true)
    try {
      await adminFetch(`/admin/expenses/${expense.id}`, { method: 'DELETE' })
      onNotify('Expense deleted.')
      setReloadKey(key => key + 1)
    } catch (deleteError) {
      onNotify((deleteError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const seedsFromEmpty = !filters.from && !filters.to && !filters.category

  return <div className="admin-stack">
    <section className="admin-toolbar">
      <form className="admin-date-range" onSubmit={event => { event.preventDefault(); setReloadKey(key => key + 1) }}>
        <label><span>From</span><input type="date" value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label>
        <label><span>To</span><input type="date" value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label>
        <label><span>Category</span><select value={filters.category} onChange={event => setFilters({ ...filters, category: event.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
        </select></label>
        <button className="admin-btn ghost" type="submit"><CalendarDays size={14} /> Filter</button>
        {!seedsFromEmpty && <button className="admin-link-btn" type="button" onClick={() => setFilters({ from: '', to: '', category: '' })}>Reset</button>}
      </form>
      <div className="admin-spacer" />
      <button className="admin-btn ghost" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
      <button className="admin-btn" type="button" onClick={openCreate}><Plus size={15} /> Add expense</button>
    </section>

    {error && <ErrorBlock message={error} onRetry={() => void load()} />}

    {data && <section className="admin-expense-summary">
      <article className="admin-expense-total"><ReceiptText size={19} /><span>Total in view</span><b>{adminMoney(data.grandTotal)}</b><small>{data.expenses.length} entries</small></article>
      {data.totals.map(row => <article key={row.category} className="admin-expense-category">
        <span>{row.category}</span>
        <b>{adminMoney(row.total)}</b>
        <small>{row.entries} {row.entries === 1 ? 'entry' : 'entries'}</small>
      </article>)}
    </section>}

    {loading && !data ? <LoadingBlock label="Loading operating expenses…" /> : data && data.expenses.length === 0 ? <EmptyBlock
      title="No expenses in this view"
      text="Log delivery fuel, packaging, salaries, utilities and rent to keep net profit honest."
      action={<button className="admin-btn" type="button" onClick={openCreate}><Plus size={15} /> Add the first expense</button>}
    /> : data && <section className="admin-table-card">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Amount</th><th>Recorded by</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.expenses.map(expense => <tr key={expense.id}>
            <td>{adminDate(expense.expenseDate)}</td>
            <td><b>{expense.title}</b>{expense.notes && <small>{expense.notes}</small>}</td>
            <td><span className="admin-pill neutral">{expense.category}</span></td>
            <td><b>{adminMoney(expense.amount)}</b></td>
            <td>{expense.createdBy}<small>{adminDate(expense.createdAt)}</small></td>
            <td><div className="admin-row-actions">
              <button className="admin-btn small ghost" type="button" onClick={() => openEdit(expense)}><Pencil size={13} /> Edit</button>
              <button className="admin-btn small danger" type="button" disabled={busy} onClick={() => void remove(expense)}><Trash2 size={13} /> Delete</button>
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>}

    {editing && <Modal
      title={editing === 'new' ? 'Record an operating expense' : 'Edit expense'}
      subtitle="COSTS & PROFIT"
      onClose={() => setEditing(null)}
      footer={<>
        <button className="admin-btn ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
        <button className="admin-btn" type="submit" form="expense-form" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Save expense' : 'Save changes'}</button>
      </>}
    >
      <form id="expense-form" className="admin-form-grid" onSubmit={submit}>
        {formError && <p className="admin-form-error" role="alert">{formError}</p>}
        <label><span>Category</span><select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        <label><span>Date</span><input type="date" required value={form.expenseDate} onChange={event => setForm({ ...form, expenseDate: event.target.value })} /></label>
        <label className="span-2"><span>Title</span><input required minLength={2} maxLength={160} value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Diesel for the delivery van" /></label>
        <label><span>Amount (₹)</span><input type="number" required min="0.01" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
        <label className="span-2"><span>Notes (optional)</span><textarea rows={3} maxLength={500} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
      </form>
    </Modal>}
  </div>
}
