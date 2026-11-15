'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createUserWithEmailAndPassword, GoogleAuthProvider, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth'
import { ArrowLeft, Eye, EyeOff, KeyRound, Leaf, LockKeyhole, ShieldCheck } from 'lucide-react'
import { getFirebaseApiUrl, getFirebaseAuth } from '@/lib/firebase-client'

async function createCustomerSession(idToken: string, profile: { fullName?: string; phone?: string } = {}) {
  const response = await fetch(`${getFirebaseApiUrl()}/auth/customer/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, ...profile }),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Could not create your customer profile.')
}

async function firebaseErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'Email or password is incorrect.'
  if (code === 'auth/email-already-in-use') return 'An account already exists for this email. Try signing in.'
  if (code === 'auth/weak-password') return 'Choose a stronger password with at least 8 characters.'
  if (code === 'auth/popup-closed-by-user') return 'Google sign-in was closed before completion.'
  return error instanceof Error ? error.message : 'Sign-in could not be completed. Please try again.'
}

export function CustomerAuth({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const register = mode === 'register'

  async function finishCustomerSignIn(user: import('firebase/auth').User, profile: { fullName?: string; phone?: string } = {}) {
    const idToken = await user.getIdToken()
    await createCustomerSession(idToken, profile)
    router.replace('/dashboard')
  }

  async function submitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    const auth = getFirebaseAuth()
    if (!auth) { setMessage('Customer sign-in is not configured yet. Set the public Firebase project settings.'); return }
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email') || '').trim()
    const password = String(fields.get('password') || '')
    const fullName = String(fields.get('fullName') || '').trim()
    const phone = String(fields.get('phone') || '').trim()
    setBusy(true)
    try {
      if (register) {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        await updateProfile(credential.user, { displayName: fullName })
        await finishCustomerSignIn(credential.user, { fullName, phone })
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password)
        await finishCustomerSignIn(credential.user)
      }
    } catch (error) { setMessage(await firebaseErrorMessage(error)) }
    finally { setBusy(false) }
  }

  async function googleSignIn() {
    const auth = getFirebaseAuth()
    if (!auth) { setMessage('Google sign-in needs Firebase. Add NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID to .env.local, enable Google in Firebase Authentication, then restart the dev server.'); return }
    setBusy(true); setMessage('')
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      const credential = await signInWithPopup(auth, provider)
      await finishCustomerSignIn(credential.user)
    } catch (error) { setMessage(await firebaseErrorMessage(error)) }
    finally { setBusy(false) }
  }

  return <main className="auth-page"><Link href="/" className="auth-brand"><span className="brand-mark"><Leaf size={20}/></span>fresh<span>farm</span></Link><section className="auth-card"><Link href="/" className="auth-back"><ArrowLeft size={15}/> Back to the shop</Link><div className="eyebrow dark-eyebrow">{register ? 'A FRESH START' : 'WELCOME BACK'}</div><h1>{register ? 'Join the table.' : 'Good to see you.'}</h1><p>{register ? 'Create an account to keep your favourite fresh picks close.' : 'Sign in to check on your orders and saved details.'}</p><button className="google-button" type="button" disabled={busy} onClick={googleSignIn}>Continue with Google</button><div className="auth-divider"><span>or continue with email</span></div><form onSubmit={submitEmail}>{register && <label>Full name<input name="fullName" required autoComplete="name" placeholder="Your name"/></label>}<label>Email address<input name="email" required type="email" autoComplete="email" placeholder="you@example.com"/></label>{register && <label>Phone number<input name="phone" required type="tel" autoComplete="tel" placeholder="+91 98765 43210"/></label>}<label>Password<span className="password-input"><input name="password" required type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={8} placeholder={register ? 'At least 8 characters' : 'Your password'}/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>{register && <label className="terms-check"><input type="checkbox" required/> <span>I agree to the <a href="#terms">terms and privacy policy</a>.</span></label>}{!register && <div className="auth-options"><label className="remember-check"><input type="checkbox"/> Remember me</label><Link href="/forgot-password">Forgot password?</Link></div>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>{message && <div role="alert" className="auth-message">{message}</div>}</form><div className="auth-switch">{register ? 'Already have an account?' : 'New to Fresh Farm?'} <Link href={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></div><small className="auth-security"><ShieldCheck size={14}/> Your account is protected with Firebase Authentication.</small></section></main>
}

type AdminSetupStatus = {
  configured: boolean
  adminProvisioned: boolean
  setupRequired: boolean
  hasPassword: boolean
  hasPin: boolean
  adminEmail: string | null
  adminName: string | null
}

type AdminMode = 'password' | 'pin' | 'setup' | 'reset'

export function AdminLogin() {
  const router = useRouter()
  const [status, setStatus] = useState<AdminSetupStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [mode, setMode] = useState<AdminMode>('password')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${getFirebaseApiUrl()}/auth/admin/setup-status`)
      .then(response => response.ok ? response.json() : null)
      .then((result: AdminSetupStatus | null) => {
        if (!alive || !result) return
        setStatus(result)
        if (result.setupRequired) setMode('setup')
      })
      .catch(() => { if (alive) setStatusError('Could not check the owner setup state. Password or PIN sign-in may still work.') })
    return () => { alive = false }
  }, [])

  function switchMode(next: AdminMode) {
    setMode(next)
    setMessage('')
    setShowPassword(false)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email') || '').trim()
    const body: Record<string, string> = {}
    let path = ''
    try {
      if (mode === 'password') {
        path = '/auth/admin/password-login'
        body.password = String(fields.get('password') || '')
        if (email) body.email = email
      } else if (mode === 'pin') {
        path = '/auth/admin/pin-login'
        body.pin = String(fields.get('pin') || '')
        if (email) body.email = email
      } else if (mode === 'setup') {
        const password = String(fields.get('password') || '')
        if (password !== String(fields.get('confirmPassword') || '')) throw new Error('The two passwords do not match.')
        path = '/auth/admin/setup'
        body.bootstrapPassword = String(fields.get('bootstrapPassword') || '')
        body.password = password
        const pin = String(fields.get('pin') || '').trim()
        if (pin) body.pin = pin
        if (!status?.adminProvisioned) {
          body.email = email
          body.fullName = String(fields.get('fullName') || '').trim()
        }
      } else {
        const newPassword = String(fields.get('newPassword') || '')
        if (newPassword !== String(fields.get('confirmPassword') || '')) throw new Error('The two new passwords do not match.')
        path = '/auth/admin/password-reset'
        body.bootstrapPassword = String(fields.get('bootstrapPassword') || '')
        body.newPassword = newPassword
        const newPin = String(fields.get('newPin') || '').trim()
        if (newPin) body.newPin = newPin
        if (email) body.email = email
      }

      const response = await fetch(`${getFirebaseApiUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Staff sign-in failed.')
      router.replace(result.redirectTo || '/admin/dashboard')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Staff sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function googleAdminLogin() {
    const auth = getFirebaseAuth()
    if (!auth) { setMessage('Google staff sign-in needs Firebase. Add NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID to .env.local, then restart the dev server. Password sign-in still works below.'); return }
    setBusy(true); setMessage('')
    try {
      const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' })
      const credential = await signInWithPopup(auth, provider)
      const response = await fetch(`${getFirebaseApiUrl()}/auth/admin/google-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ idToken: await credential.user.getIdToken() }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'This Google account is not authorized for staff access.')
      router.replace(result.redirectTo || '/admin/dashboard')
      router.refresh()
    } catch (error) { setMessage(await firebaseErrorMessage(error)) }
    finally { setBusy(false) }
  }

  const askForEmail = Boolean(status && !status.adminEmail) || Boolean(statusError)
  const headline = mode === 'setup' ? <>Set up the<br/><em>farmhouse.</em></> : mode === 'reset' ? <>Restore staff<br/><em>access.</em></> : <>Welcome to the<br/><em>farmhouse.</em></>
  const intro = mode === 'setup'
    ? 'Confirm the owner bootstrap password from the server, then choose the password and PIN you will use from now on.'
    : mode === 'reset'
      ? 'Use the owner bootstrap password to replace the sign-in password. Every existing staff session is revoked.'
      : 'Sign in to manage orders, delivery, costs and the live farm analytics.'

  return <main className="admin-auth-page">
    <Link href="/" className="admin-brand"><span className="brand-mark"><Leaf size={20}/></span>fresh<span>farm</span><small>FARMHOUSE</small></Link>
    <section className="admin-login-card">
      <div className="admin-lock"><ShieldCheck size={23}/></div>
      <div className="eyebrow dark-eyebrow">OWNER &amp; STAFF ACCESS</div>
      <h1>{headline}</h1>
      <p>{intro}</p>

      {status?.setupRequired && mode === 'setup' && <div className="admin-setup-note">
        <b>First-time owner setup</b>
        <span>{status.adminName ? `${status.adminName} · ${status.adminEmail}` : 'No staff credentials are set yet.'} The bootstrap password is checked server-side and is never stored in the browser.</span>
      </div>}

      {status && !status.configured && mode !== 'setup' && <div className="admin-setup-note warn">
        <b>Owner bootstrap is not configured</b>
        <span>Set ADMIN_PASSWORD_HASH on the API, or use Google staff sign-in if Firebase auth is configured.</span>
      </div>}

      {mode !== 'setup' && <div className="admin-auth-tabs" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" aria-selected={mode === 'password'} className={mode === 'password' ? 'active' : ''} onClick={() => switchMode('password')}><LockKeyhole size={14}/> Password</button>
        <button type="button" role="tab" aria-selected={mode === 'pin'} className={mode === 'pin' ? 'active' : ''} onClick={() => switchMode('pin')}><KeyRound size={14}/> PIN</button>
      </div>}

      <form onSubmit={submit}>
        {mode === 'setup' && <>
          <label htmlFor="admin-bootstrap">Owner bootstrap password<input id="admin-bootstrap" name="bootstrapPassword" type="password" autoComplete="off" required placeholder="From ADMIN_PASSWORD_HASH setup"/></label>
          {!status?.adminProvisioned && <>
            <label htmlFor="admin-email">Owner email<input id="admin-email" name="email" type="email" autoComplete="email" required placeholder="owner@freshfarm.example"/></label>
            <label htmlFor="admin-name">Owner name<input id="admin-name" name="fullName" autoComplete="name" required placeholder="Your full name"/></label>
          </>}
          <label htmlFor="admin-new-password">New admin password<span className="password-input"><input id="admin-new-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required placeholder="At least 12 characters"/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
          <label htmlFor="admin-confirm-password">Confirm new password<input id="admin-confirm-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required placeholder="Repeat the password"/></label>
          <label htmlFor="admin-setup-pin">Quick sign-in PIN (optional)<input id="admin-setup-pin" name="pin" inputMode="numeric" pattern="\d{6,10}" minLength={6} maxLength={10} autoComplete="off" placeholder="6 to 10 digits"/></label>
        </>}

        {mode === 'reset' && <>
          {askForEmail && <label htmlFor="admin-reset-email">Staff email<input id="admin-reset-email" name="email" type="email" autoComplete="email" placeholder="Only needed with multiple staff accounts"/></label>}
          <label htmlFor="admin-reset-bootstrap">Owner bootstrap password<input id="admin-reset-bootstrap" name="bootstrapPassword" type="password" autoComplete="off" required placeholder="Server owner password"/></label>
          <label htmlFor="admin-reset-password">New admin password<span className="password-input"><input id="admin-reset-password" name="newPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required placeholder="At least 12 characters"/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
          <label htmlFor="admin-reset-confirm">Confirm new password<input id="admin-reset-confirm" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required placeholder="Repeat the password"/></label>
          <label htmlFor="admin-reset-pin">Replace PIN (optional)<input id="admin-reset-pin" name="newPin" inputMode="numeric" pattern="\d{6,10}" minLength={6} maxLength={10} autoComplete="off" placeholder="6 to 10 digits"/></label>
        </>}

        {mode === 'password' && <>
          {askForEmail && <label htmlFor="admin-email-login">Staff email<input id="admin-email-login" name="email" type="email" autoComplete="email" placeholder="Only needed with multiple staff accounts"/></label>}
          <label htmlFor="admin-password">Admin password<span className="password-input"><input id="admin-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password"/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
        </>}

        {mode === 'pin' && <>
          {askForEmail && <label htmlFor="admin-pin-email">Staff email<input id="admin-pin-email" name="email" type="email" autoComplete="email" placeholder="Only needed with multiple staff accounts"/></label>}
          <label htmlFor="admin-pin">Sign-in PIN<input id="admin-pin" name="pin" inputMode="numeric" pattern="\d{6,10}" minLength={6} maxLength={10} autoComplete="off" required placeholder="6 to 10 digits"/></label>
        </>}

        <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'setup' ? 'Create owner credentials' : mode === 'reset' ? 'Reset staff credentials' : mode === 'pin' ? 'Sign in with PIN' : 'Secure sign in'}</button>
        {message && <div role="alert" className="auth-message">{message}</div>}
        {statusError && <div role="status" className="auth-message">{statusError}</div>}
      </form>

      <div className="admin-auth-links">
        {mode === 'setup'
          ? <button type="button" onClick={() => switchMode('password')}>Back to staff sign in</button>
          : <>
            {status?.setupRequired && <button type="button" onClick={() => switchMode('setup')}>First-time owner setup</button>}
            <button type="button" onClick={() => switchMode('reset')}>Forgot password? Reset with owner password</button>
          </>}
      </div>

      <div className="admin-separator"><span>OR</span></div>
      <button className="google-button" type="button" disabled={busy} onClick={googleAdminLogin}>Continue with Google</button>
      <div className="admin-recovery">Staff access is restricted to accounts explicitly authorized by the owner. Sessions expire after eight hours.</div>
    </section>
    <Link href="/" className="admin-back"><ArrowLeft size={14}/> Return to Fresh Farm</Link>
  </main>
}
