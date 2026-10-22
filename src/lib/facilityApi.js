import { supabase } from './supabase'
import { apiPost } from './apiFetch'
import { normalizeLayout, ruleRecommendations, dedupeRecommendations, withServiceLog, elementTasks, taskForLog } from './facilityModel'
import { uploadJobPhoto } from './uploadPhoto'

export function isMissingFacilityTable(error) {
  const msg = error?.message || ''
  return error?.code === 'PGRST205' || error?.code === '42P01' || msg.includes('facility_')
}

export async function checkFacilitySchema() {
  const { error } = await supabase.from('facility_models').select('id').limit(1)
  return !isMissingFacilityTable(error)
}

function rowToModel(row) {
  return row ? { ...row, layout: normalizeLayout(row.layout), photos: Array.isArray(row.photos) ? row.photos : [] } : null
}

export async function listModels(clientId) {
  const { data, error } = await supabase
    .from('facility_models')
    .select('*')
    .eq('client_id', clientId)
    .order('location_name', { ascending: true })
  if (error) throw error
  return (data || []).map(rowToModel)
}

export async function createModel({ clientId, locationName, name, layout }) {
  const { data, error } = await supabase
    .from('facility_models')
    .insert({
      client_id: clientId,
      location_name: locationName || null,
      name,
      layout: normalizeLayout(layout),
      photos: [],
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw error
  return rowToModel(data)
}

export async function saveModel(model) {
  const patch = {
    name: model.name,
    location_name: model.location_name || null,
    layout: normalizeLayout(model.layout),
    photos: model.photos || [],
    status: model.status,
    ai_notes: model.ai_notes || null,
    approved_at: model.status === 'approved' ? (model.approved_at || new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('facility_models').update(patch).eq('id', model.id).select('*').single()
  if (error) throw error
  return rowToModel(data)
}

export async function deleteModel(id) {
  const { error } = await supabase.from('facility_models').delete().eq('id', id)
  if (error) throw error
}

/**
 * Modelo aprovado para um local (cliente/funcionário só veem modelos revisados pelo admin).
 * Sem location_name → primeiro modelo aprovado do cliente.
 */
export async function loadApprovedModel(clientId, locationName, { allowDraft = false } = {}) {
  if (!clientId) return null
  let q = supabase
    .from('facility_models')
    .select('*')
    .eq('client_id', clientId)
  if (!allowDraft) q = q.eq('status', 'approved')
  const { data, error } = await q
  if (error) return null
  // funcionário: aprovado primeiro; rascunho só se ainda não houver aprovado
  const rows = (data || []).sort((a, b) => (a.status === 'approved' ? 0 : 1) - (b.status === 'approved' ? 0 : 1))
  // contratos às vezes têm o serviço no nome ("Ibushio - Deep Clean"); o mapa é da loja ("Ibushio")
  const base = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim().toLowerCase()
  const exact = locationName ? (rows.find(r => r.location_name === locationName) || rows.find(r => r.location_name && base(r.location_name) === base(locationName))) : null
  const fallback = rows.find(r => !r.location_name) || (!locationName ? rows[0] : null)
  return rowToModel(exact || fallback || null)
}

export async function listRecommendations({ modelId, clientId, locationName, status } = {}) {
  let q = supabase.from('facility_recommendations').select('*').order('created_at', { ascending: false })
  if (modelId) q = q.eq('model_id', modelId)
  if (clientId) q = q.eq('client_id', clientId)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) {
    if (isMissingFacilityTable(error)) return []
    throw error
  }
  const rows = data || []
  return locationName ? rows.filter(r => !r.location_name || r.location_name === locationName) : rows
}

/** Histórico recente de visitas do local, usado pela IA para recomendar serviços. */
async function recentHistory(clientId, locationName) {
  const { data } = await supabase
    .from('jobs')
    .select('title,scheduled_date,status')
    .eq('client_id', clientId)
    .order('scheduled_date', { ascending: false })
    .limit(120)
  const rows = (data || []).filter(j => !locationName || (j.title || '').includes(locationName))
  return rows.slice(0, 60).map(j => ({ date: j.scheduled_date, title: j.title, status: j.status }))
}

/**
 * Gera recomendações: regras de intervalo + IA (quando disponível).
 * Insere somente as novas (sem duplicar pendentes). Retorna { inserted, aiUsed, aiError }.
 */
export async function generateRecommendations(model) {
  const existing = await listRecommendations({ modelId: model.id })
  const logs = await listServiceLog({ modelId: model.id })
  const layout = withServiceLog(model.layout, logs)
  const rules = ruleRecommendations(layout).map(r => ({ ...r, source: 'rule' }))

  let ai = []
  let aiError = null
  try {
    const history = await recentHistory(model.client_id, model.location_name)
    const resp = await apiPost('/api/admin-ai', {
      facilityAction: 'recommend',
      layout,
      history: [
        ...logs.slice(0, 40).map(l => ({ date: l.service_date, title: `${l.service || 'Cleaning'} — ${l.element_name || ''}`, status: 'completed' })),
        ...history,
      ],
      locationName: model.location_name || model.name,
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`)
    ai = (body.recommendations || []).map(r => ({ ...r, source: 'ai' }))
  } catch (e) {
    aiError = e.message
  }

  const fresh = dedupeRecommendations([...ai, ...rules], existing)
  if (fresh.length) {
    const { error } = await supabase.from('facility_recommendations').insert(fresh.map(r => ({
      model_id: model.id,
      client_id: model.client_id,
      location_name: model.location_name || null,
      element_id: r.element_id,
      element_name: r.element_name,
      service: r.service,
      reason: r.reason,
      priority: r.priority,
      source: r.source,
      status: 'pending',
    })))
    if (error) throw error
  }
  return { inserted: fresh.length, aiUsed: ai.length > 0, aiError }
}

/**
 * Cliente (ou admin em nome dele) aceita/recusa uma recomendação.
 * Aceitar cria uma solicitação em client_requests, entrando no fluxo normal de pedidos.
 */
export async function decideRecommendation(rec, decision, { by, clientUserId } = {}) {
  if (!['accepted', 'declined'].includes(decision)) throw new Error('invalid decision')
  let clientRequestId = rec.client_request_id || null
  if (decision === 'accepted' && !clientRequestId) {
    const { data, error } = await supabase.from('client_requests').insert({
      client_id: rec.client_id,
      client_user_id: clientUserId || null,
      location_name: rec.location_name || null,
      description: `[Smart Facility] ${rec.service}${rec.element_name ? ` — ${rec.element_name}` : ''}${rec.reason ? `\n${rec.reason}` : ''}`,
      status: 'pending',
      ticket_number: `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    }).select('id').single()
    if (error) throw error
    clientRequestId = data?.id || null
  }
  const { error } = await supabase.from('facility_recommendations').update({
    status: decision,
    decided_by: by || null,
    decided_at: new Date().toISOString(),
    client_request_id: clientRequestId,
  }).eq('id', rec.id)
  if (error) throw error
}

export async function deleteRecommendation(id) {
  const { error } = await supabase.from('facility_recommendations').delete().eq('id', id)
  if (error) throw error
}

/** Histórico de limpezas por equipamento (vinculado aos serviços). Sem tabela → lista vazia. */
export async function listServiceLog({ modelId, clientId, jobId, limit = 300 } = {}) {
  let q = supabase.from('facility_service_log').select('*').order('service_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit)
  if (modelId) q = q.eq('model_id', modelId)
  if (clientId) q = q.eq('client_id', clientId)
  if (jobId) q = q.eq('job_id', jobId)
  const { data, error } = await q
  if (error) return []
  return data || []
}

/**
 * Funcionário (ou admin) registra uma limpeza ou manutenção do equipamento.
 * service = nome da tarefa (padrão: a primeira limpeza). Fotos opcionais.
 * Recomendações abertas dessa mesma tarefa passam a 'done'.
 */
export async function logElementService({ model, element, job, employee, notes, files = [], service = null, date = null }) {
  const photos = []
  for (const [i, file] of [...files].entries()) {
    const base = job?.id ? `jobs/${job.id}/facility_${element.id}_${Date.now()}_${i}.jpg` : `facility/${model.id}/${element.id}_${Date.now()}_${i}.jpg`
    photos.push(await uploadJobPhoto(base, file))
  }
  const tasks = elementTasks(element)
  const task = taskForLog(tasks, { service })
  const name = service || task?.name || null
  const row = {
    model_id: model.id,
    client_id: model.client_id,
    location_name: model.location_name || null,
    element_id: element.id,
    element_name: element.name,
    service: name,
    job_id: job?.id || null,
    employee_id: employee?.id || null,
    employee_name: employee?.name || null,
    notes: (notes || '').trim() || null,
    photos,
  }
  if (date) row.service_date = date
  const { data, error } = await supabase.from('facility_service_log').insert(row).select('*').single()
  if (error) throw error

  // fecha as recomendações abertas desta tarefa (as da IA com nome diferente contam como a limpeza principal)
  const { data: open } = await supabase.from('facility_recommendations')
    .select('id,service')
    .eq('model_id', model.id)
    .eq('element_id', element.id)
    .in('status', ['pending', 'accepted'])
  const names = new Set(tasks.map(x => x.name.toLowerCase()))
  const done = taskForLog(tasks, { service: name })
  const ids = (open || []).filter(r => {
    const rs = String(r.service || '').toLowerCase()
    if (rs === String(name || '').toLowerCase()) return true
    return !names.has(rs) && done?.type === 'cleaning' && done === tasks.find(x => x.type === 'cleaning')
  }).map(r => r.id)
  if (ids.length) await supabase.from('facility_recommendations').update({ status: 'done' }).in('id', ids)
  return data
}

/** Admin oferece ao cliente uma limpeza/manutenção da agenda (vira recomendação pendente no portal). */
export async function offerService({ model, element, task, reason, priority = 'medium' }) {
  const { data: open } = await supabase.from('facility_recommendations')
    .select('id,service')
    .eq('model_id', model.id)
    .eq('element_id', element.id)
    .eq('status', 'pending')
  if ((open || []).some(r => String(r.service || '').toLowerCase() === task.name.toLowerCase())) return { duplicate: true }
  const { error } = await supabase.from('facility_recommendations').insert({
    model_id: model.id,
    client_id: model.client_id,
    location_name: model.location_name || null,
    element_id: element.id,
    element_name: element.name,
    service: task.name,
    reason,
    priority,
    source: 'rule',
    status: 'pending',
  })
  if (error) throw error
  return { duplicate: false }
}

/** Todas as lojas de todos os clientes (tela inicial do Smart Facility: um toque abre a loja). */
export async function listAllModels() {
  const { data, error } = await supabase.from('facility_models').select('*').order('updated_at', { ascending: false })
  if (error) return []
  return (data || []).map(rowToModel)
}

/** Todos os modelos aprovados (painel "serviços para oferecer" de todas as lojas). */
export async function listApprovedModels() {
  const { data, error } = await supabase.from('facility_models').select('*').eq('status', 'approved')
  if (error) return []
  return (data || []).map(rowToModel)
}

export async function deleteServiceLog(id) {
  const { error } = await supabase.from('facility_service_log').delete().eq('id', id)
  if (error) throw error
}
