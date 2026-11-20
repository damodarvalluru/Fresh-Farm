const express = require('express')
const { rateLimit } = require('express-rate-limit')
const db = require('../config/db')
const { notifyNewsletterSignup } = require('../services/notify')

const router = express.Router()
const signupLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many signups. Please try again later.' } })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

router.post('/', signupLimit, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' })
    await db.execute('INSERT INTO newsletter_subscribers (email) VALUES (?) ON DUPLICATE KEY UPDATE is_active = 1', [email])
    void notifyNewsletterSignup(email)
    return res.status(201).json({ ok: true })
  } catch (error) { next(error) }
})

module.exports = router
