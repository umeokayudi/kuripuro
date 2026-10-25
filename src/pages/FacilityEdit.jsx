import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { supabase } from '../lib/supabase'
import FacilityStudio from './FacilityStudio'

/** Estúdio antigo (/facility/studio): fotos com IA, recomendações e ajustes finos. O editor em tela cheia (/facility/edit) abre aqui pelo botão "Avançado". */
export default function FacilityEdit() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useLang()
  const model = params.get('model')
  const [clients, setClients] = useState([])
  useEffect(() => {
    supabase.from('clients').select('*').order('company_name').then(({ data }) => setClients(data || []))
  }, [])
  return (
    <>
      <button type="button" className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate(model ? `/facility/edit?model=${model}` : '/facility')}>
        ‹ {model ? `✏️ ${t.facility.world?.editPlan || 'Edit plan'}` : `🌏 ${t.facility.world?.brand || 'World'}`}
      </button>
      <FacilityStudio clients={clients} initialClientId={params.get('client') || ''} />
    </>
  )
}
