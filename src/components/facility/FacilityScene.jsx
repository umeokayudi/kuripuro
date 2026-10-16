import { Fragment, useEffect, useRef, useState } from 'react'
import { AREA_KINDS, ELEMENT_KINDS } from '../../lib/facilityModel'
import './facility.css'

/** Alturas reais deixariam as paredes escondendo a planta; achatamos para ler melhor. */
const HEIGHT_FACTOR = 0.55
const WALL_FACTOR = 0.32
const SNAP = 0.05

const CONTROL_KINDS = new Set(['light_switch', 'breaker', 'valve', 'light'])
const FURNITURE_KINDS = new Set(['table', 'counter'])

function elementColor(kind) {
  if (CONTROL_KINDS.has(kind)) return '#facc15'
  if (FURNITURE_KINDS.has(kind)) return '#a16207'
  if (kind === 'floor' || kind === 'grating') return '#64748b'
  return '#f1f5f9'
}

function hexAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

const snap = v => Math.round(v / SNAP) * SNAP
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

function Box({ w, d, h, color, icon, children }) {
  const side = `linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28)), ${color}`
  const side2 = `linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.42)), ${color}`
  return (
    <>
      <div className="fac-face" style={{ width: w, height: h, transform: 'rotateX(90deg)', background: side2 }} />
      <div className="fac-face" style={{ top: d, width: w, height: h, transform: 'rotateX(90deg)', background: side }} />
      <div className="fac-face" style={{ width: d, height: h, transform: 'rotateZ(90deg) rotateX(90deg)', background: side2 }} />
      <div className="fac-face" style={{ left: w, width: d, height: h, transform: 'rotateZ(90deg) rotateX(90deg)', background: side }} />
      <div className="fac-face" style={{ width: w, height: d, transform: `translateZ(${h}px)`, background: color, fontSize: Math.max(9, Math.min(22, Math.min(w, d) * 0.7)) }}>
        <span className="fac-icon">{icon}</span>
        {children}
      </div>
    </>
  )
}

/**
 * Planta 3D (CSS 3D, sem dependências) / 2D editável do restaurante.
 * selected = { type: 'area'|'element'|'wall', id }
 * onChange(type, id, patch) — só no modo 2D com editable.
 */
export default function FacilityScene({
  layout,
  mode = '3d',
  rotation = -30,
  tilt = 55,
  selected,
  onSelect,
  editable = false,
  onChange,
  alerts,
  status,
  todo,
  maxHeight = 520,
}) {
  const wrapRef = useRef(null)
  const dragRef = useRef(null)
  const swallowClickRef = useRef(false)
  const [cw, setCw] = useState(640)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setCw(el.clientWidth || 640)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = layout.width
  const D = layout.depth
  const is3d = mode === '3d'
  const diag = Math.hypot(W, D)
  const s = is3d
    ? Math.min((cw - 30) / diag, (maxHeight - 40) / (diag * 0.75))
    : Math.min((cw - 24) / W, (maxHeight - 24) / D)
  const stageH = is3d ? Math.max(300, Math.min(maxHeight, diag * s * 0.75 + 60)) : D * s + 24
  const canEdit = editable && !is3d

  const isSel = (type, id) => selected?.type === type && selected?.id === id

  const startDrag = (e, type, item, handle = 'move') => {
    e.stopPropagation()
    onSelect?.({ type, id: item.id })
    if (!canEdit) return
    dragRef.current = { type, id: item.id, handle, sx: e.clientX, sy: e.clientY, orig: { ...item } }
    try { wrapRef.current?.setPointerCapture(e.pointerId) } catch {}
  }

  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag || !onChange) return
    const dx = (e.clientX - drag.sx) / s
    const dy = (e.clientY - drag.sy) / s
    const o = drag.orig
    if (drag.type === 'wall') {
      const p1 = { x1: clamp(snap(o.x1 + dx), 0, W), y1: clamp(snap(o.y1 + dy), 0, D) }
      const p2 = { x2: clamp(snap(o.x2 + dx), 0, W), y2: clamp(snap(o.y2 + dy), 0, D) }
      if (drag.handle === 'p1') onChange('wall', drag.id, p1)
      else if (drag.handle === 'p2') onChange('wall', drag.id, p2)
      else onChange('wall', drag.id, { ...p1, ...p2 })
      return
    }
    if (drag.handle === 'resize') {
      onChange(drag.type, drag.id, {
        w: clamp(snap(o.w + dx), 0.1, W - o.x),
        d: clamp(snap(o.d + dy), 0.1, D - o.y),
      })
    } else {
      onChange(drag.type, drag.id, {
        x: clamp(snap(o.x + dx), 0, W - o.w),
        y: clamp(snap(o.y + dy), 0, D - o.d),
      })
    }
  }

  const endDrag = (e) => {
    if (!dragRef.current) return
    dragRef.current = null
    // com pointer capture o click cai no palco; não desmarcar a seleção
    swallowClickRef.current = true
    try { wrapRef.current?.releasePointerCapture(e.pointerId) } catch {}
  }

  return (
    <div
      ref={wrapRef}
      className={`fac-stage${is3d ? '' : ' fac-2d'}`}
      style={{ height: stageH }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => {
        if (swallowClickRef.current) { swallowClickRef.current = false; return }
        onSelect?.(null)
      }}
    >
      <div
        className="fac-floor"
        style={{
          width: W * s,
          height: D * s,
          backgroundSize: `${s}px ${s}px`,
          transform: is3d ? `rotateX(${tilt}deg) rotateZ(${rotation}deg)` : 'none',
        }}
      >
        {layout.areas.map(a => {
          const k = AREA_KINDS[a.kind] || AREA_KINDS.other
          return (
            <div
              key={a.id}
              className={`fac-area${isSel('area', a.id) ? ' sel' : ''}`}
              title={a.name}
              style={{
                left: a.x * s,
                top: a.y * s,
                width: a.w * s,
                height: a.d * s,
                background: hexAlpha(k.color, 0.22),
                borderColor: hexAlpha(k.color, 0.8),
                cursor: canEdit ? 'move' : 'pointer',
              }}
              onPointerDown={e => startDrag(e, 'area', a)}
              onClick={e => e.stopPropagation()}
            >
              <span className="fac-area-label">{k.icon} {a.name}</span>
              {canEdit && isSel('area', a.id) && (
                <div className="fac-handle" onPointerDown={e => startDrag(e, 'area', a, 'resize')} />
              )}
            </div>
          )
        })}

        {layout.walls.map(wl => {
          const len = Math.hypot(wl.x2 - wl.x1, wl.y2 - wl.y1) * s
          const ang = Math.atan2(wl.y2 - wl.y1, wl.x2 - wl.x1)
          const sel = isSel('wall', wl.id)
          return (
            <Fragment key={wl.id}>
              <div
                className={`fac-wall${sel ? ' sel' : ''}`}
                style={is3d ? {
                  left: wl.x1 * s,
                  top: wl.y1 * s,
                  width: len,
                  height: wl.h * s * WALL_FACTOR,
                  transform: `rotateZ(${ang}rad) rotateX(90deg)`,
                } : {
                  left: wl.x1 * s,
                  top: wl.y1 * s - 3,
                  width: len,
                  height: 6,
                  transformOrigin: '0 50%',
                  transform: `rotate(${ang}rad)`,
                }}
                onPointerDown={e => startDrag(e, 'wall', wl)}
                onClick={e => e.stopPropagation()}
              />
              {canEdit && sel && (
                <>
                  <div className="fac-wall-handle" style={{ left: wl.x1 * s, top: wl.y1 * s }} onPointerDown={e => startDrag(e, 'wall', wl, 'p1')} />
                  <div className="fac-wall-handle" style={{ left: wl.x2 * s, top: wl.y2 * s }} onPointerDown={e => startDrag(e, 'wall', wl, 'p2')} />
                </>
              )}
            </Fragment>
          )
        })}

        {layout.elements.map(el => {
          const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
          const color = elementColor(el.kind)
          const sel = isSel('element', el.id)
          const alert = alerts?.has?.(el.id)
          const st = status?.get?.(el.id)
          const stCls = `${st ? ` fac-st-${st}` : ''}${todo?.has?.(el.id) ? ' fac-todo' : ''}`
          if (!is3d) {
            return (
              <div
                key={el.id}
                className={`fac-el-2d${sel ? ' sel' : ''}${stCls}`}
                title={el.name}
                style={{
                  left: el.x * s,
                  top: el.y * s,
                  width: Math.max(el.w * s, 8),
                  height: Math.max(el.d * s, 8),
                  background: hexAlpha(color, 0.9),
                  zIndex: 2,
                  cursor: canEdit ? 'move' : 'pointer',
                  fontSize: Math.max(9, Math.min(18, Math.min(el.w, el.d) * s * 0.7)),
                }}
                onPointerDown={e => startDrag(e, 'element', el)}
                onClick={e => e.stopPropagation()}
              >
                <span className="fac-icon">{k.icon}</span>
                {alert && <span className="fac-alert-dot" />}
                {canEdit && sel && <div className="fac-handle" onPointerDown={e => startDrag(e, 'element', el, 'resize')} />}
              </div>
            )
          }
          const hPx = Math.max(2, el.h * s * HEIGHT_FACTOR)
          const zPx = (k.z || 0) * s * WALL_FACTOR
          return (
            <div
              key={el.id}
              className={`fac-el${sel ? ' sel' : ''}${stCls}`}
              title={el.name}
              style={{
                left: el.x * s,
                top: el.y * s,
                width: el.w * s,
                height: el.d * s,
                transform: `translateZ(${zPx}px)`,
              }}
              onPointerDown={e => startDrag(e, 'element', el)}
              onClick={e => e.stopPropagation()}
            >
              <Box w={el.w * s} d={el.d * s} h={hPx} color={sel ? '#c19c56' : color} icon={k.icon}>
                {alert && <span className="fac-alert-dot" />}
              </Box>
            </div>
          )
        })}
      </div>
      <div className="fac-dims">{W} m × {D} m · {Math.round(W * D * 10) / 10} ㎡</div>
    </div>
  )
}
