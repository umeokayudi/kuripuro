import { timingSafeEqual } from 'node:crypto'
import { salesDb } from './_salesSession.js'
import { fmtPeriod } from '../src/lib/salaryPeriod.js'
import { closeSalaryPeriod, previousPeriod, AUTO_CLOSE_LAST_DAY } from '../src/lib/salaryClose.js'

function safeEquals(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export async function runPayrollClose(db, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())) {
  const period = previousPeriod(today)
  if (Number(today.slice(8, 10)) > AUTO_CLOSE_LAST_DAY) return { success: true, date: today, period, skipped: 'outside closing window' }
  const { data: existing, error } = await db.from('salary_periods').select('status').eq('period', period).maybeSingle()
  if (error) throw error
  if (existing) return { success: true, date: today, period, skipped: `already ${existing.status}` }
  const result = await closeSalaryPeriod(db, period, { auto: true, salaryDesc: `Salary ${fmtPeriod(period)}` })
  return { success: true, date: today, ...result }
}

// Daily cron (00:05 JST). On the 1st it closes last month; it also catches up until the 5th
// if a run was missed. A period that already has a row (closed, auto-closed or reopened by
// the admin) is never touched again, so a manual reopen stays reopened.
export default async function handler(req, res) {
  const configured = process.env.CRON_SECRET
  if (!configured || !safeEquals(req.headers.authorization, `Bearer ${configured}`)) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json(await runPayrollClose(salesDb()))
  } catch (error) {
    console.error('[payroll-close]', error?.message || error)
    return res.status(500).json({ error: 'Could not close the payroll period.' })
  }
}
