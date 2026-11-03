import { useLang } from '../hooks/useLang'
import { payrollJobLines } from '../lib/salaryCalc'
import { fmtPeriod } from '../lib/salaryPeriod'

// v1.0.145 · Opens from the calculated salary line of the payroll sheet ("10 completed jobs ¥35,538"):
// every completed job of the month with date, time, place, client, address, time worked and what
// that job adds to the base, so the admin sees where the number comes from.
export default function PayrollJobsDetail({ person, jobs, period, calc, onClose }) {
  const { tr, locale } = useLang()
  const fmt = n => '¥' + Math.round(Number(n || 0)).toLocaleString(locale)
  const used = calc?.basis || calc?.autoBasis || null
  const rows = payrollJobLines({ emp: person, jobs, month: period, used })
  const totalMin = rows.reduce((s, r) => s + r.minutes, 0)
  const days = new Set(rows.map(r => r.date)).size
  const places = new Set(rows.map(r => r.place).filter(Boolean)).size
  const fmtDay = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', weekday: 'short' }) : ''
  const hm = iso => iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : ''
  const dur = m => m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
  const isFixed = used === 'fixed' || (!used && !['hourly', 'per_job', 'mixed'].includes(person?.salary_type))

  const how = used === 'per_job' ? tr('Employee pay set on each job', '各作業の作業者支払い', 'Pagamento do funcionário definido em cada job')
    : isFixed ? tr('Fixed salary — the jobs are the month’s record, not paid one by one', '固定給 — 作業は記録のみ（1件ごとの支払いではありません）', 'Salário fixo — os jobs são o registro do mês, não pagos um a um')
    : person?.salary_type === 'hourly' ? tr(`Time worked × ${fmt(person?.hourly_rate)}/h`, `作業時間 × ${fmt(person?.hourly_rate)}/時`, `Tempo trabalhado × ${fmt(person?.hourly_rate)}/h`)
    : person?.salary_type === 'mixed' ? tr('Hours + job bonus (fixed part counted separately)', '時間 + 作業ボーナス（固定分は別）', 'Horas + bônus por job (parte fixa à parte)')
    : tr(`Job value × ${person?.job_bonus_rate || 100}%`, `作業金額 × ${person?.job_bonus_rate || 100}%`, `Valor do job × ${person?.job_bonus_rate || 100}%`)

  return (
    <div className="sp-overlay" style={{ zIndex: 2600 }} onClick={ev => { ev.stopPropagation(); onClose() }}>
      <section className="sp-modal is-admin" role="dialog" aria-modal="true" style={{ maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }} onClick={ev => ev.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>{tr('Salary details', '給与の内訳', 'Detalhes do salário')} · {person?.full_name} · {fmtPeriod(period)}</h3>
        <p className="pm-hint" style={{ margin: '0 0 12px' }}>{how}</p>

        <div className="pjd-stats">
          <div><b>{rows.length}</b><span>{tr('jobs', '件', 'jobs')}</span></div>
          <div><b>{days}</b><span>{tr('days', '日', 'dias')}</span></div>
          <div><b>{places}</b><span>{tr('places', '現場', 'locais')}</span></div>
          <div><b>{dur(totalMin)}</b><span>{tr('worked', '作業時間', 'trabalhado')}</span></div>
        </div>

        {rows.length === 0 && <p style={{ color: 'var(--text3)' }}>{tr('No completed jobs this month.', '今月の完了作業はありません。', 'Nenhum job concluído neste mês.')}</p>}

        <ul className="pjd-list">
          {rows.map(r => (
            <li key={r.id}>
              <div className="pjd-main">
                <div className="pjd-place">{r.place || r.title || '—'}</div>
                <div className="pjd-meta">
                  {fmtDay(r.date)}{r.time ? ` · ${r.time}` : ''}
                  {r.startedAt && r.completedAt ? ` · ${hm(r.startedAt)}–${hm(r.completedAt)}` : ''}
                  {` · ${dur(r.minutes)}`}
                  {r.category === 'spot' ? ' · Spot' : ''}
                </div>
                {r.client && r.client !== r.place && <div className="pjd-meta">👤 {r.client}</div>}
                {r.address && <div className="pjd-meta">📍 {r.address}</div>}
                {r.title && r.title !== r.place && <div className="pjd-meta pjd-title">{r.title.startsWith(`${r.place} — `) ? r.title.slice(r.place.length + 3) : r.title}</div>}
              </div>
              <div className="pjd-amt">
                {r.amount === null
                  ? <span className="pjd-muted">{used === 'per_job' ? tr('to be defined', '未定', 'a definir') : tr('in fixed', '固定給に含む', 'no fixo')}</span>
                  : <b>{fmt(r.amount)}</b>}
                {r.spot > 0 && <small>+{fmt(r.spot)} spot</small>}
              </div>
            </li>
          ))}
        </ul>

        <dl className="sp-rows" style={{ marginTop: 10 }}>
          <div><dt><b>{tr('Calculated salary (base)', '計算された給与（基本）', 'Salário calculado (base)')}</b></dt><dd className="sp-big">{fmt(calc?.base)}</dd></div>
          {calc?.jobsPay > 0 && <div><dt>{tr('Spot jobs', 'スポット', 'Jobs spot')}</dt><dd>+{fmt(calc.jobsPay)}</dd></div>}
        </dl>

        <div className="sp-actions">
          <button className="btn" onClick={onClose}>{tr('Close', '閉じる', 'Fechar')}</button>
        </div>
      </section>
    </div>
  )
}
