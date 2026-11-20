import { getFirebaseApiUrl } from '@/lib/firebase-client'

export type AdminRole = 'ADMIN' | 'MANAGER' | 'ORDER_MANAGER' | string

export type AdminProfile = {
  adminId: number
  userId: number
  email: string
  fullName: string
  displayName: string
  phone: string | null
  role: AdminRole
  profileImageUrl: string | null
  passwordUpdatedAt: string | null
  lastLoginAt: string | null
  hasPassword: boolean
  hasPin: boolean
  usingDefaultCredentials: boolean
  memberSince: string
}

export type AdminOrderItem = {
  productId: number
  name: string
  unit: string
  price: number
  cost: number
  quantity: number
  actualQuantity: number | null
  lineTotal: number
  finalLineTotal: number | null
  costTotal: number
}

export type AdminOrderStatusEvent = {
  status: string
  note: string | null
  actor: string
  at: string
}

export type AdminOrderAssignment = {
  id: number
  status: string
  note: string | null
  agent: string
  agentPhone: string
  assignedBy: string
  assignedAt: string
  endedAt: string
}

export type AdminOrder = {
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
  customer: { name: string; email: string; phone: string | null; customerSince: string }
  address: {
    recipientName: string
    phone: string
    line1: string
    line2: string | null
    landmark: string | null
    city: string
    postalCode: string
  } | null
  deliveryAgent: { id: number; name: string; phone: string; vehicle: string; vehicleNumber: string | null } | null
  payment: {
    id: number
    provider: string
    orderId: string | null
    transactionId: string | null
    amount: number
    status: string
    confirmedAt: string | null
    createdAt: string
    failureReason: string | null
  } | null
  items: AdminOrderItem[]
  timeline?: AdminOrderStatusEvent[]
  assignments?: AdminOrderAssignment[]
  allowedNextStatuses?: string[]
}

export type AdminOrderList = {
  orders: AdminOrder[]
  summary: {
    total: number
    pending: number
    inKitchen: number
    outForDelivery: number
    delivered: number
    cancelled: number
    collected: number
  }
  paging: { page: number; limit: number; total: number; pages: number }
}

export type DeliveryAgent = {
  id: number
  name: string
  phone: string
  email: string | null
  vehicleType: string
  vehicleNumber: string | null
  serviceArea: string | null
  capacity: number
  isActive: boolean
  notes: string | null
  activeOrders?: number
  completedDeliveries?: number
  createdAt: string
  updatedAt: string
}

export type ActiveAssignment = {
  id: number
  orderNumber: string
  orderStatus: string
  fulfilment: string
  paymentStatus: string
  total: number
  customerName: string
  city: string | null
  assignmentStatus: string
  note: string | null
  assignedAt: string
  endedAt: string
  minutesActive: number
  agent: { id: number; name: string; phone: string; capacity: number }
  assignedBy: string
}

export type AgentWorkload = {
  id: number
  name: string
  phone: string
  isActive: boolean
  serviceArea: string | null
  capacity: number
  activeOrders: number
  available: number
}

export type AnalyticsBucket = {
  key: string
  label: string
  orders: number
  delivered: number
  cancelled: number
  revenue: number
  collected: number
  outstanding: number
  cogs: number
  expenses: number
  deliveryCosts: number
  operatingCosts: number
  grossProfit: number
  netProfit: number
  customerSavings: number
  averageOrderValue: number
}

export type AnalyticsRhythmWindow = {
  from: string
  orders: number
  revenue: number
  averageOrdersPerDay: number
  averageRevenuePerDay: number
}

export type AnalyticsRhythm = {
  allTime: AnalyticsRhythmWindow & {
    delivered: number
    cancelled: number
    rejected: number
    activeDays: number
    firstOrderAt: string | null
  }
  today: AnalyticsRhythmWindow
  week: AnalyticsRhythmWindow
  month: AnalyticsRhythmWindow
  year: AnalyticsRhythmWindow
}

export type Analytics = {
  range: 'daily' | 'weekly' | 'monthly' | 'annual'
  from: string
  to: string
  previous: { from: string; to: string; orders: number; revenue: number; netProfit: number }
  changes: { ordersPercent: number; revenuePercent: number; profitPercent: number }
  totals: {
    orders: number
    delivered: number
    cancelled: number
    revenue: number
    collected: number
    outstanding: number
    cogs: number
    expenses: number
    deliveryCosts: number
    operatingCosts: number
    grossProfit: number
    netProfit: number
    customerSavings: number
    averageOrderValue: number
    profitMargin: number
    activeOrders: number
    newCustomers: number
    totalCustomers: number
    deliveredWithAgent: number
    averageDeliveryMinutes: number | null
  }
  series: AnalyticsBucket[]
  rhythm: AnalyticsRhythm
  breakdown: {
    status: Array<{ status: string; count: number; total: number }>
    paymentMethod: Array<{ method: string; count: number; total: number }>
    fulfilment: Array<{ type: string; count: number }>
    section: Array<{ section: 'chicken' | 'fish' | string; revenue: number; quantity: number }>
  }
  products: Array<{ name: string; quantity: number; revenue: number; cost: number; profit: number }>
  agents: Array<{ id: number; name: string; deliveries: number; revenue: number; averageMinutes: number | null }>
  expensesByCategory: Array<{ category: string; total: number }>
}

export type OperatingExpense = {
  id: number
  category: string
  title: string
  amount: number
  expenseDate: string
  notes: string | null
  createdBy: string
  createdAt: string
}

export type ExpenseList = {
  expenses: OperatingExpense[]
  totals: Array<{ category: string; total: number; entries: number }>
  grandTotal: number
}

export type AdminFetchError = Error & { status?: number }

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getFirebaseApiUrl()}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error((result as { error?: string }).error || 'The request could not be completed.') as AdminFetchError
    error.status = response.status
    throw error
  }
  return result as T
}

export function adminMoney(value: number | null | undefined) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function adminCompact(value: number | null | undefined) {
  const amount = Number(value || 0)
  if (Math.abs(amount) >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)}Cr`
  if (Math.abs(amount) >= 100_000) return `₹${(amount / 100_000).toFixed(2)}L`
  if (Math.abs(amount) >= 1_000) return `₹${(amount / 1_000).toFixed(1)}k`
  return `₹${amount.toFixed(0)}`
}

export function adminWhen(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export function adminDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

export function adminStatusLabel(value: string) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

export function todayInputValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function buildQuery(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}
