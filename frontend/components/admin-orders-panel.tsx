'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, MapPin, Package, Phone, RefreshCw, Search, Truck, UserRound, Wallet, XCircle,
} from 'lucide-react'
import {
  adminDate, adminFetch, adminMoney, adminWhen, adminStatusLabel, buildQuery,
  type AdminOrder, type AdminOrderList, type DeliveryAgent,
} from '@/lib/admin-api'
import { Drawer, EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from './admin-ui'

const STATUS_OPTIONS = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled']
const PAYMENT_OPTIONS = ['pending', 'authorized', 'paid', 'failed', 'refunded']
const CLOSED = ['delivered', 'cancelled', 'rejected']

type Filters = {
  search: string
  status: string
  paymentStatus: string
  fulfilment: string
  agentId: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { search: '', status: '', paymentStatus: '', fulfilment: '', agentId: '', from: '', to: '' }

export default function AdminOrdersPanel({ onNotify, onUnauthorized }: {
  onNotify: (message: string) => void
  onUnauthorized: () => void
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AdminOrderList | null>(null)
  const [agents, setAgents] = useState<DeliveryAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [selected, setSelected] = useState<AdminOrder | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [note, setNote] = useState('')
  const [agentChoice, setAgentChoice] = useState('')

  const reload = useCallback(() => setReloadKey(key => key + 1), [])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError('')
    adminFetch<AdminOrderList>(`/admin/orders${buildQuery({ ...filters, page, limit: 25 })}`)
      .then(result => { if (!ignore) setData(result) })
      .catch((loadError: Error & { status?: number }) => {
        if (ignore) return
        if (loadError.status === 401 || loadError.status === 403) return onUnauthorized()
        setError(loadError.message)
      })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [filters, page, reloadKey, onUnauthorized])

  useEffect(() => {
    adminFetch<{ agents: DeliveryAgent[] }>('/admin/agents?includeInactive=true')
      .then(result => setAgents(result.agents))
      .catch(() => { /* the list still works without the assign picker */ })
  }, [])

  async function loadOrder(orderNumber: string) {
    setDetailLoading(true)
    try {
      const result = await adminFetch<{ order: AdminOrder }>(`/admin/orders/${encodeURIComponent(orderNumber)}`)
      setSelected(result.order)
      setAgentChoice(result.order.deliveryAgent ? String(result.order.deliveryAgent.id) : '')
      setNote('')
    } catch (loadError) {
      const typed = loadError as Error & { status?: number }
      if (typed.status === 401 || typed.status === 403) return onUnauthorized()
      onNotify(typed.message)
    } finally {
      setDetailLoading(false)
    }
  }

  async function updateStatus(status: string) {
    if (!selected) return
    setActionBusy(true)
    try {
      await adminFetch(`/admin/orders/${encodeURIComponent(selected.orderNumber)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note: note.trim() || undefined }),
      })
      onNotify(`${selected.orderNumber} moved to ${adminStatusLabel(status)}.`)
      await loadOrder(selected.orderNumber)
      reload()
    } catch (actionError) {
      onNotify((actionError as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  async function assignAgent() {
    if (!selected || !agentChoice) return
    setActionBusy(true)
    try {
      await adminFetch(`/admin/orders/${encodeURIComponent(selected.orderNumber)}/assign`, {
        method: 'POST',
        body: JSON.stringify({ agentId: Number(agentChoice), note: note.trim() || undefined }),
      })
      onNotify(`Delivery agent assigned to ${selected.orderNumber}.`)
      await loadOrder(selected.orderNumber)
      reload()
    } catch (actionError) {
      onNotify((actionError as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  async function unassignAgent() {
    if (!selected) return
    setActionBusy(true)
    try {
      await adminFetch(`/admin/orders/${encodeURIComponent(selected.orderNumber)}/unassign`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || undefined }),
      })
      onNotify(`Delivery assignment removed from ${selected.orderNumber}.`)
      await loadOrder(selected.orderNumber)
      reload()
    } catch (actionError) {
      onNotify((actionError as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  function submitFilters(event: FormEvent) {
    event.preventDefault()
    setPage(1)
  }

  function pick<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(previous => ({ ...previous, [key]: value }))
    setPage(1)
  }

  const currentAgent = useMemo(() => agents.find(agent => agent.id === selected?.deliveryAgent?.id) || null, [agents, selected])
  const canManage = selected ? !CLOSED.includes(selected.status) : false
  const allowed = selected?.allowedNextStatuses || []

  return <div className="admin-stack">
    <form className="admin-filter-bar" onSubmit={submitFilters}>
      <label className="admin-search-field"><Search size={15} /><input value={filters.search} onChange={event => pick('search', event.target.value)} placeholder="Search order, name, email or phone" aria-label="Search orders" /></label>
      <label><span>Status</span><select value={filters.status} onChange={event => pick('status', event.target.value)}>
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map(value => <option key={value} value={value}>{adminStatusLabel(value)}</option>)}
      </select></label>
      <label><span>Payment</span><select value={filters.paymentStatus} onChange={event => pick('paymentStatus', event.target.value)}>
        <option value="">All payments</option>
        {PAYMENT_OPTIONS.map(value => <option key={value} value={value}>{adminStatusLabel(value)}</option>)}
      </select></label>
      <label><span>Fulfilment</span><select value={filters.fulfilment} onChange={event => pick('fulfilment', event.target.value)}>
        <option value="">All</option><option value="delivery">Delivery</option><option value="pickup">Pickup</option>
      </select></label>
      <label><span>Agent</span><select value={filters.agentId} onChange={event => pick('agentId', event.target.value)}>
        <option value="">All agents</option>
        {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{agent.isActive ? '' : ' (inactive)'}</option>)}
      </select></label>
      <label><span>From</span><input type="date" value={filters.from} onChange={event => pick('from', event.target.value)} /></label>
      <label><span>To</span><input type="date" value={filters.to} onChange={event => pick('to', event.target.value)} /></label>
      <div className="admin-filter-actions">
        <button className="admin-btn ghost" type="button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }}>Reset</button>
        <button className="admin-btn ghost" type="button" onClick={() => { reload() }} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>
    </form>

    {error && <ErrorBlock message={error} onRetry={reload} />}

    {data && <section className="admin-metric-strip">
      <div className="admin-metric"><span>Matches</span><b>{data.summary.total}</b><small>{data.paging.pages} page{data.paging.pages === 1 ? '' : 's'}</small></div>
      <div className="admin-metric"><span>Pending</span><b>{data.summary.pending}</b><small>Awaiting confirmation</small></div>
      <div className="admin-metric"><span>In kitchen</span><b>{data.summary.inKitchen}</b><small>Accepted, preparing, ready</small></div>
      <div className="admin-metric"><span>Out for delivery</span><b>{data.summary.outForDelivery}</b><small>With a rider now</small></div>
      <div className="admin-metric"><span>Delivered</span><b>{data.summary.delivered}</b><small>Completed</small></div>
      <div className="admin-metric"><span>Cancelled</span><b>{data.summary.cancelled}</b><small>Closed without delivery</small></div>
      <div className="admin-metric good"><span>Collected</span><b>{adminMoney(data.summary.collected)}</b><small>Paid, non-cancelled</small></div>
    </section>}

    {loading && !data ? <LoadingBlock label="Loading farm orders…" /> : data && data.orders.length === 0 ? <EmptyBlock
      title="No orders match these filters"
      text="Try clearing the search, widening the dates, or choosing a different status."
      action={<button className="admin-btn ghost" type="button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }}>Clear filters</button>}
    /> : data && <section className="admin-table-card">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Fulfilment</th><th>Total</th><th>Payment</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{data.orders.map(order => <tr key={order.orderNumber}>
            <td><b>{order.orderNumber}</b><small>{adminWhen(order.createdAt)}</small>{order.payment?.transactionId && <small>{order.payment.transactionId}</small>}</td>
            <td>{order.customer.name}<small>{order.customer.phone || 'No phone'}<br />{order.customer.email}</small></td>
            <td>{order.items.map(item => <small key={`${order.orderNumber}-${item.productId}`}>{item.name} × {item.quantity} {item.unit}</small>)}</td>
            <td><span className="admin-pill neutral">{order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</span><small>{order.deliveryAgent ? `${order.deliveryAgent.name} · ${order.deliveryAgent.phone}` : order.fulfilment === 'pickup' ? 'Shop counter' : 'Unassigned'}</small>{order.address && <small>{order.address.line1}, {order.address.city} {order.address.postalCode}</small>}</td>
            <td><b>{adminMoney(order.totalFinal ?? order.total)}</b><small>{order.items.reduce((sum, item) => sum + item.quantity, 0)} items</small></td>
            <td><span className={`admin-pill ${order.paymentStatus}`}>{adminStatusLabel(order.paymentStatus)}</span><small>{adminStatusLabel(order.paymentMethod)}</small></td>
            <td><StatusPill value={order.status} /><small>{order.deliveredAt ? `Delivered ${adminDate(order.deliveredAt)}` : order.cancelledAt ? `Cancelled ${adminDate(order.cancelledAt)}` : 'Open'}</small></td>
            <td><button className="admin-btn small" type="button" onClick={() => void loadOrder(order.orderNumber)}>Manage</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <footer className="admin-pager">
        <span>Page {data.paging.page} of {data.paging.pages} · {data.paging.total} orders</span>
        <div>
          <button className="admin-icon-btn" type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(value - 1, 1))} aria-label="Previous page"><ChevronLeft size={16} /></button>
          <button className="admin-icon-btn" type="button" disabled={page >= data.paging.pages || loading} onClick={() => setPage(value => value + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
        </div>
      </footer>
    </section>}

    {selected && <Drawer
      title={selected.orderNumber}
      subtitle={`${selected.customer.name} · ${adminWhen(selected.createdAt)}`}
      onClose={() => setSelected(null)}
      footer={<>
        <button className="admin-btn ghost" type="button" onClick={() => setSelected(null)}>Close</button>
        {canManage && <span className="admin-drawer-hint">Changes are saved to the order timeline.</span>}
      </>}
    >
      {detailLoading && <LoadingBlock label="Loading order detail…" />}
      <div className="admin-drawer-status">
        <StatusPill value={selected.status} />
        <span className={`admin-pill ${selected.paymentStatus}`}>{adminStatusLabel(selected.paymentStatus)}</span>
        <span className="admin-pill neutral">{selected.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</span>
      </div>

      <div className="admin-info-grid">
        <div className="admin-info-block">
          <h4><UserRound size={13} /> Customer</h4>
          <p>{selected.customer.name}<br />{selected.customer.email}<br />{selected.customer.phone || 'No phone on file'}</p>
        </div>
        <div className="admin-info-block">
          <h4><MapPin size={13} /> {selected.fulfilment === 'pickup' ? 'Pickup' : 'Delivery address'}</h4>
          {selected.address ? <p>{selected.address.recipientName} · {selected.address.phone}<br />{selected.address.line1}{selected.address.line2 ? `, ${selected.address.line2}` : ''}<br />{selected.address.city} {selected.address.postalCode}</p> : <p>Shop pickup — no delivery address.</p>}
        </div>
      </div>

      <section className="admin-detail-section">
        <h3><Package size={14} /> Items</h3>
        <div className="admin-detail-lines">
          {selected.items.map(item => <div key={`${item.productId}-${item.name}`}>
            <span>{item.name}<small>{item.quantity} requested{item.actualQuantity !== null ? ` · ${item.actualQuantity} weighed` : ''} · {adminMoney(item.price)}/{item.unit}</small></span>
            <b>{adminMoney(item.finalLineTotal ?? item.lineTotal)}</b>
          </div>)}
        </div>
        <div className="admin-detail-totals">
          <div><span>Subtotal</span><b>{adminMoney(selected.subtotal)}</b></div>
          <div><span>Delivery fee</span><b>{adminMoney(selected.deliveryFee)}</b></div>
          {selected.discount > 0 && <div><span>Discount</span><b>−{adminMoney(selected.discount)}</b></div>}
          <div className="grand"><span>Total</span><b>{adminMoney(selected.totalFinal ?? selected.total)}</b></div>
          {selected.totalFinal !== null && <div><span>Original estimate</span><b>{adminMoney(selected.total)}</b></div>}
        </div>
      </section>

      <section className="admin-detail-section">
        <h3><Wallet size={14} /> Payment</h3>
        {selected.payment ? <div className="admin-detail-lines">
          <div><span>Transaction ID</span><b>{selected.payment.transactionId || '—'}</b></div>
          <div><span>Gateway order</span><b>{selected.payment.orderId || '—'}</b></div>
          <div><span>Provider / method</span><b>{adminStatusLabel(selected.payment.provider)} · {adminStatusLabel(selected.paymentMethod)}</b></div>
          <div><span>Amount</span><b>{adminMoney(selected.payment.amount)}</b></div>
          <div><span>Paid at</span><b>{adminWhen(selected.payment.confirmedAt || selected.payment.createdAt)}</b></div>
          {selected.payment.failureReason && <div><span>Failure reason</span><b>{selected.payment.failureReason}</b></div>}
        </div> : <p className="admin-muted">No payment record exists for this order.</p>}
      </section>

      <section className="admin-detail-section">
        <h3><Truck size={14} /> Delivery assignment</h3>
        {selected.fulfilment === 'pickup'
          ? <p className="admin-muted">Pickup orders are collected at the shop and do not need a rider.</p>
          : <div className="admin-assign-row">
            <label><span>Agent</span>
              <select value={agentChoice} onChange={event => setAgentChoice(event.target.value)} disabled={!canManage || actionBusy}>
                <option value="">Choose an agent</option>
                {agents.map(agent => {
                  const load = agent.activeOrders ?? 0
                  const unavailable = !agent.isActive || (load >= agent.capacity && agent.id !== selected.deliveryAgent?.id)
                  return <option key={agent.id} value={agent.id} disabled={unavailable}>{agent.name} — {load}/{agent.capacity}{agent.isActive ? '' : ' · inactive'}</option>
                })}
              </select>
            </label>
            <button className="admin-btn" type="button" disabled={!canManage || actionBusy || !agentChoice} onClick={() => void assignAgent()}>{selected.deliveryAgent ? 'Reassign' : 'Assign'}</button>
            {selected.deliveryAgent && <button className="admin-btn ghost" type="button" disabled={!canManage || actionBusy} onClick={() => void unassignAgent()}>Unassign</button>}
          </div>}
        {currentAgent?.serviceArea && <p className="admin-muted">Service area: {currentAgent.serviceArea}. Capacity {currentAgent.activeOrders ?? 0}/{currentAgent.capacity}.</p>}
      </section>

      <section className="admin-detail-section">
        <h3><ClipboardList size={14} /> Update status</h3>
        {canManage && allowed.length ? <>
          <label className="admin-note-field"><span>Note for the timeline (optional)</span><textarea rows={2} value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="e.g. Called the customer to confirm the address" /></label>
          <div className="admin-status-actions">
            {allowed.map(status => <button key={status} className={`admin-btn small${status === 'cancelled' || status === 'rejected' ? ' danger' : ''}`} type="button" disabled={actionBusy} onClick={() => void updateStatus(status)}>
              {status === 'cancelled' || status === 'rejected' ? <XCircle size={14} /> : <CheckCircle2 size={14} />} {adminStatusLabel(status)}
            </button>)}
          </div>
        </> : <p className="admin-muted">This order is closed. Its status and assignment are now part of the permanent history.</p>}
      </section>

      {selected.timeline && selected.timeline.length > 0 && <section className="admin-detail-section">
        <h3>Timeline</h3>
        <ol className="admin-timeline">
          {selected.timeline.map((event, index) => <li key={`${event.status}-${event.at}-${index}`}>
            <StatusPill value={event.status} />
            <div><b>{adminStatusLabel(event.status)}</b><small>{adminWhen(event.at)} · {event.actor}</small>{event.note && <p>{event.note}</p>}</div>
          </li>)}
        </ol>
      </section>}

      {selected.assignments && selected.assignments.length > 0 && <section className="admin-detail-section">
        <h3>Assignment history</h3>
        <div className="admin-detail-lines">
          {selected.assignments.map(item => <div key={item.id}>
            <span>{item.agent}<small>{item.status} · assigned {adminWhen(item.assignedAt)} · by {item.assignedBy}</small>{item.note && <small>{item.note}</small>}</span>
            <b>{item.endedAt && item.endedAt.startsWith('1970') ? 'Open' : adminWhen(item.endedAt)}</b>
          </div>)}
        </div>
      </section>}

      {selected.notes && <section className="admin-detail-section">
        <h3>Customer notes</h3><p className="admin-customer-note">{selected.notes}</p>
      </section>}
    </Drawer>}
  </div>
}
