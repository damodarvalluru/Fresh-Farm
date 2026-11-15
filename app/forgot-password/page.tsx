'use client'
import Link from 'next/link'
import { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { ArrowLeft, Leaf } from 'lucide-react'
import { getFirebaseAuth } from '@/lib/firebase-client'
export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const auth = getFirebaseAuth()
    if (!auth) { setMessage('Password recovery is not configured. Set the public Firebase project settings first.'); setBusy(false); return }
    const email = String(new FormData(event.currentTarget).get('email') || '').trim()
    try { await sendPasswordResetEmail(auth, email); setSent(true) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not send a reset link. Please try again.') }
    finally { setBusy(false) }
  }
  return <main className="auth-page"><Link href="/" className="auth-brand"><span className="brand-mark"><Leaf size={20}/></span>fresh<span>farm</span></Link><section className="auth-card"><Link href="/login" className="auth-back"><ArrowLeft size={15}/> Back to sign in</Link><div className="eyebrow dark-eyebrow">ACCOUNT RECOVERY</div><h1>{sent ? 'Check your inbox.' : 'Reset your password.'}</h1><p>{sent ? 'If an account exists for that email, password reset instructions will arrive shortly.' : 'Enter the email address associated with your customer account.'}</p>{!sent && <form onSubmit={submit}><label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.com"/></label><button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>{message && <div role="alert" className="auth-message">{message}</div>}</form>}{sent && <div className="auth-message" role="status">Password reset instructions were requested from Firebase Authentication.</div>}</section></main>
}
