import { timingSafeEqual } from 'node:crypto'
import { salesDb } from './_salesSession.js'

function safeEquals(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  const configured = process.env.CRON_SECRET
  if (!configured || !safeEquals(req.headers.authorization, `Bearer ${configured}`)) return res.status(401).json({ error: 'Unauthorized' })
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const db = salesDb()
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date())
    const { data: leads, error } = await db.from('sales_leads')
      .select('id,salesperson_id,company_name,site_name,next_followup_date,stage')
      .not('salesperson_id', 'is', null)
      .lte('next_followup_date', today)
      .not('stage', 'in', '(won,lost)')
      .limit(1000)
    if (error) throw error
    const notifications = []
    for (const lead of leads || []) {
      const due = lead.next_followup_date
      const title = due < today ? 'Follow-up atrasado' : 'Follow-up para hoje'
      const body = `${lead.site_name || lead.company_name} · ${due}`
      notifications.push(
        { salesperson_id: lead.salesperson_id, audience: 'seller', event_type: 'followup_due', title, body, lead_id: lead.id, dedupe_key: `seller:followup:${lead.id}:${due}` },
        { salesperson_id: null, audience: 'admin', event_type: 'followup_due', title: 'Follow-up do vendedor', body: `${body} · seller ${lead.salesperson_id}`, lead_id: lead.id, dedupe_key: `admin:followup:${lead.id}:${due}` },
      )
    }
    if (notifications.length) {
      const { error: noticeError } = await db.from('sales_notifications').upsert(notifications, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      if (noticeError) throw noticeError
    }
    return res.status(200).json({ success: true, date: today, leads_due: leads?.length || 0, notifications_created_or_seen: notifications.length })
  } catch (error) {
    console.error('[sales-reminders]', error?.message || error)
    return res.status(500).json({ error: 'Could not create sales reminders.' })
  }
}
