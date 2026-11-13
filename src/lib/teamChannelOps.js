// v1.0.217 · Canal da Equipe — reads and writes (v1.0.221: one folder per channel + members.json) (Storage JSON + jobs). Rules in teamChannel.js.
import { supabase } from './supabase'
import { storagePublicUrl } from './workReport'
import { tokyoToday } from './dates'
import { employeeJobColumns, employeeSafeJob } from './jobEmployeePay'
import { takeOffer, offerJob } from './assignOps'
import { placeInDay, asItem, requiredRole, roleFits } from './assignFlow'
import { canWork } from './schedulePlan'
import { availabilityIndex } from './scheduleGenerator'
import { notifyChanges } from './assignNotices'
import {
  MSG_DIR, REQ_DIR, messagePath, requestPath, buildMessage, sortMessages, buildCoverCards,
  cantGoCandidates, takeCantGoPatch, monthOf, channelDir, LEGACY_DIR_CHANNEL, COVER_CHANNEL, MEMBERS_PATH,
  normalizeMembers, setMember,
} from './teamChannel'

const BUCKET = 'service-photos'
export const CHANNEL_CHANGED = 'kp-team-channel-changed'
const SHOW = 80

// Messages never change after they are written → each file is fetched once per tab.
const cache = new Map()

async function readJson(path, { fresh = false } = {}) {
  const url = `${storagePublicUrl(path)}${fresh ? `?t=${Date.now()}` : ''}`
  const r = await fetch(url, { cache: fresh ? 'no-store' : 'force-cache' })
  if (!r.ok) return null
  return r.json().catch(() => null)
}

async function writeJson(path, obj) {
  const body = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
}

async function listNames(dir) {
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (error) return []
  return (data || []).map(f => f.name).filter(n => n.endsWith('.json'))
}

/** Last messages of one channel (this month + last month), oldest first. */
export async function loadMessages(channel = 'geral', now = new Date()) {
  const month = monthOf(new Date(new Date(now).getTime() + 9 * 3600_000).toISOString())
  const prev = (() => { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()
  const dirs = [channelDir(channel)]
  if (channel === LEGACY_DIR_CHANNEL) dirs.push(MSG_DIR) // v1.0.217 history
  const lists = await Promise.all(dirs.flatMap(d => [prev, month].map(async mo => (await listNames(`${d}/${mo}`)).map(n => ({ n, p: `${d}/${mo}/${n}` })))))
  const paths = lists.flat().sort((a, b) => a.n.localeCompare(b.n)).map(x => x.p).slice(-SHOW)
  const missing = paths.filter(p => !cache.has(p))
  for (let i = 0; i < missing.length; i += 12) {
    await Promise.all(missing.slice(i, i + 12).map(async p => {
      const m = await readJson(p).catch(() => null)
      if (m) cache.set(p, { ...m, channel: m.channel || channel, id: p, path: p })
    }))
  }
  return sortMessages(paths.map(p => cache.get(p)).filter(Boolean))
}

/** Write one message in its channel; returns it with its path. */
export async function postMessage(fields) {
  const msg = buildMessage(fields)
  const path = messagePath(msg.at, undefined, msg.channel)
  await writeJson(path, msg)
  const saved = { ...msg, id: path, path }
  cache.set(path, saved)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANNEL_CHANGED))
  return saved
}

// ── Members (v1.0.221) ──────────────────────────────────────────────────────
/** The admin's changes to who is in each channel (empty = everyone by role). */
export async function loadMembers() {
  return normalizeMembers(await readJson(MEMBERS_PATH, { fresh: true }).catch(() => null))
}

/** Admin: tick / untick a person in a channel. Re-reads first so two edits don't erase each other. */
export async function saveMember(channel, person, on, admin) {
  const next = setMember(await loadMembers(), channel, person, on)
  next.updated_at = new Date().toISOString()
  next.updated_by = admin?.name || null
  await writeJson(MEMBERS_PATH, next)
  return next
}

export async function saveMirror(on, admin) {
  const next = { ...(await loadMembers()), mirrorCoversInGeral: !!on, updated_at: new Date().toISOString(), updated_by: admin?.name || null }
  await writeJson(MEMBERS_PATH, next)
  return normalizeMembers(next)
}

/** Every active internal person (admins, employees, sellers) — never clients, never money. */
export async function loadPeople() {
  const [a, e, s] = await Promise.all([
    supabase.from('admins').select('id,name').order('name'),
    supabase.from('employees').select('id,full_name,job_role,is_active').eq('is_active', true).order('full_name'),
    supabase.from('salespeople').select('id,full_name,is_active,team').eq('is_active', true).order('full_name'),
  ])
  return [
    ...(a.data || []).map(x => ({ role: 'admin', id: x.id, name: x.name || 'Admin', is_active: true })),
    ...(e.data || []).map(x => ({ role: 'employee', id: x.id, name: x.full_name || '—', job_role: x.job_role, is_active: x.is_active })),
    ...(s.data || []).map(x => ({ role: 'salesperson', id: x.id, name: x.full_name || '—', team: x.team || 'sales', is_active: x.is_active })),
  ]
}

/** Admin only: remove a message from the channel. */
export async function deleteMessage(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(error.message)
  cache.delete(path)
}

/** Every "não posso ir" request file (fresh, they change). */
export async function loadRequests() {
  const names = await listNames(REQ_DIR)
  const out = await Promise.all(names.map(n => readJson(`${REQ_DIR}/${n}`, { fresh: true }).catch(() => null)))
  return out.filter(r => r?.job_id)
}

/** Ask the server to push a cover request to the team (best effort; the channel shows it anyway). */
export async function pushChannel(path, user) {
  try {
    await fetch('/api/push?op=team', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, role: user?.role, user_id: user?.id }),
    })
  } catch { /* push is optional */ }
}

/**
 * Everything the channel shows besides the messages.
 * me: { role: 'admin' | 'employee', id, name }
 * → { cards, unassigned (admin: no person and not offered yet), myJobs (employee: own jobs that can ask cover), requests }
 */
export async function loadCoverState(me) {
  const today = tokyoToday()
  const isEmp = me?.role === 'employee'
  const safeCols = me?.role !== 'admin'
  const cols = safeCols ? await employeeJobColumns(supabase) : 'id,title,client_name,employee_id,employee_name,scheduled_date,scheduled_time,status,job_category,spot_status,description,category,sequence_order'
  const [open, requests, empRes, avRes, mineRes, unRes] = await Promise.all([
    supabase.from('jobs').select(cols).is('employee_id', null).eq('spot_status', 'pending').eq('status', 'assigned')
      .gte('scheduled_date', today).order('scheduled_date').order('scheduled_time').limit(60),
    loadRequests(),
    isEmp ? supabase.from('employees').select('id,full_name,job_role,work_days,is_active').eq('id', me.id).maybeSingle() : Promise.resolve({ data: null }),
    isEmp ? supabase.from('employee_availability').select('employee_id,date,kind,status').eq('employee_id', me.id).gte('date', today) : Promise.resolve({ data: [] }),
    isEmp ? supabase.from('jobs').select(cols).eq('employee_id', me.id).eq('status', 'assigned').gte('scheduled_date', today).order('scheduled_date').order('scheduled_time').limit(40) : Promise.resolve({ data: [] }),
    me?.role === 'admin' ? supabase.from('jobs').select(cols).is('employee_id', null).eq('status', 'assigned').gte('scheduled_date', today).order('scheduled_date').order('scheduled_time').limit(60) : Promise.resolve({ data: [] }),
  ])
  const safe = j => (safeCols ? employeeSafeJob(j) : j)
  const openReqs = requests.filter(r => r.status === 'open')
  const ids = openReqs.map(r => r.job_id)
  let reqJobs = []
  if (ids.length) {
    const { data } = await supabase.from('jobs').select(cols).in('id', ids)
    reqJobs = data || []
  }
  const jobsById = Object.fromEntries(reqJobs.map(j => [j.id, safe(j)]))
  const emp = empRes.data
  const availability = availabilityIndex(avRes.data || [])
  const fitOf = job => {
    if (!emp) return { ok: false, reason: 'unknown' }
    if (!roleFits(emp, requiredRole(asItem(job)))) return { ok: false, reason: 'role' }
    return canWork(emp, job.scheduled_date, availability)
  }
  const cards = buildCoverCards({ openJobs: (open.data || []).map(safe), requests: openReqs, jobsById, today, me, fitOf })
  return {
    cards,
    requests,
    unassigned: (unRes.data || []).filter(j => j.spot_status !== 'pending'),
    myJobs: cantGoCandidates((mineRes.data || []).map(safe), me?.id, today, requests),
  }
}

async function dayOf(employeeId, date) {
  const { data } = await supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,employee_id,employee_name,status,sequence_order,job_category,spot_status')
    .eq('employee_id', employeeId).eq('scheduled_date', date).neq('status', 'cancelled')
  return data || []
}

/**
 * "Eu pego": the person becomes responsible at once. Atomic: only while the card is still what it
 * was (free → nobody has it; cant_go → still with the person who asked and not started).
 * @returns 'ok' | 'taken'
 */
export async function takeCover(card, user) {
  const job = card.job
  if (card.kind === 'free') {
    const r = await takeOffer(job, user)
    if (r !== 'ok') return r
  } else {
    const patch = takeCantGoPatch(job, user)
    const { data, error } = await supabase.from('jobs').update(patch)
      .eq('id', job.id).eq('employee_id', card.from.id).eq('status', 'assigned').select('id')
    if (error) throw error
    if (!data?.length) return 'taken'
    const order = placeInDay(await dayOf(user.id, job.scheduled_date), { ...job, ...patch })
    await Promise.all(order.map(({ id, ...p }) => supabase.from('jobs').update(p).eq('id', id)))
    const req = { job_id: job.id, from: card.from, reason: card.reason || '', at: card.at, date: job.scheduled_date, status: 'taken', taken_by: { id: user.id, name: user.name }, closed_at: new Date().toISOString() }
    await writeJson(requestPath(job.id), req).catch(() => {})
    await notifyChanges([[job, patch]]).catch(() => {})
  }
  await postMessage({ channel: COVER_CHANNEL, kind: 'took', author: { role: 'employee', id: user.id, name: user.name }, job, text: card.kind === 'cant_go' ? `cobre ${card.from?.name || ''}`.trim() : '' }).catch(() => {})
  return 'ok'
}

/** Employee: "não posso ir" on an own job → cover card for the team (the job stays theirs until someone takes it). */
export async function askCover(job, user, reason = '') {
  const req = { job_id: job.id, from: { id: user.id, name: user.name }, reason: String(reason || '').slice(0, 300), at: new Date().toISOString(), date: job.scheduled_date, status: 'open' }
  await writeJson(requestPath(job.id), req)
  const msg = await postMessage({ channel: COVER_CHANNEL, kind: 'cant_go', author: { role: 'employee', id: user.id, name: user.name }, job, text: req.reason })
  pushChannel(requestPath(job.id), user)
  return msg
}

/** The requester (or the admin) closes a "não posso ir": the job simply stays with the requester. */
export async function cancelCover(card, user) {
  const req = { job_id: card.job.id, from: card.from, reason: card.reason || '', at: card.at, date: card.job.scheduled_date, status: 'cancelled', closed_by: { id: user.id, name: user.name, role: user.role }, closed_at: new Date().toISOString() }
  await writeJson(requestPath(card.job.id), req)
  await postMessage({ channel: COVER_CHANNEL, kind: 'cancel', author: { role: user.role, id: user.id, name: user.name }, job: card.job, text: user.id === card.from?.id ? '' : `pedido de ${card.from?.name || ''}` }).catch(() => {})
}

/** Admin: put a job with nobody into the channel as an open offer (same as "Ofertar"). Never assigns. */
export async function offerToTeam(job, admin) {
  await offerJob(job)
  const msg = await postMessage({ channel: COVER_CHANNEL, kind: 'cover', author: { role: 'admin', id: admin.id, name: admin.name }, job })
  pushChannel(msg.path, admin)
  return msg
}
