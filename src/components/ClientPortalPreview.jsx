// v1.0.155 · Admin "Ver como o cliente": opens the real client portal of one store login, read only,
// without the client's password. Writes are refused by src/lib/portalPreview.js.
import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { clientUserToSession } from '../lib/clientCredentials'
import { useLang } from '../hooks/useLang'

const ClientPortal = lazy(() => import('../pages/ClientPortal'))

export function ClientPortalPreview({ session, onClose }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])
  if (!session) return null
  return createPortal(
    <div className="cp-preview-layer" style={{ position: 'fixed', inset: 0, zIndex: 3000, overflow: 'auto', background: '#f5f3ee' }}>
      <Suspense fallback={<p style={{ padding: 24 }}>…</p>}>
        <ClientPortal previewUser={session} onExitPreview={onClose} />
      </Suspense>
    </div>,
    document.body,
  )
}

/** Session for a store: the real client_users row when there is one, else the same shape built from the store. */
export async function previewSessionFor({ clientId, clientName, locationName = null, row = null }) {
  if (row) return clientUserToSession(row)
  let q = supabase.from('client_users').select('id,client_id,client_name,location_name,contact_name,email').eq('client_id', clientId)
  q = locationName ? q.eq('location_name', locationName) : q.is('location_name', null)
  const { data } = await q.limit(1)
  if (data?.[0]) return clientUserToSession(data[0])
  return { id: `preview-${clientId}-${locationName || 'all'}`, role: 'client', name: locationName || clientName, client_id: clientId, client_name: clientName, location_name: locationName }
}

/** "👁 Ver como o cliente" button. Pass `row` (a client_users row) or clientId/clientName/locationName. */
export default function ViewAsClientButton({ row, clientId, clientName, locationName, className = 'btn btn-sm', label }) {
  const { tr } = useLang()
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(false)
  const open = async e => {
    e?.stopPropagation?.()
    setBusy(true)
    try { setSession(await previewSessionFor({ clientId: row?.client_id || clientId, clientName: row?.client_name || clientName, locationName: row ? row.location_name : locationName, row })) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" className={className} onClick={open} disabled={busy} title={tr('Opens this store\'s client area, read only, without the client\'s password', 'お客様のパスワードなしで、この店舗のお客様画面を閲覧のみで開きます', 'Abre a área do cliente desta loja, somente leitura, sem a senha do cliente')}>
        👁 {label || tr('View as the client', 'お客様の画面を見る', 'Ver como o cliente')}
      </button>
      {session && <ClientPortalPreview session={session} onClose={() => setSession(null)} />}
    </>
  )
}
