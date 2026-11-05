// v1.0.151 · Painel do Dia: counter by store → alerts of the day → team of today → stores of today.
// Same blocks on phone and computer (on the phone they stack in this same order; no data only on PC).
// The numbers come from lib/dayPanel (the same source as Reports, Agenda, Ao vivo and the bell).
import { JaFizButton } from './JaFizSheet'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { askConfirm } from './ConfirmDialog'
import { saveShiftMark, clearShiftMark } from '../lib/shiftMarks'
import { shiftBadge, teamProgressText, teamLoadText, storeStateText, alertText, serviceLabel, plural } from '../lib/dayPanel'
import { hoursText } from '../lib/routePlan'
import { offerJob } from '../lib/assignOps'
import { savePlanB } from '../lib/routeSettings'
import { pendingChanged } from '../lib/adminPending'
import './dayPanel.css'

export const OPEN_BELL = 'kp-open-bell'
export const openBell = () => { try { window.dispatchEvent(new Event(OPEN_BELL)) } catch { /* SSR */ } }

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
  if (!stores.length) return <div className="dp-empty">{emptyText || L('No store today', '本日の店舗なし', 'Nenhuma loja hoje')}</div>
  return (
    <ul className="dp-stores">
      {stores.map(st => (
        <li key={st.key} className={`dp-store is-${STATE_CLS[st.state]}`}>
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
                  {s.minutes ? <span className="dp-svc-h">{hoursText(s.minutes)}{s.deadline ? L(` · by ${s.deadline}`, ` · ${s.deadline}まで`, ` · até ${s.deadline}`) : ''}</span> : null}
                  {s.uncovered && <span className="dp-tag bad">{L('no cover', '担当不在', 'sem cobertura')}</span>}
                  {s.retro && <span className="dp-tag retro" title={L('Registered afterwards, not live in the app', 'アプリで当日記録せず、後から登録', 'Registrado depois, não na hora pelo app')}>📝 {L('Retroactive', '事後', 'Retroativo')}</span>}
                  {actions && s.assignedId && (s.status === 'not_started' || s.status === 'late') && !s.startedAt && <ReleaseBtn s={s} L={L} onChanged={onChanged} />}
                  {actions && s.assignedId && (s.status === 'not_started' || s.status === 'late') && !s.startedAt && <JaFizButton job={s.job} className="dp-svc-act" label={`✓ ${L('Already done', 'もう済んだ', 'Já fiz')}`} onDone={onChanged} />}
                </li>
              ))}
            </ul>
          )}
          {actions && st.state !== 'done' && <PlanBEditor st={st} employees={employees} L={L} onChanged={onChanged} />}
        </li>
      ))}
    </ul>
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

/** Full Painel do Dia. `alerts` default to the panel's own (same source as the bell). */
export default function DayPanelView({ panel, L, dateLabel, admin, employees = [], onChanged }) {
  if (!panel) return <section className="card dp-card"><div className="dp-empty">{L('Loading the day…', '本日を読み込み中…', 'Carregando o dia…')}</div></section>
  return (
    <section className="card dp-card" aria-label={L('Day panel', '本日のパネル', 'Painel do Dia')}>
      <div className="dx-overview-head">
        <div><h2>{L('Day panel', '本日のパネル', 'Painel do Dia')}</h2><p>{dateLabel}</p></div>
      </div>
      <DayCounter count={panel.count} L={L} />

      {panel.alerts.length > 0 && (
        <div className="dp-block">
          <h3>{L('Waiting for you today', '本日の確認待ち', 'Aguardando você hoje')} <span className="dp-n">{panel.alerts.length}</span></h3>
          <ul className="dp-alerts">
            {panel.alerts.map(a => (
              <li key={a.id} className={`is-${a.kind}`}>
                <span className="dp-alert-text">{alertText(a, L)}{a.stores?.length && a.kind !== 'late' ? <small>{a.stores.join(' · ')}</small> : null}</span>
                <button type="button" className="btn btn-sm" onClick={openBell}>{L('Open in the bell', 'ベルで開く', 'Abrir no sino')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dp-grid">
        <div className="dp-block">
          <h3>{L("Today's team", '本日のチーム', 'Equipe de hoje')} <span className="dp-n">{panel.team.length}</span></h3>
          <TeamList team={panel.team} L={L} date={panel.date} admin={admin} />
        </div>
        <div className="dp-block">
          <h3>{L("Today's stores", '本日の店舗', 'Lojas de hoje')} <span className="dp-n">{panel.stores.length}</span></h3>
          <p className="dp-hint">{L('Late → not started → in progress → done', '遅れ → 未開始 → 作業中 → 完了', 'Atrasadas → não iniciadas → em andamento → feitas')}</p>
          <RouteSections panel={panel} L={L} actions={!!admin} employees={employees.length ? employees : panel.staff || []} onChanged={onChanged} />
        </div>
      </div>
    </section>
  )
}
