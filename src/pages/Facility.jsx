import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FacilityStudio from './FacilityStudio'

/** Smart Facility direto no menu do admin (antes ficava dentro de Clientes → aba). ?client= filtra, ?model= abre a loja. */
export default function Facility() {
  const [params] = useSearchParams()
  const [clients, setClients] = useState([])
  useEffect(() => {
    supabase.from('clients').select('*').order('company_name').then(({ data }) => setClients(data || []))
  }, [])
  return <FacilityStudio clients={clients} initialClientId={params.get('client') || ''} />
}
