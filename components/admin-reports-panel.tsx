'use client'

import { useState } from 'react'
import { CalendarDays, Download, FileSpreadsheet, ReceiptText, ShoppingBag } from 'lucide-react'
import { buildQuery, todayInputValue } from '@/lib/admin-api'

const RANGES = ['daily', 'weekly', 'monthly', 'annual'] as const

export default function AdminReportsPanel() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayInputValue())
  const [range, setRange] = useState<typeof RANGES[number]>('monthly')
  const [status, setStatus] = useState('')

  const dateQuery = buildQuery({ from, to })
  const analyticsQuery = buildQuery({ range, from, to })

  return <div className="admin-stack">
    <section className="admin-toolbar">
      <form className="admin-date-range" onSubmit={event => event.preventDefault()}>
        <label><span>From</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
        <label><span>Orders status</span><select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="preparing">Preparing</option>
          <option value="ready">Ready</option>
          <option value="out_for_delivery">Out for delivery</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="rejected">Rejected</option>
        </select></label>
        <label><span>Analytics grouping</span><select value={range} onChange={event => setRange(event.target.value as typeof range)}>
          {RANGES.map(item => <option key={item} value={item}>{item}</option>)}
        </select></label>
      </form>
    </section>

    <div className="admin-report-grid">
      <article className="admin-report-card">
        <span className="admin-report-icon"><FileSpreadsheet size={21} /></span>
        <h3>Analytics report</h3>
        <p>One row per period with orders, delivered, cancelled, revenue, collected, outstanding, item cost, operating expenses, delivery costs, gross profit, net profit and customer savings.</p>
        <a className="admin-btn" href={`/api/backend/admin/reports/analytics.csv${analyticsQuery}`} download><Download size={14} /> Download analytics CSV</a>
      </article>

      <article className="admin-report-card">
        <span className="admin-report-icon"><ShoppingBag size={21} /></span>
        <h3>Orders report</h3>
        <p>Every order with its placed time, status, fulfilment, payment method and state, totals, customer contact, city and assigned rider — filtered by the dates and status above.</p>
        <a className="admin-btn" href={`/api/backend/admin/reports/orders.csv${buildQuery({ from, to, status })}`} download><Download size={14} /> Download orders CSV</a>
      </article>

      <article className="admin-report-card">
        <span className="admin-report-icon"><ReceiptText size={21} /></span>
        <h3>Expenses report</h3>
        <p>All operating expenses with date, category, title, amount and notes. Combine it with the analytics export for an accountant-ready view of costs.</p>
        <a className="admin-btn" href={`/api/backend/admin/reports/expenses.csv${dateQuery}`} download><Download size={14} /> Download expenses CSV</a>
      </article>
    </div>

    <section className="admin-card">
      <header className="admin-card-head"><div><span className="admin-eyebrow">REPORTING NOTES</span><h3>How these numbers stay honest</h3></div></header>
      <div className="admin-help-grid">
        <div><CalendarDays size={18} /><b>Dates are inclusive</b><p>Orders are selected from 00:00 on the start date until the end of the end date. Leave a date blank to remove that boundary.</p></div>
        <div><ReceiptText size={18} /><b>No dummy data</b><p>Every export is produced by the API from live TiDB records. Cancelled orders are excluded from revenue and cost, but remain visible in status breakdowns and order exports.</p></div>
        <div><Download size={18} /><b>Spreadsheet ready</b><p>Files are UTF-8 CSV with a byte-order mark, so rupee amounts and Indian names open correctly in Excel. Exports cap at 5,000 rows per file.</p></div>
      </div>
    </section>
  </div>
}
