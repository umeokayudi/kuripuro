export const AI_BTN = 56
export const AI_PANEL_W = 380
export const AI_PANEL_H = 520
export const AI_POS_KEY = 'kp_ai_widget_pos'

export function viewportSize(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return { vw: 1200, vh: 800 }
  const vv = win.visualViewport
  return {
    vw: Math.round(vv?.width || win.innerWidth || 1200),
    vh: Math.round(vv?.height || win.innerHeight || 800),
  }
}

export function clampAiPos(x, y, { vw, vh, btn = AI_BTN, pad = 8 } = {}) {
  const maxX = Math.max(pad, vw - btn - pad)
  const maxY = Math.max(pad, vh - btn - pad)
  return {
    x: Math.max(pad, Math.min(maxX, Number(x) || pad)),
    y: Math.max(pad, Math.min(maxY, Number(y) || pad)),
  }
}

export function defaultAiPos({ vw, vh, btn = AI_BTN, pad = 16 } = {}) {
  return clampAiPos(vw - btn - pad, vh - btn - pad, { vw, vh, btn, pad })
}

export function loadAiPos() {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(AI_POS_KEY) : null
    if (!saved) return null
    const parsed = JSON.parse(saved)
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    return null
  }
}

export function saveAiPos(pos) {
  try {
    localStorage.setItem(AI_POS_KEY, JSON.stringify(pos))
  } catch {}
}

export function aiButtonPos(saved, size) {
  const { vw, vh } = size
  const raw = saved || defaultAiPos({ vw, vh })
  return clampAiPos(raw.x, raw.y, { vw, vh })
}

export function aiPanelBox(btnPos, { vw, vh, btn = AI_BTN } = {}) {
  const pad = 12
  const narrow = vw < 720
  const width = Math.min(narrow ? vw - pad * 2 : AI_PANEL_W, vw - pad * 2)
  const height = Math.min(
    narrow ? vh - btn - pad * 3 : AI_PANEL_H,
    vh - pad * 2,
  )
  let left = btnPos.x + btn / 2 - width / 2
  left = Math.max(pad, Math.min(vw - width - pad, left))
  const openAbove = btnPos.y > vh / 2
  let top = openAbove ? btnPos.y - height - 12 : btnPos.y + btn + 12
  top = Math.max(pad, Math.min(vh - height - pad, top))
  return { left, top, width, height }
}
