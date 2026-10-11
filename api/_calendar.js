import { createHmac, timingSafeEqual } from 'node:crypto'
import { salesDb, requireSalesSession } from './_salesSession.js'
import { buildIcs } from '../src/lib/calendar.js'

// Private iCalendar feed per worker (or "all" for the admin). Google Calendar subscribes to it
// with "Other calendars → From URL" and refreshes it on its own, so new jobs and spot jobs
// show up in the worker's Google Calendar without any Google API credentials.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function secret() {
  const value = process.env.SALES_SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SALES_SESSION_SECRET deve ter pelo menos 32 caracteres.')
  return value
}

export function calendarToken(who) {
  return createHmac('sha256', secret()).update(`calendar:${who}`).digest('base64url').slice(0, 32)
}

function validToken(who, token) {
  const expected = Buffer.from(calendarToken(who))
  const supplied = Buffer.from(String(token || ''))
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

function origin(req) {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'kuripuro.vercel.app'
  const proto = req.headers?.['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}

function shiftDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

async function link(req, res) {
  const user = requireSalesSession(req, res, ['admin', 'employee'])
  if (!user) return
  const asked = String(req.query?.employee || '')
  const who = user.role === 'admin' ? (asked === 'all' || UUID.test(asked) ? asked : 'all') : user.id
  if (who !== 'all' && !UUID.test(who)) return res.status(400).json({ error: 'Funcionário inválido.' })
  const token = calendarToken(who)
  res.status(200).json({ url: `${origin(req)}/api/calendar/${who}/${token}/kuripuro.ics` })
}

async function feed(req, res) {
  const who = String(req.query?.e || '')
  if (who !== 'all' && !UUID.test(who)) return res.status(404).send('Not found')
  if (!validToken(who, req.query?.t)) return res.status(404).send('Not found')
  const db = salesDb()
  let query = db.from('jobs')
    .select('id,title,client_name,employee_id,employee_name,scheduled_date,scheduled_time,address,description,instructions,status,job_category,spot_status')
    .gte('scheduled_date', shiftDays(-30))
    .lte('scheduled_date', shiftDays(180))
    .order('scheduled_date')
    .limit(2000)
  let name = 'KuriPuro'
  if (who !== 'all') {
    query = query.eq('employee_id', who)
    const { data: emp } = await db.from('employees').select('full_name').eq('id', who).maybeSingle()
    name = `KuriPuro · ${emp?.full_name || 'Trabalhos'}`
  }
  const { data, error } = await query
  if (error) return res.status(500).send('Calendar unavailable')
  // A spot job the worker has not accepted yet is still shown (as tentative info in the title);
  // declined / cancelled ones go out as CANCELLED so Google removes them.
  const jobs = (data || []).map(j => j.job_category === 'spot' && j.spot_status === 'pending'
    ? { ...j, title: `${j.title} (aguardando aceite)` } : j)
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', 'inline; filename="kuripuro.ics"')
  res.setHeader('Cache-Control', 'private, max-age=900')
  res.status(200).send(buildIcs(jobs, { name }))
}

export default async function calendar(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (req.query?.action === 'calendar-link') return await link(req, res)
    return await feed(req, res)
  } catch (err) {
    return res.status(503).json({ error: err.message })
  }
}
