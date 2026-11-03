// v1.0.133 · "Descartar" a suggestion of the Schedule Generator preview so it never comes back for that
// date / store / type (e.g. the 4 fortnightly OTP deeps suggested on Wed 04/11 when the right day is
// Sun/Mon 08–09/11). Saved in schedule_dismissals (sql/2026-11-03_pendentes_revisao.sql); until that SQL
// runs, it is kept in this browser (localStorage) so a reload still does not bring it back. Undo = trash.
import { asItem } from './assignFlow.js'

const LS = 'kp_schedule_dismissed'
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/** '<date>|<store>|<type>' of a preview row (same store / type rule as the preview). */
export function dismissKey(row) {
  const it = asItem(row)
  const type = it.deep || /deep/i.test(row?.title || '') || row?.type === 'deep' ? 'deep' : 'basic'
  return `${row.date}|${norm(it.place)}|${type}`
}

const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]') } catch { return [] } }
const writeLocal = list => { try { localStorage.setItem(LS, JSON.stringify(list.slice(-500))) } catch { /* private mode */ } }
const isMissing = err => /schedule_dismissals|schema cache|does not exist|PGRST205/i.test(`${err?.message || ''} ${err?.code || ''}`)

/** Dismissed rows of the period: [{ dismiss_key, scheduled_date, location_name, service_type, title, ... }] and where they live. */
export async function loadDismissals(db, from, to) {
  const { data, error } = await db.from('schedule_dismissals').select('*').gte('scheduled_date', from).lte('scheduled_date', to)
  const local = readLocal().filter(r => r.scheduled_date >= from && r.scheduled_date <= to)
  if (error) return { rows: local, store: isMissing(error) ? 'local' : 'local' }
  const keys = new Set((data || []).map(r => r.dismiss_key))
  return { rows: [...(data || []), ...local.filter(r => !keys.has(r.dismiss_key))], store: 'db' }
}

export async function dismissRow(db, row, who = 'admin') {
  const it = asItem(row)
  const rec = {
    dismiss_key: dismissKey(row), scheduled_date: row.date, location_name: it.place,
    service_type: row.title?.split(' — ')[1] || null, title: row.title, employee_id: row.employeeId || null,
    dismissed_by: who, dismissed_at: new Date().toISOString(),
  }
  const { error } = await db.from('schedule_dismissals').upsert(rec, { onConflict: 'dismiss_key' })
  if (error) {
    writeLocal([...readLocal().filter(r => r.dismiss_key !== rec.dismiss_key), rec])
    return { ...rec, store: 'local' }
  }
  return { ...rec, store: 'db' }
}

export async function restoreDismissal(db, key) {
  writeLocal(readLocal().filter(r => r.dismiss_key !== key))
  await db.from('schedule_dismissals').delete().eq('dismiss_key', key).then(() => {}, () => {})
}
