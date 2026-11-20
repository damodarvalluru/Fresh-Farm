import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import AdminDashboard from '@/components/admin-dashboard'
import type { AdminProfile } from '@/lib/admin-api'

export const metadata: Metadata = {
  title: 'Farmhouse Dashboard | Fresh Farm',
  description: 'Private staff dashboard for orders, delivery assignments, operating costs and farm analytics.',
}

export default async function AdminDashboardPage() {
  const cookieStore = await cookies()
  const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000'
  const headers = { cookie: cookieStore.toString() }

  const session = await fetch(`${apiUrl}/api/admin/session`, { headers, cache: 'no-store' }).catch(() => null)
  if (!session?.ok) redirect('/admin/login')

  const profileResponse = await fetch(`${apiUrl}/api/admin/profile`, { headers, cache: 'no-store' }).catch(() => null)
  if (!profileResponse?.ok) redirect('/admin/login')
  const { profile } = await profileResponse.json() as { profile: AdminProfile }

  return <AdminDashboard initialProfile={profile} />
}
