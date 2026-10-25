// v1.0.73 · Full client sheet (CRM) that opens from any client name in the admin.
// openClientSheet({ id } | { name }) → ClientSheetHost (mounted once in App) shows it.
import { supabase } from './supabase'

export const OPEN_CLIENT_SHEET = 'kp:open-client'

export function openClientSheet(client) {
  if (!client?.id && !client?.name) return
  window.dispatchEvent(new CustomEvent(OPEN_CLIENT_SHEET, { detail: client }))
}

const tokyoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
const storeBase = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim()
const PAID = new Set(['paid'])
const BILLED = new Set(['sent', 'paid', 'overdue', 'pending'])

export async function findClientRow({ id, name }) {
  if (id) {
    const { data } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
    return data || null
  }
  const n = String(name || '').trim()
  if (n.length < 2) return null
  const { data } = await supabase.from('clients').select('*').ilike('company_name', n).limit(1)
  return data?.[0] || null
}

/** Everything the sheet shows, in one go. */
export async function loadClientSheet(client) {
  const id = client.id
  const name = client.company_name
  const [faturas, jobs, contracts, spots, requests, quotes, messages, leads] = await Promise.all([
    supabase.from('faturas').select('id,issue_date,due_date,total,status,paid_at,notes,period_start').eq('client_id', id).order('issue_date', { ascending: false }).limit(200),
    supabase.from('jobs').select('id,title,scheduled_date,status,employee_name,completed_at,photo_end_url').eq('client_id', id).order('scheduled_date', { ascending: false }).limit(300),
    supabase.from('service_contracts').select('*').eq('client_id', id).order('location_name'),
    supabase.from('spot_contracts').select('id,contract_number,service_type,service_date,location_name,price,status,fatura_id,created_at').eq('client_id', id).order('service_date', { ascending: false }).limit(60),
    supabase.from('client_requests').select('id,request_type,category,description,location_name,status,quote_status,quote_amount,created_at,ticket_number').eq('client_id', id).order('created_at', { ascending: false }).limit(60),
    name ? supabase.from('mitsumori').select('id,quote_number,needs,site_name,total,status,issue_date,sent_at,decided_at,created_at').ilike('company_name', name).order('created_at', { ascending: false }).limit(40) : { data: [] },
    supabase.from('client_messages').select('id,sender,content,location_name,created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(40),
    name ? supabase.from('sales_leads').select('id,stage,last_contact_date,salesperson_id').ilike('company_name', name).limit(5) : { data: [] },
  ])
  const leadIds = (leads.data || []).map(l => l.id)
  const { data: touches } = leadIds.length
    ? await supabase.from('sales_touchpoints').select('id,event_type,channel,happened_at,body,said_by').in('lead_id', leadIds).order('happened_at', { ascending: false }).limit(40)
    : { data: [] }

  const today = tokyoToday()
  const month = today.slice(0, 7)
  const fs = faturas.data || []
  const paid = fs.filter(f => PAID.has(f.status)).reduce((s, f) => s + Number(f.total || 0), 0)
  const billed = fs.filter(f => BILLED.has(f.status)).reduce((s, f) => s + Number(f.total || 0), 0)
  const thisMonth = fs.filter(f => String(f.issue_date || '').startsWith(month) && f.status !== 'cancelled')
  const monthBilled = thisMonth.filter(f => BILLED.has(f.status)).reduce((s, f) => s + Number(f.total || 0), 0)
  const monthConfirmed = thisMonth.filter(f => f.status === 'draft').reduce((s, f) => s + Number(f.total || 0), 0)

  const js = jobs.data || []
  const done = js.filter(j => j.status === 'completed')
  const lastCleaning = done[0] || null
  const nextJob = [...js].reverse().find(j => j.scheduled_date >= today && !['completed', 'cancelled'].includes(j.status)) || null

  const contacts = [
    ...(messages.data || []).map(m => ({ id: `msg:${m.id}`, at: m.created_at, kind: 'chat', who: m.sender === 'client' ? 'client' : 'team', text: m.content, where: m.location_name })),
    ...(requests.data || []).map(r => ({ id: `req:${r.id}`, at: r.created_at, kind: r.request_type === 'quote' ? 'quote' : 'request', who: 'client', text: r.description, where: r.location_name })),
    ...(touches || []).map(t => ({ id: `tp:${t.id}`, at: t.happened_at, kind: t.channel || t.event_type || 'contact', who: 'team', text: t.body, where: '' })),
  ].filter(c => c.at).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const leadContact = (leads.data || []).map(l => l.last_contact_date).filter(Boolean).sort().pop()
  const lastContact = contacts[0]?.at || leadContact || null

  // stores = active contract locations grouped by base name
  const stores = new Map()
  for (const c of contracts.data || []) {
    const key = storeBase(c.location_name) || '—'
    const s = stores.get(key) || { name: key, plans: [], address: c.location_address, active: false, monthly: 0 }
    s.plans.push(c)
    if (c.is_active) { s.active = true; s.monthly += Number(c.monthly_revenue || c.fixed_monthly || 0) }
    stores.set(key, s)
  }
  for (const s of stores.values()) {
    s.lastCleaning = done.find(j => String(j.title || '').startsWith(s.name))?.scheduled_date || null
  }

  const purchases = [
    ...(spots.data || []).map(s => ({ id: `spot:${s.id}`, date: s.service_date || String(s.created_at || '').slice(0, 10), what: s.service_type || s.contract_number, where: s.location_name, amount: Number(s.price || 0), status: s.status, kind: 'spot' })),
    ...(quotes.data || []).filter(q => q.status === 'accepted' || q.status === 'won').map(q => ({ id: `mit:${q.id}`, date: String(q.decided_at || q.issue_date || q.created_at || '').slice(0, 10), what: q.needs || q.quote_number, where: q.site_name, amount: Number(q.total || 0), status: 'accepted', kind: 'quote' })),
    ...(requests.data || []).filter(r => r.request_type === 'quote' && r.quote_status === 'accepted').map(r => ({ id: `req:${r.id}`, date: String(r.created_at || '').slice(0, 10), what: r.category || r.description, where: r.location_name, amount: Number(r.quote_amount || 0), status: r.status, kind: 'request' })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return {
    paid, billed, monthBilled, monthConfirmed,
    faturas: fs,
    jobs: js, done, lastCleaning, nextJob,
    contacts, lastContact,
    stores: [...stores.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    purchases,
    openQuotes: [...(quotes.data || []).filter(q => !['accepted', 'won', 'declined', 'lost'].includes(q.status)), ...(requests.data || []).filter(r => r.request_type === 'quote' && !['accepted', 'declined'].includes(r.quote_status))],
    since: client.created_at ? String(client.created_at).slice(0, 10) : null,
  }
}

export async function saveClientFields(id, patch) {
  const { data, error } = await supabase.from('clients').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data
}
