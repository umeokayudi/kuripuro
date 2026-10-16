// api/_facility-ai.js
// Smart Facility: gera a planta inicial do restaurante a partir de fotos e
// sugere serviços de limpeza com base no modelo e no histórico.
// Servido por /api/admin-ai (body.facilityAction) para não passar do limite
// de 12 funções do Vercel Hobby.

import { geminiGenerate } from './_gemini.js'
import { fetchStorageBuffer } from './_storage.js'
import {
  AREA_KINDS,
  ELEMENT_KINDS,
  normalizeLayout,
} from '../src/lib/facilityModel.js'

const MAX_PHOTOS = 8

function parseJson(data) {
  const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '{}'
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const m = cleaned.match(/[[{][\s\S]*[\]}]/)
    if (m) {
      try { return JSON.parse(m[0]) } catch {}
    }
    return null
  }
}

async function generateLayout({ photos = [], name, width, depth, hints }) {
  const refs = photos.filter(p => typeof p === 'string').slice(0, MAX_PHOTOS)
  if (!refs.length) throw Object.assign(new Error('Envie pelo menos uma foto'), { status: 400 })

  const images = []
  for (const ref of refs) {
    try {
      const { buffer, contentType } = await fetchStorageBuffer(ref)
      images.push({ inlineData: { mimeType: contentType || 'image/jpeg', data: buffer.toString('base64') } })
    } catch {}
  }
  if (!images.length) throw Object.assign(new Error('Não foi possível ler as fotos'), { status: 400 })

  const sizeHint = width && depth
    ? `The floor plan is approximately ${width} m wide and ${depth} m deep.`
    : 'Estimate the overall size in meters (typical small Tokyo restaurant: 8–15 m × 6–10 m).'

  const prompt = `You are a facility surveyor for a commercial cleaning company in Japan.
From these ${images.length} photos of the restaurant "${name || 'restaurant'}", build an approximate top-down floor plan.
${sizeHint}
${hints ? `Extra information from the manager: ${String(hints).slice(0, 800)}` : ''}

Coordinates are in meters; origin (0,0) is the top-left corner; x grows right, y grows down.
Areas must not overlap much and must stay inside the plan. Place each element inside its area.
Only include equipment you can actually see or strongly infer (e.g. a kitchen almost always has a range hood).
For every element write "location_hint" (how a new employee finds it) and, for switches, breakers, valves and machines, short "instructions" on how to turn it on/off or operate it safely. Write hints and instructions in Japanese and English (Japanese first).

Area kinds: ${Object.keys(AREA_KINDS).join(', ')}
Element kinds: ${Object.keys(ELEMENT_KINDS).join(', ')}

Reply ONLY with JSON:
{"width": number, "depth": number,
 "areas": [{"id": "area_1", "name": string, "kind": string, "x": number, "y": number, "w": number, "d": number, "notes": string}],
 "walls": [{"x1": number, "y1": number, "x2": number, "y2": number}],
 "elements": [{"id": "el_1", "name": string, "kind": string, "areaId": string, "x": number, "y": number, "w": number, "d": number, "location_hint": string, "instructions": string}],
 "notes": "what is uncertain and should be checked on site"}`

  const data = await geminiGenerate({
    contents: [{ parts: [...images, { text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 6000, responseMimeType: 'application/json' },
  })
  const parsed = parseJson(data)
  if (!parsed) throw new Error('A IA não retornou uma planta válida — tente novamente ou use o modelo padrão')

  const layout = normalizeLayout(parsed)
  return { layout, notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 2000) : '', photosUsed: images.length }
}

async function recommendServices({ layout, history = [], locationName }) {
  const model = normalizeLayout(layout)
  if (!model.elements.length) return { recommendations: [] }

  const elements = model.elements.map(e => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    last_serviced_at: e.last_serviced_at,
    service_interval_days: e.service_interval_days || ELEMENT_KINDS[e.kind]?.intervalDays || null,
    notes: e.notes,
  }))
  const recent = (Array.isArray(history) ? history : []).slice(0, 60).map(h => ({
    date: String(h.date || '').slice(0, 10),
    title: String(h.title || '').slice(0, 120),
    status: String(h.status || '').slice(0, 20),
  }))
  const catalog = [...new Set(Object.values(ELEMENT_KINDS).map(k => k.service).filter(Boolean))]

  const prompt = `You advise a restaurant cleaning company (KuriPuro, Tokyo).
Location: "${locationName || 'restaurant'}". Today: ${new Date().toISOString().slice(0, 10)}.
Equipment registered in the digital model:
${JSON.stringify(elements)}
Recent cleaning visits (newest first):
${JSON.stringify(recent)}
Services we sell: ${catalog.join('; ')}

Suggest at most 6 cleaning or maintenance services the client would genuinely benefit from now.
Prefer elements with no record or overdue intervals, and kitchen grease/ventilation risks. Do not invent elements.
Reply ONLY with JSON: {"recommendations": [{"element_id": string, "service": string, "reason": string (one sentence, Japanese then English), "priority": "high"|"medium"|"low"}]}`

  const data = await geminiGenerate({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 1500, responseMimeType: 'application/json' },
  })
  const parsed = parseJson(data)
  const list = Array.isArray(parsed) ? parsed : parsed?.recommendations
  const byId = new Map(model.elements.map(e => [e.id, e]))
  const recommendations = (Array.isArray(list) ? list : [])
    .filter(r => r && typeof r.service === 'string' && byId.has(r.element_id))
    .slice(0, 6)
    .map(r => ({
      element_id: r.element_id,
      element_name: byId.get(r.element_id).name,
      service: r.service.slice(0, 120),
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 500) : '',
      priority: ['high', 'medium', 'low'].includes(r.priority) ? r.priority : 'medium',
    }))
  return { recommendations }
}

/** Retorna { status, body } para body.facilityAction = 'generate' | 'recommend'. */
export async function handleFacilityAction({ facilityAction, ...body }) {
  try {
    if (facilityAction === 'generate') return { status: 200, body: await generateLayout(body) }
    if (facilityAction === 'recommend') return { status: 200, body: await recommendServices(body) }
    return { status: 400, body: { error: 'facilityAction must be generate or recommend' } }
  } catch (err) {
    return { status: err.status || 500, body: { error: err.message } }
  }
}
