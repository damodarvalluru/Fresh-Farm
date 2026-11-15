'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BadgeCheck, Camera, KeyRound, LockKeyhole, Mail, Phone, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { adminFetch, adminWhen, type AdminProfile } from '@/lib/admin-api'

export default function AdminProfilePanel({ profile, onUpdated, onNotify, onUnauthorized }: {
  profile: AdminProfile
  onUpdated: (profile: AdminProfile) => void
  onNotify: (message: string) => void
  onUnauthorized: () => void
}) {
  const [form, setForm] = useState({ displayName: profile.displayName, fullName: profile.fullName, phone: profile.phone || '' })
  const [avatar, setAvatar] = useState<string | null>(profile.profileImageUrl)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  const [pinForm, setPinForm] = useState({ currentPassword: '', newPin: '', confirmPin: '' })
  const [pinError, setPinError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setForm({ displayName: profile.displayName, fullName: profile.fullName, phone: profile.phone || '' })
    setAvatar(profile.profileImageUrl)
  }, [profile])

  function handleError(error: unknown) {
    const typed = error as Error & { status?: number }
    if (typed.status === 401) {
      onUnauthorized()
      return 'Your session ended. Sign in again to continue.'
    }
    return typed.message
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      const result = await adminFetch<{ profile: AdminProfile }>('/admin/profile', {
        method: 'PATCH',
        body: JSON.stringify({ ...form, profileImageUrl: avatar }),
      })
      onUpdated(result.profile)
      onNotify('Profile saved.')
    } catch (error) {
      setSaveError(handleError(error))
    } finally {
      setSaving(false)
    }
  }

  function chooseAvatar(file: File | undefined) {
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setSaveError('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > 900_000) {
      setSaveError('Choose an image smaller than 900 KB so it fits the secure database profile field.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : null
      if (value) { setAvatar(value); setSaveError('') }
    }
    reader.onerror = () => setSaveError('The image could not be read.')
    reader.readAsDataURL(file)
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setPasswordError('')
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { setPasswordError('The new passwords do not match.'); return }
    if (passwordForm.newPassword.length < 12) { setPasswordError('Use at least 12 characters for the new password.'); return }
    setPasswordBusy(true)
    try {
      await adminFetch('/auth/admin/credentials', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }),
      })
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      const result = await adminFetch<{ profile: AdminProfile }>('/admin/profile')
      onUpdated(result.profile)
      onNotify('Password changed. Other devices were signed out.')
    } catch (error) {
      setPasswordError(handleError(error))
    } finally {
      setPasswordBusy(false)
    }
  }

  async function changePin(event: FormEvent) {
    event.preventDefault()
    setPinError('')
    if (pinForm.newPin !== pinForm.confirmPin) { setPinError('The PINs do not match.'); return }
    if (!/^\d{6,10}$/.test(pinForm.newPin)) { setPinError('Use 6 to 10 digits for the new PIN.'); return }
    setPinBusy(true)
    try {
      await adminFetch('/auth/admin/credentials', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: pinForm.currentPassword, newPin: pinForm.newPin }),
      })
      setPinForm({ currentPassword: '', newPin: '', confirmPin: '' })
      const result = await adminFetch<{ profile: AdminProfile }>('/admin/profile')
      onUpdated(result.profile)
      onNotify('Sign-in PIN updated.')
    } catch (error) {
      setPinError(handleError(error))
    } finally {
      setPinBusy(false)
    }
  }

  return <div className="admin-stack">
    <div className="admin-two-col profile-top">
      <section className="admin-card">
        <header className="admin-card-head"><div><span className="admin-eyebrow">STAFF IDENTITY</span><h3>Your profile</h3><p>This name appears on order timelines and expense records.</p></div></header>
        <form className="admin-profile-form" onSubmit={saveProfile}>
          <div className="admin-avatar-editor">
            <div className="admin-avatar-large">
              {avatar ? <img src={avatar} alt="Your profile" /> : <span>{(profile.displayName || profile.fullName || 'A').slice(0, 1).toUpperCase()}</span>}
            </div>
            <div>
              <button className="admin-btn small ghost" type="button" onClick={() => fileRef.current?.click()}><Camera size={13} /> Upload photo</button>
              {avatar && <button className="admin-btn small danger" type="button" onClick={() => setAvatar(null)}><Trash2 size={13} /> Remove</button>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => chooseAvatar(event.target.files?.[0])} />
              <small>PNG, JPEG or WebP. Up to 900 KB.</small>
            </div>
          </div>

          <label><span>Display name</span><input required minLength={2} maxLength={160} value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} /></label>
          <label><span>Full name</span><input required minLength={2} maxLength={160} value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })} /></label>
          <label><span>Phone</span><input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="+91 98765 43210" /></label>
          <label><span>Email</span><input value={profile.email} disabled readOnly /></label>
          {saveError && <p className="admin-form-error" role="alert">{saveError}</p>}
          <div className="admin-form-actions"><button className="admin-btn" type="submit" disabled={saving}><Save size={14} /> {saving ? 'Saving…' : 'Save profile'}</button></div>
        </form>
      </section>

      <section className="admin-card">
        <header className="admin-card-head"><div><span className="admin-eyebrow">ACCESS</span><h3>Account facts</h3></div></header>
        <dl className="admin-fact-list">
          <div><dt><ShieldCheck size={14} /> Role</dt><dd><span className="admin-pill delivered"><BadgeCheck size={11} /> {profile.role}</span></dd></div>
          <div><dt><Mail size={14} /> Email</dt><dd>{profile.email}</dd></div>
          <div><dt><Phone size={14} /> Phone</dt><dd>{profile.phone || 'Not added'}</dd></div>
          <div><dt><UserRound size={14} /> Staff since</dt><dd>{adminWhen(profile.memberSince)}</dd></div>
          <div><dt>Last sign-in</dt><dd>{adminWhen(profile.lastLoginAt)}</dd></div>
          <div><dt>Password updated</dt><dd>{adminWhen(profile.passwordUpdatedAt)}</dd></div>
          <div><dt>Password configured</dt><dd>{profile.hasPassword ? 'Yes' : 'Using owner bootstrap'}</dd></div>
          <div><dt>PIN configured</dt><dd>{profile.hasPin ? 'Yes' : 'Not set'}</dd></div>
        </dl>
        <p className="admin-muted">Losing access? Use “Reset with owner password” on the sign-in screen. It rotates both credentials and revokes every existing staff session.</p>
      </section>
    </div>

    <div className="admin-two-col">
      <section className="admin-card">
        <header className="admin-card-head"><div><span className="admin-eyebrow">SECURITY</span><h3>Change password</h3><p>Minimum 12 characters. Other devices are signed out immediately.</p></div></header>
        <form className="admin-form-grid single" onSubmit={changePassword}>
          <label><span>Current password</span><input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={event => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
          <label><span>New password</span><input type="password" autoComplete="new-password" minLength={12} required value={passwordForm.newPassword} onChange={event => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
          <label><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} required value={passwordForm.confirmPassword} onChange={event => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
          {passwordError && <p className="admin-form-error" role="alert">{passwordError}</p>}
          <button className="admin-btn" type="submit" disabled={passwordBusy}><LockKeyhole size={14} /> {passwordBusy ? 'Updating…' : 'Update password'}</button>
        </form>
      </section>

      <section className="admin-card">
        <header className="admin-card-head"><div><span className="admin-eyebrow">QUICK ACCESS</span><h3>Change sign-in PIN</h3><p>A 6–10 digit PIN for fast staff sign-in. Your password confirms the change.</p></div></header>
        <form className="admin-form-grid single" onSubmit={changePin}>
          <label><span>Current password</span><input type="password" autoComplete="current-password" required value={pinForm.currentPassword} onChange={event => setPinForm({ ...pinForm, currentPassword: event.target.value })} /></label>
          <label><span>New PIN</span><input inputMode="numeric" pattern="\d{6,10}" minLength={6} maxLength={10} required value={pinForm.newPin} onChange={event => setPinForm({ ...pinForm, newPin: event.target.value.replace(/\D/g, '') })} /></label>
          <label><span>Confirm new PIN</span><input inputMode="numeric" pattern="\d{6,10}" minLength={6} maxLength={10} required value={pinForm.confirmPin} onChange={event => setPinForm({ ...pinForm, confirmPin: event.target.value.replace(/\D/g, '') })} /></label>
          {pinError && <p className="admin-form-error" role="alert">{pinError}</p>}
          <button className="admin-btn" type="submit" disabled={pinBusy}><KeyRound size={14} /> {pinBusy ? 'Updating…' : 'Update PIN'}</button>
        </form>
      </section>
    </div>
  </div>
}
