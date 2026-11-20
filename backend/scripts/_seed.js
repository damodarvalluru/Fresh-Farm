require('dotenv').config()
const fs = require('node:fs')
const path = require('node:path')
const mysql = require('mysql2/promise')

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'seed.sql'), 'utf8').replace(/^\s*USE\s+[^;]+;\s*/i, '')
  const connection = await mysql.createConnection({
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_DATABASE,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    multipleStatements: true,
    decimalNumbers: true,
  })
  await connection.query(sql)
  const [rows] = await connection.query('SELECT c.section, COUNT(*) AS products FROM products p JOIN categories c ON c.id = p.category_id GROUP BY c.section ORDER BY c.section')
  console.info(rows)
  await connection.end()
}

main().catch(error => { console.error(error); process.exit(1) })
