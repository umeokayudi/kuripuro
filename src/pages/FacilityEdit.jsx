import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLang } from '../hooks/useLang'
import { supabase } from '../lib/supabase'
import FacilityStudio from './FacilityStudio'

/** Editor da planta (o estúdio antigo). O Mundo Kuripuro (/facility) abre aqui com ?model= pelo botão "Editar planta". */
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
      <button type="button" className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate(model ? `/facility?model=${model}` : '/facility')}>
        ‹ 🌏 {t.facility.world?.brand || 'World'}
      </button>
      <FacilityStudio clients={clients} initialClientId={params.get('client') || ''} />
    </>
  )
}
