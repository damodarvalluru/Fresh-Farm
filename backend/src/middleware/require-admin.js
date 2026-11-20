const jwt = require('jsonwebtoken')
const { createHash } = require('node:crypto')
const { rateLimit } = require('express-rate-limit')
const db = require('../config/db')

const cookieName = process.env.NODE_ENV === 'production' ? '__Host-ff-admin' : 'ff-admin'
const requireAdmin = async (req, res, next) => {
  try {
    const token = req.cookies?.[cookieName]
    if (!token) return res.status(401).json({ error: 'Authentication required.' })
    const claims = jwt.verify(token, process.env.SESSION_SECRET, { issuer: 'fresh-farm-api', audience: 'fresh-farm-admin' })
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const [rows] = await db.execute('SELECT s.admin_id, r.name AS role FROM admin_sessions s JOIN admins a ON a.id = s.admin_id JOIN roles r ON r.id = a.role_id WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP() AND a.is_active = 1 AND a.id = ? AND r.name = ?', [claims.sid, tokenHash, claims.sub, claims.role])
    if (!rows.length) return res.status(401).json({ error: 'Session is invalid or expired.' })
    req.admin = { id: rows[0].admin_id, sid: claims.sid, role: rows[0].role }
    return next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session is invalid or expired.' })
    return next(error)
  }
}
const requireRoles = (...roles) => (req, res, next) => {
  if (!req.admin || !roles.includes(req.admin.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' })
  return next()
}
const adminApiLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false })
module.exports = { requireAdmin, requireRoles, adminApiLimit }
