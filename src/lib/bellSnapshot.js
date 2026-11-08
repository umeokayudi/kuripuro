// v1.0.171 · the bell ("Aguardando você") as plain data, the same lists the admin bell loads.
// Used by the server (api/_push.js op=bell) to send every new bell item as a push notification.
import { fetchPendingTimeOff } from './timeOff.js'
import { fetchAutoClosedPeriods } from './payrollAlerts.js'
import { fetchPendingQuoteRequests } from './quoteRequests.js'
import { fetchQuoteFlowAlerts } from './quoteFlow.js'
import { fetchAssignAlerts } from './assignNotices.js'
import { fetchExceptions } from './exceptionQueue.js'
import { fetchOtpRouteAlerts } from './jobDeadline.js'
import { fetchDayPanels } from './dayPanel.js'
import { addDays } from './schedulePlan.js'
import { buildBellQueue } from './bellQueue.js'
import { serviceOffers } from './facilityModel.js'
import { listApprovedModels, listServiceLog, listRecommendations } from './facilityApi.js'

export const tokyoNow = (now = new Date()) => {
  const d = new Date(now.getTime() + 9 * 3600_000)
  return { today: d.toISOString().slice(0, 10), nowMin: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

async function facilityOffers() {
  const [models, logs, recs] = await Promise.all([listApprovedModels(), listServiceLog({ limit: 3000 }), listRecommendations({ status: 'pending' }).catch(() => [])])
  const offered = new Set(recs.map(r => `${r.model_id}:${r.element_id}:${String(r.service || '').toLowerCase()}`))
  return serviceOffers(models, logs).map(r => ({ ...r, id: `fac:${r.key}` })).filter(r => !offered.has(`${r.model_id}:${r.element_id}:${r.task_name.toLowerCase()}`))
}

const safe = p => Promise.resolve().then(() => p()).catch(() => null)

/** Returns { groups, count, today } like the admin bell (without the per-browser "seen" filter). */
export async function fetchBellSnapshot(now = new Date()) {
  const { today, nowMin } = tokyoNow(now)
  const [list, periods, quoteRows, flow, offerRows, assign, panels, exc, otp] = await Promise.all([
    safe(() => fetchPendingTimeOff(today)),
    safe(() => fetchAutoClosedPeriods()),
    safe(() => fetchPendingQuoteRequests()),
    safe(() => fetchQuoteFlowAlerts()),
    safe(() => facilityOffers()),
    safe(() => fetchAssignAlerts()),
    safe(() => fetchDayPanels(today, addDays(today, 1), { nowMin, today })),
    safe(() => fetchExceptions({ hideTests: true })),
    safe(() => fetchOtpRouteAlerts(today, nowMin)),
  ])
  const queue = buildBellQueue({
    exceptions: exc || [],
    panel: panels?.find(x => x.date === today) || null,
    nextPanel: panels?.find(x => x.date !== today) || null,
    routeAlerts: otp || [],
    timeOff: list || [], quotes: quoteRows || [], toBook: flow?.toBook || [], flowDone: flow?.done || [],
    payroll: periods || [], offers: offerRows || [], taken: assign?.accepted || [], today,
  })
  return { ...queue, today }
}
