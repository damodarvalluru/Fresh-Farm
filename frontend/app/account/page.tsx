'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { ArrowLeft, Leaf, LockKeyhole, LogOut, Package, Search } from 'lucide-react'
import { getFirebaseAuth } from '@/lib/firebase-client'

type TrackedOrder = {
  orderNumber: string
  status: string
  paymentMethod: string
  paymentStatus: string
  fulfilment: string
  total: number
  createdAt: string
  items: Array<{ name: string; quantity: number; unit: string; lineTotal: number }>
}

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null)
  const [configured, setConfigured] = useState(true)
  const [ready, setReady] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [email, setEmail] = useState('')
  const [tracked, setTracked] = useState<TrackedOrder | null>(null)
  const [trackError, setTrackError] = useState('')
  const [tracking, setTracking] = useState(false)

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) { setConfigured(false); setReady(true); return }
    return onAuthStateChanged(auth, nextUser => { setUser(nextUser); setEmail(current => current || nextUser?.email || ''); setReady(true) })
  }, [])

  async function logout() { const auth = getFirebaseAuth(); if (auth) await signOut(auth) }

  async function trackOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTrackError('')
    setTracked(null)
    setTracking(true)
    try {
      const response = await fetch(`/api/backend/orders/${encodeURIComponent(orderNumber.trim())}?email=${encodeURIComponent(email.trim())}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Order not found.')
      setTracked(result.order)
    } catch (error) {
      setTrackError((error as Error).message)
    } finally {
      setTracking(false)
    }
  }

  return <main className="auth-page"><Link href="/" className="auth-brand"><span className="brand-mark"><Leaf size={20}/></span>fresh<span>farm</span></Link><section className="auth-card"><Link href="/" className="auth-back"><ArrowLeft size={15}/> Back to the shop</Link><div className="eyebrow dark-eyebrow">YOUR FRESH FARM ACCOUNT</div>{!ready ? <><h1>Your table, your way.</h1><p>Loading your account…</p></> : user ? <><h1>Hello, {user.displayName || 'there'}.</h1><p>{user.email}</p><div className="auth-message"><Package size={15}/> Track any order below with the order number and email used at checkout.</div><button className="auth-submit" type="button" onClick={logout} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:18}}><LogOut size={16}/> Sign out</button></> : <><h1>Your table, your way.</h1><p>Sign in to see your details, or track a guest order with your order number and email.</p><div className="auth-message"><LockKeyhole size={15}/> {configured ? 'Sign in to access your customer account.' : 'Customer sign-in requires Firebase project configuration.'}</div><Link className="auth-submit" style={{display:'flex',alignItems:'center',justifyContent:'center',marginTop:18}} href="/login">Sign in to your account</Link></>}

    <form className="order-track" onSubmit={trackOrder}>
      <div className="eyebrow dark-eyebrow"><Search size={12}/> TRACK AN ORDER</div>
      <label><span>Order number</span><input required value={orderNumber} onChange={event => setOrderNumber(event.target.value)} placeholder="FF-20260101-AB12CD"/></label>
      <label><span>Email used at checkout</span><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/></label>
      <button className="auth-submit" type="submit" disabled={tracking}>{tracking ? 'Looking up…' : 'Track order'}</button>
      {trackError && <p className="admin-status-error" role="alert">{trackError}</p>}
    </form>

    {tracked && <div className="tracked-order">
      <div className="tracked-order-head"><b>{tracked.orderNumber}</b><span className={`admin-pill ${tracked.status}`}>{tracked.status.replaceAll('_', ' ')}</span></div>
      <p>{tracked.fulfilment === 'pickup' ? 'Shop pickup' : 'Home delivery'} · placed {new Date(tracked.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      {tracked.items.map(item => <div className="tracked-line" key={item.name}><span>{item.name} × {item.quantity} {item.unit}</span><b>₹{item.lineTotal.toLocaleString('en-IN')}</b></div>)}
      <div className="tracked-order-foot"><span>Payment: {tracked.paymentStatus.replaceAll('_', ' ')}</span><b>Total ₹{tracked.total.toLocaleString('en-IN')}</b></div>
    </div>}
    </section></main>
}
