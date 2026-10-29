import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import {
  SCHEDULE_ROUTES, buildMonthSchedule, assignEmployees, availabilityIndex, jobsToRows,
  locationsFromContracts, DEFAULT_LOCATIONS, DOW_EN, DOW_JA,
} from '../lib/scheduleGenerator'
import {
  periodDays, canWork, outOfSchedule, contractTargets, coverage, dupKey, clockSeq, rowIssues, dowOf, isTestAccount,
} from '../lib/schedulePlan'

// v1.0.97 · Three steps only: 1) period (day / week / month) → 2) editable preview, one job per line
// → 3) generate the ticked lines. Routes are templates that fill the preview; "usually done by" is only
// the first suggestion of each line. Existing jobs are never duplicated, and every active contract
// visit is either in the preview or listed as missing with a button to add it.

const OWNERS_KEY = 'kp_schedule_route_owners'
function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
const nextMonth = () => {
  const [y, m] = tokyoToday().slice(0, 7).split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
const defaultTime = t => (t.kind === 'weekly' ? (/atomic/i.test(t.base) ? '21:00' : '00:30') : '09:00')

export default function ScheduleGenerator() {
  const { lang, tr } = useLang()
  const dateLocale = localeOf(lang)
  const dowLabels = tr(DOW_EN, DOW_JA, ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'])

  // ---- step 1: period ----
  const [kind, setKind] = useState('week')
  const [anchor, setAnchor] = useState(tokyoToday)
  const [month, setMonth] = useState(nextMonth)
  const [templates, setTemplates] = useState(() => new Set(SCHEDULE_ROUTES.map(r => r.key)))
  const [owners, setOwners] = useState(() => readStored(OWNERS_KEY, {}))
  const days = useMemo(() => periodDays(kind, anchor, month), [kind, anchor, month])
  const wholeMonth = kind === 'month'

  // ---- data ----
  const [employees, setEmployees] = useState([])
  const [contracts, setContracts] = useState([])
  const [clients, setClients] = useState([])
  const [existing, setExisting] = useState([])
  const [availRows, setAvailRows] = useState([])
  const [loaded, setLoaded] = useState(false)

  // ---- step 2: preview ----
  const [rows, setRows] = useState([])
  const [forced, setForced] = useState(() => new Set())
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*').order('full_name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
      supabase.from('clients').select('id,company_name,is_active'),
    ]).then(([e, c, cl]) => {
      setEmployees((e.data || []).map(({ password, pin, ...rest }) => rest))
      setContracts(c.data || [])
      setClients(cl.data || [])
    })
  }, [])

  const loadPeriod = async () => {
    setLoaded(false)
    const [ex, av] = await Promise.all([
      supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,employee_id,status')
        .gte('scheduled_date', days[0]).lte('scheduled_date', days[days.length - 1]).neq('status', 'cancelled').limit(3000),
      supabase.from('employee_availability').select('employee_id,date,kind,status')
        .gte('date', days[0]).lte('date', days[days.length - 1]),
    ])
    setExisting(ex.data || [])
    setAvailRows(av.data || [])
    setLoaded(true)
  }
  useEffect(() => { setResult(null); loadPeriod() }, [days[0], days[days.length - 1]])

  const empById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])
  const availability = useMemo(() => availabilityIndex(availRows), [availRows])
  const targets = useMemo(() => contractTargets(contracts, clients), [contracts, clients])
  const locations = useMemo(() => (contracts.length ? locationsFromContracts(contracts) : DEFAULT_LOCATIONS), [contracts])
  const existingKeys = useMemo(() => new Set(existing.map(j => dupKey(j.scheduled_date, j.title))), [existing])

  // Who can take work on each day: availability marks + weekdays of employees.work_days (+ forced).
  const workIndex = useMemo(() => {
    const idx = { ...availability }
    for (const e of employees) for (const d of days) {
      const st = canWork(e, d, availability, forced)
      if (!st.ok) idx[`${e.id}|${d}`] = { kind: 'off', status: 'approved' }
    }
    return idx
  }, [employees, days, availability, forced])
  const pool = useMemo(() => employees.filter(e => days.some(d => canWork(e, d, availability, forced).ok)), [employees, days, availability, forced])

  // Fill the preview from the templates, leaving out what already exists.
  const buildRows = () => {
    if (!employees.length) return
    const inRange = new Set(days)
    const months = [...new Set(days.map(d => d.slice(0, 7)))]
    const routes = SCHEDULE_ROUTES.filter(r => templates.has(r.key))
    const base = months.flatMap((m, mi) => buildMonthSchedule(m, { routes, locations }).map(j => ({ ...j, id: mi * 100000 + Number(j.id) })))
      .filter(j => inRange.has(j.date))
    const suggested = {}
    for (const [k, v] of Object.entries(owners)) if (v && pool.some(e => e.id === v)) suggested[k] = v
    const seen = new Set(existingKeys)
    const next = []
    for (const j of assignEmployees(base, { employees: pool, availability: workIndex, owners: suggested })) {
      const k = dupKey(j.date, j.title)
      if (seen.has(k)) continue
      seen.add(k)
      next.push({ ...j, key: `t${j.id}`, checked: true, source: 'template' })
    }
    setRows(next)
  }
  useEffect(() => { if (loaded) buildRows() }, [loaded, employees, locations, templates, owners])

  const skippedExisting = useMemo(() => {
    if (!loaded) return 0
    const inRange = new Set(days)
    const months = [...new Set(days.map(d => d.slice(0, 7)))]
    const routes = SCHEDULE_ROUTES.filter(r => templates.has(r.key))
    return months.flatMap(m => buildMonthSchedule(m, { routes, locations })).filter(j => inRange.has(j.date) && existingKeys.has(dupKey(j.date, j.title))).length
  }, [loaded, days, templates, locations, existingKeys])

  const edit = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const setPerson = (key, id) => {
    const emp = empById[id]
    edit(key, { employeeId: id || null, employee: emp ? emp.full_name.split(' ')[0] : '', employeeName: emp?.full_name || null, assignReason: 'manual' })
  }

  // Coverage of the active contracts: existing jobs + ticked lines.
  const cov = useMemo(() => coverage(targets, days, [
    ...existing.map(j => ({ date: j.scheduled_date, title: j.title })),
    ...rows.filter(r => r.checked).map(r => ({ date: r.date, title: r.title })),
  ], { wholeMonth }), [targets, days, existing, rows, wholeMonth])

  const addMissing = (m) => {
    const existingRow = rows.find(r => !r.checked && r.date === m.date && dupKey(r.date, r.title) === dupKey(m.date, `${m.target.base} — ${m.target.service}`))
    if (existingRow) { edit(existingRow.key, { checked: true }); return }
    const free = pool.find(e => canWork(e, m.date, availability, forced).ok && !rows.some(r => r.checked && r.date === m.date && r.employeeId === e.id))
      || pool.find(e => canWork(e, m.date, availability, forced).ok)
    const emp = free || null
    setRows(rs => [...rs, {
      key: `c${m.target.id}|${m.date}`, id: `c${m.target.id}|${m.date}`, date: m.date, time: defaultTime(m.target),
      title: `${m.target.base} — ${m.target.service}`, client: m.target.clientName, clientId: m.target.clientId,
      address: m.target.address || null, description: null, routeKey: 'contract', type: /deep/i.test(m.target.service) ? 'deep' : 'basic',
      category: m.target.kind === 'weekly' ? 'regular' : 'maintenance', value: m.target.price || null, seq: 1,
      employeeId: emp?.id || null, employee: emp ? emp.full_name.split(' ')[0] : '', employeeName: emp?.full_name || null,
      assignReason: 'contract', checked: true, source: 'contract',
    }].sort((a, b) => a.date.localeCompare(b.date) || String(a.time).localeCompare(String(b.time))))
  }

  const out = useMemo(() => outOfSchedule(employees, days, availability, forced), [employees, days, availability, forced])
  const ctx = { empById, availability, forced, rows }
  const issuesOf = r => (r.checked ? rowIssues(r, ctx) : [])
  const checked = rows.filter(r => r.checked)
  const problemCount = checked.filter(r => issuesOf(r).length).length

  const reasonText = {
    inactive: tr('inactive', '退職', 'inativo'),
    test: tr('test account', 'テスト用', 'conta de teste'),
    role: tr('role without cleaning', '清掃なしの役割', 'sem papel compatível'),
    unavailable: tr('unavailable in the period', '期間中に勤務不可', 'indisponível no período'),
    off: tr('day off', '休み', 'folga'),
    weekday: tr('does not work this weekday', 'この曜日は勤務なし', 'não trabalha nesse dia da semana'),
    nobody: tr('no person', '担当なし', 'sem pessoa'),
    forced: tr('included anyway', '例外で追加', 'incluído mesmo assim'),
    sameTime: tr('same time as another job', '他の作業と同時刻', 'mesmo horário de outro job'),
    unknown: tr('unknown person', '不明', 'pessoa desconhecida'),
  }

  // ---- step 3: generate ----
  const generate = async () => {
    if (!checked.length) return
    setBusy(true)
    // Read again right before writing: a job created meanwhile is skipped, never copied.
    const { data: now } = await supabase.from('jobs').select('title,scheduled_date')
      .gte('scheduled_date', days[0]).lte('scheduled_date', days[days.length - 1]).neq('status', 'cancelled').limit(3000)
    const taken = new Set((now || []).map(j => dupKey(j.scheduled_date, j.title)))
    const toCreate = []
    let dup = 0
    for (const r of checked) {
      const k = dupKey(r.date, r.title)
      if (taken.has(k)) { dup++; continue }
      taken.add(k)
      toCreate.push(r)
    }
    const seq = clockSeq(toCreate)
    const payload = jobsToRows(toCreate.map(r => ({ ...r, seq: seq.get(r.key) })))
    let created = 0
    let failed = 0
    let error = null
    for (let i = 0; i < payload.length; i += 50) {
      const part = payload.slice(i, i + 50)
      const { error: err } = await supabase.from('jobs').insert(part)
      if (err) { failed += part.length; error = err.message } else created += part.length
    }
    setBusy(false)
    setResult({
      created, dup, failed, error,
      unticked: rows.length - checked.length,
      nobody: toCreate.filter(r => !r.employeeId).length,
      flagged: toCreate.filter(r => rowIssues(r, ctx).some(i => i.kind !== 'nobody')).length,
    })
    if (created) toast.success(tr(`${created} jobs created`, `${created}件を作成`, `${created} jobs criados`))
    if (error) toast.error(error)
    await loadPeriod()
  }

  // ---- view helpers ----
  const fmtDay = d => `${dowLabels[dowOf(d)]} ${new Date(d + 'T12:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}`
  const periodLabel = days.length === 1 ? fmtDay(days[0]) : `${fmtDay(days[0])} → ${fmtDay(days[days.length - 1])}`
  const visible = onlyProblems ? rows.filter(r => issuesOf(r).length) : rows
  const byDate = {}
  visible.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r) })
  const stepStyle = n => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'var(--accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 800, marginRight: 8, flex: '0 0 auto' })
  const peopleFor = date => {
    const ok = employees.filter(e => canWork(e, date, availability, forced).ok)
    const no = employees.filter(e => !ok.includes(e) && e.is_active !== false && !isTestAccount(e))
    return { ok, no }
  }

  const CoverageBox = ({ compact }) => (
    <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${cov.missing.length ? '#ef4444' : '#16a34a'}` }}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        {cov.missing.length ? '⚠️' : '✅'} {tr('Were all services scheduled?', 'すべての作業が予定されましたか？', 'Todos os serviços foram programados?')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: cov.missing.length ? 10 : 0 }}>
        {cov.clients.map(c => (
          <span key={c.name} style={{ fontSize: 13, fontWeight: 700, padding: '6px 10px', borderRadius: 8, background: c.done === c.total ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)', color: c.done === c.total ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }}>
            {c.name}: {tr(`${c.done} of ${c.total} places scheduled`, `${c.total}か所中${c.done}か所`, `${c.done} de ${c.total} locais programados`)}
          </span>
        ))}
      </div>
      {cov.missing.length > 0 && (
        <div style={{ display: 'grid', gap: 4, maxHeight: compact ? 160 : 260, overflowY: 'auto' }}>
          {cov.missing.map(m => (
            <div key={`${m.target.id}|${m.date}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <b>{m.target.location}</b> · {m.periodic ? tr('once this month', '今月1回', '1x no mês') : fmtDay(m.date)}
                <span style={{ color: 'var(--text3)' }}> — {m.periodic
                  ? tr('periodic service with no job this month', '今月の作業なし（定期）', 'serviço periódico sem job no mês')
                  : rows.some(r => !r.checked && r.date === m.date && dupKey(r.date, r.title) === dupKey(m.date, `${m.target.base} — ${m.target.service}`))
                    ? tr('unticked in the preview', 'プレビューで除外', 'desmarcado na prévia')
                    : tr('not in any template', 'どのテンプレートにもない', 'não está em nenhum modelo')}</span>
              </span>
              <button type="button" className="btn btn-sm" onClick={() => addMissing(m)}>+ {tr('Add to preview', 'プレビューに追加', 'Incluir na prévia')}</button>
            </div>
          ))}
        </div>
      )}
      {!compact && !wholeMonth && targets.some(t => t.kind === 'periodic') && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>{tr('Periodic services (deep / maintenance) are checked when the period is a whole month.', '定期作業（ディープ・メンテ）は月単位で確認します。', 'Serviços periódicos (deep / manutenção) são conferidos quando o período é o mês inteiro.')}</div>
      )}
      {!compact && cov.noDays.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
          {tr(`${cov.noDays.length} active contracts have no days set and are not scheduled automatically: `, `曜日未設定の契約 ${cov.noDays.length}件（自動では予定されません）: `, `${cov.noDays.length} contratos ativos sem dias definidos não entram na escala automática: `)}
          {cov.noDays.map(t => t.location).join(', ')}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* STEP 1 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center' }}><span style={stepStyle(1)}>1</span>{tr('Choose the period', '期間を選ぶ', 'Escolha o período')}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="tab-pills" style={{ margin: 0 }}>
            {[['day', tr('Day', '日', 'Dia')], ['week', tr('Week', '週', 'Semana')], ['month', tr('Month', '月', 'Mês')]].map(([k, l]) => (
              <button key={k} type="button" className={`tab-pill${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          {kind === 'month'
            ? <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} style={{ maxWidth: 200 }} />
            : <input type="date" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} style={{ maxWidth: 200 }} />}
          <b style={{ fontSize: 14 }}>{periodLabel}</b>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{tr('Templates that fill the preview (the person is only a suggestion, change it on each line):', 'プレビューを埋めるテンプレート（担当者は提案のみ。行ごとに変更可）:', 'Modelos que preenchem a prévia (a pessoa é só sugestão, troque em cada linha):')}</div>
          {SCHEDULE_ROUTES.map(r => (
            <div key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: '1 1 260px', cursor: 'pointer' }}>
                <input type="checkbox" checked={templates.has(r.key)} onChange={() => setTemplates(s => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n })} />
                <span><b>{r.label}</b> <span style={{ color: 'var(--text3)' }}>· {r.detail}</span></span>
              </label>
              <select value={owners[r.key] || ''} style={{ fontSize: 12, padding: '4px 8px', maxWidth: 220 }}
                onChange={e => { const next = { ...owners, [r.key]: e.target.value || undefined }; if (!e.target.value) delete next[r.key]; setOwners(next); writeStored(OWNERS_KEY, next) }}>
                <option value="">{tr('Usually done by: automatic', '通常の担当: 自動', 'Normalmente faz: automático')}</option>
                {pool.map(e => <option key={e.id} value={e.id}>{tr('Usually done by: ', '通常の担当: ', 'Normalmente faz: ')}{e.full_name}</option>)}
              </select>
            </div>
          ))}
        </div>
        {loaded && (
          <div style={{ marginTop: 12, fontSize: 13, padding: '8px 12px', borderRadius: 8, background: existing.length ? 'rgba(251,191,36,0.12)' : 'var(--surface2)' }}>
            {existing.length
              ? tr(`${existing.length} jobs already exist in this period. The preview shows only what is missing (${skippedExisting} template jobs left out because they exist). Nothing is ever duplicated.`,
                `この期間には既に${existing.length}件あります。プレビューは不足分のみ（既存のため${skippedExisting}件を除外）。重複は作成しません。`,
                `Já existem ${existing.length} jobs neste período. A prévia mostra só o que falta (${skippedExisting} jobs dos modelos ficaram de fora porque já existem). Nada é duplicado.`)
              : tr('No jobs in this period yet.', 'この期間の作業はまだありません。', 'Ainda não há jobs neste período.')}
          </div>
        )}
      </div>

      {result && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #16a34a' }}>
          <div className="card-title">✅ {tr('Done', '完了', 'Pronto')}</div>
          <div style={{ fontSize: 14, display: 'grid', gap: 4 }}>
            <div><b>{result.created}</b> {tr('jobs created, in clock order of each person’s day.', '件作成（各自の一日の時刻順）。', 'jobs criados, na ordem do relógio do dia de cada pessoa.')}</div>
            {result.dup > 0 && <div>{result.dup} {tr('skipped: already existed.', '件スキップ：既に存在。', 'pulados: já existiam.')}</div>}
            {result.unticked > 0 && <div>{result.unticked} {tr('skipped: unticked in the preview.', '件スキップ：プレビューで除外。', 'pulados: desmarcados na prévia.')}</div>}
            {result.failed > 0 && <div style={{ color: 'var(--red, #dc2626)' }}>{result.failed} {tr('not saved:', '件保存失敗:', 'não salvos:')} {result.error}</div>}
            {result.nobody > 0 && <div style={{ color: '#b45309' }}>⚠️ {result.nobody} {tr('created without a person — assign them in the Agenda.', '件は担当なしで作成 — アジェンダで割り当ててください。', 'criados sem pessoa — atribua na Agenda.')}</div>}
            {result.flagged > 0 && <div style={{ color: '#b45309' }}>⚠️ {result.flagged} {tr('created with a warning (day off / outside the schedule).', '件は警告付きで作成（休み・対象外）。', 'criados com aviso (folga / fora da escala).')}</div>}
          </div>
        </div>
      )}

      {loaded && <CoverageBox />}

      {out.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">🚫 {tr('Outside the schedule', 'スケジュール対象外', 'Fora da escala')}</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {out.map(({ emp, reason }) => (
              <div key={emp.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: '1 1 auto' }}><b>{emp.full_name}</b> <span style={{ color: 'var(--text3)' }}>— {reasonText[reason]}</span></span>
                <button type="button" className="btn btn-sm" onClick={() => setForced(s => new Set(s).add(emp.id))}>{tr('Include anyway', '例外で追加', 'Incluir mesmo assim')}</button>
              </div>
            ))}
          </div>
          {forced.size > 0 && (
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
              ⚠️ {tr('Included anyway:', '例外で追加:', 'Incluídos mesmo assim:')} {[...forced].map(id => empById[id]?.full_name).join(', ')}{' '}
              <button type="button" className="btn btn-sm" onClick={() => setForced(new Set())}>{tr('Undo', '元に戻す', 'Desfazer')}</button>
            </div>
          )}
        </div>
      )}

      {/* STEP 2 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center' }}><span style={stepStyle(2)}>2</span>{tr('Review the preview', 'プレビューを確認', 'Revise a prévia')}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)' }}>{checked.length} / {rows.length} {tr('ticked', '選択', 'marcados')}{problemCount ? ` · ⚠️ ${problemCount} ${tr('with a problem', '件に問題', 'com problema')}` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" className="btn btn-sm" onClick={() => setRows(rs => rs.map(r => ({ ...r, checked: true })))}>{tr('Tick all', 'すべて選択', 'Marcar todos')}</button>
          <button type="button" className="btn btn-sm" onClick={() => setRows(rs => rs.map(r => ({ ...r, checked: false })))}>{tr('Untick all', 'すべて解除', 'Desmarcar todos')}</button>
          <button type="button" className={`btn btn-sm${onlyProblems ? ' btn-primary' : ''}`} onClick={() => setOnlyProblems(v => !v)}>⚠️ {tr('Only lines with a problem', '問題のある行のみ', 'Só linhas com problema')}</button>
        </div>
        {!loaded && <div style={{ color: 'var(--text3)' }}>{tr('Loading…', '読み込み中…', 'Carregando…')}</div>}
        {loaded && rows.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr('Nothing to create: everything in the templates already exists in this period.', '作成するものはありません（テンプレートの作業はすべて存在）。', 'Nada a criar: tudo dos modelos já existe neste período.')}</div>}
        <div style={{ display: 'grid', gap: 10 }}>
          {Object.keys(byDate).sort().map(date => (
            <div key={date}>
              <div style={{ fontSize: 12, fontWeight: 800, color: dowOf(date) === 0 ? 'var(--red, #dc2626)' : 'var(--text2)', margin: '4px 0', position: 'sticky', top: 0, background: 'var(--surface, #fff)', zIndex: 1, padding: '4px 0' }}>
                {fmtDay(date)} · {byDate[date].filter(r => r.checked).length} {tr('jobs', '件', 'jobs')}
              </div>
              {byDate[date].map(r => {
                const issues = issuesOf(r)
                const { ok, no } = peopleFor(date)
                return (
                  <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 4px', borderBottom: '1px solid var(--border)', fontSize: 13, opacity: r.checked ? 1 : 0.45, background: issues.length ? 'rgba(245,158,11,0.07)' : 'transparent' }}>
                    <input type="checkbox" checked={r.checked} onChange={() => edit(r.key, { checked: !r.checked })} aria-label={tr('Create this job', 'この作業を作成', 'Criar este job')} />
                    <input type="time" value={r.time || ''} onChange={e => edit(r.key, { time: e.target.value })} style={{ fontSize: 13, padding: '3px 6px', width: 100 }} aria-label={tr('Time', '時刻', 'Horário')} />
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <b>{r.title.split(' — ')[0]}</b>
                      <span style={{ color: 'var(--text3)' }}> · {r.title.split(' — ')[1] || ''} · {r.client}</span>
                    </span>
                    <select value={r.employeeId || ''} onChange={e => setPerson(r.key, e.target.value)} style={{ fontSize: 13, padding: '3px 6px', maxWidth: 230, fontWeight: 600 }} aria-label={tr('Person', '担当', 'Pessoa')}>
                      <option value="">— {reasonText.nobody} —</option>
                      <optgroup label={tr('Available', '勤務可', 'Disponíveis')}>
                        {ok.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                      </optgroup>
                      {no.length > 0 && (
                        <optgroup label={tr('Not available (warning)', '勤務不可（警告）', 'Indisponíveis (com aviso)')}>
                          {no.map(e => <option key={e.id} value={e.id}>{e.full_name} ({reasonText[canWork(e, date, availability, forced).reason]})</option>)}
                        </optgroup>
                      )}
                    </select>
                    {issues.map(i => (
                      <span key={i.kind} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: i.kind === 'nobody' || i.kind === 'off' ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.16)', color: i.kind === 'nobody' || i.kind === 'off' ? 'var(--red, #dc2626)' : '#b45309' }}>
                        ⚠️ {reasonText[i.kind] || i.kind}
                      </span>
                    ))}
                    {r.source === 'contract' && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{tr('added from contract', '契約から追加', 'incluído do contrato')}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {loaded && rows.length > 20 && <CoverageBox compact />}

      {/* STEP 3 */}
      <div style={{ position: 'sticky', bottom: 0, zIndex: 5, background: 'var(--surface, #fff)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 -6px 20px rgba(0,0,0,0.08)' }}>
        <span style={{ display: 'flex', alignItems: 'center', fontWeight: 700 }}><span style={stepStyle(3)}>3</span>{tr('Generate', '作成', 'Gerar')}</span>
        <span style={{ fontSize: 13, color: 'var(--text3)', flex: '1 1 200px' }}>
          {cov.missing.length
            ? `⚠️ ${tr(`${cov.missing.length} contract visits still missing (see the list above)`, `契約の訪問 ${cov.missing.length}件が未予定（上の一覧）`, `${cov.missing.length} visitas de contrato ainda faltando (veja a lista acima)`)}`
            : `✅ ${tr('All contract services are scheduled', '契約の作業はすべて予定済み', 'Todos os serviços de contrato estão programados')}`}
        </span>
        <button className="btn btn-primary" disabled={busy || !checked.length} onClick={generate}>
          {busy ? tr('Creating…', '作成中…', 'Criando…') : `✅ ${tr(`Generate ${checked.length} ticked jobs`, `選択した${checked.length}件を作成`, `Gerar ${checked.length} jobs marcados`)}`}
        </button>
      </div>
    </div>
  )
}
