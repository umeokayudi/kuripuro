// Web Push for every login (admin, employee, seller, client), even with the site closed.
//
// Routes (via /api/push → /api/sales?route=push):
//   GET  ?op=key           public VAPID key + whether push is configured on the server
//   POST ?op=subscribe     save this browser's subscription for the signed-in person
//   POST ?op=unsubscribe   forget this browser (logout / turned off)
//   POST ?op=test          send a test notification to the caller's own devices
//   POST ?op=event         called by the database triggers (sql/2026-10-25_push_notificacoes.sql)
//                          with { table, op, id }. The row is re-read here with the service key
//                          and each event is sent once (push_log), so a forged call can only
//                          repeat a notice that really exists, never invent one.
import webpush from 'web-push'
import { salesDb, readSalesSession } from './_salesSession.js'

const MAX_FAILS = 3

export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

let vapidReady = false
function setupVapid() {
  if (vapidReady) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:umeokagroup@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
  vapidReady = true
}

const pick = (lang, en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)
const cut = (text, n = 120) => {
  const clean = String(text || '').replace(/\[photo\][^\s]*/gi, '📷').replace(/\s+/g, ' ').trim()
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean
}
const day = (value, lang) => {
  if (!value) return ''
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' })
}

// ── Who gets what ─────────────────────────────────────────────────────────
// Each rule returns a list of { to, key, msg(lang) }.
//   to: { role:'admin' } | { role:'employee', id } | { role:'salesperson', id } | { role:'client', id } | { role:'client', clientId }
//   key: dedupe key, the same event is never pushed twice
const TABLES = {
  messages: ['id,employee_id,employee_name,sender,content', (r, op) => {
    if (op !== 'INSERT') return []
    if (r.sender === 'employee') return [{
      to: { role: 'admin' }, key: `msg:${r.id}`,
      msg: l => ({ title: pick(l, `💬 ${r.employee_name || 'Employee'}`, `💬 ${r.employee_name || 'スタッフ'}`, `💬 ${r.employee_name || 'Funcionário'}`), body: cut(r.content), url: '/adminchat', tag: `chat-emp-${r.employee_id}` }),
    }]
    if (r.sender === 'admin' && r.employee_id) return [{
      to: { role: 'employee', id: r.employee_id }, key: `msg:${r.id}`,
      msg: l => ({ title: pick(l, '💬 Message from the office', '💬 事務所からのメッセージ', '💬 Mensagem do escritório'), body: cut(r.content), url: '/?tab=chat', tag: 'chat' }),
    }]
    return []
  }],

  client_messages: ['id,client_id,client_user_id,client_name,location_name,sender,content', (r, op) => {
    if (op !== 'INSERT') return []
    if (r.sender === 'client') return [{
      to: { role: 'admin' }, key: `cmsg:${r.id}`,
      msg: l => ({ title: `💬 ${r.location_name || r.client_name || pick(l, 'Client', '顧客', 'Cliente')}`, body: cut(r.content), url: '/adminchat', tag: `chat-cli-${r.client_user_id || r.client_id}` }),
    }]
    if (r.sender === 'admin') return [{
      to: r.client_user_id ? { role: 'client', id: r.client_user_id } : { role: 'client', clientId: r.client_id }, key: `cmsg:${r.id}`,
      msg: l => ({ title: pick(l, '💬 Message from KuriPuro', '💬 KuriPuroからのメッセージ', '💬 Mensagem da KuriPuro'), body: cut(r.content), url: '/?tab=chat', tag: 'chat' }),
    }]
    return []
  }],

  employee_availability: ['id,employee_id,employee_name,date,kind,status,admin_note', (r, op) => {
    if (r.kind && r.kind !== 'off') return []
    if (op === 'INSERT' && (r.status || 'pending') === 'pending') return [{
      to: { role: 'admin' }, key: `off:${r.id}:new`,
      msg: l => ({ title: pick(l, '🗓 Day-off request', '🗓 休み希望', '🗓 Pedido de folga'), body: `${r.employee_name || ''} · ${day(r.date, l)}`, url: '/', tag: `off-${r.id}` }),
    }]
    if (op === 'UPDATE' && (r.status === 'approved' || r.status === 'rejected')) return [{
      to: { role: 'employee', id: r.employee_id }, key: `off:${r.id}:${r.status}`,
      msg: l => ({
        title: r.status === 'approved'
          ? pick(l, '✅ Day off approved', '✅ 休みが承認されました', '✅ Folga aprovada')
          : pick(l, '❌ Day off not approved', '❌ 休みは承認されませんでした', '❌ Folga recusada'),
        body: [day(r.date, l), cut(r.admin_note, 80)].filter(Boolean).join(' · '), url: '/?tab=availability', tag: `off-${r.id}`,
      }),
    }]
    return []
  }],

  jobs: ['id,title,client_id,client_name,employee_id,scheduled_date,scheduled_time,status', (r, op, old) => {
    const out = []
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const newlyMine = r.employee_id && r.status === 'assigned' && String(r.scheduled_date || '') >= today
      && (op === 'INSERT' || (op === 'UPDATE' && old?.employee_id !== r.employee_id))
    if (newlyMine) {
      // The Schedule Generator inserts many jobs at once: one notice per person every 10 minutes.
      const slot = Math.floor(Date.now() / 600_000)
      out.push({
        to: { role: 'employee', id: r.employee_id }, key: `job-new:${r.employee_id}:${slot}`,
        msg: l => ({ title: pick(l, '📋 New job in your schedule', '📋 新しい作業が入りました', '📋 Novo serviço na sua agenda'), body: [r.title || r.client_name, day(r.scheduled_date, l), r.scheduled_time].filter(Boolean).join(' · '), url: '/?tab=history', tag: 'jobs-new' }),
      })
    }
    if (op === 'UPDATE' && r.status === 'completed' && old?.status !== 'completed' && r.client_id) out.push({
      to: { role: 'client', clientId: r.client_id }, key: `job-done:${r.id}`,
      msg: l => ({ title: pick(l, '✨ Cleaning finished', '✨ 清掃が完了しました', '✨ Limpeza concluída'), body: cut(r.title || r.client_name, 80), url: '/?tab=visits', tag: `job-${r.id}` }),
    })
    return out
  }],

  client_requests: ['id,client_id,client_user_id,location_name,description,status,request_type,quote_status,salesperson_id', (r, op, old) => {
    const isQuote = r.request_type === 'quote'
    if (op === 'INSERT') {
      const out = [{
        to: { role: 'admin' }, key: `creq:${r.id}:new`,
        msg: l => ({ title: isQuote ? pick(l, '📝 New quote request', '📝 新しい見積もり依頼', '📝 Novo pedido de orçamento') : pick(l, '📩 New client request', '📩 新しいご依頼', '📩 Novo pedido de cliente'), body: [r.location_name, cut(r.description, 80)].filter(Boolean).join(' · '), url: isQuote ? '/mitsumori' : '/client-feedback', tag: `creq-${r.id}` }),
      }]
      if (r.salesperson_id) out.push({
        to: { role: 'salesperson', id: r.salesperson_id }, key: `creq:${r.id}:seller`,
        msg: l => ({ title: pick(l, '📝 Quote request from your client', '📝 お客様から見積もり依頼', '📝 Pedido de orçamento do seu cliente'), body: [r.location_name, cut(r.description, 80)].filter(Boolean).join(' · '), url: '/?tab=quotes', tag: `creq-${r.id}` }),
      })
      return out
    }
    const to = r.client_user_id ? { role: 'client', id: r.client_user_id } : { role: 'client', clientId: r.client_id }
    if (r.quote_status === 'quoted' && old?.quote_status !== 'quoted') return [{
      to, key: `creq:${r.id}:quoted`,
      msg: l => ({ title: pick(l, '📝 Your quote is ready', '📝 お見積もりが届きました', '📝 Seu orçamento está pronto'), body: cut(r.location_name || r.description, 80), url: '/?tab=requests', tag: `creq-${r.id}` }),
    }]
    if (r.salesperson_id && old?.salesperson_id !== r.salesperson_id) return [{
      to: { role: 'salesperson', id: r.salesperson_id }, key: `creq:${r.id}:seller:${r.salesperson_id}`,
      msg: l => ({ title: pick(l, '📝 Quote request for you', '📝 見積もり依頼が届きました', '📝 Pedido de orçamento para você'), body: [r.location_name, cut(r.description, 80)].filter(Boolean).join(' · '), url: '/?tab=quotes', tag: `creq-${r.id}` }),
    }]
    if (r.status === 'completed' && old?.status !== 'completed') return [{
      to, key: `creq:${r.id}:done`,
      msg: l => ({ title: pick(l, '✅ Request completed', '✅ ご依頼が完了しました', '✅ Pedido concluído'), body: cut(r.location_name || r.description, 80), url: '/?tab=requests', tag: `creq-${r.id}` }),
    }]
    return []
  }],

  client_complaints: ['id,client_id,client_user_id,location_name,description,status,admin_response', (r, op, old) => {
    if (op === 'INSERT') return [{
      to: { role: 'admin' }, key: `ccomp:${r.id}:new`,
      msg: l => ({ title: pick(l, '⚠️ Client complaint', '⚠️ お客様からのご指摘', '⚠️ Reclamação de cliente'), body: [r.location_name, cut(r.description, 80)].filter(Boolean).join(' · '), url: '/client-feedback', tag: `ccomp-${r.id}` }),
    }]
    if (r.status !== old?.status && (r.status === 'resolved' || r.admin_response)) return [{
      to: r.client_user_id ? { role: 'client', id: r.client_user_id } : { role: 'client', clientId: r.client_id }, key: `ccomp:${r.id}:${r.status}`,
      msg: l => ({ title: pick(l, '💬 Answer to your report', '💬 ご指摘への回答', '💬 Resposta à sua reclamação'), body: cut(r.admin_response || r.description, 100), url: '/?tab=complaints', tag: `ccomp-${r.id}` }),
    }]
    return []
  }],

  faturas: ['id,client_id,total,status,due_date', (r, op, old) => {
    if (r.status !== 'sent' || old?.status === 'sent' || !r.client_id) return []
    return [{
      to: { role: 'client', clientId: r.client_id }, key: `fat:${r.id}:sent`,
      msg: l => ({ title: pick(l, '🧾 New invoice', '🧾 新しい請求書', '🧾 Nova fatura'), body: [r.total != null ? `¥${Number(r.total).toLocaleString('ja-JP')}` : '', r.due_date ? pick(l, `due ${day(r.due_date, l)}`, `支払期限 ${day(r.due_date, l)}`, `vence ${day(r.due_date, l)}`) : ''].filter(Boolean).join(' · '), url: '/?tab=billing', tag: `fat-${r.id}` }),
    }]
  }],

  salary_complaints: ['id,employee_id,employee_name,period,description,status,admin_response', (r, op, old) => {
    if (op === 'INSERT') return [{
      to: { role: 'admin' }, key: `scomp:${r.id}:new`,
      msg: l => ({ title: pick(l, '💴 Payslip question', '💴 給与の問い合わせ', '💴 Dúvida no holerite'), body: [r.employee_name, r.period, cut(r.description, 60)].filter(Boolean).join(' · '), url: '/salary-complaints', tag: `scomp-${r.id}` }),
    }]
    if (r.status !== old?.status && r.status !== 'pending') return [{
      to: { role: 'employee', id: r.employee_id }, key: `scomp:${r.id}:${r.status}`,
      msg: l => ({ title: pick(l, '💴 Answer about your payslip', '💴 給与についての回答', '💴 Resposta sobre seu holerite'), body: cut(r.admin_response || r.period, 100), url: '/?tab=salary', tag: `scomp-${r.id}` }),
    }]
    return []
  }],

  salary_payments: ['id,employee_id,period,amount,status,payment_type,is_deduction', (r, op, old) => {
    if (r.status !== 'paid' || old?.status === 'paid' || r.is_deduction || r.payment_type === 'deduction') return []
    return [{
      to: { role: 'employee', id: r.employee_id }, key: `pay:${r.id}:paid`,
      msg: l => ({ title: pick(l, '💴 Payment sent', '💴 お支払いが完了しました', '💴 Pagamento feito'), body: [r.period, r.amount != null ? `¥${Number(r.amount).toLocaleString('ja-JP')}` : ''].filter(Boolean).join(' · '), url: '/?tab=salary', tag: `pay-${r.id}` }),
    }]
  }],

  equipment_requests: ['id,employee_id,employee_name,item_name,quantity,status,admin_note', (r, op, old) => {
    if (op === 'INSERT') return [{
      to: { role: 'admin' }, key: `equip:${r.id}:new`,
      msg: l => ({ title: pick(l, '🧰 Equipment request', '🧰 備品のリクエスト', '🧰 Pedido de material'), body: [r.employee_name, `${r.item_name || ''}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`].filter(Boolean).join(' · '), url: '/equipment-requests', tag: `equip-${r.id}` }),
    }]
    if (r.status !== old?.status && r.status && r.status !== 'pending') return [{
      to: { role: 'employee', id: r.employee_id }, key: `equip:${r.id}:${r.status}`,
      msg: l => ({ title: pick(l, `🧰 Equipment: ${r.status}`, `🧰 備品: ${r.status}`, `🧰 Material: ${({ approved: 'aprovado', rejected: 'recusado', fulfilled: 'entregue' })[r.status] || r.status}`), body: [r.item_name, cut(r.admin_note, 60)].filter(Boolean).join(' · '), url: '/?tab=equipment', tag: `equip-${r.id}` }),
    }]
    return []
  }],

  transport_claims: ['id,employee_id,employee_name,amount,status,admin_note', (r, op, old) => {
    if (op === 'INSERT') return [{
      to: { role: 'admin' }, key: `trans:${r.id}:new`,
      msg: l => ({ title: pick(l, '🚃 Transport claim', '🚃 交通費の申請', '🚃 Pedido de transporte'), body: [r.employee_name, r.amount != null ? `¥${Number(r.amount).toLocaleString('ja-JP')}` : ''].filter(Boolean).join(' · '), url: '/transport-claims', tag: `trans-${r.id}` }),
    }]
    if (r.status !== old?.status && (r.status === 'approved' || r.status === 'rejected')) return [{
      to: { role: 'employee', id: r.employee_id }, key: `trans:${r.id}:${r.status}`,
      msg: l => ({ title: r.status === 'approved' ? pick(l, '🚃 Transport approved', '🚃 交通費が承認されました', '🚃 Transporte aprovado') : pick(l, '🚃 Transport not approved', '🚃 交通費は承認されませんでした', '🚃 Transporte recusado'), body: [r.amount != null ? `¥${Number(r.amount).toLocaleString('ja-JP')}` : '', cut(r.admin_note, 60)].filter(Boolean).join(' · '), url: '/?tab=transport', tag: `trans-${r.id}` }),
    }]
    return []
  }],

  // The seller/admin notices already written by the app (quotes, leads, commissions…).
  sales_notifications: ['id,salesperson_id,audience,title,body,dedupe_key', (r, op) => {
    if (op !== 'INSERT') return []
    if (r.audience === 'seller' && r.salesperson_id) return [{
      to: { role: 'salesperson', id: r.salesperson_id }, key: `sn:${r.id}`,
      msg: () => ({ title: cut(r.title, 60) || 'KuriPuro', body: cut(r.body), url: '/', tag: `sn-${r.dedupe_key || r.id}` }),
    }]
    if (r.audience === 'admin') return [{
      to: { role: 'admin' }, key: `sn:${r.id}`,
      msg: () => ({ title: cut(r.title, 60) || 'KuriPuro', body: cut(r.body), url: '/sales-team', tag: `sn-${r.dedupe_key || r.id}` }),
    }]
    return []
  }],
}

export const PUSH_TABLES = Object.keys(TABLES)

/** Exposed for tests: the notices a row would produce. */
export function noticesFor(table, op, row, old) {
  const rule = TABLES[table]
  return rule && row ? rule[1](row, op, old) : []
}

// ── Sending ───────────────────────────────────────────────────────────────
async function subscriptionsFor(db, to) {
  let q = db.from('push_subscriptions').select('id,endpoint,p256dh,auth,lang,fail_count')
  if (to.role === 'admin') q = q.eq('role', 'admin')
  else if (to.role === 'client' && to.clientId) q = q.eq('role', 'client').eq('client_id', to.clientId)
  else q = q.eq('role', to.role).eq('user_id', to.id)
  const { data, error } = await q.limit(50)
  if (error) throw error
  return data || []
}

async function sendTo(db, subs, msg) {
  setupVapid()
  let sent = 0
  await Promise.all(subs.map(async s => {
    const payload = JSON.stringify(msg(s.lang || 'en'))
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: 'high' })
      sent += 1
      await db.from('push_subscriptions').update({ last_sent_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id)
    } catch (err) {
      // 404/410: the browser dropped the subscription (app removed, permission revoked).
      const gone = err?.statusCode === 404 || err?.statusCode === 410
      if (gone || (s.fail_count || 0) + 1 >= MAX_FAILS) await db.from('push_subscriptions').delete().eq('id', s.id)
      else await db.from('push_subscriptions').update({ fail_count: (s.fail_count || 0) + 1 }).eq('id', s.id)
    }
  }))
  return sent
}

async function deliver(db, notice) {
  // Claim the key first: a second identical call (retry, forged replay) stops here.
  const { error: claimErr } = await db.from('push_log').insert({ dedupe_key: notice.key, recipient: JSON.stringify(notice.to) })
  if (claimErr) return { key: notice.key, skipped: claimErr.code === '23505' ? 'duplicate' : claimErr.message }
  const subs = await subscriptionsFor(db, notice.to)
  const sent = subs.length ? await sendTo(db, subs, notice.msg) : 0
  await db.from('push_log').update({ sent }).eq('dedupe_key', notice.key)
  return { key: notice.key, sent }
}

async function handleEvent(req, res) {
  const { table, op, id, old } = req.body || {}
  const rule = TABLES[table]
  if (!rule || !id || !['INSERT', 'UPDATE'].includes(op)) return res.status(400).json({ error: 'bad event' })
  const db = salesDb()
  const { data: row, error } = await db.from(table).select(rule[0]).eq('id', id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!row) return res.status(200).json({ ok: true, sent: 0 })
  // `old` only decides whether a change is new; the text always comes from the current row.
  const notices = rule[1](row, op, old && typeof old === 'object' ? old : {})
  const results = []
  for (const n of notices) results.push(await deliver(db, n))
  return res.status(200).json({ ok: true, results })
}

// ── Who is this browser? ──────────────────────────────────────────────────
async function identify(req) {
  const session = readSalesSession(req)
  if (session) return { role: session.role, user_id: session.id, client_id: null }
  // Clients sign in without a server cookie; accept their id only for an active client login.
  const { role, user_id: userId } = req.body || {}
  if (role !== 'client' || !userId) return null
  const { data } = await salesDb().from('client_users').select('id,client_id,is_active').eq('id', userId).maybeSingle()
  if (!data || data.is_active === false) return null
  return { role: 'client', user_id: data.id, client_id: data.client_id }
}

export default async function handler(req, res) {
  const op = String(req.query?.op || '')
  if (req.method === 'GET' && (op === 'key' || !op)) {
    return res.status(200).json({ configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!pushConfigured()) return res.status(503).json({ error: 'Push não configurado no servidor (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).' })

  try {
    if (op === 'event') return await handleEvent(req, res)

    const db = salesDb()
    if (op === 'unsubscribe') {
      const endpoint = String(req.body?.endpoint || '')
      if (endpoint) await db.from('push_subscriptions').delete().eq('endpoint', endpoint)
      return res.status(200).json({ ok: true })
    }

    const who = await identify(req)
    if (!who) return res.status(401).json({ error: 'Entre de novo para ativar as notificações.' })

    if (op === 'subscribe') {
      const sub = req.body?.subscription
      const endpoint = String(sub?.endpoint || '')
      if (!/^https:\/\//.test(endpoint) || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ error: 'Inscrição inválida.' })
      const lang = ['en', 'ja', 'pt'].includes(req.body?.lang) ? req.body.lang : 'en'
      // One row per browser: signing in with another account on the same phone moves it.
      const { error } = await db.from('push_subscriptions').upsert({
        endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
        role: who.role, user_id: who.user_id, client_id: who.client_id, lang,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
        fail_count: 0, updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' })
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ ok: true })
    }

    if (op === 'test') {
      const { data: subs } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth,lang,fail_count')
        .eq('role', who.role).eq('user_id', who.user_id).limit(20)
      const sent = await sendTo(db, subs || [], l => ({
        title: pick(l, '🔔 Notifications are on', '🔔 通知がオンになりました', '🔔 Notificações ativadas'),
        body: pick(l, 'You will get KuriPuro notices even with the app closed.', 'アプリを閉じていてもKuriPuroのお知らせが届きます。', 'Você vai receber os avisos da KuriPuro mesmo com o app fechado.'),
        url: '/', tag: 'push-test',
      }))
      return res.status(200).json({ ok: true, sent })
    }

    return res.status(404).json({ error: 'Unknown push op.' })
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'push failed' })
  }
}
