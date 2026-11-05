// v1.0.150 · 作業報告書 (service / work report) in the KuriPuro layout of the Bacana report
// (navy header bar, 作業概要 table, 作業内容 steps, before / during / after photos,
// 部位別ビフォー・アフター table, ご報告事項, メンテナンスのご提案, contact box).
//
// No SQL needed: each report is one JSON file in the public service-photos bucket, next to
// its photos, plus two tiny index files so we can find it by client and by job:
//   work-reports/<id>/report.json          full report
//   work-reports/<id>/p_<time>.jpg         photos added to the report
//   work-reports/_index/<clientId>/<id>.json  summary (list per client, CRM, client portal)
//   work-reports/_job/<jobId>.json            { id } (open the report of a job)
import { supabase, SUPABASE_URL } from './supabase'
import { uploadJobPhoto } from './uploadPhoto'
import { escapeHtml } from './escapeHtml'
import { QUOTE_ISSUER } from './quoteIssuer'
import { getCleaningType, locationNameFromTitle } from './cleaningType'
import { isVideoPath } from './workMedia'

const BUCKET = 'service-photos'
const ROOT = 'work-reports'
export const NO_CLIENT = 'sem-cliente'

export const LEVELS = ['heavy', 'medium_heavy', 'medium', 'light']

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
const clientKey = id => (id && /^[\w-]{6,64}$/.test(String(id)) ? String(id) : NO_CLIENT)

/** Public URL of a stored file (the bucket is public; prints and the client portal use it). */
export function storagePublicUrl(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${String(path).split('/').map(encodeURIComponent).join('/')}`
}

/** Empty report. `mode`: 'simple' (overview, work, photos, notices) or 'detailed' (all sections). */
export function blankReport({ mode = 'simple', job = null, client = null, author = null } = {}) {
  const place = job ? String(job.title || '').split(' — ')[0].trim() : ''
  const service = job ? (String(job.title || '').split(' — ')[1] || '').trim() : ''
  return {
    id: newId(),
    v: 1,
    mode,
    status: 'draft', // draft → ready (checked by office) → sent (client sees it in the portal)
    lang: 'ja',
    client_id: job?.client_id || client?.id || null,
    client_name: client?.company_name || job?.client_name || '',
    contact_name: client?.manager_name || client?.contact_name || client?.contact_person || '',
    location: place,
    job_id: job?.id || null,
    job_ids: job?.id ? [job.id] : [],
    title: service || '',
    work_date: job?.scheduled_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }),
    quote: { number: '', subtotal: '', tax_rate: 10, label: '' },
    fields: {
      place: place,
      equipment: '',
      lead: job?.employee_name || author?.name || '',
      tech: '',
      done_today: '',
      other_day: '',
    },
    custom_fields: [],
    summary: '',
    steps: [],
    notes_raw: '', // what the employee wrote (any language) — the AI turns it into the report
    before: { text: '', caption: '' },
    during: { caption: '' },
    after: { text: '', caption: '' },
    photos: [], // { path, section: before|during|after|part, part?: index, side?: before|after, caption, by, at }
    parts: [], // { name, level, before, why, after, note }
    extras: [], // { title, text } e.g. 温度センサーへの影響, 機器の使用年数
    notices: '',
    recommendations: [],
    closing: 'ご不明な点がございましたら、お気軽にお問い合わせください。',
    created_at: new Date().toISOString(),
    created_by: author?.name || '',
    updated_at: new Date().toISOString(),
    history: [],
  }
}

async function putJson(path, obj) {
  const body = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
}

async function getJson(path) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), 10000) : null
  try {
    const r = await fetch(`${storagePublicUrl(path)}?t=${Date.now()}`, { cache: 'no-store', signal: ctl?.signal })
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function summaryOf(r) {
  return {
    id: r.id, mode: r.mode, status: r.status, title: r.title, client_id: r.client_id, client_name: r.client_name,
    location: r.location, work_date: r.work_date, job_id: r.job_id, job_ids: r.job_ids || [],
    photos: r.kind === 'period' ? periodMediaCount(r) : (r.photos || []).length, updated_at: r.updated_at, sent_at: r.sent_at || null, created_by: r.created_by || '',
    kind: r.kind || 'service', from: r.from || null, to: r.to || null,
    stores: r.kind === 'period' ? (r.stores || []).map(st => st.name) : (r.location ? [r.location] : []),
  }
}

/** Saves the report and its index files. `prevClientId` moves the index when the client changed. */
export async function saveReport(report, { by = '', action = 'save', prevClientId } = {}) {
  const r = { ...report, updated_at: new Date().toISOString() }
  r.history = [...(report.history || []), { at: r.updated_at, by, action }].slice(-40)
  await putJson(`${ROOT}/${r.id}/report.json`, r)
  await putJson(`${ROOT}/_index/${clientKey(r.client_id)}/${r.id}.json`, summaryOf(r))
  if (prevClientId !== undefined && clientKey(prevClientId) !== clientKey(r.client_id)) {
    await supabase.storage.from(BUCKET).remove([`${ROOT}/_index/${clientKey(prevClientId)}/${r.id}.json`]).catch(() => {})
  }
  for (const jid of new Set([r.job_id, ...(r.job_ids || [])].filter(Boolean))) {
    await putJson(`${ROOT}/_job/${jid}.json`, { id: r.id }).catch(() => {})
  }
  return r
}

export const loadReport = id => getJson(`${ROOT}/${id}/report.json`)

/** Report linked to a job (null when the job has none yet). */
export async function reportIdForJob(jobId) {
  if (!jobId) return null
  const ref = await getJson(`${ROOT}/_job/${jobId}.json`)
  return ref?.id || null
}

async function listNames(prefix) {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (error) throw new Error(error.message)
  return data || []
}

async function readSummaries(prefix) {
  const files = (await listNames(prefix)).filter(f => f.name.endsWith('.json'))
  const out = []
  let i = 0
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++]
      const s = await getJson(`${prefix}/${f.name}`)
      if (s?.id) out.push(s)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  return out.sort((a, b) => String(b.work_date || '').localeCompare(String(a.work_date || '')) || String(b.updated_at).localeCompare(String(a.updated_at)))
}

/** Reports of one client (CRM sheet, client portal). */
export const listClientReports = clientId => readSummaries(`${ROOT}/_index/${clientKey(clientId)}`)

/** All reports (admin list). */
export async function listAllReports() {
  const folders = (await listNames(`${ROOT}/_index`)).filter(f => !f.name.includes('.'))
  const all = await Promise.all(folders.map(f => readSummaries(`${ROOT}/_index/${f.name}`).catch(() => [])))
  return all.flat().sort((a, b) => String(b.work_date || '').localeCompare(String(a.work_date || '')))
}

/** Deletes report + index files (photos stay; they are small and may be in use). */
export async function deleteReport(r) {
  const paths = [`${ROOT}/${r.id}/report.json`, `${ROOT}/_index/${clientKey(r.client_id)}/${r.id}.json`]
  for (const jid of new Set([r.job_id, ...(r.job_ids || [])].filter(Boolean))) paths.push(`${ROOT}/_job/${jid}.json`)
  const { error } = await supabase.storage.from(BUCKET).remove(paths)
  if (error) throw new Error(error.message)
}

/** Uploads one photo into the report folder. Returns the photo object to push into report.photos. */
export async function addReportPhoto(reportId, file, { section = 'before', part = null, side = null, by = '' } = {}) {
  const path = await uploadJobPhoto(`${ROOT}/${reportId}/p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`, file)
  return { path, section, part, side, caption: '', by, at: new Date().toISOString() }
}

/** Job photos that already exist (start / end / reference) — offered as "use in report". */
export function jobPhotoPaths(job) {
  if (!job) return []
  const out = []
  if (job.photo_start_url) out.push({ path: job.photo_start_url, section: 'before' })
  if (job.photo_end_url) out.push({ path: job.photo_end_url, section: 'after' })
  return out
}

// ───────────────────────── money ─────────────────────────
export function quoteMoney(q = {}) {
  const sub = Math.round(Number(String(q.subtotal || '').replace(/[^\d.]/g, '')) || 0)
  if (!sub) return null
  const rate = Number(q.tax_rate ?? 10) || 0
  const tax = Math.round(sub * rate / 100)
  return { sub, rate, tax, total: sub + tax }
}

// ───────────────────────── print / view (A4) ─────────────────────────
const STYLE = `@page{size:A4;margin:16mm 14mm 14mm}
*{box-sizing:border-box}
body{font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic",-apple-system,sans-serif;color:#1d2533;margin:0;font-size:13px;line-height:1.75;background:#fff}
.bar{background:#1f3a5f;color:#fff;font-size:11px;padding:9px 18px;letter-spacing:.04em}
.page{max-width:820px;margin:0 auto;padding:22px 18px 30px}
h1{color:#1f3a5f;font-weight:500;font-size:24px;margin:10px 0 2px}
.meta{color:#667;font-size:11.5px;margin-bottom:16px}
section{margin:0 0 14px}
h2{background:#1f3a5f;color:#fff;font-weight:500;font-size:16px;margin:16px 0 10px;padding:8px 12px;break-after:avoid}
h3{color:#1f3a5f;font-weight:500;font-size:14.5px;margin:14px 0 6px;break-after:avoid}
p{margin:0 0 8px}
.to{margin-bottom:6px}
table{width:100%;border-collapse:collapse;margin:8px 0 6px;font-size:12px}
.kv th{width:30%;background:#eef2f7;font-weight:400;text-align:left;border:1px solid #c9d3e0;padding:6px 9px;vertical-align:top}
.kv td{border:1px solid #c9d3e0;padding:6px 9px}
.pt th{background:#1f3a5f;color:#fff;font-weight:400;text-align:left;padding:6px 7px;border:1px solid #c9d3e0}
.pt td{border:1px solid #c9d3e0;padding:6px 7px;vertical-align:top}
tr{break-inside:avoid}
ol,ul{margin:4px 0 8px;padding-left:24px}
li{margin:2px 0}
.grid{display:grid;gap:4px;margin:8px auto 4px;max-width:600px;break-inside:avoid}
figure{margin:0}
.grid img,.grid video{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#eef2f7}
.vid{position:relative}.vtag{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:1px 7px;border-radius:99px;pointer-events:none}
.svc{border-top:1px solid #dce2ea;padding:10px 0 4px;break-inside:avoid}.svc-h{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12.5px;margin-bottom:4px}.svc-h b{color:#1f3a5f}.svc-h span{color:#556}.ba{font-size:11px;color:#1f3a5f;margin:6px 0 0}
.lst td,.lst th{border:1px solid #c9d3e0;padding:5px 8px;text-align:left}.lst th{background:#eef2f7;font-weight:400}
figcaption{font-size:10.5px;color:#556;margin-top:2px}
.cap{font-size:10.5px;color:#667;margin:2px 0 10px}
.pair{break-inside:avoid;margin-bottom:8px}
.pair .grid{max-width:360px}
.sign{border:1px solid #1f3a5f;background:#eef2f7;padding:10px 12px;font-size:11.5px;margin-top:18px;line-height:1.6;break-inside:avoid}
@media print{video{display:none}.vid::before{content:'▶ 動画はポータルでご覧いただけます';display:block;font-size:10px;color:#556;padding:30px 6px;background:#eef2f7;aspect-ratio:3/4}.vtag{display:none}.page{padding:14px 0 0}.bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2,.pt th,.kv th,td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@media (max-width:560px){h1{font-size:19px}.kv th{width:38%}.pt{font-size:10.5px}}
`
const T = {
  ja: {
    doc: '作業報告書', date: '作業日', issued: '発行', sama: '様', overview: '作業概要', work: '作業内容',
    workIntro: '以下の工程で作業を実施いたしました。',
    before: '作業前（ビフォー）', during: '作業風景', after: '作業後（アフター）', parts: '部位別ビフォー・アフター比較',
    partCols: ['部位', '汚れの程度', '作業前の状態', '清掃が重要な理由', '作業後'], pair: '（左：作業前／右：作業後）',
    notices: 'ご報告事項', recs: '今後のメンテナンスのご提案', lead: '作業責任者', tech: '技術責任者',
    place: '作業場所', equipment: '対象機器', doneToday: '本日完了', otherDay: '別日実施', quote: '御見積金額',
    taxEx: '（税抜）', taxLabel: '消費税', totalLabel: '合計', taxIn: '（税込）', quoteNo: '御見積書',
    levels: { heavy: '重度', medium_heavy: '中度〜重度', medium: '中度', light: '軽度' },
    greeting: (c, q) => `いつも大変お世話になっております。KuriPuroでございます。${q ? `御見積書（No.${q}）に基づき実施いたしました` : '実施いたしました'}作業につきまして、下記の通りご報告申し上げます。`,
  },
  en: {
    doc: 'Service Report', date: 'Service date', issued: 'Issued by', sama: '', overview: 'Overview', work: 'Work performed',
    workIntro: 'The work was carried out in the following steps.',
    before: 'Before', during: 'During the work', after: 'After', parts: 'Before / after by part',
    partCols: ['Part', 'Dirt level', 'Before', 'Why cleaning matters', 'After'], pair: '(left: before / right: after)',
    notices: 'Notes', recs: 'Maintenance recommendations', lead: 'Person in charge', tech: 'Technical lead',
    place: 'Location', equipment: 'Equipment', doneToday: 'Completed today', otherDay: 'Another day', quote: 'Quoted amount',
    taxEx: ' (excl. tax)', taxLabel: 'tax', totalLabel: 'total', taxIn: ' (incl. tax)', quoteNo: 'Quote',
    levels: { heavy: 'Heavy', medium_heavy: 'Medium–heavy', medium: 'Medium', light: 'Light' },
    greeting: (c, q) => `Thank you for choosing KuriPuro. Please find below our report on the work carried out${q ? ` under quote No.${q}` : ''}.`,
  },
  pt: {
    doc: 'Relatório de serviço', date: 'Data do serviço', issued: 'Emitido por', sama: '', overview: 'Resumo', work: 'Serviço realizado',
    workIntro: 'O serviço foi feito nas etapas abaixo.',
    before: 'Antes', during: 'Durante o serviço', after: 'Depois', parts: 'Antes / depois por parte',
    partCols: ['Parte', 'Sujeira', 'Antes', 'Por que limpar', 'Depois'], pair: '(esquerda: antes / direita: depois)',
    notices: 'Avisos', recs: 'Sugestões de manutenção', lead: 'Responsável', tech: 'Responsável técnico',
    place: 'Local', equipment: 'Equipamento', doneToday: 'Feito hoje', otherDay: 'Outro dia', quote: 'Valor do orçamento',
    taxEx: ' (sem imposto)', taxLabel: 'imposto', totalLabel: 'total', taxIn: ' (com imposto)', quoteNo: 'Orçamento',
    levels: { heavy: 'Forte', medium_heavy: 'Médio a forte', medium: 'Médio', light: 'Leve' },
    greeting: (c, q) => `Obrigado por escolher a KuriPuro. Segue o relatório do serviço realizado${q ? ` conforme o orçamento Nº ${q}` : ''}.`,
  },
}
export const reportLabels = lang => T[lang] || T.ja
const LEVEL_BG = { heavy: '#fbe3e6', medium_heavy: '#fdebd8', medium: '#fff4d6', light: '#e3f4e6' }

const esc = escapeHtml
const paras = text => String(text || '').split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')

const isVideo = p => p?.kind === 'video' || isVideoPath(p?.path)
const mediaTag = p => isVideo(p)
  ? `<video src="${esc(storagePublicUrl(p.path))}#t=0.5" controls playsinline preload="metadata"></video><span class="vtag">▶</span>`
  : `<img src="${esc(storagePublicUrl(p.path))}" alt="" loading="lazy">`

function photoGrid(photos, { cols = 3, caption = '' } = {}) {
  if (!photos.length) return ''
  const n = Math.min(cols, photos.length)
  return `<div class="grid" style="grid-template-columns:repeat(${n},1fr)">${photos.map(p => `<figure${isVideo(p) ? ' class="vid"' : ''}>${mediaTag(p)}${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`).join('')}</div>${caption ? `<div class="cap">${esc(caption)}</div>` : ''}`
}

/** Full A4 HTML of the report (print / save as PDF / client portal). */
export function reportHtml(r, opts = {}) {
  if (r.kind === 'period') return periodHtml(r, opts)
  const t = reportLabels(r.lang)
  const detailed = r.mode === 'detailed'
  const issuer = r.lang === 'ja' ? 'KuriPuro' : 'KuriPuro'
  const title = `${t.doc}${r.title ? `｜${r.title}` : ''}`
  const date = r.work_date ? new Date(`${r.work_date}T12:00:00`).toLocaleDateString(r.lang === 'ja' ? 'ja-JP' : r.lang === 'pt' ? 'pt-BR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
  const f = r.fields || {}
  const rows = [
    [t.place, f.place], [t.equipment, f.equipment], [t.date, date], [t.lead, f.lead], [t.tech, f.tech],
    [t.doneToday, f.done_today], [t.otherDay, f.other_day],
    ...(r.custom_fields || []).map(c => [c.label, c.value]),
    // v1.0.155: amounts are internal (office only) — never printed for the client.
  ].filter(x => x && String(x[1] || '').trim())

  const photos = sec => (r.photos || []).filter(p => p.section === sec)
  const steps = (r.steps || []).filter(s => String(s).trim())
  const parts = (r.parts || []).filter(p => String(p.name || '').trim())
  const recs = (r.recommendations || []).filter(s => String(s).trim())
  const extras = (r.extras || []).filter(e => String(e.title || e.text || '').trim())
  const sec = (h, body) => body ? `<section><h2>${esc(h)}</h2>${body}</section>` : ''

  const partBlocks = parts.map((p, i) => {
    const pics = (r.photos || []).filter(ph => ph.section === 'part' && Number(ph.part) === i)
    const b = pics.find(ph => ph.side === 'before') || pics[0]
    const a = pics.find(ph => ph.side === 'after') || pics.find(ph => ph !== b)
    if (!b && !a && !p.note) return ''
    return `<div class="pair"><h3>${esc(p.name)}${b && a ? esc(t.pair) : ''}</h3>${photoGrid([b, a].filter(Boolean), { cols: 2 })}${paras(p.note)}</div>`
  }).join('')

  const body = [
    `<h1>${esc(title)}</h1><div class="meta">${esc(r.client_name)}${t.sama ? t.sama : ''}${date ? ` ｜ ${esc(t.date)}：${esc(date)}` : ''} ｜ ${esc(t.issued)}：${issuer}</div>`,
    sec(t.overview, `${r.client_name || r.contact_name ? `<p class="to">${esc([r.client_name, r.contact_name ? `${r.contact_name}${t.sama}` : ''].filter(Boolean).join(' '))}</p>` : ''}${paras(r.summary || t.greeting(r.client_name, r.quote?.number))}${rows.length ? `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}`),
    steps.length ? sec(t.work, `<p>${esc(t.workIntro)}</p><ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`) : '',
    (photos('before').length || r.before?.text) ? sec(t.before, `${paras(r.before?.text)}${photoGrid(photos('before'), { caption: r.before?.caption })}`) : '',
    detailed && photos('during').length ? `<h3 class="sub">${esc(t.during)}</h3>${photoGrid(photos('during'), { caption: r.during?.caption })}` : '',
    (photos('after').length || r.after?.text) ? sec(t.after, `${paras(r.after?.text)}${photoGrid(photos('after'), { caption: r.after?.caption })}`) : '',
    detailed && parts.length ? sec(t.parts, `${r.parts_intro ? paras(r.parts_intro) : ''}<table class="pt"><thead><tr>${t.partCols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${parts.map(p => `<tr><td>${esc(p.name)}</td><td style="background:${LEVEL_BG[p.level] || '#fff'}">${esc(t.levels[p.level] || p.level || '')}</td><td>${esc(p.before)}</td><td>${esc(p.why)}</td><td>${esc(p.after)}</td></tr>`).join('')}</tbody></table>${partBlocks}`) : '',
    detailed ? extras.map(e => sec(e.title, paras(e.text))).join('') : '',
    r.notices ? sec(t.notices, paras(r.notices)) : '',
    detailed && recs.length ? sec(t.recs, `${r.recs_intro ? paras(r.recs_intro) : ''}<ul>${recs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`) : '',
    r.closing ? paras(r.closing) : '',
    `<div class="sign">KuriPuro<br>${[f.lead ? `${esc(t.lead)}：${esc(f.lead)}` : '', f.tech ? `${esc(t.tech)}：${esc(f.tech)}` : ''].filter(Boolean).join(' ／ ')}<br>TEL: ${esc(QUOTE_ISSUER.phone)}\u3000Mail: ${esc(QUOTE_ISSUER.email)}</div>`,
  ].join('')

  return `<!doctype html><html lang="${esc(r.lang || 'ja')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(r.client_name || '')}</title>
<style>
${STYLE}
</style></head><body><div class="bar">KuriPuro｜${esc(t.doc)}</div><div class="page">${body}</div></body></html>`
}

// ───────────────────────── period report (one section per store) ─────────────────────────
const P = {
  ja: { doc: '作業報告書', period: '対象期間', store: '店舗', services: '件', date: '日付', type: '作業内容', who: '担当', before: '作業前', after: '作業後', none: 'この期間の完了作業はありません。', intro: (c, f, t) => `いつも大変お世話になっております。KuriPuroでございます。${f}〜${t}に実施いたしました清掃作業につきまして、店舗ごとに下記の通りご報告申し上げます。` , types: { basic: '定期清掃', deep: 'ディープクリーニング', spot: 'スポット' }, summary: '店舗別まとめ' },
  en: { doc: 'Service Report', period: 'Period', store: 'Store', services: 'services', date: 'Date', type: 'Service', who: 'Done by', before: 'Before', after: 'After', none: 'No completed service in this period.', intro: (c, f, t) => `Thank you for choosing KuriPuro. Below is our report of the cleaning carried out from ${f} to ${t}, store by store.`, types: { basic: 'Regular cleaning', deep: 'Deep cleaning', spot: 'Spot' }, summary: 'Summary by store' },
  pt: { doc: 'Relatório de serviços', period: 'Período', store: 'Loja', services: 'serviços', date: 'Data', type: 'Serviço', who: 'Feito por', before: 'Antes', after: 'Depois', none: 'Nenhum serviço concluído neste período.', intro: (c, f, t) => `Obrigado por escolher a KuriPuro. Segue o relatório das limpezas feitas de ${f} a ${t}, loja por loja.`, types: { basic: 'Limpeza regular', deep: 'Limpeza profunda', spot: 'Spot' }, summary: 'Resumo por loja' },
}
export const periodLabels = lang => P[lang] || P.ja
const localeFor = lang => (lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US')
const fmtDay = (d, lang, opts = { year: 'numeric', month: 'long', day: 'numeric' }) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(localeFor(lang), opts) : '')

export function periodMediaCount(r) {
  return (r.stores || []).reduce((n, st) => n + (st.services || []).reduce((m, sv) => m + (sv.media || []).filter(x => x.include !== false).length, 0), 0)
}

/**
 * Builds the client's report of a period from what already exists: completed services
 * (date, type, who) grouped by store, with every before/after photo and video of them.
 * Never copies times, values, AI grades or internal notes.
 */
export function buildPeriodReport({ client, from, to, jobs, media, author, lang = 'ja' }) {
  const done = (jobs || []).filter(j => j.status === 'completed' && (!client?.id || !j.client_id || j.client_id === client.id) && j.scheduled_date >= from && j.scheduled_date <= to)
  const byStore = new Map()
  for (const j of done.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))) {
    const name = locationNameFromTitle(j.title) || j.title || '—'
    if (!byStore.has(name)) byStore.set(name, [])
    byStore.get(name).push({
      job_id: j.id,
      date: j.scheduled_date,
      type: j.job_category === 'spot' ? 'spot' : getCleaningType(j) === 'deep' ? 'deep' : 'basic',
      service: String(j.title || '').split(' — ')[1] || '',
      who: j.employee_name || '',
      include: true,
      media: (media?.get?.(j.id) || []).map(m => ({ path: m.path, kind: m.kind, section: m.section, include: true })),
    })
  }
  const stores = [...byStore.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, services]) => ({ name, note: '', services }))
  const L = periodLabels(lang)
  return {
    id: newId(), v: 1, kind: 'period', mode: 'period', status: 'draft', lang,
    client_id: client?.id || null, client_name: client?.company_name || '', contact_name: client?.manager_name || client?.contact_name || '',
    location: null, job_id: null, job_ids: [], title: `${fmtDay(from, lang, { year: 'numeric', month: 'long' })} ${L.doc}`,
    work_date: to, from, to, summary: L.intro(client?.company_name, fmtDay(from, lang), fmtDay(to, lang)),
    stores, internal: { office_note: '' }, closing: lang === 'ja' ? 'ご不明な点がございましたら、お気軽にお問い合わせください。' : '',
    created_at: new Date().toISOString(), created_by: author?.name || '', updated_at: new Date().toISOString(), history: [],
  }
}

/** Client view of a period report. `store` limits it to one store (store logins of the portal). */
function periodHtml(r, { store } = {}) {
  const L = periodLabels(r.lang)
  const stores = (r.stores || []).filter(st => !store || st.name === store)
    .map(st => ({ ...st, services: (st.services || []).filter(sv => sv.include !== false) }))
    .filter(st => st.services.length)
  const total = stores.reduce((n, st) => n + st.services.length, 0)
  const title = r.title || L.doc
  const summary = stores.length > 1
    ? `<section><h2>${esc(L.summary)}</h2><table class="lst"><tr><th>${esc(L.store)}</th><th>${esc(L.services)}</th></tr>${stores.map(st => `<tr><td>${esc(st.name)}</td><td>${st.services.length}</td></tr>`).join('')}</table></section>` : ''
  const blocks = stores.map(st => `<section><h2>${esc(L.store)}：${esc(st.name)}（${st.services.length}${r.lang === 'ja' ? '件' : ` ${esc(L.services)}`}）</h2>${paras(st.note)}${st.services.map(sv => {
    const m = (sv.media || []).filter(x => x.include !== false)
    const b = m.filter(x => x.section === 'before'), a = m.filter(x => x.section !== 'before')
    return `<div class="svc"><div class="svc-h"><b>${esc(fmtDay(sv.date, r.lang, { month: 'long', day: 'numeric', weekday: 'short' }))}</b><span>${esc(L.types[sv.type] || '')}${sv.service && sv.type !== 'basic' ? ` · ${esc(sv.service)}` : ''}</span><span>${esc(L.who)}：${esc(sv.who || '—')}</span></div>${b.length ? `<div class="ba">${esc(L.before)}</div>${photoGrid(b, { cols: 4 })}` : ''}${a.length ? `<div class="ba">${esc(L.after)}</div>${photoGrid(a, { cols: 4 })}` : ''}</div>`
  }).join('')}</section>`).join('')
  const body = `<h1>${esc(title)}</h1><div class="meta">${esc(r.client_name)}${r.lang === 'ja' ? '様' : ''}${store ? ` ｜ ${esc(store)}` : ''} ｜ ${esc(L.period)}：${esc(fmtDay(r.from, r.lang))}〜${esc(fmtDay(r.to, r.lang))} ｜ ${total}${r.lang === 'ja' ? '件' : ` ${esc(L.services)}`}</div>
${paras(r.summary)}${summary}${blocks || `<p>${esc(L.none)}</p>`}${paras(r.closing)}<div class="sign">KuriPuro<br>TEL: ${esc(QUOTE_ISSUER.phone)}\u3000Mail: ${esc(QUOTE_ISSUER.email)}</div>`
  return `<!doctype html><html lang="${esc(r.lang || 'ja')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(r.client_name || '')}</title><style>
${STYLE}
</style></head><body><div class="bar">KuriPuro｜${esc(L.doc)}</div><div class="page">${body}</div></body></html>`
}

/** Can this portal login see this report? Store logins see their store only. */
export function reportVisibleTo(summary, user) {
  if (!summary || summary.status !== 'sent' || !user?.client_id) return false
  if (summary.client_id && summary.client_id !== user.client_id) return false
  if (!user.location_name) return true
  const stores = summary.stores?.length ? summary.stores : (summary.location ? [summary.location] : [])
  return !stores.length || stores.includes(user.location_name)
}

// ───────────────────────── AI ─────────────────────────
/** Calls the AI helper. task: 'polish' (fix + resize one text) or 'draft' (fill the whole report from notes). */
export async function reportAi(task, payload) {
  const resp = await fetch('/api/evaluate-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ kind: 'work-report', task, ...payload }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

/** What the AI needs to write a report (no money, no internal notes beyond the job). */
export function draftPayload(r, job) {
  return {
    lang: r.lang,
    mode: r.mode,
    client: r.client_name,
    contact: r.contact_name,
    title: r.title,
    fields: r.fields,
    quote_number: r.quote?.number || '',
    notes: r.notes_raw,
    job: job ? {
      title: job.title, notes: job.notes_employee || job.retro_report || '', checklist_missed: job.checklist_missed_items || '',
      description: job.description || '', instructions: job.instructions || '',
    } : null,
    photo_captions: (r.photos || []).map(p => `${p.section}${p.side ? `/${p.side}` : ''}: ${p.caption || ''}`).filter(s => !s.endsWith(': ')),
    parts: (r.parts || []).map(p => p.name).filter(Boolean),
  }
}

/** Merges an AI draft into the report: only fills what the AI returned, keeps photos and fields. */
export function applyDraft(r, d = {}) {
  const pick = (v, old) => (typeof v === 'string' && v.trim() ? v.trim() : old)
  const arr = (v, old) => (Array.isArray(v) && v.length ? v.map(s => String(s).trim()).filter(Boolean) : old)
  return {
    ...r,
    title: pick(d.title, r.title),
    summary: pick(d.summary, r.summary),
    steps: arr(d.steps, r.steps),
    before: { ...r.before, text: pick(d.before_text, r.before?.text) },
    after: { ...r.after, text: pick(d.after_text, r.after?.text) },
    parts: Array.isArray(d.parts) && d.parts.length
      ? d.parts.map(p => ({ name: String(p.name || ''), level: LEVELS.includes(p.level) ? p.level : 'medium', before: String(p.before || ''), why: String(p.why || ''), after: String(p.after || ''), note: String(p.note || '') }))
      : r.parts,
    parts_intro: pick(d.parts_intro, r.parts_intro || ''),
    extras: Array.isArray(d.extras) && d.extras.length ? d.extras.map(e => ({ title: String(e.title || ''), text: String(e.text || '') })) : r.extras,
    notices: pick(d.notices, r.notices),
    recs_intro: pick(d.recs_intro, r.recs_intro || ''),
    recommendations: arr(d.recommendations, r.recommendations),
  }
}

/** Plain-language state of a report for lists. */
export function statusLabel(status, tr) {
  if (status === 'sent') return tr('Sent to client', '顧客へ送付済み', 'Enviado ao cliente')
  if (status === 'ready') return tr('Ready to send', '送付準備OK', 'Pronto para enviar')
  return tr('Draft', '下書き', 'Rascunho')
}
