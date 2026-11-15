require('dotenv').config()
const express = require('express')
const helmet = require('helmet')
const compression = require('compression')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const adminAuth = require('./routes/auth')
const products = require('./routes/products')
const orders = require('./routes/orders')
const customer = require('./routes/customer')
const newsletter = require('./routes/newsletter')
const adminOrders = require('./routes/admin-orders')
const adminAgents = require('./routes/admin-agents')
const adminAnalytics = require('./routes/admin-analytics')
const adminExpenses = require('./routes/admin-expenses')
const adminProfile = require('./routes/admin-profile')
const { router: payments, razorpayWebhook } = require('./routes/payments')
const { requireAdmin, requireRoles, adminApiLimit } = require('./middleware/require-admin')
const db = require('./config/db')

const app = express()
const port = Number(process.env.PORT || 4000)
const allowedOrigin = process.env.CLIENT_ORIGIN
if (!allowedOrigin) throw new Error('CLIENT_ORIGIN is required')
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters')

app.disable('x-powered-by')
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false)
app.use(helmet())
app.use(compression({ threshold: 1024 }))
app.use(cors({ origin: allowedOrigin, credentials: true, methods: ['GET','POST','PATCH','PUT','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }))
// Razorpay signs the raw request body, so this route must be mounted before the JSON parser.
app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '256kb' }), razorpayWebhook)
app.use(express.json({ limit: '2mb', strict: true }))
app.use(cookieParser())
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
app.use('/api/auth', adminAuth)
app.use('/api/products', products)
app.use('/api/orders', orders)
app.use('/api/customer', customer)
app.use('/api/payments', payments)
app.use('/api/newsletter', newsletter)
// A single limiter + session check for every admin call, then endpoints are
// grouped by role so operational staff never reach finance or reporting data.
app.use('/api/admin', adminApiLimit, requireAdmin)
app.get('/api/admin/session', (req, res) => res.json({ admin: req.admin }))
app.use('/api/admin', adminProfile)
app.use('/api/admin', requireRoles('ADMIN', 'MANAGER', 'ORDER_MANAGER'), adminOrders)
app.use('/api/admin', requireRoles('ADMIN', 'MANAGER', 'ORDER_MANAGER'), adminAgents)
app.use('/api/admin', requireRoles('ADMIN', 'MANAGER'), adminAnalytics)
app.use('/api/admin', requireRoles('ADMIN', 'MANAGER'), adminExpenses)
app.use('/api/admin', (_req, res) => res.status(404).json({ error: 'Admin endpoint not found.' }))
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message)
  if (res.headersSent) return res.end()
  res.status(error.status || 500).json({ error: error.status ? error.message : 'An unexpected server error occurred.' })
})

async function start() {
  await db.query('SELECT 1')
  const server = app.listen(port, () => console.info(`Fresh Farm API listening on port ${port}`))

  const shutdown = signal => {
    console.info(`${signal} received, shutting down gracefully…`)
    server.close(async () => {
      try { await db.end() } catch { /* pool already closed */ }
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
if (require.main === module) start().catch(error => { console.error('API startup failed:', error.message); process.exit(1) })
module.exports = app
