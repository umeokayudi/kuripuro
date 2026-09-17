export const AI_BTN = 56
export const AI_PANEL_W = 380
export const AI_PANEL_H = 520
export const AI_POS_KEY = 'kp_ai_widget_pos'
export const EMP_TAB_RESERVE = 76

export function aiPosStorageKey(mode = 'admin') {
  return mode === 'employee' ? 'kp_ai_widget_pos_employee' : AI_POS_KEY
}

export function viewportSize(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return { vw: 1200, vh: 800 }
  const vv = win.visualViewport
  return {
    vw: Math.round(vv?.width || win.innerWidth || 1200),
    vh: Math.round(vv?.height || win.innerHeight || 800),
  }
}

/** Visible intersection of a layout rect (e.g. .emp-shell) with the viewport. */
export function visibleAiFrame(rect, vp, { bottomReserve = 0 } = {}) {
  const left = Math.max(0, Number(rect?.left) || 0)
  const top = Math.max(0, Number(rect?.top) || 0)
  const right = Math.min(vp.vw, Number(rect?.right) || vp.vw)
  const bottom = Math.min(vp.vh, Number(rect?.bottom) || vp.vh)
  return {
    left,
    top,
    vw: Math.max(AI_BTN + 16, right - left),
    vh: Math.max(AI_BTN + 16, bottom - top),
    bottomReserve,
  }
}

export function clampAiPos(x, y, { left = 0, top = 0, vw, vh, btn = AI_BTN, pad = 8 } = {}) {
  const minX = left + pad
  const minY = top + pad
  const maxX = left + Math.max(pad, vw - btn - pad)
  const maxY = top + Math.max(pad, vh - btn - pad)
  return {
    x: Math.max(minX, Math.min(maxX, Number(x) || minX)),
    y: Math.max(minY, Math.min(maxY, Number(y) || minY)),
  }
}

export function defaultAiPos({ left = 0, top = 0, vw, vh, btn = AI_BTN, pad = 16, bottomReserve = 0 } = {}) {
  return clampAiPos(
    left + vw - btn - pad,
    top + vh - btn - pad - bottomReserve,
    { left, top, vw, vh, btn, pad },
  )
}

export function loadAiPos(mode = 'admin') {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(aiPosStorageKey(mode)) : null
    if (!saved) return null
    const parsed = JSON.parse(saved)
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

export function saveAiPos(pos, mode = 'admin') {
  try {
    localStorage.setItem(aiPosStorageKey(mode), JSON.stringify(pos))
  } catch {}
}

export function aiButtonPos(saved, size) {
  const { vw, vh, left = 0, top = 0 } = size
  const raw = saved || defaultAiPos(size)
  const clamped = clampAiPos(raw.x, raw.y, size)
  const outside = saved && (
    saved.x < left - 4 || saved.x > left + vw ||
    saved.y < top - 4 || saved.y > top + vh
  )
  return outside ? defaultAiPos(size) : clamped
}

export function aiPanelBox(btnPos, { left = 0, top = 0, vw, vh, btn = AI_BTN } = {}) {
  const pad = 12
  const width = Math.min(AI_PANEL_W, vw - pad * 2)
  const height = Math.min(AI_PANEL_H, vh - btn - pad * 3)
  let panelLeft = btnPos.x + btn / 2 - width / 2
  panelLeft = Math.max(left + pad, Math.min(left + vw - width - pad, panelLeft))
  const openAbove = (btnPos.y - top) > vh / 2
  let panelTop = openAbove ? btnPos.y - height - 12 : btnPos.y + btn + 12
  panelTop = Math.max(top + pad, Math.min(top + vh - height - pad, panelTop))
  return { left: panelLeft, top: panelTop, width, height }
}
