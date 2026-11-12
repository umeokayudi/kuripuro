#!/usr/bin/env node
// v1.0.211 · E-mail de confirmação com relatórios: teste de aceite SEM e-mail real e SEM banco real.
// Storage e banco são simulados em memória; qualquer chamada ao Resend faz o teste falhar.
import assert from 'node:assert/strict'
import { buildClientEmail, serviceLine, parseEmails, clientRecipients } from '../src/lib/clientEmailContent.js'

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
delete process.env.CLIENT_EMAIL_MODE
delete process.env.RESEND_API_KEY
delete process.env.CLIENT_EMAIL_TEST_TO

let ok = 0
const t = (name, fn) => Promise.resolve().then(fn).then(() => { ok++; console.log(`  ✓ ${name}`) })

// ── fake Storage (fetch) ──
const store = new Map()
let resendCalls = 0
const TINY_JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64')
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.includes('api.resend.com')) { resendCalls++; throw new Error('Resend must never be called in test mode') }
  const m = u.match(/\/storage\/v1\/object\/(list\/)?service-photos\/?(.*)$/)
  if (!m) throw new Error(`unexpected fetch ${u}`)
  if (m[1]) {
    const { prefix } = JSON.parse(opts.body)
    const names = [...store.keys()].filter(k => k.startsWith(prefix)).map(k => ({ id: k, name: k.slice(prefix.length) })).filter(x => !x.name.includes('/'))
    names.sort((a, b) => b.name.localeCompare(a.name))
    return new Response(JSON.stringify(names), { status: 200 })
  }
  const path = decodeURIComponent(m[2])
  if ((opts.method || 'GET') === 'POST') {
    if (opts.headers['x-upsert'] === 'false' && store.has(path)) return new Response('{"error":"Duplicate","message":"The resource already exists"}', { status: 409 })
    store.set(path, Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body))
    return new Response('{}', { status: 200 })
  }
  return store.has(path) ? new Response(store.get(path), { status: 200 }) : new Response('not found', { status: 404 })
}

// ── fake DB ──
const CLIENT_ON = { id: 'c-on', company_name: 'オンザプラネット株式会社', manager_name: '田中', email: 'tanaka@otp.example, info@otp.example', manager_email: '', is_active: true }
const CLIENT_OFF = { id: 'c-off', company_name: 'Bacana', email: 'x@bacana.example', is_active: true }
const OTHER = { id: 'c-other', company_name: 'Outro Cliente', email: 'o@o.example' }
const DAY = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const mk = (id, clientId, store, extra = {}) => ({ id, client_id: clientId, client_name: 'OTP', title: `${store} — Basic Cleaning`, employee_name: 'Guilherme', scheduled_date: DAY, scheduled_time: '22:00', status: 'assigned', value: 7777, spot_value: 8888, employee_pay: 1234, job_category: 'contract', ...extra })
const jobs = [
  ...Array.from({ length: 8 }, (_, i) => mk(`j${i + 1}`, 'c-on', `店舗${i + 1}`)),
  mk('x1', 'c-off', 'Bacana Shibuya'),
  mk('o1', 'c-other', 'Loja de outro cliente'),
  mk('s1', 'c-on', 'スポット店', { job_category: 'spot', title: 'スポット店 — Deep Clean (Range hood)' }),
]
const clients = [CLIENT_ON, CLIENT_OFF, OTHER]
const db = {
  from(table) {
    const filters = []
    const q = {
      select() { return q },
      eq(k, v) { filters.push([k, v]); return q },
      maybeSingle: async () => ({ data: (table === 'jobs' ? jobs : clients).find(r => filters.every(([k, v]) => r[k] === v)) || null, error: null }),
      then(res) { return Promise.resolve({ data: (table === 'jobs' ? jobs : clients).filter(r => filters.every(([k, v]) => r[k] === v)), error: null }).then(res) },
    }
    return q
  },
}
const finish = (id, at = '2026-11-12T14:30:00Z') => { const j = jobs.find(x => x.id === id); j.status = 'completed'; j.started_at = '2026-11-12T13:00:00Z'; j.completed_at = at }
const logs = () => [...store.keys()].filter(k => k.startsWith('client-email/log/')).map(k => JSON.parse(store.get(k).toString()))

const { onJobEvent, dayState } = await import('../api/_client-email.js')

console.log('E-mail de confirmação com relatórios')

await t('texto: assunto, saudação com a empresa, resumo, notas só quando existem', () => {
  const a = serviceLine({ ...jobs[0], status: 'completed', started_at: '2026-11-12T13:00:00Z', completed_at: '2026-11-12T14:30:00Z' }, { notes: 'グリストラップに油の蓄積あり。' })
  const b = serviceLine({ ...jobs[1], status: 'completed' })
  const mail = buildClientEmail({ kind: 'day', client: { company_name: CLIENT_ON.company_name, contact_name: '田中' }, date: '2026-11-12', services: [a, b], notDone: [], portalUrl: 'https://kuripuro.vercel.app' })
  assert.equal(mail.subject, '作業完了のご報告（2026/11/12）— オンザプラネット株式会社')
  assert.match(mail.text, /^オンザプラネット株式会社 御中\n田中 様/)
  assert.match(mail.text, /本日2026年11月12日（木）、2件すべての清掃が完了いたしました/)
  assert.match(mail.text, /作業時間：22:00〜23:30/)
  assert.match(mail.text, /担当：Guilherme/)
  assert.equal((mail.text.match(/備考：/g) || []).length, 1, 'only the service with notes shows 備考')
  assert.match(mail.text, /グリストラップに油の蓄積あり/)
  assert.match(mail.text, /配信停止/)
  assert.match(mail.html, /kuripuro\.vercel\.app/)
  assert.doesNotMatch(mail.text + mail.html, /7777|8888|1234|¥/)
})

await t('e-mails do cadastro: vários separados, sem repetir', () => {
  assert.deepEqual(parseEmails('A@x.jp, b@y.jp; a@x.jp', 'c@z.jp'), ['a@x.jp', 'b@y.jp', 'c@z.jp'])
  assert.deepEqual(clientRecipients({ email: '', manager_email: '' }), [])
})

await t('dia: pendente segura o envio; "não feito" vai em linha separada; eliminado some', () => {
  const st = dayState([{ id: 'a', client_id: 'c', status: 'completed' }, { id: 'b', client_id: 'c', status: 'cancelled' }, { id: 'e', client_id: 'c', status: 'cancelled' }, { id: 's', client_id: 'c', status: 'assigned', job_category: 'spot' }], { eliminated: new Set(['e']) })
  assert.equal(st.pending.length, 0); assert.equal(st.done.length, 1); assert.deepEqual(st.notDone.map(j => j.id), ['b'])
})

// Settings: c-on LIGADO, c-off DESLIGADO
store.set('client-email/settings.json', Buffer.from(JSON.stringify({ clients: { 'c-on': { enabled: true, lang: 'ja', since: '2000-01-01' }, 'c-off': { enabled: false } } })))
store.set('jobs/j1/start_1.jpg', TINY_JPG); store.set('jobs/j1/end_1.jpg', TINY_JPG)
store.set('work-reports/_job/j1.json', Buffer.from('{"id":"r1"}'))
store.set('work-reports/r1/report.json', Buffer.from(JSON.stringify({ notices: 'レンジフードのフィルター交換をおすすめします。' })))

await t('cliente DESLIGADO conclui o dia: nenhum e-mail', async () => {
  finish('x1')
  const r = await onJobEvent({ id: 'x1', old: { status: 'assigned' } }, { db })
  assert.equal(r.skipped, 'client-off'); assert.equal(logs().length, 0)
})

await t('cliente LIGADO: 7 de 8 concluídos → espera; o 8º (não feito) fecha o dia → exatamente 1 e-mail', async () => {
  for (let i = 1; i <= 7; i++) {
    finish(`j${i}`)
    const r = await onJobEvent({ id: `j${i}`, old: { status: 'assigned' } }, { db })
    assert.equal(r.skipped, 'day-not-over')
  }
  assert.equal(logs().length, 0)
  jobs.find(j => j.id === 'j8').status = 'cancelled'
  const r = await onJobEvent({ id: 'j8', old: { status: 'assigned' } }, { db })
  assert.equal(r.status, 'test', 'test mode: logged, not sent')
  assert.equal(r.services, 7); assert.equal(r.not_done, 1); assert.equal(r.trigger, 'day')
  assert.deepEqual(r.to, ['tanaka@otp.example', 'info@otp.example'])
  assert.equal(r.delivery, 'pdf')
  assert.equal(logs().length, 1)
  const html = store.get(`client-email/out/${r.id}.html`).toString()
  assert.match(html, /本日.*7件の清掃が完了/)
  assert.match(html, /未実施/)
  assert.match(html, /店舗8/)
  assert.match(html, /レンジフードのフィルター交換/)
  assert.doesNotMatch(html, /7777|8888|1234|Bacana|Outro Cliente|Loja de outro cliente|スポット店/)
  const pdf = store.get(`client-email/out/${r.id}.pdf`)
  assert.ok(pdf && pdf.subarray(0, 4).toString() === '%PDF')
  if (process.env.SAMPLE_DIR) { const fs = await import('node:fs'); fs.writeFileSync(`${process.env.SAMPLE_DIR}/dia.html`, html); fs.writeFileSync(`${process.env.SAMPLE_DIR}/dia.pdf`, pdf) }
})

await t('mesmo dia de novo (outro evento, "Já fiz" depois): não reenvia', async () => {
  jobs.find(j => j.id === 'j8').status = 'completed'
  const r = await onJobEvent({ id: 'j8', old: { status: 'cancelled' } }, { db })
  assert.equal(r.skipped, 'already-sent'); assert.equal(logs().length, 1)
})

await t('spot concluído de cliente LIGADO: 1 e-mail imediato, só daquele spot', async () => {
  finish('s1')
  const r = await onJobEvent({ id: 's1', old: { status: 'assigned' } }, { db })
  assert.equal(r.trigger, 'spot'); assert.equal(r.services, 1); assert.equal(r.status, 'test')
  const html = store.get(`client-email/out/${r.id}.html`).toString()
  assert.match(html, /スポット清掃が完了/)
  assert.doesNotMatch(html, /店舗1|7777|8888|1234/)
  const again = await onJobEvent({ id: 's1', old: { status: 'assigned' } }, { db })
  assert.equal(again.skipped, 'already-sent'); assert.equal(logs().length, 2)
})

await t('nenhuma chamada ao provedor de e-mail', () => assert.equal(resendCalls, 0))

console.log(`\n${ok} ok`)
