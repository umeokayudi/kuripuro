// v1.0.151 · Painel do Dia: counter by store → alerts of the day → team of today → stores of today.
// Same blocks on phone and computer (on the phone they stack in this same order; no data only on PC).
// The numbers come from lib/dayPanel (the same source as Reports, Agenda, Ao vivo and the bell).
import { JaFizButton } from './JaFizSheet'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { DayReportButton, QuickReportButton } from './QuickReport'
import { checkRows, filterRows, checkCounts, serviceCheck } from '../lib/dayCheck'
import JobQuickSheet from './JobQuickSheet'
import toast from 'react-hot-toast'
import { askConfirm } from './ConfirmDialog'
import { saveShiftMark, clearShiftMark } from '../lib/shiftMarks'
import { slotText } from '../lib/jobDuration'
import { shiftBadge, teamProgressText, teamLoadText, storeStateText, alertText, serviceLabel, plural } from '../lib/dayPanel'
import { hoursText } from '../lib/routePlan'
import { offerJob } from '../lib/assignOps'
import { savePlanB } from '../lib/routeSettings'
import { pendingChanged } from '../lib/adminPending'
import './dayPanel.css'

export const OPEN_BELL = 'kp-open-bell'
export const openBell = () => { try { window.dispatchEvent(new Event(OPEN_BELL)) } catch { /* SSR */ } }

// v1.0.195 · "Aguardando você hoje" opens Ao vivo (Live Track) focused on the person, or on the
// contract stores list (stores without job / late / without person) — not the bell.
export function liveTrackUrl(a) {
  const q = new URLSearchParams()
  if (a?.employeeId) q.set('emp', a.employeeId)
  else {
    q.set('focus', 'contracts')
    if (a?.stores?.length) q.set('stores', a.stores.join('|'))
  }
  return `/live?${q}`
}

const stop = e => e.stopPropagation()
const onKeyOpen = fn => e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); fn() } }

const STATE_CLS = { late: 'late', not_started: 'idle', working: 'working', done: 'done' }

export function DayCounter({ count, L, compact = false }) {
  return (
    <div className={`dp-counter${compact ? ' is-compact' : ''}`} role="group" aria-label={L('Stores of the day', '本日の店舗', 'Lojas do dia')}>
      <div className="dp-counter-main">
        <strong>{L(`${count.storesDone} of ${count.stores}`, `${count.stores}店舗中 ${count.storesDone}`, `${count.storesDone} de ${count.stores}`)}</strong>
        <span>{L(count.stores === 1 ? 'store done' : 'stores done', '店舗 完了', count.stores === 1 ? 'loja feita' : 'lojas feitas')}</span>
      </div>
      <div className="dp-counter-pills">
        <span className="dp-pill working">{L(`${count.storesWorking} in progress`, `作業中 ${count.storesWorking}`, `${count.storesWorking} em andamento`)}</span>
        <span className={`dp-pill late${count.storesLate ? '' : ' zero'}`}>{L(`${count.storesLate} late`, `遅れ ${count.storesLate}`, plural(count.storesLate, 'atrasada', 'atrasadas'))}</span>
        <span className="dp-pill idle">{L(`${count.storesNotStarted} not started`, `未開始 ${count.storesNotStarted}`, plural(count.storesNotStarted, 'não iniciada', 'não iniciadas'))}</span>
        <span className="dp-pill muted">{L(`${count.servicesDone} of ${count.services} services`, `${count.services}件中 ${count.servicesDone}件`, `${count.servicesDone} de ${plural(count.services, 'serviço', 'serviços')}`)}</span>
      </div>
    </div>
  )
}

export function StoreList({ stores, L, emptyText, actions = false, employees = [], onChanged }) {
  // v1.0.183 · tap anywhere on a store card → popup with each service, photos, checks and the report
  const [openKey, setOpenKey] = useState(null)
  if (!stores.length) return <div className="dp-empty">{emptyText || L('No store today', '本日の店舗なし', 'Nenhuma loja hoje')}</div>
  const openSt = stores.find(st => st.key === openKey)
  return (
    <>
    {openSt && <JobQuickSheet sheet={{ title: openSt.store, sub: storeStateText(openSt, L), by: 'store', services: openSt.services, empty: openSt.noJob ? storeStateText(openSt, L) : undefined }} onClose={() => setOpenKey(null)} L={L} actions={actions} onChanged={onChanged} />}
    <ul className="dp-stores">
      {stores.map(st => (
        <li key={st.key} className={`dp-store is-${STATE_CLS[st.state]} is-click`} role="button" tabIndex={0} onClick={() => setOpenKey(st.key)} onKeyDown={onKeyOpen(() => setOpenKey(st.key))}>
          <div className="dp-store-head">
            <strong className="dp-store-name">{st.store}</strong>
            {st.free && st.state !== 'done' ? <span className={`dp-chip ${st.freeOpen ? 'free' : 'late'}`}>{st.freeOpen ? L('Free', '空き', 'Livre') : L('NO COVER', '担当不在', 'SEM COBERTURA')}</span> : null}
            <span className={`dp-chip ${STATE_CLS[st.state]}`}>{{ late: L('Late', '遅れ', 'Atrasada'), not_started: L('Not started', '未開始', 'Não iniciada'), working: L('In progress', '作業中', 'Em andamento'), done: L('Done', '完了', 'Feita') }[st.state]}</span>
          </div>
          <div className="dp-store-state">{storeStateText(st, L)}{st.total > 1 ? ` · ${L(`${st.doneN} of ${st.total} services`, `${st.total}件中${st.doneN}件`, `${st.doneN} de ${st.total} serviços`)}` : ''}{st.covered ? ` · ${L('covered', 'カバー', 'coberta')}` : ''}</div>
          {st.showPlanB && <div className="dp-planb">{L(`plan B: ${st.planB.join(' → ')}`, `プランB: ${st.planB.join(' → ')}`, `plano B: ${st.planB.join(' → ')}`)}</div>}
          {st.services.length > 0 && (
            <ul className="dp-svcs">
              {st.services.map(s => (
                <li key={s.id}>
                  <span className="dp-svc-type">{serviceLabel(s.job, L)}</span>
                  <span className="dp-svc-who">{s.coveredBy ? L(`done by ${s.coveredBy} (was ${s.assigned})`, `${s.coveredBy}が実施（担当 ${s.assigned}）`, `feito por ${s.coveredBy} (era de ${s.assigned})`) : s.taken ? L(`with ${s.assigned} (took it)`, `${s.assigned}が担当（取得）`, `com ${s.assigned} (pegou)`) : s.assigned || (s.free ? L('free — nobody took it yet', '空き — まだ誰も取っていません', 'livre — ninguém pegou ainda') : L('nobody assigned', '担当なし', 'sem pessoa'))}</span>
                  {s.minutes ? <span className="dp-svc-h">{s.deadline ? `${hoursText(s.minutes)}${L(` · by ${s.deadline}`, ` · ${s.deadline}まで`, ` · até ${s.deadline}`)}` : s.time ? slotText(s.time, s.minutes, L) : hoursText(s.minutes)}</span> : null}
                  {s.uncovered && <span className="dp-tag bad">{L('no cover', '担当不在', 'sem cobertura')}</span>}
                  {s.retro && <span className="dp-tag retro" title={L('Registered afterwards, not live in the app', 'アプリで当日記録せず、後から登録', 'Registrado depois, não na hora pelo app')}>📝 {L('Retroactive', '事後', 'Retroativo')}</span>}
                  {actions && s.assignedId && (s.status === 'not_started' || s.status === 'late') && !s.startedAt && <span onClick={stop}><ReleaseBtn s={s} L={L} onChanged={onChanged} /></span>}
                  {actions && s.assignedId && (s.status === 'not_started' || s.status === 'late') && !s.startedAt && <span onClick={stop}><JaFizButton job={s.job} className="dp-svc-act" label={`✓ ${L('Already done', 'もう済んだ', 'Já fiz')}`} onDone={onChanged} /></span>}
                </li>
              ))}
            </ul>
          )}
          <div className="dp-store-open">{st.doneN > 0 ? L('Tap to see photos and the report ›', 'タップで写真と報告書 ›', 'Toque para ver fotos e relatório ›') : L('Tap for details ›', 'タップで詳細 ›', 'Toque para detalhes ›')}</div>
          {actions && st.state !== 'done' && <div onClick={stop}><PlanBEditor st={st} employees={employees} L={L} onChanged={onChanged} /></div>}
        </li>
      ))}
    </ul>
    </>
  )
}

// v1.0.154 · "Deixar livre": the job goes to the team; the first who takes it keeps it ("pegou, é meu").
function ReleaseBtn({ s, L, onChanged }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    const ok = await askConfirm({ title: L(`Free ${s.store} for the team?`, `${s.store}をチームに開放？`, `Deixar ${s.store} livre para a equipe?`), message: L(`${serviceLabel(s.job, L)} leaves ${s.assigned} and shows up for the team to take. The first who takes it keeps it.`, `${serviceLabel(s.job, L)}は${s.assigned}から外れ、チームが取れるようになります。最初に取った人が担当です。`, `${serviceLabel(s.job, L)} sai de ${s.assigned} e aparece para a equipe pegar. Quem pegar primeiro fica com ele.`), confirmLabel: L('Free it', '開放', 'Deixar livre') })
    if (!ok) return
    setBusy(true)
    try { await offerJob(s.job); toast.success(L('Free for the team', 'チームに開放しました', 'Livre para a equipe')); pendingChanged(); onChanged?.() } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return <button type="button" className="dp-svc-act" disabled={busy} onClick={run}>{L('Free it', '開放', 'Deixar livre')}</button>
}

// v1.0.154 · Plano B per store (1º and 2º reserve). Display only: the system never reassigns by itself.
function PlanBEditor({ st, employees, L, onChanged }) {
  const [open, setOpen] = useState(false)
  const ids0 = (employees || []).filter(e => st.planB?.includes(e.full_name)).map(e => e.id)
  const [ids, setIds] = useState(ids0)
  const [busy, setBusy] = useState(false)
  const people = (employees || []).filter(e => e.is_active !== false)
  if (!open) return <button type="button" className="dp-mark-toggle dp-planb-toggle" onClick={() => { setIds(ids0); setOpen(true) }}>{st.planB?.length ? L('Edit plan B', 'プランBを編集', 'Editar plano B') : L('Set plan B', 'プランBを設定', 'Definir plano B')}</button>
  const save = async () => {
    setBusy(true)
    try { await savePlanB(st.store, ids.filter(Boolean)); toast.success(L('Plan B saved', 'プランBを保存しました', 'Plano B salvo')); setOpen(false); onChanged?.() } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const sel = i => (
    <select value={ids[i] || ''} onChange={e => setIds(v => { const n = [...v]; n[i] = e.target.value; return n })} aria-label={i ? L('2nd reserve', '第2予備', '2º reserva') : L('1st reserve', '第1予備', '1º reserva')}>
      <option value="">{i ? L('2nd reserve —', '第2予備 —', '2º reserva —') : L('1st reserve —', '第1予備 —', '1º reserva —')}</option>
      {people.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
    </select>
  )
  return (
    <div className="dp-planb-edit">
      {sel(0)}{sel(1)}
      <button type="button" disabled={busy} onClick={save}>{L('Save', '保存', 'Salvar')}</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>{L('Close', '閉じる', 'Fechar')}</button>
      <small>{L('Display only — nothing is reassigned automatically.', '表示のみ — 自動で再割当しません。', 'Só exibição — o sistema não reatribui sozinho.')}</small>
    </div>
  )
}

const SECTION_TITLE = {
  morning: L => L('Morning route', '朝のルート', 'Rota da manhã'),
  deep: L => L('Deep of the day', '本日のディープ', 'Deep do dia'),
  other: L => L('Other services', 'その他の作業', 'Outros serviços'),
}
/** Stores of the day split by route: morning (deadline 10:00) · deep (own window) · others. */
export function RouteSections({ panel, L, actions = false, employees = [], onChanged }) {
  const r = panel.routes
  const parts = r ? ['morning', 'deep', 'other'].filter(b => r[b].stores.length) : []
  if (parts.length <= 1) return <StoreList stores={panel.stores} L={L} actions={actions} employees={employees} onChanged={onChanged} />
  return parts.map(b => {
    const c = r[b].count
    const sub = b === 'morning' ? L(`deadline ${r[b].deadline} · ${c.storesDone} of ${c.stores} stores · ${hoursText(r[b].minutes)} planned`, `期限 ${r[b].deadline} · ${c.stores}店舗中${c.storesDone} · 予定${hoursText(r[b].minutes)}`, `prazo ${r[b].deadline} · ${c.storesDone} de ${plural(c.stores, 'loja', 'lojas')} · ${hoursText(r[b].minutes)} previstas`)
      : b === 'deep' ? L(`own window (00:30 + planned hours, at least 10:00) · ${c.servicesDone} of ${c.services} · ${hoursText(r[b].minutes)} planned`, `独自の時間枠（00:30＋予定時間、最短10:00）· ${c.services}件中${c.servicesDone} · 予定${hoursText(r[b].minutes)}`, `janela própria (00:30 + horas previstas, no mínimo 10:00) · ${c.servicesDone} de ${plural(c.services, 'serviço', 'serviços')} · ${hoursText(r[b].minutes)} previstas`)
      : L(`${c.storesDone} of ${c.stores} stores`, `${c.stores}店舗中${c.storesDone}`, `${c.storesDone} de ${plural(c.stores, 'loja', 'lojas')}`)
    return (
      <div key={b} className={`dp-route dp-route-${b}`}>
        <div className="dp-route-head"><strong>{SECTION_TITLE[b](L)}</strong><span>{sub}</span></div>
        <StoreList stores={r[b].stores} L={L} actions={actions} employees={employees} onChanged={onChanged} />
      </div>
    )
  })
}

// admin can mark the day for the person — saved as the admin's mark (audited)
function AdminMark({ p, date, admin, L }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (kind) => {
    let reason = ''
    if (kind === 'off') {
      const r = await askConfirm({ title: L(`${p.name} can't work today?`, `${p.name}は本日不可？`, `${p.name} não pode hoje?`), message: L('Saved as the admin\'s mark. The jobs stay and show "no cover".', '管理者の記録として保存。作業は残り「担当不在」と表示。', 'Fica registrado como marca do admin. Os serviços ficam e aparecem "sem cobertura".'), reason: L('Reason (optional)', '理由（任意）', 'Motivo (opcional)'), reasonRequired: false, confirmLabel: L("Can't", '不可', 'Não pode') })
      if (!r) return
      reason = typeof r === 'string' ? r : ''
    }
    setBusy(true)
    try {
      if (kind === 'clear') await clearShiftMark(p.id, date)
      else await saveShiftMark({ employee: { id: p.id, name: p.name }, date, kind, reason, by: { name: admin || 'admin', role: 'admin' } })
      toast.success(L('Marked by the admin', '管理者が記録しました', 'Marcado pelo admin'))
      setOpen(false)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  if (!open) return <button type="button" className="dp-mark-toggle" onClick={() => setOpen(true)}>{L('Mark for them', '代理で記録', 'Marcar por ele')}</button>
  return (
    <div className="dp-mark">
      <button type="button" disabled={busy} onClick={() => run('confirmed')}>✅ {L('Confirmed', '確認', 'Confirmado')}</button>
      <button type="button" disabled={busy} onClick={() => run('off')}>✕ {L("Can't", '不可', 'Não pode')}</button>
      <button type="button" disabled={busy} onClick={() => run('extra')}>＋ {L('Extra', '追加', 'Extra')}</button>
      {p.mark && <button type="button" disabled={busy} onClick={() => run('clear')}>↺ {L('Remove mark', '取消', 'Tirar marca')}</button>}
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>{L('Close', '閉じる', 'Fechar')}</button>
    </div>
  )
}

export function TeamList({ team, L, date, admin }) {
  if (!team.length) return <div className="dp-empty">{L('No field staff', '現場スタッフなし', 'Nenhum funcionário de campo')}</div>
  return (
    <ul className="dp-team">
      {team.map(p => {
        const b = shiftBadge(p, L)
        return (
          <li key={p.id} className={p.late ? 'is-late' : ''}>
            <div className="dp-team-head">
              <strong>{p.name}</strong>
              <span className={`dp-shift ${b.cls}`}>{b.text}</span>
              {p.mark?.byRole === 'admin' && <span className="dp-first">{L('(by the admin)', '（管理者）', '(pelo admin)')}</span>}
              {date && <AdminMark p={p} date={date} admin={admin} L={L} />}
              {date && admin && p.total > 0 && <DayReportButton employeeId={p.id} employeeName={p.name} date={date} className="dp-mark-toggle" />}
            </div>
            <div className="dp-team-meta">
              {p.expected && p.state === 'unconfirmed' && !p.total && <span>{L('expected today', '本日 出勤予定', 'esperado hoje')} · </span>}
              <span className={p.late ? 'is-bad' : ''}>{teamProgressText(p, L)}</span>
              {(p.load?.morning || p.load?.deep) && <span className="dp-load"> · {teamLoadText(p, L)}</span>}
              {(p.load?.morning?.impossible || p.load?.deep?.impossible) && <span className="dp-tag bad">{L('impossible', '不可能', 'impossível')}</span>}
              <span className="dp-first">{p.firstStart ? L(` · 1st start ${p.firstStart}`, ` · 初回開始 ${p.firstStart}`, ` · 1º início ${p.firstStart}`) : p.total ? L(' · no start yet', ' · 未開始', ' · sem início') : ''}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------- v1.0.178 · "Conferir o dia": expandable rows per person or per store ----------
const LS_VIEW = 'kp_daycheck_view'
const LS_FILTER = 'kp_daycheck_filter'
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

const VERDICT_ICON = { ok: '✓', warn: '!', todo: '' }

function svcStateText(s, L) {
  if (s.status === 'working') return L(`In progress${s.startedAt ? ` since ${s.startedAt}` : ''}`, `作業中${s.startedAt ? ` ${s.startedAt}から` : ''}`, `Em andamento${s.startedAt ? ` desde ${s.startedAt}` : ''}`)
  if (s.status === 'late') return L(`Late${s.deadline ? ` · deadline ${s.deadline}` : ''}`, `遅れ${s.deadline ? ` · 期限 ${s.deadline}` : ''}`, `Atrasado${s.deadline ? ` · prazo ${s.deadline}` : ''}`)
  if (s.uncovered) return L('No cover', '担当不在', 'Sem cobertura')
  if (s.free) return L('Free — nobody took it yet', '空き — 未取得', 'Livre — ninguém pegou ainda')
  return L(`Not started${s.deadline ? ` · deadline ${s.deadline}` : s.time ? ` · ${s.time}` : ''}`, `未開始${s.deadline ? ` · 期限 ${s.deadline}` : s.time ? ` · ${s.time}` : ''}`, `Não iniciado${s.deadline ? ` · prazo ${s.deadline}` : s.time ? ` · ${s.time}` : ''}`)
}

function okSummary(checks, L) {
  const has = k => checks.some(c => c.key === k && c.state === 'ok')
  const parts = []
  if (has('before') || has('after')) parts.push(L('photos', '写真', 'fotos'))
  if (has('checklist')) parts.push('checklist')
  if (has('gps')) parts.push('GPS')
  const t = checks.find(c => c.key === 'time' && c.state === 'ok')
  return [parts.length ? L(`${parts.join(', ')} OK`, `${parts.join('・')} OK`, `${parts.join(', ')} ok`) : L('all OK', 'すべてOK', 'tudo certo'), t?.label].filter(Boolean).join(' · ')
}

const VERDICT_ORDER = { todo: 0, warn: 1, ok: 2 }

function ServiceCheckItem({ s, by, L, actions, onChanged, onOpen }) {
  const c = serviceCheck(s, L)
  const who = by === 'person' ? s.store : (s.coveredBy || s.assigned || L('nobody', '担当なし', 'sem pessoa'))
  const times = c.done && !s.coveredBy ? [s.startedAt, s.doneAt].filter(Boolean).join(' → ') : ''
  return (
    <li className={`dc-svc is-${c.verdict} is-click`} role="button" tabIndex={0} onClick={() => onOpen?.(s)} onKeyDown={onKeyOpen(() => onOpen?.(s))}>
      <div className="dc-svc-top">
        <span className={`dc-dot is-${c.verdict}`} aria-hidden="true">{VERDICT_ICON[c.verdict]}</span>
        <div className="dc-svc-main">
          <strong>{who}</strong>
          <span className="dc-svc-type">{serviceLabel(s.job, L)}{times ? ` · ${times}` : ''}</span>
        </div>
        {c.done && !s.coveredBy && <span onClick={stop}><QuickReportButton job={s.job} className="dc-report" label={L('Report', '報告書', 'Relatório')} /></span>}
        <span className="dc-open" aria-hidden="true">›</span>
      </div>
      {c.done
        ? (c.checks.length > 0 && <div className="dc-checks">{(c.verdict === 'ok' && !s.coveredBy
            // all right: one quiet line instead of five green chips (hover shows the list)
            ? [<span key="all" className="dc-check is-ok" title={c.checks.filter(k => k.state === 'ok').map(k => k.label).join(' · ')}>✓ {okSummary(c.checks, L)}</span>, ...c.checks.filter(k => k.state === 'info').map(k => <span key={k.key} className="dc-check is-info">{k.label}</span>)]
            : [...c.checks].sort((a, b) => (a.state === 'bad' ? 0 : 1) - (b.state === 'bad' ? 0 : 1)).map(k => <span key={k.key} className={`dc-check is-${k.state}`}>{k.state === 'ok' ? '✓ ' : k.state === 'bad' ? '✕ ' : ''}{k.label}</span>))}</div>)
        : <div className="dc-svc-state">{svcStateText(s, L)}</div>}
      {actions && !c.done && s.assignedId && (s.status === 'not_started' || s.status === 'late') && !s.startedAt && (
        <div className="dc-svc-acts" onClick={stop}>
          <ReleaseBtn s={s} L={L} onChanged={onChanged} />
          <JaFizButton job={s.job} className="dp-svc-act" label={`✓ ${L('Already done', 'もう済んだ', 'Já fiz')}`} onDone={onChanged} />
        </div>
      )}
    </li>
  )
}

function RowSummary({ r, L }) {
  if (r.kind === 'store' && r.store.noJob) return <span className="dc-sum"><span className="dc-pill todo">{L('no job', '作業なし', 'sem serviço')}</span></span>
  if (!r.total) return <span className="dc-sum"><span className="dc-pill none">{L('nothing today', '本日なし', 'nada hoje')}</span></span>
  const doneN = r.ok + r.warn
  return (
    <span className="dc-sum">
      <span className="dc-bar" aria-hidden="true"><i className="ok" style={{ width: `${(r.ok / r.total) * 100}%` }} /><i className="warn" style={{ width: `${(r.warn / r.total) * 100}%` }} /></span>
      <span className="dc-frac">{doneN}/{r.total}</span>
      {r.warn > 0 && <span className="dc-pill warn">! {r.warn}</span>}
      {r.todo > 0 && <span className="dc-pill todo">{L(`${r.todo} left`, `残り${r.todo}`, `falta ${r.todo}`)}</span>}
      {!r.warn && !r.todo && <span className="dc-pill ok">✓ {L('all OK', 'すべてOK', 'tudo certo')}</span>}
    </span>
  )
}

export function rowFooter(r, { L, date, admin, actions, employees, onChanged }) {
  const p = r.person
  if (r.kind === 'person') return (date && (admin || (r.ok + r.warn) > 0)) ? <div className="dc-foot">{(r.ok + r.warn) > 0 && <DayReportButton employeeId={p.id} employeeName={p.name} date={date} className="dc-report" label={L('Day report (all services)', '作業日報（全作業）', 'Relatório do dia (todos os serviços)')} />}{admin && <AdminMark p={p} date={date} admin={admin} L={L} />}</div> : null
  if (actions && r.store.state !== 'done') return <div className="dc-foot">{r.store.showPlanB && <span className="dp-planb">{L(`plan B: ${r.store.planB.join(' → ')}`, `プランB: ${r.store.planB.join(' → ')}`, `plano B: ${r.store.planB.join(' → ')}`)}</span>}<PlanBEditor st={r.store} employees={employees} L={L} onChanged={onChanged} /></div>
  return null
}

function CheckRow({ r, open, onToggle, onOpen, onOpenService, L, date, admin, actions, employees, onChanged }) {
  const p = r.person
  const sub = r.kind === 'person'
    ? (p.total ? [teamLoadText(p, L), p.firstStart ? L(`1st start ${p.firstStart}`, `初回開始 ${p.firstStart}`, `1º início ${p.firstStart}`) : ''].filter(Boolean).join(' · ') : teamProgressText(p, L))
    : storeStateText(r.store, L)
  const b = p ? shiftBadge(p, L) : null
  return (
    <li className={`dc-row is-${r.level}${open ? ' is-open' : ''}`}>
      <div className="dc-row-head">
        <button type="button" className="dc-chev-btn" aria-expanded={open} onClick={onToggle} aria-label={open ? L('Hide services', '作業を隠す', 'Esconder serviços') : L('Show services here', 'ここに作業を表示', 'Mostrar serviços aqui')}><span className="dc-chev" aria-hidden="true">›</span></button>
        <button type="button" className="dc-toggle" onClick={onOpen} title={L('Open details and reports', '詳細と報告書を開く', 'Abrir detalhes e relatórios')}>
          <span className="dc-title">
            <strong>{r.title}</strong>
            {b && b.cls !== 'ok' && <span className={`dp-shift ${b.cls}`}>{b.text}</span>}
            {sub && <small>{sub}</small>}
          </span>
          <RowSummary r={r} L={L} />
          <span className="dc-open" aria-hidden="true">›</span>
        </button>
        {r.kind === 'person' && date && (r.ok + r.warn) > 0 && <DayReportButton employeeId={p.id} employeeName={p.name} date={date} className="dc-report dc-report-day" label={L('Day report', '作業日報', 'Relatório do dia')} />}
      </div>
      {open && (
        <div className="dc-body">
          {r.rows.length > 0
            ? <ul className="dc-svcs">{[...r.rows].sort((a, b) => VERDICT_ORDER[a.c.verdict] - VERDICT_ORDER[b.c.verdict]).map(({ s }) => <ServiceCheckItem key={s.id} s={s} by={r.kind} L={L} actions={actions} onChanged={onChanged} onOpen={onOpenService} />)}</ul>
            : <div className="dp-empty">{r.kind === 'store' && r.store.noJob ? storeStateText(r.store, L) : teamProgressText(p, L)}</div>}
          {rowFooter(r, { L, date, admin, actions, employees, onChanged })}
        </div>
      )}
    </li>
  )
}

function sheetOf(key, rows, panel, ctx) {
  const { L } = ctx
  if (key.startsWith('svc:')) {
    const id = key.slice(4)
    const sv = (panel.stores || []).flatMap(st => st.services).find(x => String(x.id) === id)
    if (!sv) return { title: '—', services: [] }
    return { title: sv.store, sub: [sv.assigned, panel.date].filter(Boolean).join(' · '), by: 'store', services: [sv] }
  }
  const r = rows.find(x => `row:${x.key}` === key)
  if (!r) return { title: '—', services: [] }
  const sub = r.kind === 'person'
    ? [L(`${r.ok + r.warn} of ${r.total} done`, `${r.total}件中${r.ok + r.warn}件完了`, `${r.ok + r.warn} de ${r.total} feitos`), r.warn ? L(`${r.warn} to check`, `要確認${r.warn}`, `${r.warn} para conferir`) : '', r.todo ? L(`${r.todo} left`, `残り${r.todo}`, `falta ${r.todo}`) : ''].filter(Boolean).join(' · ')
    : storeStateText(r.store, L)
  return { title: r.title, sub, by: r.kind, services: r.rows.map(x => x.s), footer: rowFooter(r, ctx), empty: r.kind === 'store' && r.store.noJob ? storeStateText(r.store, L) : undefined }
}

export function DayCheck({ panel, L, admin, employees = [], onChanged }) {
  const [by, setBy] = useState(() => lsGet(LS_VIEW, 'person'))
  const [filter, setFilter] = useState(() => lsGet(LS_FILTER, 'all'))
  const [open, setOpen] = useState(() => new Set())
  const [sheetKey, setSheetKey] = useState(null) // 'row:<key>' | 'svc:<id>' — rebuilt from the live panel so it refreshes
  const rows = useMemo(() => checkRows(panel, by, L), [panel, by, L])
  const counts = checkCounts(rows)
  const shown = filterRows(rows, filter)
  const pickBy = v => { setBy(v); lsSet(LS_VIEW, v); setOpen(new Set()) }
  const pickF = v => { setFilter(v); lsSet(LS_FILTER, v) }
  const toggle = k => setOpen(o => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n })
  const openable = shown.filter(r => r.total || r.kind === 'store')
  const allOpen = openable.length > 0 && openable.every(r => open.has(r.key))
  const F = [
    ['all', L('All', 'すべて', 'Todos'), counts.total],
    ['todo', L('Not done', '未完了', 'Falta fazer'), counts.todo],
    ['warn', L('To check', '要確認', 'Conferir'), counts.warn],
    ['ok', L('OK', 'OK', 'Tudo certo'), counts.ok],
  ]
  return (
    <div className="dp-block dc">
      <div className="dc-bar-top">
        <div className="dc-seg" role="tablist" aria-label={L('Group by', '表示', 'Ver por')}>
          <button type="button" role="tab" aria-selected={by === 'person'} className={by === 'person' ? 'on' : ''} onClick={() => pickBy('person')}>👤 {L('By person', '人別', 'Por pessoa')}</button>
          <button type="button" role="tab" aria-selected={by === 'store'} className={by === 'store' ? 'on' : ''} onClick={() => pickBy('store')}>🏪 {L('By store', '店舗別', 'Por loja')}</button>
        </div>
        <button type="button" className="dc-all" onClick={() => setOpen(allOpen ? new Set() : new Set(openable.map(r => r.key)))}>{allOpen ? L('Close all', 'すべて閉じる', 'Fechar todos') : L('Open all', 'すべて開く', 'Abrir todos')}</button>
      </div>
      <div className="dc-filters" role="group" aria-label={L('Filter', '絞り込み', 'Filtrar')}>
        {F.map(([k, label, n]) => <button key={k} type="button" className={`dc-f is-${k}${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => pickF(k)}>{label} <b>{n}</b></button>)}
      </div>
      {shown.length === 0
        ? <div className="dp-empty">{filter === 'all' ? L('Nothing on this day', 'この日は何もありません', 'Nada neste dia') : L('Nothing here — try "All"', '該当なし —「すべて」を選んでください', 'Nada aqui — veja "Todos"')}</div>
        : <ul className="dc-rows">{shown.map(r => <CheckRow key={r.key} r={r} open={open.has(r.key)} onToggle={() => toggle(r.key)} onOpen={() => setSheetKey(`row:${r.key}`)} onOpenService={sv => setSheetKey(`svc:${sv.id}`)} L={L} date={panel.date} admin={admin} actions={!!admin} employees={employees} onChanged={onChanged} />)}</ul>}
      {sheetKey && <JobQuickSheet sheet={sheetOf(sheetKey, rows, panel, { L, date: panel.date, admin, actions: !!admin, employees, onChanged })} onClose={() => setSheetKey(null)} L={L} actions={!!admin} onChanged={onChanged} />}
      <p className="dc-legend"><span className="dc-dot is-ok">✓</span> {L('done right', '完了・問題なし', 'feito certo')} <span className="dc-dot is-warn">!</span> {L('done, check it', '完了・要確認', 'feito, conferir')} <span className="dc-dot is-todo" /> {L('not done yet', '未完了', 'não feito ainda')}</p>
    </div>
  )
}

function DayNav({ date, today, onDate, L, dateLabel }) {
  if (!onDate) return <p>{dateLabel}</p>
  const shift = n => { const d = new Date(`${date}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() + n); onDate(d.toISOString().slice(0, 10)) }
  const rel = date === today ? L('Today', '今日', 'Hoje') : (() => { const d = new Date(`${today}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) === date ? L('Yesterday', '昨日', 'Ontem') : '' })()
  return (
    <div className="dc-nav">
      <button type="button" className="dc-nav-btn" onClick={() => shift(-1)} aria-label={L('Previous day', '前の日', 'Dia anterior')}>‹</button>
      <span className="dc-nav-label">{rel && <b>{rel}</b>}{dateLabel}</span>
      <button type="button" className="dc-nav-btn" onClick={() => shift(1)} aria-label={L('Next day', '次の日', 'Próximo dia')}>›</button>
      {date !== today && <button type="button" className="dc-nav-today" onClick={() => onDate(today)}>{L('Today', '今日', 'Hoje')}</button>}
    </div>
  )
}

/** Full Painel do Dia. `alerts` default to the panel's own (same source as the bell). */
export default function DayPanelView({ panel, L, dateLabel, admin, employees = [], onChanged, date, today, onDate, loading = false }) {
  const navigate = useNavigate()
  const head = (
    <div className="dx-overview-head dc-head">
      <div><h2>{L('Day panel', '本日のパネル', 'Painel do Dia')}</h2><DayNav date={date || panel?.date} today={today} onDate={onDate} L={L} dateLabel={dateLabel} /></div>
    </div>
  )
  if (!panel || loading) return <section className="card dp-card">{head}<div className="dp-empty">{L('Loading the day…', '本日を読み込み中…', 'Carregando o dia…')}</div></section>
  return (
    <section className="card dp-card" aria-label={L('Day panel', '本日のパネル', 'Painel do Dia')}>
      {head}
      <DayCounter count={panel.count} L={L} />

      {panel.alerts.length > 0 && (
        <div className="dp-block">
          <h3>{L('Waiting for you today', '本日の確認待ち', 'Aguardando você hoje')} <span className="dp-n">{panel.alerts.length}</span></h3>
          <ul className="dp-alerts">
            {panel.alerts.map(a => (
              <li key={a.id} className={`is-${a.kind}`}>
                <span className="dp-alert-text">{alertText(a, L)}{a.stores?.length && a.kind !== 'late' ? <small>{a.stores.join(' · ')}</small> : null}</span>
                <button type="button" className="btn btn-sm" onClick={() => navigate(liveTrackUrl(a))}>{L('Open Live Track', 'ライブ追跡を開く', 'Abrir Live Track')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DayCheck panel={panel} L={L} admin={admin} employees={employees.length ? employees : panel.staff || []} onChanged={onChanged} />
    </section>
  )
}
