import { supabase } from '../../lib/supabase'
import { fill } from '../../hooks/useLang'
import { serviceOffers } from '../../lib/facilityModel'
import { listApprovedModels, listServiceLog, listRecommendations, offerService } from '../../lib/facilityApi'

/** Linha "há X dias sem fazer" / "vence em X dias" de um serviço para oferecer (admin e vendedor). */
export function offerWhen(row, t) {
  if (row.status === 'overdue') return fill(t.notDoneFor, { n: row.daysSince, i: row.interval_days })
  if (row.daysLeft === 0) return t.dueToday
  return fill(t.dueIn, { n: row.daysLeft, since: row.daysSince })
}

/**
 * Smart Facility "oferecer tal serviço para tal cliente": atrasado ou vencendo em até 14 dias,
 * em todas as lojas aprovadas. Mostrado dentro do sino do admin (TimeOffCenter) desde a v1.0.79;
 * antes era um botão 🧽 separado no topo.
 */
export async function fetchFacilityOffers() {
  const [models, logs, recs, { data: clients }] = await Promise.all([
    listApprovedModels(),
    listServiceLog({ limit: 3000 }),
    listRecommendations({ status: 'pending' }).catch(() => []),
    supabase.from('clients').select('id,company_name'),
  ])
  const names = new Map((clients || []).map(c => [c.id, c.company_name]))
  const offered = new Set(recs.map(r => `${r.model_id}:${r.element_id}:${String(r.service || '').toLowerCase()}`))
  return serviceOffers(models, logs)
    .map(r => ({
      ...r,
      id: `fac:${r.key}`,
      client_name: names.get(r.client_id) || '',
      offered: offered.has(`${r.model_id}:${r.element_id}:${r.task_name.toLowerCase()}`),
    }))
    .filter(r => !r.offered)
}

/** Manda a recomendação para o cliente (aparece no portal dele). `t` = textos de t.facility. */
export function offerToClient(r, t) {
  return offerService({
    model: { id: r.model_id, client_id: r.client_id, location_name: r.location },
    element: { id: r.element_id, name: r.element_name },
    task: { name: r.task_name },
    reason: offerWhen(r, t),
    priority: r.status === 'overdue' ? 'high' : 'medium',
  })
}
