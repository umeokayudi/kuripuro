import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll } from '../lib/bodyScrollLock'

/** Employee bottom-sheet overlay, portaled to document.body so iOS can scroll it. */
export default function EmpSheetPortal({ children, onBackdrop, zIndex }) {
  useEffect(() => lockBodyScroll(), [])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="emp-job-modal emp-sheet-portal"
      style={zIndex ? { zIndex } : undefined}
      onClick={onBackdrop}
    >
      {children}
    </div>,
    document.body,
  )
}
