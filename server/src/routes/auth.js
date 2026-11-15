const express = require('express')
const argon2 = require('argon2')
const jwt = require('jsonwebtoken')
const { randomUUID, createHash } = require('node:crypto')
const { rateLimit } = require('express-rate-limit')
const { verifyIdToken } = require('../services/firebase-auth')
const { requireAdmin } = require('../middleware/require-admin')
const db = require('../config/db')

const router = express.Router()
const production = process.env.NODE_ENV === 'production'
const cookieName = production ? '__Host-ff-admin' : 'ff-admin'
const cookieOptions = { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 }
const adminLoginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again later.' } })
const adminSetupLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many setup attempts. Try again later.' } })
const STAFF_ROLES = ['ADMIN', 'MANAGER', 'ORDER_MANAGER']
const PASSWORD_MIN = 12
const PIN_PATTERN = /^\d{6,10}$/

const GENERIC_LOGIN_ERROR = 'The sign-in details are not correct.'
const NOT_CONFIGURED = 'Staff password access is not configured yet. Use the owner setup process.'

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= 200
}

function validPin(value) {
  return typeof value === 'string' && PIN_PATTERN.test(value)
}

function hash(value) {
  return argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
}

async function bootstrapMatches(password) {
  const bootstrapHash = process.env.ADMIN_PASSWORD_HASH
  if (!bootstrapHash || !bootstrapHash.startsWith('$argon2id$')) return { ok: false, status: 503, error: NOT_CONFIGURED }
  if (typeof password !== 'string' || password.length < 1 || password.length > 200) return { ok: false, status: 400, error: 'Enter the owner bootstrap password.' }
  if (!(await argon2.verify(bootstrapHash, password))) return { ok: false, status: 401, error: 'The owner bootstrap password is not correct.' }
  return { ok: true }
}

async function staffAccounts() {
  const [rows] = await db.query(
    `SELECT a.id, a.password_hash, a.pin_hash, a.is_active, u.email, u.full_name, r.name AS role
     FROM admins a
     JOIN users u ON u.id = a.user_id
     JOIN roles r ON r.id = a.role_id
     WHERE a.is_active = 1 AND u.is_active = 1 AND r.name IN (?)
     ORDER BY a.id`,
    [STAFF_ROLES],
  )
  return rows
}

async function pickStaff(email) {
  const rows = await staffAccounts()
  if (email) {
    const requested = String(email).trim().toLowerCase()
    return rows.find(row => String(row.email).toLowerCase() === requested) || null
  }
  return rows.length === 1 ? rows[0] : null
}

async function issueSession(res, adminId, role) {
  const sessionId = randomUUID()
  const token = jwt.sign({ sub: String(adminId), role, sid: sessionId }, process.env.SESSION_SECRET, { expiresIn: '8h', issuer: 'fresh-farm-api', audience: 'fresh-farm-admin' })
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await db.execute('INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))', [sessionId, adminId, tokenHash])
  await db.execute('UPDATE admins SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [adminId])
  res.cookie(cookieName, token, cookieOptions)
  return { ok: true, redirectTo: '/admin/dashboard', role }
}

// ---------------------------------------------------------------------------
// Customer identity
// ---------------------------------------------------------------------------
router.post('/customer/session', async (req, res, next) => {
  try {
    const idToken = req.body?.idToken
    if (typeof idToken !== 'string' || idToken.length > 10000) return res.status(400).json({ error: 'A Firebase ID token is required.' })
    const decoded = await verifyIdToken(idToken)
    const email = decoded.email?.trim().toLowerCase()
    const fullName = String(req.body?.fullName || decoded.name || email?.split('@')[0] || '').trim().slice(0, 160)
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 32) : null
    if (!email || !fullName) return res.status(400).json({ error: 'A verified email and name are required.' })
    const [existing] = await db.execute('SELECT id, email, full_name, phone FROM users WHERE firebase_uid = ? AND is_active = 1 LIMIT 1', [decoded.uid])
    if (existing.length) return res.json({ user: existing[0] })

    // Attach a verified identity to an account first created by guest checkout.
    // Only guest rows are linked, and only when the provider marked the email verified.
    if (decoded.email_verified && email) {
      const [byEmail] = await db.execute('SELECT id, firebase_uid, email, full_name, phone FROM users WHERE email = ? AND is_active = 1 LIMIT 1', [email])
      if (byEmail.length) {
        const legacyUid = String(byEmail[0].firebase_uid)
        if (!legacyUid.startsWith('guest:') && !legacyUid.startsWith('local-admin:')) {
          return res.status(409).json({ error: 'An account already exists for this email. Sign in with its original method.' })
        }
        await db.execute('UPDATE users SET firebase_uid = ?, full_name = COALESCE(NULLIF(?, \'\'), full_name), phone = COALESCE(NULLIF(?, \'\'), phone), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [decoded.uid, fullName, phone, byEmail[0].id])
        const [linked] = await db.execute('SELECT id, email, full_name, phone FROM users WHERE id = ?', [byEmail[0].id])
        return res.json({ user: linked[0] })
      }
    }

    const [created] = await db.execute("INSERT INTO users (firebase_uid, email, full_name, phone, role_id) SELECT ?, ?, ?, ?, id FROM roles WHERE name = 'CUSTOMER'", [decoded.uid, email, fullName, phone || null])
    const [users] = await db.execute('SELECT id, email, full_name, phone FROM users WHERE id = ?', [created.insertId])
    return res.status(201).json({ user: users[0] })
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ error: error.message })
    if (error.status === 401 || error.code?.startsWith('auth/')) return res.status(401).json({ error: 'The customer identity could not be verified.' })
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account already exists for this email. Sign in with its original method.' })
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Admin setup / credentials
// ---------------------------------------------------------------------------
router.get('/admin/setup-status', async (_req, res, next) => {
  try {
    const rows = await staffAccounts()
    const configured = Boolean(process.env.ADMIN_PASSWORD_HASH?.startsWith('$argon2id$'))
    const hasCredentials = rows.length === 1 && Boolean(rows[0].password_hash || rows[0].pin_hash)
    res.json({
      configured,
      adminProvisioned: rows.length > 0,
      setupRequired: configured && !hasCredentials && rows.length <= 1,
      hasPassword: Boolean(rows[0]?.password_hash),
      hasPin: Boolean(rows[0]?.pin_hash),
      adminEmail: rows.length === 1 ? rows[0].email : null,
      adminName: rows.length === 1 ? rows[0].full_name : null,
    })
  } catch (error) { next(error) }
})

router.post('/admin/setup', adminSetupLimit, async (req, res, next) => {
  try {
    const bootstrap = await bootstrapMatches(req.body?.bootstrapPassword)
    if (!bootstrap.ok) return res.status(bootstrap.status).json({ error: bootstrap.error })
    const password = req.body?.password
    const pin = req.body?.pin
    if (!validPassword(password)) return res.status(400).json({ error: `Choose a password with at least ${PASSWORD_MIN} characters.` })
    if (pin !== undefined && pin !== '' && !validPin(pin)) return res.status(400).json({ error: 'A PIN must be 6 to 10 digits.' })

    let rows = await staffAccounts()
    let adminId
    if (rows.length === 0) {
      const email = text(req.body?.email, 254).toLowerCase()
      const fullName = text(req.body?.fullName, 160)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter the owner email for the first admin account.' })
      if (fullName.length < 2) return res.status(400).json({ error: 'Enter the owner name.' })
      const [createdUser] = await db.execute(
        "INSERT INTO users (firebase_uid, email, full_name, role_id) VALUES (?, ?, ?, (SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1))",
        [`local-admin:${email}`, email, fullName],
      )
      const [createdAdmin] = await db.execute("INSERT INTO admins (user_id, role_id) VALUES (?, (SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1))", [createdUser.insertId])
      adminId = createdAdmin.insertId
      rows = await staffAccounts()
    } else {
      if (rows.length > 1) return res.status(409).json({ error: 'Multiple staff accounts exist. Sign in and change credentials from your profile.' })
      if (rows[0].password_hash || rows[0].pin_hash) return res.status(409).json({ error: 'Admin credentials are already set up. Sign in to change them.' })
      adminId = rows[0].id
    }

    await db.execute('UPDATE admins SET password_hash = ?, pin_hash = ?, password_updated_at = UTC_TIMESTAMP(), display_name = COALESCE(display_name, (SELECT full_name FROM users WHERE id = admins.user_id)) WHERE id = ?', [await hash(password), pin ? await hash(pin) : null, adminId])
    const result = await issueSession(res, adminId, 'ADMIN')
    return res.status(201).json(result)
  } catch (error) { next(error) }
})

router.post('/admin/password-login', adminLoginLimit, async (req, res, next) => {
  try {
    const password = req.body?.password
    if (typeof password !== 'string' || password.length < 1 || password.length > 1024) return res.status(400).json({ error: 'Enter a valid password.' })
    const admin = await pickStaff(req.body?.email)
    if (!admin) return res.status(401).json({ error: GENERIC_LOGIN_ERROR })
    if (admin.password_hash) {
      if (!(await argon2.verify(admin.password_hash, password))) return res.status(401).json({ error: GENERIC_LOGIN_ERROR })
    } else {
      const bootstrapHash = process.env.ADMIN_PASSWORD_HASH
      if (!bootstrapHash) return res.status(503).json({ error: NOT_CONFIGURED })
      if (!bootstrapHash.startsWith('$argon2id$')) return res.status(503).json({ error: 'Configure an Argon2id password hash before enabling admin login.' })
      if (!(await argon2.verify(bootstrapHash, password))) return res.status(401).json({ error: GENERIC_LOGIN_ERROR })
    }
    const result = await issueSession(res, admin.id, admin.role)
    return res.json(result)
  } catch (error) { next(error) }
})

router.post('/admin/pin-login', adminLoginLimit, async (req, res, next) => {
  try {
    const pin = req.body?.pin
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return res.status(400).json({ error: 'Enter your 6 to 10 digit PIN.' })
    const admin = await pickStaff(req.body?.email)
    if (!admin?.pin_hash) return res.status(401).json({ error: GENERIC_LOGIN_ERROR })
    if (!(await argon2.verify(admin.pin_hash, pin))) return res.status(401).json({ error: GENERIC_LOGIN_ERROR })
    const result = await issueSession(res, admin.id, admin.role)
    return res.json(result)
  } catch (error) { next(error) }
})

router.post('/admin/password-reset', adminLoginLimit, async (req, res, next) => {
  try {
    const bootstrap = await bootstrapMatches(req.body?.bootstrapPassword)
    if (!bootstrap.ok) return res.status(bootstrap.status).json({ error: bootstrap.error })
    const newPassword = req.body?.newPassword
    const newPin = req.body?.newPin
    if (!validPassword(newPassword)) return res.status(400).json({ error: `Choose a new password with at least ${PASSWORD_MIN} characters.` })
    if (newPin !== undefined && newPin !== '' && !validPin(newPin)) return res.status(400).json({ error: 'A PIN must be 6 to 10 digits.' })
    const admin = await pickStaff(req.body?.email)
    if (!admin) return res.status(401).json({ error: GENERIC_LOGIN_ERROR })
    await db.execute('UPDATE admins SET password_hash = ?, pin_hash = COALESCE(?, pin_hash), password_updated_at = UTC_TIMESTAMP() WHERE id = ?', [await hash(newPassword), newPin ? await hash(newPin) : null, admin.id])
    await db.execute('UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP() WHERE admin_id = ? AND revoked_at IS NULL', [admin.id])
    const result = await issueSession(res, admin.id, admin.role)
    return res.json(result)
  } catch (error) { next(error) }
})

router.post('/admin/credentials', requireAdmin, async (req, res, next) => {
  try {
    const newPassword = req.body?.newPassword
    const newPin = req.body?.newPin
    if (!newPassword && !newPin) return res.status(400).json({ error: 'Provide a new password or PIN to update.' })
    if (newPassword && !validPassword(newPassword)) return res.status(400).json({ error: `Choose a password with at least ${PASSWORD_MIN} characters.` })
    if (newPin && !validPin(newPin)) return res.status(400).json({ error: 'A PIN must be 6 to 10 digits.' })
    const [rows] = await db.execute('SELECT password_hash FROM admins WHERE id = ? LIMIT 1', [req.admin.id])
    if (!rows.length) return res.status(401).json({ error: 'Your admin account could not be found.' })
    const currentHash = rows[0].password_hash || process.env.ADMIN_PASSWORD_HASH
    const current = req.body?.currentPassword
    if (typeof current !== 'string' || current.length < 1 || current.length > 200) return res.status(400).json({ error: 'Enter your current password to confirm this change.' })
    if (!currentHash || !(await argon2.verify(currentHash, current))) return res.status(401).json({ error: 'Your current password is not correct.' })
    await db.execute('UPDATE admins SET password_hash = COALESCE(?, password_hash), pin_hash = COALESCE(?, pin_hash), password_updated_at = UTC_TIMESTAMP() WHERE id = ?', [newPassword ? await hash(newPassword) : null, newPin ? await hash(newPin) : null, req.admin.id])
    // Other devices are signed out after a credential change; this session stays valid.
    await db.execute('UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP() WHERE admin_id = ? AND id <> ? AND revoked_at IS NULL', [req.admin.id, req.admin.sid])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

router.post('/admin/google-login', adminLoginLimit, async (req, res, next) => {
  try {
    const idToken = req.body?.idToken
    if (typeof idToken !== 'string' || idToken.length > 10000) return res.status(400).json({ error: 'A Firebase ID token is required.' })
    const decoded = await verifyIdToken(idToken)
    const [admins] = await db.execute('SELECT a.id, r.name AS role FROM admins a JOIN users u ON u.id = a.user_id JOIN roles r ON r.id = a.role_id WHERE u.firebase_uid = ? AND u.is_active = 1 AND a.is_active = 1 AND r.name IN (\'ADMIN\',\'MANAGER\',\'ORDER_MANAGER\') LIMIT 1', [decoded.uid])
    if (admins.length) {
      const result = await issueSession(res, admins[0].id, admins[0].role)
      return res.json(result)
    }

    // Allow a provisioned owner/staff row to sign in with Google: match the
    // verified email, then bind the Google UID to that existing user row.
    const email = decoded.email?.trim().toLowerCase()
    if (decoded.email_verified && email) {
      const [byEmail] = await db.execute('SELECT a.id, r.name AS role, u.id AS user_id, u.firebase_uid FROM admins a JOIN users u ON u.id = a.user_id JOIN roles r ON r.id = a.role_id WHERE u.email = ? AND u.is_active = 1 AND a.is_active = 1 AND r.name IN (\'ADMIN\',\'MANAGER\',\'ORDER_MANAGER\') LIMIT 1', [email])
      if (byEmail.length) {
        if (String(byEmail[0].firebase_uid).startsWith('local-admin:') || String(byEmail[0].firebase_uid).startsWith('guest:')) {
          await db.execute('UPDATE users SET firebase_uid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [decoded.uid, byEmail[0].user_id])
        }
        const result = await issueSession(res, byEmail[0].id, byEmail[0].role)
        return res.json(result)
      }
    }

    return res.status(403).json({ error: 'This Google account is not authorized for staff access.' })
  } catch (error) {
    if (error.status === 503) return res.status(503).json({ error: error.message })
    if (error.status === 401 || error.code?.startsWith('auth/')) return res.status(401).json({ error: 'The Google sign-in could not be verified.' })
    next(error)
  }
})

router.post('/admin/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[cookieName]
    if (token) {
      try {
        const claims = jwt.verify(token, process.env.SESSION_SECRET, { issuer: 'fresh-farm-api', audience: 'fresh-farm-admin' })
        await db.execute('UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND revoked_at IS NULL', [claims.sid])
      } catch { /* Expired or invalid cookies are still cleared. */ }
    }
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined })
    return res.status(204).end()
  } catch (error) { next(error) }
})

module.exports = router
