// v1.0.181 · "Um PDF só": every service report of one client on one day (e.g. all the On The
// Planet / Kodama stores) joined into a single printable document — a cover with the list of
// stores, then each store's own report on its own page. The individual reports stay as they are;
// this is only an extra option. Nothing is saved: it reads the reports and opens the print view.
import { escapeHtml as esc } from './escapeHtml'
import { listClientReports, loadReport, reportHtml } from './workReport'

export const isOnThePlanet = name => /on\s*the\s*planet|オンザプラネット|ｵﾝｻﾞﾌﾟﾗﾈｯﾄ/i.test(String(name || ''))

const isServiceReport = r => r && r.kind !== 'period' && !r.day

/**
 * Groups service reports (full reports or index summaries) by client + work date.
 * Only groups with at least `min` reports are returned (a PDF of one report is the report itself).
 */
export function groupByClientDay(reports, { min = 2 } = {}) {
  const map = new Map()
  for (const r of reports || []) {
    if (!isServiceReport(r) || !r.work_date) continue
    const cid = r.client_id || ''
    const name = r.client_name || ''
    if (!cid && !name) continue
    const key = `${cid || name}|${r.work_date}`
    if (!map.has(key)) map.set(key, { key, client_id: cid || null, client_name: name, date: r.work_date, reports: [] })
    map.get(key).reports.push(r)
  }
  return [...map.values()]
    .filter(g => g.reports.length >= min)
    .sort((a, b) => b.date.localeCompare(a.date) || (isOnThePlanet(b.client_name) - isOnThePlanet(a.client_name)) || a.client_name.localeCompare(b.client_name))
}

const COVER = {
  ja: { doc: '作業報告書（店舗まとめ）', date: '作業日', stores: '店舗', store: '店舗', service: '作業内容', who: '担当', photos: '写真', sama: '様', n: n => `${n}店舗`, intro: (c, d) => `いつも大変お世話になっております。KuriPuroでございます。${d}に${c ? `${c}様の各店舗で` : ''}実施いたしました清掃作業につきまして、店舗ごとの作業報告書を下記の通りまとめてご報告申し上げます。` },
  en: { doc: 'Service reports (all stores)', date: 'Service date', stores: 'Stores', store: 'Store', service: 'Service', who: 'Done by', photos: 'Photos', sama: '', n: n => `${n} stores`, intro: (c, d) => `Below are the service reports of every ${c ? `${c} ` : ''}store cleaned on ${d}, one store per page.` },
  pt: { doc: 'Relatórios de serviço (todas as lojas)', date: 'Data', stores: 'Lojas', store: 'Loja', service: 'Serviço', who: 'Feito por', photos: 'Fotos', sama: '', n: n => `${n} lojas`, intro: (c, d) => `Seguem os relatórios de serviço de todas as lojas ${c ? `${c} ` : ''}limpas em ${d}, uma loja por página.` },
}
const locale = lang => (lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US')
const storeOf = r => r.location || r.fields?.place || r.title || '—'
const pageOf = html => {
  const m = /<div class="page">([\s\S]*)<\/div><\/body>/.exec(html)
  return m ? m[1] : ''
}

/** One A4 HTML with a cover (list of stores) and every report on its own page. */
// v1.0.224 · `period` (e.g. '06/11 – 12/11') for a PDF of several days: cover shows it, reports go by date then store
export function combinedReportsHtml(reports, { clientName, date, lang, period } = {}) {
  const list = [...(reports || [])].filter(isServiceReport).sort((a, b) => String(a.work_date || '').localeCompare(String(b.work_date || '')) || storeOf(a).localeCompare(storeOf(b), 'ja'))
  if (!list.length) return ''
  const lg = lang || list[0].lang || 'ja'
  const L = COVER[lg] || COVER.ja
  const client = clientName ?? (list[0].client_name || '')
  const mixed = new Set(list.map(r => r.client_name || '')).size > 1
  const day = date || list[0].work_date
  const dayTxt = period || (day ? new Date(`${day}T12:00:00`).toLocaleDateString(locale(lg), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) : '')
  const htmls = list.map(r => reportHtml(r))
  const style = (/<style>([\s\S]*?)<\/style>/.exec(htmls[0]) || [])[1] || ''
  const multiDay = new Set(list.map(r => r.work_date || '')).size > 1
  const rows = list.map(r => `<tr><td>${multiDay && r.work_date ? `${esc(r.work_date.slice(5).replace('-', '/'))} ` : ''}${mixed && r.client_name ? `${esc(r.client_name)}<br>` : ''}${esc(storeOf(r))}</td><td>${esc(r.title || '')}</td><td>${esc(r.fields?.lead || r.signatures?.cleaner?.name || r.created_by || '')}</td><td>${(r.photos || []).length}</td></tr>`).join('')
  const cover = `<h1>${esc(L.doc)}</h1><div class="meta">${client ? `${esc(client)}${L.sama} ｜ ` : ''}${esc(L.date)}：${esc(dayTxt)} ｜ ${esc(L.n(list.length))}</div>
<section><p>${esc(L.intro(client, dayTxt))}</p><table class="lst"><tr><th>${esc(L.store)}</th><th>${esc(L.service)}</th><th>${esc(L.who)}</th><th>${esc(L.photos)}</th></tr>${rows}</table></section>`
  const pages = htmls.map(h => `<div class="brk">${pageOf(h)}</div>`).join('')
  const title = `${L.doc} · ${client} · ${period || day || ''}`
  return `<!doctype html><html lang="${esc(lg)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
${style}
.brk{break-before:page;page-break-before:always;margin-top:26px;padding-top:18px;border-top:3px solid #1f3a5f}
@media print{.brk{margin-top:0;padding-top:0;border-top:0}}
</style></head><body><div class="bar">KuriPuro｜${esc(L.doc)}</div><div class="page">${cover}${pages}</div></body></html>`
}

/** Full service reports of one client on one date (admin). */
export async function loadClientDayReports(clientId, date) {
  const sums = (await listClientReports(clientId)).filter(s => isServiceReport(s) && s.work_date === date)
  const full = await Promise.all(sums.map(s => loadReport(s.id).catch(() => null)))
  return full.filter(isServiceReport)
}
