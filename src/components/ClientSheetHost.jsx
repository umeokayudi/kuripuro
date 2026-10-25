import { Suspense, lazy, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { OPEN_CLIENT_SHEET, findClientRow, openClientSheet } from '../lib/clientSheet'
import './client-sheet.css'

// v1.0.73 · The client sheet code (and the 3D it can show) loads only when someone opens it.
const ClientSheet = lazy(() => import('./ClientSheet'))

/** Client name that opens the full client sheet. */
export function ClientLink({ id, name, children, className = '' }) {
  return (
    <button type="button" className={`cs-link ${className}`} onClick={e => { e.stopPropagation(); openClientSheet({ id, name }) }}>
      {children || name || '—'}
    </button>
  )
}

/** Mounted once in the admin layout; listens for openClientSheet(). */
export default function ClientSheetHost() {
  const { tr } = useLang()
  const [client, setClient] = useState(null)
  useEffect(() => {
    const onOpen = async e => {
      const row = await findClientRow(e.detail || {})
      if (row) setClient(row)
      else toast(tr('Not a client yet (no client record with this name).', 'まだ顧客ではありません。', 'Ainda não é cliente (sem cadastro com esse nome).'))
    }
    window.addEventListener(OPEN_CLIENT_SHEET, onOpen)
    return () => window.removeEventListener(OPEN_CLIENT_SHEET, onOpen)
  }, [tr])
  useEffect(() => {
    if (!client) return
    const onKey = e => { if (e.key === 'Escape') setClient(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client])
  if (!client) return null
  return (
    <Suspense fallback={null}>
      <ClientSheet client={client} onClose={() => setClient(null)} />
    </Suspense>
  )
}
