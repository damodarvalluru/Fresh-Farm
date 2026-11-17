'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, Download, IndianRupee, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import {
  adminCompact, adminFetch, adminMoney, adminWhen, buildQuery, type Analytics,
} from '@/lib/admin-api'
import { BarList, EmptyBlock, ErrorBlock, LoadingBlock, Metric, TrendChart } from './admin-ui'

const RANGES: Array<{ id: Analytics['range']; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'annual', label: 'Annual' },
]

function Change({ value }: { value: number }) {
  const up = value >= 0
  return <span className={`admin-change ${up ? 'up' : 'down'}`}>
    {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
    {Math.abs(value).toFixed(1)}%
  </span>
}

function perDay(value: number) {
  if (value > 0 && value < 0.01) return '<0.01'
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export default function AdminOverview({ onNotify, onUnauthorized }: {
  onNotify: (message: string) => void
  onUnauthorized: () => void
}) {
  const [range, setRange] = useState<Analytics['range']>('daily')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState({ from: '', to: '' })
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const next = await adminFetch<Analytics>(`/admin/analytics${buildQuery({ range, from: applied.from, to: applied.to })}`)
      if (requestId === requestRef.current) setData(next)
    } catch (loadError) {
      if (requestId !== requestRef.current) return
      const typed = loadError as Error & { status?: number }
      if (typed.status === 401 || typed.status === 403) return onUnauthorized()
      setError(typed.message)
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [range, applied, onUnauthorized])

  useEffect(() => { void load() }, [load])

  function applyDates(event: FormEvent) {
    event.preventDefault()
    setApplied({ from, to })
  }

  const chartPoints = useMemo(() => data?.series.map(bucket => bucket.label) || [], [data])
  const analyticsReport = `/api/backend/admin/reports/analytics.csv${buildQuery({ range, from: applied.from, to: applied.to })}`
  const ordersReport = `/api/backend/admin/reports/orders.csv${buildQuery({ from: applied.from, to: applied.to })}`
  const expensesReport = `/api/backend/admin/reports/expenses.csv${buildQuery({ from: applied.from, to: applied.to })}`

  return <div className="admin-stack">
    <section className="admin-toolbar">
      <div className="admin-segmented" role="tablist" aria-label="Reporting period">
        {RANGES.map(item => <button key={item.id} role="tab" aria-selected={range === item.id} className={range === item.id ? 'active' : ''} onClick={() => setRange(item.id)}>{item.label}</button>)}
      </div>
      <form className="admin-date-range" onSubmit={applyDates}>
        <label><span>From</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
        <button className="admin-btn ghost" type="submit"><CalendarDays size={14} /> Apply</button>
        {(applied.from || applied.to) && <button className="admin-link-btn" type="button" onClick={() => { setFrom(''); setTo(''); setApplied({ from: '', to: '' }) }}>Reset</button>}
      </form>
      <button className="admin-btn ghost" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
    </section>

    {error && <ErrorBlock message={error} onRetry={() => void load()} />}
    {loading && !data && <LoadingBlock label="Building your analytics…" />}

    {data && <>
      <div className="admin-context-line">
        <span>{data.from} → {data.to}</span>
        <span>Compared with {data.previous.from} → {data.previous.to}</span>
        <span>Live from TiDB</span>
      </div>

      <section className="admin-kpi-grid">
        <article className="admin-kpi primary">
          <span><IndianRupee size={15} /> Revenue</span>
          <b>{adminMoney(data.totals.revenue)}</b>
          <small><Change value={data.changes.revenuePercent} /> against the previous period</small>
        </article>
        <article className="admin-kpi primary">
          <span>Net profit</span>
          <b>{adminMoney(data.totals.netProfit)}</b>
          <small><Change value={data.changes.profitPercent} /> · margin {data.totals.profitMargin}%</small>
        </article>
        <article className="admin-kpi primary">
          <span>Orders</span>
          <b>{data.totals.orders.toLocaleString('en-IN')}</b>
          <small><Change value={data.changes.ordersPercent} /> · {data.totals.delivered} delivered</small>
        </article>
        <article className="admin-kpi primary">
          <span>Average order</span>
          <b>{adminMoney(data.totals.averageOrderValue)}</b>
          <small>{data.totals.activeOrders} active right now</small>
        </article>
      </section>

      {data.rhythm && <section className="admin-card admin-rhythm">
        <header className="admin-card-head">
          <div><span className="admin-eyebrow">ORDER RHYTHM</span><h3>Every order, at a glance</h3><p>Lifetime totals alongside today, this week, this month and this year — counted straight from the orders table in UTC.</p></div>
          <span className="admin-rhythm-badge">{perDay(data.rhythm.allTime.averageOrdersPerDay)} orders / day all-time</span>
        </header>
        <div className="admin-rhythm-grid">
          {([
            { label: 'All time', window: data.rhythm.allTime, hint: `${data.rhythm.allTime.activeDays} active day${data.rhythm.allTime.activeDays === 1 ? '' : 's'}`, tone: 'primary' },
            { label: 'Today', window: data.rhythm.today, hint: 'since 00:00 UTC', tone: '' },
            { label: 'This week', window: data.rhythm.week, hint: `from ${data.rhythm.week.from} UTC`, tone: '' },
            { label: 'This month', window: data.rhythm.month, hint: `from ${data.rhythm.month.from} UTC`, tone: '' },
            { label: 'This year', window: data.rhythm.year, hint: `from ${data.rhythm.year.from} UTC`, tone: '' },
          ] as const).map(tile => <article key={tile.label} className={`admin-rhythm-tile ${tile.tone}`}>
            <span>{tile.label}</span>
            <b>{tile.window.orders.toLocaleString('en-IN')}</b>
            <small className="admin-rhythm-revenue">{adminMoney(tile.window.revenue)} revenue</small>
            <small>{perDay(tile.window.averageOrdersPerDay)} orders / day · {tile.hint}</small>
          </article>)}
        </div>
        <div className="admin-rhythm-foot">
          <span><b>{data.rhythm.allTime.delivered.toLocaleString('en-IN')}</b> delivered all-time</span>
          <span><b>{data.rhythm.allTime.cancelled.toLocaleString('en-IN')}</b> cancelled</span>
          <span><b>{data.rhythm.allTime.rejected.toLocaleString('en-IN')}</b> rejected</span>
          <span>First order {data.rhythm.allTime.firstOrderAt ? adminWhen(data.rhythm.allTime.firstOrderAt) : 'not recorded yet'}</span>
        </div>
      </section>}

      <section className="admin-metric-strip">
        <Metric label="Collected" value={adminMoney(data.totals.collected)} hint="Paid orders" tone="good" />
        <Metric label="Outstanding" value={adminMoney(data.totals.outstanding)} hint="Awaiting payment" tone={data.totals.outstanding ? 'warn' : undefined} />
        <Metric label="COGS" value={adminMoney(data.totals.cogs)} hint="Item cost snapshot" />
        <Metric label="Operating expenses" value={adminMoney(data.totals.expenses)} hint={`${data.expensesByCategory.length} categories`} />
        <Metric label="Delivery costs" value={adminMoney(data.totals.deliveryCosts)} hint="Logged delivery spend" />
        <Metric label="Other operating" value={adminMoney(data.totals.operatingCosts)} hint="Expenses minus delivery" />
        <Metric label="Customer savings" value={adminMoney(data.totals.customerSavings)} hint="Discounts given" />
        <Metric label="New customers" value={data.totals.newCustomers.toLocaleString('en-IN')} hint={`${data.totals.totalCustomers} total`} />
        <Metric label="Delivered with rider" value={data.totals.deliveredWithAgent.toLocaleString('en-IN')} hint={data.totals.averageDeliveryMinutes === null ? 'No delivery timing yet' : `${data.totals.averageDeliveryMinutes} min average`} />
        <Metric label="Cancelled" value={data.totals.cancelled.toLocaleString('en-IN')} hint={`of ${data.totals.orders} orders`} tone={data.totals.cancelled ? 'bad' : undefined} />
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <div><span className="admin-eyebrow">MONEY IN</span><h3>Revenue &amp; collected</h3><p>Booked revenue ignores cancelled orders; collected counts paid orders only.</p></div>
        </header>
        {chartPoints.length ? <TrendChart
          points={chartPoints}
          series={[
            { label: 'Revenue', color: '#2f5138', values: data.series.map(bucket => bucket.revenue), area: true },
            { label: 'Collected', color: '#c69351', values: data.series.map(bucket => bucket.collected) },
          ]}
        /> : <EmptyBlock title="No buckets in this window" text="Choose a wider date range to see revenue movement." />}
      </section>

      <div className="admin-two-col">
        <section className="admin-card">
          <header className="admin-card-head">
            <div><span className="admin-eyebrow">DEMAND</span><h3>Orders per period</h3><p>Volume alongside cancellations so staffing can follow demand.</p></div>
          </header>
          {chartPoints.length ? <TrendChart
            points={chartPoints}
            height={210}
            money={false}
            series={[
              { label: 'Orders', color: '#5d7a58', values: data.series.map(bucket => bucket.orders), area: true },
              { label: 'Delivered', color: '#c69351', values: data.series.map(bucket => bucket.delivered) },
            ]}
          /> : <EmptyBlock title="No order buckets" text="No orders fall inside this reporting window." />}
        </section>

        <section className="admin-card">
          <header className="admin-card-head">
            <div><span className="admin-eyebrow">COST &amp; PROFIT</span><h3>Net profit trend</h3><p>Revenue minus item cost and every logged operating expense.</p></div>
          </header>
          {chartPoints.length ? <TrendChart
            points={chartPoints}
            height={210}
            series={[{ label: 'Net profit', color: '#2f5138', values: data.series.map(bucket => bucket.netProfit), area: true }]}
          /> : <EmptyBlock title="Nothing to plot" text="Profit needs at least one order in the window." />}
        </section>
      </div>

      <div className="admin-three-col">
        <section className="admin-card">
          <header className="admin-card-head"><div><span className="admin-eyebrow">PIPELINE</span><h3>Order status</h3></div></header>
          <BarList rows={data.breakdown.status.map(row => ({ label: row.status, value: row.count, meta: `${row.count} · ${adminMoney(row.total)}`, color: '#5d7a58' }))} />
        </section>
        <section className="admin-card">
          <header className="admin-card-head"><div><span className="admin-eyebrow">PAYMENTS</span><h3>Payment methods</h3></div></header>
          <BarList rows={data.breakdown.paymentMethod.map(row => ({ label: row.method, value: row.count, meta: `${row.count} · ${adminMoney(row.total)}`, color: '#c69351' }))} />
        </section>
        <section className="admin-card">
          <header className="admin-card-head"><div><span className="admin-eyebrow">SERVICE</span><h3>Fulfilment mix</h3></div></header>
          <BarList rows={data.breakdown.fulfilment.map(row => ({ label: row.type, value: row.count, meta: `${row.count} orders`, color: '#879b78' }))} />
          {data.breakdown.section?.length > 0 && <>
            <h4 className="admin-subhead">Chicken vs fish</h4>
            <BarList rows={data.breakdown.section.map(row => ({ label: row.section === 'fish' ? 'Fresh fish' : 'Chicken / hen', value: row.revenue, meta: `${row.quantity} sold · ${adminMoney(row.revenue)}`, color: row.section === 'fish' ? '#2f7a72' : '#5d7a58' }))} />
          </>}
          {data.expensesByCategory.length > 0 && <>
            <h4 className="admin-subhead">Expenses by category</h4>
            <BarList rows={data.expensesByCategory.map(row => ({ label: row.category, value: row.total, meta: adminMoney(row.total), color: '#b76a54' }))} />
          </>}
        </section>
      </div>

      <div className="admin-two-col">
        <section className="admin-card">
          <header className="admin-card-head"><div><span className="admin-eyebrow">BEST SELLERS</span><h3>Top products</h3><p>Profit uses the stored cost snapshot, not today&apos;s price.</p></div></header>
          {data.products.length ? <div className="admin-mini-table">
            <div className="admin-mini-head"><span>Product</span><span>Qty</span><span>Revenue</span><span>Profit</span></div>
            {data.products.map(row => <div key={row.name} className="admin-mini-row">
              <span>{row.name}</span>
              <span>{row.quantity}</span>
              <span>{adminMoney(row.revenue)}</span>
              <span className={row.profit >= 0 ? 'positive' : 'negative'}>{adminMoney(row.profit)}</span>
            </div>)}
          </div> : <EmptyBlock title="No product sales yet" text="Product performance appears after the first order in this window." />}
        </section>

        <section className="admin-card">
          <header className="admin-card-head"><div><span className="admin-eyebrow">DELIVERY</span><h3>Rider performance</h3><p>Only delivered orders with both assignment and delivery timestamps.</p></div></header>
          {data.agents.length ? <div className="admin-mini-table">
            <div className="admin-mini-head"><span>Agent</span><span>Deliveries</span><span>Revenue</span><span>Avg time</span></div>
            {data.agents.map(row => <div key={row.id} className="admin-mini-row">
              <span>{row.name}</span>
              <span>{row.deliveries}</span>
              <span>{adminMoney(row.revenue)}</span>
              <span>{row.averageMinutes === null ? '—' : `${row.averageMinutes} min`}</span>
            </div>)}
          </div> : <EmptyBlock title="No deliveries recorded" text="Assign a rider and complete a delivery to unlock rider performance." />}
        </section>
      </div>

      <section className="admin-card reports-inline">
        <header className="admin-card-head">
          <div><span className="admin-eyebrow">DOWNLOADABLE REPORTS</span><h3>Take the numbers with you</h3><p>CSV files are generated from the same database queries, with the current date filters applied.</p></div>
        </header>
        <div className="admin-download-row">
          <a className="admin-btn ghost" href={analyticsReport} download><Download size={14} /> Analytics CSV</a>
          <a className="admin-btn ghost" href={ordersReport} download><Download size={14} /> Orders CSV</a>
          <a className="admin-btn ghost" href={expensesReport} download><Download size={14} /> Expenses CSV</a>
          <button className="admin-link-btn" type="button" onClick={() => onNotify(`Report window: ${data.from} to ${data.to}.`)}>Report window</button>
        </div>
        <p className="admin-muted">Generated at {adminWhen(new Date().toISOString())}. Order exports cap at 5,000 rows; narrow the dates for a complete archive.</p>
      </section>
    </>}
  </div>
}
