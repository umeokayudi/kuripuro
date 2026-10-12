import calendar from './_calendar.js'
import contractSales from './_contract-sales.js'
import salesAi from './_sales-ai.js'
import salesData from './_sales-data.js'
import salesFiles from './_sales-files.js'
import salesReminders from './_sales-reminders.js'
import salesSession from './_sales-session.js'

export const config = { api: { bodyParser: { sizeLimit: '32mb' } } }

const handlers = {
  ai: salesAi,
  calendar,
  'calendar-link': calendar,
  'contract-sellers': contractSales,
  data: salesData,
  files: salesFiles,
  reminders: salesReminders,
  session: salesSession,
}

export default async function handler(req, res) {
  // The vercel.json rewrites pass the handler as `route`, so it never collides with the
  // page's own `action` (e.g. /api/sales-data?action=dashboard). `action` stays for the cron URL.
  const first = value => Array.isArray(value) ? value[0] : value
  const selected = handlers[String(first(req.query?.route) || '')] || handlers[String(first(req.query?.action) || '')]
  if (!selected) return res.status(404).json({ error: 'Sales endpoint not found.' })
  return selected(req, res)
}
