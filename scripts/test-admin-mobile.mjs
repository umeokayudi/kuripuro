#!/usr/bin/env node
import {
  readAdminDesktopMode,
  writeAdminViewMode,
  ADMIN_VIEW_KEY,
  ADMIN_VIEW_BREAKPOINT,
} from '../src/lib/adminView.js'
import {
  clampAiPos,
  defaultAiPos,
  aiButtonPos,
  aiPanelBox,
  AI_BTN,
} from '../src/lib/aiWidgetPos.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

function testViewMode() {
  store.clear()
  assert(readAdminDesktopMode(1200) === true, 'wide default is desktop')
  assert(readAdminDesktopMode(390) === false, 'phone default is mobile')
  assert(readAdminDesktopMode(ADMIN_VIEW_BREAKPOINT) === true, 'breakpoint is desktop')
  assert(readAdminDesktopMode(ADMIN_VIEW_BREAKPOINT - 1) === false, 'just under breakpoint is mobile')

  writeAdminViewMode(false)
  assert(store.get(ADMIN_VIEW_KEY) === 'mobile', 'persists mobile')
  assert(readAdminDesktopMode(1400) === false, 'saved mobile wins over wide width')

  writeAdminViewMode(true)
  assert(readAdminDesktopMode(360) === true, 'saved desktop wins over phone width')
}

function testAiClamp() {
  const phone = { vw: 390, vh: 844 }
  const offscreen = clampAiPos(1400, 900, phone)
  assert(offscreen.x <= phone.vw - AI_BTN - 8, `x in view: ${offscreen.x}`)
  assert(offscreen.y <= phone.vh - AI_BTN - 8, `y in view: ${offscreen.y}`)
  assert(offscreen.x >= 8 && offscreen.y >= 8, 'padded from edges')

  const def = defaultAiPos(phone)
  assert(def.x === phone.vw - AI_BTN - 16, `default x ${def.x}`)
  assert(def.y === phone.vh - AI_BTN - 16, `default y ${def.y}`)

  const kept = aiButtonPos({ x: 1400, y: 20 }, phone)
  assert(kept.x === phone.vw - AI_BTN - 8, `saved desktop x clamped ${kept.x}`)
  assert(kept.y === 20, 'in-range y kept')

  const tiny = { vw: 320, vh: 568 }
  const btn = aiButtonPos(null, tiny)
  assert(btn.x + AI_BTN <= tiny.vw, 'button fits tiny width')
  assert(btn.y + AI_BTN <= tiny.vh, 'button fits tiny height')

  const panel = aiPanelBox(btn, tiny)
  assert(panel.width <= tiny.vw - 24, `panel width ${panel.width}`)
  assert(panel.height <= tiny.vh - 24, `panel height ${panel.height}`)
  assert(panel.left >= 12 && panel.left + panel.width <= tiny.vw - 12, 'panel horizontal in view')
  assert(panel.top >= 12 && panel.top + panel.height <= tiny.vh - 12, 'panel vertical in view')
}

testViewMode()
testAiClamp()
console.log('admin-mobile: ok')
