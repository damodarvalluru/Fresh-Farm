/*
 * Stock helpers shared by the order, customer and admin routes.
 *
 * Products without an inventory row are intentionally treated as untracked:
 * the shop keeps selling them exactly as it did before stock tracking existed.
 * Every function here must run inside an open transaction owned by the caller
 * so a failed order insert or status change rolls the stock movement back.
 */

function quantity(value) {
  // Stock is DECIMAL(10,3); trim trailing zeroes for human-facing messages.
  return String(Math.round(Number(value) * 1000) / 1000)
}

/**
 * Locks the tracked products for the order and decrements their stock.
 * Locks are taken in ascending product id order so two concurrent checkouts
 * that share products can never deadlock. Throws a 409 when there is not
 * enough stock, which the API error handler passes through to the customer.
 */
async function reserveStock(connection, lines) {
  if (!lines?.length) return
  const needed = new Map()
  for (const line of lines) {
    const productId = Number(line.productId)
    const amount = Number(line.quantity)
    if (!Number.isInteger(productId) || !Number.isFinite(amount) || amount <= 0) continue
    needed.set(productId, (needed.get(productId) || 0) + amount)
  }
  const ids = [...needed.keys()].sort((left, right) => left - right)
  if (!ids.length) return

  const placeholders = ids.map(() => '?').join(',')
  const [rows] = await connection.execute(
    `SELECT product_id, available_quantity FROM inventory WHERE product_id IN (${placeholders}) ORDER BY product_id FOR UPDATE`,
    ids,
  )
  const stock = new Map(rows.map(row => [Number(row.product_id), Number(row.available_quantity)]))

  for (const [productId, amount] of needed) {
    if (!stock.has(productId)) continue
    const available = stock.get(productId)
    if (amount > available) {
      const line = lines.find(item => Number(item.productId) === productId)
      const label = line?.name || 'One of the items'
      const error = new Error(`${label} has only ${quantity(available)} ${line?.unit || ''} left in stock. Update your bag and try again.`.replace(/\s+/g, ' ').trim())
      error.status = 409
      throw error
    }
  }

  for (const [productId, amount] of needed) {
    if (!stock.has(productId)) continue
    const [result] = await connection.execute(
      'UPDATE inventory SET available_quantity = available_quantity - ? WHERE product_id = ? AND available_quantity >= ?',
      [amount, productId, amount],
    )
    if (result.affectedRows !== 1) {
      const line = lines.find(item => Number(item.productId) === productId)
      const error = new Error(`${line?.name || 'One of the items'} just sold out. Update your bag and try again.`)
      error.status = 409
      throw error
    }
  }
}

/**
 * Returns every tracked product in an order back to stock. Used when an order
 * is cancelled or rejected. The order row must already be locked by the caller
 * so this can only run once per order lifecycle.
 */
async function restoreStock(connection, orderId) {
  if (!orderId) return
  const [items] = await connection.execute(
    'SELECT product_id, requested_quantity FROM order_items WHERE order_id = ? ORDER BY product_id',
    [orderId],
  )
  const needed = new Map()
  for (const item of items) {
    const productId = Number(item.product_id)
    const amount = Number(item.requested_quantity)
    if (!Number.isInteger(productId) || !Number.isFinite(amount) || amount <= 0) continue
    needed.set(productId, (needed.get(productId) || 0) + amount)
  }
  const ids = [...needed.keys()].sort((left, right) => left - right)
  if (!ids.length) return

  const placeholders = ids.map(() => '?').join(',')
  await connection.execute(
    `SELECT product_id FROM inventory WHERE product_id IN (${placeholders}) ORDER BY product_id FOR UPDATE`,
    ids,
  )
  for (const [productId, amount] of needed) {
    // Adding to a missing row would silently create untracked stock, so skip.
    await connection.execute(
      'UPDATE inventory SET available_quantity = available_quantity + ? WHERE product_id = ?',
      [amount, productId],
    )
  }
}

module.exports = { reserveStock, restoreStock }
