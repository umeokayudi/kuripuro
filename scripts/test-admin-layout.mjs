#!/usr/bin/env node
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
console.log('✅ admin mobile layout tests passed')
