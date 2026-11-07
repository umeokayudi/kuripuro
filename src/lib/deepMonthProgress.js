// v1.0.167 · Deep Cleaning of the month: what the active contracts ask for (store × subtype × times a month)
// against the jobs of the month. Read-only: only reads contracts + jobs, never writes.
//   EXPECTED  = deep items of the ACTIVE contracts of a store (a job outside the contract does not count)
//   DONE      = a job of that item, status completed, in the month
//   SCHEDULED = a job of that item not completed yet (date + person)
//   MISSING   = expected with no job. A cancelled job does not count (the slot goes back to missing).
// One job never fills the same slot twice; a deep spot fills ONE item only (store + subtype + month).
// The three ways a contract writes the same store ("Ibushio", "Ibushio - Deep Clean", "Ibushio — Grease Trap")
// are merged per store × subtype, so one job is not counted three times.
import { DEEP_TASKS, deepTaskName } from './cleaningType'
import { splitName } from './schedulePlan'
import { isTestClient, isTestJob } from './testData'

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const isBasic = text => /basic/i.test(text || '')

// Monthly deep items the contracts use. "Grill Cleaning" in the OTP contracts is the floor grating
// (their notes list "Stove, Range Hood, Grating, AC").
export const DEEP_ITEM_ORDER = ['grease_trap', 'range_hood', 'ac', 'grating', 'stove']
const EXTRA_WORDS = {
  range_hood: ['range hood', 'coifa', 'レンジフード'],
  grease_trap: ['grease trap', 'caixa de gordura', 'グリストラップ', 'グリスト'],
  grating: ['grating', 'grill', 'grelha', 'グレーティング'],
  stove: ['stove', 'fogão', 'fogao', 'コンロ'],
  ac: ['ac cleaning', 'ac filter', 'ar condicionado', 'ar-condicionado', 'エアコン', 'ac'],
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORDS = DEEP_ITEM_ORDER.map(id => {
  const t = DEEP_TASKS.find(x => x.id === id)
  const words = [...new Set([...(EXTRA_WORDS[id] || []), t?.label, t?.ja, t?.pt].filter(Boolean).map(w => w.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
  // Latin words need word boundaries ("ac" must not match inside another word); Japanese words don't.
  const re = new RegExp(words.map(w => (/^[ -~]+$/.test(w) ? `(?<![a-z])${esc(w)}(?![a-z])` : esc(w))).join('|'), 'i')
  return { id, re, words }
})

/** Deep subtypes named in a text, in the order they appear: "Range Hood + AC + Grease Trap x2" → [...] */
export function deepSubtypes(text) {
  const s = String(text || '')
  const found = []
  for (const w of WORDS) {
    const m = w.re.exec(s)
    if (m) found.push({ id: w.id, at: m.index, end: m.index + m[0].length })
  }
  return found.sort((a, b) => a.at - b.at)
}

/** Times a month written next to a subtype ("Grease Trap 2x", "Grease Trap x2", "2x Grease Trap"). */
function timesNear(text, hit) {
  const after = String(text).slice(hit.end, hit.end + 6)
  const before = String(text).slice(Math.max(0, hit.at - 4), hit.at)
  const m = /^\s*(?:x\s*(\d)|(\d)\s*x)/i.exec(after) || /(\d)\s*x\s*$/i.exec(before)
  return m ? Number(m[1] || m[2]) : 1
}

/** "2x por mês" / "1x por mês" in the contract notes; null for "por ano" / "quando necessário". */
function monthlyFromNotes(notes) {
  const m = /(\d+)\s*x\s*(?:por|ao|\/)\s*m[eê]s/i.exec(String(notes || ''))
  return m ? Number(m[1]) : null
}

/**
 * Expected deep items per client → store → subtype ({ times }).
 * Store contracts = the client's contracts with weekdays (their base name is the store).
 * Generic items (no weekdays, base that is not a store, e.g. "OTP — Grease Trap · 2x por mês")
 * apply to each store of that client that has a deep contract, never as a store of their own.
 */
export function expectedDeepItems(contracts, clients = []) {
  const clientById = Object.fromEntries((clients || []).map(c => [c.id, c]))
  const out = {}
  const byClient = {}
  for (const c of contracts || []) {
    if (c.is_active === false) continue
    const cl = clientById[c.client_id]
    if (!cl || cl.is_active === false || isTestClient(cl)) continue
    ;(byClient[c.client_id] = byClient[c.client_id] || []).push(c)
  }
  for (const [clientId, list] of Object.entries(byClient)) {
    const storeBases = new Set(list.filter(c => (c.days_of_week || []).length).map(c => norm(splitName(c.location_name).base)))
    const stores = {}
    const generic = {}
    const add = (map, key, name, id, times) => {
      const s = map[key] || (map[key] = { name, items: {}, contracts: [] })
      s.items[id] = Math.max(s.items[id] || 0, times)
      return s
    }
    for (const c of list) {
      const { base, rest } = splitName(c.location_name)
      const text = `${rest} ${c.service_type || ''}`
      if (isBasic(c.service_type) && !rest) continue
      const hits = deepSubtypes(text)
      if (!hits.length) continue
      const isStore = storeBases.has(norm(base))
      if (!isStore) {
        // generic monthly item; yearly / on-demand items are not monthly → left out
        if (!(c.days_of_week || []).length && hits.length === 1) {
          const times = monthlyFromNotes(c.notes) || Number(c.visits_per_month) || 0
          if (times > 0) generic[hits[0].id] = Math.max(generic[hits[0].id] || 0, times)
        }
        continue
      }
      const single = hits.length === 1 && deepSubtypes(rest).length === 1
      for (const h of hits) {
        const times = single ? (Number(c.visits_per_month) || monthlyFromNotes(c.notes) || 1) : timesNear(text, h)
        add(stores, norm(base), base, h.id, times).contracts.push(c.id)
      }
    }
    for (const s of Object.values(stores)) {
      for (const [id, times] of Object.entries(generic)) s.items[id] = Math.max(s.items[id] || 0, times)
    }
    if (Object.keys(stores).length) {
      out[clientId] = { clientId, clientName: clientById[clientId]?.company_name || '—', stores }
    }
  }
  return out
}

const jobStoreKey = title => norm(splitName(title).base)

/**
 * Progress of the month. `jobs` = jobs of the month (any status; cancelled and test ones are dropped here).
 * @returns {Array<{ clientId, clientName, totals, stores: Array<{ key, name, items: Array, totals }>, extras }>}
 */
export function deepMonthProgress(contracts, clients, jobs) {
  const expected = expectedDeepItems(contracts, clients)
  const live = (jobs || []).filter(j => j.status !== 'cancelled' && !isTestJob(j) && !isBasic(splitName(j.title).rest))
  const result = []
  for (const cli of Object.values(expected)) {
    const cliName = norm(cli.clientName)
    const ofClient = live.filter(j => (j.client_id ? j.client_id === cli.clientId : norm(j.client_name) === cliName))
    const used = new Set()
    const stores = []
    for (const [key, st] of Object.entries(cli.stores)) {
      const here = ofClient
        .filter(j => jobStoreKey(j.title) === key)
        .map(j => ({ job: j, subs: deepSubtypes(splitName(j.title).rest).map(h => h.id) }))
        .filter(x => x.subs.length)
        .sort((a, b) => (a.job.status === 'completed' ? 0 : 1) - (b.job.status === 'completed' ? 0 : 1)
          || String(a.job.scheduled_date).localeCompare(String(b.job.scheduled_date)))
      const spotUsed = new Set()
      const items = DEEP_ITEM_ORDER.filter(id => st.items[id]).map(id => {
        const times = st.items[id]
        const slots = []
        for (const x of here) {
          if (slots.length >= times) break
          if (!x.subs.includes(id)) continue
          if (x.job.job_category === 'spot') {
            // a spot fills one item only: its first listed subtype that still needs it
            if (spotUsed.has(x.job.id)) continue
            spotUsed.add(x.job.id)
          }
          slots.push(x.job)
          used.add(x.job.id)
        }
        const done = slots.filter(j => j.status === 'completed').length
        const scheduled = slots.length - done
        return { id, times, jobs: slots, done, scheduled, missing: times - slots.length }
      })
      const totals = items.reduce((t, i) => ({ expected: t.expected + i.times, done: t.done + i.done, scheduled: t.scheduled + i.scheduled, missing: t.missing + i.missing }), { expected: 0, done: 0, scheduled: 0, missing: 0 })
      stores.push({ key, name: st.name, items, totals })
    }
    stores.sort((a, b) => a.name.localeCompare(b.name))
    const totals = stores.reduce((t, s) => ({ expected: t.expected + s.totals.expected, done: t.done + s.totals.done, scheduled: t.scheduled + s.totals.scheduled, missing: t.missing + s.totals.missing }), { expected: 0, done: 0, scheduled: 0, missing: 0 })
    // deep jobs of this client that fill no expected item (store or subtype outside the contract, or surplus)
    const extras = ofClient.filter(j => !used.has(j.id) && /deep|グリスト|レンジ|エアコン/i.test(j.title || '') )
    result.push({ clientId: cli.clientId, clientName: cli.clientName, stores, totals, extras })
  }
  return result.sort((a, b) => b.totals.expected - a.totals.expected)
}

export const pct = t => (t.expected ? Math.round((t.done / t.expected) * 100) : 0)

/** Short chip name: "Coifa", "Caixa de gordura", "AC"… */
export function deepItemName(id, lang) {
  if (id === 'ac') return lang === 'ja' ? 'エアコン' : 'AC'
  const t = DEEP_TASKS.find(x => x.id === id)
  return t ? deepTaskName(t, lang) : id
}

/** Chip tone: green all done · blue all have a job · amber part · red nothing. */
export function itemTone(it) {
  if (it.done >= it.times) return 'done'
  if (it.missing === 0) return 'scheduled'
  return it.done + it.scheduled > 0 ? 'partial' : 'missing'
}

/** Month bounds "2026-11" → ["2026-11-01", "2026-11-30"]. */
export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}
