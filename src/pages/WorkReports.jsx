// v1.0.150 · Admin "作業報告書 / Relatórios de serviço": every report (draft, waiting for the
// office, sent to the client), new report from a job or from a client, open the editor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { useAuth } from '../hooks/useAuth'
import { listAllReports } from '../lib/workReport'
import WorkReportEditor from '../components/WorkReportEditor'
import WorkReportList from '../components/WorkReportList'
import PeriodReportEditor from '../components/PeriodReportEditor'
import { ReportViewerById } from '../components/QuickReport'
import '../components/work-report.css'

const lastMonth = () => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
export const monthRange = ym => { const [y, m] = ym.split('-').map(Number); return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` } }
const daysAgo = n => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

export default function WorkReports() {
  const { tr } = useLang()
  const { user } = useAuth()
  const location = useLocation()
  const [items, setItems] = useState(null)
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [status, setStatus] = useState('all')
  const [clientId, setClientId] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null) // { reportId?, job?, client? }
  const [period, setPeriod] = useState(null) // { reportId } or { client, from, to }
  const [viewing, setViewing] = useState(null) // v1.0.158 · id shown in the clean preview
  const [pClient, setPClient] = useState('')
  const [pMonth, setPMonth] = useState(lastMonth)
  const author = useMemo(() => ({ name: user?.name || '' }), [user?.name])

  const load = useCallback(async () => {
    try { setItems(await listAllReports()) } catch (e) { toast.error(String(e.message || e)); setItems([]) }
  }, [])

  useEffect(() => {
    load()
    supabase.from('jobs').select('id,title,client_id,client_name,employee_id,employee_name,scheduled_date,status,job_category,photo_start_url,photo_end_url,notes_employee,retro_report,description,instructions,checklist_missed_items')
      .gte('scheduled_date', daysAgo(45)).in('status', ['completed', 'in_progress']).order('scheduled_date', { ascending: false }).limit(300)
      .then(({ data }) => setJobs(data || []))
    supabase.from('clients').select('id,company_name,manager_name,contact_name,contact_person').order('company_name').then(({ data }) => setClients(data || []))
  }, [load])

  // Deep link: /work-reports?job=<id> or ?client=<id> or ?open=<reportId>
  useEffect(() => {
    const p = new URLSearchParams(location.search)
    if (p.get('open')) setOpen({ reportId: p.get('open') })
    if (p.get('period')) setPeriod({ reportId: p.get('period') })
    if (p.get('view')) setViewing(p.get('view'))
    if (p.get('list') === 'prontos') setStatus('prontos')
  }, [location.search])
  useEffect(() => {
    const p = new URLSearchParams(location.search)
    const jid = p.get('job')
    if (jid) {
      const job = jobs.find(j => j.id === jid)
      if (job) setOpen({ job })
      else supabase.from('jobs').select('*').eq('id', jid).maybeSingle().then(({ data }) => { if (data) setOpen({ job: data }) })
    }
    const cid = p.get('client')
    if (cid && clients.length) { const client = clients.find(c => c.id === cid); if (client) setOpen({ client }) }
  }, [location.search, jobs.length > 0, clients.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const withReport = useMemo(() => new Set((items || []).flatMap(s => [s.job_id, ...(s.job_ids || [])]).filter(Boolean)), [items])
  const pendingJobs = jobs.filter(j => !withReport.has(j.id))

  const shown = (items || []).filter(s => (status === 'all' || status === 'prontos' || s.status === status || (status === 'draft' && !s.status))
    && (!clientId || s.client_id === clientId)
    && (!q || `${s.title} ${s.client_name} ${s.location} ${s.created_by}`.toLowerCase().includes(q.toLowerCase())))
  const count = st => (items || []).filter(s => s.status === st).length
  const editOf = s => (s.kind === 'period' ? setPeriod({ reportId: s.id }) : setOpen({ reportId: s.id }))

  return (
    <div>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>📄 {tr('Service reports', '作業報告書', 'Relatórios de serviço')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {tr('Reports in the KuriPuro layout. The team adds photos during or after the job, the AI writes the text, you check and send — the client sees it with their login.',
          'KuriPuro形式の作業報告書。スタッフが作業中・作業後に写真を追加し、AIが文章を作成、確認して送付するとお客様のポータルに表示されます。',
          'Relatórios no padrão KuriPuro. A equipe põe fotos durante ou depois do serviço, a IA escreve o texto, você confere e envia — o cliente vê com o login dele.')}
      </p>

      <div className="wr-new">
        <div>
          <b>＋ {tr('From a service', '作業から作成', 'A partir de um serviço')}</b>
          <select value="" onChange={e => { const job = jobs.find(j => j.id === e.target.value); if (job) setOpen({ job }) }}>
            <option value="">{tr(`Choose a service (${pendingJobs.length} without report, last 45 days)`, `作業を選択（報告書なし${pendingJobs.length}件）`, `Escolha um serviço (${pendingJobs.length} sem relatório, últimos 45 dias)`)}</option>
            {pendingJobs.map(j => <option key={j.id} value={j.id}>{j.scheduled_date} · {j.title} · {j.employee_name || '—'}{j.job_category === 'spot' ? ' · spot' : ''}</option>)}
          </select>
        </div>
        <div>
          <b>＋ {tr('Client report of the month, by store', '月次・店舗別の報告書', 'Relatório do cliente do mês, por loja')}</b>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={pClient} onChange={e => setPClient(e.target.value)} style={{ flex: 1 }}>
              <option value="">{tr('Choose the client', '顧客を選択', 'Escolha o cliente')}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <input type="month" value={pMonth} onChange={e => setPMonth(e.target.value)} style={{ font: 'inherit', fontSize: 13, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 8 }} />
            <button type="button" className="btn btn-sm btn-primary" disabled={!pClient || !pMonth} onClick={() => setPeriod({ client: clients.find(c => c.id === pClient), ...monthRange(pMonth) })}>{tr('Build', '作成', 'Montar')}</button>
          </div>
          <small style={{ fontSize: 11.5, color: 'var(--text2)' }}>{tr('The system gathers the month\'s services and every photo/video, store by store.', '当月の作業と写真・動画を店舗ごとに自動で集めます。', 'O sistema junta os serviços do mês e todas as fotos/vídeos, loja por loja.')}</small>
        </div>
      </div>

      <div className="wr-filters">
        {[['prontos', tr('Ready', '作成済み', 'Prontos'), (items || []).length], ['all', tr('All', 'すべて', 'Todos'), (items || []).length], ['ready', tr('Waiting for office', '確認待ち', 'Esperando o escritório'), count('ready')], ['draft', tr('Drafts', '下書き', 'Rascunhos'), count('draft')], ['sent', tr('Sent', '送付済み', 'Enviados'), count('sent')]].map(([k, l, n]) => (
          <button key={k} type="button" className={`btn btn-sm ${status === k ? 'btn-primary' : ''}`} onClick={() => setStatus(k)}>{l} {n ? `(${n})` : ''}</button>
        ))}
        <select value={clientId} onChange={e => setClientId(e.target.value)} aria-label={tr('Client', '顧客', 'Cliente')}>
          <option value="">{tr('All clients', '全顧客', 'Todos os clientes')}</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Search', '検索', 'Buscar')} />
      </div>

      {items === null ? <p style={{ color: 'var(--text3)' }}>…</p> : status === 'prontos'
        ? <WorkReportList items={[...shown].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))} onView={s => setViewing(s.id)} onEdit={editOf} />
        : <WorkReportList items={shown} onOpen={editOf} />}
      {viewing && <ReportViewerById id={viewing} onClose={() => { setViewing(null); load() }} />}

      {period && <PeriodReportEditor {...period} author={author} onSaved={() => load()} onClose={() => { setPeriod(null); load() }} />}

      {open && (
        <WorkReportEditor {...open} role="admin" author={author}
          onSaved={() => load()}
          onClose={() => { setOpen(null); load() }} />
      )}
    </div>
  )
}
