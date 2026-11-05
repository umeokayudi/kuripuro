// v1.0.151 · "Aguardando você" (the bell): ONE ordered list, fixed and explained, and the badge = its size.
//   1 atrasados de hoje  → 2 sem cobertura → 3 cobertos aguardando decisão → 4 demais exceções por data
//   → 5 folgas → 6 orçamentos → 7 folha → 8 ofertas → 9 avisos (oferta aceita)
// Items that only someone else can clear (employee confirming a payslip) are listed apart and NOT counted.
// Inside each group the order never depends on load timing: date, then time, then store, then service, then id.

export const BELL_GROUPS = [
  { key: 'late', icon: '⏰' },
  { key: 'uncovered', icon: '⚠️' },
  { key: 'covered', icon: '🔁' },
  { key: 'exceptions', icon: '🚨' },
  { key: 'dayoff', icon: '🗓' },
  { key: 'quotes', icon: '📝' },
  { key: 'payroll', icon: '💴' },
  { key: 'offers', icon: '🧽' },
  { key: 'info', icon: '⚡' },
  { key: 'waiting', icon: '⏳', notCounted: true },
]

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''))
const stable = (a, b) => cmp(a.date, b.date) || cmp(a.time, b.time) || cmp(a.place, b.place) || cmp(a.title, b.title) || cmp(a.who, b.who) || cmp(a.id, b.id)
// job exceptions whose review already covers them (the retroactive review decides the job as a whole)
const COVERED_BY_RETRO = new Set(['no_photo', 'ai_waiting', 'long'])

/**
 * exceptions: buildExceptions() rows. panel: buildDayPanel() of today (for "não pode" / no job created).
 * routeAlerts: otpRouteAlerts(). Others: the bell's own lists (rows with an `id`).
 * Returns { groups: [{ key, icon, items, notCounted }], count } — empty groups left out.
 */
export function buildBellQueue({ exceptions = [], panel = null, routeAlerts = [], timeOff = [], quotes = [], toBook = [], flowDone = [], payroll = [], offers = [], taken = [], today, hidden = new Set() }) {
  const g = Object.fromEntries(BELL_GROUPS.map(x => [x.key, []]))
  const retroJobs = new Set(exceptions.filter(x => x.kind === 'retro_review').map(x => x.jobId))
  for (const x of exceptions) {
    if (hidden.has(x.id)) continue
    if (x.kind === 'payroll_review') continue // the payroll group lists the same months
    if (COVERED_BY_RETRO.has(x.kind) && retroJobs.has(x.jobId)) continue
    if (x.waiting || x.kind === 'paid_unconfirmed') { g.waiting.push(x); continue }
    if (x.kind === 'late' && x.date === today) g.late.push(x)
    else if (x.kind === 'no_person') g.uncovered.push(x)
    else if (x.kind === 'covered') g.covered.push(x)
    else g.exceptions.push(x)
  }
  for (const a of routeAlerts) if (!hidden.has(a.id)) g.late.push({ ...a, kind: 'route', date: a.date || today, time: '', place: '', who: a.employeeName })
  for (const a of panel?.alerts || []) {
    if (hidden.has(a.id)) continue
    if (a.kind === 'cant') g.uncovered.push({ ...a, date: panel.date, time: '', place: a.stores.join(', ') })
    if (a.kind === 'no_job') for (const st of panel.stores.filter(s => s.noJob)) g.uncovered.push({ id: `nojob:${panel.date}:${st.key}`, kind: 'no_job', date: panel.date, time: '', place: st.store, who: st.usualName || '', clientName: st.clientName })
  }
  const push = (key, rows, kind) => { for (const r of rows || []) if (!hidden.has(r.id)) g[key].push({ ...r, kind, _row: r }) }
  push('dayoff', timeOff.map(r => ({ ...r, who: r.employee_name, date: r.date })), 'dayoff')
  push('quotes', quotes, 'quote'); push('quotes', toBook, 'to_book'); push('quotes', flowDone, 'flow_done')
  push('payroll', payroll.map(p => ({ ...p, date: p.period })), 'payroll')
  push('offers', offers, 'offer')
  push('info', taken.map(t => ({ ...t, date: t.scheduled_date, time: String(t.scheduled_time || '').slice(0, 5), who: t.employee_name })), 'taken')

  // fixed order inside each group
  const KIND_ORDER = { route: 0, late: 1, cant: 0, no_person: 1, no_job: 2 }
  for (const key of ['late', 'uncovered']) g[key].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || stable(a, b))
  for (const key of ['covered', 'exceptions', 'dayoff', 'payroll', 'info', 'waiting']) g[key].sort(stable)
  // quotes / offers keep their kind blocks (pedido → marcar data → feito) and a stable order inside
  const QK = { quote: 0, to_book: 1, flow_done: 2 }
  g.quotes.sort((a, b) => QK[a.kind] - QK[b.kind] || cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
  g.offers.sort((a, b) => cmp(a.status === 'overdue' ? 0 : 1, b.status === 'overdue' ? 0 : 1) || cmp(a.location, b.location) || cmp(a.id, b.id))

  const groups = BELL_GROUPS.filter(x => g[x.key].length).map(x => ({ ...x, items: g[x.key] }))
  const count = groups.filter(x => !x.notCounted).reduce((s, x) => s + x.items.length, 0)
  return { groups, count }
}

/** Badge text: the real number, never "9+". */
export const badgeText = n => String(n)
