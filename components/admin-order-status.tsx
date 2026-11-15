'use client'

import { useState } from 'react'

const STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'rejected', 'cancelled']
const LABELS: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export function AdminOrderStatus({ orderNumber, status }: { orderNumber: string; status: string }) {
  const [value, setValue] = useState(status)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function change(next: string) {
    const previous = value
    setValue(next)
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/backend/admin/orders/${encodeURIComponent(orderNumber)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not update the order.')
    } catch (updateError) {
      setValue(previous)
      setError((updateError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="admin-status-wrap">
      <select className="admin-status" value={value} disabled={busy} onChange={event => change(event.target.value)} aria-label={`Status for ${orderNumber}`}>
        {STATUSES.map(statusOption => <option key={statusOption} value={statusOption}>{LABELS[statusOption]}</option>)}
      </select>
      {error && <small className="admin-status-error">{error}</small>}
    </span>
  )
}
