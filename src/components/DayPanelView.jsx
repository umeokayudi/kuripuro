// v1.0.151 · Painel do Dia: counter by store → alerts of the day → team of today → stores of today.
// Same blocks on phone and computer (on the phone they stack in this same order; no data only on PC).
// The numbers come from lib/dayPanel (the same source as Reports, Agenda, Ao vivo and the bell).
import { useState } from 'react'
import toast from 'react-hot-toast'
import { askConfirm } from './ConfirmDialog'
import { saveShiftMark, clearShiftMark } from '../lib/shiftMarks'
import { shiftBadge, teamProgressText, storeStateText, alertText, serviceLabel, plural } from '../lib/dayPanel'
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

export function StoreList({ stores, L, emptyText }) {
  if (!stores.length) return <div className="dp-empty">{emptyText || L('No store today', '本日の店舗なし', 'Nenhuma loja hoje')}</div>
  return (
    <ul className="dp-stores">
      {stores.map(st => (
        <li key={st.key} className={`dp-store is-${STATE_CLS[st.state]}`}>
          <div className="dp-store-head">
            <strong className="dp-store-name">{st.store}</strong>
            <span className={`dp-chip ${STATE_CLS[st.state]}`}>{{ late: L('Late', '遅れ', 'Atrasada'), not_started: L('Not started', '未開始', 'Não iniciada'), working: L('In progress', '作業中', 'Em andamento'), done: L('Done', '完了', 'Feita') }[st.state]}</span>
          </div>
          <div className="dp-store-state">{storeStateText(st, L)}{st.total > 1 ? ` · ${L(`${st.doneN} of ${st.total} services`, `${st.total}件中${st.doneN}件`, `${st.doneN} de ${st.total} serviços`)}` : ''}{st.covered ? ` · ${L('covered', 'カバー', 'coberta')}` : ''}</div>
          {st.services.length > 0 && (
            <ul className="dp-svcs">
              {st.services.map(s => (
                <li key={s.id}>
                  <span className="dp-svc-type">{serviceLabel(s.job, L)}</span>
                  <span className="dp-svc-who">{s.coveredBy ? L(`done by ${s.coveredBy} (was ${s.assigned})`, `${s.coveredBy}が実施（担当 ${s.assigned}）`, `feito por ${s.coveredBy} (era de ${s.assigned})`) : s.assigned || L('nobody assigned', '担当なし', 'sem pessoa')}</span>
                  {s.uncovered && <span className="dp-tag bad">{L('no cover', '担当不在', 'sem cobertura')}</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
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
              <span className="dp-first">{p.firstStart ? L(` · 1st start ${p.firstStart}`, ` · 初回開始 ${p.firstStart}`, ` · 1º início ${p.firstStart}`) : p.total ? L(' · no start yet', ' · 未開始', ' · sem início') : ''}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Full Painel do Dia. `alerts` default to the panel's own (same source as the bell). */
export default function DayPanelView({ panel, L, dateLabel, admin }) {
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
          <StoreList stores={panel.stores} L={L} />
        </div>
      </div>
    </section>
  )
}
