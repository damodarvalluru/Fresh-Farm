import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AdminLogin } from '@/components/auth-screens'

export const metadata: Metadata = {
  title: 'Staff Sign In | Fresh Farm',
  description: 'Secure owner and staff access to the Fresh Farm farmhouse dashboard.',
}

export default async function AdminLoginPage() {
  const cookieStore = await cookies()
  const apiUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000'
  const session = await fetch(`${apiUrl}/api/admin/session`, {
    headers: { cookie: cookieStore.toString() },
    cache: 'no-store',
  }).catch(() => null)
  if (session?.ok) redirect('/admin/dashboard')
  return <AdminLogin />
}
