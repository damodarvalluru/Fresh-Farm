'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { adminCompact, adminMoney, adminStatusLabel } from '@/lib/admin-api'

export function StatusPill({ value }: { value: string }) {
  return <span className={`admin-pill ${value}`}>{adminStatusLabel(value)}</span>
}

export function LoadingBlock({ label = 'Loading the latest farm records…' }: { label?: string }) {
  return <div className="admin-loading"><Loader2 className="spin" size={20} /> {label}</div>
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="admin-error" role="alert">
    <AlertCircle size={17} />
    <span>{message}</span>
    {onRetry && <button type="button" className="admin-btn ghost" onClick={onRetry}>Try again</button>}
  </div>
}

export function EmptyBlock({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="admin-empty-state">
    <b>{title}</b>
    <p>{text}</p>
    {action}
  </div>
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

export function Modal({ title, subtitle, onClose, children, footer, wide = false }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])
  return <Portal><div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={ref} tabIndex={-1} className={`admin-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="admin-modal-head">
        <div>
          {subtitle && <span className="admin-eyebrow">{subtitle}</span>}
          <h2>{title}</h2>
        </div>
        <button type="button" className="admin-icon-btn" aria-label="Close dialog" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="admin-modal-body">{children}</div>
      {footer && <footer className="admin-modal-foot">{footer}</footer>}
    </div>
  </div></Portal>
}

export function Drawer({ title, subtitle, onClose, children, footer }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])
  return <Portal><div className="admin-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header className="admin-drawer-head">
        <div>
          {subtitle && <span className="admin-eyebrow">{subtitle}</span>}
          <h2>{title}</h2>
        </div>
        <button type="button" className="admin-icon-btn" aria-label="Close panel" onClick={onClose}><X size={17} /></button>
      </header>
      <div className="admin-drawer-body">{children}</div>
      {footer && <footer className="admin-drawer-foot">{footer}</footer>}
    </aside>
  </div></Portal>
}

type Series = { label: string; color: string; values: number[]; area?: boolean }

function niceMax(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

/**
 * Responsive inline SVG chart — no chart library, no client-side canvas, and
 * every data point is available to screen readers through <title>.
 */
export function TrendChart({ points, series, height = 230, money = true }: {
  points: string[]
  series: Series[]
  height?: number
  money?: boolean
}) {
  const width = 760
  const pad = { top: 16, right: 14, bottom: 32, left: 58 }
  const chartW = width - pad.left - pad.right
  const chartH = height - pad.top - pad.bottom
  const max = niceMax(Math.max(...series.flatMap(item => item.values), 0))
  const stepX = points.length > 1 ? chartW / (points.length - 1) : 0
  const xAt = (index: number) => pad.left + (points.length > 1 ? index * stepX : chartW / 2)
  const yAt = (value: number) => pad.top + chartH - (Math.max(value, 0) / max) * chartH
  const labelStep = Math.max(Math.ceil(points.length / 7), 1)
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return <div className="admin-chart">
    <div className="admin-chart-legend">
      {series.map(item => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.map(item => item.label).join(' and ')} trend over ${points.length} periods`} preserveAspectRatio="none">
      <title>{series.map(item => item.label).join(' and ')} trend</title>
      {ticks.map(tick => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + chartH - tick * chartH} y2={pad.top + chartH - tick * chartH} className="chart-grid" />
        <text x={pad.left - 9} y={pad.top + chartH - tick * chartH + 3} textAnchor="end" className="chart-axis">{money ? adminCompact(max * tick) : Math.round(max * tick)}</text>
      </g>)}
      {series.map(item => {
        const line = item.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ')
        const area = `M ${xAt(0)} ${pad.top + chartH} L ${item.values.map((value, index) => `${xAt(index)} ${yAt(value)}`).join(' L ')} L ${xAt(item.values.length - 1)} ${pad.top + chartH} Z`
        return <g key={item.label}>
          {item.area && <path d={area} fill={item.color} opacity="0.12" />}
          <polyline className="chart-line" pathLength={1} points={line} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          {item.values.map((value, index) => <circle key={index} cx={xAt(index)} cy={yAt(value)} r="3" fill="#fffefa" stroke={item.color} strokeWidth="2">
            <title>{`${item.label} · ${points[index]}: ${money ? adminMoney(value) : value}`}</title>
          </circle>)}
        </g>
      })}
      {points.map((label, index) => (index % labelStep === 0 || index === points.length - 1)
        ? <text key={`${label}-${index}`} x={xAt(index)} y={height - 10} textAnchor="middle" className="chart-axis">{label}</text>
        : null)}
    </svg>
  </div>
}

export function BarList({ rows }: { rows: Array<{ label: string; value: number; meta?: string; color?: string }> }) {
  const max = Math.max(...rows.map(row => row.value), 1)
  if (!rows.length) return <p className="admin-muted">No records in this period yet.</p>
  return <div className="admin-bar-list">
    {rows.map(row => <div key={row.label} className="admin-bar-row">
      <div className="admin-bar-label"><span>{adminStatusLabel(row.label)}</span><b>{row.meta || row.value.toLocaleString('en-IN')}</b></div>
      <div className="admin-bar-track"><i style={{ width: `${Math.max((row.value / max) * 100, row.value ? 3 : 0)}%`, background: row.color }} /></div>
    </div>)}
  </div>
}

export function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return <div className={`admin-metric${tone ? ` ${tone}` : ''}`}>
    <span>{label}</span>
    <b>{value}</b>
    {hint && <small>{hint}</small>}
  </div>
}
