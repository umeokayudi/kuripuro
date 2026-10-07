import React, { useMemo } from 'react'
import { useLang } from '../hooks/useLang'

const fmtYen = n => '¥' + Math.round(Number(n || 0)).toLocaleString('ja-JP')

function EmptyChart({ label }) {
  const { t } = useLang()
  return <div className="chart-empty">{label || t.executive?.noData || 'No data'}</div>
}

export function LineChart({ data = [], height = 180, valueFormatter = v => String(v), lineLabel = '' }) {
  const { t } = useLang()
  const values = data.map(d => Number(d.value || 0))
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const width = 640
  const padX = 18
  const padY = 18
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  if (!data.length) return <EmptyChart />

  const points = data.map((d, i) => {
    const x = data.length === 1 ? width / 2 : padX + (i / (data.length - 1)) * innerW
    const y = padY + innerH - ((Number(d.value || 0) - min) / range) * innerH
    return { ...d, x, y }
  })
  const path = points.map((p, i) => (i ? 'L' : 'M') + ' ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')
  const area = path + ' L ' + points[points.length - 1].x + ' ' + (height - padY) + ' L ' + points[0].x + ' ' + (height - padY) + ' Z'

  return (
    <div className="chart-line-wrap">
      <svg viewBox={'0 0 ' + width + ' ' + height} preserveAspectRatio="none" className="chart-svg" role="img" aria-label={lineLabel || t.executive?.lineChart || 'Line chart'}>
        <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} className="chart-axis" />
        <path d={area} className="chart-area" />
        <path d={path} className="chart-line" />
        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" className="chart-dot" />)}
      </svg>
      <div className="chart-xlabels">
        {data.map((d, i) => <span key={i}>{d.label}</span>)}
      </div>
      {data.length > 0 && (
        <div className="chart-end-value">
          <span>{lineLabel}</span>
          <strong>{valueFormatter(data[data.length - 1].value)}</strong>
        </div>
      )}
    </div>
  )
}

export function BarChart({ data = [], valueFormatter = v => String(v), colorClass = '' }) {
  if (!data.length) return <EmptyChart />
  const max = Math.max(...data.map(d => Number(d.value || 0)), 1)
  return (
    <div className={'chart-bars ' + colorClass}>
      {data.map((d, i) => {
        const value = Number(d.value || 0)
        const pct = Math.max(0, Math.min(100, (value / max) * 100))
        return (
          <div className="chart-bar-row" key={i}>
            <div className="chart-bar-meta">
              <span title={d.label}>{d.label}</span>
              <strong>{valueFormatter(value)}</strong>
            </div>
            <div className="chart-bar-track">
              <div className="chart-bar-fill" style={{ width: pct + '%' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function DonutChart({ data = [], centerLabel = '', centerValue = '' }) {
  const { t } = useLang()
  const total = data.reduce((s, d) => s + Number(d.value || 0), 0)
  const radius = 48
  const circumference = 2 * Math.PI * radius
  let offset = 0
  if (!data.length || total === 0) return <EmptyChart />
  return (
    <div className="chart-donut-wrap">
      <div className="chart-donut">
        <svg viewBox="0 0 120 120" className="chart-donut-svg" aria-label={t.executive?.donutChart || 'Donut chart'}>
          <circle cx="60" cy="60" r={radius} className="donut-track" />
          {data.map((d, i) => {
            const len = (Number(d.value || 0) / total) * circumference
            const node = (
              <circle key={i} cx="60" cy="60" r={radius}
                className={'donut-segment donut-segment-' + (i % 5)}
                strokeDasharray={len + ' ' + (circumference - len)}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return node
          })}
        </svg>
        <div className="donut-center">
          <strong>{centerValue || total}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="chart-legend">
        {data.map((d, i) => (
          <div className="chart-legend-item" key={i}>
            <span className={'legend-dot legend-dot-' + (i % 5)} />
            <span>{d.label}</span>
            <strong>{d.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExecutiveDashboard({ clients = [], monthJobs = [], todayJobs = [], employees = [], staleCount = 0, atRisk = [], deepProgress }) {
  const { t } = useLang()
  const d = t.executive || {}
  const financial = useMemo(() => {
    const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
    const cost = clients.reduce((s, c) => s + Number(c.monthly_cost || 0), 0)
    return { revenue, cost, profit: revenue - cost, margin: revenue ? ((revenue - cost) / revenue) * 100 : 0 }
  }, [clients])

  const trend = useMemo(() => {
    const byDay = {}
    monthJobs.forEach(j => {
      const date = (j.completed_at || j.scheduled_date || j.created_at || '').slice(0, 10)
      if (date) byDay[date] = (byDay[date] || 0) + 1
    })
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([date, value]) => ({
      label: date.slice(5).replace('-', '/'), value
    }))
  }, [monthJobs])

  const serviceTypes = useMemo(() => {
    const map = {}
    monthJobs.forEach(j => {
      const name = j.service_type || j.service_name || j.type || d.other
      map[name] = (map[name] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }))
  }, [monthJobs])

  const employeeLoad = useMemo(() => {
    const map = {}
    monthJobs.forEach(j => {
      const name = j.employee_name || d.unassigned
      map[name] = (map[name] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))
  }, [monthJobs])

  const attention = [
    staleCount > 0 && { level: 'warning', title: d.staleJobs, value: staleCount, text: d.jobsNeedAttention },
    atRisk.length > 0 && { level: 'danger', title: d.atRiskClients, value: atRisk.length, text: d.recentSatisfactionBelowTarget },
    deepProgress && deepProgress.totals && deepProgress.totals.expected > deepProgress.totals.completed && {
      level: 'info', title: d.deepCleanProgress, value: (deepProgress.totals.pct || 0) + '%', text: d.monthlyScheduledWorkRemains
    },
    todayJobs.filter(j => j.status === 'assigned').length > 0 && {
      level: 'neutral', title: d.assignedToday, value: todayJobs.filter(j => j.status === 'assigned').length, text: d.jobsWaitingToStart
    }
  ].filter(Boolean)

  const completedToday = todayJobs.filter(j => j.status === 'completed').length
  const assignedToday = todayJobs.filter(j => j.status === 'assigned').length
  const todayProgress = todayJobs.length ? Math.round((completedToday / todayJobs.length) * 100) : 0
  const profitTone = financial.profit >= 0 ? 'positive' : 'negative'
  const topClient = [...clients]
    .map(c => ({ name: c.company_name || d.client, profit: Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0) }))
    .sort((a,b) => b.profit - a.profit)[0]

  return (
    <section className="executive-section">
      <div className="section-heading-row">
        <div>
          <div className="eyebrow">{d.overview}</div>
          <h3>{d.now}</h3>
          <p>{d.quickDecision}</p>
        </div>
        <div className="executive-period"><span>{d.monthlyContractBase}</span><strong>{fmtYen(financial.revenue)}</strong></div>
      </div>

      <div className="executive-pulse">
        <div className="pulse-card pulse-primary">
          <span className="pulse-icon">¥</span>
          <div><small>{d.estimatedProfit}</small><strong>{fmtYen(financial.profit)}</strong><em>{d.margin.replace('{value}', financial.margin.toFixed(1))}</em></div>
        </div>
        <div className="pulse-card">
          <span className="pulse-icon">✓</span>
          <div><small>{d.todayCompleted}</small><strong>{completedToday}/{todayJobs.length}</strong><em>{d.agendaProgress.replace('{value}', todayProgress)}</em></div>
        </div>
        <div className="pulse-card">
          <span className="pulse-icon">!</span>
          <div><small>{d.needsAttention}</small><strong>{staleCount + atRisk.length + assignedToday}</strong><em>{d.waitingStart.replace('{value}', assignedToday)}</em></div>
        </div>
        <div className="pulse-card">
          <span className="pulse-icon">↗</span>
          <div><small>{d.topClient}</small><strong className="pulse-client">{topClient?.name || '—'}</strong><em>{topClient ? fmtYen(topClient.profit) : d.noData}</em></div>
        </div>
      </div>

      <div className="executive-grid executive-grid-main">
        <div className="card executive-card executive-wide">
          <div className="chart-card-head">
            <div><div className="card-title">{d.serviceVolume}</div><div className="chart-subtitle">{d.serviceVolumeSubtitle}</div></div>
            <span className="chart-kpi">{monthJobs.length} {d.jobs}</span>
          </div>
          <LineChart data={trend} lineLabel={d.latestDay} />
        </div>

        <div className="card executive-card">
          <div className="chart-card-head"><div><div className="card-title">{d.financialSnapshot}</div><div className="chart-subtitle">{d.currentContractBase}</div></div></div>
          <div className="financial-stack">
            <div><span>{d.revenue}</span><strong>{fmtYen(financial.revenue)}</strong></div>
            <div><span>{d.estimatedCost}</span><strong>{fmtYen(financial.cost)}</strong></div>
            <div className="financial-profit"><span>{d.profit}</span><strong>{fmtYen(financial.profit)}</strong></div>
            <div><span>{d.marginLabel}</span><strong>{financial.margin.toFixed(1)}%</strong></div>
          </div>
        </div>
      </div>

      <div className="executive-grid">
        <div className="card executive-card">
          <div className="chart-card-head"><div><div className="card-title">{d.serviceMix}</div><div className="chart-subtitle">{d.topServiceCategories}</div></div></div>
          <DonutChart data={serviceTypes} centerLabel={d.jobs} centerValue={monthJobs.length} />
        </div>

        <div className="card executive-card">
          <div className="chart-card-head"><div><div className="card-title">{d.teamWorkload}</div><div className="chart-subtitle">{d.jobsByEmployee}</div></div><span className="chart-kpi">{employees.length} {d.people}</span></div>
          <BarChart data={employeeLoad} valueFormatter={v => v + ' ' + d.jobs} />
        </div>

        <div className="card executive-card">
          <div className="chart-card-head"><div><div className="card-title">{d.attention}</div><div className="chart-subtitle">{d.thingsWorthChecking}</div></div></div>
          {attention.length === 0 ? (
            <div className="executive-ok"><span>✓</span><div><strong>{d.everythingOnTrack}</strong><p>{d.noMajorAlerts}</p></div></div>
          ) : (
            <div className="attention-list">
              {attention.map((item, i) => (
                <div className={'attention-item attention-' + item.level} key={i}>
                  <div className="attention-value">{item.value}</div>
                  <div><strong>{item.title}</strong><p>{item.text}</p></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card executive-card client-profit-card">
        <div className="chart-card-head"><div><div className="card-title">{d.clientProfitability}</div><div className="chart-subtitle">{d.highestContribution}</div></div></div>
        <BarChart
          data={[...clients].map(c => ({
            label: c.company_name || 'Client',
            value: Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)
          })).sort((a, b) => b.value - a.value).slice(0, 8)}
          valueFormatter={fmtYen}
        />
      </div>
    </section>
  )
}


export function ReportsAnalytics({ reports = [] }) {
  const byDay = useMemo(() => {
    const map = {}
    reports.forEach(r => {
      const d = r.report_date || ''
      if (d) map[d] = (map[d] || 0) + 1
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([label, value]) => ({ label: label.slice(5), value }))
  }, [reports])

  const byEmployee = useMemo(() => {
    const map = {}
    reports.forEach(r => {
      const name = r.employee_name || 'Unassigned'
      map[name] = (map[name] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))
  }, [reports])

  const byType = useMemo(() => {
    const map = {}
    reports.forEach(r => {
      const name = r.report_type === 'retroativo' ? d.retroactive : d.live
      map[name] = (map[name] || 0) + 1
    })
    return Object.entries(map).map(([label, value]) => ({ label, value }))
  }, [reports])

  return (
    <div className="reports-visual-grid">
      <div className="card executive-card reports-chart-wide">
        <div className="chart-card-head">
          <div><div className="card-title">{d.serviceReports}</div><div className="chart-subtitle">{d.serviceReportsSubtitle}</div></div>
          <span className="chart-kpi">{reports.length} {d.reports}</span>
        </div>
        <LineChart data={byDay} lineLabel={d.latestDay} />
      </div>
      <div className="card executive-card">
        <div className="chart-card-head"><div><div className="card-title">{d.reportType}</div><div className="chart-subtitle">{d.liveVsRetroactive}</div></div></div>
        <DonutChart data={byType} centerLabel={d.reports} centerValue={reports.length} />
      </div>
      <div className="card executive-card reports-chart-wide">
        <div className="chart-card-head"><div><div className="card-title">{d.productivity}</div><div className="chart-subtitle">{d.reportsByEmployee}</div></div></div>
        <BarChart data={byEmployee} valueFormatter={v => v + ' ' + d.reports} />
      </div>
    </div>
  )
}
