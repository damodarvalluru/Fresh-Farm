'use client'

import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'

type CartLine = { productId: number; name: string; price: number; quantity: number; unit: string; lineTotal: number }

type PlacedOrder = {
  orderNumber: string
  total: number
  paymentStatus: string
}

type PaymentInfo = {
  provider: string
  keyId: string
  razorpayOrderId: string
  amount: number
  currency: string
  orderNumber: string
  customer: { name?: string; email?: string; contact?: string }
}

type OrderResponse = {
  order: { orderNumber: string; total: number; paymentStatus: string; paymentMethod: string }
  payment: PaymentInfo | null
  paymentUnavailable?: boolean
  error?: string
  orderNumber?: string
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  return new Promise(resolve => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay]')
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.razorpay = 'true'
    script.onload = () => resolve(Boolean(window.Razorpay))
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

function newCheckoutId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export default function CheckoutForm({
  items,
  subtotal,
  token,
  initialCustomer,
  onBack,
  onPlaced,
}: {
  items: CartLine[]
  subtotal: number
  token?: string
  initialCustomer?: { fullName?: string; email?: string; phone?: string }
  onBack: () => void
  onPlaced: (order: PlacedOrder) => void
}) {
  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>('delivery')
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cash_on_delivery'>('online')
  const [form, setForm] = useState({ fullName: initialCustomer?.fullName || '', email: initialCustomer?.email || '', phone: initialCustomer?.phone || '', line1: '', line2: '', landmark: '', city: '', postalCode: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingOrder, setPendingOrder] = useState<{ orderNumber: string; email: string; total: number } | null>(null)
  // Stable for this checkout attempt. If the network drops after the order was
  // saved, retrying with the same id returns the original order instead of
  // creating a duplicate.
  const clientOrderId = useRef(newCheckoutId())

  const deliveryFee = fulfilment === 'pickup' || subtotal >= 999 ? 0 : 49
  const total = subtotal + deliveryFee

  function update(field: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(previous => ({ ...previous, [field]: event.target.value }))
  }

  async function startPayment(result: OrderResponse, email: string) {
    if (!result.payment) {
      onPlaced({ orderNumber: result.order.orderNumber, total: result.order.total, paymentStatus: result.order.paymentStatus })
      return
    }
    setPendingOrder({ orderNumber: result.order.orderNumber, email, total: result.order.total })
    const loaded = await loadRazorpay()
    if (!loaded || !window.Razorpay) {
      setError('Could not load the secure payment window. Your order is saved — retry payment below.')
      setBusy(false)
      return
    }
    const payment = result.payment
    const checkout = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amount,
      currency: payment.currency,
      order_id: payment.razorpayOrderId,
      name: 'Fresh Farm',
      description: `Order ${payment.orderNumber}`,
      prefill: payment.customer,
      theme: { color: '#2f5138' },
      handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          const verifyResponse = await fetch('/api/backend/payments/razorpay/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
          })
          const verified = await verifyResponse.json()
          if (!verifyResponse.ok) throw new Error(verified.error || 'Payment verification failed.')
          onPlaced({ orderNumber: result.order.orderNumber, total: result.order.total, paymentStatus: 'paid' })
        } catch (verifyError) {
          setError(`${(verifyError as Error).message} If money was debited, contact us with order ${result.order.orderNumber}.`)
          setBusy(false)
        }
      },
      modal: {
        ondismiss: () => {
          setError('Payment window closed. Your order is saved — you can retry online payment or call us to switch to cash on delivery.')
          setBusy(false)
        },
      },
    })
    checkout.open()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/backend/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          clientOrderId: clientOrderId.current,
          customer: { fullName: form.fullName, email: form.email, phone: form.phone },
          address: fulfilment === 'delivery' ? {
            recipientName: form.fullName,
            phone: form.phone,
            line1: form.line1,
            line2: form.line2,
            landmark: form.landmark,
            city: form.city,
            postalCode: form.postalCode,
          } : undefined,
          fulfilment,
          paymentMethod,
          notes: form.notes,
          items: items.map(item => ({ productId: item.productId, quantity: item.quantity })),
        }),
      })
      const result = await response.json() as OrderResponse
      if (!response.ok) throw new Error(result.error || 'Could not place the order.')
      if (result.paymentUnavailable) {
        onPlaced({ orderNumber: result.order.orderNumber, total: result.order.total, paymentStatus: 'pending' })
        return
      }
      await startPayment(result, form.email)
    } catch (submitError) {
      setError((submitError as Error).message)
      setBusy(false)
    }
  }

  async function retryPayment() {
    if (!pendingOrder) return
    setError('')
    setBusy(true)
    try {
      const response = await fetch(`/api/backend/orders/${encodeURIComponent(pendingOrder.orderNumber)}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingOrder.email }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not restart payment.')
      await startPayment({ order: { orderNumber: pendingOrder.orderNumber, total: pendingOrder.total, paymentStatus: 'pending', paymentMethod: 'online' }, payment: result.payment }, pendingOrder.email)
    } catch (retryError) {
      setError((retryError as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="checkout-form" onSubmit={submit}>
      <button type="button" className="checkout-back" onClick={onBack}><ArrowLeft size={14}/> Back to bag</button>

      <div className="checkout-section">
        <span className="checkout-label">How would you like it?</span>
        <div className="checkout-toggle">
          <button type="button" className={fulfilment === 'delivery' ? 'active' : ''} onClick={() => setFulfilment('delivery')}>Home delivery</button>
          <button type="button" className={fulfilment === 'pickup' ? 'active' : ''} onClick={() => setFulfilment('pickup')}>Shop pickup</button>
        </div>
      </div>

      <div className="checkout-section">
        <span className="checkout-label">Contact</span>
        <label className="checkout-field"><span>Full name</span><input required value={form.fullName} onChange={update('fullName')} autoComplete="name" maxLength={160}/></label>
        <label className="checkout-field"><span>Email</span><input required type="email" value={form.email} onChange={update('email')} autoComplete="email" maxLength={254}/></label>
        <label className="checkout-field"><span>Phone</span><input required type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" maxLength={32}/></label>
      </div>

      {fulfilment === 'delivery' && <div className="checkout-section">
        <span className="checkout-label">Delivery address</span>
        <label className="checkout-field"><span>Address line 1</span><input required value={form.line1} onChange={update('line1')} autoComplete="address-line1" maxLength={255}/></label>
        <label className="checkout-field"><span>Address line 2 (optional)</span><input value={form.line2} onChange={update('line2')} autoComplete="address-line2" maxLength={255}/></label>
        <label className="checkout-field"><span>Landmark (optional)</span><input value={form.landmark} onChange={update('landmark')} maxLength={160}/></label>
        <div className="checkout-row">
          <label className="checkout-field"><span>City</span><input required value={form.city} onChange={update('city')} autoComplete="address-level2" maxLength={120}/></label>
          <label className="checkout-field"><span>Postal code</span><input required value={form.postalCode} onChange={update('postalCode')} autoComplete="postal-code" maxLength={20}/></label>
        </div>
      </div>}

      <div className="checkout-section">
        <span className="checkout-label">Payment</span>
        <div className="checkout-toggle">
          <button type="button" className={paymentMethod === 'online' ? 'active' : ''} onClick={() => setPaymentMethod('online')}><LockKeyhole size={12}/> Pay online</button>
          <button type="button" className={paymentMethod === 'cash_on_delivery' ? 'active' : ''} onClick={() => setPaymentMethod('cash_on_delivery')}>Cash on delivery</button>
        </div>
      </div>

      <div className="checkout-section">
        <span className="checkout-label">Preparation notes (optional)</span>
        <label className="checkout-field"><textarea value={form.notes} onChange={update('notes')} rows={2} maxLength={1000} placeholder="Cut preferences, cleaning requests, delivery time…"/></label>
      </div>

      <div className="cart-summary">
        <div><span>Subtotal</span><b>₹{subtotal.toLocaleString('en-IN')}</b></div>
        <div><span>Delivery</span><b>{deliveryFee ? `₹${deliveryFee}` : 'Free'}</b></div>
        <div><span>Estimated total</span><b>₹{total.toLocaleString('en-IN')}</b></div>
        <p><ShieldCheck size={14}/> Final total is confirmed after your order is weighed.</p>
      </div>

      {error && <p className="checkout-error" role="alert">{error}</p>}
      {pendingOrder && !busy && error && <button type="button" className="button button-outline checkout-retry" onClick={retryPayment}>Retry online payment</button>}
      <button type="submit" className="button button-green checkout-button" disabled={busy}>
        {busy ? 'Opening secure payment…' : paymentMethod === 'online' ? `Pay ₹${total.toLocaleString('en-IN')} securely` : 'Place order'} <ArrowRight size={16}/>
      </button>
      <small>Payments are processed by Razorpay. We never see your card details.</small>
    </form>
  )
}
