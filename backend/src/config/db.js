const mysql = require('mysql2/promise')

const required = ['TIDB_HOST', 'TIDB_USER', 'TIDB_PASSWORD', 'TIDB_DATABASE']
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required server environment variable: ${key}`)
}

/**
 * A sized, keep-alive connection pool lets the API serve many simultaneous
 * checkouts without opening a new TLS connection per request. Raise
 * DB_POOL_SIZE only within the connection limit of the TiDB cluster.
 */
const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  waitForConnections: true,
  connectionLimit: Math.min(Math.max(Number(process.env.DB_POOL_SIZE) || 20, 5), 100),
  maxIdle: Math.min(Math.max(Number(process.env.DB_POOL_SIZE) || 20, 5), 100),
  idleTimeout: Number(process.env.DB_IDLE_TIMEOUT_MS) || 60_000,
  queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  timezone: 'Z',
  decimalNumbers: true,
  charset: 'UTF8MB4_0900_AI_CI',
})

module.exports = pool
