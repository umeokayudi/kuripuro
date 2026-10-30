// The app's own confirmation dialog (never window.confirm). Mount <ConfirmDialogHost /> once;
// call askConfirm({...}) anywhere: resolves true/false, or the typed reason when `reason` is set.
// v1.0.116 · `altLabel` adds a second choice that resolves 'alt' (Cancel / Escape still resolve false).
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'

let openDialog = null

export function askConfirm(opts = {}) {
  if (!openDialog) return Promise.resolve(window.confirm(opts.message || opts.title || ''))
  return new Promise(resolve => openDialog({ ...opts, resolve }))
}

/** Runs a delete/remove after the dialog and always shows success or the error. */
export async function confirmAndRun({ title, message, confirmLabel, danger = true, success, run }) {
  const ok = await askConfirm({ title, message, confirmLabel, danger })
  if (!ok) return false
  try {
    const res = await run()
    if (res?.error) throw res.error
    toast.success(success || '✓')
    return true
  } catch (err) {
    toast.error((err?.message || String(err)).slice(0, 200))
    return false
  }
}

export default function ConfirmDialogHost() {
  const { tr } = useLang()
  const [req, setReq] = useState(null)
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    openDialog = opts => { setText(opts.defaultReason || ''); setReq(opts) }
    return () => { openDialog = null }
  }, [])
  useEffect(() => {
    if (!req) return
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    const onKey = e => { if (e.key === 'Escape') close(false) }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [req])

  if (!req) return null
  const needsReason = !!req.reason
  const close = val => { req.resolve(val); setReq(null) }
  const ok = () => {
    if (needsReason) {
      if (!text.trim() && req.reasonRequired !== false) return
      close(text.trim() || true)
    } else close(true)
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={req.title || ''} onClick={() => close(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', color: 'var(--text)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(0,0,0,.25)', padding: 20 }}>
        {req.title && <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>{req.title}</div>}
        {req.message && <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{req.message}</div>}
        {req.body}
        {needsReason && (
          <label style={{ display: 'block', marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>
            {typeof req.reason === 'string' ? req.reason : tr('Reason', '理由', 'Motivo')}
            <textarea ref={inputRef} rows={2} value={text} onChange={e => setText(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 10, border: `1px solid ${!text.trim() && req.reasonRequired !== false ? 'var(--amber, #f59e0b)' : 'var(--border)'}`, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }} />
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={() => close(false)}>{req.cancelLabel || tr('Cancel', 'キャンセル', 'Cancelar')}</button>
          {req.altLabel && <button type="button" className="btn" onClick={() => close('alt')}>{req.altLabel}</button>}
          <button type="button" className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={ok}
            disabled={needsReason && req.reasonRequired !== false && !text.trim()}>
            {req.confirmLabel || (req.danger ? tr('Delete', '削除', 'Excluir') : tr('Confirm', '確認', 'Confirmar'))}
          </button>
        </div>
      </div>
    </div>
  )
}
