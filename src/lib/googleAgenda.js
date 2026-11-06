// v1.0.179 · browser side of "Sincronizar Google Agenda" (server: api/_google-calendar.js).
const AUTO_KEY = 'kp_google_auto_sync_at'
const AUTO_EVERY_MS = 30 * 60 * 1000

async function call(op, body) {
  const res = await fetch(`/api/google/${op}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`)
    err.needsSql = Boolean(data.needsSql)
    err.status = res.status
    throw err
  }
  return data
}

export const googleStatus = () => call('status')
export const saveGoogleSettings = patch => call('settings', patch)
export const updateGoogleAccount = (id, patch) => call('account', { id, ...patch })
export const disconnectGoogleAccount = id => call('disconnect', { id })
export const googleInviteLink = employeeId => call('invite', { employee_id: employeeId })
export const previewGoogleEvents = ({ from, to, accountIds } = {}) => call('preview', { from, to, account_ids: accountIds })
export const importGoogleDrafts = items => call('import', { items })
export const ignoreGoogleEvents = keys => call('ignore', { keys })
export const syncGoogleNow = () => call('sync', {})

/** Where the browser goes to connect a Google account (admin itself, or an employee on this device). */
export const googleConnectUrl = employeeId => `/api/google/connect${employeeId ? `?employee=${encodeURIComponent(employeeId)}` : ''}`

/**
 * Admin app open → quiet background sync at most every 30 min per device (the daily cron is the
 * safety net). Errors are ignored: no SQL yet / no Google set up just means nothing to do.
 */
export function maybeAutoSync() {
  try {
    const last = Number(localStorage.getItem(AUTO_KEY) || 0)
    if (Date.now() - last < AUTO_EVERY_MS) return
    localStorage.setItem(AUTO_KEY, String(Date.now()))
  } catch { return }
  syncGoogleNow().then(r => {
    if (r?.pending || r?.imported) window.dispatchEvent(new CustomEvent('kp:google-sync', { detail: r }))
  }).catch(() => {})
}
