import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useLang, fill } from '../../hooks/useLang'
import { AREA_KINDS, ELEMENT_KINDS, areaSquareMeters, careSchedule, kindLabel, totalSquareMeters, withServiceLog } from '../../lib/facilityModel'
import { loadApprovedModel, listServiceLog } from '../../lib/facilityApi'
import CleaningTimeline from '../CleaningTimeline'
import { loadStoreTimeline, placePhotosOf, sizeLabel } from '../../lib/cleaningTimeline'
import CareList from './CareList'
import FacilityViewer from './FacilityViewer'
import { mapsEmbedQuery, mapsOpenUrl } from '../../lib/mapsLink'

/** Acha o cliente pelo id ou, no orçamento (lead), pelo nome da empresa. */
async function findClient(clientId, companyName) {
  if (clientId) {
    const { data } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle()
    return data || null
  }
  const name = String(companyName || '').trim()
  if (name.length < 2) return null
  const { data } = await supabase.from('clients').select('*').ilike('company_name', name).limit(1)
  return data?.[0] || null
}

/** Texto pronto para o orçamento: tamanho, cômodos, equipamentos e o que está vencido. */
export function dossierSummary({ client, contract, model, schedule, t, lang }) {
  const lines = []
  const place = contract?.location_name || model?.location_name || client?.company_name || ''
  lines.push(`${place}${client?.company_name && client.company_name !== place ? ` (${client.company_name})` : ''}`)
  const addr = contract?.location_address || client?.address
  if (addr) lines.push(`${t.dossierAddress}: ${addr}`)
  if (model) {
    const l = model.layout
    lines.push(`${t.dossierSize}: ${l.width} × ${l.depth} m (${totalSquareMeters(l)} m²)`)
    if (l.areas.length) lines.push(`${t.areas}: ${l.areas.map(a => `${a.name} ${areaSquareMeters(a)} m²`).join(', ')}`)
    const counts = {}
    for (const el of l.elements) counts[el.kind] = (counts[el.kind] || 0) + 1
    const eq = Object.entries(counts).filter(([k]) => !['table', 'chair', 'shelf', 'other', 'light_switch'].includes(k))
    if (eq.length) lines.push(`${t.elements}: ${eq.map(([k, n]) => `${kindLabel(k, lang)}${n > 1 ? ` ×${n}` : ''}`).join(', ')}`)
  }
  const due = schedule.filter(r => r.status === 'overdue' || r.status === 'due')
  if (due.length) lines.push(`${t.dossierDueNow}: ${due.map(r => `${r.task.name}${r.daysSince != null ? ` (${fill(t.daysSince, { n: r.daysSince })})` : ''}`).join(', ')}`)
  if (contract) lines.push(`${t.dossierContract}: ${[contract.service_type, contract.visits_per_month && `${contract.visits_per_month}×/月`, contract.hours_per_visit && `${contract.hours_per_visit}h`].filter(Boolean).join(' · ')}`)
  return lines.join('\n')
}

/**
 * Ficha da loja que acompanha um orçamento / pedido do cliente:
 * 3D, fotos, local no mapa, medidas, equipamentos, o que está vencido e o contrato.
 * onUseSummary(texto) deixa o resumo pronto como nota do orçamento.
 */
export default function StoreDossier({ clientId, companyName, locationName, onUseSummary }) {
  const { lang, t: tr } = useLang()
  const t = tr.facility
  const [state, setState] = useState({ loading: true })
  const [show3d, setShow3d] = useState(false)

  useEffect(() => {
    let off = false
    setState({ loading: true })
    ;(async () => {
      const client = await findClient(clientId, companyName)
      if (!client) return off || setState({ loading: false, client: null })
      const [{ data: contracts }, model, { data: jobs }] = await Promise.all([
        supabase.from('service_contracts').select('*').eq('client_id', client.id).eq('is_active', true),
        loadApprovedModel(client.id, locationName || null, { allowDraft: true }),
        supabase.from('jobs').select('id,title,scheduled_date,status,employee_name').eq('client_id', client.id).order('scheduled_date', { ascending: false }).limit(40),
      ])
      const contract = (contracts || []).find(c => c.location_name === locationName) || (contracts || [])[0] || null
      const logs = model ? await listServiceLog({ modelId: model.id }) : []
      const live = model ? { ...model, layout: withServiceLog(model.layout, logs) } : null
      const loc = locationName || contract?.location_name
      const recent = (jobs || []).filter(j => !loc || String(j.title || '').startsWith(loc)).slice(0, 5)
      const cleanings = await loadStoreTimeline({ clientId: client.id, locationName: loc, model: live, logs }).catch(() => [])
      if (!off) setState({ loading: false, client, contract, model: live, logs, recent, cleanings })
    })().catch(() => { if (!off) setState({ loading: false, client: null }) })
    return () => { off = true }
  }, [clientId, companyName, locationName])

  if (state.loading) return <div className="fac-dossier fac-muted">…</div>
  if (!state.client) return <div className="fac-dossier fac-muted">{t.dossierNoClient}</div>

  const { client, contract, model, logs, recent, cleanings = [] } = state
  const schedule = model ? careSchedule(model.layout) : []
  const due = schedule.filter(r => r.status === 'overdue' || r.status === 'due')
  const address = contract?.location_address || client.address
  const counts = {}
  for (const el of model?.layout.elements || []) counts[el.kind] = (counts[el.kind] || 0) + 1
  const summary = dossierSummary({ client, contract, model, schedule, t, lang })

  const copy = async () => {
    try { await navigator.clipboard.writeText(summary); toast.success(t.dossierCopied) } catch { toast.error('Copy failed') }
  }

  return (
    <div className="fac-dossier">
      <div className="fac-dossier-head">
        <div>
          <div className="fac-dossier-title">🏢 {contract?.location_name || model?.location_name || client.company_name}</div>
          <div className="fac-dossier-sub">{client.company_name}{client.contact_name ? ` · ${client.contact_name}` : ''}{client.phone ? ` · ${client.phone}` : ''}</div>
        </div>
        <div className="fac-dossier-actions">
          {model && <button type="button" className="btn btn-sm" onClick={() => setShow3d(v => !v)}>🧊 {show3d ? t.dossierHide3d : t.dossierShow3d}</button>}
          {model && <a className="btn btn-sm" href={`/facility?model=${model.id}`}>✏️ {t.openStore}</a>}
          <button type="button" className="btn btn-sm" onClick={copy}>📋 {t.dossierCopy}</button>
          {onUseSummary && <button type="button" className="btn btn-sm btn-primary" onClick={() => onUseSummary(summary)}>✍️ {t.dossierUse}</button>}
        </div>
      </div>

      <div className="fac-dossier-grid">
        <div className="fac-dossier-box">
          <div className="fac-dossier-label">📐 {t.dossierSize}</div>
          {model ? <>
            <div className="fac-dossier-big">{model.layout.width} × {model.layout.depth} m · {totalSquareMeters(model.layout)} m²</div>
            <div className="fac-dossier-chips">
              {model.layout.areas.map(a => <span key={a.id} className="fac-chip">{(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name} · {areaSquareMeters(a)} m²</span>)}
            </div>
            <div className="fac-dossier-chips">
              {Object.entries(counts).map(([k, n]) => <span key={k} className="fac-dossier-eq">{(ELEMENT_KINDS[k] || ELEMENT_KINDS.other).icon} {kindLabel(k, lang)}{n > 1 ? ` ×${n}` : ''}</span>)}
            </div>
            {model.status !== 'approved' && <div className="fac-muted">📝 {t.draftMap}</div>}
          </> : <div className="fac-muted">{t.dossierNoModel}</div>}
        </div>

        <div className="fac-dossier-box">
          <div className="fac-dossier-label">📍 {t.dossierAddress}</div>
          {address ? <>
            <div style={{ fontSize: 13, marginBottom: 6 }}>{address}</div>
            <iframe title="map" className="fac-dossier-map" loading="lazy" referrerPolicy="no-referrer"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapsEmbedQuery(address, contract?.location_name))}&z=16&output=embed`} />
            <a className="fac-dossier-link" href={mapsOpenUrl(address, contract?.location_name)} target="_blank" rel="noreferrer">{t.dossierOpenMap} ↗</a>
          </> : <div className="fac-muted">—</div>}
        </div>
      </div>

      {show3d && model && (
        <div style={{ marginTop: 10 }}>
          <FacilityViewer model={model} t={t} lang={lang} logs={logs} maxHeight={380} />
        </div>
      )}

      <div className="fac-dossier-box" style={{ marginTop: 10 }}>
        <div className="fac-dossier-label">📷 {t.dossierPhotos}</div>
        <CleaningTimeline entries={cleanings} placePhotos={placePhotosOf(model, cleanings)} size={sizeLabel(model?.layout)} />
      </div>

      {due.length > 0 && (
        <div className="fac-dossier-box" style={{ marginTop: 10 }}>
          <div className="fac-dossier-label">🧽 {t.dossierDueNow}</div>
          <CareList rows={due} t={t} lang={lang} showElement limit={5} />
        </div>
      )}

      <div className="fac-dossier-grid" style={{ marginTop: 10 }}>
        <div className="fac-dossier-box">
          <div className="fac-dossier-label">📄 {t.dossierContract}</div>
          {contract ? <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {contract.service_type}{contract.visits_per_month ? ` · ${contract.visits_per_month}×/month` : ''}{contract.hours_per_visit ? ` · ${contract.hours_per_visit}h` : ''}
            {contract.monthly_revenue ? <div>¥{Number(contract.monthly_revenue).toLocaleString()} / month</div> : null}
            {contract.area ? <div>{contract.area}</div> : null}
          </div> : <div className="fac-muted">—</div>}
        </div>
        <div className="fac-dossier-box">
          <div className="fac-dossier-label">🗓 {t.dossierRecent}</div>
          {recent.length ? recent.map(j => <div key={j.id} style={{ fontSize: 12.5 }}>{j.scheduled_date} · {String(j.title || '').replace(/^.*? — /, '')} · {j.employee_name || '—'}</div>) : <div className="fac-muted">—</div>}
        </div>
      </div>
    </div>
  )
}
