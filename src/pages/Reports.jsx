import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { jobToServiceReport, fmtDuration, syncServiceReport, mergeReportWithJob, reportNeedsPhotoSync } from '../lib/jobReport'
import { viewablePhotoUrl } from '../lib/photoUrl'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import LineChart from '../components/charts/LineChart'
import BarChart from '../components/charts/BarChart'
import DonutChart from '../components/charts/DonutChart'
import { useLang, fill } from '../hooks/useLang'
import { apiPost } from '../lib/apiFetch'
import { tokyoToday } from '../lib/dates'
import { REPORT_PRESETS, rangeForPreset, invoiceDate } from '../lib/period'
import {
  yenFmt,
  filterInvoices,
  filterJobs,
  invoiceKpis,
  jobKpis,
  statusSlices,
  buildTimeBuckets,
  bucketGrain,
  revenueSeries,
  jobSeries,
  rankClients,
  rankStores,
  uniqueStores,
  uniqueServiceTypes,
  uniqueEmployees,
  clientInsight,
  previousWindow,
} from '../lib/reportAnalytics'
import { generateReportPdf } from '../lib/reportPdf'
import toast from 'react-hot-toast'

function typeBadge(type, tr) {
  return type === 'retroativo'
    ? <span className="badge badge-amber">{tr.typeRetro}</span>
    : <span className="badge badge-green">{tr.typeLive}</span>
}

function typeLabel(type, tr) {
  return type === 'retroativo' ? tr.typeRetro : tr.typeLive
}

function KpiCard({ icon, label, value, growth, hint }) {
  const dir = growth > 0 ? 'up' : growth < 0 ? 'down' : 'flat'
  return (
    <article className="rdash-kpi">
      <div className="rdash-kpi-top">
        <span className="rdash-kpi-icon" aria-hidden="true">{icon}</span>
        <span className="rdash-kpi-label">{label}</span>
      </div>
      <div className="rdash-kpi-val">{value}</div>
      {growth != null && (
        <div className={`rdash-kpi-delta ${dir}`}>
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●'} {growth > 0 ? '+' : ''}{growth}%
        </div>
      )}
      {hint ? <div className="rdash-kpi-hint">{hint}</div> : null}
    </article>
  )
}

function FilterFields({
  tr, p, dashSt, jobSt,
  preset, start, end, onPreset, onStart, onEnd,
  clientId, clients, onClient,
  store, stores, onStore,
  invStatus, onInvStatus,
  serviceType, types, onType,
  jobStatus, onJobStatus,
  employee, employees, onEmployee,
  showPeriod = true,
}) {
  return (
    <div className="rdash-fields">
      {showPeriod && (
        <label>
          {tr.period}
          <select value={preset} onChange={e => onPreset(e.target.value)}>
            {REPORT_PRESETS.map(k => (
              <option key={k} value={k}>{p[k] || tr[k] || k}</option>
            ))}
          </select>
        </label>
      )}
      {preset === 'custom' && (
        <>
          <label>
            {p.from}
            <input type="date" value={start} onChange={e => onStart(e.target.value)} />
          </label>
          <label>
            {p.to}
            <input type="date" value={end} onChange={e => onEnd(e.target.value)} />
          </label>
        </>
      )}
      <label>
        {tr.client}
        <select value={clientId} onChange={e => onClient(e.target.value)}>
          <option value="">{tr.allClients}</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
      </label>
      <label>
        {tr.store}
        <select value={store} onChange={e => onStore(e.target.value)}>
          <option value="">{tr.allStores}</option>
          {stores.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>
        {tr.invoiceStatus}
        <select value={invStatus} onChange={e => onInvStatus(e.target.value)}>
          <option value="all">{tr.allStatuses}</option>
          <option value="draft">{dashSt.draft}</option>
          <option value="sent">{dashSt.sent}</option>
          <option value="pending">{dashSt.pending}</option>
          <option value="paid">{dashSt.paid}</option>
          <option value="overdue">{tr.statusOverdue}</option>
          <option value="cancelled">{dashSt.cancelled}</option>
        </select>
      </label>
      <label>
        {tr.serviceType}
        <select value={serviceType} onChange={e => onType(e.target.value)}>
          <option value="all">{tr.allTypes}</option>
          {types.map(tp => <option key={tp} value={tp}>{tp}</option>)}
        </select>
      </label>
      <label>
        {tr.jobStatus}
        <select value={jobStatus} onChange={e => onJobStatus(e.target.value)}>
          <option value="all">{tr.allStatuses}</option>
          {['assigned', 'in_progress', 'completed', 'cancelled'].map(s => (
            <option key={s} value={s}>{jobSt[s] || s}</option>
          ))}
        </select>
      </label>
      <label>
        {tr.employee}
        <select value={employee || ''} onChange={e => onEmployee(e.target.value)}>
          <option value="">{tr.all}</option>
          {(employees || []).map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
  )
}

export default function Reports() {
  const { lang, t } = useLang()
  const tr = t.reports
  const p = t.period
  const dashSt = t.invoices.statuses
  const jobSt = t.status
  const today = tokyoToday()
  const initial = rangeForPreset('m12', today)

  const [preset, setPreset] = useState(initial.preset)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [clientId, setClientId] = useState('')
  const [store, setStore] = useState('')
  const [invStatus, setInvStatus] = useState('all')
  const [serviceType, setServiceType] = useState('all')
  const [jobStatus, setJobStatus] = useState('all')
  const [drawer, setDrawer] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const [invoices, setInvoices] = useState([])
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [dashLoading, setDashLoading] = useState(true)

  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [filterEmp, setFilterEmp] = useState('')
  const [aiAnalysis, setAiAnalysis] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [insightId, setInsightId] = useState('')
  const [rankMode, setRankMode] = useState('client')
  const [pdfBusy, setPdfBusy] = useState(false)

  const applyPreset = (k) => {
    if (k === 'custom') { setPreset('custom'); return }
    const r = rangeForPreset(k, tokyoToday())
    setPreset(r.preset)
    setStart(r.start)
    setEnd(r.end)
  }

  useEffect(() => { loadDash() }, [start, end])
  useEffect(() => { loadReports() }, [start, end, lang])

  const loadDash = async () => {
    setDashLoading(true)
    const prev = previousWindow(start, end)
    const loadStart = prev.start < start ? prev.start : start
    const [{ data: inv, error: invErr }, { data: jobRows, error: jobErr }, { data: cl }] = await Promise.all([
      supabase.from('faturas').select('*').limit(4000),
      supabase.from('jobs').select('*')
        .gte('scheduled_date', loadStart)
        .lte('scheduled_date', end)
        .limit(8000),
      supabase.from('clients').select('id,company_name').eq('is_active', true).order('company_name'),
    ])
    if (invErr) toast.error(invErr.message)
    if (jobErr) toast.error(jobErr.message)
    setInvoices(invErr ? [] : (inv || []))
    setJobs(jobErr ? [] : (jobRows || []))
    setClients(cl || [])
    setDashLoading(false)
  }

  const loadReports = async () => {
    setLoading(true)
    const sinceIso = `${start}T00:00:00.000Z`
    const [{ data: srData, error: srErr }, { data: jobRows, error: jobErr }] = await Promise.all([
      supabase.from('service_reports').select('*').gte('report_date', start).lte('report_date', end).order('created_at', { ascending: false }).limit(500),
      supabase.from('jobs').select('*').eq('status', 'completed').gte('completed_at', sinceIso).lte('completed_at', `${end}T23:59:59.999Z`).order('completed_at', { ascending: false }).limit(500),
    ])
    if (srErr && jobErr) {
      toast.error(jobErr.message || srErr.message)
      setReports([])
      setLoading(false)
      return
    }
    const jobsById = Object.fromEntries((jobRows || []).map(j => [j.id, j]))
    if (srData?.length) {
      let enriched = srData.map(r => mergeReportWithJob(r, jobsById[r.job_id], lang))
      const missingJobIds = srData.map(r => r.job_id).filter(id => id && !jobsById[id])
      if (missingJobIds.length) {
        const { data: extraJobs } = await supabase.from('jobs').select('*').in('id', missingJobIds)
        for (const job of extraJobs || []) jobsById[job.id] = job
        enriched = srData.map(r => mergeReportWithJob(r, jobsById[r.job_id], lang))
      }
      setReports(enriched)
      for (const r of srData) {
        const job = jobsById[r.job_id]
        if (job && reportNeedsPhotoSync(r, job)) syncServiceReport(supabase, job).catch(() => {})
      }
    } else {
      setReports((jobRows || []).map(j => jobToServiceReport(j, lang)))
      for (const j of jobRows || []) syncServiceReport(supabase, j).catch(() => {})
    }
    setLoading(false)
  }

  const prevRange = useMemo(() => previousWindow(start, end), [start, end])
  const filterOpts = useMemo(() => ({
    start,
    end,
    clientId: clientId || undefined,
    status: invStatus,
    today,
    store: store || undefined,
    serviceType,
    jobStatus,
    employee: filterEmp || undefined,
  }), [start, end, clientId, invStatus, today, store, serviceType, jobStatus, filterEmp])

  const currentInv = useMemo(() => filterInvoices(invoices, filterOpts), [invoices, filterOpts])
  const prevInv = useMemo(() => filterInvoices(invoices, { ...filterOpts, start: prevRange.start, end: prevRange.end }), [invoices, filterOpts, prevRange])
  const currentJobs = useMemo(() => filterJobs(jobs, filterOpts), [jobs, filterOpts])
  const prevJobs = useMemo(() => filterJobs(jobs, { ...filterOpts, start: prevRange.start, end: prevRange.end }), [jobs, filterOpts, prevRange])

  const ik = useMemo(() => invoiceKpis(currentInv, prevInv, today), [currentInv, prevInv, today])
  const jk = useMemo(() => jobKpis(currentJobs, prevJobs), [currentJobs, prevJobs])
  const grain = bucketGrain(start, end)
  const buckets = useMemo(() => buildTimeBuckets(start, end, grain), [start, end, grain])
  const revSeries = useMemo(() => revenueSeries(currentInv, buckets), [currentInv, buckets])
  const svcSeries = useMemo(() => jobSeries(currentJobs, buckets), [currentJobs, buckets])
  const clientRanking = useMemo(() => rankClients(currentInv, clients, 8), [currentInv, clients])
  const storeRanking = useMemo(() => rankStores(currentJobs, 8), [currentJobs])
  const ranking = rankMode === 'store' ? storeRanking : clientRanking
  const slices = useMemo(() => statusSlices(currentInv, today), [currentInv, today])
  const stores = useMemo(() => uniqueStores(jobs), [jobs])
  const types = useMemo(() => uniqueServiceTypes(jobs), [jobs])
  const staffNames = useMemo(() => uniqueEmployees(jobs), [jobs])
  const insight = useMemo(
    () => insightId ? clientInsight(insightId, currentInv, currentJobs, clients, { start, end }) : null,
    [insightId, currentInv, currentJobs, clients, start, end],
  )

  const employees = useMemo(() => [...new Set(reports.map(r => r.employee_name).filter(Boolean))].sort(), [reports])
  const filtered = useMemo(() => filterEmp ? reports.filter(r => r.employee_name === filterEmp) : reports, [reports, filterEmp])
  const stats = useMemo(() => {
    const withDur = filtered.filter(r => r.duration_min != null)
    const avg = withDur.length ? Math.round(withDur.reduce((s, r) => s + r.duration_min, 0) / withDur.length) : null
    const byEmp = {}
    withDur.forEach(r => {
      if (!byEmp[r.employee_name]) byEmp[r.employee_name] = []
      byEmp[r.employee_name].push(r.duration_min)
    })
    return { total: filtered.length, avg, byEmp }
  }, [filtered])

  const formatX = (pt) => {
    if (grain === 'month') return String(pt.key).slice(5)
    const d = String(pt.key).slice(5)
    return d
  }

  const clientName = clientId ? (clients.find(c => String(c.id) === String(clientId))?.company_name || tr.client) : tr.allClients
  const periodLabel = preset === 'custom' ? `${start} – ${end}` : (p[preset] || preset)
  const monthTitle = start.slice(0, 7) === end.slice(0, 7)
    ? (lang === 'ja' ? `${start.slice(0, 4)}年${Number(start.slice(5, 7))}月` : `${start.slice(0, 7).replace('-', '/')}`)
    : `${start} – ${end}`

  useEffect(() => {
    if (insightId) return
    const top = clientRanking[0]
    if (top?.id) setInsightId(String(top.id))
  }, [clientRanking, insightId])

  const emptyPeriod = !dashLoading && ik.billed === 0 && jk.services === 0
  const activeFilterN = [clientId, store, invStatus !== 'all' && invStatus, serviceType !== 'all' && serviceType, jobStatus !== 'all' && jobStatus, filterEmp].filter(Boolean).length

  const handleDelete = async (report) => {
    const label = `${report.employee_name} · ${report.client_name || report.job_title} · ${report.report_date}`
    if (!confirm(fill(tr.deleteConfirm, { label }))) return
    const { error: srErr } = await supabase.from('service_reports').delete().eq('job_id', report.job_id)
    if (srErr) { toast.error(srErr.message); return }
    setReports(prev => prev.filter(r => r.job_id !== report.job_id))
    if (selected?.job_id === report.job_id) setSelected(null)
    toast.success(tr.deleted)
  }

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiAnalysis('')
    try {
      const days = Math.max(1, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1)
      const resp = await apiPost('/api/analyze-reports', { days, employeeName: filterEmp || undefined, lang })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setAiAnalysis(data.analysis)
      toast.success(fill(tr.analysisReady, { count: data.count }))
    } catch (e) {
      toast.error(e.message)
    }
    setAiLoading(false)
  }

  const exportPdf = () => {
    setPdfBusy(true)
    try {
      const title = fill(tr.pdfTitle, { period: monthTitle, client: clientName })
      const doc = generateReportPdf({
        title,
        subtitle: `${start} – ${end}`,
        filtersLine: `${tr.period}: ${periodLabel} · ${tr.client}: ${clientName} · ${tr.invoiceStatus}: ${invStatus === 'all' ? tr.allStatuses : invStatus} · ${tr.store}: ${store || tr.allStores}`,
        kpis: [
          { label: tr.kpiBilled, value: yenFmt(ik.billed) },
          { label: tr.kpiReceived, value: yenFmt(ik.received) },
          { label: tr.kpiToCollect, value: yenFmt(ik.toCollect) },
          { label: tr.kpiOpen, value: yenFmt(ik.open) },
          { label: tr.kpiServices, value: String(jk.services) },
          { label: tr.kpiTicket, value: yenFmt(ik.ticket) },
          { label: tr.kpiGrowth, value: `${ik.billedGrowth > 0 ? '+' : ''}${ik.billedGrowth}%` },
        ],
        revenue: revSeries,
        ranking,
        services: svcSeries,
        slices: slices.map(s => ({ ...s, label: tr[`status${s.key[0].toUpperCase()}${s.key.slice(1)}`] || s.key })),
        invoices: currentInv.slice(0, 24).map(r => ({
          date: invoiceDate(r),
          client: r.client_name || clients.find(c => c.id === r.client_id)?.company_name,
          status: r.status,
          total: r.total,
        })),
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      })
      doc.save(`kuripuro-report-${start}-${end}.pdf`)
    } catch (e) {
      toast.error(e.message)
    }
    setPdfBusy(false)
  }

  const filterProps = {
    tr, p, dashSt, jobSt,
    preset, start, end, onPreset: applyPreset, onStart: (v) => { setPreset('custom'); setStart(v) }, onEnd: (v) => { setPreset('custom'); setEnd(v) },
    clientId, clients, onClient: (v) => { setClientId(v); if (v) setInsightId(v) },
    store, stores, onStore: setStore,
    invStatus, onInvStatus: setInvStatus,
    serviceType, types, onType: setServiceType,
    jobStatus, onJobStatus: setJobStatus,
    employee: filterEmp,
    employees: staffNames.length ? staffNames : employees,
    onEmployee: setFilterEmp,
  }

  return (
    <div className="rdash">
      <header className="rdash-head">
        <div>
          <h2>{tr.pageTitle}</h2>
          <p>{fill(tr.pageHint, { start, end })}</p>
        </div>
        <div className="rdash-head-actions">
          <button type="button" className="btn btn-sm" onClick={exportPdf} disabled={pdfBusy || dashLoading}>
            {pdfBusy ? tr.exporting : tr.exportPdf}
          </button>
          <button type="button" className="btn btn-sm btn-primary rdash-filter-btn" onClick={() => setDrawer(true)}>
            {tr.filters}{activeFilterN ? ` · ${activeFilterN}` : ''}
          </button>
        </div>
      </header>

      <div className="rdash-filter-bar">
        <div className="rdash-chips" role="tablist">
          {REPORT_PRESETS.filter(k => k !== 'custom').map(k => (
            <button key={k} type="button" className={`rdash-chip${preset === k ? ' on' : ''}`} onClick={() => applyPreset(k)}>
              {p[k] || tr[k] || k}
            </button>
          ))}
          <button type="button" className={`rdash-chip${preset === 'custom' ? ' on' : ''}`} onClick={() => applyPreset('custom')}>{p.custom}</button>
        </div>
        <div className="rdash-filter-desktop">
          <FilterFields {...filterProps} showPeriod={false} />
        </div>
      </div>

      {drawer && (
        <div className="rdash-drawer-bg" onClick={() => setDrawer(false)}>
          <div className="rdash-drawer" onClick={e => e.stopPropagation()}>
            <div className="rdash-drawer-head">
              <strong>{tr.filters}</strong>
              <button type="button" className="btn btn-sm" onClick={() => setDrawer(false)}>{tr.closeFilters}</button>
            </div>
            <FilterFields {...filterProps} />
            <button type="button" className="btn btn-primary rdash-drawer-apply" onClick={() => setDrawer(false)}>{tr.applyFilters}</button>
          </div>
        </div>
      )}

      {dashLoading ? (
        <div className="rdash-kpis" aria-busy="true">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="rdash-kpi rdash-skel" />)}
        </div>
      ) : (
        <div className="rdash-kpis">
          <KpiCard icon="¥" label={tr.kpiBilled} value={yenFmt(ik.billed)} growth={ik.billedGrowth} hint={p.vsPrev} />
          <KpiCard icon="↑" label={tr.kpiToCollect} value={yenFmt(ik.toCollect)} />
          <KpiCard icon="✓" label={tr.kpiReceived} value={yenFmt(ik.received)} growth={ik.receivedGrowth} hint={p.vsPrev} />
          <KpiCard icon="○" label={tr.kpiOpen} value={yenFmt(ik.open)} />
          <KpiCard icon="#" label={tr.kpiServices} value={jk.services} growth={jk.servicesGrowth} hint={p.vsPrev} />
          <KpiCard icon="⌀" label={tr.kpiTicket} value={yenFmt(ik.ticket)} growth={ik.ticketGrowth} hint={p.vsPrev} />
          <KpiCard icon="%" label={tr.kpiGrowth} value={`${ik.billedGrowth > 0 ? '+' : ''}${ik.billedGrowth}%`} hint={`${yenFmt(ik.billedPrev)} → ${yenFmt(ik.billed)}`} />
        </div>
      )}

      {emptyPeriod && (
        <div className="rdash-empty-cta">
          <p>{tr.emptyHint}</p>
          {preset !== 'm12' && (
            <button type="button" className="btn btn-primary" onClick={() => applyPreset('m12')}>{tr.use12m}</button>
          )}
        </div>
      )}

      <div className="rdash-charts">
        <section className="rdash-card">
          <h3>{tr.chartRevenue} <span>{tr[`grain${grain[0].toUpperCase()}${grain.slice(1)}`] || grain}</span></h3>
          <LineChart
            series={revSeries}
            formatY={yenFmt}
            formatX={formatX}
            formatCount={n => fill(tr.countN, { n })}
            empty={tr.emptyChart}
          />
        </section>
        <section className="rdash-card">
          <div className="rdash-card-head">
            <h3>{rankMode === 'store' ? tr.chartStores : tr.chartClients}</h3>
            <div className="rdash-rank-tabs" role="tablist">
              <button type="button" className={rankMode === 'client' ? 'on' : ''} onClick={() => setRankMode('client')}>{tr.rankClients}</button>
              <button type="button" className={rankMode === 'store' ? 'on' : ''} onClick={() => setRankMode('store')}>{tr.rankStores}</button>
            </div>
          </div>
          <BarChart
            rows={ranking}
            format={(v, r) => (r?.billed ? yenFmt(r.billed) : fill(tr.jobsN, { n: r?.count ?? v }))}
            empty={tr.emptyChart}
            onSelect={r => {
              if (rankMode === 'store') {
                setStore(r.name)
                if (r.clientId) setInsightId(String(r.clientId))
              } else {
                setClientId(String(r.id))
                setInsightId(String(r.id))
              }
              document.getElementById('rdash-client')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          />
        </section>
        <section className="rdash-card">
          <h3>{tr.chartServices}</h3>
          <LineChart
            series={svcSeries}
            formatY={n => String(n)}
            formatX={formatX}
            formatCount={n => fill(tr.countN, { n })}
            empty={tr.emptyChart}
          />
        </section>
        <section className="rdash-card">
          <h3>{tr.chartStatus}</h3>
          <DonutChart
            slices={slices}
            labels={{
              received: tr.statusReceived,
              pending: tr.statusPending,
              overdue: tr.statusOverdue,
              cancelled: tr.statusCancelled,
            }}
            format={yenFmt}
            empty={tr.emptyChart}
          />
        </section>
      </div>

      <section className="rdash-card" id="rdash-client">
        <h3>{tr.clientReport}</h3>
        <label className="rdash-pick">
          {tr.pickClient}
          <select value={insightId} onChange={e => setInsightId(e.target.value)}>
            <option value="">{tr.pickClient}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </label>
        {!insight && <div className="rdash-empty">{tr.pickClient}</div>}
        {insight && (
          <>
            <div className="rdash-client-kpis">
              <div><span>{tr.kpiBilled}</span><strong>{yenFmt(insight.billed)}</strong></div>
              <div><span>{tr.kpiServices}</span><strong>{insight.services}</strong></div>
              <div><span>{tr.kpiTicket}</span><strong>{yenFmt(insight.ticket)}</strong></div>
              <div><span>{tr.payments}</span><strong>{yenFmt(insight.received)}</strong></div>
              <div><span>{tr.kpiOpen}</span><strong>{yenFmt(insight.open)}</strong></div>
            </div>
            <h4>{tr.monthly}</h4>
            <LineChart series={insight.monthly} formatY={yenFmt} formatX={pt => String(pt.key).slice(5)} empty={tr.emptyChart} />
            <h4>{tr.lastInvoices}</h4>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{tr.colDate}</th><th>{tr.invoiceStatus}</th><th>{tr.value}</th></tr></thead>
                <tbody>
                  {insight.invoices.map(r => (
                    <tr key={r.id}><td>{invoiceDate(r)}</td><td>{r.status}</td><td>{yenFmt(r.total)}</td></tr>
                  ))}
                  {!insight.invoices.length && <tr><td colSpan={3}>{tr.emptyChart}</td></tr>}
                </tbody>
              </table>
            </div>
            <h4>{tr.lastJobs}</h4>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{tr.colDate}</th><th>{tr.colLocation}</th><th>{tr.value}</th></tr></thead>
                <tbody>
                  {insight.jobs.map(j => (
                    <tr key={j.id}><td>{j.scheduled_date}</td><td>{j.location_name || j.title}</td><td>{yenFmt(j.value || j.spot_value)}</td></tr>
                  ))}
                  {!insight.jobs.length && <tr><td colSpan={3}>{tr.emptyChart}</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="rdash-details-toggle">
        <button type="button" className="btn" onClick={() => setDetailsOpen(o => !o)}>
          {detailsOpen ? tr.hideDetails : tr.viewDetails}
        </button>
        <span>{tr.detailsHint}</span>
      </div>

      {detailsOpen && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.employee}</div>
              <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 160 }}>
                <option value="">{tr.all}</option>
                {employees.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn btn-primary" onClick={runAiAnalysis} disabled={aiLoading || !filtered.length}>
                {aiLoading ? tr.analyzing : tr.aiAnalyze}
              </button>
            </div>
          </div>

          <div className="grid-3" style={{ gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ margin: 0, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr.reports}</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stats.total}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr.avgTime}</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtDuration(stats.avg, lang)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{tr.employees}</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{Object.keys(stats.byEmp).length}</div>
            </div>
          </div>

          {aiAnalysis && (
            <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #c19c56' }}>
              <div className="card-title">{tr.aiTitle}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{aiAnalysis}</div>
            </div>
          )}

          <div className="card">
            <div className="card-title">{tr.serviceReports}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{tr.autoHint}</div>
            {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr.loading}</div>}
            {!loading && filtered.length === 0 && (
              <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr.empty}</div>
            )}
            {filtered.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{tr.colEmployee}</th>
                      <th>{tr.colLocation}</th>
                      <th>{tr.colDate}</th>
                      <th>{tr.colType}</th>
                      <th>{tr.colDuration}</th>
                      <th>{tr.colChecklist}</th>
                      <th>{tr.colAiPhoto}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <tr key={r.job_id}>
                        <td style={{ fontWeight: 500 }}>{r.employee_name}</td>
                        <td>{r.client_name || r.job_title}</td>
                        <td>{r.report_date}</td>
                        <td>{typeBadge(r.report_type, tr)}</td>
                        <td>{fmtDuration(r.duration_min, lang)}</td>
                        <td>{r.checklist_total ? `${r.checklist_done || 0}/${r.checklist_total}` : '—'}</td>
                        <td>
                          {r.photo_ai_score != null && <span style={{ marginRight: 6 }}>{r.photo_ai_score}/10</span>}
                          {(r.photo_after_url || r.photo_before_url) ? (
                            <JobPhotos
                              photoStartUrl={r.photo_before_url}
                              photoEndUrl={r.photo_after_url}
                              beforeLabel={tr.before}
                              afterLabel={tr.after}
                              size={44}
                              onPhotoClick={setLightbox}
                            />
                          ) : (r.photo_ai_score == null ? '—' : null)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-sm" onClick={() => setSelected(r)}>{tr.read}</button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r)}>{tr.delete}</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelected(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.job_title || selected.client_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{selected.employee_name} · {selected.report_date}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div className="grid-2" style={{ gap: 8, marginBottom: 14 }}>
              {[
                [tr.start, selected.time_in],
                [tr.end, selected.time_out],
                [tr.duration, fmtDuration(selected.duration_min, lang)],
                [tr.type, typeLabel(selected.report_type, tr)],
                [tr.checklist, selected.checklist_total ? `${selected.checklist_done}/${selected.checklist_total}` : '—'],
                [tr.value, selected.job_value ? `¥${Number(selected.job_value).toLocaleString()}` : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v || '—'}</div>
                </div>
              ))}
            </div>
            {selected.notes_out && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.employeeReport}</div>
                <div style={{ fontSize: 13, background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.5 }}>{selected.notes_out}</div>
              </div>
            )}
            {selected.retro_ai_summary && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{tr.aiRetro}</div>
                <div style={{ fontSize: 13, background: 'rgba(193,156,86,0.1)', borderRadius: 8, padding: '10px 12px' }}>{selected.retro_ai_summary}</div>
              </div>
            )}
            {selected.checklist_missed_items && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--red)' }}>{tr.missedItems}: {selected.checklist_missed_items}</div>
            )}
            {selected.photo_ai_issues && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text3)' }}>{tr.photoIssues}: {selected.photo_ai_issues}</div>
            )}
            {(selected.photo_before_url || selected.photo_after_url) && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{tr.servicePhotos}</div>
                <JobPhotos
                  photoStartUrl={selected.photo_before_url}
                  photoEndUrl={selected.photo_after_url}
                  beforeLabel={tr.before}
                  afterLabel={tr.after}
                  variant="full"
                  onPhotoClick={setLightbox}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {selected.photo_before_url && (
                    <a href={viewablePhotoUrl(selected.photo_before_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ flex: 1 }}>{tr.openFullscreen} ({tr.before})</a>
                  )}
                  {selected.photo_after_url && (
                    <a href={viewablePhotoUrl(selected.photo_after_url)} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ flex: 1 }}>{tr.openFullscreen} ({tr.after})</a>
                  )}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-danger" onClick={() => handleDelete(selected)}>🗑 {tr.deleteReport}</button>
            </div>
          </div>
        </div>
      )}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={tr.close} />
    </div>
  )
}
