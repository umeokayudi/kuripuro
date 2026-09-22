import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll } from '../lib/bodyScrollLock'

export default function AppDialog({
  open = true,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  onClose,
  tone = 'primary',
  dark = false,
  hideCancel = false,
  confirmDisabled = false,
  wide = false,
}) {
  const titleId = useId()
  const sheetRef = useRef(null)
  const confirmRef = useRef(null)
  const cancelRef = useRef(onCancel || onClose)
  cancelRef.current = onCancel || onClose

  useEffect(() => {
    if (!open) return undefined
    return lockBodyScroll()
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    const node = confirmRef.current || sheetRef.current
    node?.focus?.()
  }, [open])

  if (!open) return null

  const close = () => cancelRef.current?.()

  const handleConfirm = async () => {
    if (confirmDisabled) return
    if (!onConfirm) {
      onClose?.()
      return
    }
    const result = await onConfirm()
    if (result === false) return
  }

  const showConfirm = Boolean(onConfirm) && confirmLabel
  const showCancel = !hideCancel && (onCancel || onClose || showConfirm)
  const cancelText = cancelLabel || 'Close'

  const node = (
    <div
      className={`kp-dialog-root${dark ? ' is-dark' : ''}`}
      role="presentation"
      onClick={close}
    >
      <div
        ref={sheetRef}
        className={`kp-dialog-sheet${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        data-kp-scroll
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kp-dialog-handle" aria-hidden="true" />
        <div className="kp-dialog-head">
          {title ? <h2 id={titleId} className="kp-dialog-title">{title}</h2> : <span />}
          <button type="button" className="kp-dialog-x" onClick={close} aria-label={cancelText}>✕</button>
        </div>
        {message ? <p className="kp-dialog-message">{message}</p> : null}
        {children ? <div className="kp-dialog-body">{children}</div> : null}
        {(showConfirm || showCancel) && (
          <div className="kp-dialog-actions">
            {showCancel && (
              <button type="button" className="kp-dialog-btn kp-dialog-btn-cancel" onClick={close}>
                {cancelText}
              </button>
            )}
            {showConfirm && (
              <button
                ref={confirmRef}
                type="button"
                className={`kp-dialog-btn kp-dialog-btn-${tone}`}
                onClick={handleConfirm}
                disabled={confirmDisabled}
              >
                {confirmLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(node, document.body) : node
}
