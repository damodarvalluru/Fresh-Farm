'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock3, MapPin, Phone, RefreshCw, Route, Truck, UserRound } from 'lucide-react'
import { adminMoney, adminWhen, adminFetch, type ActiveAssignment, type AgentWorkload } from '@/lib/admin-api'
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusPill } from './admin-ui'

type AssignmentData = { assignments: ActiveAssignment[]; workload: AgentWorkload[] }

export default function AdminAssignmentsPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [data, setData] = useState<AssignmentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await adminFetch<AssignmentData>(`/admin/assignments?active=${activeOnly}&limit=200`))
    } catch (loadError) {
      const typed = loadError as Error & { status?: number }
      if (typed.status === 401 || typed.status === 403) return onUnauthorized()
      setError(typed.message)
    } finally {
      setLoading(false)
    }
  }, [activeOnly, onUnauthorized])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const activeCount = data?.workload.reduce((sum, agent) => sum + agent.activeOrders, 0) || 0
  const capacity = data?.workload.reduce((sum, agent) => sum + agent.capacity, 0) || 0
  const onlineAgents = data?.workload.filter(agent => agent.isActive).length || 0

  return <div className="admin-stack">
    <section className="admin-toolbar">
      <label className="admin-check"><input type="checkbox" checked={activeOnly} onChange={event => setActiveOnly(event.target.checked)} /> Active assignments only</label>
      <span className="admin-muted">Refreshes automatically every 30 seconds.</span>
      <div className="admin-spacer" />
      <button className="admin-btn ghost" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh now</button>
    </section>

    {error && <ErrorBlock message={error} onRetry={() => void load()} />}
    {loading && !data ? <LoadingBlock label="Checking who is carrying what…" /> : data && <>
      <section className="admin-metric-strip">
        <div className="admin-metric"><span>Active agents</span><b>{onlineAgents}</b><small>of {data.workload.length} on the team</small></div>
        <div className="admin-metric"><span>Open deliveries</span><b>{activeCount}</b><small>Across all riders</small></div>
        <div className="admin-metric"><span>Total capacity</span><b>{capacity}</b><small>{Math.max(capacity - activeCount, 0)} slots free</small></div>
        <div className="admin-metric"><span>Assignments shown</span><b>{data.assignments.length}</b><small>{activeOnly ? 'Active only' : 'Including history'}</small></div>
      </section>

      <section className="admin-card">
        <header className="admin-card-head"><div><span className="admin-eyebrow">BALANCE</span><h3>Rider workload</h3><p>Capacity includes pending orders because a freshly assigned order occupies a slot immediately.</p></div></header>
        <div className="admin-workload-grid">
          {data.workload.map(agent => {
            const percent = Math.min((agent.activeOrders / Math.max(agent.capacity, 1)) * 100, 100)
            return <article key={agent.id} className={`admin-workload-card${agent.isActive ? '' : ' inactive'}`}>
              <header><b>{agent.name}</b><span className={`admin-pill ${agent.isActive ? 'delivered' : 'cancelled'}`}>{agent.isActive ? 'Active' : 'Inactive'}</span></header>
              <div><span>{agent.activeOrders} / {agent.capacity} orders</span><strong>{agent.available} free</strong></div>
              <div className="admin-bar-track"><i style={{ width: `${percent}%`, background: percent >= 100 ? '#b76a54' : percent >= 70 ? '#c69351' : '#5d7a58' }} /></div>
              <small>{agent.isActive ? `${agent.available} slots available` : 'Not taking new assignments'}</small>
            </article>
          })}
        </div>
      </section>

      {data.assignments.length === 0 ? <EmptyBlock
        title={activeOnly ? 'No active assignments' : 'No assignment records yet'}
        text="Assign a rider from an order’s detail panel and it will appear here for monitoring."
      /> : <section className="admin-table-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Agent</th><th>Status</th><th>Assigned</th><th>Active for</th><th>Assigned by</th></tr></thead>
            <tbody>{data.assignments.map(assignment => <tr key={assignment.id}>
              <td><b>{assignment.orderNumber}</b><small>{adminMoney(assignment.total)} · {assignment.fulfilment}</small></td>
              <td>{assignment.customerName}<small><MapPin size={11} /> {assignment.city || 'No city'}</small></td>
              <td>{assignment.agent.name}<small><Phone size={11} /> {assignment.agent.phone} · {assignment.agent.capacity} max</small></td>
              <td><StatusPill value={assignment.orderStatus} /><small>{assignment.assignmentStatus}</small></td>
              <td>{adminWhen(assignment.assignedAt)}</td>
              <td><span className={assignment.minutesActive > 90 ? 'admin-overdue' : ''}><Clock3 size={12} /> {assignment.minutesActive} min</span></td>
              <td>{assignment.assignedBy}{assignment.note && <small>{assignment.note}</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}

      <section className="admin-card">
        <header className="admin-card-head"><div><span className="admin-eyebrow">HOW TO USE</span><h3>Assignment monitoring</h3></div></header>
        <div className="admin-help-grid">
          <div><Truck size={18} /><b>Capacity is enforced</b><p>Two admins assigning at the same moment can never oversubscribe a rider. The database locks the agent row and their open order rows first.</p></div>
          <div><Route size={18} /><b>Reassign safely</b><p>Reassigning closes the previous assignment and opens a new one in a single transaction. History stays complete.</p></div>
          <div><UserRound size={18} /><b>Status carries the truth</b><p>Delivered and cancelled orders release capacity automatically; pending orders keep their slot until handled.</p></div>
        </div>
      </section>
    </>}
  </div>
}
