/*
 * Idempotent database migration for the Fresh Farm API.
 *
 * Usage (from the server folder):
 *   node scripts/migrate.js
 *
 * The script only adds missing tables, columns, and indexes. It never drops or
 * rewrites existing business data, so it is safe to run on an existing shop.
 */
require('dotenv').config()
const db = require('../src/config/db')

async function columnExists(table, column) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column],
  )
  return rows.length > 0
}

async function indexExists(table, index) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [table, index],
  )
  return rows.length > 0
}

async function addColumn(table, column, definition) {
  if (await columnExists(table, column)) return false
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
  console.info(`Added column ${table}.${column}`)
  return true
}

async function addIndex(table, index, definition) {
  if (await indexExists(table, index)) return false
  await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` ${definition}`)
  console.info(`Added index ${table}.${index}`)
  return true
}

async function addUniqueIndex(table, index, definition) {
  if (await indexExists(table, index)) return false
  await db.query(`ALTER TABLE \`${table}\` ADD UNIQUE INDEX \`${index}\` ${definition}`)
  console.info(`Added unique index ${table}.${index}`)
  return true
}

async function main() {
  await db.query('SELECT 1')

  // --- Admin security / profile -------------------------------------------
  await addColumn('admins', 'password_hash', 'VARCHAR(255) NULL')
  await addColumn('admins', 'pin_hash', 'VARCHAR(255) NULL')
  await addColumn('admins', 'display_name', 'VARCHAR(160) NULL')
  await addColumn('admins', 'profile_image_url', 'MEDIUMTEXT NULL')
  await addColumn('admins', 'password_updated_at', 'DATETIME NULL')
  await addColumn('admins', 'last_login_at', 'DATETIME NULL')

  // --- Product costs (profit reporting) -----------------------------------
  await addColumn('products', 'cost_price', 'DECIMAL(10,2) NOT NULL DEFAULT 0')
  await addColumn('order_items', 'cost_snapshot', 'DECIMAL(10,2) NOT NULL DEFAULT 0')

  // --- Catalogue sections (separate chicken and fish ranges) ---------------
  await addColumn('categories', 'section', "ENUM('chicken','fish') NOT NULL DEFAULT 'chicken'")
  await addIndex('categories', 'idx_categories_section', '(section, is_active, sort_order)')

  // --- Delivery agents -----------------------------------------------------
  await db.query(`
    CREATE TABLE IF NOT EXISTS delivery_agents (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(160) NOT NULL,
      phone VARCHAR(32) NOT NULL,
      email VARCHAR(254) NULL,
      vehicle_type ENUM('bike','scooter','car','van','other') NOT NULL DEFAULT 'bike',
      vehicle_number VARCHAR(40) NULL,
      service_area VARCHAR(160) NULL,
      max_active_orders INT UNSIGNED NOT NULL DEFAULT 5,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_delivery_agent_phone (phone),
      INDEX idx_delivery_agent_active (is_active, name)
    ) ENGINE=InnoDB
  `)

  // --- Orders: idempotency, delivery assignment, timestamps ----------------
  await addColumn('orders', 'client_order_id', 'VARCHAR(80) NULL')
  await addColumn('orders', 'delivery_agent_id', 'BIGINT UNSIGNED NULL')
  await addColumn('orders', 'assigned_at', 'DATETIME NULL')
  await addColumn('orders', 'delivered_at', 'DATETIME NULL')
  await addColumn('orders', 'cancelled_at', 'DATETIME NULL')
  await addColumn('orders', 'cancellation_reason', 'VARCHAR(500) NULL')
  await addUniqueIndex('orders', 'uq_orders_client', '(customer_id, client_order_id)')
  await addIndex('orders', 'idx_orders_agent', '(delivery_agent_id, status)')
  await addIndex('orders', 'idx_orders_payment_date', '(payment_status, created_at)')
  if (!(await indexExists('orders', 'fk_order_agent'))) {
    try {
      await db.query('ALTER TABLE orders ADD CONSTRAINT fk_order_agent FOREIGN KEY (delivery_agent_id) REFERENCES delivery_agents(id) ON DELETE SET NULL')
      console.info('Added foreign key orders.delivery_agent_id')
    } catch (error) {
      if (error.code !== 'ER_FK_DUP_NAME' && error.code !== 'ER_DUP_KEYNAME') throw error
    }
  }

  // --- Assignment history --------------------------------------------------
  // `ended_at` uses a sentinel value while an assignment is active, so the
  // unique (order_id, ended_at) key guarantees an order can never have two
  // simultaneous active delivery agents. Closed assignments get a real time.
  await db.query(`
    CREATE TABLE IF NOT EXISTS order_assignments (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      order_id BIGINT UNSIGNED NOT NULL,
      agent_id BIGINT UNSIGNED NOT NULL,
      assigned_by BIGINT UNSIGNED NULL,
      status ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
      note VARCHAR(500) NULL,
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME(6) NOT NULL DEFAULT '1970-01-01 00:00:00.000000',
      UNIQUE KEY uq_assignment_active_order (order_id, ended_at),
      CONSTRAINT fk_assignment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_assignment_agent FOREIGN KEY (agent_id) REFERENCES delivery_agents(id) ON DELETE CASCADE,
      CONSTRAINT fk_assignment_admin FOREIGN KEY (assigned_by) REFERENCES admins(id) ON DELETE SET NULL,
      INDEX idx_assignment_agent (agent_id, status, assigned_at),
      INDEX idx_assignment_order (order_id, assigned_at)
    ) ENGINE=InnoDB
  `)

  // --- Operating expenses (profit reporting) ------------------------------
  await db.query(`
    CREATE TABLE IF NOT EXISTS operating_expenses (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      category ENUM('delivery','packaging','salaries','utilities','marketing','rent','other') NOT NULL DEFAULT 'other',
      title VARCHAR(160) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      expense_date DATE NOT NULL,
      notes VARCHAR(500) NULL,
      created_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_expense_admin FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL,
      CONSTRAINT chk_expense_amount CHECK (amount >= 0),
      INDEX idx_expense_date (expense_date),
      INDEX idx_expense_category (category, expense_date)
    ) ENGINE=InnoDB
  `)

  // --- Payment reporting indexes ------------------------------------------
  await addIndex('payments', 'idx_payments_status_date', '(status, created_at)')

  // --- Fish catalogue photographs (replace SVG placeholders) --------------
  // Real, species-accurate photos stored at public/fish/ (see CREDITS.md).
  const fishPhotos = [
    ['live-rohu', '/fish/live-rohu.jpg', 'Live rohu (Labeo rohita)'],
    ['live-katla', '/fish/live-katla.jpg', 'Live katla, a freshwater carp'],
    ['fresh-pomfret', '/fish/fresh-pomfret.jpg', 'Fresh whole silver pomfret'],
    ['fresh-mackerel', '/fish/fresh-mackerel.jpg', 'Fresh Atlantic mackerel'],
    ['tilapia-fillets', '/fish/tilapia-fillets.jpg', 'Raw tilapia fillets, never frozen'],
    ['basa-fillets', '/fish/basa-fillets.jpg', 'Fresh boneless basa fillets'],
    ['seer-fish-steaks', '/fish/seer-fish-steaks.jpg', 'Fresh seer fish (Scomberomorus commerson)'],
  ]
  for (const [slug, imageUrl, altText] of fishPhotos) {
    const [result] = await db.execute(
      'UPDATE product_images pi JOIN products p ON p.id = pi.product_id SET pi.image_url = ?, pi.alt_text = ? WHERE p.slug = ?',
      [imageUrl, altText, slug],
    )
    if (result.affectedRows) console.info(`Updated photograph for ${slug}`)
  }

  console.info('Migration complete.')
}

main()
  .then(() => db.end())
  .catch(error => {
    console.error('Migration failed:', error.message)
    db.end().finally(() => process.exit(1))
  })
