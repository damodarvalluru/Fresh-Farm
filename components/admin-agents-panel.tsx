'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Bike, Mail, MapPin, Pencil, Phone, Plus, Power, RefreshCw, Trash2, Truck, UserRound } from 'lucide-react'
import { adminDate, adminFetch, type DeliveryAgent } from '@/lib/admin-api'
import { EmptyBlock, ErrorBlock, LoadingBlock, Modal } from './admin-ui'

const VEHICLES = ['bike', 'scooter', 'car', 'van', 'other']

type AgentForm = {
  name: string
  phone: string
  email: string
  vehicleType: string
  vehicleNumber: string
  serviceArea: string
  capacity: string
  notes: string
  isActive: boolean
}

const EMPTY_FORM: AgentForm = {
  name: '', phone: '', email: '', vehicleType: 'bike', vehicleNumber: '', serviceArea: '', capacity: '5', notes: '', isActive: true,
}

function toForm(agent: DeliveryAgent): AgentForm {
  return {
    name: agent.name,
    phone: agent.phone,
    email: agent.email || '',
    vehicleType: agent.vehicleType || 'bike',
    vehicleNumber: agent.vehicleNumber || '',
    serviceArea: agent.serviceArea || '',
    capacity: String(agent.capacity),
    notes: agent.notes || '',
    isActive: agent.isActive,
  }
}

export default function AdminAgentsPanel({ role, onNotify, onUnauthorized }: {
  role: string
  onNotify: (message: string) => void
  onUnauthorized: () => void
}) {
  const [agents, setAgents] = useState<DeliveryAgent[]>([])
  const [includeInactive, setIncludeInactive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<DeliveryAgent | 'new' | null>(null)
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await adminFetch<{ agents: DeliveryAgent[] }>(`/admin/agents?includeInactive=${includeInactive}`)
      setAgents(result.agents)
    } catch (loadError) {
      const typed = loadError as Error & { status?: number }
      if (typed.status === 401 || typed.status === 403) return onUnauthorized()
      setError(typed.message)
    } finally {
      setLoading(false)
    }
  }, [includeInactive, onUnauthorized])

  useEffect(() => { void load() }, [load])

  function openCreate() {
    setEditing('new')
    setForm(EMPTY_FORM)
    setFormError('')
  }

  function openEdit(agent: DeliveryAgent) {
    setEditing(agent)
    setForm(toForm(agent))
    setFormError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFormError('')
    try {
      const body = { ...form, capacity: Number(form.capacity) }
      if (editing === 'new') {
        await adminFetch('/admin/agents', { method: 'POST', body: JSON.stringify(body) })
        onNotify(`${form.name} added to the delivery team.`)
      } else if (editing) {
        await adminFetch(`/admin/agents/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        onNotify(`${form.name} updated.`)
      }
      setEditing(null)
      await load()
    } catch (saveError) {
      setFormError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(agent: DeliveryAgent) {
    setBusy(true)
    try {
      if (agent.isActive && (agent.activeOrders || 0) > 0) {
        throw new Error('Reassign this agent’s active orders before deactivating.')
      }
      await adminFetch(`/admin/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !agent.isActive }) })
      onNotify(`${agent.name} ${agent.isActive ? 'deactivated' : 'reactivated'}.`)
      await load()
    } catch (toggleError) {
      onNotify((toggleError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(agent: DeliveryAgent) {
    if (!window.confirm(`Delete ${agent.name}? This only works if the agent has no assignment history.`)) return
    setBusy(true)
    try {
      await adminFetch(`/admin/agents/${agent.id}`, { method: 'DELETE' })
      onNotify(`${agent.name} deleted.`)
      await load()
    } catch (deleteError) {
      onNotify((deleteError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canEdit = role === 'ADMIN' || role === 'MANAGER'

  return <div className="admin-stack">
    <section className="admin-toolbar">
      <label className="admin-check"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Show inactive agents</label>
      <div className="admin-spacer" />
      <button className="admin-btn ghost" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh</button>
      {canEdit && <button className="admin-btn" type="button" onClick={openCreate}><Plus size={15} /> Add agent</button>}
    </section>

    {error && <ErrorBlock message={error} onRetry={() => void load()} />}
    {loading && !agents.length ? <LoadingBlock label="Loading the delivery team…" /> : agents.length === 0 ? <EmptyBlock
      title="No delivery agents yet"
      text="Add riders with their phone number, service area and a sensible active-order capacity. Assignments are capped automatically."
      action={canEdit ? <button className="admin-btn" type="button" onClick={openCreate}><Plus size={15} /> Add the first agent</button> : undefined}
    /> : <section className="admin-agent-grid">
      {agents.map(agent => {
        const load = agent.activeOrders || 0
        const percent = Math.min((load / Math.max(agent.capacity, 1)) * 100, 100)
        return <article key={agent.id} className={`admin-agent-card${agent.isActive ? '' : ' inactive'}`}>
          <header>
            <div className="admin-agent-avatar">{(agent.name || 'A').slice(0, 1).toUpperCase()}</div>
            <div>
              <h3>{agent.name}</h3>
              <span className={`admin-pill ${agent.isActive ? 'delivered' : 'cancelled'}`}>{agent.isActive ? 'Active' : 'Inactive'}</span>
            </div>
            <span className="admin-agent-vehicle"><Bike size={15} /> {agent.vehicleType}</span>
          </header>
          <div className="admin-agent-facts">
            <span><Phone size={13} /> {agent.phone}</span>
            {agent.email && <span><Mail size={13} /> {agent.email}</span>}
            {agent.serviceArea && <span><MapPin size={13} /> {agent.serviceArea}</span>}
            {agent.vehicleNumber && <span><Truck size={13} /> {agent.vehicleNumber}</span>}
            <span><UserRound size={13} /> Joined {adminDate(agent.createdAt)}</span>
          </div>
          <div className="admin-workload">
            <div><span>Active orders</span><b>{load} / {agent.capacity}</b></div>
            <div className="admin-bar-track"><i style={{ width: `${percent}%`, background: percent >= 100 ? '#b76a54' : percent >= 70 ? '#c69351' : '#5d7a58' }} /></div>
            <small>{agent.completedDeliveries || 0} completed deliveries</small>
          </div>
          {agent.notes && <p className="admin-agent-notes">{agent.notes}</p>}
          {canEdit && <footer>
            <button className="admin-btn small ghost" type="button" disabled={busy} onClick={() => openEdit(agent)}><Pencil size={13} /> Edit</button>
            <button className="admin-btn small ghost" type="button" disabled={busy} onClick={() => void toggle(agent)}><Power size={13} /> {agent.isActive ? 'Deactivate' : 'Reactivate'}</button>
            {role === 'ADMIN' && <button className="admin-btn small danger" type="button" disabled={busy} onClick={() => void remove(agent)}><Trash2 size={13} /> Delete</button>}
          </footer>}
        </article>
      })}
    </section>}

    {editing && <Modal
      title={editing === 'new' ? 'Add a delivery agent' : `Edit ${editing.name}`}
      subtitle="DELIVERY TEAM"
      onClose={() => setEditing(null)}
      footer={<>
        <button className="admin-btn ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
        <button className="admin-btn" type="submit" form="agent-form" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Add agent' : 'Save changes'}</button>
      </>}
    >
      <form id="agent-form" className="admin-form-grid" onSubmit={submit}>
        {formError && <p className="admin-form-error" role="alert">{formError}</p>}
        <label><span>Full name</span><input required minLength={2} maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label><span>Phone</span><input required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="+91 98765 43210" /></label>
        <label><span>Email (optional)</span><input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <label><span>Service area</span><input value={form.serviceArea} onChange={event => setForm({ ...form, serviceArea: event.target.value })} placeholder="Indiranagar, HSR Layout" /></label>
        <label><span>Vehicle</span><select value={form.vehicleType} onChange={event => setForm({ ...form, vehicleType: event.target.value })}>{VEHICLES.map(vehicle => <option key={vehicle} value={vehicle}>{vehicle}</option>)}</select></label>
        <label><span>Vehicle number</span><input value={form.vehicleNumber} onChange={event => setForm({ ...form, vehicleNumber: event.target.value })} /></label>
        <label><span>Active order capacity</span><input type="number" min={1} max={50} required value={form.capacity} onChange={event => setForm({ ...form, capacity: event.target.value })} /></label>
        <label className="admin-check-field"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> <span>Available for assignments</span></label>
        <label className="span-2"><span>Notes</span><textarea rows={3} maxLength={500} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="Shift timing, preferred area, anything the team should know" /></label>
      </form>
    </Modal>}
  </div>
}
