import { useState, useEffect } from 'react'
import SkeletonRows from '../components/SkeletonRows'
import { supabase } from '../lib/supabase'
import { fetchEvaluatedIds, scoreOf, byScore } from '../lib/employeeScore'
import { isTestEmployee } from '../lib/testData'
import { useHideTests } from '../hooks/useHideTests'
import toast from 'react-hot-toast'
import { useLang, pickLang, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { locationNameFromTitle, getCleaningType } from '../lib/cleaningType'
import { jobDurationMin } from '../lib/workKpis'
import { categoryLabel, removeEvaluation } from '../lib/evaluations'
import EvaluationQuick from '../components/EvaluationQuick'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import './evaluations.css'

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`)

export default function Evaluations() {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const today = tokyoToday()
  const [tab, setTab] = useState('rate')
  const [employees, setEmployees] = useState([])
  const [jobs, setJobs] = useState([])
  const [evals, setEvals] = useState([])
  const [period, setPeriod] = useState('2d')
  const [who, setWho] = useState('')
  const [open, setOpen] = useState(null) // { jobId, type } or { free: true }
  const [filterEmp, setFilterEmp] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const [loading, setLoading] = useState(true)
  const [evaluated, setEvaluated] = useState(() => new Set())
  const [hideTests] = useHideTests()

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const since = addDays(today, -7)
    const [e, j, ev, scored] = await Promise.all([
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('id,title,description,employee_id,employee_name,scheduled_date,scheduled_time,started_at,completed_at,photo_start_url,photo_end_url,status')
        .eq('status', 'completed').gte('scheduled_date', since).order('scheduled_date', { ascending: false }).limit(300),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(200),
      fetchEvaluatedIds(),
    ])
    setEvaluated(scored)
    setEmployees(e.data || [])
    setJobs(j.data || [])
    setEvals(ev.data || [])
    setLoading(false)
  }

  const fromDate = period === 'today' ? today : period === '2d' ? addDays(today, -1) : addDays(today, -6)
  const evalByJob = new Map(evals.filter(e => e.job_id).map(e => [e.job_id, e]))
  const inRange = jobs.filter(j => j.scheduled_date >= fromDate && (!who || j.employee_id === who))
  const toRate = inRange.filter(j => !evalByJob.has(j.id))
  const rated = inRange.filter(j => evalByJob.has(j.id))
  const peopleWithJobs = employees.filter(e => jobs.some(j => j.employee_id === e.id && j.scheduled_date >= fromDate))
  const fmtDate = d => new Date(`${d}T12:00:00`).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })

  const afterSave = () => { setOpen(null); loadAll() }

  const undo = async (row) => {
    try { await removeEvaluation(row); toast(L('Evaluation removed', '削除しました', 'Avaliação removida')); loadAll() } catch (e) { toast.error(e.message) }
  }

  const filtered = filterEmp ? evals.filter(e => e.employee_id === filterEmp) : evals
  const starsText = n => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0))

  const renderJob = (j) => {
    const ev = evalByJob.get(j.id)
    const emp = employees.find(e => e.id === j.employee_id) || { id: j.employee_id, full_name: j.employee_name }
    const dur = jobDurationMin(j)
    const isOpen = open?.jobId === j.id
    return (
      <div key={j.id} className={`ev-job${isOpen ? ' open' : ''}`}>
        <div className="ev-job-row">
          <JobPhotos photoStartUrl={j.photo_start_url} photoEndUrl={j.photo_end_url} size={54} onPhotoClick={setLightbox}
            beforeLabel={L('Before', '前', 'Antes')} afterLabel={L('After', '後', 'Depois')} />
          <div className="ev-job-main">
            <div className="ev-job-title">
              {locationNameFromTitle(j.title)}
              {getCleaningType(j) === 'deep' && <span className="ev-deep">✨ {L('Deep', 'ディープ', 'Pesada')}</span>}
            </div>
            <div className="ev-job-sub">👤 {j.employee_name || '—'} · {fmtDate(j.scheduled_date)}{dur != null ? ` · ⏱ ${fmtMin(dur)}` : ''}</div>
          </div>
          {ev ? (
            <div className="ev-job-done">
              <span className={`ev-pill ${ev.type}`}>{ev.type === 'positive' ? '👍' : '👎'} {ev.points_change > 0 ? '+' : ''}{ev.points_change}</span>
              <button type="button" className="ev-x" onClick={() => undo(ev)} title={L('Remove', '削除', 'Remover')}>↺</button>
            </div>
          ) : (
            <div className="ev-job-btns">
              <button type="button" className={`ev-big good${isOpen && open.type === 'positive' ? ' on' : ''}`} onClick={() => setOpen(isOpen && open.type === 'positive' ? null : { jobId: j.id, type: 'positive' })} aria-label={L('Good', '良い', 'Bom')}>👍</button>
              <button type="button" className={`ev-big bad${isOpen && open.type === 'complaint' ? ' on' : ''}`} onClick={() => setOpen(isOpen && open.type === 'complaint' ? null : { jobId: j.id, type: 'complaint' })} aria-label={L('Problem', '問題', 'Problema')}>👎</button>
            </div>
          )}
        </div>
        {isOpen && (
          <EvaluationQuick key={`${j.id}-${open.type}`} employee={emp} job={j} initialType={open.type} onSaved={afterSave} onCancel={() => setOpen(null)} />
        )}
      </div>
    )
  }

  return (
    <div className="ev-page">
      <div className="tab-pills">
        <button className={`tab-pill${tab === 'rate' ? ' active' : ''}`} onClick={() => setTab('rate')}>
          👍 {L('Rate', '評価する', 'Avaliar')} {toRate.length > 0 && <span className="badge badge-amber" style={{ marginLeft: 4 }}>{toRate.length}</span>}
        </button>
        <button className={`tab-pill${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>{L('History', '履歴', 'Histórico')}</button>
        <button className={`tab-pill${tab === 'ranking' ? ' active' : ''}`} onClick={() => setTab('ranking')}>🏆 Ranking</button>
      </div>

      {tab === 'rate' && (
        <div>
          <div className="ev-intro">
            <div>
              <b>{L('Finished jobs', '完了した仕事', 'Serviços terminados')}</b>
              <span>{L('Tap 👍 or 👎 on each job', '各仕事で 👍 か 👎 をタップ', 'Toque 👍 ou 👎 em cada serviço')}</span>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(open?.free ? null : { free: true })}>
              + {L('Without a job', '仕事なしで評価', 'Sem serviço')}
            </button>
          </div>

          {open?.free && (
            <div className="ev-free">
              <EvaluationQuick employees={employees} onSaved={afterSave} onCancel={() => setOpen(null)} />
            </div>
          )}

          <div className="ev-filters">
            {[['today', L('Today', '今日', 'Hoje')], ['2d', L('Today + yesterday', '今日と昨日', 'Hoje e ontem')], ['7d', L('7 days', '7日間', '7 dias')]].map(([k, label]) => (
              <button key={k} type="button" className={`ev-chip${period === k ? ' on' : ''}`} onClick={() => setPeriod(k)}>{label}</button>
            ))}
            <select className="ev-select" value={who} onChange={e => setWho(e.target.value)}>
              <option value="">{L('Everyone', '全員', 'Todos')}</option>
              {peopleWithJobs.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {loading && <SkeletonRows rows={3} label={L('Loading…', '読み込み中…', 'Carregando…')} />}
          {!loading && toRate.length === 0 && (
            <div className="ev-empty">✅ {L('All finished jobs in this period are rated.', 'この期間の仕事はすべて評価済みです。', 'Todos os serviços deste período já foram avaliados.')}</div>
          )}
          {toRate.map(renderJob)}

          {rated.length > 0 && (
            <details className="ev-rated">
              <summary>{L('Already rated', '評価済み', 'Já avaliados')} ({rated.length})</summary>
              {rated.map(renderJob)}
            </details>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          <div className="ev-filters">
            <select className="ev-select" value={filterEmp} onChange={e => setFilterEmp(e.target.value)}>
              <option value="">{L('All employees', '全員', 'Todos os funcionários')}</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          {filtered.map(e => (
            <div key={e.id} className="ev-hist">
              <div className="ev-hist-main">
                <div className="ev-hist-name">{e.employee_name}</div>
                <div className="ev-job-sub">{e.eval_date}{e.job_title ? ` · ${locationNameFromTitle(e.job_title)}` : ''}</div>
                <div className="ev-hist-cat">{categoryLabel(e.category, lang)}</div>
                {e.description && <div className="ev-hist-note">{e.description}</div>}
              </div>
              <div className="ev-hist-side">
                <div className="ev-hist-stars">{starsText(e.stars)}</div>
                <span className={`ev-pill ${e.type}`}>{e.points_change > 0 ? '+' : ''}{e.points_change} pts</span>
                <button type="button" className="ev-x" onClick={() => undo(e)} title={L('Remove', '削除', 'Remover')}>🗑</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="ev-empty">{L('No evaluations yet.', '評価はまだありません。', 'Nenhuma avaliação ainda.')}</div>}
        </div>
      )}

      {tab === 'ranking' && (
        <div className="card">
          <div className="card-title">🏆 {L('Employee ranking', 'スタッフランキング', 'Ranking dos funcionários')}</div>
          {employees.filter(e => !hideTests || !isTestEmployee(e)).sort(byScore(evaluated)).map((e, i) => {
            const s = scoreOf(e, evaluated)
            const color = s == null ? 'var(--text3)' : s >= 90 ? 'var(--green)' : s >= 70 ? '#EF9F27' : 'var(--red)'
            return (
              <div key={e.id} className="ev-rank">
                <div className={`ev-rank-pos p${i}`}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{e.full_name}{isTestEmployee(e) && <span className="badge" style={{ marginLeft: 6 }}>TESTE</span>}</div>
                  <div className="ev-bar"><div style={{ width: `${s ?? 0}%`, background: color }} /></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{s ?? '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s == null ? L('not rated yet', '未評価', 'sem avaliação') : L('score', 'スコア', 'pontos')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={L('Close', '閉じる', 'Fechar')} />
    </div>
  )
}
