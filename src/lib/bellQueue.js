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
  // v1.0.160 · accepted quotes left for later ("Agendar depois") until their reminder day
  { key: 'later', icon: '🕒', notCounted: true },
]

const cmp = (a, b) => String(a || '').localeCompare(String(b || ''))
const stable = (a, b) => cmp(a.date, b.date) || cmp(a.time, b.time) || cmp(a.place, b.place) || cmp(a.title, b.title) || cmp(a.who, b.who) || cmp(a.id, b.id)
// job exceptions whose review already covers them (the retroactive review decides the job as a whole)
const COVERED_BY_RETRO = new Set(['no_photo', 'ai_waiting', 'long'])

/**
 * exceptions: buildExceptions() rows. panel: buildDayPanel() of today (for "não pode" / no job created).
 * nextPanel: tomorrow's panel — used only after its cut-off (SEM CONFIRMAÇÃO, free jobs nobody took).
 * routeAlerts: otpRouteAlerts(). Others: the bell's own lists (rows with an `id`).
 * Returns { groups: [{ key, icon, items, notCounted }], count } — empty groups left out.
 */
export function buildBellQueue({ exceptions = [], panel = null, nextPanel = null, routeAlerts = [], timeOff = [], quotes = [], toBook = [], flowDone = [], payroll = [], offers = [], taken = [], today, hidden = new Set() }) {
  const g = Object.fromEntries(BELL_GROUPS.map(x => [x.key, []]))
  const retroJobs = new Set(exceptions.filter(x => x.kind === 'retro_review').map(x => x.jobId))
  for (const x of exceptions) {
    if (hidden.has(x.id)) continue
    if (x.kind === 'payroll_review') continue // the payroll group lists the same months
    // v1.0.165 · 'foto aguardando a IA' is not the admin's job: no bell alert (still on the Dashboard / job card 'IA …')
    if (x.kind === 'ai_waiting') continue
    if (COVERED_BY_RETRO.has(x.kind) && retroJobs.has(x.jobId)) continue
    if (x.waiting || x.kind === 'paid_unconfirmed') { g.waiting.push(x); continue }
    if (x.kind === 'late' && x.date === today) g.late.push(x)
    else if (x.kind === 'no_person') g.uncovered.push(x)
    else if (x.kind === 'covered') g.covered.push(x)
    else g.exceptions.push(x)
  }
  // "rota de hoje ainda não começou" (nothing started at all) already says it: the per-person ones not started are the same news
  const routeNone = (panel?.alerts || []).some(a => a.kind === 'route_none' && !hidden.has(a.id))
  for (const a of routeAlerts) if (!hidden.has(a.id) && !(routeNone && !a.startedAt)) g.late.push({ ...a, kind: 'route', date: a.date || today, time: '', place: '', who: a.employeeName })
  const freeItems = (pn, a) => pn.services.filter(s => a.services.includes(s.id)).map(s => ({ id: `free:${pn.date}:${s.id}`, kind: 'free_uncovered', date: pn.date, time: '', place: s.store, title: s.job.title, job: s.job, service: s.service, deadline: s.deadline, planB: pn.stores.find(st => st.store === s.store)?.planB || [] }))
  for (const a of panel?.alerts || []) {
    if (hidden.has(a.id)) continue
    if (a.kind === 'route_none') g.late.push({ ...a, date: panel.date, time: '', place: '' })
    // today's "rota impossível" stays on the Painel; the bell gets it the evening before (nextPanel), when it can still be split
    if (a.kind === 'free_uncovered') for (const it of freeItems(panel, a)) if (!hidden.has(it.id)) g.uncovered.push(it)
    if (a.kind === 'cant') g.uncovered.push({ ...a, date: panel.date, time: '', place: a.stores.join(', ') })
    if (a.kind === 'no_job') for (const st of panel.stores.filter(s => s.noJob)) g.uncovered.push({ id: `nojob:${panel.date}:${st.key}`, kind: 'no_job', date: panel.date, time: '', place: st.store, who: st.usualName || '', clientName: st.clientName })
  }
  // v1.0.154 · from the cut-off (21:00) of the evening before: tomorrow's gaps are in the bell THAT night
  if (nextPanel?.pastCutoff) {
    for (const p of nextPanel.team) {
      const id = `eve-unconfirmed:${nextPanel.date}:${p.id}`
      if (p.state === 'unconfirmed' && p.expected && !hidden.has(id)) g.uncovered.push({ id, kind: 'eve_unconfirmed', date: nextPanel.date, time: '', place: '', who: p.name, employeeId: p.id, total: p.total })
    }
    for (const a of nextPanel.alerts) {
      if (hidden.has(a.id)) continue
      if (a.kind === 'free_uncovered') for (const it of freeItems(nextPanel, a)) if (!hidden.has(it.id)) g.uncovered.push(it)
      if (a.kind === 'impossible') g.uncovered.push({ ...a, date: nextPanel.date, time: '', place: '' })
      if (a.kind === 'cant') g.uncovered.push({ ...a, date: nextPanel.date, time: '', place: a.stores.join(', ') })
    }
  }
  const push = (key, rows, kind) => { for (const r of rows || []) if (!hidden.has(r.id)) g[key].push({ ...r, kind, _row: r }) }
  push('dayoff', timeOff.map(r => ({ ...r, who: r.employee_name, date: r.date })), 'dayoff')
  push('quotes', quotes, 'quote'); push('quotes', toBook.filter(t => !t.snoozed), 'to_book'); push('later', toBook.filter(t => t.snoozed).map(t => ({ ...t, date: t.later.until })), 'to_book'); push('quotes', flowDone, 'flow_done')
  push('payroll', payroll.map(p => ({ ...p, date: p.period })), 'payroll')
  push('offers', offers, 'offer')
  push('info', taken.map(t => ({ ...t, date: t.scheduled_date, time: String(t.scheduled_time || '').slice(0, 5), who: t.employee_name })), 'taken')

  // fixed order inside each group
  const KIND_ORDER = { route_none: -1, route: 0, late: 1, cant: 0, eve_unconfirmed: 1, free_uncovered: 2, no_person: 3, no_job: 4, impossible: 5 }
  for (const key of ['late', 'uncovered']) g[key].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || stable(a, b))
  for (const key of ['covered', 'exceptions', 'dayoff', 'payroll', 'info', 'waiting', 'later']) g[key].sort(stable)
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
