import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { loadApprovedModel, listRecommendations, listServiceLog, logElementService } from '../../lib/facilityApi'
import FacilityViewer from './FacilityViewer'
import './facility.css'

/**
 * Mapa do local para o funcionário: abre o modelo aprovado do cliente/loja do serviço.
 * Com job + employee, o funcionário vê as tarefas aceitas pelo cliente e marca equipamentos como limpos.
 */
export default function FacilityModal({ clientId, locationName, title, t, lang, job, employee, onClose }) {
  const [model, setModel] = useState(undefined)
  const [recs, setRecs] = useState([])
  const [logs, setLogs] = useState([])

  const loadExtras = useCallback(async (m) => {
    if (!m) return
    const [r, l] = await Promise.all([
      listRecommendations({ modelId: m.id }).catch(() => []),
      listServiceLog({ modelId: m.id }),
    ])
    setRecs(r)
    setLogs(l)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadApprovedModel(clientId, locationName).then(m => {
      if (cancelled) return
      setModel(m)
      loadExtras(m)
    })
    return () => { cancelled = true }
  }, [clientId, locationName, loadExtras])

  const canLog = !!job && !!employee?.id && job.status !== 'cancelled'

  const onLogService = async (el, { notes, files }) => {
    try {
      await logElementService({ model, element: el, job, employee, notes, files })
      toast.success(`✅ ${el.name}`)
      await loadExtras(model)
    } catch (e) {
      toast.error(e.message)
      throw e
    }
  }

  return (
    <div className="fac-overlay" style={{ zIndex: 350 }} onClick={onClose}>
      <div className="fac-sheet" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3>🏢 {title || t.storeModel}</h3>
          <button type="button" className="fac-chip" onClick={onClose}>✕</button>
        </div>
        {model === undefined && <div className="fac-muted">...</div>}
        {model === null && <div className="fac-block">{t.noModel}</div>}
        {model && (
          <FacilityViewer
            model={model}
            t={t}
            lang={lang}
            recs={recs}
            logs={logs}
            onLogService={canLog ? onLogService : undefined}
            maxHeight={380}
          />
        )}
      </div>
    </div>
  )
}
