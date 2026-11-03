// v1.0.133 · "Relatório do Cliente": what the CLIENT may see about the services of a period —
// day, place, type of service and WHO did it. Never times / duration, values or internal notes.
import { escapeHtml } from './escapeHtml.js'
import { getCleaningType, locationNameFromTitle } from './cleaningType.js'

/** Only the allowed fields; anything else of the job is dropped here on purpose. */
export function clientReportRows(jobs = []) {
  return (jobs || [])
    .filter(j => j.status === 'completed')
    .map(j => ({
      date: j.scheduled_date,
      place: locationNameFromTitle(j.title) || j.title || '',
      type: j.job_category === 'spot' ? 'spot' : getCleaningType(j) === 'deep' ? 'deep' : 'basic',
      service: String(j.title || '').split(' — ')[1] || '',
      who: j.employee_name || '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.place.localeCompare(b.place))
}

const TYPE = {
  ja: { basic: '定期清掃', deep: 'ディープクリーニング', spot: 'スポット' },
  en: { basic: 'Regular cleaning', deep: 'Deep cleaning', spot: 'Spot' },
  pt: { basic: 'Limpeza regular', deep: 'Limpeza profunda', spot: 'Spot' },
}
const TXT = {
  ja: { title: '作業報告書', period: '対象期間', day: '日付', place: '店舗', type: '作業内容', who: '担当', total: '件数', none: 'この期間の完了作業はありません。' },
  en: { title: 'Service report', period: 'Period', day: 'Date', place: 'Store', type: 'Service', who: 'Done by', total: 'Services', none: 'No completed service in this period.' },
  pt: { title: 'Relatório de serviços', period: 'Período', day: 'Data', place: 'Loja', type: 'Serviço', who: 'Feito por', total: 'Serviços', none: 'Nenhum serviço concluído neste período.' },
}

export function clientReportHtml({ clientName, from, to, rows, lang = 'ja' }) {
  const t = TXT[lang] || TXT.ja
  const ty = TYPE[lang] || TYPE.ja
  const day = d => new Date(`${d}T12:00:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })
  const body = rows.length
    ? rows.map(r => `<tr><td>${escapeHtml(day(r.date))}</td><td>${escapeHtml(r.place)}</td><td>${escapeHtml(ty[r.type])}${r.service && r.type !== 'basic' ? ` · ${escapeHtml(r.service)}` : ''}</td><td>${escapeHtml(r.who)}</td></tr>`).join('')
    : `<tr><td colspan="4" style="text-align:center;color:#667">${escapeHtml(t.none)}</td></tr>`
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(t.title)} · ${escapeHtml(clientName)}</title>
<style>body{font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;color:#122037;margin:32px}h1{font-size:22px;margin:0 0 4px}
.meta{color:#556;font-size:13px;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #dce2ea;padding:8px 6px;text-align:left}
th{background:#f3f6fa;font-weight:700}.sum{margin-top:14px;font-size:13px}@media print{body{margin:14mm}}</style></head><body>
<h1>${escapeHtml(t.title)}</h1><div class="meta">${escapeHtml(clientName)} · ${escapeHtml(t.period)}: ${escapeHtml(day(from))} – ${escapeHtml(day(to))}</div>
<table><thead><tr><th>${escapeHtml(t.day)}</th><th>${escapeHtml(t.place)}</th><th>${escapeHtml(t.type)}</th><th>${escapeHtml(t.who)}</th></tr></thead><tbody>${body}</tbody></table>
<div class="sum">${escapeHtml(t.total)}: ${rows.length}</div><div class="meta" style="margin-top:24px">KuriPuro</div></body></html>`
}
