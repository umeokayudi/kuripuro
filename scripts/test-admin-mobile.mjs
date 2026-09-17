#!/usr/bin/env node
import {
  readAdminDesktopMode,
  writeAdminViewMode,
  ADMIN_VIEW_KEY,
  ADMIN_VIEW_BREAKPOINT,
  ADMIN_PHONE_WIDTH,
  isAdminPhoneStage,
  isAdminMobileTabPath,
} from '../src/lib/adminView.js'
import {
  clampAiPos,
  defaultAiPos,
  aiButtonPos,
  aiPanelBox,
  visibleAiFrame,
  shellAiFrame,
  aiPosStorageKey,
  AI_BTN,
  EMP_TAB_RESERVE,
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

  assert(isAdminPhoneStage(true, 1400) === false, 'desktop is not phone-staged')
  assert(isAdminPhoneStage(false, 1400) === true, 'mobile on wide monitor is phone-staged')
  assert(isAdminPhoneStage(false, 390) === false, 'real phone stays full-bleed')
  assert(ADMIN_PHONE_WIDTH === 430, 'phone chrome 430')
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
  const reset = defaultAiPos(phone)
  assert(kept.x === reset.x && kept.y === reset.y, 'off-canvas saved pos resets to default')

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

function testEmployeeDesktopFrame() {
  const vp = { vw: 1440, vh: 900 }
  const shell = { left: (1440 - 430) / 2, top: 0, right: (1440 - 430) / 2 + 430, bottom: 900 }
  const frame = visibleAiFrame(shell, vp, { bottomReserve: EMP_TAB_RESERVE })
  assert(Math.abs(frame.left - 505) < 1, `shell left ${frame.left}`)
  assert(frame.vw === 430, `shell width ${frame.vw}`)

  const def = defaultAiPos(frame)
  assert(def.x + AI_BTN <= frame.left + frame.vw - 8, `fab inside phone x ${def.x}`)
  assert(def.x >= frame.left, 'fab not left of phone')
  assert(def.y + AI_BTN <= frame.top + frame.vh - EMP_TAB_RESERVE + 1, `fab above tabs ${def.y}`)

  const stray = aiButtonPos({ x: 1800, y: 800 }, frame)
  assert(stray.x >= frame.left && stray.x + AI_BTN <= frame.left + frame.vw, `stray clamped x ${stray.x}`)
  assert(stray.y >= frame.top && stray.y + AI_BTN <= frame.top + frame.vh, `stray clamped y ${stray.y}`)

  const panel = aiPanelBox(stray, frame)
  assert(panel.left >= frame.left, `panel left ${panel.left}`)
  assert(panel.left + panel.width <= frame.left + frame.vw + 0.5, `panel right ${panel.left + panel.width}`)
  assert(panel.top + panel.height <= stray.y - 8, `panel above fab ${panel.top + panel.height} vs ${stray.y}`)
  assert(aiPosStorageKey('employee') === 'kp_ai_widget_pos_employee', 'separate employee pos key')
  assert(aiPosStorageKey('admin') === 'kp_ai_widget_pos', 'admin pos key unchanged')
  assert(aiPosStorageKey('admin', 'mobile') === 'kp_ai_widget_pos_admin_mobile', 'admin mobile pos key')
}

function testAdminPhoneFrame() {
  const vp = { vw: 1440, vh: 900 }
  const shell = { left: (1440 - 430) / 2, top: 0, right: (1440 - 430) / 2 + 430, bottom: 900 }
  const frame = visibleAiFrame(shell, vp)
  assert(frame.vw === 430, `admin phone width ${frame.vw}`)
  const def = defaultAiPos(frame)
  assert(def.x >= frame.left && def.x + AI_BTN <= frame.left + frame.vw, `admin fab x ${def.x}`)

  const reserved = clampAiPos(400, 900, { left: 0, top: 0, vw: 430, vh: 800, bottomReserve: 76 })
  assert(reserved.y <= 800 - AI_BTN - 8 - 76, `bottom reserve ${reserved.y}`)

  const el = {
    clientWidth: 430,
    clientHeight: 800,
    getBoundingClientRect: () => ({ left: 505, top: 0, right: 935, bottom: 800 }),
  }
  const vis = shellAiFrame(el, vp)
  assert(Math.abs(vis.left - 505) < 1, `no-transform uses viewport frame ${vis.left}`)

  globalThis.getComputedStyle = () => ({ transform: 'matrix(1, 0, 0, 1, 0, 0)' })
  const local = shellAiFrame(el, vp)
  assert(local.left === 0 && local.top === 0 && local.vw === 430, `contained shell local ${local.vw}`)
  delete globalThis.getComputedStyle
}

testViewMode()
testAiClamp()
testEmployeeDesktopFrame()
testAdminPhoneFrame()
assert(isAdminMobileTabPath('/') && isAdminMobileTabPath('/jobs') && isAdminMobileTabPath('/ai') && isAdminMobileTabPath('/reports'), 'main mobile tabs')
assert(!isAdminMobileTabPath('/salary') && !isAdminMobileTabPath('/account') && !isAdminMobileTabPath('/clients'), 'other routes use More')
console.log('admin-mobile: ok')
