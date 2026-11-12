// v1.0.210 · Proposta visual (提案書) — one landscape A4 sheet that explains a quote with pictures:
// header (client 御中 + title + KuriPuro logo), intro text, a before → after photo pair,
// "作業の内容" blocks with 3 photo steps each, plans A / B with prices, a 12-month schedule
// and a footer note + signature. Made to send with (or instead of) the 見積書.
//
// No SQL: each proposal is one JSON file in the public service-photos bucket, next to its photos
// (same idea as the 作業報告書):
//   proposals/<quoteId>/proposal.json   the proposal (one per 見積)
//   proposals/<quoteId>/img_<time>.jpg   photos uploaded by the admin
//   proposals/<quoteId>/ai_<time>.png    photos made by the AI (saved by the server)
//   proposals/<quoteId>/<token>.pdf      the file shared with the client (public link)
// Prices are never written by the AI: each plan line takes its unit price from the quote items.
import { supabase, SUPABASE_URL } from './supabase'
import { uploadJobPhoto } from './uploadPhoto'
import { escapeHtml as esc } from './escapeHtml'
import { QUOTE_ISSUER, QUOTE_ISSUER_EN } from './quoteIssuer'
import { lineTotal, roundYen, yen } from './quoteMath'

const BUCKET = 'service-photos'
const ROOT = 'proposals'
export const SHEET_W = 1600
export const SHEET_H = 1131 // A4 landscape ratio (297 / 210)

export const COLORS = {
  blue: { main: '#1f63b4', dark: '#123f7a', light: '#eaf2fc', soft: '#cfe0f5' },
  green: { main: '#2f9a46', dark: '#1f6e31', light: '#ebf7ee', soft: '#cbe9d2' },
  orange: { main: '#e07b16', dark: '#a8560a', light: '#fdf2e6', soft: '#f6d9b8' },
  teal: { main: '#13918f', dark: '#0b6563', light: '#e6f6f5', soft: '#c0e6e4' },
  purple: { main: '#6a4bb8', dark: '#48308a', light: '#f1edfb', soft: '#dcd2f3' },
}
export const COLOR_KEYS = Object.keys(COLORS)
export const ICON_KEYS = ['polisher', 'vacuum', 'spray', 'ac', 'kitchen', 'floor', 'window', 'sparkle']

const LABELS = {
  ja: {
    honorific: '御中', work: '作業の内容（イメージ）', schedule: '年間スケジュール', month: '月', recommended: 'おすすめ',
    subtotal: '小計（税抜）', tax: '消費税', total: '合計（税込）', months: m => `${m}月`, times: '回',
    compare: '作業前と作業後（イメージ）', before: '作業前', after: '作業後', validUntil: '有効期限',
    footer: '詳細なお見積りは、別途「御見積書」にてお送りしております。ご不明な点がございましたら、お気軽にお問い合わせください。',
  },
  en: {
    honorific: '', work: 'What we do (image)', schedule: 'Annual schedule', month: 'Month', recommended: 'Recommended',
    subtotal: 'Subtotal (excl. tax)', tax: 'Tax', total: 'Total (incl. tax)', months: m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1], times: 'x',
    compare: 'Before and after (image)', before: 'Before', after: 'After', validUntil: 'Valid until',
    footer: 'The detailed quote is sent as a separate document. Please feel free to contact us with any questions.',
  },
  pt: {
    honorific: '', work: 'O que fazemos (imagem)', schedule: 'Agenda do ano', month: 'Mês', recommended: 'Recomendado',
    subtotal: 'Subtotal (sem imposto)', tax: 'Imposto', total: 'Total (com imposto)', months: m => ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][m - 1], times: 'x',
    compare: 'Antes e depois (imagem)', before: 'Antes', after: 'Depois', validUntil: 'Válido até',
    footer: 'O orçamento detalhado vai em documento separado. Qualquer dúvida, fale com a gente.',
  },
}
export const sheetLabels = lang => LABELS[lang] || LABELS.ja

const newToken = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, '').slice(0, 16)
const validId = id => /^[\w-]{6,64}$/.test(String(id || ''))

/** Public URL of a stored file (or the URL itself when it already is one). */
export function photoUrl(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${String(path).split('/').map(encodeURIComponent).join('/')}`
}

const emptyStep = (title = '', sub = '') => ({ title, sub, photo: '', prompt: '', search: '' })
const months12 = () => Array(12).fill(false)

/** Plan lines straight from the quote items (unit price and quantity of the quote). */
export function linesFromItems(items = []) {
  return (items || []).filter(it => String(it.description || '').trim()).map(it => ({
    label: String(it.description).trim(),
    qty: Number(it.quantity) || 1,
    unit_price: roundYen(it.unit_price),
    unit: '',
  }))
}

/** New proposal for a quote (mitsumori row + its items). */
export function blankProposal(quote = {}, items = [], { lang = 'ja', by = '' } = {}) {
  const L = sheetLabels(lang)
  const lines = linesFromItems(items)
  return {
    id: quote.id || newToken(),
    v: 1,
    quote_id: quote.id || null,
    quote_number: quote.quote_number || '',
    lang,
    client_name: quote.company_name || '',
    site_name: quote.site_name || '',
    honorific: L.honorific,
    title: lang === 'ja' ? 'サービスのご提案' : lang === 'pt' ? 'Proposta de serviço' : 'Service proposal',
    intro: '',
    tax_rate: Number(quote.tax_rate ?? 10),
    valid_until: quote.valid_until || '',
    compare: { show: true, title: L.compare, before: { label: L.before, photo: '', prompt: '', search: '', tags: [] }, after: { label: L.after, photo: '', prompt: '', search: '' } },
    work_title: L.work,
    services: [{
      name: lines[0]?.label || '', badge: '', desc: '', color: 'blue', icon: 'polisher',
      steps: [emptyStep(), emptyStep(), emptyStep()],
    }],
    plans: [{
      name: lang === 'ja' ? 'プランA' : lang === 'pt' ? 'Plano A' : 'Plan A',
      recommended: true, subtitle: '', chips: [], bullets: [], lines, show_price: true, price_note: '',
    }],
    schedule: { show: false, title: L.schedule, note: '', start_month: 1, rows: [], legend: [] },
    footer: { text: L.footer, sign: true },
    created_at: new Date().toISOString(),
    created_by: by,
    updated_at: new Date().toISOString(),
    shared: null, // { path, url, at } of the last PDF made for the client
  }
}

/** Changes the sheet language; fixed labels that still have the old default get the new one. */
export function switchSheetLang(p, lang) {
  const a = sheetLabels(p.lang); const b = sheetLabels(lang)
  const sw = (v, k) => (!v || v === a[k] ? b[k] : v)
  return {
    lang,
    honorific: sw(p.honorific, 'honorific'),
    work_title: sw(p.work_title, 'work'),
    compare: { ...p.compare, title: sw(p.compare?.title, 'compare'), before: { ...p.compare?.before, label: sw(p.compare?.before?.label, 'before') }, after: { ...p.compare?.after, label: sw(p.compare?.after?.label, 'after') } },
    schedule: { ...p.schedule, title: sw(p.schedule?.title, 'schedule') },
    footer: { ...p.footer, text: sw(p.footer?.text, 'footer') },
  }
}

/* ---------------------------------------------------------------- storage */

async function putJson(path, obj) {
  const body = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
}

async function getJson(path) {
  try {
    const r = await fetch(`${photoUrl(path)}?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

export const loadProposal = id => (validId(id) ? getJson(`${ROOT}/${id}/proposal.json`) : Promise.resolve(null))

export async function saveProposal(p, { by = '' } = {}) {
  if (!validId(p?.id)) throw new Error('proposal id')
  const out = { ...p, updated_at: new Date().toISOString(), updated_by: by || p.updated_by || '' }
  await putJson(`${ROOT}/${p.id}/proposal.json`, out)
  return out
}

/** Ids (= quote ids) that already have a proposal. One storage listing. */
export async function listProposalIds() {
  const { data, error } = await supabase.storage.from(BUCKET).list(ROOT, { limit: 1000 })
  if (error) return new Set()
  return new Set((data || []).filter(f => f.id === null && validId(f.name)).map(f => f.name))
}

/** Photo chosen by the admin (camera / gallery / computer). Returns the storage path. */
export function uploadProposalPhoto(id, file) {
  return uploadJobPhoto(`${ROOT}/${id}/img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`, file)
}

/** Uploads the PDF for the client under an unguessable name and returns { path, url }. */
export async function uploadSharedPdf(id, blob) {
  const path = `${ROOT}/${id}/${newToken()}.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/pdf' })
  if (error) throw new Error(error.message)
  return { path, url: photoUrl(path), at: new Date().toISOString() }
}

/* ---------------------------------------------------------------- AI */

export async function proposalAi(task, payload) {
  const resp = await fetch('/api/evaluate-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ kind: 'proposal', task, ...payload }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

/** What the AI gets to write the proposal: the quote, never anything internal. */
export function draftPayload(p, quote = {}, items = []) {
  return {
    lang: p.lang,
    client: p.client_name || quote.company_name || '',
    site: p.site_name || quote.site_name || '',
    needs: quote.needs || '',
    interest: quote.interest || '',
    notes: String(quote.notes || '').slice(0, 2000),
    frequency: quote.frequency || '',
    hours: quote.hours_per_visit || '',
    hint: p.ai_hint || '',
    items: (items || []).filter(it => String(it.description || '').trim()).map((it, i) => ({ i, description: it.description, quantity: Number(it.quantity) || 1 })),
  }
}

const str = (v, n = 400) => String(v ?? '').trim().slice(0, n)
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : [])

/** Merges the AI draft into the proposal. Keeps photos already chosen; prices come from `items`. */
export function applyDraft(p, d = {}, items = []) {
  const L = sheetLabels(p.lang)
  const quoteLines = linesFromItems(items)
  const keepPhoto = (oldSlot, slot) => ({ ...slot, photo: oldSlot?.photo || '' })
  const next = { ...p }
  if (d.title) next.title = str(d.title, 80)
  if (d.intro) next.intro = str(d.intro, 900)
  if (d.compare) {
    next.compare = {
      show: d.compare.show !== false,
      title: str(d.compare.title, 60) || L.compare,
      before: keepPhoto(p.compare?.before, { label: str(d.compare.before_label, 30) || L.before, tags: arr(d.compare.before_tags, 4).map(t => str(t, 20)), prompt: str(d.compare.before_prompt, 500), search: str(d.compare.before_search, 60) }),
      after: keepPhoto(p.compare?.after, { label: str(d.compare.after_label, 30) || L.after, prompt: str(d.compare.after_prompt, 500), search: str(d.compare.after_search, 60) }),
    }
  }
  if (Array.isArray(d.services) && d.services.length) {
    next.services = d.services.slice(0, 3).map((s, si) => ({
      name: str(s.name, 40),
      badge: str(s.badge, 20),
      desc: str(s.desc, 160),
      color: COLORS[s.color] ? s.color : ['blue', 'green', 'orange'][si],
      icon: ICON_KEYS.includes(s.icon) ? s.icon : 'sparkle',
      steps: arr(s.steps, 4).map((st, i) => keepPhoto(p.services?.[si]?.steps?.[i], { title: str(st.title, 30), sub: str(st.sub, 40), prompt: str(st.prompt, 500), search: str(st.search, 60) })),
    }))
  }
  if (Array.isArray(d.plans) && d.plans.length) {
    next.plans = d.plans.slice(0, 3).map((pl, i) => {
      const lines = arr(pl.lines, 8).map(l => {
        const base = quoteLines[Number(l.item)]
        if (!base) return null
        const qty = Number(l.qty) > 0 && Number(l.qty) <= 400 ? Number(l.qty) : base.qty
        return { ...base, qty, unit: str(l.unit, 8) }
      }).filter(Boolean)
      return {
        name: str(pl.name, 30) || `${p.lang === 'ja' ? 'プラン' : p.lang === 'pt' ? 'Plano ' : 'Plan '}${'ABC'[i]}`,
        recommended: !!pl.recommended,
        subtitle: str(pl.subtitle, 40),
        chips: arr(pl.chips, 3).map(c => str(c, 30)),
        bullets: arr(pl.bullets, 5).map(b => str(b, 60)),
        lines: lines.length ? lines : (i === 0 ? quoteLines : []),
        show_price: true,
        price_note: str(pl.price_note, 60),
      }
    })
  }
  if (d.schedule) {
    const sm = Math.min(12, Math.max(1, Number(d.schedule.start_month) || 1))
    next.schedule = {
      show: d.schedule.show !== false,
      title: str(d.schedule.title, 40) || L.schedule,
      note: str(d.schedule.note, 40),
      start_month: sm,
      rows: arr(d.schedule.rows, 3).map((r, ri) => {
        const marks = months12()
        const tags = {}
        arr(r.months, 12).forEach(m => { const idx = Number(m) - 1; if (idx >= 0 && idx < 12) marks[idx] = true })
        Object.entries(r.tags || {}).forEach(([k, v]) => { const idx = Number(k) - 1; if (idx >= 0 && idx < 12 && v) tags[idx] = str(v, 10) })
        return { label: str(r.label, 20), color: COLORS[r.color] ? r.color : next.services?.[ri]?.color || 'blue', marks, tags }
      }),
      legend: arr(d.schedule.legend, 3).map(t => str(t, 70)),
    }
  }
  if (d.footer_text) next.footer = { ...(p.footer || {}), text: str(d.footer_text, 200) }
  return next
}

/* ---------------------------------------------------------------- money */

export function planTotals(plan, taxRate = 10) {
  const subtotal = roundYen((plan?.lines || []).reduce((s, l) => s + lineTotal(l.qty, l.unit_price), 0))
  const tax = subtotal > 0 ? roundYen(subtotal * (Number(taxRate) || 0) / 100) : 0
  return { subtotal, tax, total: subtotal + tax }
}

/* ---------------------------------------------------------------- photo library */

const cleanWord = w => String(w || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().slice(0, 30)

/**
 * "Buscar nas fotos dos serviços": past jobs whose title has one of the words, with their
 * before (start) and after (end) photos. Newest first.
 */
export async function searchJobPhotos(text, { clientId = null, limit = 36 } = {}) {
  const words = String(text || '').split(/[,、，/]+|\s{2,}/).map(cleanWord).filter(w => w.length >= 2).slice(0, 6)
  let q = supabase.from('jobs')
    .select('id,title,scheduled_date,photo_start_url,photo_end_url,client_id')
    .or('photo_start_url.not.is.null,photo_end_url.not.is.null')
    .order('scheduled_date', { ascending: false })
    .limit(limit)
  if (words.length) q = q.or(words.map(w => `title.ilike.%${w}%`).join(','))
  if (clientId) q = q.eq('client_id', clientId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const out = []
  for (const j of data || []) {
    if (j.photo_start_url) out.push({ path: j.photo_start_url, side: 'before', title: j.title, date: j.scheduled_date, job_id: j.id })
    if (j.photo_end_url) out.push({ path: j.photo_end_url, side: 'after', title: j.title, date: j.scheduled_date, job_id: j.id })
  }
  return out
}

/** Every photo slot of the proposal, in reading order: { key, slot, side } */
export function photoSlots(p) {
  const out = []
  if (p.compare?.show) {
    out.push({ key: 'compare.before', slot: p.compare.before, side: 'before' })
    out.push({ key: 'compare.after', slot: p.compare.after, side: 'after' })
  }
  ;(p.services || []).forEach((s, si) => (s.steps || []).forEach((st, i, all) => { // eslint-disable-line no-extra-semi
    out.push({ key: `services.${si}.steps.${i}`, slot: st, side: i === all.length - 1 ? 'after' : i === 0 ? 'before' : 'during', context: s.name })
  }))
  return out
}

/** Immutable set of one photo slot field by key ('compare.before' | 'services.0.steps.2'). */
export function setSlot(p, key, patch) {
  const parts = key.split('.')
  if (parts[0] === 'compare') {
    return { ...p, compare: { ...p.compare, [parts[1]]: { ...p.compare[parts[1]], ...patch } } }
  }
  const si = Number(parts[1]); const i = Number(parts[3])
  return {
    ...p,
    services: p.services.map((s, x) => (x !== si ? s : { ...s, steps: s.steps.map((st, y) => (y !== i ? st : { ...st, ...patch })) })),
  }
}

/** Prompt to generate the picture of one slot when the admin did not write one. */
export function defaultPrompt(p, key) {
  const parts = key.split('.')
  if (parts[0] === 'compare') {
    const c = p.compare
    return parts[1] === 'before'
      ? `${c.title || ''}: ${c.before?.label || 'before cleaning'} ${(c.before?.tags || []).join(', ')}`.trim()
      : `${c.title || ''}: ${c.after?.label || 'after cleaning'}, clean and fresh`.trim()
  }
  const s = p.services[Number(parts[1])]
  const st = s?.steps?.[Number(parts[3])]
  return `${s?.name || ''} — ${st?.title || ''} ${st?.sub || ''}`.trim()
}

/* ---------------------------------------------------------------- sheet HTML */

const ICONS = {
  polisher: '<path d="M30 8 L22 30" stroke-width="3.5"/><path d="M26 6 l8 3" stroke-width="3.5"/><rect x="8" y="30" width="30" height="7" rx="2"/><ellipse cx="23" cy="41" rx="17" ry="3.5"/>',
  vacuum: '<path d="M34 6 L20 32" stroke-width="3.5"/><rect x="8" y="32" width="24" height="7" rx="3"/><path d="M6 42 h30" stroke-width="3"/>',
  spray: '<rect x="14" y="18" width="16" height="24" rx="4"/><path d="M18 18 v-6 h8 v6" /><path d="M26 12 h8 l-3 4" /><path d="M38 9 l4 -2 M38 13 h5 M38 17 l4 2" stroke-width="2.4"/>',
  ac: '<rect x="5" y="10" width="38" height="16" rx="3"/><path d="M10 21 h28" stroke-width="2.4"/><path d="M14 31 q2 4 0 8 M24 31 q2 4 0 8 M34 31 q2 4 0 8" stroke-width="2.4"/>',
  kitchen: '<rect x="8" y="20" width="32" height="20" rx="3"/><path d="M14 20 v-6 M24 20 v-9 M34 20 v-6" stroke-width="3"/><path d="M8 28 h32" stroke-width="2.4"/>',
  floor: '<path d="M6 40 L16 24 H40 L30 40 Z"/><path d="M24 6 v18" stroke-width="3.5"/><path d="M18 24 h12" stroke-width="3.5"/>',
  window: '<rect x="8" y="6" width="32" height="36" rx="2"/><path d="M24 6 v36 M8 24 h32" stroke-width="2.6"/><path d="M13 12 l6 -0 M13 16 l3 0" stroke-width="2.4"/>',
  sparkle: '<path d="M24 4 L28 18 L42 22 L28 26 L24 40 L20 26 L6 22 L20 18 Z"/><path d="M38 34 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z"/>',
}
export const iconSvg = (k, color = '#1f63b4') => `<svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ICONS.sparkle}</svg>`

const CAMERA = '<svg viewBox="0 0 48 48" width="34" height="34" fill="none" stroke="#9fb1c7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="14" width="36" height="26" rx="4"/><circle cx="24" cy="27" r="7"/><path d="M17 14 l3 -5 h8 l3 5"/></svg>'
const DOC = '<svg viewBox="0 0 48 48" width="46" height="46" fill="none" stroke="#1f63b4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5 h18 l8 8 v30 h-26 z"/><path d="M30 5 v8 h8"/><path d="M17 22 h14 M17 29 h14 M17 36 h9"/></svg>'
const CROWN = '<svg viewBox="0 0 48 40" width="30" height="25"><path d="M4 12 L14 22 L24 6 L34 22 L44 12 L40 34 H8 Z" fill="#f2b705" stroke="#c78f00" stroke-width="2" stroke-linejoin="round"/></svg>'
const CAL = '<svg viewBox="0 0 48 48" width="32" height="32" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"><rect x="6" y="10" width="36" height="32" rx="4"/><path d="M6 20 h36 M15 5 v9 M33 5 v9"/><path d="M14 28 h4 M22 28 h4 M30 28 h4 M14 35 h4 M22 35 h4"/></svg>'
const SPARK = '<svg class="spark" viewBox="0 0 48 48" width="46" height="46"><path d="M24 2 L29 19 L46 24 L29 29 L24 46 L19 29 L2 24 L19 19 Z" fill="#ffd23f"/><path d="M40 4 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z" fill="#ffe27a"/></svg>'

/** Intro text: blank line = new paragraph; **x** = blue pill, ++x++ = green pill. */
function introHtml(text) {
  return String(text || '').split(/\n\s*\n/).map(par => {
    let h = esc(par.trim()).replace(/\n/g, '<br>')
    h = h.replace(/\*\*(.+?)\*\*/g, '<span class="hl hl-b">$1</span>').replace(/\+\+(.+?)\+\+/g, '<span class="hl hl-g">$1</span>')
    return h ? `<p>${h}</p>` : ''
  }).join('')
}

const img = (photo, cls = '', sparkle = false) => (photo
  ? `<div class="ph ${cls}"><img src="${esc(photoUrl(photo))}" crossorigin="anonymous" alt="">${sparkle ? SPARK : ''}</div>`
  : `<div class="ph ph-empty ${cls}">${CAMERA}</div>`)

const circled = i => '①②③④⑤⑥'[i] || `${i + 1}.`

function servicesHtml(p) {
  const list = (p.services || []).filter(s => s.name || s.steps?.some(st => st.title || st.photo))
  if (!list.length) return ''
  return `<section class="work">
    <div class="sec-title"><span>${esc(p.work_title || sheetLabels(p.lang).work)}</span></div>
    <div class="svc-grid n${list.length}">${list.map(s => {
      const c = COLORS[s.color] || COLORS.blue
      const filled = (s.steps || []).filter(st => st.title || st.photo || st.sub)
      const steps = filled.length ? filled : (s.steps || []) // nothing written yet: show the empty photo frames
      return `<div class="svc" style="--c:${c.main};--cd:${c.dark};--cl:${c.light};--cs:${c.soft}">
        <div class="svc-hd"><span class="svc-ic">${iconSvg(s.icon, c.main)}</span><b>${esc(s.name)}</b>${s.badge ? `<em>${esc(s.badge)}</em>` : ''}</div>
        ${s.desc ? `<p class="svc-desc">${esc(s.desc).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="steps n${steps.length}">${steps.map((st, i) => `${i ? '<span class="arr">▶</span>' : ''}<figure>${img(st.photo, '', i === steps.length - 1 && steps.length > 1)}<figcaption>${esc(`${circled(i)} ${st.title}`)}${st.sub ? `<small>${esc(st.sub)}</small>` : ''}</figcaption></figure>`).join('')}</div>
      </div>`
    }).join('')}</div>
  </section>`
}

function plansHtml(p) {
  const L = sheetLabels(p.lang)
  const plans = (p.plans || []).filter(pl => pl.name || pl.lines?.length || pl.bullets?.length)
  return plans.map((pl, i) => {
    const color = pl.recommended ? COLORS.blue : (i === 0 ? COLORS.blue : COLORS.green)
    const t = planTotals(pl, p.tax_rate)
    const lines = (pl.lines || []).filter(l => l.label)
    return `<div class="plan${pl.recommended ? ' rec' : ''}" style="--c:${color.main};--cd:${color.dark};--cl:${color.light};--cs:${color.soft}">
      <div class="plan-hd">${pl.recommended ? CROWN : ''}<b>${esc(pl.name)}</b>${pl.recommended ? `<i>（${esc(L.recommended)}）</i>` : ''}${pl.subtitle ? `<span>${esc(pl.subtitle)}</span>` : ''}</div>
      <div class="plan-body">
        ${pl.chips?.filter(Boolean).length ? `<div class="chips">${pl.chips.filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('<b>＋</b>')}</div>` : ''}
        ${pl.bullets?.filter(Boolean).length ? `<ul class="checks">${pl.bullets.filter(Boolean).map(b => `<li><span class="ck">✓</span>${esc(b)}</li>`).join('')}</ul>` : ''}
        ${pl.show_price !== false && lines.length ? `<div class="price">
          ${lines.map(l => `<div class="pl"><span>${esc(l.label)}</span><span class="pl-calc">${yen(l.unit_price)}${Number(l.qty) !== 1 ? ` × ${esc(l.qty)}${esc(l.unit || L.times)}` : ''}</span><b>${yen(lineTotal(l.qty, l.unit_price))}</b></div>`).join('')}
          <div class="pl pl-sub"><span>${esc(L.subtotal)}</span><span></span><b>${yen(t.subtotal)}</b></div>
          <div class="pl-total"><span>${esc(L.total)}</span><b>${yen(t.total)}</b></div>
          ${pl.price_note ? `<div class="pl-note">${esc(pl.price_note)}</div>` : ''}
        </div>` : ''}
      </div>
    </div>`
  }).join('')
}

function scheduleHtml(p) {
  const sc = p.schedule
  if (!sc?.show || !sc.rows?.length) return ''
  const L = sheetLabels(p.lang)
  const start = Math.min(12, Math.max(1, Number(sc.start_month) || 1))
  const order = Array.from({ length: 12 }, (_, i) => ((start - 1 + i) % 12))
  const legend = (sc.legend || []).filter(Boolean)
  return `<div class="sched">
    <div class="sched-hd">${CAL}<b>${esc(sc.title || L.schedule)}</b>${sc.note ? `<span>${esc(sc.note)}</span>` : ''}</div>
    <table class="grid"><thead><tr><th>${esc(L.month)}</th>${order.map(m => `<th>${esc(L.months(m + 1))}</th>`).join('')}</tr></thead>
    <tbody>${sc.rows.map(r => {
      const c = COLORS[r.color] || COLORS.blue
      return `<tr><th style="background:${c.main}">${esc(r.label)}</th>${order.map(m => `<td>${r.marks?.[m] ? `<span class="dot" style="background:${c.main}"></span>${r.tags?.[m] ? `<small style="color:${c.dark}">(${esc(r.tags[m])})</small>` : ''}` : '<span class="dash">—</span>'}</td>`).join('')}</tr>`
    }).join('')}</tbody></table>
    ${legend.length ? `<div class="legend">${legend.map((t, i) => `<div><span class="dot" style="background:${(COLORS[sc.rows[i]?.color] || COLORS.blue).main}"></span>${esc(t)}</div>`).join('')}</div>` : ''}
  </div>`
}

const SHEET_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body,.sheet{text-spacing-trim:space-all;font-kerning:none;font-variant-east-asian:normal;font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",system-ui,sans-serif;color:#1b2a3d;-webkit-font-smoothing:antialiased}
.sheet{width:${SHEET_W}px;height:${SHEET_H}px;position:relative;overflow:hidden;background:linear-gradient(180deg,#ffffff 0%,#f5f9fe 100%);display:flex;flex-direction:column;padding:0 22px 16px;gap:12px}
.hd{position:relative;height:96px;margin:0 -22px;flex:0 0 auto}
.hd-bar{position:absolute;left:0;top:0;bottom:0;width:79%;background:linear-gradient(90deg,#0d2f5f 0%,#174a8c 100%)}
.hd-bar:after{content:"";position:absolute;right:-34px;top:0;bottom:0;width:68px;background:#174a8c;transform:skewX(-22deg)}
.hd-in{position:relative;height:100%;display:flex;align-items:center;padding:0 30px;gap:26px;width:79%}
.hd .to{color:#fff;font-size:42px;font-weight:800;letter-spacing:.02em;white-space:nowrap}
.hd .to small{font-size:38px;margin-left:10px;font-weight:800}
.hd .sep{width:2px;height:48px;background:rgba(255,255,255,.55);flex:0 0 auto}
.hd h1{color:#fff;font-size:38px;font-weight:800;line-height:1.12;letter-spacing:.01em;min-width:0}
.logo{position:absolute;right:34px;top:8px;text-align:center;color:#0d2f5f}
.logo b{display:block;font-size:56px;font-weight:900;letter-spacing:.02em;line-height:1.05}
.logo span{display:block;font-size:17px;letter-spacing:.42em;font-weight:700;margin-top:2px}
.top{display:flex;gap:22px;flex:0 0 auto;min-height:0}
.intro{flex:1 1 44%;font-size:20px;line-height:1.75;font-weight:600;padding:6px 6px 0 14px;color:#1b2a3d}
.intro p+p{margin-top:12px}
.hl{display:inline-block;padding:0 14px;border-radius:99px;color:#fff;font-weight:800;line-height:1.55;margin:0 2px}
.hl-b{background:#1f63b4}.hl-g{background:#2f9a46}
.cmp{flex:1 1 56%;background:#eef4fb;border:2px solid #cfe0f5;border-radius:16px;padding:18px 16px 14px;position:relative;margin-top:16px}
.pill{position:absolute;top:-17px;left:22px;background:#123f7a;color:#fff;font-weight:800;font-size:20px;padding:3px 24px;border-radius:99px;white-space:nowrap}
.cmp-row{display:flex;align-items:center;gap:14px;margin-top:8px}
.cmp-row figure{flex:1 1 0;position:relative;min-width:0}
.cmp-row .ph{height:176px}
.cmp-lbl{position:absolute;top:-8px;left:50%;transform:translateX(-50%);background:#123f7a;color:#fff;font-weight:800;font-size:18px;padding:3px 20px;border-radius:99px;white-space:nowrap;z-index:2}
.cmp-row .after .cmp-lbl{background:#1f63b4}
.tags{position:absolute;right:10px;top:34px;display:flex;flex-direction:column;gap:8px;z-index:2}
.tags span{background:#fff;color:#1b2a3d;font-weight:800;font-size:16px;padding:3px 14px;border-radius:99px;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.big-arr{color:#1f63b4;font-size:34px;flex:0 0 auto}
.ph{position:relative;border-radius:10px;overflow:hidden;background:#dbe5f0;height:150px}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.ph-empty{display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(135deg,#e8eef5 0 12px,#f1f5fa 12px 24px);border:2px dashed #c4d2e2}
.spark{position:absolute;right:8px;top:8px}
.work{position:relative;border:2px solid #cfe0f5;border-radius:16px;padding:30px 16px 12px;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:#fff}
.sec-title{position:absolute;top:-19px;left:0;right:0;text-align:center}
.sec-title span{display:inline-block;background:#123f7a;color:#fff;font-weight:800;font-size:22px;padding:4px 40px;border-radius:99px}
.svc-grid{display:flex;gap:16px;flex:1 1 auto;min-height:0}
.svc{flex:1 1 0;min-width:0;border:2px solid var(--cs);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;background:#fff}
.svc-hd{display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,var(--cd),var(--c));color:#fff;padding:8px 16px 8px 10px;min-height:58px}
.svc-ic{width:54px;height:54px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex:0 0 auto;border:3px solid var(--cs)}
.svc-hd b{font-size:28px;font-weight:900;letter-spacing:.02em;flex:1 1 auto;min-width:0}
.svc-hd em{font-style:normal;background:#fff;color:var(--cd);font-weight:900;font-size:20px;padding:3px 20px;border-radius:99px;white-space:nowrap}
.svc-desc{text-align:center;font-size:17px;font-weight:700;line-height:1.55;padding:8px 14px 4px;color:#1b2a3d}
.steps{display:flex;align-items:stretch;gap:6px;padding:6px 12px 10px;flex:1 1 auto;min-height:0}
.steps figure{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.steps .ph{height:auto;flex:1 1 auto;min-height:60px}
.steps .ph img{position:absolute;left:0;top:0}
.steps figcaption{text-align:center;font-weight:800;font-size:16.5px;margin-top:6px;line-height:1.35}
.steps figcaption small{display:block;font-size:13.5px;font-weight:700;color:#4b5c72}
.arr{color:var(--c);font-size:24px;align-self:center;margin-top:-22px}
.svc-grid.n3 .svc-hd b{font-size:22px}.svc-grid.n3 .svc-hd em{font-size:15px;padding:2px 12px}
.bottom{display:flex;gap:14px;flex:0 0 auto;align-items:stretch}
.plan{flex:1 1 0;min-width:0;border:2px solid var(--cs);border-radius:14px;background:#fff;overflow:hidden;display:flex;flex-direction:column}
.plan.rec{border-color:var(--c);box-shadow:0 0 0 2px var(--cs)}
.plan-hd{display:flex;align-items:center;gap:8px;padding:8px 14px;background:linear-gradient(90deg,var(--cl),#fff);border-bottom:2px solid var(--cs)}
.plan-hd b{font-size:27px;font-weight:900;color:var(--cd);white-space:nowrap}
.plan-hd i{font-style:normal;font-size:23px;font-weight:900;color:#e59a00;white-space:nowrap}
.plan-hd span{font-size:19px;font-weight:800;color:#1b2a3d;margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plan-body{padding:9px 14px 10px;display:flex;flex-direction:column;gap:7px;flex:1 1 auto}
.chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center}
.chips span{border:2px solid var(--c);color:var(--cd);font-weight:800;font-size:15.5px;padding:2px 14px;border-radius:99px;background:#fff}
.chips b{color:var(--cd);font-size:20px}
.checks{list-style:none;display:flex;flex-direction:column;gap:4px}
.checks li{font-size:16px;font-weight:700;line-height:1.35;display:flex;gap:8px;align-items:flex-start}
.ck{flex:0 0 auto;width:21px;height:21px;border-radius:50%;background:var(--c);color:#fff;font-size:13px;font-weight:900;display:inline-flex;align-items:center;justify-content:center;margin-top:1px}
.price{margin-top:auto;background:var(--cl);border-radius:10px;padding:7px 10px 8px;display:flex;flex-direction:column;gap:2px}
.pl{display:flex;gap:8px;font-size:13.5px;font-weight:700;align-items:baseline}
.pl span:first-child{flex:1 1 auto;min-width:0;line-height:1.35}
.pl-calc{color:#4b5c72;font-size:13px;white-space:nowrap}
.pl b{white-space:nowrap;min-width:88px;text-align:right}
.pl-sub{border-top:1px dashed var(--cs);padding-top:3px;margin-top:2px;color:#4b5c72}
.pl-total{display:flex;justify-content:space-between;align-items:baseline;color:var(--cd);margin-top:2px}
.pl-total span{font-size:16px;font-weight:900}
.pl-total b{font-size:28px;font-weight:900;letter-spacing:.01em}
.pl-note{font-size:12.5px;color:#4b5c72;font-weight:700;text-align:right}
.sched{flex:1.45 1 0;min-width:0;border:2px solid #cfe0f5;border-radius:14px;background:#fff;overflow:hidden;display:flex;flex-direction:column}
.sched-hd{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,#0d2f5f,#1f63b4);color:#fff;padding:7px 14px}
.sched-hd b{font-size:24px;font-weight:900}
.sched-hd span{font-size:16px;font-weight:700;opacity:.9}
.grid{width:calc(100% - 20px);margin:8px 10px 4px;border-collapse:separate;border-spacing:0;table-layout:fixed}
.grid th,.grid td{text-align:center;font-size:15px;height:34px;border-bottom:1px solid #e3ebf5}
.grid thead th{background:#eef4fb;font-weight:800;color:#123f7a;font-size:15px}
.grid thead th:first-child,.grid tbody th{width:124px}
.grid tbody th{color:#fff;font-size:13px;white-space:pre-line;font-weight:800;line-height:1.2;padding:3px;border-bottom:2px solid #fff;border-radius:6px}
.grid tbody tr{height:52px}
.grid td{vertical-align:middle}
.grid td small{display:block;font-size:11.5px;font-weight:800;margin-top:1px}
.dot{display:inline-block;width:18px;height:18px;border-radius:50%;vertical-align:middle}
.dash{color:#a9b6c6}
.legend{padding:2px 14px 8px;display:flex;flex-direction:column;gap:2px}
.legend div{font-size:14px;font-weight:700;display:flex;gap:8px;align-items:center}
.legend .dot{width:14px;height:14px}
.ft{display:flex;gap:18px;align-items:center;flex:0 0 auto}
.note{flex:1 1 auto;display:flex;align-items:center;gap:16px;background:#eaf2fc;border-radius:12px;padding:10px 18px;font-size:17px;font-weight:700;line-height:1.5;min-height:64px}
.note svg{flex:0 0 auto}
.sign{flex:0 0 auto;border-left:3px solid #123f7a;padding-left:18px;color:#0d2f5f;line-height:1.25}
.sign b{display:block;font-size:24px;font-weight:900}
.sign span{display:block;font-size:13px;font-weight:700;color:#4b5c72;margin-top:2px}
.meta{display:block;font-size:12px;color:#6b7c93;font-weight:600;margin-top:2px}
@page{size:A4 landscape;margin:0}
@media print{html,body{width:${SHEET_W}px}.sheet{zoom:.7}}
`

const visualLen = t => [...String(t || '')].reduce((n, ch) => n + (/[\x20-\x7e]/.test(ch) ? 0.56 : 1), 0)

/** Title size so it fits the navy bar: one line when it can, otherwise two smaller lines. */
function titleStyle(p) {
  const client = p.client_name ? visualLen(p.client_name) * 42 + visualLen(p.honorific) * 38 + 70 : 0
  const avail = SHEET_W * 0.79 - 60 - client
  const len = Math.max(1, visualLen(p.title))
  const one = Math.floor(avail / len)
  if (one >= 30) return `font-size:${Math.min(38, one)}px`
  return `font-size:${Math.max(18, Math.min(30, Math.floor((avail * 2 * 0.94) / len)))}px`
}

/** The whole proposal as one HTML document (preview iframe, PNG, PDF). */
export function proposalHtml(p) {
  const L = sheetLabels(p.lang)
  const issuer = p.lang === 'ja' ? QUOTE_ISSUER : { ...QUOTE_ISSUER, ...QUOTE_ISSUER_EN }
  const c = p.compare || {}
  const compare = c.show ? `<div class="cmp">
      <div class="pill">${esc(c.title || L.compare)}</div>
      <div class="cmp-row">
        <figure>${c.before?.label ? `<span class="cmp-lbl">${esc(c.before.label)}</span>` : ''}${img(c.before?.photo)}${(c.before?.tags || []).filter(Boolean).length ? `<div class="tags">${c.before.tags.filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</figure>
        <span class="big-arr">▶</span>
        <figure class="after">${c.after?.label ? `<span class="cmp-lbl">${esc(c.after.label)}</span>` : ''}${img(c.after?.photo, '', true)}</figure>
      </div>
    </div>` : ''
  const plans = plansHtml(p)
  const sched = scheduleHtml(p)
  const meta = [p.quote_number, p.valid_until ? `${L.validUntil} ${p.valid_until}` : ''].filter(Boolean).join(' · ')
  return `<!doctype html><html lang="${esc(p.lang || 'ja')}"><head><meta charset="utf-8"><meta name="viewport" content="width=${SHEET_W}"><title>${esc(p.title)}</title><style>${SHEET_CSS}</style></head><body>
<div class="sheet">
  <header class="hd"><div class="hd-bar"></div>
    <div class="hd-in">${p.client_name ? `<span class="to">${esc(p.client_name)}${p.honorific ? `<small>${esc(p.honorific)}</small>` : ''}</span><i class="sep"></i>` : ''}<h1 style="${titleStyle(p)}">${esc(p.title)}</h1></div>
    <div class="logo"><b>${esc(QUOTE_ISSUER.company)}</b><span>KURIPURO</span></div>
  </header>
  ${p.intro || compare ? `<section class="top">${p.intro ? `<div class="intro">${introHtml(p.intro)}</div>` : ''}${compare}</section>` : ''}
  ${servicesHtml(p)}
  ${plans || sched ? `<section class="bottom">${plans}${sched}</section>` : ''}
  <footer class="ft">
    <div class="note">${DOC}<div>${esc(p.footer?.text || '').replace(/\n/g, '<br>')}${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</div></div>
    ${p.footer?.sign !== false ? `<div class="sign"><b>${esc(issuer.company)}</b><b>${esc(issuer.name)}</b><span>${esc(issuer.phone)} · ${esc(issuer.email)}</span></div>` : ''}
  </footer>
</div></body></html>`
}

/* ---------------------------------------------------------------- export (PNG / PDF) */

const loadLibs = () => Promise.all([import('jspdf'), import('html2canvas')]).then(([a, b]) => ({ jsPDF: a.jsPDF, html2canvas: b.default }))

function renderFrame(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = `position:fixed;left:-${SHEET_W + 400}px;top:0;width:${SHEET_W}px;height:${SHEET_H}px;border:0;visibility:hidden`
    const timer = setTimeout(() => { iframe.remove(); reject(new Error('render timeout')) }, 30000)
    iframe.onload = async () => {
      clearTimeout(timer)
      const doc = iframe.contentDocument
      try { await doc.fonts?.ready } catch { /* optional */ }
      await Promise.all([...doc.images].map(im => (im.complete ? null : new Promise(r => { im.onload = im.onerror = r }))))
      resolve(iframe)
    }
    iframe.srcdoc = html
    document.body.appendChild(iframe)
  })
}

const blobToDataUrl = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob) })

/** Same proposal with every photo as a data: URL (the SVG renderer cannot load outside files). */
async function withInlinePhotos(p) {
  const cache = new Map()
  const inline = async photo => {
    if (!photo || String(photo).startsWith('data:')) return photo
    if (!cache.has(photo)) {
      cache.set(photo, fetch(photoUrl(photo), { mode: 'cors' }).then(r => (r.ok ? r.blob() : null)).then(b => (b ? blobToDataUrl(b) : photo)).catch(() => photo))
    }
    return cache.get(photo)
  }
  let out = { ...p, compare: { ...p.compare, before: { ...p.compare?.before }, after: { ...p.compare?.after } }, services: (p.services || []).map(s => ({ ...s, steps: (s.steps || []).map(st => ({ ...st })) })) }
  if (out.compare?.show) {
    out.compare.before.photo = await inline(out.compare.before.photo)
    out.compare.after.photo = await inline(out.compare.after.photo)
  }
  for (const s of out.services) for (const st of s.steps) st.photo = await inline(st.photo)
  return out
}

/**
 * The browser draws the sheet itself (HTML inside an SVG <foreignObject>), so Japanese text,
 * rounded labels and cropped photos look exactly like the preview. html2canvas redraws text on
 * its own and moves / overlaps Japanese punctuation, so it is only the fallback.
 */
async function svgCanvas(html, scale) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const css = doc.querySelector('style')?.textContent || ''
  const sheet = doc.querySelector('.sheet')
  const xml = new XMLSerializer().serializeToString(sheet)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}"><foreignObject x="0" y="0" width="${SHEET_W}" height="${SHEET_H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${SHEET_W}px;height:${SHEET_H}px"><style>${css.replace(/</g, '\\3c ')}</style>${xml}</div></foreignObject></svg>`
  const img = new Image()
  img.decoding = 'sync'
  const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('svg image')) })
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await loaded
  await new Promise(r => setTimeout(r, 60)) // Safari paints the foreignObject a moment after onload
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(SHEET_W * scale)
  canvas.height = Math.round(SHEET_H * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  // tainted canvas (older Safari) → throws here → fallback
  const probe = ctx.getImageData(Math.round(6 * scale), Math.round(6 * scale), 1, 1).data
  if (probe[0] > 240 && probe[1] > 240 && probe[2] > 240) throw new Error('svg render empty') // top-left corner of the header is always navy
  return canvas
}

async function html2canvasCanvas(html, scale) {
  const { html2canvas } = await loadLibs()
  const iframe = await renderFrame(html)
  try {
    const el = iframe.contentDocument.querySelector('.sheet')
    return await html2canvas(el, { scale, useCORS: true, backgroundColor: '#ffffff', logging: false, width: SHEET_W, height: SHEET_H, windowWidth: SHEET_W, windowHeight: SHEET_H })
  } finally { iframe.remove() }
}

/** Canvas of the sheet. scale 1.5 → 2400 × 1697 px (sharp on a phone, ~1 MB as JPEG). */
export async function proposalCanvas(p, { scale = 1.5 } = {}) {
  const inline = await withInlinePhotos(p)
  try {
    return await svgCanvas(proposalHtml(inline), scale)
  } catch (e) {
    console.warn('[proposal] SVG render failed, using html2canvas:', e?.message || e)
    return html2canvasCanvas(proposalHtml(p), scale)
  }
}

export const proposalFileBase = p => `KuriPuro_${String(p.client_name || 'proposta').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}_${String(p.updated_at || new Date().toISOString()).slice(0, 10)}`

export async function proposalPngFile(p) {
  const canvas = await proposalCanvas(p)
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'))
  return new File([blob], `${proposalFileBase(p)}.png`, { type: 'image/png' })
}

export async function proposalPdfFile(p, canvas = null) {
  const { jsPDF } = await loadLibs()
  const cv = canvas || await proposalCanvas(p)
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 297, 210)
  pdf.setProperties({ title: p.title || 'KuriPuro', author: 'KuriPuro' })
  return new File([pdf.output('blob')], `${proposalFileBase(p)}.pdf`, { type: 'application/pdf' })
}
