// v1.0.211 · The 見積書 the office makes (table `mitsumori`) shown to the client who owns it.
//
// Why this file exists: the office saves quotes in `mitsumori` (tied to a sales lead and the company
// name), while the client portal only read `client_requests` (requests the client typed). Nothing
// linked the two, so a quote marked "Enviado" never reached the client. They are NOT in the browser's
// localStorage: every quote is a row in Supabase (`mitsumori` + `mitsumori_items`).
//
// Link used (no SQL needed): the quote's company (`mitsumori.company_name`, the 御中 of the 見積書)
// equals the client's company (`clients.company_name`). Only quotes already sent are shown; drafts stay
// in the office. A login tied to one store also needs the quote's store to be that store (or blank).
import { supabase } from './supabase'

/** Statuses the client may see. A draft never leaves the office. */
export const PORTAL_QUOTE_STATUSES = ['sent', 'accepted', 'declined', 'expired']

/** Same company written with other spaces / full-width letters is still the same company. */
export function companyKey(name) {
  return String(name || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase()
}

/** The ways the company name may have been typed, for an exact (indexed) database filter. */
export function companyNameVariants(name) {
  const raw = String(name || '')
  const trimmed = raw.replace(/　/g, ' ').trim()
  return [...new Set([raw, raw.trim(), trimmed, trimmed.normalize('NFKC'), trimmed.replace(/\s+/g, ' ')].filter(Boolean))]
}

const storeKey = s => String(s || '').normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase()

/** True when this quote belongs to this client login (company, then store for store-bound logins). */
export function quoteBelongsTo(quote, { companyName, locationName } = {}) {
  if (!quote || !companyKey(companyName)) return false
  if (companyKey(quote.company_name) !== companyKey(companyName)) return false
  if (!PORTAL_QUOTE_STATUSES.includes(quote.status)) return false
  const loc = storeKey(locationName)
  const site = storeKey(quote.site_name)
  if (loc && site && !site.includes(loc) && !loc.includes(site)) return false
  return true
}

/** Expired = past 有効期限 and still waiting for an answer. */
export function quoteExpired(quote, today) {
  return quote?.status === 'sent' && !!quote.valid_until && String(quote.valid_until) < String(today || '')
}

/** Fields the client screen needs (no seller, lead or internal CRM columns). */
const CLIENT_COLUMNS = 'id,quote_number,company_name,site_name,address,contact_name,contact_title,issue_date,valid_until,frequency,hours_per_visit,tax_rate,subtotal,tax_amount,total,status,notes,sent_at,decided_at,created_at,lead_id'

/** Loads the client's sent/answered quotes with their lines. Never throws: returns [] on any error. */
export async function fetchClientQuotes({ companyName, locationName } = {}) {
  const names = companyNameVariants(companyName)
  if (!names.length) return []
  const { data, error } = await supabase.from('mitsumori').select(CLIENT_COLUMNS)
    .in('company_name', names).in('status', PORTAL_QUOTE_STATUSES)
    .order('issue_date', { ascending: false }).limit(60)
  if (error) { console.warn('[clientQuotes]', error.message); return [] }
  const mine = (data || []).filter(q => quoteBelongsTo(q, { companyName, locationName }))
  if (!mine.length) return []
  const { data: items } = await supabase.from('mitsumori_items').select('id,mitsumori_id,description,quantity,unit_price,total')
    .in('mitsumori_id', mine.map(q => q.id))
  const byQuote = {}
  for (const it of items || []) (byQuote[it.mitsumori_id] ||= []).push(it)
  return mine.map(q => ({ ...q, items: byQuote[q.id] || [] }))
}

/**
 * The client answers a sent quote: status accepted/declined (the database trigger stamps decided_at),
 * the sales lead moves to won/lost like when the office marks it, and the office gets a notice + push.
 */
export async function answerClientQuote(quote, decision, { who = '', reason = '' } = {}) {
  if (!quote?.id || !['accepted', 'declined'].includes(decision)) throw new Error('bad decision')
  if (quote.status !== 'sent') throw new Error('Este orçamento já foi respondido.')
  const note = [who ? `Cliente no portal (${who})` : 'Cliente no portal', String(reason || '').trim()].filter(Boolean).join(' · ')
  // Only a quote that is still "sent" changes: two people answering at once cannot both win.
  let { data, error } = await supabase.from('mitsumori').update({ status: decision, decision_reason: note })
    .eq('id', quote.id).eq('status', 'sent').select('id,status,decided_at')
  if (error && /decision_reason/.test(error.message || '')) {
    ({ data, error } = await supabase.from('mitsumori').update({ status: decision }).eq('id', quote.id).eq('status', 'sent').select('id,status,decided_at'))
  }
  if (error) throw error
  if (!data?.length) throw new Error('Este orçamento já foi respondido.')
  const now = new Date().toISOString()
  if (quote.lead_id) {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    await supabase.from('sales_leads').update({
      stage: decision === 'accepted' ? 'won' : 'lost',
      ...(decision === 'declined' && reason ? { lost_reason: String(reason).trim() } : {}),
      last_contact_date: today, updated_at: now,
    }).eq('id', quote.lead_id).then(() => {}, () => {})
  }
  const label = decision === 'accepted' ? '✅ Orçamento aceito pelo cliente' : '❌ Orçamento recusado pelo cliente'
  await supabase.from('sales_notifications').insert({
    audience: 'admin', event_type: decision === 'accepted' ? 'quote_accepted' : 'quote_declined',
    title: `${label} · ${quote.quote_number || ''}`.trim(),
    body: [quote.company_name, quote.site_name, quote.total != null ? `¥${Math.round(Number(quote.total)).toLocaleString('ja-JP')}` : '', reason].filter(Boolean).join(' · '),
    lead_id: quote.lead_id || null, dedupe_key: `mit:${quote.id}:${decision}`, sender_name: who || null,
  }).then(() => {}, () => {})
  return data[0]
}
