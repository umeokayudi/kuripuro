#!/usr/bin/env node
import {
  lockBodyScroll,
  unlockBodyScroll,
  isBodyScrollLocked,
  KP_MODAL_CLASS,
} from '../src/lib/bodyScrollLock.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function makeDom() {
  const classSet = new Set()
  const htmlStyle = { overflow: '', overscrollBehavior: '' }
  const bodyStyle = { overflow: '', position: '', top: '', left: '', right: '', width: '' }
  const listeners = new Map()
  let scrollY = 140
  global.window = {
    get scrollY() { return scrollY },
    get pageYOffset() { return scrollY },
    scrollTo(_x, y) { scrollY = y },
    dispatchEvent() {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle(el) { return { overflowY: el.style?.overflowY || 'visible' } },
  }
  global.document = {
    documentElement: {
      style: htmlStyle,
      classList: {
        add: (c) => classSet.add(c),
        remove: (c) => classSet.delete(c),
        contains: (c) => classSet.has(c),
      },
    },
    body: { style: bodyStyle },
    addEventListener(type, fn, opts) { listeners.set(type, { fn, opts }) },
    removeEventListener(type) { listeners.delete(type) },
  }
  return { classSet, htmlStyle, bodyStyle, listeners, getScrollY: () => scrollY }
}

console.log('=== Body scroll lock ===\n')

const d = makeDom()
assert(!isBodyScrollLocked(), 'starts unlocked')

const unlock1 = lockBodyScroll()
assert(isBodyScrollLocked(), 'lock on')
assert(d.classSet.has(KP_MODAL_CLASS), 'html class')
assert(d.bodyStyle.position === 'fixed', 'body position fixed')
assert(d.bodyStyle.top === '-140px', 'body top = -scrollY')
assert(d.bodyStyle.overflow === 'hidden', 'body overflow hidden')
assert(d.htmlStyle.overflow === 'hidden', 'html overflow hidden')
assert(d.listeners.has('touchmove'), 'touchmove guard bound')
assert(d.listeners.get('touchmove').opts?.passive === false, 'touchmove not passive')

const unlock2 = lockBodyScroll()
assert(isBodyScrollLocked(), 'nested still locked')
assert(d.bodyStyle.top === '-140px', 'nested lock does not restack')

unlock2()
assert(isBodyScrollLocked(), 'outer still locked after inner unlock')
assert(d.classSet.has(KP_MODAL_CLASS), 'class stays until last unlock')

unlock1()
assert(!isBodyScrollLocked(), 'fully unlocked')
assert(!d.classSet.has(KP_MODAL_CLASS), 'class removed')
assert(d.bodyStyle.position === '', 'body position restored')
assert(d.bodyStyle.top === '', 'body top restored')
assert(d.getScrollY() === 140, 'scrollY restored')
assert(!d.listeners.has('touchmove'), 'touchmove unbound')

unlockBodyScroll()
assert(!isBodyScrollLocked(), 'extra unlock is a no-op')

console.log('✅ iOS body lock, nested count, restore')
