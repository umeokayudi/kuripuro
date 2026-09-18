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
  return {
    extra_basic: ja ? '追加・基本清掃' : 'Extra basic visit',
    extra_deep: ja ? '追加・深層清掃' : 'Extra deep clean',
    extra_grease: ja ? 'グリストラップ追加' : 'Extra grease trap',
    extra_hood: ja ? 'レンジフード追加' : 'Extra range hood',
    extra_ac: ja ? 'エアコン清掃' : 'AC cleaning',
    extra_spot: ja ? 'スポット清掃' : 'Spot cleaning',
  }[id] || id
}

export function extraHint(id, lang = 'en') {
  const ja = lang === 'ja'
  return {
    extra_basic: ja ? '通常ルート外の追加訪問。希望日を指定してください。' : 'An extra visit outside the regular route. Pick a preferred date.',
    extra_deep: ja ? 'フード・トラップ・床など深層清掃の追加。' : 'Hood, trap, floor — a full extra deep clean.',
    extra_grease: ja ? '契約回数を超えるグリストラップ清掃。' : 'Grease trap beyond the contracted visits.',
    extra_hood: ja ? '深層清掃以外のフード追加清掃。' : 'Range hood on a day that is not the deep-clean slot.',
    extra_ac: ja ? 'エアコンの追加清掃。' : 'Extra air-conditioner clean.',
    extra_spot: ja ? '単発のスポット作業。' : 'One-off spot job.',
  }[id] || ''
}
