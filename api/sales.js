import calendar from './_calendar.js'
import contractSales from './_contract-sales.js'
import payrollClose from './_payroll-close.js'
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
  'payroll-close': payrollClose,
  reminders: salesReminders,
  session: salesSession,
}

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  const selected = handlers[action]
  if (!selected) return res.status(404).json({ error: 'Sales endpoint not found.' })
  return selected(req, res)
}
