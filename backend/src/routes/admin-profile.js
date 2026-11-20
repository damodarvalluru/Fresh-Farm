const express = require('express')
const db = require('../config/db')

const router = express.Router()
const AVATAR = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/
const MAX_AVATAR_CHARS = 1_500_000

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function mapProfile(row) {
  return {
    adminId: Number(row.admin_id),
    userId: Number(row.user_id),
    email: row.email,
    fullName: row.full_name,
    displayName: row.display_name || row.full_name,
    phone: row.phone,
    role: row.role,
    profileImageUrl: row.profile_image_url || null,
    passwordUpdatedAt: row.password_updated_at,
    lastLoginAt: row.last_login_at,
    hasPassword: Boolean(row.has_password),
    hasPin: Boolean(row.has_pin),
    usingDefaultCredentials: !row.has_password && !row.has_pin,
    memberSince: row.created_at,
  }
}

const PROFILE_SELECT = `
  SELECT a.id AS admin_id, a.user_id, a.display_name, a.profile_image_url, a.password_updated_at,
         a.last_login_at, a.created_at, a.password_hash IS NOT NULL AS has_password,
         a.pin_hash IS NOT NULL AS has_pin,
         u.email, u.full_name, u.phone, r.name AS role
  FROM admins a
  JOIN users u ON u.id = a.user_id
  JOIN roles r ON r.id = a.role_id
  WHERE a.id = ? LIMIT 1
`

router.get('/profile', async (req, res, next) => {
  try {
    const [rows] = await db.execute(PROFILE_SELECT, [req.admin.id])
    if (!rows.length) return res.status(404).json({ error: 'Admin profile not found.' })
    const [roles] = await db.query('SELECT name FROM roles WHERE name IN (?, ?, ?) ORDER BY id', ['ADMIN', 'MANAGER', 'ORDER_MANAGER'])
    res.json({ profile: mapProfile(rows[0]), staffRoles: roles.map(role => role.name) })
  } catch (error) { next(error) }
})

router.patch('/profile', async (req, res, next) => {
  try {
    const [rows] = await db.execute(PROFILE_SELECT, [req.admin.id])
    if (!rows.length) return res.status(404).json({ error: 'Admin profile not found.' })
    const current = rows[0]

    const displayName = req.body?.displayName === undefined ? (current.display_name || current.full_name) : text(req.body.displayName, 160)
    const fullName = req.body?.fullName === undefined ? current.full_name : text(req.body.fullName, 160)
    const phone = req.body?.phone === undefined ? current.phone : (text(req.body.phone, 32) || null)
    if (displayName.length < 2) return res.status(400).json({ error: 'Enter a display name with at least 2 characters.' })
    if (fullName.length < 2) return res.status(400).json({ error: 'Enter a name with at least 2 characters.' })
    if (phone && !/^[0-9+\-\s()]{6,32}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number or leave it blank.' })

    let avatar = current.profile_image_url || null
    if (req.body?.profileImageUrl === null || req.body?.profileImageUrl === '') {
      avatar = null
    } else if (typeof req.body?.profileImageUrl === 'string') {
      const candidate = req.body.profileImageUrl
      if (candidate.length > MAX_AVATAR_CHARS) return res.status(413).json({ error: 'Choose an image smaller than 1 MB.' })
      if (!AVATAR.test(candidate)) return res.status(400).json({ error: 'Upload a PNG, JPEG or WebP image.' })
      avatar = candidate
    }

    await db.execute('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [fullName, phone, current.user_id])
    await db.execute('UPDATE admins SET display_name = ?, profile_image_url = ? WHERE id = ?', [displayName, avatar, req.admin.id])
    const [updated] = await db.execute(PROFILE_SELECT, [req.admin.id])
    res.json({ profile: mapProfile(updated[0]) })
  } catch (error) { next(error) }
})

module.exports = router
