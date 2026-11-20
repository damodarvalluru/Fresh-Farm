const express = require('express')
const db = require('../config/db')

const router = express.Router()
const SECTIONS = new Set(['chicken', 'fish'])

router.get('/', async (req, res, next) => {
  try {
    const section = SECTIONS.has(String(req.query.section || '')) ? String(req.query.section) : null
    const [rows] = await db.query(`
      SELECT p.id, p.name, p.slug, p.detail, p.description, p.badge,
             p.selling_unit AS unit, p.price,
             c.name AS category, c.slug AS category_slug, c.section,
             i.available_quantity,
             (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.id LIMIT 1) AS image
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.is_active = 1 AND p.is_available = 1 AND c.is_active = 1
        ${section ? 'AND c.section = ?' : ''}
      ORDER BY c.section, c.sort_order, p.id
    `, section ? [section] : [])
    const [settings] = await db.query("SELECT setting_value FROM shop_settings WHERE setting_key = 'store' LIMIT 1")
    const store = settings[0]?.setting_value || {}
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    res.json({
      products: rows.map(row => ({
        id: Number(row.id),
        name: row.name,
        slug: row.slug,
        detail: row.detail,
        description: row.description,
        badge: row.badge || undefined,
        category: row.category,
        categorySlug: row.category_slug,
        section: row.section === 'fish' ? 'fish' : 'chicken',
        price: Number(row.price),
        unit: row.unit,
        image: row.image,
        availableQuantity: row.available_quantity === null ? null : Number(row.available_quantity),
      })),
      categories: [...new Set(rows.map(row => row.category))],
      categorySections: [...new Map(rows.map(row => [row.category, { name: row.category, slug: row.category_slug, section: row.section === 'fish' ? 'fish' : 'chicken' }])).values()],
      store: {
        currency: store.currency || 'INR',
        freeDeliveryAbove: Number(store.freeDeliveryAbove ?? 999),
        deliveryFee: Number(store.deliveryFee ?? 49),
      },
    })
  } catch (error) { next(error) }
})

module.exports = router
