// v1.0.183 · Service Reports on the phone: one clear card per service, grouped by day.
// Colour + one plain sentence say if it is OK, needs a look, or is still open; tap anywhere opens the report.
import StorageImage from './StorageImage'
import { fmtDuration } from '../lib/jobReport'
import { serviceLabel } from '../lib/dayPanel'
import { addDays } from '../lib/schedulePlan'
import './reportCards.css'

// what is worth a look (video / notes are information, not a problem)
const WARN = ['long', 'lowai', 'checklist', 'nophoto', 'nosig']

export function reportLevel(problems) {
  if (problems.has('open')) return 'todo'
  return WARN.some(p => problems.has(p)) ? 'warn' : 'ok'
}

export default function ReportCards({ rows, problemsOf, filter = 'all', setFilter, onOpen, L3, lang, today }) {
  const PROBLEM_TEXT = {
    long: L3('took over 2× the planned time', '予定の2倍超', 'passou 2× do tempo'),
    lowai: L3('low AI photo grade', 'AI写真評価が低い', 'nota baixa da IA na foto'),
    checklist: L3('checklist incomplete', 'チェック未完了', 'checklist incompleto'),
    nophoto: L3('no photo', '写真なし', 'sem foto'),
    nosig: L3('no signature', 'サインなし', 'sem assinatura'),
  }
  const items = rows.map(r => { const pb = problemsOf(r); return { r, pb, level: reportLevel(pb) } })
  const n = k => items.filter(x => x.level === k).length
  const shown = filter === 'all' ? items : items.filter(x => x.level === filter)
  const days = []
  for (const x of shown) {
    const d = x.r.report_date || ''
    let g = days.find(y => y.d === d)
    if (!g) days.push(g = { d, list: [] })
    g.list.push(x)
  }
  const dayTitle = d => {
    const txt = d ? new Date(`${d}T12:00:00+09:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' }) : '—'
    const rel = d === today ? L3('Today', '今日', 'Hoje') : d === addDays(today, -1) ? L3('Yesterday', '昨日', 'Ontem') : ''
    return rel ? `${rel} · ${txt}` : txt
  }
  const F = [
    ['all', L3('All', 'すべて', 'Todos'), items.length],
    ['warn', L3('To check', '要確認', 'Conferir'), n('warn')],
    ['ok', L3('All right', '問題なし', 'Tudo certo'), n('ok')],
    ['todo', L3('Open', '未完了', 'Pendentes'), n('todo')],
  ]
  return (
    <div className="rpc">
      <div className="rpc-filters" role="group" aria-label={L3('Show', '表示', 'Mostrar')}>
        {F.map(([k, label, c]) => <button key={k} type="button" className={`rpc-f is-${k}${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} <b>{c}</b></button>)}
      </div>
      {!shown.length && <p className="rpc-empty">{L3('Nothing here.', '該当なし', 'Nada aqui.')}</p>}
      {days.map(g => (
        <section key={g.d} className="rpc-day">
          <h4>{dayTitle(g.d)} <span>{g.list.length}</span></h4>
          {g.list.map(({ r, pb, level }) => {
            const store = (r.job_title || r.client_name || '').replace(/ — .*/, '') || '—'
            const svc = serviceLabel(r._job || { title: r.job_title }, L3)
            const issues = WARN.filter(p => pb.has(p)).map(p => PROBLEM_TEXT[p])
            const facts = [
              r.duration_min != null ? `⏱ ${fmtDuration(r.duration_min, lang)}` : null,
              r.checklist_total ? `☑ ${r.checklist_done || 0}/${r.checklist_total}` : null,
              r.photo_ai_score != null && r.photo_ai_score !== '' ? `🤖 ${r.photo_ai_score}/10` : null,
            ].filter(Boolean)
            const photo = r.photo_after_url || r.photo_before_url
            return (
              <button key={r.job_id || r.id} type="button" className={`rpc-card is-${level}`} onClick={() => onOpen(r)}>
                <span className="rpc-main">
                  <span className="rpc-top">
                    <strong>{store}</strong>
                    <span className={`rpc-badge is-${level}`}>{level === 'ok' ? `✓ ${L3('All right', '問題なし', 'Tudo certo')}` : level === 'warn' ? `! ${L3('Check', '要確認', 'Conferir')}` : `⏰ ${L3('Open', '未完了', 'Pendente')}`}</span>
                  </span>
                  <span className="rpc-who">{r.employee_name || '—'} · {svc}</span>
                  {facts.length > 0 && <span className="rpc-facts">{facts.join('   ')}</span>}
                  {issues.length > 0 && <span className="rpc-issues">⚠️ {issues.join(' · ')}</span>}
                  <span className="rpc-open">{L3('Open report', '報告書を開く', 'Abrir relatório')} ›</span>
                </span>
                {photo && <span className="rpc-thumb"><StorageImage url={photo} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, display: 'block' }} /></span>}
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}
