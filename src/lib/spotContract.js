import { escapeHtml } from './escapeHtml.js'
import { PRINT_DOC_CSS } from './printDoc.js'
import { printIssuer } from './quoteIssuer.js'
import { tokyoToday } from './dates.js'
import { clientContact } from './clientContact.js'

// v1.0.21 · Contrato spot = 業務委託契約書. A spot job created in Jobs → New Job also stores a
// contract with the location (table spot_contracts). Admin keeps them in Contracts → Spot
// contracts, prints them and collects the location's signature.
// The standard articles live in spotContractArticles() below — change the wording there.
// The per-contract `terms` field holds only 特記事項 (special terms) on top of the articles.

export const SPOT_CONTRACT_STATUS = ['draft', 'approved', 'rejected', 'cancelled']
/** 'signed' was the first name of 'approved'; treat both the same. */
export const contractStatus = c => (c?.status === 'signed' ? 'approved' : c?.status || 'draft')

/** Payment due date: `day` of the month after `ymd` (clamped to that month's last day). */
export function dueDateAfter(ymd, day = 10) {
  const base = ymd ? String(ymd).slice(0, 10) : tokyoToday()
  const [y, m] = base.split('-').map(Number)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const d = Math.min(Math.max(1, parseInt(day, 10) || 10), last)
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

/** Draft invoice (faturas + one fatura_items line) for a spot contract, due on the payment day. */
export function spotInvoiceRows(c) {
  const t = spotContractTotals(c)
  const day = c.service_date || tokyoToday()
  return {
    fatura: {
      client_id: c.client_id || null,
      client_name: c.client_name || c.location_name,
      period_start: day,
      period_end: day,
      issue_date: tokyoToday(),
      due_date: dueDateAfter(day, c.payment_day),
      subtotal: t.subtotal,
      tax_amount: t.tax,
      total: t.total,
      tax_rate: Number(c.tax_rate ?? 10),
      status: 'draft',
      notes: `Spot ${c.contract_number || ''} · 業務委託契約書 · ${c.location_name || ''}`.trim(),
    },
    item: {
      job_id: c.job_id || null,
      description: `${c.location_name || ''} — ${c.service_type || 'Spot'} (${day})`,
      quantity: 1,
      unit_price: t.total,
      total: t.total,
      discount_percent: 0,
      discount_amount: 0,
      job_ids: c.job_id || null,
    },
  }
}

const DAY_JA = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' }

// v1.0.36 · What the contract prints, on top of the row: written address, 責任者, 作業内容 in Japanese
// and a note (the "why") per item. Stored in contract_details (jsonb) on spot_contracts and service_contracts.
export const CONTRACT_NOTE_KEYS = ['place', 'service', 'fee', 'payment', 'scope']
export function contractDetails(c) {
  const d = c?.contract_details && typeof c.contract_details === 'object' ? c.contract_details : {}
  return { ...d, notes: d.notes && typeof d.notes === 'object' ? d.notes : {} }
}

/** contract_details trimmed for saving (empty values dropped). */
export function cleanContractDetails(d = {}) {
  const out = {}
  for (const [k, v] of Object.entries(d || {})) {
    if (k === 'notes') continue
    const t = String(v ?? '').trim()
    if (t) out[k] = t
  }
  const notes = {}
  for (const k of CONTRACT_NOTE_KEYS) { const t = String(d?.notes?.[k] ?? '').trim(); if (t) notes[k] = t }
  if (Object.keys(notes).length) out.notes = notes
  return out
}

/** Street address as text: a Google Maps link becomes the place it points to; a URL is never printed. */
export function writtenAddress(v) {
  const s = String(v || '').trim()
  if (!/^https?:\/\//i.test(s)) return s
  try {
    const u = new URL(s)
    const q = u.searchParams.get('query') || u.searchParams.get('q') || u.searchParams.get('destination') || u.searchParams.get('daddr')
    if (q && !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q.trim())) return q.replace(/\+/g, ' ').trim()
    const place = u.pathname.match(/\/place\/([^/]+)/)
    if (place) return decodeURIComponent(place[1]).replace(/\+/g, ' ').trim()
  } catch { /* not a URL after all */ }
  return ''
}

// Service names used in the app (English / Portuguese) → Japanese for the contract.
const SERVICE_JA = [
  [/deep\s*clean(ing)?|limpeza\s*(pesada|profunda)/gi, 'ディープクリーニング'],
  [/monthly\s*clean(ing)?|limpeza\s*mensal/gi, '月次清掃'],
  [/basic\s*clean(ing)?|regular\s*clean(ing)?|limpeza\s*(b[aá]sica|regular)/gi, '定期清掃'],
  [/spot\s*clean(ing)?|limpeza\s*spot/gi, 'スポット清掃'],
  [/range\s*hood|coifa/gi, 'レンジフード清掃'],
  [/grease\s*trap|caixa\s*de\s*gordura/gi, 'グリストラップ清掃'],
  [/\bA\/?C\b(\s*clean(ing)?)?|ar[\s-]*condicionado/gi, 'エアコン清掃'],
  [/window\s*clean(ing)?|vidros?|janelas?/gi, '窓ガラス清掃'],
  [/floor\s*wax|cera\s*no\s*(ch[aã]o|piso)/gi, '床ワックス'],
  [/garbage\s*collection|coleta\s*de\s*lixo/gi, 'ゴミ回収'],
  [/pest\s*control|dedetiza[cç][aã]o/gi, '害虫駆除'],
  [/grill\s*clean(ing)?|grelha/gi, 'グリル清掃'],
  [/grating|grelhas?\s*de\s*piso/gi, 'グレーチング清掃'],
  [/stove|fog[aã]o/gi, 'コンロ清掃'],
  [/kitchen|cozinha/gi, '厨房'],
  [/toilet|bathroom|banheiro/gi, 'トイレ'],
  [/clean(ing)?|limpeza/gi, '清掃'],
]

/** 作業内容 in Japanese: "Deep Cleaning (Grease Trap 2x, AC)" → "ディープクリーニング（グリストラップ清掃×2・エアコン清掃）". */
export function serviceTypeJa(s) {
  let t = String(s || '').trim()
  if (!t) return ''
  t = t.replace(/^.+?\s[—–]\s/, '')
  for (const [re, ja] of SERVICE_JA) t = t.replace(re, ja)
  const out = t
    .replace(/\s*(\d+)\s*x\b/gi, '×$1').replace(/\bx\s*(\d+)/gi, '×$1')
    .replace(/\s*\+\s*|\s*,\s*|\s*&\s*|\s+e\s+|\s+and\s+/gi, '・')
    .replace(/\s*\(\s*/g, '（').replace(/\s*\)\s*/g, '）')
    .replace(/\s*([^\x20-\x7E])\s*/g, '$1')
  // Nothing recognised (e.g. only a store name): let the contract use its default wording.
  return JAPANESE.test(out) ? out : ''
}

// Default 作業範囲 in Japanese per service, used when the contract has no scope written in Japanese.
const SCOPE_JA = [
  ['ディープクリーニング', '厨房の油汚れ除去（床・壁・設備）\nレンジフードの洗浄\nエアコン（フィルター）清掃\nグリストラップ清掃\n床の洗浄'],
  ['定期清掃', '店内（客席・カウンター・厨房・トイレ）の清掃\nゴミの回収・分別およびゴミ箱の清掃\nガラス・鏡・ガラス扉の拭き上げ\nテーブル・椅子の清掃\n床の清掃（掃き・拭き）\nトイレ（便器・洗面台・蛇口）の清掃\n備品の整頓'],
  ['月次清掃', '店内（客席・カウンター・厨房・トイレ）の清掃\n床の洗浄\nガラス・鏡の拭き上げ'],
  ['レンジフード清掃', 'レンジフード（フィルター・ファン周り）の分解洗浄'],
  ['グリストラップ清掃', 'グリストラップ（バスケット・槽内）の清掃および汚泥の除去'],
  ['エアコン清掃', 'エアコン（フィルター・吹出口）の清掃'],
  ['床ワックス', '床面の洗浄およびワックス塗布'],
  ['ゴミ回収', 'ゴミの回収・分別・搬出'],
  ['害虫駆除', '害虫の点検および駆除（薬剤散布）'],
  ['コンロ清掃', 'コンロ・五徳の油汚れ除去'],
  ['グリル清掃', 'グリルの油汚れ除去'],
  ['グレーチング清掃', 'グレーチング（排水溝の蓋）および排水溝の清掃'],
  ['窓ガラス清掃', '窓ガラス・サッシの清掃'],
]
export function defaultScopeJa(serviceJa) {
  const s = String(serviceJa || '')
  const first = SCOPE_JA.find(([k]) => s.startsWith(k))
  if (first && first[0] === 'ディープクリーニング') return first[1]
  const lines = SCOPE_JA.filter(([k]) => s.includes(k)).flatMap(([, v]) => v.split('\n'))
  return [...new Set(lines)].join('\n')
}

/** Text has Latin words but no Japanese (an internal note written in Portuguese/English). */
const JAPANESE = /[\u3040-\u30ff\u4e00-\u9faf]/
const notJapanese = s => /[A-Za-zÀ-ÿ]{3,}/.test(s || '') && !JAPANESE.test(s || '')

/** Visits per month for a per-visit recurring contract. */
export function visitsPerMonth(c) {
  const n = parseInt(c?.visits_per_month, 10)
  if (n > 0) return n
  const d = (c?.days_of_week || []).length
  return d ? Math.round(d * 4.33) : 0
}

const jaDate = ymd => {
  if (!ymd) return ''
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number)
  return y ? `${y}年${m}月${d}日` : ''
}

/** Shape a recurring location (service_contracts row) like a contract so it prints as 業務委託契約書. */
export function recurringToContract(sc, client = {}) {
  const fixed = sc.billing_type === 'fixed_monthly'
  return {
    kind: 'recurring',
    contract_number: `KP-${String(sc.id || '').slice(0, 8).toUpperCase()}`,
    status: 'draft',
    client_name: client.company_name || '',
    client_address: client.address || '',
    client_representative: client.manager_name || client.contact_person || client.contact_name || '',
    contact_name: clientContact(client).name,
    contact_phone: clientContact(client).phone,
    location_name: sc.location_name,
    location_address: sc.location_address,
    service_type: sc.service_type,
    days_of_week: sc.days_of_week || [],
    visits_per_month: sc.visits_per_month,
    fixed,
    price: fixed ? Number(sc.fixed_monthly || 0) : Number(sc.price_per_visit || 0),
    tax_rate: sc.tax_rate ?? 10,
    price_includes_tax: sc.price_includes_tax !== false,
    discount_percent: Number(sc.discount_percent || 0),
    payment_day: sc.billing_day || DEFAULT_PAYMENT_DAY,
    scope: sc.training_checklist || '',
    terms: sc.billing_notes || null,
    contract_details: sc.contract_details || {},
  }
}
export const DEFAULT_PAYMENT_DAY = 10

export function emptySpotContractForm() {
  return { enabled: true, client_address: '', client_representative: '', contact_name: '', contact_phone: '', price: '', tax_rate: 10, price_includes_tax: true, payment_day: DEFAULT_PAYMENT_DAY, scope: '', terms: '', salesperson_id: '', salesperson_name: '', commission_type: null, commission_value: null, commission_amount: 0, contract_details: {} }
}

/** Company data of 甲 (the location) prefilled from the clients row. */
export function contractPrefillFromClient(client) {
  if (!client) return {}
  return {
    client_address: client.address || '',
    client_representative: client.manager_name || client.contact_person || client.contact_name || '',
    contact_name: clientContact(client).name,
    contact_phone: clientContact(client).phone,
  }
}

const clampDay = v => Math.max(1, Math.min(31, parseInt(v, 10) || DEFAULT_PAYMENT_DAY))

/** Row for spot_contracts from the New Job form + the job just inserted. */
export function buildSpotContractRow({ contract, job, form, location, client, employee }) {
  return {
    job_id: job?.id || null,
    client_id: form.client_id || null,
    client_name: client?.company_name || '',
    client_address: (contract.client_address || '').trim() || client?.address || null,
    client_representative: (contract.client_representative || '').trim() || null,
    location_id: form.location_id || null,
    location_name: (location?.name || form.title || '').trim() || 'Spot',
    location_address: form.address || location?.address || '',
    contact_name: (contract.contact_name || '').trim() || null,
    contact_phone: (contract.contact_phone || '').trim() || null,
    service_type: job?.title || form.title || '',
    service_date: form.scheduled_date || null,
    service_time: form.scheduled_time || null,
    employee_id: form.employee_id || null,
    employee_name: employee?.full_name || '',
    price: parseFloat(contract.price) || parseFloat(form.value) || 0,
    tax_rate: parseInt(contract.tax_rate, 10) || 0,
    price_includes_tax: contract.price_includes_tax !== false,
    payment_day: clampDay(contract.payment_day),
    employee_pay: parseFloat(form.spot_value) || 0,
    scope: (contract.scope || '').trim() || form.description || form.checklist_template || null,
    terms: (contract.terms || '').trim() || null,
    status: 'draft',
    contract_details: cleanContractDetails(contract.contract_details),
    ...sellerFields(contract),
  }
}

/** Seller + commission columns from a form (empty when no seller is picked). */
export function sellerFields(f = {}) {
  if (!f.salesperson_id) return { salesperson_id: null, salesperson_name: null, commission_type: null, commission_value: null, commission_amount: 0 }
  return {
    salesperson_id: f.salesperson_id,
    salesperson_name: f.salesperson_name || null,
    commission_type: f.commission_type || 'fixed',
    commission_value: f.commission_value === '' || f.commission_value == null ? null : Number(f.commission_value),
    commission_amount: Math.max(0, Math.round(Number(f.commission_amount) || 0)),
  }
}

/** Tax-excluded subtotal, tax and total for a contract price. */
export function spotContractTotals(c) {
  const price = Number(c?.price || 0)
  const rate = Number(c?.tax_rate || 0) / 100
  if (c?.price_includes_tax !== false) {
    const subtotal = Math.round(price / (1 + rate))
    return { subtotal, tax: price - subtotal, total: price }
  }
  const tax = Math.round(price * rate)
  return { subtotal: price, tax, total: price + tax }
}

const yen = n => `${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`

/** The contract articles (第1条…). Edit the wording here; values come from the contract row. */
export function spotContractArticles(c, lang = 'ja') {
  if (lang === 'pt') lang = 'en'
  const t = spotContractTotals(c)
  const day = clampDay(c?.payment_day)
  const v = contractView(c, lang)
  if (c?.kind === 'recurring') return recurringArticles(c, lang, t, day, v)
  const { place, service, note } = v
  const when = lang === 'en' ? (c?.service_date || '') : jaDate(c?.service_date)
  if (lang === 'en') return [
    ['Purpose', 'The Client (Party A) entrusts KuriPuro (Party B) with the cleaning service set out in Article 2 (the "Service"), and Party B accepts it.'],
    ['Service', `Place: ${place || '—'}${note('place')}\nDate: ${when || '—'}\nService: ${service || 'Spot cleaning'} (details under "Scope of work").${note('service')}`],
    ['Fee', `The fee for this one-time Service is JPY ${yen(t.total)} (incl. consumption tax ${c?.tax_rate ?? 10}%; subtotal JPY ${yen(t.subtotal)}, tax JPY ${yen(t.tax)}).${note('fee')}`],
    ['Payment', `Party B issues an invoice after completing the Service. Party A pays the fee by the ${day}th of the month following the month in which the Service was completed, by bank transfer to the account designated by Party B. Transfer fees are borne by Party A. If the due date falls on a bank holiday, payment is due on the preceding business day.${note('payment')}`],
    ['Subcontracting', 'Party B does not subcontract the Service to a third party without Party A\'s prior consent. Performance by Party B\'s own employees and registered staff is not subcontracting.'],
    ['Access and keys', 'Party A provides the entry method, keys and use of facilities needed for the Service. Party B manages them with the care of a prudent manager and returns them after the Service.'],
    ['Changes and cancellation', 'If Party A wishes to change the date or cancel the Service, Party A notifies Party B by the day before the service date.'],
    ['Damages', 'If Party B causes damage to Party A intentionally or through negligence in performing the Service, Party B compensates for that damage.'],
    ['Confidentiality', 'Each party keeps confidential any information about the other party learned in connection with this contract and does not disclose it to third parties. This article survives termination.'],
    ['Exclusion of antisocial forces', 'Each party represents and warrants that it is not, and is not related to, an antisocial force. If this is breached, the other party may terminate this contract immediately without notice.'],
    ['Term', 'This contract applies to the single Service on the date above and ends when the fee has been paid.'],
    ['Consultation', 'Matters not set out in this contract, or doubts about its interpretation, are resolved by good-faith consultation between the parties.'],
  ]
  return [
    ['目的', '甲は、乙に対し、第2条に定める清掃業務（以下「本業務」という。）を委託し、乙はこれを受託する。'],
    ['業務内容', `作業場所：${place || '—'}${note('place')}\n作業日：${when || '—'}\n作業内容：${service || 'スポット清掃'}（詳細は別記「作業範囲」のとおり）${note('service')}`],
    ['委託料', `本業務（1回）の委託料は、金${yen(t.total)}円（消費税${c?.tax_rate ?? 10}%込、税抜金額${yen(t.subtotal)}円、消費税額${yen(t.tax)}円）とする。${note('fee')}`],
    ['支払方法', `乙は本業務の完了後に請求書を発行し、甲は、本業務完了日の属する月の翌月${day}日までに、乙の指定する銀行口座へ振り込む方法により委託料を支払う。振込手数料は甲の負担とする。支払期日が金融機関の休業日にあたる場合は、その前営業日までに支払う。${note('payment')}`],
    ['再委託', '乙は、甲の事前の承諾なく本業務を第三者に再委託しない。ただし、乙の従業員および登録スタッフによる実施はこの限りでない。'],
    ['入館・鍵の管理', '甲は、本業務に必要な入館方法、鍵および設備の使用を乙に提供し、乙はこれらを善良な管理者の注意をもって管理し、本業務終了後に返還する。'],
    ['日程変更・中止', '甲が作業日の変更または本業務の中止を希望する場合は、作業日の前日までに乙に連絡する。'],
    ['損害賠償', '乙は、本業務の遂行にあたり、乙の故意または過失により甲に損害を与えた場合、その損害を賠償する。'],
    ['秘密保持', '甲および乙は、本契約に関して知り得た相手方の秘密情報を、第三者に開示または漏えいしない。本条は本契約終了後も有効とする。'],
    ['反社会的勢力の排除', '甲および乙は、自らが暴力団その他の反社会的勢力に該当せず、これらと関係を有しないことを表明し、保証する。相手方がこれに違反した場合、何らの催告なく直ちに本契約を解除することができる。'],
    ['有効期間', '本契約は、前記作業日における本業務1回について適用し、委託料の支払完了をもって終了する。'],
    ['協議', '本契約に定めのない事項または本契約の解釈に疑義が生じた事項については、甲乙誠実に協議のうえ解決する。'],
  ]
}

function recurringArticles(c, lang, t, day, { place, service, note }) {
  const visits = visitsPerMonth(c)
  const monthly = t.total * visits
  const days = (c.days_of_week || []).map(d => (lang === 'en' ? d : DAY_JA[d] || d)).join(lang === 'en' ? ', ' : '・')
  const disc = c.discount_percent ? (lang === 'en' ? ` A ${c.discount_percent}% discount applies.` : `なお、${c.discount_percent}%の割引を適用する。`) : ''
  if (lang === 'en') return [
    ['Purpose', 'The Client (Party A) entrusts KuriPuro (Party B) with the regular cleaning service set out in Article 2 (the "Service"), and Party B accepts it.'],
    ['Service', `Place: ${place || '—'}${note('place')}\nDays: ${days || 'as agreed'}\nService: ${service || 'Regular cleaning'} (details under "Scope of work").${note('service')}`],
    ['Fee', c.fixed || !visits
      ? `The fee is JPY ${yen(t.total)} per ${c.fixed ? 'month' : 'visit'} (incl. consumption tax ${c.tax_rate}%).${disc}${note('fee')}`
      : `The fee is JPY ${yen(monthly)} per month (incl. consumption tax ${c.tax_rate}%; JPY ${yen(t.total)} per visit × ${visits} visits a month). If the number of visits in a month changes, the fee is adjusted at JPY ${yen(t.total)} per visit.${disc}${note('fee')}`],
    ['Payment', `Party B issues an invoice each month for the previous month. Party A pays it by the ${day}th of the month following the month of service, by bank transfer to the account designated by Party B. Transfer fees are borne by Party A. If the due date falls on a bank holiday, payment is due on the preceding business day.${note('payment')}`],
    ['Subcontracting', 'Party B does not subcontract the Service to a third party without Party A\'s prior consent. Performance by Party B\'s own employees and registered staff is not subcontracting.'],
    ['Access and keys', 'Party A provides the entry method, keys and use of facilities needed for the Service. Party B manages them with the care of a prudent manager.'],
    ['Changes and cancellation', 'If Party A wishes to change or skip a visit, Party A notifies Party B by the day before the visit.'],
    ['Damages', 'If Party B causes damage to Party A intentionally or through negligence in performing the Service, Party B compensates for that damage.'],
    ['Confidentiality', 'Each party keeps confidential any information about the other party learned in connection with this contract. This article survives termination.'],
    ['Exclusion of antisocial forces', 'Each party represents and warrants that it is not, and is not related to, an antisocial force. If this is breached, the other party may terminate this contract immediately without notice.'],
    ['Term', 'This contract is valid for one year from the date of contract and is renewed automatically for one more year each time unless either party gives written notice at least one month before it ends. Either party may terminate it with one month\'s written notice.'],
    ['Consultation', 'Matters not set out in this contract, or doubts about its interpretation, are resolved by good-faith consultation between the parties.'],
  ]
  return [
    ['目的', '甲は、乙に対し、第2条に定める定期清掃業務（以下「本業務」という。）を委託し、乙はこれを受託する。'],
    ['業務内容', `作業場所：${place || '—'}${note('place')}\n作業曜日：${days || '甲乙協議のうえ定める'}\n作業内容：${service || '定期清掃'}（詳細は別記「作業範囲」のとおり）${note('service')}`],
    ['委託料', c.fixed
      ? `本業務の委託料は、月額金${yen(t.total)}円（消費税${c.tax_rate}%込）とする。${disc}${note('fee')}`
      : visits
        ? `本業務の委託料は、月額金${yen(monthly)}円（消費税${c.tax_rate}%込）とする（内訳：1回あたり金${yen(t.total)}円 × 月${visits}回）。月の実施回数が増減した場合は、1回あたりの金額により精算する。${disc}${note('fee')}`
        : `本業務の委託料は、1回あたり金${yen(t.total)}円（消費税${c.tax_rate}%込）とし、当月に実施した回数分を請求する。${disc}${note('fee')}`],
    ['支払方法', `乙は毎月、前月分の請求書を発行し、甲は、業務実施月の翌月${day}日までに、乙の指定する銀行口座へ振り込む方法により委託料を支払う。振込手数料は甲の負担とする。支払期日が金融機関の休業日にあたる場合は、その前営業日までに支払う。${note('payment')}`],
    ['再委託', '乙は、甲の事前の承諾なく本業務を第三者に再委託しない。ただし、乙の従業員および登録スタッフによる実施はこの限りでない。'],
    ['入館・鍵の管理', '甲は、本業務に必要な入館方法、鍵および設備の使用を乙に提供し、乙はこれらを善良な管理者の注意をもって管理する。'],
    ['日程変更・中止', '甲が作業日の変更または休止を希望する場合は、作業日の前日までに乙に連絡する。'],
    ['損害賠償', '乙は、本業務の遂行にあたり、乙の故意または過失により甲に損害を与えた場合、その損害を賠償する。'],
    ['秘密保持', '甲および乙は、本契約に関して知り得た相手方の秘密情報を、第三者に開示または漏えいしない。本条は本契約終了後も有効とする。'],
    ['反社会的勢力の排除', '甲および乙は、自らが暴力団その他の反社会的勢力に該当せず、これらと関係を有しないことを表明し、保証する。相手方がこれに違反した場合、何らの催告なく直ちに本契約を解除することができる。'],
    ['有効期間', '本契約の有効期間は契約締結日から1年間とし、期間満了の1か月前までに甲乙いずれからも書面による申出がない場合は、同一条件でさらに1年間更新し、以後も同様とする。甲乙いずれも、1か月前までに書面で通知することにより本契約を解約できる。'],
    ['協議', '本契約に定めのない事項または本契約の解釈に疑義が生じた事項については、甲乙誠実に協議のうえ解決する。'],
  ]
}

/** Values the articles and the signature boxes print, after contract_details. */
export function contractView(c, lang = 'ja') {
  const d = contractDetails(c)
  const en = lang === 'en' || lang === 'pt'
  const addr = (d.written_address || '').trim() || writtenAddress(c?.location_address)
  const place = [c?.location_name, addr].filter(Boolean).join(en ? ', ' : '（') + (!en && addr ? '）' : '')
  const svcJa = (d.service_label || '').trim() || serviceTypeJa(c?.service_type)
  const service = en ? (c?.service_type || '').replace(/^.+?\s[—–]\s/, '') : svcJa
  const scopeRaw = (d.scope_ja || '').trim() || (c?.scope || '').trim()
  const scope = en ? scopeRaw : (scopeRaw && !notJapanese(scopeRaw) ? scopeRaw : defaultScopeJa(svcJa))
  const termsRaw = (d.terms_ja || '').trim() || (c?.terms || '').trim()
  const terms = en ? termsRaw : (notJapanese(termsRaw) ? '' : termsRaw)
  const note = k => {
    const n = String(d.notes?.[k] || '').trim()
    return n ? `\n\u3000${en ? 'Note' : '備考'}：${n}` : ''
  }
  return {
    place, address: addr, service, scope, terms, note,
    clientAddress: (d.client_address || '').trim() || writtenAddress(c?.client_address) || addr,
    responsible: (d.responsible || '').trim() || c?.client_representative || c?.contact_name || '',
  }
}

/** Starting values for the contract details form: what the contract prints today. */
export function contractDetailsDefaults(c) {
  const v = contractView(c, 'ja')
  const d = contractDetails(c)
  return {
    written_address: v.address,
    client_address: v.clientAddress,
    responsible: v.responsible,
    service_label: (d.service_label || '').trim() || serviceTypeJa(c?.service_type),
    scope_ja: v.scope,
    terms_ja: v.terms,
    notes: { ...d.notes },
  }
}

/** Details form for a spot contract: scope, special terms and company address are columns of their own there. */
export function spotDetailsDefaults(c) {
  const d = contractDetailsDefaults(c)
  delete d.scope_ja
  delete d.terms_ja
  delete d.client_address
  return d
}

const COPY = {
  ja: { lang: 'ja', title: '業務委託契約書', no: '契約番号', a: '甲（委託者）', b: '乙（受託者）', address: '住所', resp: '責任者', company: '会社名', store: '店舗名', rep: '代表者', contact: 'ご担当', phone: '電話', email: 'メール', reg: '登録番号', staff: '担当スタッフ', sign: '署名', seal: '印', scope: '別記　作業範囲', special: '特記事項', signedOn: '契約締結日', blankDate: '　　　　年　　月　　日', signed: '承認済', rejected: '不承認', cancelled: '取消', art: n => `第${n}条`, intro: (a, b) => `${a}（以下「甲」という。）と${b}（以下「乙」という。）は、次のとおり業務委託契約（以下「本契約」という。）を締結する。`, closing: '本契約締結の証として本書を作成し、甲乙署名または記名押印のうえ、各自1通（電子データを含む）を保有する。' },
  en: { lang: 'en', title: 'SERVICE OUTSOURCING CONTRACT', no: 'Contract No.', a: 'Party A (Client)', b: 'Party B (Contractor)', address: 'Address', resp: 'Responsible', company: 'Company', store: 'Store', rep: 'Representative', contact: 'Contact', phone: 'Phone', email: 'Email', reg: 'Reg. No.', staff: 'Assigned staff', sign: 'Signature', seal: 'Seal', scope: 'Appendix: scope of work', special: 'Special terms', signedOn: 'Date of contract', blankDate: '____ / ____ / ____', signed: 'APPROVED', rejected: 'NOT APPROVED', cancelled: 'CANCELLED', art: n => `Article ${n}`, intro: (a, b) => `${a} ("Party A") and ${b} ("Party B") enter into this service outsourcing contract (this "Contract") as follows.`, closing: 'In witness of this Contract, the parties sign (or sign and seal) it and each keeps one copy, including electronic copies.' },
}

const multiline = text => escapeHtml(text || '').replace(/\n/g, '<br>')

/** Printable 業務委託契約書 for one spot contract (A4). */
export function spotContractHtml(c, lang = 'ja', signatureSrc = '') {
  const L = COPY[lang === 'en' || lang === 'pt' ? 'en' : 'ja']
  const issuer = printIssuer({}, L.lang)
  const st = contractStatus(c)
  const stamp = st === 'approved' ? L.signed : st === 'rejected' ? L.rejected : st === 'cancelled' ? L.cancelled : ''
  const partyA = c.client_name || c.location_name || ''
  const partyB = issuer.company
  const articles = spotContractArticles(c, L.lang)
  const v = contractView(c, L.lang)
  const signedDate = c.signed_at ? new Date(c.signed_at).toLocaleDateString(L.lang === 'ja' ? 'ja-JP' : 'en-CA', { timeZone: 'Asia/Tokyo' }) : L.blankDate
  const line = (k, v) => `<div class="pl"><span>${escapeHtml(k)}</span><div>${v ? escapeHtml(v) : '&nbsp;'}</div></div>`
  return `<!DOCTYPE html>
<html lang="${L.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(L.title)} ${escapeHtml(c.contract_number || '')}</title>
<style>${PRINT_DOC_CSS}
  .ttl{text-align:center;font-size:24px;font-weight:800;letter-spacing:${L.lang === 'ja' ? '0.35em' : '0.08em'};margin:6px 0 4px}
  .cno{text-align:right;font-size:11px;color:#5c6573;margin-bottom:14px}
  .intro{font-size:13px;line-height:1.9;margin:0 0 12px}
  .art{margin:0 0 9px;font-size:13px;line-height:1.85;break-inside:avoid}
  .art b{display:block;font-size:13px}
  .box{border:1px solid #e6ebf2;border-radius:6px;padding:9px 12px;font-size:12.5px;line-height:1.8;margin-top:4px}
  .closing{font-size:13px;line-height:1.9;margin:16px 0 6px}
  .date{font-size:13px;margin:0 0 14px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;break-inside:avoid}
  .party-box{border:1px solid #122033;border-radius:6px;padding:10px 12px;font-size:12px;position:relative}
  .party-box h4{margin:0 0 6px;font-size:13px}
  .pl{display:grid;grid-template-columns:5.2rem minmax(0,1fr);gap:2px 8px;padding:3px 0;border-bottom:1px dotted #cfd8e6}
  .pl span{color:#5c6573}
  .sig{display:flex;align-items:flex-end;gap:10px;margin-top:8px;min-height:64px}
  .sig .ink{flex:1;border-bottom:1px solid #122033;min-height:60px;display:flex;align-items:flex-end}
  .sig img{max-height:58px;max-width:100%}
  .seal{width:54px;height:54px;border:1px dashed #9aa6b8;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#9aa6b8;font-size:12px;flex-shrink:0}
  @media screen and (max-width:720px){.parties{grid-template-columns:1fr}}
</style></head>
<body><div class="wrap">
  ${stamp ? `<div class="stamp">${escapeHtml(stamp)}</div>` : ''}
  <div class="ttl">${escapeHtml(L.title)}</div>
  <div class="cno">${escapeHtml(L.no)} ${escapeHtml(c.contract_number || '')}</div>
  <p class="intro">${escapeHtml(L.intro(partyA, partyB))}</p>
  ${articles.map(([head, body], i) => `<div class="art"><b>${escapeHtml(L.art(i + 1))}${L.lang === 'ja' ? `（${escapeHtml(head)}）` : ` — ${escapeHtml(head)}`}</b>${multiline(body)}</div>`).join('')}
  ${v.scope ? `<div class="art"><b>${escapeHtml(L.scope)}</b><div class="box">${multiline(v.scope + v.note('scope'))}</div></div>` : ''}
  ${v.terms ? `<div class="art"><b>${escapeHtml(L.special)}</b><div class="box">${multiline(v.terms)}</div></div>` : ''}
  <p class="closing">${escapeHtml(L.closing)}</p>
  <p class="date">${escapeHtml(L.signedOn)}${L.lang === 'ja' ? '：' : ': '}${escapeHtml(signedDate)}</p>
  <div class="parties">
    <div class="party-box"><h4>${escapeHtml(L.a)}</h4>
      ${line(L.address, v.clientAddress)}
      ${line(L.company, c.client_name)}
      ${line(L.store, c.location_name)}
      ${line(L.rep, c.client_representative)}
      ${line(L.resp, v.responsible)}
      ${line(L.contact, c.contact_name)}
      ${line(L.phone, c.contact_phone)}
      <div class="sig"><div class="ink">${signatureSrc ? `<img src="${escapeHtml(signatureSrc)}" alt="">` : ''}</div><div class="seal">${escapeHtml(L.seal)}</div></div>
      ${c.signed_by ? `<div class="muted" style="margin-top:4px">${escapeHtml(L.sign)}${L.lang === 'ja' ? '：' : ': '}${escapeHtml(c.signed_by)}</div>` : ''}
    </div>
    <div class="party-box"><h4>${escapeHtml(L.b)}</h4>
      ${line(L.address, issuer.address)}
      ${line(L.company, issuer.company)}
      ${line(L.rep, `${issuer.title} ${issuer.name}`)}
      ${line(L.reg, issuer.regNumber)}
      ${line(L.phone, issuer.phone)}
      ${line(L.email, issuer.email)}
      ${line(L.staff, c.employee_name)}
      <div class="sig"><div class="ink"></div><div class="seal">${escapeHtml(L.seal)}</div></div>
    </div>
  </div>
</div></body></html>`
}
