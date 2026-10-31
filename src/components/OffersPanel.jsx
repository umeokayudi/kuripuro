import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { asItem } from '../lib/assignFlow'
import { assignJob } from '../lib/assignOps'
import { pendingChanged } from '../lib/adminPending'
import { offerIssues, stripPay, payMentions } from '../lib/offerText'
import { askConfirm } from './ConfirmDialog'

// v1.0.123 · Every offer sent (⚡ Ofertar) from today on, in one list: check and edit each one
// (day, time, person, routine/spot, extra value, text) or cancel it. An offer = an open job waiting
// for someone to accept it, or a spot job. Warns when the pay is also written in the text.

const COLS = 'id,title,client_name,scheduled_date,scheduled_time,employee_id,employee_name,status,job_category,spot_status,spot_value,value,description,spot_responded_at,sequence_order'
const isOffer = j => j.status !== 'cancelled' && ((!j.employee_id && j.spot_status === 'pending') || j.job_category === 'spot')

export default function OffersPanel({ tr, today, employees, fmtDay, refreshKey, onChanged }) {
  const [jobs, setJobs] = useState(null)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('open')
  const [editing, setEditing] = useState(null)

  const load = async () => {
    const { data } = await supabase.from('jobs').select(COLS).gte('scheduled_date', today).not('spot_status', 'is', null)
      .neq('status', 'cancelled').order('scheduled_date').order('scheduled_time').limit(500)
    setJobs((data || []).filter(isOffer))
  }
  useEffect(() => { load() }, [today, refreshKey])

  const list = jobs || []
  const openOnes = list.filter(j => !j.employee_id)
  const withIssue = list.filter(j => offerIssues(j).length)
  const shown = list.filter(j => filter === 'all' ? true : filter === 'open' ? !j.employee_id : filter === 'taken' ? !!j.employee_id : offerIssues(j).length)
  const active = useMemo(() => employees.filter(e => e.is_active !== false), [employees])
  if (!jobs || !list.length) return null

  const done = async () => { setEditing(null); await load(); pendingChanged(); onChanged?.() }
  const cancel = async j => {
    if (!(await askConfirm({ title: tr('Cancel offer', 'オファー取消', 'Cancelar oferta'), message: `${fmtDay(j.scheduled_date)} · ${asItem(j).place}\n${tr('It goes back to the Pending box (nobody keeps it).', '未割当ボックスに戻ります。', 'Volta para a Caixa de Pendentes (ninguém fica com ela).')}`, confirmLabel: tr('Cancel offer', '取消', 'Cancelar oferta'), danger: true }))) return
    const { error } = await supabase.from('jobs').update({ employee_id: null, employee_name: null, job_category: j.job_category === 'spot' ? 'regular' : j.job_category, spot_status: null, spot_responded_at: null }).eq('id', j.id)
    if (error) toast.error(error.message); else toast.success(tr('Offer cancelled', 'オファーを取り消しました', 'Oferta cancelada'))
    done()
  }

  return (
    <div className="card as-card">
      <div className="as-box-head">
        <div className="as-box-title">⚡ {tr('Offers sent', '送信したオファー', 'Ofertas enviadas')} <span className="as-pill">{list.length}</span>
          {withIssue.length > 0 && <span className="as-reason r-red">⚠️ {withIssue.length}</span>}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(v => !v)}>{open ? tr('Hide', '隠す', 'Esconder') : tr('Check / edit', '確認・編集', 'Conferir / editar')}</button>
      </div>
      <div className="as-muted">{tr(`${openOnes.length} waiting for someone · ${list.length - openOnes.length} accepted`, `受付中 ${openOnes.length}・承諾済み ${list.length - openOnes.length}`, `${openOnes.length} esperando alguém · ${list.length - openOnes.length} aceitas`)}
        {withIssue.length > 0 && ` · ${tr(`${withIssue.length} with the pay written twice or repeated text`, `報酬の二重記載・重複テキスト ${withIssue.length}件`, `${withIssue.length} com valor escrito 2 vezes ou texto repetido`)}`}</div>
      {open && (
        <>
          <div className="as-filters" style={{ marginTop: 10 }}>
            {[['open', tr('Waiting', '受付中', 'Esperando')], ['taken', tr('Accepted', '承諾済み', 'Aceitas')], ['issue', `⚠️ ${tr('To fix', '要修正', 'Para corrigir')} (${withIssue.length})`], ['all', tr('All', 'すべて', 'Todas')]].map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {!shown.length && <div className="as-empty">{tr('Nothing here.', 'ありません。', 'Nada aqui.')}</div>}
          {shown.map(j => editing === j.id
            ? <OfferEdit key={j.id} j={j} tr={tr} employees={active} onClose={() => setEditing(null)} onSaved={done} />
            : <OfferRow key={j.id} j={j} tr={tr} fmtDay={fmtDay} onEdit={() => setEditing(j.id)} onCancel={() => cancel(j)} />)}
        </>
      )}
    </div>
  )
}

function OfferRow({ j, tr, fmtDay, onEdit, onCancel }) {
  const it = asItem(j)
  const issues = offerIssues(j)
  const extra = j.job_category === 'spot' ? Number(j.spot_value) || 0 : 0
  return (
    <div className={`as-line${issues.length ? ' warn' : j.employee_id ? '' : ' offer'}`}>
      <div className="as-place">{it.place} <span className="as-muted">· {j.title.split(' — ')[1] || ''}</span></div>
      <div className="as-meta">
        <span>📅 {fmtDay(j.scheduled_date)} {String(j.scheduled_time || '').slice(0, 5)}</span>
        <span className={`as-tag t-${j.job_category === 'spot' ? 'spot' : 'basic'}`}>{j.job_category === 'spot' ? 'Spot' : tr('Routine', '定期', 'Rotina')}</span>
        {extra > 0 && <span className="as-tag t-spot">+¥{extra.toLocaleString()} extra</span>}
        <span className={`as-reason ${j.employee_id ? 'r-amber' : 'r-gold'}`}>{j.employee_id ? `✓ ${j.employee_name}` : `⏳ ${tr('waiting', '受付中', 'esperando')}`}</span>
      </div>
      {j.description && <div className="as-muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{j.description}</div>}
      {issues.length > 0 && (
        <div className="as-why">
          {issues.includes('payTwice') && <span className="as-warn red">⚠️ {tr(`The pay is in the extra (+¥${extra.toLocaleString()}) AND in the text (${payMentions(j.description).join(' / ')}). The employee sees it twice.`, `報酬が追加額（+¥${extra.toLocaleString()}）と本文の両方にあります。`, `O valor está no extra (+¥${extra.toLocaleString()}) E no texto (${payMentions(j.description).join(' / ')}). O funcionário vê 2 vezes.`)}</span>}
          {issues.includes('payInText') && <span className="as-warn">⚠️ {tr('Pay written in the text', '本文に報酬の記載', 'Valor escrito no texto')}</span>}
          {issues.includes('repeated') && <span className="as-warn">⚠️ {tr('Repeated text', '重複テキスト', 'Texto repetido')}</span>}
        </div>
      )}
      <div className="as-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={onEdit}>✏️ {tr('Edit', '編集', 'Editar')}</button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>{tr('Cancel offer', 'オファー取消', 'Cancelar oferta')}</button>
      </div>
    </div>
  )
}

function OfferEdit({ j, tr, employees, onClose, onSaved }) {
  const [f, setF] = useState({
    date: j.scheduled_date, time: String(j.scheduled_time || '').slice(0, 5), person: j.employee_id || '',
    spot: j.job_category === 'spot', extra: Number(j.spot_value) || 0, text: j.description || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true)
    try {
      const fields = {
        scheduled_date: f.date, scheduled_time: f.time || null, description: f.text.trim() || null,
        job_category: f.spot ? 'spot' : (j.job_category === 'spot' ? 'regular' : j.job_category),
        spot_value: f.spot ? Number(f.extra) || 0 : 0,
      }
      // Still open (nobody) → stays an open offer; routine with a person → just their job.
      if (!f.person) fields.spot_status = 'pending'
      else if (!f.spot && j.spot_status === 'pending') fields.spot_status = null
      const { error } = await supabase.from('jobs').update(fields).eq('id', j.id)
      if (error) throw error
      if ((f.person || null) !== (j.employee_id || null)) {
        const emp = employees.find(e => e.id === f.person) || null
        await assignJob({ ...j, ...fields }, emp)
        if (!emp) await supabase.from('jobs').update({ spot_status: 'pending', spot_responded_at: null }).eq('id', j.id)
      }
      toast.success(tr('Offer saved', 'オファーを保存しました', 'Oferta salva'))
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const pays = payMentions(f.text)
  return (
    <div className="as-line offer">
      <div className="as-place">{asItem(j).place} <span className="as-muted">· {j.title.split(' — ')[1] || ''}</span></div>
      <div className="as-offer-edit">
        <label className="as-muted">{tr('Day', '日付', 'Dia')}<input type="date" className="as-input" value={f.date} onChange={e => e.target.value && set('date', e.target.value)} /></label>
        <label className="as-muted">{tr('Time', '時刻', 'Horário')}<input type="time" className="as-input" value={f.time} onChange={e => set('time', e.target.value)} /></label>
        <label className="as-muted">{tr('Person', '担当', 'Pessoa')}
          <select className="as-input" value={f.person} onChange={e => set('person', e.target.value)}>
            <option value="">⏳ {tr('Open — first to accept', '受付中 — 先着', 'Aberta — o primeiro que aceitar')}</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </label>
        <label className="as-muted">{tr('Kind', '種類', 'Tipo')}
          <select className="as-input" value={f.spot ? 'spot' : 'routine'} onChange={e => set('spot', e.target.value === 'spot')}>
            <option value="routine">{tr('Routine — normal pay of the place', '定期 — 通常報酬', 'Rotina — pagamento normal do local')}</option>
            <option value="spot">{tr('Spot — + extra value', 'スポット — 追加額', 'Spot — + valor extra')}</option>
          </select>
        </label>
        {f.spot && <label className="as-muted">{tr('Extra for the employee (¥)', '従業員への追加額（¥）', 'Extra para o funcionário (¥)')}<input type="number" min="0" className="as-input" value={f.extra} onChange={e => set('extra', e.target.value)} /></label>}
        <label className="as-muted as-offer-text">{tr('Text the employee sees', '従業員が見る本文', 'Texto que o funcionário vê')}
          <textarea className="as-input" rows={3} value={f.text} onChange={e => set('text', e.target.value)} />
        </label>
      </div>
      {pays.length > 0 && (
        <div className="as-why">
          <span className="as-warn red">⚠️ {tr('The text also has a pay amount:', '本文にも報酬額があります:', 'O texto também tem valor:')} {pays.join(' / ')}</span>
          <button type="button" className="btn btn-sm" onClick={() => set('text', stripPay(f.text))}>{tr('Remove the value from the text', '本文から金額を削除', 'Tirar o valor do texto')}</button>
        </div>
      )}
      <div className="as-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? '…' : `✓ ${tr('Save', '保存', 'Salvar')}`}</button>
        <button type="button" className="btn btn-sm" onClick={onClose}>{tr('Close', '閉じる', 'Fechar')}</button>
      </div>
    </div>
  )
}
