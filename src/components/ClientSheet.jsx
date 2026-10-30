import { useEffect, useState } from 'react'
import PlacePicker from './PlacePicker'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { useLang, localeOf } from '../hooks/useLang'
import { loadClientSheet, saveClientFields } from '../lib/clientSheet'
import { fetchContractSellers } from '../lib/contractSellers'
import { loadStoreTimeline, placePhotosOf, sizeLabel } from '../lib/cleaningTimeline'
import { loadApprovedModel } from '../lib/facilityApi'
import CleaningTimeline from './CleaningTimeline'
import StoreDossier from './facility/StoreDossier'
import './client-sheet.css'

// v1.0.73 · Full client sheet (CRM). Opens beside the page (full screen on phones)
// from any client name: <ClientLink id name /> or openClientSheet({ id }) (ClientSheetHost.jsx).

const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString('ja-JP')}`
const tokyoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

function Cleanings({ client, stores, tr }) {
  const [store, setStore] = useState(stores.length === 1 ? stores[0].name : '')
  const [state, setState] = useState({ loading: true, entries: [], model: null })
  useEffect(() => {
    let off = false
    setState(s => ({ ...s, loading: true }))
    ;(async () => {
      const model = store ? await loadApprovedModel(client.id, store, { allowDraft: true }) : null
      const entries = await loadStoreTimeline({ clientId: client.id, locationName: store || null, model })
      if (!off) setState({ loading: false, entries, model })
    })().catch(() => { if (!off) setState({ loading: false, entries: [], model: null }) })
    return () => { off = true }
  }, [client.id, store])
  return (
    <div>
      {stores.length > 1 && (
        <div className="cs-chips">
          <button type="button" className={!store ? 'on' : ''} onClick={() => setStore('')}>{tr('All stores', '全店舗', 'Todas as lojas')}</button>
          {stores.map(s => <button key={s.name} type="button" className={store === s.name ? 'on' : ''} onClick={() => setStore(s.name)}>{s.name}</button>)}
        </div>
      )}
      <CleaningTimeline key={`${store || 'all'}:${state.model?.id || ''}`} loading={state.loading} entries={state.entries} placePhotos={placePhotosOf(state.model, state.entries)} size={sizeLabel(state.model?.layout)} />
    </div>
  )
}

function SheetBody({ client: initial, onClose }) {
  const { lang, tr } = useLang()
  const [client, setClient] = useState(initial)
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('summary')
  const [sellers, setSellers] = useState([])
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({})
  const [notes, setNotes] = useState(initial.notes || '')
  const [openStore, setOpenStore] = useState(null)
  const [saving, setSaving] = useState(false)
  const today = tokyoToday()

  useEffect(() => {
    let off = false
    loadClientSheet(initial).then(d => { if (!off) setData(d) }).catch(() => { if (!off) setData({ error: true }) })
    fetchContractSellers().then(r => { if (!off) setSellers(r.salespeople || []) }).catch(() => {})
    return () => { off = true }
  }, [initial])

  const fmt = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => d
    ? new Date(String(d).length <= 10 ? `${d}T00:00:00+09:00` : d).toLocaleDateString(localeOf(lang), { ...opts, timeZone: 'Asia/Tokyo' })
    : '—'
  const ago = d => {
    if (!d) return ''
    const day = String(d).length <= 10 ? d : new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
    const n = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${day}T00:00:00Z`)) / 86400000)
    if (n <= 0) return tr('today', '今日', 'hoje')
    if (n === 1) return tr('yesterday', '昨日', 'ontem')
    return tr(`${n} days ago`, `${n}日前`, `há ${n} dias`)
  }

  const save = async patch => {
    setSaving(true)
    try {
      const row = await saveClientFields(client.id, patch)
      setClient(row)
      toast.success(tr('Saved', '保存しました', 'Salvo'))
      return row
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const seller = sellers.find(s => s.id === client.salesperson_id)
  const initials = String(client.company_name || '?').replace(/^(株式会社|有限会社|K\.K\.|KK)\s*/i, '').slice(0, 2).toUpperCase()
  const stores = data?.stores || []
  const kindLabel = k => ({ chat: tr('chat', 'チャット', 'chat'), quote: tr('quote request', '見積依頼', 'pediu orçamento'), request: tr('request', '依頼', 'pedido'), visit: tr('visit', '訪問', 'visita'), phone: tr('phone', '電話', 'telefone'), call: tr('phone', '電話', 'telefone'), line: 'LINE', email: 'e-mail' }[k] || k)
  const statusLabel = s => ({ paid: tr('paid', '入金済', 'pago'), sent: tr('sent', '送付済', 'enviada'), pending: tr('pending', '未入金', 'pendente'), overdue: tr('overdue', '期限超過', 'atrasada'), draft: tr('confirmed', '確定', 'confirmada'), cancelled: tr('cancelled', '取消', 'cancelada'), accepted: tr('accepted', '承認', 'aceito'), approved: tr('approved', '承認', 'aprovado'), signed: tr('signed', '署名済', 'assinado'), scheduled: tr('scheduled', '予定', 'agendado'), completed: tr('done', '完了', 'feito') }[s] || s)

  const TABS = [
    ['summary', tr('Summary', '概要', 'Resumo')],
    ['purchases', tr('Purchases', '購入', 'Compras')],
    ['cleanings', tr('Cleanings', '清掃', 'Limpezas')],
    ['contacts', tr('Contacts', '連絡', 'Contatos')],
    ['stores', tr('Stores & plans', '店舗・プラン', 'Lojas e planos')],
    ['notes', tr('Notes', 'メモ', 'Notas')],
  ]

  const purchaseRow = p => (
    <div key={p.id} className="cs-row">
      <div className="cs-row-main"><b>{p.what || '—'}</b><span>{[p.where, fmt(p.date)].filter(Boolean).join(' · ')}</span></div>
      <div className="cs-row-end"><b>{p.amount ? yen(p.amount) : '—'}</b>{p.status && <em>{statusLabel(p.status)}</em>}</div>
    </div>
  )
  const cleaningRow = j => (
    <div key={j.id} className="cs-row">
      <div className="cs-row-main"><b>{String(j.title || '').split(' — ')[0]}</b><span>{fmt(j.scheduled_date)} · {j.employee_name || '—'}</span></div>
      <div className="cs-row-end">{j.photo_end_url ? '📷' : ''}</div>
    </div>
  )
  const contactRow = c => (
    <div key={c.id} className="cs-row">
      <div className="cs-row-main">
        <b>{kindLabel(c.kind)} · {c.who === 'client' ? tr('client', '顧客', 'cliente') : tr('team', 'チーム', 'equipe')}</b>
        <span className="cs-clamp">{c.text || '—'}</span>
      </div>
      <div className="cs-row-end"><span>{fmt(c.at, { day: 'numeric', month: 'short' })}</span></div>
    </div>
  )

  return (
    <div className="cs-drawer" onClick={e => e.stopPropagation()} role="dialog" aria-label={client.company_name}>
      <div className="cs-head">
        <div className="cs-avatar">{initials}</div>
        <div className="cs-head-main">
          <h3>{client.company_name}</h3>
          <div className="cs-sub">
            {[stores.length ? tr(`${stores.length} stores`, `${stores.length}店舗`, `${stores.length} lojas`) : null,
              data?.since ? `${tr('client since', '取引開始', 'cliente desde')} ${fmt(data.since, { month: 'short', year: 'numeric' })}` : null].filter(Boolean).join(' · ')}
            <span className={`cs-pill${client.is_active === false ? ' off' : ''}`}>{client.is_active === false ? tr('Inactive', '停止', 'Inativo') : tr('Active', '契約中', 'Ativo')}</span>
          </div>
          <div className="cs-owner">
            <label>
              {tr('Responsible', '担当', 'Responsável')}
              <select value={client.salesperson_id || ''} disabled={saving} onChange={e => save({ salesperson_id: e.target.value || null })}>
                <option value="">{tr('KuriPuro team', 'クリプロチーム', 'Equipe KuriPuro')}</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                {client.salesperson_id && !seller && <option value={client.salesperson_id}>…</option>}
              </select>
            </label>
            <span>{tr('Manager', '担当者', 'Gerente')}: <b>{client.manager_name || client.contact_name || client.contact_person || '—'}</b></span>
            <button type="button" className="cs-edit" onClick={() => { setForm({ manager_name: client.manager_name || '', manager_phone: client.manager_phone || '', contact_name: client.contact_name || client.contact_person || '', phone: client.phone || '', email: client.email || '', address: client.address || '' }); setEdit(v => !v) }}>✎ {tr('Edit', '編集', 'Editar')}</button>
          </div>
        </div>
        <button type="button" className="cs-x" onClick={onClose} aria-label="close">✕</button>
      </div>

      {edit && (
        <div className="cs-form">
          {[['manager_name', tr('Manager', '担当者', 'Gerente')], ['manager_phone', tr('Manager phone', '担当者電話', 'Telefone do gerente')], ['contact_name', tr('Contact', '連絡先', 'Contato')], ['phone', tr('Phone', '電話', 'Telefone')], ['email', 'E-mail'], ['address', tr('Address', '住所', 'Endereço')]].map(([k, label]) => (
            k === 'address'
              ? <div key={k} className="cs-wide" style={{ display: 'grid', gap: 4 }}><label>{label}</label><PlacePicker withCoords={false} value={{ address: form[k] }} onChange={({ address }) => address !== undefined && setForm(f => ({ ...f, [k]: address }))} /></div>
              : <label key={k}>{label}<input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} /></label>
          ))}
          <div className="cs-wide cs-form-act">
            <button type="button" className="btn btn-sm" onClick={() => setEdit(false)}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={async () => { const patch = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null])); if (await save(patch)) setEdit(false) }}>{tr('Save', '保存', 'Salvar')}</button>
          </div>
        </div>
      )}

      {!data ? <div className="cs-loading">…</div> : data.error ? <div className="cs-loading">{tr('Could not load.', '読み込めませんでした。', 'Não foi possível carregar.')}</div> : (
        <>
          <div className="cs-kpis">
            <div className="cs-kpi">
              <small>{tr('Spent to date', '累計', 'Gastou até hoje')}</small>
              <b>{yen(data.paid)}</b>
              <span>{tr('paid', '入金済', 'pago')}{data.billed > data.paid ? ` · ${yen(data.billed - data.paid)} ${tr('open', '未入金', 'em aberto')}` : ''}</span>
            </div>
            <div className="cs-kpi">
              <small>{tr('This month', '今月', 'Este mês')}</small>
              <b>{yen(data.monthBilled + data.monthConfirmed)}</b>
              <span>{data.monthConfirmed ? `${yen(data.monthConfirmed)} ${tr('confirmed', '確定', 'confirmado')}` : tr('billed', '請求', 'faturado')}</span>
            </div>
            <div className="cs-kpi">
              <small>{tr('Last cleaning', '前回の清掃', 'Última limpeza')}</small>
              <b>{data.lastCleaning ? ago(data.lastCleaning.scheduled_date) : '—'}</b>
              <span>{data.lastCleaning ? [String(data.lastCleaning.title || '').split(' — ')[0], data.lastCleaning.employee_name?.split(' ')[0]].filter(Boolean).join(' · ') : ''}</span>
            </div>
            <div className="cs-kpi">
              <small>{tr('Last contact', '最終連絡', 'Último contato')}</small>
              <b>{data.lastContact ? ago(data.lastContact) : '—'}</b>
              <span>{data.contacts[0] ? kindLabel(data.contacts[0].kind) : ''}</span>
            </div>
          </div>

          <div className="cs-tabs">
            {TABS.map(([k, label]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
          </div>

          <div className="cs-body">
            {tab === 'summary' && (
              <div className="cs-cols">
                <section><h4>{tr('Last purchases', '最近の購入', 'Últimas compras')}</h4>{data.purchases.slice(0, 3).map(purchaseRow)}{!data.purchases.length && <p className="cs-muted">—</p>}</section>
                <section><h4>{tr('Last cleanings', '最近の清掃', 'Últimas limpezas')}</h4>{data.done.slice(0, 3).map(cleaningRow)}{!data.done.length && <p className="cs-muted">—</p>}</section>
                <section><h4>{tr('Contacts', '連絡', 'Contatos')}</h4>{data.contacts.slice(0, 3).map(contactRow)}{!data.contacts.length && <p className="cs-muted">—</p>}</section>
                <section><h4>{tr('Stores & plans', '店舗・プラン', 'Lojas e planos')}</h4>
                  {stores.slice(0, 4).map(s => (
                    <button key={s.name} type="button" className="cs-row cs-row-btn" onClick={() => { setTab('stores'); setOpenStore(s.name) }}>
                      <div className="cs-row-main"><b>{s.name}</b><span>{s.plans.filter(p => p.is_active).map(p => p.service_type).filter(Boolean).join(' · ') || '—'}</span></div>
                      <div className="cs-row-end">{s.monthly ? <b>{yen(s.monthly)}</b> : null}<span>{s.lastCleaning ? ago(s.lastCleaning) : ''}</span></div>
                    </button>
                  ))}
                  {!stores.length && <p className="cs-muted">—</p>}
                </section>
                {data.nextJob && <section className="cs-next">📅 {tr('Next service', '次回', 'Próximo serviço')}: <b>{fmt(data.nextJob.scheduled_date, { weekday: 'short', day: 'numeric', month: 'short' })}</b> · {String(data.nextJob.title || '').split(' — ')[0]} · {data.nextJob.employee_name || '—'}</section>}
              </div>
            )}

            {tab === 'purchases' && (
              <>
                <section><h4>{tr('Purchases', '購入', 'Compras')} ({data.purchases.length})</h4>{data.purchases.map(purchaseRow)}{!data.purchases.length && <p className="cs-muted">—</p>}</section>
                <section><h4>{tr('Invoices', '請求書', 'Notas de cobrança')} ({data.faturas.length})</h4>
                  {data.faturas.map(f => (
                    <div key={f.id} className="cs-row">
                      <div className="cs-row-main"><b>{fmt(f.issue_date)}</b><span>{f.notes || (f.period_start ? `${tr('period', '期間', 'período')} ${f.period_start}` : '')}</span></div>
                      <div className="cs-row-end"><b>{yen(f.total)}</b><em className={`st-${f.status}`}>{statusLabel(f.status)}</em></div>
                    </div>
                  ))}
                  {!data.faturas.length && <p className="cs-muted">—</p>}
                </section>
              </>
            )}

            {tab === 'cleanings' && <Cleanings client={client} stores={stores} tr={tr} />}

            {tab === 'contacts' && (
              <section>{data.contacts.map(contactRow)}{!data.contacts.length && <p className="cs-muted">{tr('No contact recorded yet.', '連絡記録はまだありません。', 'Nenhum contato registrado ainda.')}</p>}</section>
            )}

            {tab === 'stores' && (
              <div>
                {stores.map(s => (
                  <div key={s.name} className={`cs-store${s.active ? '' : ' off'}`}>
                    <div className="cs-store-head">
                      <div><b>🏬 {s.name}</b><span>{s.address || ''}</span></div>
                      <div className="cs-row-end">{s.monthly ? <b>{yen(s.monthly)}/{tr('mo', '月', 'mês')}</b> : null}<span>{s.lastCleaning ? `${tr('last', '前回', 'última')} ${ago(s.lastCleaning)}` : ''}</span></div>
                    </div>
                    <div className="cs-plans">
                      {s.plans.map(p => (
                        <span key={p.id} className={p.is_active ? '' : 'off'}>
                          {p.service_type || '—'}{p.visits_per_month ? ` · ${p.visits_per_month}×/${tr('mo', '月', 'mês')}` : ''}{p.days_of_week ? ` · ${p.days_of_week}` : ''}
                        </span>
                      ))}
                    </div>
                    <button type="button" className="btn btn-sm" onClick={() => setOpenStore(v => (v === s.name ? null : s.name))}>
                      📷 {tr('Photos, cleanings and floor plan', '写真・清掃・平面図', 'Fotos, limpezas e planta')} {openStore === s.name ? '▲' : '▼'}
                    </button>
                    {openStore === s.name && <div style={{ marginTop: 10 }}><StoreDossier clientId={client.id} locationName={s.plans[0]?.location_name || s.name} /></div>}
                  </div>
                ))}
                {!stores.length && <p className="cs-muted">{tr('No store or plan yet.', '店舗・プランはまだありません。', 'Nenhuma loja ou plano ainda.')}</p>}
              </div>
            )}

            {tab === 'notes' && (
              <section>
                <textarea className="cs-notes" rows={8} value={notes} onChange={e => setNotes(e.target.value)} placeholder={tr('Notes about this client for the team', 'チーム向けメモ', 'Notas sobre este cliente para a equipe')} />
                <button type="button" className="btn btn-primary btn-sm" disabled={saving || notes === (client.notes || '')} onClick={() => save({ notes: notes.trim() || null })}>{tr('Save notes', 'メモを保存', 'Salvar notas')}</button>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Lazy-loaded by ClientSheetHost. */
export default function ClientSheet({ client, onClose }) {
  return createPortal(
    <div className="cs-overlay" onClick={onClose}>
      <SheetBody key={client.id} client={client} onClose={onClose} />
    </div>,
    document.body,
  )
}
