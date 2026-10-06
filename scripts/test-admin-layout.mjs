#!/usr/bin/env node
import { readFileSync } from 'fs'
import { adminTabActive, isAdminMobileLayout, ADMIN_MOBILE_TABS } from '../src/lib/adminLayout.js'
import { ADMIN_AI_TABLES, scrubAiRow } from '../src/lib/adminAiScope.js'

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
assert(adminTabActive('/ai', '/ai') === true, 'ai tab')
assert(adminTabActive('/ai', '/') === false, 'ai not home')
assert(ADMIN_MOBILE_TABS.some(t => t.to === '/ai'), 'ai in bottom nav')

const dash = readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8')
assert(dash.includes('RevenueGrowth'), 'compact revenue widget')
assert(!dash.includes('growth-table'), 'no full growth tables')

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
assert(css.includes('overflow-x: clip'), 'no sideways bounce')
assert(css.includes('.emp-shell'), 'emp shell')
assert(css.includes('max-width: 100%'), 'full bleed width')
assert(css.includes('.app-shell-mobile .page-content table { min-width: 0'), 'tables not 520')
assert(css.includes('.emp-bottom-nav'), 'emp nav class')
assert(css.includes('100dvh'), 'dynamic viewport')
assert(!css.includes('min-width: 520px'), 'no forced table width')
assert(css.includes('.ai-workspace'), 'ai desk')
assert(css.includes('.ai-gpt'), 'chatgpt-like ai')
assert(css.includes('.period-strip'), 'period strip')
assert(css.includes('.rev-panel'), 'compact revenue panel')
assert(css.includes('.rdash'), 'reports dashboard')
assert(css.includes('.rdash-drawer'), 'report filter drawer')

const reports = readFileSync(new URL('../src/pages/Reports.jsx', import.meta.url), 'utf8')
assert(reports.includes('LineChart'), 'revenue chart')
assert(reports.includes('BarChart'), 'client ranking')
assert(reports.includes('DonutChart'), 'status donut')
assert(reports.includes('generateReportPdf'), 'pdf export')
assert(reports.includes('viewDetails'), 'tables secondary')

assert(ADMIN_AI_TABLES.includes('faturas'), 'invoices')
assert(ADMIN_AI_TABLES.includes('cashflow'), 'cashflow')
assert(ADMIN_AI_TABLES.includes('salary_periods'), 'payroll')
assert(ADMIN_AI_TABLES.includes('salespeople'), 'salespeople')
assert(ADMIN_AI_TABLES.includes('sales_day_reports'), 'day reports')
assert(ADMIN_AI_TABLES.includes('sales_field_approaches'), 'field approaches')
assert(scrubAiRow({ password_hash: 'abc', full_name: 'A' }).password_hash === undefined, 'strip hash')
assert(ADMIN_AI_TABLES.includes('ryoshu'), 'receipts')
assert(ADMIN_AI_TABLES.includes('jobs'), 'jobs')
assert(ADMIN_AI_TABLES.length >= 30, `tables ${ADMIN_AI_TABLES.length}`)
assert(scrubAiRow({ password: 'x', full_name: 'A' }).full_name === 'A', 'keep name')
assert(scrubAiRow({ password: 'x', full_name: 'A' }).password === undefined, 'strip password')
console.log('✅ admin mobile layout tests passed')
