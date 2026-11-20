function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
}

function inr(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0))
}

async function sendEmail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!key || !from || !to) return false
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend email failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return true
}

async function sendWhatsApp(body) {
  const sid = process.env.TWILIO_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM ? `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}` : ''
  const to = process.env.CONTACT_NOTIFY_WHATSAPP ? `whatsapp:${process.env.CONTACT_NOTIFY_WHATSAPP}` : ''
  if (!sid || !token || !from || !to) return false
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Twilio WhatsApp failed (${response.status}): ${detail.slice(0, 200)}`)
  }
  return true
}

function orderSummaryHtml(order) {
  const rows = order.items
    .map(item => `<tr><td style="padding:6px 0">${escapeHtml(item.name)} × ${item.quantity}</td><td align="right">${inr(item.lineTotal)}</td></tr>`)
    .join('')
  return `<div style="font-family:Arial,sans-serif;color:#20301f;line-height:1.6;max-width:560px">
    <h2 style="color:#2f5138">Thank you for ordering from Fresh Farm</h2>
    <p>Order <strong>${escapeHtml(order.orderNumber)}</strong> has been received${order.paymentStatus === 'paid' ? ' and your payment is confirmed' : ''}.</p>
    <table style="width:100%;border-collapse:collapse">${rows}
      <tr><td style="padding-top:10px">Subtotal</td><td align="right">${inr(order.subtotal)}</td></tr>
      <tr><td>Delivery</td><td align="right">${order.deliveryFee > 0 ? inr(order.deliveryFee) : 'Free'}</td></tr>
      <tr><td><strong>Total</strong></td><td align="right"><strong>${inr(order.total)}</strong></td></tr>
    </table>
    <p style="color:#66705f;font-size:13px">We will confirm availability and the final weight before delivery. Questions? Reply to this email or call ${escapeHtml(process.env.CONTACT_NOTIFY_WHATSAPP || '')}.</p>
  </div>`
}

async function notifyOrderPlaced(order) {
  const jobs = [
    sendEmail({ to: order.email, subject: `Fresh Farm order ${order.orderNumber}`, html: orderSummaryHtml(order) })
      .catch(error => console.error('Customer order email failed:', error.message)),
    sendWhatsApp(`New Fresh Farm order ${order.orderNumber}\n${order.customerName} · ${order.phone || 'no phone'}\nTotal ${inr(order.total)} · ${order.paymentStatus === 'paid' ? 'PAID online' : 'Cash on delivery'}`)
      .catch(error => console.error('Owner WhatsApp alert failed:', error.message)),
  ]
  await Promise.allSettled(jobs)
}

async function notifyNewsletterSignup(email) {
  await sendEmail({
    to: process.env.CONTACT_NOTIFY_EMAIL || process.env.GMAIL_USER,
    subject: 'New Fresh Farm newsletter subscriber',
    html: `<p>New subscriber: <strong>${escapeHtml(email)}</strong></p>`,
  }).catch(error => console.error('Newsletter alert email failed:', error.message))
}

module.exports = { notifyOrderPlaced, notifyNewsletterSignup }
