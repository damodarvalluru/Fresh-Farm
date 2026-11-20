/*
 * Provision or rotate the owner/admin account used by the password and PIN login.
 *
 * Usage (from the server folder):
 *   node scripts/create-admin.js --email owner@example.com --name "Shop Owner" --password "choose-a-strong-password"
 *   node scripts/create-admin.js --email owner@example.com --password "choose-a-strong-password" --pin 864209
 *   node scripts/create-admin.js --password "choose-a-strong-password" --print-hash
 *
 * The password hash is written to the admins table, so the account works even
 * without ADMIN_PASSWORD_HASH. Passwords and PINs are never written to disk or
 * printed. Use --print-hash when you prefer to keep the hash in the environment
 * as a bootstrap/fallback instead.
 *
 * Rotating the password revokes every existing staff session.
 */
require('dotenv').config()
const argon2 = require('argon2')
const db = require('../src/config/db')

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? '' : String(process.argv[index + 1] || '')
}

const hasFlag = name => process.argv.includes(`--${name}`)
const password = arg('password')
const pin = arg('pin').trim()

async function main() {
  if (password.length < 12) throw new Error('Choose a password with at least 12 characters.')
  if (pin && !/^\d{6,10}$/.test(pin)) throw new Error('A PIN must be 6 to 10 digits.')

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  const pinHash = pin ? await argon2.hash(pin, { type: argon2.argon2id }) : null

  if (hasFlag('print-hash')) {
    console.log('\nPaste this line into server/.env:\n')
    console.log(`ADMIN_PASSWORD_HASH=${passwordHash}\n`)
    await db.end()
    return
  }

  const email = arg('email').trim().toLowerCase()
  const name = arg('name').trim() || email.split('@')[0]
  if (!email || !email.includes('@')) throw new Error('Pass --email owner@example.com')

  const [[role]] = await db.execute("SELECT id FROM roles WHERE name = 'ADMIN' LIMIT 1")
  if (!role) throw new Error('Roles are missing. Apply database/schema.sql first.')

  const firebaseUid = `local-admin:${email}`
  await db.execute(
    'INSERT INTO users (firebase_uid, email, full_name, role_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role_id = VALUES(role_id), is_active = 1',
    [firebaseUid, email, name, role.id],
  )
  const [[user]] = await db.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
  await db.execute(
    'INSERT INTO admins (user_id, role_id, password_hash, pin_hash, password_updated_at, is_active) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 1) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), password_hash = VALUES(password_hash), pin_hash = COALESCE(VALUES(pin_hash), pin_hash), password_updated_at = UTC_TIMESTAMP(), is_active = 1',
    [user.id, role.id, passwordHash, pinHash],
  )
  const [[admin]] = await db.execute('SELECT id FROM admins WHERE user_id = ? LIMIT 1', [user.id])
  await db.execute('UPDATE admin_sessions SET revoked_at = UTC_TIMESTAMP() WHERE admin_id = ? AND revoked_at IS NULL', [admin.id])

  console.log('\nAdmin account ready:', email)
  console.log('Password hash stored in the database. Existing staff sessions were revoked.')
  if (pinHash) console.log('Sign-in PIN stored in the database.')
  console.log('ADMIN_PASSWORD_HASH in server/.env is optional now; keep it only as a bootstrap/fallback.')
  console.log('Sign in at /admin/login with the new password or PIN.\n')
  await db.end()
}

main().catch(async error => {
  console.error('Admin setup failed:', error.message)
  try { await db.end() } catch { /* already closed */ }
  process.exit(1)
})
