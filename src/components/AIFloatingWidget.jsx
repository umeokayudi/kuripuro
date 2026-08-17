import { useState, useRef, useEffect, useCallback } from 'react'
import AIChatPanel from './AIChatPanel'

const BTN = 56
const PANEL_W = 380
const PANEL_H = 520
const STORAGE_KEY = 'kp_ai_widget_pos'

function loadPos() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

export default function AIFloatingWidget({ mode = 'admin', employeeId, employeeName, dark = false }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(loadPos)
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, sl: 0, st: 0 })
  const btnRef = useRef(null)

  const clamp = (x, y) => ({
    x: Math.max(8, Math.min(window.innerWidth - BTN - 8, x)),
    y: Math.max(8, Math.min(window.innerHeight - BTN - 8, y)),
  })

  const getBtnPos = useCallback(() => {
    if (pos) return pos
    return {
      x: window.innerWidth - BTN - 24,
      y: window.innerHeight - BTN - 24,
    }
  }, [pos])

  const panelStyle = () => {
    const { x, y } = getBtnPos()
    const openAbove = y > window.innerHeight / 2
    let left = x + BTN / 2 - PANEL_W / 2
    left = Math.max(12, Math.min(window.innerWidth - PANEL_W - 12, left))
    const top = openAbove ? y - PANEL_H - 12 : y + BTN + 12
    return {
      position: 'fixed',
      left,
      top: Math.max(12, Math.min(window.innerHeight - PANEL_H - 12, top)),
      zIndex: 998,
      width: PANEL_W,
      maxWidth: 'calc(100vw - 24px)',
      height: PANEL_H,
      maxHeight: 'calc(100vh - 24px)',
      background: dark ? '#0d1f35' : 'var(--bg, #f4f6f9)',
      borderRadius: 20,
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
  }, [])

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(final))
    }
    drag.current.active = false
  }, [onPointerMove])

  const onPointerDown = (e) => {
    e.preventDefault()
    const rect = btnRef.current?.getBoundingClientRect()
    const sl = pos?.x ?? rect?.left ?? window.innerWidth - BTN - 24
    const st = pos?.y ?? rect?.top ?? window.innerHeight - BTN - 24
    drag.current = { active: true, moved: false, sx: e.clientX, sy: e.clientY, sl, st }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove, onPointerUp])

  const btnPos = getBtnPos()

  return (
    <>
      <button
        ref={btnRef}
        onPointerDown={onPointerDown}
        style={{
          position: 'fixed',
          left: btnPos.x,
          top: btnPos.y,
          zIndex: 999,
          width: BTN,
          height: BTN,
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
        title={mode === 'employee' ? 'Assistente IA — arraste para mover' : 'Assistente Admin IA — arraste para mover'}
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
