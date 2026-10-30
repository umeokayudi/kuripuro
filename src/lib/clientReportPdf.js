// v1.0.106 · Client report as a printable A4 page (the browser's "Save as PDF").
// Same content as the screen; the video becomes a link to the client portal.
import { escapeHtml as esc } from './escapeHtml.js'
import { reportDay, reportMonth, rt, typeLabel } from './clientReportText.js'

const photo = (url, origin) => {
  if (!url) return ''
  if (/^(data:|blob:)/.test(url)) return url
  return `${origin}/api/photo?url=${encodeURIComponent(url)}`
}

const CSS = `
  @page { size: A4; margin: 14mm; }
  *{box-sizing:border-box}
  body{font-family:'Plus Jakarta Sans','Noto Sans JP','Hiragino Sans',sans-serif;color:#122033;margin:0 auto;max-width:760px;padding:6px 10px 24px;background:#fff;font-size:12.5px}
  .cover{border-bottom:2px solid #122033;padding-bottom:14px;margin-bottom:6px}
  .brand{font-family:Fraunces,serif;color:#c19c56;font-weight:700;letter-spacing:.06em;font-size:13px}
  h1{font-size:24px;margin:6px 0 4px}
  .sub{color:#4b5768;font-size:13px}
  .rule{height:3px;background:#c19c56;margin:0 0 16px}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 18px}
  .kpi{border:1px solid #e7ebf2;border-radius:11px;padding:10px 12px}
  .kpi small{display:block;color:#4b5768;font-size:11px}
  .kpi b{font-size:20px}
  .loc{break-inside:avoid-page;margin:0 0 18px}
  .loc h2{font-size:16px;margin:0 0 4px;padding-bottom:4px;border-bottom:1px solid #e7ebf2}
  .meta{color:#4b5768;font-size:11.5px;margin-bottom:8px}
  .svc{break-inside:avoid;border:1px solid #e7ebf2;border-radius:11px;padding:10px 12px;margin:0 0 8px}
  .svc-h{display:flex;justify-content:space-between;gap:8px;font-weight:700}
  .tag{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;background:#eef2ff;color:#315cf5}
  .tag.deep{background:#fff6e5;color:#9a6a12}.tag.spot{background:#f3e8ff;color:#7e22ce}
  .pics{display:flex;gap:8px;margin-top:8px}
  .pics figure{margin:0;flex:1}
  .pics img{width:100%;height:150px;object-fit:cover;border-radius:8px;border:1px solid #e7ebf2}
  .pics figcaption{font-size:11px;color:#4b5768}
  .line{margin-top:6px;font-size:12px}
  .note{margin-top:4px;padding:6px 8px;background:#f7f9fc;border-radius:8px}
  a{color:#315cf5}
  .foot{margin-top:24px;color:#4b5768;font-size:11px;text-align:center}
`

export function clientReportHtml(content, lang = 'ja', origin = '') {
  const L = (k, v) => esc(rt(lang, k, v))
  const t = content.totals || {}
  const portal = `${origin}/?tab=reports`
  const locs = (content.locations || []).filter(l => l.services.length || l.next.length).map(l => `
    <section class="loc">
      <h2>🏬 ${esc(l.name)}</h2>
      <div class="meta">${L('deepState')}: ${L('lastDone')} ${esc(reportDay(l.deep?.last, lang))} · ${L('nextExpected')} ${esc(reportDay(l.deep?.next, lang))}${l.checklist ? ` · ${L('checklist')}: ${L('checklistOf', { x: l.checklist.done, y: l.checklist.total })}` : ''}</div>
      ${l.services.length ? l.services.map(s => `
        <div class="svc">
          <div class="svc-h"><span>${esc(reportDay(s.date, lang))} · <span class="tag ${s.type}">${esc(typeLabel(s.type, lang))}</span>${s.what ? ` <span style="font-weight:500">${esc(s.what)}</span>` : ''}</span><span>${L('by')}: ${esc(s.by || '—')}</span></div>
          ${s.before || s.after ? `<div class="pics">${s.before ? `<figure><img src="${esc(photo(s.before, origin))}" alt=""><figcaption>${L('before')}</figcaption></figure>` : ''}${s.after ? `<figure><img src="${esc(photo(s.after, origin))}" alt=""><figcaption>${L('after')}</figcaption></figure>` : ''}</div>` : ''}
          ${s.checklist ? `<div class="line">✓ ${L('checklistOf', { x: s.checklist.done, y: s.checklist.total })}</div>` : ''}
          ${s.video ? `<div class="line">🎬 ${L('video')}: <a href="${esc(portal)}">${L('videoPortal')}</a></div>` : ''}
          ${(s.notes || []).map(n => `<div class="note">📝 ${esc(n.text)}</div>`).join('')}
        </div>`).join('') : `<p class="meta">${L('noService')}</p>`}
      <div class="line"><b>${L('next')}:</b> ${l.next.length ? l.next.map(n => `${esc(reportDay(n.date, lang))} (${esc(typeLabel(n.type, lang))})`).join(' · ') : L('noNext')}</div>
    </section>`).join('')
  return `<!doctype html><html lang="${lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt-BR' : 'en'}"><head><meta charset="utf-8"><title>${esc(content.client?.name || '')} · ${esc(reportMonth(content.period, lang))}</title><style>${CSS}</style></head><body>
    <div class="cover">
      <div class="brand">KuriPuro</div>
      <h1>${L('title')}</h1>
      <div class="sub"><b>${esc(content.client?.name || '')}</b> · ${L('period')}: ${esc(reportMonth(content.period, lang))}</div>
    </div>
    <div class="rule"></div>
    <div class="kpis">
      <div class="kpi"><small>${L('locations')}</small><b>${t.locations || 0}</b></div>
      <div class="kpi"><small>${L('services')}</small><b>${t.services || 0}</b></div>
      <div class="kpi"><small>${L('basicDeep')}</small><b>${t.basic || 0} × ${t.deep || 0}</b>${t.spot ? ` <small>+ ${t.spot} ${L('spot')}</small>` : ''}</div>
    </div>
    ${locs}
    <div class="foot">${L('footer')}</div>
  </body></html>`
}
