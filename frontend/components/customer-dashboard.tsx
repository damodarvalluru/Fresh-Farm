'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Ban, Bell, CircleUserRound, Clock3, Download, FileText,
  History, Leaf, Loader2, LogOut, MapPin, Package, PackageCheck, ReceiptIndianRupee,
  Search, ShoppingBag, ShoppingCart, Sparkles, Truck, Wallet, X,
} from 'lucide-react'
import { getFirebaseApiUrl, getFirebaseAuth } from '@/lib/firebase-client'
import { customerFetch, loadCustomerData, money, statusLabel, when, type CustomerData, type CustomerOrder, type CustomerPayment } from '@/lib/customer-api'
import { FlowerCelebration } from './flower-celebration'
import CheckoutForm from './checkout-form'

type Product = { id: number; name: string; category: string; detail: string; price: number; unit: string; image: string; badge?: string }
type Tab = 'overview' | 'orders' | 'history' | 'payments' | 'cart' | 'track'
const CART_KEY = 'fresh-farm-cart'
const ACTIVE_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery']
const TRACK_STEPS = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered']

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Sparkles size={16} /> },
  { id: 'orders', label: 'Orders placed', icon: <Package size={16} /> },
  { id: 'history', label: 'Order history', icon: <History size={16} /> },
  { id: 'payments', label: 'Payment history', icon: <Wallet size={16} /> },
  { id: 'cart', label: 'Add to cart', icon: <ShoppingCart size={16} /> },
  { id: 'track', label: 'Track order', icon: <Truck size={16} /> },
]

function readCart(): Record<number, number> {
  if (typeof window === 'undefined') return {}
  try {
    const saved = window.localStorage.getItem(CART_KEY)
    return saved ? JSON.parse(saved) as Record<number, number> : {}
  } catch { return {} }
}

export default function CustomerDashboard() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [configured, setConfigured] = useState(true)
  const [token, setToken] = useState('')
  const [data, setData] = useState<CustomerData | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null)
  const [selectedPayment, setSelectedPayment] = useState<CustomerPayment | null>(null)
  const [receiptBusy, setReceiptBusy] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Record<number, number>>({})
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [trackNumber, setTrackNumber] = useState('')
  const [trackError, setTrackError] = useState('')
  const toastTimer = useRef<number | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 4200)
  }, [])

  const refresh = useCallback(async (activeToken: string) => {
    setLoading(true)
    setError('')
    try {
      setData(await loadCustomerData(activeToken))
    } catch (loadError) {
      const typed = loadError as Error & { code?: string; status?: number }
      if (typed.code === 'profile-required' || typed.status === 401) {
        setError('Your session needs refreshing. Please sign out and sign in again.')
      } else {
        setError(typed.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) { setConfigured(false); setReady(true); return }
    return onAuthStateChanged(auth, async nextUser => {
      setUser(nextUser)
      setReady(true)
      if (!nextUser) { setToken(''); setData(null); return }
      try {
        const idToken = await nextUser.getIdToken()
        setToken(idToken)
        await refresh(idToken)
      } catch (authError) {
        setError((authError as Error).message)
      }
    })
  }, [refresh])

  useEffect(() => {
    fetch('/api/backend/products')
      .then(response => response.ok ? response.json() : null)
      .then(result => {
        if (!result?.products?.length) return
        setProducts(result.products.map((product: Product) => ({ ...product, image: product.image || '/placeholder.jpg', unit: product.unit.startsWith('/') ? product.unit : `/${product.unit}` })))
      })
      .catch(() => { /* catalogue can be unavailable; the dashboard still works */ })
  }, [])

  useEffect(() => { setCart(readCart()) }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(CART_KEY, JSON.stringify(cart))
  }, [cart])

  useEffect(() => {
    if (!toast) return
    return () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }
  }, [toast])

  const cartLines = useMemo(() => Object.entries(cart)
    .map(([id, quantity]) => {
      const product = products.find(item => item.id === Number(id))
      return product ? { product, quantity } : null
    })
    .filter((line): line is { product: Product; quantity: number } => Boolean(line)), [cart, products])
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0)
  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.price * line.quantity, 0)

  const add = (id: number) => setCart(previous => ({ ...previous, [id]: (previous[id] || 0) + 1 }))
  const remove = (id: number) => setCart(previous => {
    const next = { ...previous }
    if ((next[id] || 0) <= 1) delete next[id]
    else next[id]--
    return next
  })

  const activeOrders = useMemo(() => data?.orders.filter(order => ACTIVE_STATUSES.includes(order.status)) || [], [data])
  const historyOrders = useMemo(() => data?.orders.filter(order => !ACTIVE_STATUSES.includes(order.status)) || [], [data])
  const paidPayments = useMemo(() => data?.payments.filter(payment => ['captured', 'authorized', 'refunded'].includes(payment.status)) || [], [data])

  async function freshToken() {
    if (!user) return token
    return user.getIdToken()
  }

  async function cancelOrder(order: CustomerOrder) {
    const reason = window.prompt(`Cancel order ${order.orderNumber}? Tell us why (optional):`, '')
    if (reason === null) return
    try {
      const activeToken = await freshToken()
      await customerFetch(`/customer/orders/${encodeURIComponent(order.orderNumber)}/cancel`, activeToken, { method: 'POST', body: JSON.stringify({ reason }) })
      notify(`Order ${order.orderNumber} cancelled.`)
      setSelectedOrder(null)
      await refresh(activeToken)
    } catch (cancelError) {
      notify((cancelError as Error).message)
    }
  }

  async function downloadReceipt(payment: CustomerPayment) {
    setReceiptBusy(true)
    try {
      const activeToken = await freshToken()
      const link = await customerFetch<{ token: string; filename: string }>(`/customer/payments/${payment.id}/receipt-link`, activeToken, { method: 'POST' })
      const anchor = document.createElement('a')
      anchor.href = `${getFirebaseApiUrl()}/customer/receipts/${payment.id}?format=pdf&token=${encodeURIComponent(link.token)}`
      anchor.download = link.filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      notify('Receipt download started.')
    } catch (receiptError) {
      notify((receiptError as Error).message)
    } finally {
      setReceiptBusy(false)
    }
  }

  async function openOrder(orderNumber: string) {
    setTrackError('')
    try {
      const activeToken = await freshToken()
      const result = await customerFetch<{ order: CustomerOrder }>(`/customer/orders/${encodeURIComponent(orderNumber)}`, activeToken)
      setSelectedOrder(result.order)
    } catch (lookupError) {
      setTrackError((lookupError as Error).message)
    }
  }

  async function logout() {
    const auth = getFirebaseAuth()
    if (auth) await signOut(auth)
    window.location.href = '/'
  }

  function openCart(productId?: number) {
    if (productId) add(productId)
    setTab('cart')
    setCheckoutOpen(false)
  }

  if (!ready) return <div className="dash-loading"><Loader2 className="spin" size={22} /> Preparing your dashboard…</div>

  if (!configured) return <AuthGate title="Sign-in is not configured" text="Customer sign-in needs the public Firebase web configuration. Add NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID to .env.local." />

  if (!user) return <AuthGate title="Sign in to your dashboard" text="Your orders, payments, receipts and saved bag live in one private place. Sign in with Google or email to continue." />

  const firstName = data?.customer.fullName?.split(' ')[0] || user.displayName?.split(' ')[0] || 'there'

  return <main className="dash-page">
    <a className="skip-link" href="#dash-main">Skip to dashboard content</a>
    <FlowerCelebration active={celebrate} onDone={() => setCelebrate(false)} />
    <aside className="dash-sidebar">
      <Link href="/" className="dash-brand"><span className="brand-mark"><Leaf size={19} /></span><span>fresh<b>farm</b></span></Link>
      <div className="dash-profile-mini">
        <span className="dash-avatar">{(data?.customer.fullName || user.displayName || user.email || 'F').slice(0, 1).toUpperCase()}</span>
        <div><b>{data?.customer.fullName || user.displayName || 'Fresh Farm customer'}</b><small>{user.email}</small></div>
      </div>
      <nav className="dash-nav" aria-label="Dashboard sections">
        {TABS.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
          {item.icon}<span>{item.label}</span>{item.id === 'cart' && cartCount > 0 && <b className="nav-badge">{cartCount}</b>}
        </button>)}
      </nav>
      <div className="dash-sidebar-foot">
        <Link href="/" className="dash-back"><ArrowLeft size={14} /> Back to the shop</Link>
        <button type="button" className="dash-signout" onClick={logout}><LogOut size={14} /> Sign out</button>
      </div>
    </aside>

    <section className="dash-main" id="dash-main" tabIndex={-1}>
      <header className="dash-topbar">
        <div>
          <span className="dash-eyebrow">YOUR FRESH FARM ACCOUNT</span>
          <h1>{firstName === 'there' ? 'Good to see you.' : `Hello, ${firstName}.`}</h1>
        </div>
        <div className="dash-topbar-actions">
          <Link href="/" className="dash-shop"><ShoppingBag size={15} /> Shop fresh</Link>
          <button type="button" className="dash-bell" aria-label="Notifications" onClick={() => notify(activeOrders.length ? `${activeOrders.length} order${activeOrders.length === 1 ? '' : 's'} in progress.` : 'You are all caught up.')}><Bell size={17} /></button>
        </div>
      </header>

      {error && <div className="dash-alert" role="alert">{error}<button type="button" onClick={() => { if (token) refresh(token) }}>Retry</button></div>}

      {loading && !data ? <div className="dash-loading"><Loader2 className="spin" size={20} /> Loading your account…</div> : data && <>
        {tab === 'overview' && <Overview data={data} activeOrders={activeOrders} onOpenOrder={openOrder} onTab={setTab} onOpenPayment={setSelectedPayment} onReceipt={downloadReceipt} receiptBusy={receiptBusy} />}

        {tab === 'orders' && <OrdersPanel title="Orders placed" subtitle="Every order from your most recent checkout, newest first." orders={data.orders} onOpen={openOrder} onCart={() => setTab('cart')} empty="You have not placed an order yet. Your first fresh box is a click away." />}

        {tab === 'history' && <OrdersPanel title="Order history" subtitle="Delivered and cancelled orders, kept for your records." orders={historyOrders} onOpen={openOrder} onCart={() => setTab('cart')} empty="Completed orders will appear here." />}

        {tab === 'payments' && <PaymentsPanel payments={data.payments} onOpen={setSelectedPayment} onReceipt={downloadReceipt} busyId={receiptBusy ? selectedPayment?.id : undefined} />}

        {tab === 'cart' && <CartPanel products={products} cartLines={cartLines} cartTotal={cartTotal} cartCount={cartCount} add={add} remove={remove} onCheckout={() => setCheckoutOpen(true)} onBrowse={() => setTab('orders')} />}

        {tab === 'track' && <TrackPanel orders={activeOrders} onOpen={openOrder} number={trackNumber} onNumber={setTrackNumber} error={trackError} onTrack={() => { if (trackNumber.trim()) openOrder(trackNumber.trim()) }} paidPayments={paidPayments} />}
      </>}
    </section>

    {selectedOrder && <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onCancel={cancelOrder} onReceipt={downloadReceipt} />}
    {selectedPayment && <PaymentDrawer payment={selectedPayment} onClose={() => setSelectedPayment(null)} onReceipt={downloadReceipt} busy={receiptBusy} />}

    {checkoutOpen && <div className="dash-modal-backdrop" onClick={() => setCheckoutOpen(false)}>
      <div className="dash-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Checkout">
        <div className="dash-modal-head"><div><span className="dash-eyebrow">SECURE CHECKOUT</span><h2>Finish your fresh order.</h2></div><button type="button" aria-label="Close checkout" onClick={() => setCheckoutOpen(false)}><X size={19} /></button></div>
        <CheckoutForm
          items={cartLines.map(line => ({ productId: line.product.id, name: line.product.name, price: line.product.price, quantity: line.quantity, unit: line.product.unit, lineTotal: line.product.price * line.quantity }))}
          subtotal={cartTotal}
          token={token}
          initialCustomer={{ fullName: data?.customer.fullName || '', email: data?.customer.email || user.email || '', phone: data?.customer.phone || '' }}
          onBack={() => setCheckoutOpen(false)}
          onPlaced={async () => {
            setCheckoutOpen(false)
            setCart({})
            setCelebrate(true)
            const activeToken = await freshToken()
            await refresh(activeToken)
            setTab('orders')
          }}
        />
      </div>
    </div>}

    {toast && <div className="dash-toast" role="status">{toast}</div>}
  </main>
}

function AuthGate({ title, text }: { title: string; text: string }) {
  return <main className="auth-page"><Link href="/" className="auth-brand"><span className="brand-mark"><Leaf size={20} /></span>fresh<span>farm</span></Link><section className="auth-card"><Link href="/" className="auth-back"><ArrowLeft size={15} /> Back to the shop</Link><div className="eyebrow dark-eyebrow">YOUR FRESH FARM ACCOUNT</div><h1>{title}</h1><p>{text}</p><Link className="auth-submit" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 18 }} href="/login">Sign in to your account</Link><Link className="auth-back" style={{ marginTop: 20, marginBottom: 0 }} href="/account">Track a guest order instead <ArrowRight size={13} /></Link></section></main>
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return <article className="dash-stat"><span className="dash-stat-icon">{icon}</span><div><span>{label}</span><b>{value}</b>{hint && <small>{hint}</small>}</div></article>
}

function Overview({ data, activeOrders, onOpenOrder, onTab, onOpenPayment, onReceipt, receiptBusy }: {
  data: CustomerData
  activeOrders: CustomerOrder[]
  onOpenOrder: (orderNumber: string) => void
  onTab: (tab: Tab) => void
  onOpenPayment: (payment: CustomerPayment) => void
  onReceipt: (payment: CustomerPayment) => void
  receiptBusy: boolean
}) {
  const nextOrder = activeOrders[0]
  const latestPayment = data.payments[0]
  return <div className="dash-stack">
    <div className="dash-hero-card">
      <div>
        <span className="dash-eyebrow light">FRESH, HONEST, DELIVERED</span>
        <h2>Your table&apos;s next<br />good thing.</h2>
        <p>Reorder a favourite, track a delivery, or keep every receipt in one private place.</p>
        <div className="dash-hero-actions">
          <button className="button button-cream" type="button" onClick={() => onTab('cart')}>Shop your favourites <ArrowRight size={15} /></button>
          <button className="dash-ghost" type="button" onClick={() => onTab('orders')}>View orders</button>
        </div>
      </div>
      <div className="dash-hero-badge">
        <span className="orbit orbit-one"><Leaf size={14} /></span>
        <span className="orbit orbit-two"><PackageCheck size={14} /></span>
        <b>{data.stats.deliveredOrders}</b>
        <small>fresh deliveries<br />to your door</small>
      </div>
    </div>

    <div className="dash-stats">
      <StatCard icon={<Package size={19} />} label="Orders placed" value={String(data.stats.totalOrders)} hint={`${data.stats.activeOrders} in progress`} />
      <StatCard icon={<Truck size={19} />} label="Active deliveries" value={String(data.stats.activeOrders)} hint="Tracked live below" />
      <StatCard icon={<PackageCheck size={19} />} label="Delivered" value={String(data.stats.deliveredOrders)} hint="Completed orders" />
      <StatCard icon={<Wallet size={19} />} label="Lifetime paid" value={money(data.stats.lifetimeSpend)} hint="Across confirmed payments" />
    </div>

    <div className="dash-two-col">
      <section className="dash-card">
        <div className="dash-card-head"><div><span className="dash-eyebrow">IN PROGRESS</span><h3>Track your order</h3></div><button type="button" className="dash-link" onClick={() => onTab('track')}>All tracking <ArrowRight size={13} /></button></div>
        {nextOrder ? <div className="dash-track-preview">
          <div className="dash-track-head"><div><b>{nextOrder.orderNumber}</b><small>{nextOrder.items.length} item{nextOrder.items.length === 1 ? '' : 's'} · {money(nextOrder.total)}</small></div><span className={`status-pill ${nextOrder.status}`}>{statusLabel(nextOrder.status)}</span></div>
          <StatusTrack status={nextOrder.status} />
          {nextOrder.deliveryAgent && <p className="dash-agent"><Truck size={14} /> {nextOrder.deliveryAgent.name} · {nextOrder.deliveryAgent.phone}</p>}
          <button className="button button-green" type="button" onClick={() => onOpenOrder(nextOrder.orderNumber)}>Open order details <ArrowRight size={15} /></button>
        </div> : <div className="dash-empty-small"><Truck size={26} /><b>No delivery in progress.</b><p>When you place an order, live tracking appears here.</p><button className="button button-green" type="button" onClick={() => onTab('cart')}>Start your next order</button></div>}
      </section>

      <section className="dash-card">
        <div className="dash-card-head"><div><span className="dash-eyebrow">PAYMENTS</span><h3>Latest payment</h3></div><button type="button" className="dash-link" onClick={() => onTab('payments')}>History <ArrowRight size={13} /></button></div>
        {latestPayment ? <div className="dash-payment-preview">
          <span className={`dash-pay-icon ${latestPayment.status}`}><ReceiptIndianRupee size={22} /></span>
          <div><small>{latestPayment.method} · {when(latestPayment.paidAt || latestPayment.createdAt)}</small><b>{money(latestPayment.amount)}</b><span className={`status-pill ${latestPayment.status}`}>{statusLabel(latestPayment.status)}</span></div>
          <div className="dash-payment-actions"><button type="button" onClick={() => onOpenPayment(latestPayment)}>Details</button><button type="button" disabled={receiptBusy || latestPayment.status === 'failed'} onClick={() => onReceipt(latestPayment)}><Download size={13} /> Receipt</button></div>
        </div> : <div className="dash-empty-small"><Wallet size={26} /><b>No payments yet.</b><p>Payment details and downloadable receipts will appear here.</p></div>}
      </section>
    </div>

    <section className="dash-card">
      <div className="dash-card-head"><div><span className="dash-eyebrow">RECENT ORDERS</span><h3>Your order history</h3></div><button type="button" className="dash-link" onClick={() => onTab('orders')}>See all <ArrowRight size={13} /></button></div>
      {data.orders.length ? <div className="dash-order-list">{data.orders.slice(0, 4).map(order => <button type="button" className="dash-order-row" key={order.orderNumber} onClick={() => onOpenOrder(order.orderNumber)}>
        <span className={`order-dot ${order.status}`} />
        <div><b>{order.orderNumber}</b><small>{when(order.createdAt)} · {order.items.map(item => item.name).slice(0, 2).join(', ')}</small></div>
        <span className={`status-pill ${order.status}`}>{statusLabel(order.status)}</span>
        <b className="dash-order-total">{money(order.total)}</b>
        <ArrowRight size={15} />
      </button>)}</div> : <div className="dash-empty-small"><Package size={26} /><b>No orders yet.</b><p>Your first Fresh Farm order will show up here instantly.</p><button className="button button-green" type="button" onClick={() => onTab('cart')}>Shop fresh</button></div>}
    </section>
  </div>
}

function OrdersPanel({ title, subtitle, orders, onOpen, onCart, empty }: { title: string; subtitle: string; orders: CustomerOrder[]; onOpen: (orderNumber: string) => void; onCart: () => void; empty: string }) {
  const [status, setStatus] = useState('all')
  const statuses = useMemo(() => ['all', ...new Set(orders.map(order => order.status))], [orders])
  const shown = status === 'all' ? orders : orders.filter(order => order.status === status)
  return <div className="dash-stack">
    <div className="dash-section-head"><div><span className="dash-eyebrow">ORDERS</span><h2>{title}</h2><p>{subtitle}</p></div><span className="dash-count">{orders.length} total</span></div>
    <div className="dash-filter-row">{statuses.map(item => <button key={item} type="button" className={status === item ? 'active' : ''} onClick={() => setStatus(item)}>{statusLabel(item)}</button>)}</div>
    {shown.length ? <div className="dash-order-cards">{shown.map(order => <article className="dash-order-card" key={order.orderNumber}>
      <div className="dash-order-card-head"><div><b>{order.orderNumber}</b><small>{when(order.createdAt)} · {order.fulfilment === 'pickup' ? 'Shop pickup' : 'Home delivery'}</small></div><span className={`status-pill ${order.status}`}>{statusLabel(order.status)}</span></div>
      <div className="dash-order-thumbs">{order.items.slice(0, 5).map((item, index) => <span key={`${item.name}-${index}`} title={item.name}>{item.name.slice(0, 2).toUpperCase()}</span>)}</div>
      <div className="dash-order-card-items">{order.items.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name} × {item.quantity} {item.unit}</span><b>{money(item.lineTotal)}</b></div>)}</div>
      <div className="dash-order-card-foot"><div><small>Payment</small><b>{statusLabel(order.paymentStatus)}</b></div><div><small>Total</small><b>{money(order.total)}</b></div><button className="button button-green" type="button" onClick={() => onOpen(order.orderNumber)}>Details <ArrowRight size={14} /></button></div>
    </article>)}</div> : <div className="dash-empty"><ShoppingBag size={32} /><h3>Nothing here yet.</h3><p>{empty}</p><button className="button button-green" type="button" onClick={onCart}>Open your bag</button></div>}
  </div>
}

function PaymentsPanel({ payments, onOpen, onReceipt, busyId }: { payments: CustomerPayment[]; onOpen: (payment: CustomerPayment) => void; onReceipt: (payment: CustomerPayment) => void; busyId?: number }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const shown = payments.filter(payment => (filter === 'all' || payment.status === filter) && `${payment.orderNumber} ${payment.transactionId} ${payment.method}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="dash-stack">
    <div className="dash-section-head"><div><span className="dash-eyebrow">PAYMENTS</span><h2>Payment history</h2><p>Every transaction with its full detail and a downloadable receipt.</p></div><ReceiptIndianRupee size={30} /></div>
    <div className="dash-tools"><label className="dash-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order or transaction ID" aria-label="Search payments" /></label><div className="dash-filter-row inline">{['all', 'captured', 'pending', 'failed', 'refunded'].map(item => <button key={item} type="button" className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : statusLabel(item)}</button>)}</div></div>
    {shown.length ? <div className="dash-payment-table"><div className="dash-payment-table-head"><span>Payment</span><span>Method</span><span>Status</span><span>Amount</span><span>Receipt</span></div>{shown.map(payment => <div className="dash-payment-table-row" key={payment.id}>
      <div><b>#{payment.id} · {payment.orderNumber}</b><small>{when(payment.paidAt || payment.createdAt)}<br />Txn {payment.transactionId}</small></div>
      <div><b>{payment.method}</b><small>{payment.currency}</small></div>
      <div><span className={`status-pill ${payment.status}`}>{statusLabel(payment.status)}</span>{payment.failureReason && <small>{payment.failureReason}</small>}</div>
      <b className="dash-amount">{money(payment.amount)}</b>
      <div className="dash-receipt-actions"><button type="button" onClick={() => onOpen(payment)}><FileText size={14} /> Details</button><button type="button" disabled={busyId === payment.id || payment.status === 'failed'} onClick={() => onReceipt(payment)}>{busyId === payment.id ? <Loader2 className="spin" size={14} /> : <Download size={14} />} PDF</button></div>
    </div>)}</div> : <div className="dash-empty"><Wallet size={32} /><h3>No payments found.</h3><p>Try a different search, or place an order to see payment records here.</p></div>}
  </div>
}

function CartPanel({ products, cartLines, cartTotal, cartCount, add, remove, onCheckout, onBrowse }: {
  products: Product[]
  cartLines: Array<{ product: Product; quantity: number }>
  cartTotal: number
  cartCount: number
  add: (id: number) => void
  remove: (id: number) => void
  onCheckout: () => void
  onBrowse: () => void
}) {
  return <div className="dash-stack">
    <div className="dash-section-head"><div><span className="dash-eyebrow">YOUR BAG</span><h2>Add to cart</h2><p>Your bag stays on this device and follows you between the shop and dashboard.</p></div><span className="dash-count">{cartCount} item{cartCount === 1 ? '' : 's'}</span></div>
    <div className="dash-cart-grid">
      <section className="dash-card">
        <div className="dash-card-head"><div><span className="dash-eyebrow">FRESH PICKS</span><h3>Today&apos;s shop</h3></div><button type="button" className="dash-link" onClick={onBrowse}>Orders <ArrowRight size={13} /></button></div>
        {products.length ? <div className="dash-product-grid">{products.map(product => {
          const quantity = cartLines.find(line => line.product.id === product.id)?.quantity || 0
          return <article className="dash-product" key={product.id}>
            <div className="dash-product-photo">{product.image && <Image src={product.image} alt={product.name} fill sizes="(max-width:700px) 45vw, 220px" />}{product.badge && <span>{product.badge}</span>}</div>
            <div className="dash-product-info"><h4>{product.name}</h4><small>{product.detail}</small><div><b>{money(product.price)}</b><span>{product.unit}</span></div></div>
            {quantity ? <div className="dash-qty"><button type="button" aria-label={`Remove one ${product.name}`} onClick={() => remove(product.id)}>−</button><span>{quantity}</span><button type="button" aria-label={`Add one ${product.name}`} onClick={() => add(product.id)}>+</button></div> : <button type="button" className="dash-add" onClick={() => add(product.id)}>Add to bag</button>}
          </article>
        })}</div> : <div className="dash-empty-small"><Loader2 className="spin" size={22} /><b>Loading the fresh shop…</b><p>If this persists, the catalogue API may be offline.</p></div>}
      </section>
      <aside className="dash-card dash-bag">
        <div className="dash-card-head"><div><span className="dash-eyebrow">BAG SUMMARY</span><h3>{cartCount ? `${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Your bag is empty'}</h3></div><ShoppingBag size={21} /></div>
        {cartLines.length ? <><div className="dash-bag-lines">{cartLines.map(line => <div key={line.product.id}><span>{line.product.name}<small>{line.quantity} × {money(line.product.price)}</small></span><b>{money(line.product.price * line.quantity)}</b></div>)}</div><div className="dash-bag-total"><span>Estimated total</span><b>{money(cartTotal)}</b></div><p className="dash-bag-note"><BadgeCheck size={14} /> Final weight and total confirmed before delivery.</p><button className="button button-green" type="button" onClick={onCheckout}>Continue to checkout <ArrowRight size={15} /></button></> : <div className="dash-empty-small"><ShoppingCart size={26} /><b>Add something fresh.</b><p>Pick from today&apos;s shop and your bag summary will appear here.</p></div>}
      </aside>
    </div>
  </div>
}

function TrackPanel({ orders, onOpen, number, onNumber, error, onTrack }: { orders: CustomerOrder[]; onOpen: (orderNumber: string) => void; number: string; onNumber: (value: string) => void; error: string; onTrack: () => void; paidPayments: CustomerPayment[] }) {
  return <div className="dash-stack">
    <div className="dash-section-head"><div><span className="dash-eyebrow">TRACKING</span><h2>Track order</h2><p>Follow every step from the farmhouse to your door.</p></div><Truck size={30} /></div>
    <form className="dash-track-form" onSubmit={event => { event.preventDefault(); onTrack() }}>
      <Search size={17} />
      <input value={number} onChange={event => onNumber(event.target.value)} placeholder="Enter your order number, e.g. FF-20261115-AB12CD" aria-label="Order number" />
      <button type="submit" className="button button-green">Track order</button>
    </form>
    {error && <p className="dash-alert" role="alert">{error}</p>}
    {orders.length ? <div className="dash-order-cards">{orders.map(order => <article className="dash-order-card track" key={order.orderNumber}>
      <div className="dash-order-card-head"><div><b>{order.orderNumber}</b><small>{when(order.createdAt)} · {order.fulfilment === 'pickup' ? 'Shop pickup' : 'Home delivery'}</small></div><span className={`status-pill ${order.status}`}>{statusLabel(order.status)}</span></div>
      <StatusTrack status={order.status} />
      {order.deliveryAgent && <p className="dash-agent"><CircleUserRound size={15} /><span>{order.deliveryAgent.name} · {order.deliveryAgent.phone} · {order.deliveryAgent.vehicle}</span></p>}
      {order.address && <p className="dash-address"><MapPin size={14} /> {order.address.line1}, {order.address.city} {order.address.postalCode}</p>}
      <div className="dash-order-card-foot"><div><small>Items</small><b>{order.items.length}</b></div><div><small>Total</small><b>{money(order.total)}</b></div><button className="button button-green" type="button" onClick={() => onOpen(order.orderNumber)}>Full details <ArrowRight size={14} /></button></div>
    </article>)}</div> : <div className="dash-empty"><Truck size={32} /><h3>No active deliveries.</h3><p>Orders that are on their way will appear here with live status.</p></div>}
  </div>
}

function StatusTrack({ status }: { status: string }) {
  if (status === 'cancelled' || status === 'rejected') return <div className="dash-track-cancelled"><Ban size={15} /> This order was {status}. {status === 'cancelled' ? 'No payment will be collected.' : 'Please contact the store for details.'}</div>
  const current = Math.max(0, TRACK_STEPS.indexOf(status))
  return <ol className="dash-progress">{TRACK_STEPS.map((step, index) => <li key={step} className={index < current ? 'done' : index === current ? 'current' : ''}>
    <span>{index < current ? <BadgeCheck size={13} /> : index + 1}</span><small>{statusLabel(step)}</small>
  </li>)}</ol>
}

function OrderDrawer({ order, onClose, onCancel, onReceipt }: { order: CustomerOrder; onClose: () => void; onCancel: (order: CustomerOrder) => void; onReceipt: (payment: CustomerPayment) => void }) {
  const payment = order.payment ? { id: order.payment.id, orderNumber: order.orderNumber, orderStatus: order.status, paymentStatus: order.paymentStatus, provider: order.payment.provider, method: order.payment.provider === 'razorpay' ? 'Razorpay online' : 'Cash on delivery', transactionId: order.payment.transactionId || `FF-PAY-${order.payment.id}`, gatewayOrderId: null, amount: order.total, currency: 'INR', status: order.payment.status, failureReason: null, paidAt: order.payment.confirmedAt, createdAt: order.payment.createdAt } as CustomerPayment : null
  return <div className="dash-drawer-backdrop" onClick={onClose}><aside className="dash-drawer" onClick={event => event.stopPropagation()} aria-label={`Order ${order.orderNumber}`}>
    <div className="dash-drawer-head"><div><span className="dash-eyebrow">ORDER DETAILS</span><h2>{order.orderNumber}</h2><small>{when(order.createdAt)}</small></div><button type="button" aria-label="Close order details" onClick={onClose}><X size={20} /></button></div>
    <div className="dash-drawer-body">
      <div className="dash-drawer-status"><span className={`status-pill ${order.status}`}>{statusLabel(order.status)}</span><span className={`status-pill ${order.paymentStatus}`}>Payment {statusLabel(order.paymentStatus)}</span></div>
      <StatusTrack status={order.status} />
      {order.deliveryAgent && <div className="dash-info-block"><h4><Truck size={15} /> Delivery agent</h4><p>{order.deliveryAgent.name}<br />{order.deliveryAgent.phone} · {order.deliveryAgent.vehicle}</p></div>}
      {order.address && <div className="dash-info-block"><h4><MapPin size={15} /> Delivery address</h4><p>{order.address.recipientName}<br />{[order.address.line1, order.address.line2, order.address.landmark].filter(Boolean).join(', ')}<br />{order.address.city} {order.address.postalCode}</p></div>}
      <div className="dash-info-block"><h4><ShoppingBag size={15} /> Items</h4>{order.items.map((item, index) => <div className="dash-drawer-line" key={`${item.name}-${index}`}><span>{item.name} × {item.quantity} {item.unit}<small>{money(item.price)} each</small></span><b>{money(item.lineTotal)}</b></div>)}</div>
      <div className="dash-drawer-totals"><div><span>Subtotal</span><b>{money(order.subtotal)}</b></div><div><span>Delivery</span><b>{order.deliveryFee ? money(order.deliveryFee) : 'Free'}</b></div>{order.discount > 0 && <div><span>Discount</span><b>− {money(order.discount)}</b></div>}<div className="grand"><span>Total</span><b>{money(order.totalFinal ?? order.total)}</b></div></div>
      {order.notes && <div className="dash-info-block"><h4><FileText size={15} /> Notes for the butcher</h4><p>{order.notes}</p></div>}
      {order.cancellationReason && <div className="dash-info-block"><h4><Ban size={15} /> Cancellation reason</h4><p>{order.cancellationReason}</p></div>}
    </div>
    <div className="dash-drawer-foot">
      {payment && <button type="button" className="dash-ghost" disabled={payment.status === 'failed'} onClick={() => onReceipt(payment)}><Download size={14} /> Download receipt</button>}
      {order.canCancel && <button type="button" className="dash-danger" onClick={() => onCancel(order)}><Ban size={14} /> Cancel order</button>}
      <button type="button" className="button button-green" onClick={onClose}>Close</button>
    </div>
  </aside></div>
}

function PaymentDrawer({ payment, onClose, onReceipt, busy }: { payment: CustomerPayment; onClose: () => void; onReceipt: (payment: CustomerPayment) => void; busy: boolean }) {
  const rows: Array<[string, string]> = [
    ['Transaction ID', payment.transactionId],
    ['Gateway order ID', payment.gatewayOrderId || '—'],
    ['Order number', payment.orderNumber],
    ['Payment method', payment.method],
    ['Amount', money(payment.amount)],
    ['Currency', payment.currency],
    ['Status', statusLabel(payment.status)],
    ['Paid on', when(payment.paidAt)],
    ['Created', when(payment.createdAt)],
  ]
  return <div className="dash-drawer-backdrop" onClick={onClose}><aside className="dash-drawer payment" onClick={event => event.stopPropagation()} aria-label={`Payment ${payment.id}`}>
    <div className="dash-drawer-head"><div><span className="dash-eyebrow">PAYMENT DETAILS</span><h2>#{payment.id}</h2><small>{payment.orderNumber}</small></div><button type="button" aria-label="Close payment details" onClick={onClose}><X size={20} /></button></div>
    <div className="dash-drawer-body">
      <div className={`dash-payment-hero ${payment.status}`}><ReceiptIndianRupee size={28} /><div><small>{payment.method}</small><b>{money(payment.amount)}</b><span className={`status-pill ${payment.status}`}>{statusLabel(payment.status)}</span></div></div>
      <dl className="dash-detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {payment.failureReason && <div className="dash-alert" role="alert">{payment.failureReason}</div>}
      <p className="dash-receipt-note"><BadgeCheck size={15} /> Receipts are generated from the verified payment record and include the transaction ID, amount, date, method and status.</p>
    </div>
    <div className="dash-drawer-foot"><button type="button" className="dash-ghost" onClick={onClose}>Close</button><button type="button" className="button button-green" disabled={busy || payment.status === 'failed'} onClick={() => onReceipt(payment)}>{busy ? <Loader2 className="spin" size={15} /> : <Download size={15} />} Download PDF receipt</button></div>
  </aside></div>
}
