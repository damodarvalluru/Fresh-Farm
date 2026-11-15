import { getFirebaseApiUrl } from '@/lib/firebase-client'

export type CustomerProfile = {
  id: number
  email: string
  fullName: string
  phone: string | null
  memberSince: string
}

export type CustomerStats = {
  totalOrders: number
  activeOrders: number
  deliveredOrders: number
  cancelledOrders: number
  lifetimeSpend: number
}

export type OrderItem = {
  productId: number
  name: string
  unit: string
  price: number
  quantity: number
  actualQuantity: number | null
  lineTotal: number
  finalLineTotal: number | null
}

export type CustomerOrder = {
  orderNumber: string
  status: string
  fulfilment: string
  paymentMethod: string
  paymentStatus: string
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  totalFinal: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
  assignedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  canCancel: boolean
  address: { recipientName: string; line1: string; line2: string | null; landmark: string | null; city: string; postalCode: string } | null
  deliveryAgent: { name: string; phone: string; vehicle: string } | null
  payment: { id: number; provider: string; transactionId: string | null; status: string; confirmedAt: string | null; createdAt: string } | null
  items: OrderItem[]
}

export type CustomerPayment = {
  id: number
  orderNumber: string
  orderStatus: string
  paymentStatus: string
  provider: string
  method: string
  transactionId: string
  gatewayOrderId: string | null
  amount: number
  currency: string
  status: string
  failureReason: string | null
  paidAt: string | null
  createdAt: string
}

export type CustomerData = {
  customer: CustomerProfile
  stats: CustomerStats
  orders: CustomerOrder[]
  payments: CustomerPayment[]
}

export function money(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function when(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export function statusLabel(value: string) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export async function customerFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getFirebaseApiUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error((result as { error?: string }).error || 'The request could not be completed.') as Error & { status?: number; code?: string }
    error.status = response.status
    error.code = (result as { code?: string }).code
    throw error
  }
  return result as T
}

export async function loadCustomerData(token: string): Promise<CustomerData> {
  const [me, orders, payments] = await Promise.all([
    customerFetch<{ customer: CustomerProfile; stats: CustomerStats }>('/customer/me', token),
    customerFetch<{ orders: CustomerOrder[] }>('/customer/orders?limit=100', token),
    customerFetch<{ payments: CustomerPayment[] }>('/customer/payments', token),
  ])
  return { customer: me.customer, stats: me.stats, orders: orders.orders, payments: payments.payments }
}
