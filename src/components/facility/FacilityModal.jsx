import { useEffect, useState } from 'react'
import { loadApprovedModel } from '../../lib/facilityApi'
import FacilityViewer from './FacilityViewer'
import './facility.css'

/** Mapa do local para o funcionário: abre o modelo aprovado do cliente/loja do serviço. */
export default function FacilityModal({ clientId, locationName, title, t, lang, onClose }) {
  const [model, setModel] = useState(undefined)

  useEffect(() => {
    let cancelled = false
    loadApprovedModel(clientId, locationName).then(m => { if (!cancelled) setModel(m) })
    return () => { cancelled = true }
  }, [clientId, locationName])

  return (
    <div className="fac-overlay" style={{ zIndex: 350 }} onClick={onClose}>
      <div className="fac-sheet" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3>🏢 {title || t.storeModel}</h3>
          <button type="button" className="fac-chip" onClick={onClose}>✕</button>
        </div>
        {model === undefined && <div className="fac-muted">...</div>}
        {model === null && <div className="fac-block">{t.noModel}</div>}
        {model && <FacilityViewer model={model} t={t} lang={lang} maxHeight={380} />}
      </div>
    </div>
  )
}
