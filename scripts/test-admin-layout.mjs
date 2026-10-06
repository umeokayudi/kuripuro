#!/usr/bin/env node
import { readFileSync } from 'fs'
import { adminTabActive, isAdminMobileLayout } from '../src/lib/adminLayout.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(isAdminMobileLayout(390, 'auto') === true, 'phone auto')
assert(isAdminMobileLayout(1280, 'auto') === false, 'desktop auto')
assert(isAdminMobileLayout(1280, 'mobile') === true, 'force mobile')
assert(isAdminMobileLayout(390, 'desktop') === false, 'force desktop')
assert(adminTabActive('/', '/') === true, 'home')
assert(adminTabActive('/jobs', '/jobs') === true, 'jobs')
assert(adminTabActive('/jobs', '/') === false, 'not home')
assert(adminTabActive('/mitsumori', '/mitsumori') === true, 'quote')

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
assert(css.includes('overflow-x: clip'), 'no sideways bounce')
assert(css.includes('.emp-shell'), 'emp shell')
assert(css.includes('max-width: 100%'), 'full bleed width')
assert(css.includes('.app-shell-mobile .page-content table { min-width: 0'), 'tables not 520')
assert(css.includes('.emp-bottom-nav'), 'emp nav class')
assert(css.includes('100dvh'), 'dynamic viewport')
assert(!css.includes('min-width: 520px'), 'no forced table width')
console.log('✅ admin mobile layout tests passed')
