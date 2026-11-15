'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3, CalendarCheck, ClipboardList, LayoutDashboard, Leaf, LogOut, ReceiptText, Route, ShieldCheck, Store, UserCircle, Users,
} from 'lucide-react'
import { adminFetch, type AdminProfile } from '@/lib/admin-api'
import AdminOverview from './admin-overview'
import AdminOrdersPanel from './admin-orders-panel'
import AdminAgentsPanel from './admin-agents-panel'
import AdminAssignmentsPanel from './admin-assignments-panel'
import AdminExpensesPanel from './admin-expenses-panel'
import AdminReportsPanel from './admin-reports-panel'
import AdminProfilePanel from './admin-profile-panel'

type Tab = 'overview' | 'orders' | 'agents' | 'assignments' | 'expenses' | 'reports' | 'profile'

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; finance?: boolean }> = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} />, finance: true },
  { id: 'orders', label: 'Orders', icon: <ClipboardList size={16} /> },
  { id: 'assignments', label: 'Delivery live', icon: <Route size={16} /> },
  { id: 'agents', label: 'Agents', icon: <Users size={16} /> },
  { id: 'expenses', label: 'Expenses', icon: <ReceiptText size={16} />, finance: true },
  { id: 'reports', label: 'Reports', icon: <BarChart3 size={16} />, finance: true },
  { id: 'profile', label: 'My profile', icon: <UserCircle size={16} /> },
]

const TITLES: Record<Tab, { eyebrow: string; title: string; text: string }> = {
  overview: { eyebrow: 'FARMHOUSE · ANALYTICS', title: 'The farm, by the numbers.', text: 'Orders, revenue, profit and delivery health from live TiDB records. Filter any period and download the same numbers.' },
  orders: { eyebrow: 'FARMHOUSE · ORDERS', title: 'Every order, in hand.', text: 'Search, filter and open each order to follow the kitchen workflow, assign a rider and keep the timeline honest.' },
  agents: { eyebrow: 'FARMHOUSE · DELIVERY TEAM', title: 'The people on the road.', text: 'Manage riders, service areas and active-order capacity. Assignment limits are enforced by the database.' },
  assignments: { eyebrow: 'FARMHOUSE · LIVE DELIVERY', title: 'Who is carrying what.', text: 'Monitor active assignments and rider workload. Capacity updates the moment an order moves forward.' },
  expenses: { eyebrow: 'FARMHOUSE · COSTS', title: 'Know what it costs.', text: 'Log delivery, packaging, salaries, utilities and rent so profit reflects the whole business, not just revenue.' },
  reports: { eyebrow: 'FARMHOUSE · REPORTS', title: 'Numbers you can share.', text: 'Download clean CSV exports for analytics, orders and expenses. Every file comes from the same database queries.' },
  profile: { eyebrow: 'FARMHOUSE · STAFF', title: 'Your staff profile.', text: 'Keep your details current, change a forgotten password with your current one, and manage a quick sign-in PIN.' },
}

export default function AdminDashboard({ initialProfile }: { initialProfile: AdminProfile }) {
  const router = useRouter()
  const [profile, setProfile] = useState<AdminProfile>(initialProfile)
  const [tab, setTab] = useState<Tab>(initialProfile.role === 'ORDER_MANAGER' ? 'orders' : 'overview')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 4800)
  }, [])

  const unauthorized = useCallback(() => {
    router.replace('/admin/login')
    router.refresh()
  }, [router])

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    if (profile.role === 'ORDER_MANAGER' && TABS.find(item => item.id === tab)?.finance) setTab('orders')
  }, [profile.role, tab])

  const tabs = useMemo(() => TABS.filter(item => !item.finance || profile.role === 'ADMIN' || profile.role === 'MANAGER'), [profile.role])
  const meta = TITLES[tab]

  async function logout() {
    try { await adminFetch('/auth/admin/logout', { method: 'POST' }) } catch { /* clear the client either way */ }
    router.replace('/admin/login')
    router.refresh()
  }

  const initials = (profile.displayName || profile.fullName || 'A').slice(0, 1).toUpperCase()

  return <main className="admin-app">
    <aside className="admin-side">
      <Link href="/" className="admin-brand"><span className="brand-mark"><Leaf size={19} /></span><span>fresh<b>farm</b></span><small>FARMHOUSE</small></Link>

      <div className="admin-side-profile">
        <span className="admin-side-avatar">{profile.profileImageUrl ? <img src={profile.profileImageUrl} alt="" /> : initials}</span>
        <div><b>{profile.displayName || profile.fullName}</b><small>{profile.role.replaceAll('_', ' ')}</small></div>
      </div>

      <nav className="admin-nav" aria-label="Admin sections">
        {tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
          {item.icon}<span>{item.label}</span>
        </button>)}
      </nav>

      <div className="admin-side-foot">
        <Link href="/" className="admin-side-link"><Store size={15} /> View the shop</Link>
        <button type="button" className="admin-side-link" onClick={() => void logout()}><LogOut size={15} /> Sign out</button>
        <div className="admin-side-badge"><ShieldCheck size={13} /> Role-based access active</div>
      </div>
    </aside>

    <div className="admin-main">
      <header className="admin-top">
        <div>
          <span className="admin-eyebrow">{meta.eyebrow}</span>
          <h1>{meta.title}</h1>
          <p>{meta.text}</p>
        </div>
        <div className="admin-top-actions">
          <span className="admin-role-chip"><ShieldCheck size={13} /> {profile.role.replaceAll('_', ' ')}</span>
          <Link href="/admin/dashboard" className="admin-icon-btn" aria-label="Refresh dashboard" onClick={() => router.refresh()}><CalendarCheck size={17} /></Link>
          <button type="button" className="admin-icon-btn" aria-label="Sign out" onClick={() => void logout()}><LogOut size={17} /></button>
        </div>
      </header>

      <section className="admin-body" aria-live="polite">
        {tab === 'overview' && <AdminOverview onNotify={notify} onUnauthorized={unauthorized} />}
        {tab === 'orders' && <AdminOrdersPanel onNotify={notify} onUnauthorized={unauthorized} />}
        {tab === 'assignments' && <AdminAssignmentsPanel onUnauthorized={unauthorized} />}
        {tab === 'agents' && <AdminAgentsPanel role={profile.role} onNotify={notify} onUnauthorized={unauthorized} />}
        {tab === 'expenses' && <AdminExpensesPanel onNotify={notify} onUnauthorized={unauthorized} />}
        {tab === 'reports' && <AdminReportsPanel />}
        {tab === 'profile' && <AdminProfilePanel profile={profile} onUpdated={setProfile} onNotify={notify} onUnauthorized={unauthorized} />}
      </section>
    </div>

    {toast && <div className="admin-toast" role="status">{toast}</div>}
  </main>
}
