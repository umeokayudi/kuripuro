/** Extra services the client can request online — quoted from the catalog. */

import {
  ATOMIC_LOCATION,
  DEFAULT_DEEP_CLEAN_PRICE,
  MATSUNAGA_SPOT,
  OTP_BASIC_LOCATIONS,
} from './serviceCatalog'

export const EXTRA_MARKER = 'KP-EXTRA'
export const PAY_MARKER = 'KP-PAY'

const COMPONENT_PRICE = Math.round(DEFAULT_DEEP_CLEAN_PRICE / 5) // ¥1,000

export function locationCatalog(name) {
  const n = (name || '').trim()
  if (!n) return null
  if (n === ATOMIC_LOCATION.name) return { ...ATOMIC_LOCATION, deepOnly: false, client: 'Atomic Bar' }
  if (n === MATSUNAGA_SPOT.name) return { name: MATSUNAGA_SPOT.name, pricePerVisit: 8000, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE, deepOnly: false, spot: true }
  return OTP_BASIC_LOCATIONS.find(l => l.name === n) || null
}

export function extrasForLocation(locationName) {
  const loc = locationCatalog(locationName)
  const basic = loc?.pricePerVisit > 0 ? loc.pricePerVisit : 4000
  const deep = loc?.deepCleanPrice || DEFAULT_DEEP_CLEAN_PRICE
  const list = []
  if (!loc?.deepOnly && !loc?.spot) {
    list.push({
      id: 'extra_basic',
      price: basic,
      icon: '🧹',
    })
  }
  if (!loc?.spot) {
    list.push({
      id: 'extra_deep',
      price: deep,
      icon: '✨',
    })
  }
  list.push(
    { id: 'extra_grease', price: COMPONENT_PRICE, icon: '🛢' },
    { id: 'extra_hood', price: COMPONENT_PRICE, icon: '🔥' },
    { id: 'extra_grill', price: COMPONENT_PRICE, icon: '🍖' },
    { id: 'extra_ac', price: COMPONENT_PRICE, icon: '❄️' },
  )
  if (loc?.spot) {
    list.unshift({ id: 'extra_spot', price: loc.pricePerVisit || 8000, icon: '⚡' })
  }
  return list
}

export function formatYen(n) {
  return `¥${Number(n || 0).toLocaleString('ja-JP')}`
}

export function packExtraRequest({ extraId, price, locationName, notes }) {
  const head = `[${EXTRA_MARKER}|${extraId}|${Number(price) || 0}|${locationName || ''}]`
  const body = String(notes || '').trim()
  return body ? `${head}\n${body}` : head
}

export function parseExtraRequest(description) {
  const raw = String(description || '')
  const m = raw.match(/^\[KP-EXTRA\|([^|]+)\|(\d+)\|([^\]]*)\]\n?([\s\S]*)$/)
  if (!m) return null
  return {
    extraId: m[1],
    price: Number(m[2]) || 0,
    locationName: m[3] || '',
    notes: (m[4] || '').trim(),
  }
}

export function packPaymentNotice({ faturaId, total, period }) {
  return `[${PAY_MARKER}|${faturaId}|${Number(total) || 0}]\nInvoice ${period || ''} — client marked as paid (${formatYen(total)})`
}

export function parsePaymentNotice(description) {
  const raw = String(description || '')
  const m = raw.match(/^\[KP-PAY\|([^|]+)\|(\d+)\]\n?([\s\S]*)$/)
  if (!m) return null
  return { faturaId: m[1], total: Number(m[2]) || 0, notes: (m[3] || '').trim() }
}

export function extraLabel(id, lang = 'en') {
  const ja = lang === 'ja'
  const pt = lang === 'pt'
  return {
    extra_basic: ja ? '追加・基本清掃' : pt ? 'Visita extra básica' : 'Extra basic visit',
    extra_deep: ja ? '追加・深層清掃' : pt ? 'Limpeza profunda extra' : 'Extra deep clean',
    extra_grease: ja ? 'グリストラップ追加' : pt ? 'Grelha de gordura extra' : 'Extra grease trap',
    extra_hood: ja ? 'レンジフード追加' : pt ? 'Coifa extra' : 'Extra range hood',
    extra_grill: ja ? 'グリル清掃' : pt ? 'Limpeza de grelha' : 'Grill cleaning',
    extra_ac: ja ? 'エアコン清掃' : pt ? 'Limpeza de ar-condicionado' : 'AC cleaning',
    extra_spot: ja ? 'スポット清掃' : pt ? 'Limpeza pontual' : 'Spot cleaning',
  }[id] || id
}

export function extraHint(id, lang = 'en') {
  const ja = lang === 'ja'
  return {
    extra_basic: ja ? '通常ルート外の追加訪問。希望日を指定してください。' : 'An extra visit outside the regular route. Pick a preferred date.',
    extra_deep: ja ? 'フード・トラップ・床など深層清掃の追加。' : 'Hood, trap, floor — a full extra deep clean.',
    extra_grease: ja ? '契約回数を超えるグリストラップ清掃。' : 'Grease trap beyond the contracted visits.',
    extra_hood: ja ? '深層清掃以外のフード追加清掃。' : 'Range hood on a day that is not the deep-clean slot.',
    extra_grill: ja ? 'グリルの追加清掃。' : 'Grill clean on a day that is not the deep-clean slot.',
    extra_ac: ja ? 'エアコンの追加清掃。' : 'Extra air-conditioner clean.',
    extra_spot: ja ? '単発のスポット作業。' : 'One-off spot job.',
  }[id] || ''
}

export const EXTRA_TIMES = ['after_close', 'morning', 'anytime']

export function extraTimeLabel(id, lang = 'en') {
  const ja = lang === 'ja'
  const pt = lang === 'pt'
  return {
    after_close: ja ? '閉店後' : pt ? 'Após o fechamento' : 'After close',
    morning: ja ? '朝' : pt ? 'Manhã' : 'Morning',
    anytime: ja ? 'いつでも' : pt ? 'Qualquer horário' : 'Anytime',
  }[id] || ''
}

export function extraInvoiceDraft({ extra, request, today, taxRate = 10, extraTitle }) {
  const subtotal = Number(extra?.price) || 0
  const tax = Math.round(subtotal * (Number(taxRate) || 0) / 100)
  const loc = extra?.locationName || request?.location_name || ''
  const title = extraTitle || extra?.extraId || 'Extra'
  return {
    fatura: {
      client_id: request?.client_id || null,
      client_name: request?.client_name || '',
      period_start: request?.preferred_date || today,
      period_end: request?.preferred_date || today,
      issue_date: today,
      due_date: today,
      subtotal,
      tax_amount: tax,
      total: subtotal + tax,
      tax_rate: Number(taxRate) || 10,
      status: 'sent',
      notes: `Extra · ${loc} · ticket ${request?.ticket_number || request?.id || ''}`.trim(),
    },
    item: {
      description: loc ? `${title} — ${loc}` : title,
      quantity: 1,
      unit_price: subtotal,
      total: subtotal,
    },
  }
}

export async function settleClientRequest(supabase, row, { today, extraTitle } = {}) {
  const pay = parsePaymentNotice(row?.description)
  if (pay?.faturaId) {
    const { error } = await supabase.from('faturas').update({ status: 'paid' })
      .eq('id', pay.faturaId)
    if (error) return { ok: false, error: error.message, kind: 'pay' }
    return { ok: true, kind: 'pay', faturaId: pay.faturaId }
  }
  const extra = parseExtraRequest(row?.description)
  if (extra && extra.price > 0 && row?.client_id) {
    const draft = extraInvoiceDraft({ extra, request: row, today, extraTitle })
    const { data: fatura, error } = await supabase.from('faturas').insert(draft.fatura).select('id').single()
    if (error) return { ok: false, error: error.message, kind: 'extra' }
    const { error: itemErr } = await supabase.from('fatura_items').insert({ fatura_id: fatura.id, ...draft.item })
    if (itemErr) return { ok: false, error: itemErr.message, kind: 'extra' }
    return { ok: true, kind: 'extra', faturaId: fatura.id }
  }
  return { ok: true, kind: 'plain' }
}

export function mergeExtraNotes(notes, timeId, lang = 'en') {
  const time = extraTimeLabel(timeId, lang)
  const body = String(notes || '').trim()
  if (!time) return body
  const line = lang === 'ja' ? `希望時間: ${time}` : lang === 'pt' ? `Horário: ${time}` : `Preferred time: ${time}`
  return body ? `${line}\n${body}` : line
}
