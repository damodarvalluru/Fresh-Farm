import type { Metadata } from 'next'
import CustomerDashboard from '@/components/customer-dashboard'

export const metadata: Metadata = {
  title: 'My Dashboard | Fresh Farm',
  description: 'Private Fresh Farm dashboard for orders, payments, receipts and delivery tracking.',
}

export default function DashboardPage() {
  return <CustomerDashboard />
}
