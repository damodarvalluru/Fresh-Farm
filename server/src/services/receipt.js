const PDFDocument = require('pdfkit')
const { Writable } = require('node:stream')

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

function money(value) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function receiptNumber(payment) {
  return `FFR-${String(payment.id).padStart(7, '0')}`
}

function dateLabel(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function methodLabel(payment) {
  if (payment.provider === 'razorpay') return 'Online payment (Razorpay)'
  if (payment.provider === 'cash_on_delivery') return 'Cash on delivery'
  return String(payment.provider || 'Payment').replaceAll('_', ' ')
}

/**
 * Writes a print-ready PDF receipt to a stream. Standard PDF fonts do not
 * contain the rupee glyph, so amounts use the unambiguous "Rs." prefix.
 */
function writeReceiptPdf(data, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Fresh Farm receipt ${receiptNumber(data.payment)}`, Author: 'Fresh Farm' } })
  doc.pipe(stream)
  const pageWidth = doc.page.width - 96
  const green = '#2f5138'
  const muted = '#6f7a6b'

  doc.fillColor(green).font('Times-Bold').fontSize(26).text('freshfarm', { continued: false })
  doc.fillColor(muted).font('Helvetica').fontSize(9).text('GOOD FOOD, GROWN WITH CARE')
  doc.moveUp(2)
  doc.fillColor(green).font('Helvetica-Bold').fontSize(16).text('PAYMENT RECEIPT', { align: 'right' })
  doc.fillColor(muted).font('Helvetica').fontSize(9).text(`Receipt ${receiptNumber(data.payment)}`, { align: 'right' })
  doc.moveDown(1.4)

  doc.strokeColor('#dfe3d8').lineWidth(1).moveTo(48, doc.y).lineTo(48 + pageWidth, doc.y).stroke()
  doc.moveDown(1)

  const leftX = 48
  const rightX = 330
  let y = doc.y
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('BILLED TO', leftX, y)
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('RECEIPT DETAILS', rightX, y)
  y += 14
  doc.fillColor('#25372c').font('Helvetica-Bold').fontSize(10).text(data.customer.name || 'Customer', leftX, y, { width: 240 })
  doc.fillColor('#25372c').font('Helvetica').fontSize(9).text(data.customer.email || '', leftX, doc.y, { width: 240 })
  if (data.customer.phone) doc.text(data.customer.phone, { width: 240 })
  if (data.address) {
    const lines = [data.address.line1, data.address.line2, data.address.landmark, `${data.address.city} ${data.address.postalCode}`].filter(Boolean)
    doc.fillColor(muted).fontSize(8).text(lines.join(', '), { width: 240 })
  }

  const detailRows = [
    ['Transaction ID', data.payment.provider_payment_id || data.payment.provider_order_id || `FF-PAY-${data.payment.id}`],
    ['Payment date', dateLabel(data.payment.confirmed_at || data.payment.created_at)],
    ['Payment method', methodLabel(data.payment)],
    ['Payment status', String(data.payment.status || 'pending').toUpperCase()],
    ['Order number', data.order.orderNumber],
  ]
  let detailY = y - 14
  for (const [label, value] of detailRows) {
    doc.fillColor(muted).font('Helvetica').fontSize(8).text(label, rightX, detailY, { width: 110 })
    doc.fillColor('#25372c').font('Helvetica-Bold').fontSize(9).text(String(value), rightX + 112, detailY, { width: pageWidth - (rightX - 48) - 112 })
    detailY += 15
  }

  doc.y = Math.max(doc.y, detailY) + 14
  doc.strokeColor('#dfe3d8').moveTo(48, doc.y).lineTo(48 + pageWidth, doc.y).stroke()
  doc.moveDown(0.8)

  const tableTop = doc.y
  doc.fillColor('#f4f4ea').rect(48, tableTop - 2, pageWidth, 20).fill()
  doc.fillColor(muted).font('Helvetica-Bold').fontSize(8)
  doc.text('ITEM', 54, tableTop + 4)
  doc.text('QTY', 330, tableTop + 4, { width: 50, align: 'right' })
  doc.text('PRICE', 390, tableTop + 4, { width: 60, align: 'right' })
  doc.text('TOTAL', 460, tableTop + 4, { width: 87, align: 'right' })
  let rowY = tableTop + 24
  doc.font('Helvetica').fontSize(9)
  for (const item of data.order.items) {
    doc.fillColor('#25372c').text(String(item.name), 54, rowY, { width: 265 })
    doc.text(`${Number(item.quantity)} ${item.unit || ''}`.trim(), 330, rowY, { width: 50, align: 'right' })
    doc.text(money(item.price), 390, rowY, { width: 60, align: 'right' })
    doc.text(money(item.lineTotal), 460, rowY, { width: 87, align: 'right' })
    rowY += Math.max(16, doc.heightOfString(String(item.name), { width: 265 }) + 6)
    doc.strokeColor('#eeece2').moveTo(48, rowY - 5).lineTo(48 + pageWidth, rowY - 5).stroke()
  }

  let totalY = rowY + 8
  const totals = [
    ['Subtotal', money(data.order.subtotal)],
    ['Delivery', Number(data.order.deliveryFee) > 0 ? money(data.order.deliveryFee) : 'Free'],
    ['Discount', `- ${money(data.order.discount)}`],
  ]
  for (const [label, value] of totals) {
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(label, 390, totalY, { width: 60, align: 'right' })
    doc.fillColor('#25372c').text(value, 460, totalY, { width: 87, align: 'right' })
    totalY += 15
  }
  doc.fillColor(green).font('Helvetica-Bold').fontSize(12).text('TOTAL PAID', 360, totalY + 2, { width: 90, align: 'right' })
  doc.text(money(data.order.total), 460, totalY + 2, { width: 87, align: 'right' })

  doc.fillColor(muted).font('Helvetica').fontSize(8)
  doc.text('This receipt records the payment against the order shown above. Final weights are confirmed after preparation; any difference is settled with the store.', 48, 700, { width: pageWidth, align: 'center' })
  doc.text('Fresh Farm · Thank you for choosing fresh, honest food.', 48, 730, { width: pageWidth, align: 'center' })
  doc.end()
}

function writeReceiptHtml(data) {
  const rows = data.order.items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td style="text-align:right">${Number(item.quantity)} ${escapeHtml(item.unit || '')}</td><td style="text-align:right">${money(item.price)}</td><td style="text-align:right">${money(item.lineTotal)}</td></tr>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fresh Farm receipt ${escapeHtml(receiptNumber(data.payment))}</title>
<style>
  body{font-family:Inter,Arial,sans-serif;color:#25372c;margin:0;padding:32px;background:#f7f5eb}
  .sheet{max-width:760px;margin:auto;background:#fffefa;border:1px solid #e1e3d8;padding:40px}
  h1{font-family:Georgia,serif;color:#2f5138;margin:0;font-size:30px}
  .muted{color:#6f7a6b;font-size:12px}
  .head{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e1e3d8;padding-bottom:20px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:22px 0;border-bottom:1px solid #e1e3d8}
  .label{font-size:10px;letter-spacing:1px;color:#6f7a6b;text-transform:uppercase;margin-bottom:6px}
  table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}
  th{text-align:left;background:#f4f4ea;color:#6f7a6b;font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:9px}
  td{padding:9px;border-bottom:1px solid #eeece2}
  .totals{margin-left:auto;width:280px;margin-top:16px;font-size:13px}
  .totals div{display:flex;justify-content:space-between;padding:6px 0}
  .total{border-top:1px solid #dfe3d8;margin-top:6px;padding-top:10px!important;font-weight:700;color:#2f5138;font-size:16px}
  .foot{margin-top:26px;color:#6f7a6b;font-size:11px;text-align:center;line-height:1.6}
  .pill{display:inline-block;padding:4px 9px;border-radius:20px;background:#e4eedd;color:#3c6a3b;font-size:11px}
  @media print{body{background:#fff;padding:0}.sheet{border:0}}
</style></head>
<body><div class="sheet">
  <div class="head"><div><h1>freshfarm</h1><div class="muted">GOOD FOOD, GROWN WITH CARE</div></div>
  <div style="text-align:right"><strong>PAYMENT RECEIPT</strong><div class="muted">${escapeHtml(receiptNumber(data.payment))}</div><div class="muted">${escapeHtml(dateLabel(data.payment.confirmed_at || data.payment.created_at))}</div></div></div>
  <div class="grid">
    <div><div class="label">Billed to</div><strong>${escapeHtml(data.customer.name)}</strong><div class="muted">${escapeHtml(data.customer.email || '')}<br>${escapeHtml(data.customer.phone || '')}</div>
    ${data.address ? `<div class="muted" style="margin-top:8px">${escapeHtml([data.address.line1, data.address.line2, data.address.landmark, `${data.address.city} ${data.address.postalCode}`].filter(Boolean).join(', '))}</div>` : ''}</div>
    <div><div class="label">Payment details</div>
      <div><strong>Transaction:</strong> ${escapeHtml(data.payment.provider_payment_id || data.payment.provider_order_id || `FF-PAY-${data.payment.id}`)}</div>
      <div><strong>Method:</strong> ${escapeHtml(methodLabel(data.payment))}</div>
      <div><strong>Status:</strong> <span class="pill">${escapeHtml(String(data.payment.status || 'pending').toUpperCase())}</span></div>
      <div><strong>Order:</strong> ${escapeHtml(data.order.orderNumber)}</div>
    </div>
  </div>
  <table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(data.order.subtotal)}</span></div>
    <div><span>Delivery</span><span>${Number(data.order.deliveryFee) > 0 ? money(data.order.deliveryFee) : 'Free'}</span></div>
    <div><span>Discount</span><span>- ${money(data.order.discount)}</span></div>
    <div class="total"><span>Total paid</span><span>${money(data.order.total)}</span></div>
  </div>
  <div class="foot">This receipt records the payment against the order shown above.<br>Fresh Farm · Thank you for choosing fresh, honest food.</div>
</div></body></html>`
}

/**
 * Renders the PDF fully in memory so a failure can still return clean JSON
 * instead of a half-written download with headers already sent.
 */
function receiptPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const sink = new Writable({
      write(chunk, _encoding, callback) { chunks.push(chunk); callback() },
    })
    sink.on('finish', () => resolve(Buffer.concat(chunks)))
    sink.on('error', reject)
    try {
      writeReceiptPdf(data, sink)
    } catch (error) {
      reject(error)
    }
  })
}

module.exports = { writeReceiptPdf, writeReceiptHtml, receiptPdfBuffer, receiptNumber, money }
