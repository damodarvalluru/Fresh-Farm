require('dotenv').config()
const db = require('../src/config/db')

async function main() {
  const [t] = await db.query('SELECT DATABASE() db, VERSION() v')
  console.log(t[0])
  for (const q of [
    'SELECT COUNT(*) c FROM products',
    'SELECT COUNT(*) c FROM categories',
    'SELECT COUNT(*) c FROM orders',
    'SELECT COUNT(*) c FROM admins',
    'SELECT COUNT(*) c FROM users',
    'SELECT COUNT(*) c FROM inventory',
    'SELECT COUNT(*) c FROM operating_expenses',
  ]) {
    const [r] = await db.query(q)
    console.log(q, r[0].c)
  }
  const [cats] = await db.query('SELECT id,name,slug,sort_order,is_active FROM categories ORDER BY sort_order')
  console.log('categories', JSON.stringify(cats, null, 2))
  const [cols] = await db.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('categories','products','inventory','orders') ORDER BY TABLE_NAME,ORDINAL_POSITION")
  console.log(cols.map(c => `${c.TABLE_NAME}.${c.COLUMN_NAME} ${c.COLUMN_TYPE}`).join('\n'))
  const [prod] = await db.query(`SELECT p.id,p.name,c.slug cat,p.price,p.cost_price,p.selling_unit,p.is_active,p.is_available,i.available_quantity
    FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN inventory i ON i.product_id=p.id ORDER BY p.id`)
  console.log('products', JSON.stringify(prod, null, 2))
  const [admins] = await db.query('SELECT a.id,u.email,r.name role,a.is_active,a.password_hash IS NOT NULL has_pw,a.pin_hash IS NOT NULL has_pin FROM admins a JOIN users u ON u.id=a.user_id JOIN roles r ON r.id=a.role_id')
  console.log('admins', JSON.stringify(admins, null, 2))
  const [orders] = await db.query('SELECT order_number,status,payment_method,payment_status,total_estimated,created_at FROM orders ORDER BY id DESC LIMIT 10')
  console.log('orders', JSON.stringify(orders, null, 2))
}
main().then(() => db.end()).catch(e => { console.error(e); db.end() })
