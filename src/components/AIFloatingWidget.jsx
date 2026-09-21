import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import AIChatPanel from './AIChatPanel'
import { useLang } from '../hooks/useLang'
import {
  AI_BTN,
  EMP_TAB_RESERVE,
  loadAiPos,
  saveAiPos,
  viewportSize,
  shellAiFrame,
  clampAiPos,
  defaultAiPos,
  aiButtonPos,
  aiPanelBox,
} from '../lib/aiWidgetPos'
import { isBodyScrollLocked, KP_SCROLL_LOCK_EVENT } from '../lib/bodyScrollLock'

export default function AIFloatingWidget({ mode = 'admin', employeeId, employeeName, dark = false, layoutKey = 'default' }) {
  const location = useLocation()
  const { t } = useLang()
  const hideOnPage = mode === 'admin' && location.pathname === '/ai'
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(() => loadAiPos(mode, layoutKey))
  const [vp, setVp] = useState(() => viewportSize())
  const [frame, setFrame] = useState(null)
  const [scrollLocked, setScrollLocked] = useState(() => isBodyScrollLocked())
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, sl: 0, st: 0 })
  const btnRef = useRef(null)

  useEffect(() => {
    const sync = () => {
      const locked = isBodyScrollLocked()
      setScrollLocked(locked)
      if (locked) setOpen(false)
    }
    window.addEventListener(KP_SCROLL_LOCK_EVENT, sync)
    return () => window.removeEventListener(KP_SCROLL_LOCK_EVENT, sync)
  }, [])

  useEffect(() => {
    setPos(loadAiPos(mode, layoutKey))
    setOpen(false)
  }, [mode, layoutKey])

  const size = useMemo(
    () => frame || { left: 0, top: 0, vw: vp.vw, vh: vp.vh, bottomReserve: 0 },
    [frame, vp.vw, vp.vh],
  )
  const clamp = useCallback((x, y) => clampAiPos(x, y, size), [size])

  useEffect(() => {
    const apply = () => {
      if (isBodyScrollLocked()) return
      const nextVp = viewportSize()
      setVp(nextVp)
      const shellSel = mode === 'employee' ? '.emp-shell' : '.app-shell'
      const el = document.querySelector(shellSel)
      const bottomReserve = mode === 'employee' ? EMP_TAB_RESERVE : 0
      if (!el || (mode !== 'employee' && layoutKey !== 'mobile' && !el.classList.contains('admin-mobile'))) {
        setFrame({ left: 0, top: 0, vw: nextVp.vw, vh: nextVp.vh, bottomReserve })
        return
      }
      setFrame(shellAiFrame(el, nextVp, { bottomReserve }))
    }
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('scroll', apply, { passive: true })
    window.visualViewport?.addEventListener('resize', apply)
    window.visualViewport?.addEventListener('scroll', apply)
    const el = document.querySelector(mode === 'employee' ? '.emp-shell' : '.app-shell')
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    if (el && ro) ro.observe(el)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('scroll', apply)
      window.visualViewport?.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('scroll', apply)
      ro?.disconnect()
    }
  }, [mode, layoutKey])

  const getBtnPos = useCallback(() => aiButtonPos(pos, size), [pos, size])

  const panelStyle = () => {
    const btnPos = getBtnPos()
    const box = aiPanelBox(btnPos, size)
    return {
      position: 'fixed',
      left: box.left,
      top: box.top,
      zIndex: 998,
      width: box.width,
      height: box.height,
      maxWidth: 'calc(100% - 24px)',
      maxHeight: 'calc(100% - 24px)',
      background: dark ? '#0d1f35' : 'var(--bg, #f4f6f9)',
      borderRadius: size.vw < 720 ? 16 : 20,
      boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      border: dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid var(--border)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }
  }

  const onPointerMove = useCallback((e) => {
    if (!drag.current.active) return
    const dx = e.clientX - drag.current.sx
    const dy = e.clientY - drag.current.sy
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.current.moved = true
    setPos(clamp(drag.current.sl + dx, drag.current.st + dy))
  }, [clamp])

  const onPointerUp = useCallback((e) => {
    if (!drag.current.active) return
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    if (!drag.current.moved) {
      setOpen(o => !o)
    } else {
      const final = clamp(
        drag.current.sl + (e.clientX - drag.current.sx),
        drag.current.st + (e.clientY - drag.current.sy),
      )
      setPos(final)
      saveAiPos(final, mode, layoutKey)
    }
    drag.current.active = false
  }, [onPointerMove, clamp, mode, layoutKey])

  const onPointerDown = (e) => {
    e.preventDefault()
    const rect = btnRef.current?.getBoundingClientRect()
    const fallback = defaultAiPos(size)
    const sl = pos?.x ?? rect?.left ?? fallback.x
    const st = pos?.y ?? rect?.top ?? fallback.y
    drag.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, sl, st }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove, onPointerUp])

  const btnPos = getBtnPos()
  if (hideOnPage || layoutKey === 'mobile' || scrollLocked) return null
  if (mode === 'employee' && !frame) return null

  const title = mode === 'employee' ? (t.employee?.aiDragHint || 'AI') : (t.app?.aiDragHint || t.sidebar.ai)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="ai-fab"
        onPointerDown={onPointerDown}
        aria-label={t.sidebar.ai}
        style={{
          position: 'fixed',
          left: btnPos.x,
          top: btnPos.y,
          zIndex: 999,
          width: AI_BTN,
          height: AI_BTN,
          borderRadius: '50%',
          background: open ? 'rgba(10,25,41,0.9)' : 'linear-gradient(135deg,#c19c56,#e8c47a)',
          border: open ? '2px solid rgba(255,255,255,0.2)' : 'none',
          boxShadow: '0 4px 16px rgba(193,156,86,0.45)',
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: open ? '#fff' : '#0a1929',
          fontWeight: 800,
          fontSize: open ? 18 : 15,
          letterSpacing: open ? 0 : 0.5,
          fontFamily: 'inherit',
        }}
        title={title}
      >
        {open ? '✕' : 'AI'}
      </button>

      {open && (
        <div style={panelStyle()}>
          <AIChatPanel compact mode={mode} employeeId={employeeId} employeeName={employeeName} dark={dark} />
        </div>
      )}
    </>
  )
}
