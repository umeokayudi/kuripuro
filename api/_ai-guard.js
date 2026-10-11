// Shared limits for every Kuripuro AI chat: work-only topics, short history,
// approval items stay with the admin, and admin writes need a password.

import { createHmac, timingSafeEqual, createHash } from 'node:crypto'

/** Only the most recent turns go to Gemini; older ones cost tokens and add little. */
export const MAX_HISTORY = 8

export function trimHistory(messages) {
  const recent = messages.slice(-MAX_HISTORY)
  // Gemini expects the conversation to start with the user.
  while (recent.length && recent[0].role === 'assistant') recent.shift()
  return recent
}

export function workOnlyRule(language) {
  return `TOPIC LIMIT (saves tokens, always applies):
- Only help with work and the Kuripuro platform: jobs, schedule, reports, salary, payments, clients, sales, and how to use the app.
- For anything else (general knowledge, jokes, personal advice, news, homework, coding, other companies), do not answer and do not call tools. Reply with one short sentence in ${language} saying you only help with work and the Kuripuro platform.
- Keep every answer short and direct.`
}

/** Statuses that mean "waiting for an admin decision". */
const PENDING = new Set(['pending', 'requested', 'submitted', 'review', 'in_review', 'under_review', 'disputed', 'open', 'awaiting_approval'])

/** Fields kept for a pending row: enough to say what is waiting, nothing about the decision. */
const PENDING_KEEP = ['id', 'date', 'claim_date', 'period', 'created_at', 'kind', 'category', 'item_name', 'job_title', 'amount', 'quantity']

export function isPendingRow(row) {
  return row && typeof row === 'object' && PENDING.has(String(row.status || '').toLowerCase())
}

export function maskPendingRows(rows) {
  if (!Array.isArray(rows)) return rows
  return rows.map(row => {
    if (!isPendingRow(row)) return row
    const kept = { status: 'waiting_for_admin' }
    for (const key of PENDING_KEEP) if (row[key] !== undefined) kept[key] = row[key]
    return kept
  })
}

export const PENDING_RULE = `APPROVALS:
- Records with status "waiting_for_admin" are still being decided by the administrator.
- Only say that the item is waiting for the administrator's decision. Do not guess, promise, discuss, or argue about the outcome, and do not suggest ways to speed it up.
- You cannot approve, reject, request, or change anything. To create or follow a request, tell the person to use the matching screen in the app.`

// ── Admin write authorization ──────────────────────────────────────────────

const APPROVAL_TTL = 10 * 60

function approvalSecret() {
  const value = process.env.SALES_SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SALES_SESSION_SECRET deve ter pelo menos 32 caracteres.')
  return value
}

function sign(value) {
  return createHmac('sha256', `ai-approval:${approvalSecret()}`).update(value).digest('base64url')
}

/** Signed, short-lived bundle of the changes the AI proposed; nothing is stored server-side. */
export function createApprovalToken(adminId, actions) {
  const payload = Buffer.from(JSON.stringify({ sub: adminId, actions, exp: Math.floor(Date.now() / 1000) + APPROVAL_TTL })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readApprovalToken(token, adminId) {
  const [payload, signature, extra] = String(token || '').split('.')
  if (!payload || !signature || extra) return null
  const expected = Buffer.from(sign(payload))
  const supplied = Buffer.from(signature)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (data.sub !== adminId || data.exp < Date.now() / 1000 || !Array.isArray(data.actions)) return null
    return data.actions
  } catch { return null }
}

export function approvalPasswordConfigured() {
  return Boolean(process.env.AI_APPROVAL_PASSWORD)
}

export function checkApprovalPassword(password) {
  const stored = process.env.AI_APPROVAL_PASSWORD
  if (!stored) return false
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const a = createHash('sha256').update(String(password || '')).digest()
  const b = createHash('sha256').update(stored).digest()
  return timingSafeEqual(a, b)
}

const failures = new Map()

export function approvalLocked(adminId) {
  const entry = failures.get(adminId)
  if (!entry) return false
  if (entry.reset <= Date.now()) { failures.delete(adminId); return false }
  return entry.count >= 5
}

export function recordApprovalFailure(adminId) {
  const now = Date.now()
  const entry = failures.get(adminId)
  if (!entry || entry.reset <= now) failures.set(adminId, { count: 1, reset: now + 15 * 60_000 })
  else entry.count += 1
}

export function clearApprovalFailures(adminId) {
  failures.delete(adminId)
}

/** Plain-language line for one proposed change, shown next to the password field. */
export function describeAction(action) {
  const filters = Object.entries(action.filters || {})
    .map(([k, v]) => `${k} = ${typeof v === 'object' && v ? `${v.op} ${v.value}` : v}`)
    .join(', ')
  const fields = obj => Object.entries(obj || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')
  if (action.name === 'insert_data') {
    const rows = Array.isArray(action.data?.rows) ? action.data.rows : [action.data]
    return { kind: 'create', table: action.table, text: `${rows.length}× ${rows.map(fields).join(' | ')}` }
  }
  if (action.name === 'update_data') return { kind: 'update', table: action.table, text: `${filters} → ${fields(action.changes)}` }
  return { kind: 'delete', table: action.table, text: filters }
}
