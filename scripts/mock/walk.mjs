#!/usr/bin/env node
// Walks the app like a user on the local test stack and reports what breaks:
// page errors, failed requests, text that leaves the screen. Screenshots go to OUT.
//   node scripts/mock/walk.mjs admin|employee|client|seller [desktop|phone] [outDir]
import { createRequire } from 'node:module'
// Playwright lives outside the project (global install): resolve it from the project, then from /.
const pw = (() => { for (const base of [import.meta.url, 'file:///opt/', 'file:///usr/lib/node_modules/', 'file:///usr/local/lib/node_modules/']) { try { return createRequire(base)('playwright') } catch {} } throw new Error('playwright not found') })()
const { chromium } = pw
import { mkdirSync } from 'node:fs'
const role = process.argv[2] || 'admin'
const device = process.argv[3] || 'desktop'
const OUT = process.argv[4] || `/tmp/kp-walk/${role}-${device}`
mkdirSync(OUT, { recursive: true })
const LOGIN = { admin: 'teste.admin@kuripuro.com', employee: 'teste.funcionario@kuripuro.com', client: 'teste.cliente@kuripuro.com', seller: 'teste.vendedor@kuripuro.com', marketing: 'teste.marketing@kuripuro.com' }
const ADMIN_ROUTES = ['/', '/jobs', '/live', '/schedule', '/google-agenda', '/employees', '/users', '/evaluations', '/meetings', '/training', '/equipment-requests', '/transport-claims', '/salary', '/payments', '/salary-periods', '/salary-complaints', '/deductions', '/clients', '/contracts', '/facility', '/client-feedback', '/faturas', '/mitsumori', '/ryoshu', '/cashflow', '/reports', '/work-reports', '/videos', '/sales-funnel', '/sales-team', '/marketing', '/partners', '/adminchat', '/team-channel', '/ai']
const browser = await chromium.launch()
const ctx = await browser.newContext(device === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => { try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }) } catch {} ; const L = (typeof process === 'undefined') ? 'pt' : 'pt'; for (const id of ['00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000c1']) localStorage.setItem('kp_lang_u:' + id, L); localStorage.setItem('kp_emp_pt:00000000-0000-4000-8000-0000000000e1', '1') })
const page = await ctx.newPage()
const issues = []
let where = 'login'
page.on('pageerror', e => issues.push(`[${where}] JS ERROR: ${String(e.message).slice(0, 300)}`))
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|favicon|example\.invalid|net::ERR/.test(m.text())) issues.push(`[${where}] console: ${m.text().slice(0, 300)}`) })
page.on('response', r => { const u = r.url(); if (r.status() >= 400 && /\/_sb\/rest|\/api\//.test(u) && !(r.status() === 406) && !/select=[\w]+&limit=1$/.test(u)) issues.push(`[${where}] ${r.status()} ${r.request().method()} ${decodeURIComponent(u.replace(/^https?:\/\/[^/]+/, '')).slice(0, 260)}`) })
const shot = async name => {
  await page.waitForTimeout(900)
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (over > 4) issues.push(`[${where}] sai da tela: ${over}px mais largo que a janela`)
  const crash = await page.locator('text=/Something went wrong|Algo deu errado|エラーが発生/').count()
  if (crash) issues.push(`[${where}] TELA DE ERRO`)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}
await page.goto('http://localhost:5173/')
await page.waitForSelector('input[type=password]', { timeout: 20000 })
await shot('00-login')
await page.locator('input').first().fill(LOGIN[role])
await page.locator('input[type=password]').fill('Teste@2026')
await page.locator('button[type=submit], form button').first().click()
await page.waitForTimeout(2500)
if (role === 'admin') {
  let i = 1
  for (const r of ADMIN_ROUTES) {
    where = r
    await page.goto('http://localhost:5173' + r)
    await page.waitForTimeout(1300)
    await shot(String(i++).padStart(2, '0') + (r === '/' ? '-dashboard' : r.replace(/\//g, '-')))
  }
} else {
  where = 'home'; await shot('01-home')
  // every button of the portal's own navigation (bottom bar, side menu, tabs)
  const navSel = process.env.NAV || 'nav button, nav a, .emp-tabbar button, .cpx-nav button, .sales-tabs button, .emp-menu button, [role=tab]'
  const n = await page.locator(navSel).count()
  for (let i = 0; i < n; i++) {
    const el = page.locator(navSel).nth(i)
    if (!(await el.isVisible().catch(() => false))) continue
    const label = ((await el.innerText().catch(() => '')) || `nav${i}`).trim().split('\n')[0].slice(0, 24)
    if (/sair|logout|ログアウト/i.test(label)) continue
    where = label || `nav${i}`
    await el.click({ timeout: 3000 }).catch(e => issues.push(`[${where}] clique falhou`))
    await shot(String(i + 2).padStart(2, '0') + '-' + where.replace(/[^\p{L}\p{N}]+/gu, '_'))
    await page.keyboard.press('Escape').catch(() => {})
  }
}
console.log(`== ${role} ${device}: ${issues.length} problema(s)`)
const seen = new Map(); for (const i of issues) { const k = i.replace(/^\[[^\]]*\] /, ''); if (!seen.has(k)) seen.set(k, []); seen.get(k).push(i.match(/^\[([^\]]*)\]/)[1]) }
for (const [k, w] of seen) console.log(`- ${k}  @ ${[...new Set(w)].slice(0, 4).join(', ')}${new Set(w).size > 4 ? ' …' : ''}`)
await browser.close()
