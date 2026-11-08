import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { DEEP_TASKS, deepTaskName, locationNameFromTitle } from '../lib/cleaningType'
import { deepItemsOf, deepItemsPatch } from '../lib/deepItemsEdit'
import { agendaChecklistItems, checklistProgress } from '../lib/agenda'

/**
 * v1.0.191 · "✨ Coifa, Caixa de gordura … ✏️" on a deep job card. The pencil opens only the items
 * done at this restaurant on this day (tap to add/remove, type an extra one); Save changes nothing
 * else of the job. The checklist x of y follows the new list.
 */
export default function DeepItemsEdit({ job, lang, tr, place, contract, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [ids, setIds] = useState([])
  const [custom, setCustom] = useState([])
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const cur = deepItemsOf(job)
  const names = [...DEEP_TASKS.filter(t => cur.ids.includes(t.id)).map(t => deepTaskName(t, lang)), ...cur.custom]

  const open = () => { setIds(cur.ids); setCustom(cur.custom); setExtra(''); setEditing(true) }
  const toggle = id => setIds(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const addExtra = () => {
    const v = extra.trim()
    if (v && !custom.includes(v)) setCustom(c => [...c, v])
    setExtra('')
  }
  const save = async () => {
    const allCustom = extra.trim() ? [...custom, extra.trim()] : custom
    if (!ids.length && !allCustom.length) return toast.error(tr('Leave at least one item', '最低1つ残してください', 'Deixe pelo menos um item'))
    const oldRows = checklistProgress(job, agendaChecklistItems(job, { place, contract })).items
    const patch = deepItemsPatch(job, ids, allCustom, { oldRows })
    if (!patch) { setEditing(false); return }
    setBusy(true)
    const { error } = await supabase.from('jobs').update(patch).eq('id', job.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(tr('Items saved for this service', 'この作業の項目を保存しました', 'Itens deste serviço salvos'))
    setEditing(false)
    onSaved?.(patch)
  }

  const chip = on => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', minHeight: 36, borderRadius: 18, fontSize: 13, cursor: 'pointer',
    border: `1px solid ${on ? '#b7791f' : 'var(--border)'}`, background: on ? '#b7791f1f' : 'var(--surface)',
    color: on ? '#b7791f' : 'var(--text2)', fontWeight: on ? 700 : 500, fontFamily: 'inherit', whiteSpace: 'nowrap',
  })

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 13, fontWeight: 600, color: '#b7791f', marginBottom: 4 }}>
        <span>✨ {names.length ? names.join(', ') : tr('No items listed', '項目なし', 'Nenhum item listado')}</span>
        <button type="button" className="btn btn-sm" style={{ padding: '2px 8px', minHeight: 0, lineHeight: 1.4 }} onClick={open}
          title={tr('Edit only the items done here', 'ここで行った項目だけ編集', 'Editar só os itens feitos aqui')}
          aria-label={tr('Edit items done', '作業項目を編集', 'Editar itens feitos')}>✏️ {tr('Items', '項目', 'Itens')}</button>
      </div>
    )
  }

  // Full-width sheet over the page (the card's left column is too narrow on a phone).
  return (
    <div role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget && !busy) setEditing(false) }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 }}>
    <div style={{ background: 'var(--surface)', borderRadius: '16px 16px 0 0', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))', width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 -8px 30px rgba(0,0,0,.2)' }}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>📍 {locationNameFromTitle(job.title)} · {job.scheduled_date}{job.employee_name ? ` · ${job.employee_name}` : ''}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
        ✨ {tr('Items done in this service', 'この作業で行った項目', 'Itens feitos neste serviço')}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
        {tr('Tap to add or remove. Only this service changes (date, person and values stay the same).',
          'タップで追加・削除。この作業だけが変わります（日付・担当・金額はそのまま）。',
          'Toque para marcar ou tirar. Só este serviço muda (data, pessoa e valores ficam iguais).')}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {DEEP_TASKS.map(t => {
          const on = ids.includes(t.id)
          return (
            <button key={t.id} type="button" style={chip(on)} aria-pressed={on} onClick={() => toggle(t.id)}>
              {on ? '✓' : t.icon} {deepTaskName(t, lang)}
            </button>
          )
        })}
        {custom.map(c => (
          <button key={c} type="button" style={chip(true)} onClick={() => setCustom(list => list.filter(x => x !== c))}
            aria-label={tr(`Remove ${c}`, `${c} を削除`, `Tirar ${c}`)}>✓ {c} ✕</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <input value={extra} onChange={e => setExtra(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtra() } }}
          placeholder={tr('Other item (type and press +)', 'その他の項目', 'Outro item (digite e toque +)')} style={{ flex: '1 1 180px', minWidth: 0, padding: '6px 10px' }} />
        <button type="button" className="btn btn-sm" onClick={addExtra} disabled={!extra.trim()}>+</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(false)}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? '…' : tr('Save items', '項目を保存', 'Salvar itens')}</button>
      </div>
    </div>
    </div>
  )
}
