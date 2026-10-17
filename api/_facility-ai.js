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
  elementTasks,
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

/**
 * Construção aos poucos: a IA olha UMA foto nova junto com a planta atual e devolve
 * só o que essa foto mostra (áreas/equipamentos), já posicionado na planta existente.
 * O navegador junta com mergeLayoutAdditions (não substitui o que o admin já corrigiu).
 */
async function analyzePhoto({ photo, layout, caption, name }) {
  if (typeof photo !== 'string' || !photo) throw Object.assign(new Error('Envie uma foto'), { status: 400 })
  let image
  try {
    const { buffer, contentType } = await fetchStorageBuffer(photo)
    image = { inlineData: { mimeType: contentType || 'image/jpeg', data: buffer.toString('base64') } }
  } catch {
    throw Object.assign(new Error('Não foi possível ler a foto'), { status: 400 })
  }
  const current = normalizeLayout(layout)
  const summary = {
    width: current.width,
    depth: current.depth,
    areas: current.areas.map(a => ({ id: a.id, name: a.name, kind: a.kind, x: a.x, y: a.y, w: a.w, d: a.d })),
    elements: current.elements.map(e => ({ name: e.name, kind: e.kind, x: e.x, y: e.y, w: e.w, d: e.d })),
  }

  const prompt = `You are a facility surveyor for a commercial cleaning company in Japan, building the digital floor plan of "${name || 'a restaurant'}" one photo at a time.
Current plan (meters, origin top-left, x right, y down): ${JSON.stringify(summary)}
${caption ? `The person who took this photo says: ${String(caption).slice(0, 400)}` : ''}

Look at THIS photo only. Return the areas and equipment it shows, placed consistently with the current plan:
- If the photo shows an area already in the plan, reuse its id in "areaId" and do not repeat the area.
- If it shows a new room, add it next to the existing ones (you may enlarge "width"/"depth" if needed).
- If equipment is already in the plan, return it again at the same position (it will be matched, not duplicated).
- Only what you can see or strongly infer. For switches, breakers, valves and machines write short "instructions" (on/off, safety). For everything write "location_hint" (how a new employee finds it). Japanese first, then English.

Area kinds: ${Object.keys(AREA_KINDS).join(', ')}
Element kinds: ${Object.keys(ELEMENT_KINDS).join(', ')}

Reply ONLY with JSON:
{"width": number, "depth": number,
 "areas": [{"id": string, "name": string, "kind": string, "x": number, "y": number, "w": number, "d": number}],
 "walls": [{"x1": number, "y1": number, "x2": number, "y2": number}],
 "elements": [{"name": string, "kind": string, "areaId": string, "x": number, "y": number, "w": number, "d": number, "location_hint": string, "instructions": string}],
 "seen": "one short sentence: what this photo shows"}`

  const data = await geminiGenerate({
    contents: [{ parts: [image, { text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 3000, responseMimeType: 'application/json' },
  })
  const parsed = parseJson(data)
  if (!parsed || typeof parsed !== 'object') throw new Error('A IA não entendeu esta foto — tente outra foto ou descreva o que ela mostra')
  return {
    additions: {
      width: Number(parsed.width) || current.width,
      depth: Number(parsed.depth) || current.depth,
      areas: Array.isArray(parsed.areas) ? parsed.areas.slice(0, 10) : [],
      walls: Array.isArray(parsed.walls) ? parsed.walls.slice(0, 12) : [],
      elements: Array.isArray(parsed.elements) ? parsed.elements.slice(0, 30) : [],
    },
    seen: typeof parsed.seen === 'string' ? parsed.seen.slice(0, 300) : '',
  }
}

async function recommendServices({ layout, history = [], locationName }) {
  const model = normalizeLayout(layout)
  if (!model.elements.length) return { recommendations: [] }

  // care = tarefas com a última data já calculada pelo navegador a partir do histórico
  const rawCare = new Map((Array.isArray(layout?.elements) ? layout.elements : []).map(e => [e?.id, Array.isArray(e?.care) ? e.care : null]))
  const elements = model.elements.map(e => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    tasks: (rawCare.get(e.id) || elementTasks(e)).slice(0, 8).map(t => ({
      type: t.type,
      name: String(t.name || '').slice(0, 120),
      every_days: t.interval_days || null,
      last_done: t.last || t.last_done || null,
    })),
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
Each element lists its cleaning and maintenance tasks with the last date done. Prefer tasks never done or past their interval, and kitchen grease/ventilation risks. When a suggestion matches a listed task, use that task name exactly as "service". Do not invent elements.
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
    if (facilityAction === 'add-photo') return { status: 200, body: await analyzePhoto(body) }
    return { status: 400, body: { error: 'facilityAction must be generate, add-photo or recommend' } }
  } catch (err) {
    return { status: err.status || 500, body: { error: err.message } }
  }
}
