'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getFirebaseApiUrl } from '@/lib/firebase-client'
export function AdminLogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function logout() {
    setBusy(true)
    try { await fetch(`${getFirebaseApiUrl()}/auth/admin/logout`, { method: 'POST', credentials: 'include' }) }
    finally { router.replace('/admin/login'); router.refresh() }
  }
  return <button className="auth-submit" type="button" disabled={busy} onClick={logout} style={{marginTop:18}}>{busy ? 'Signing out…' : 'Sign out'}</button>
}
