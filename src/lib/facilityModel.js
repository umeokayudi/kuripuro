/**
 * Smart Facility — modelo digital de cada restaurante.
 * Funções puras (sem Supabase/React) para poder testar com vite-node.
 *
 * layout = {
 *   width, depth (metros),
 *   areas:    [{ id, name, kind, x, y, w, d, notes }],
 *   walls:    [{ id, x1, y1, x2, y2, h }],
 *   elements: [{ id, name, kind, areaId, x, y, w, d, h, photos, location_hint,
 *                instructions, last_serviced_at, service_interval_days, notes }],
 * }
 * Coordenadas em metros, origem no canto superior esquerdo da planta.
 */

export const AREA_KINDS = {
  dining: { color: '#60a5fa', icon: '🍽', en: 'Dining hall', ja: '客席' },
  kitchen: { color: '#f97316', icon: '🔥', en: 'Kitchen', ja: '厨房' },
  bar: { color: '#a78bfa', icon: '🍸', en: 'Bar counter', ja: 'バー' },
  restroom: { color: '#22d3ee', icon: '🚻', en: 'Restroom', ja: 'トイレ' },
  storage: { color: '#a3a3a3', icon: '📦', en: 'Storage', ja: '倉庫' },
  washing: { color: '#38bdf8', icon: '🫧', en: 'Dishwashing', ja: '洗い場' },
  ventilation: { color: '#94a3b8', icon: '🌀', en: 'Ventilation', ja: '換気' },
  entrance: { color: '#4ade80', icon: '🚪', en: 'Entrance', ja: '入口' },
  office: { color: '#fbbf24', icon: '🗂', en: 'Office / staff', ja: '事務所' },
  other: { color: '#cbd5e1', icon: '▫️', en: 'Other', ja: 'その他' },
}

/**
 * service: serviço de limpeza que o Kuripuro oferece para este tipo de elemento.
 * intervalDays: intervalo recomendado de manutenção (null = sem recomendação automática).
 */
export const ELEMENT_KINDS = {
  range_hood: { icon: '🌀', en: 'Range hood', ja: 'レンジフード', service: 'Range hood deep clean', intervalDays: 90, h: 0.6, z: 1.6 },
  grease_trap: { icon: '🛢', en: 'Grease trap', ja: 'グリストラップ', service: 'Grease trap cleaning', intervalDays: 15, h: 0.3 },
  air_conditioner: { icon: '❄️', en: 'Air conditioner', ja: 'エアコン', service: 'AC filter cleaning', intervalDays: 90, h: 0.4, z: 2.2 },
  stove: { icon: '🔥', en: 'Stove / grill', ja: 'コンロ', service: 'Stove degreasing', intervalDays: 30, h: 0.9 },
  fryer: { icon: '🍟', en: 'Fryer', ja: 'フライヤー', service: 'Fryer degreasing', intervalDays: 30, h: 0.9 },
  oven: { icon: '♨️', en: 'Oven', ja: 'オーブン', service: 'Oven deep clean', intervalDays: 60, h: 1.2 },
  fridge: { icon: '🧊', en: 'Refrigerator', ja: '冷蔵庫', service: 'Refrigerator & coil cleaning', intervalDays: 120, h: 1.8 },
  dishwasher: { icon: '🫧', en: 'Dishwasher', ja: '食洗機', service: 'Dishwasher descaling', intervalDays: 60, h: 1.0 },
  sink: { icon: '🚰', en: 'Sink', ja: 'シンク', service: null, intervalDays: null, h: 0.9 },
  duct: { icon: '🌬', en: 'Exhaust duct', ja: 'ダクト', service: 'Exhaust duct cleaning', intervalDays: 180, h: 0.4, z: 2.4 },
  grating: { icon: '🔲', en: 'Floor grating / drain', ja: 'グレーチング', service: 'Drain & grating cleaning', intervalDays: 30, h: 0.05 },
  table: { icon: '🪑', en: 'Table', ja: 'テーブル', service: null, intervalDays: null, h: 0.75 },
  counter: { icon: '🟫', en: 'Counter', ja: 'カウンター', service: null, intervalDays: null, h: 1.0 },
  toilet: { icon: '🚽', en: 'Toilet', ja: '便器', service: 'Restroom deep clean', intervalDays: 30, h: 0.5 },
  light_switch: { icon: '💡', en: 'Light switch', ja: '照明スイッチ', service: null, intervalDays: null, h: 0.1, z: 1.2 },
  breaker: { icon: '⚡', en: 'Breaker panel', ja: '分電盤', service: null, intervalDays: null, h: 0.5, z: 1.4 },
  valve: { icon: '🔧', en: 'Gas / water valve', ja: 'バルブ', service: null, intervalDays: null, h: 0.2, z: 0.5 },
  light: { icon: '🔆', en: 'Light', ja: '照明', service: null, intervalDays: null, h: 0.1, z: 2.6 },
  floor: { icon: '🧽', en: 'Floor', ja: '床', service: 'Floor deep scrub & wax', intervalDays: 60, h: 0.02 },
  window: { icon: '🪟', en: 'Window / glass', ja: '窓', service: 'Window & glass cleaning', intervalDays: 30, h: 1.5 },
  other: { icon: '▫️', en: 'Other', ja: 'その他', service: null, intervalDays: null, h: 0.5 },
}

/** Itens que o funcionário mais procura: mostram um pino 📷 no 3D e a foto real fica a um toque. */
export const IMPORTANT_KINDS = new Set(['light_switch', 'breaker', 'valve', 'grease_trap', 'range_hood'])

const AREA_KEYS = Object.keys(AREA_KINDS)
const ELEMENT_KEYS = Object.keys(ELEMENT_KINDS)

export function kindLabel(kind, lang = 'en', table = ELEMENT_KINDS) {
  const k = table[kind] || table.other
  return lang === 'ja' ? k.ja : k.en
}

let idCounter = 0
export function newId(prefix = 'el') {
  idCounter = (idCounter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

function num(v, fallback, min = -Infinity, max = Infinity) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100))
}

function str(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function emptyLayout(width = 12, depth = 8) {
  return { width, depth, areas: [], walls: [], elements: [] }
}

/** Normaliza qualquer JSON (IA ou banco) para um layout válido e dentro da planta. */
export function normalizeLayout(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const width = num(src.width ?? src.width_m, 12, 2, 200)
  const depth = num(src.depth ?? src.depth_m, 8, 2, 200)
  const ids = new Set()
  const uniqueId = (id, prefix) => {
    let v = str(id, 40) || newId(prefix)
    while (ids.has(v)) v = newId(prefix)
    ids.add(v)
    return v
  }

  const areas = (Array.isArray(src.areas) ? src.areas : []).slice(0, 40).map(a => {
    const w = num(a?.w ?? a?.width, 3, 0.5, width)
    const d = num(a?.d ?? a?.depth, 3, 0.5, depth)
    return {
      id: uniqueId(a?.id, 'area'),
      name: str(a?.name, 80) || kindLabel(a?.kind, 'en', AREA_KINDS),
      kind: AREA_KEYS.includes(a?.kind) ? a.kind : 'other',
      x: num(a?.x, 0, 0, width - w),
      y: num(a?.y, 0, 0, depth - d),
      w,
      d,
      notes: str(a?.notes),
    }
  })
  const areaIds = new Set(areas.map(a => a.id))

  const walls = (Array.isArray(src.walls) ? src.walls : []).slice(0, 80).map(wl => ({
    id: uniqueId(wl?.id, 'wall'),
    x1: num(wl?.x1, 0, 0, width),
    y1: num(wl?.y1, 0, 0, depth),
    x2: num(wl?.x2, 0, 0, width),
    y2: num(wl?.y2, 0, 0, depth),
    h: num(wl?.h, 2.4, 0.3, 6),
  })).filter(wl => wl.x1 !== wl.x2 || wl.y1 !== wl.y2)

  const elements = (Array.isArray(src.elements) ? src.elements : []).slice(0, 200).map(e => {
    const kind = ELEMENT_KEYS.includes(e?.kind) ? e.kind : 'other'
    const w = num(e?.w ?? e?.width, 0.8, 0.1, width)
    const d = num(e?.d ?? e?.depth, 0.6, 0.1, depth)
    const interval = e?.service_interval_days
    return {
      id: uniqueId(e?.id, 'el'),
      name: str(e?.name, 80) || kindLabel(kind),
      kind,
      areaId: areaIds.has(e?.areaId) ? e.areaId : null,
      x: num(e?.x, 0, 0, width - w),
      y: num(e?.y, 0, 0, depth - d),
      w,
      d,
      h: num(e?.h, ELEMENT_KINDS[kind].h, 0.02, 4),
      photos: (Array.isArray(e?.photos) ? e.photos : []).filter(p => typeof p === 'string').slice(0, 12),
      location_hint: str(e?.location_hint),
      instructions: str(e?.instructions, 2000),
      last_serviced_at: /^\d{4}-\d{2}-\d{2}/.test(e?.last_serviced_at || '') ? e.last_serviced_at.slice(0, 10) : null,
      service_interval_days: interval == null || interval === '' ? null : num(interval, null, 1, 3650),
      notes: str(e?.notes),
      important: typeof e?.important === 'boolean' ? e.important : IMPORTANT_KINDS.has(kind),
    }
  })

  return { width, depth, areas, walls, elements }
}

/** Área que contém o ponto central do elemento (para "localização" automática). */
export function areaForElement(layout, el) {
  if (!el) return null
  if (el.areaId) {
    const a = layout.areas.find(x => x.id === el.areaId)
    if (a) return a
  }
  const cx = el.x + el.w / 2
  const cy = el.y + el.d / 2
  return layout.areas.find(a => cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.d) || null
}

export function areaSquareMeters(area) {
  return Math.round(area.w * area.d * 10) / 10
}

export function totalSquareMeters(layout) {
  return Math.round(layout.width * layout.depth * 10) / 10
}

/** Paredes externas automáticas ao redor da planta. */
export function perimeterWalls(width, depth, h = 2.4) {
  return [
    { id: newId('wall'), x1: 0, y1: 0, x2: width, y2: 0, h },
    { id: newId('wall'), x1: width, y1: 0, x2: width, y2: depth, h },
    { id: newId('wall'), x1: width, y1: depth, x2: 0, y2: depth, h },
    { id: newId('wall'), x1: 0, y1: depth, x2: 0, y2: 0, h },
  ]
}

/**
 * Planta inicial de restaurante (usada quando a IA não está disponível).
 * O administrador ajusta depois no editor.
 */
export function restaurantTemplate(width = 12, depth = 8) {
  const kitchenW = Math.round(width * 0.4 * 10) / 10
  const diningW = Math.round((width - kitchenW) * 10) / 10
  const rrD = Math.min(2.5, depth / 3)
  const layout = {
    width,
    depth,
    areas: [
      { id: 'area_dining', name: 'Dining hall', kind: 'dining', x: 0, y: 0, w: diningW, d: depth - rrD },
      { id: 'area_entrance', name: 'Entrance', kind: 'entrance', x: 0, y: depth - rrD, w: diningW / 2, d: rrD },
      { id: 'area_restroom', name: 'Restroom', kind: 'restroom', x: diningW / 2, y: depth - rrD, w: diningW / 2, d: rrD },
      { id: 'area_kitchen', name: 'Kitchen', kind: 'kitchen', x: diningW, y: 0, w: kitchenW, d: depth - rrD },
      { id: 'area_washing', name: 'Dishwashing', kind: 'washing', x: diningW, y: depth - rrD, w: kitchenW / 2, d: rrD },
      { id: 'area_storage', name: 'Storage', kind: 'storage', x: diningW + kitchenW / 2, y: depth - rrD, w: kitchenW / 2, d: rrD },
    ],
    walls: [
      ...perimeterWalls(width, depth),
      { id: 'wall_kitchen', x1: diningW, y1: 0, x2: diningW, y2: depth - rrD - 1, h: 2.4 },
    ],
    elements: [
      { id: 'el_hood', name: 'Range hood', kind: 'range_hood', areaId: 'area_kitchen', x: width - 2.2, y: 0.1, w: 2, d: 0.8 },
      { id: 'el_stove', name: 'Stove', kind: 'stove', areaId: 'area_kitchen', x: width - 2.2, y: 0.2, w: 2, d: 0.7 },
      { id: 'el_fridge', name: 'Refrigerator', kind: 'fridge', areaId: 'area_kitchen', x: diningW + 0.2, y: 0.2, w: 1.2, d: 0.7 },
      { id: 'el_grease', name: 'Grease trap', kind: 'grease_trap', areaId: 'area_washing', x: diningW + 0.3, y: depth - rrD + 0.3, w: 0.6, d: 0.6 },
      { id: 'el_sink', name: 'Sink', kind: 'sink', areaId: 'area_washing', x: diningW + 1.1, y: depth - rrD + 0.2, w: 1.2, d: 0.6 },
      { id: 'el_ac', name: 'Air conditioner', kind: 'air_conditioner', areaId: 'area_dining', x: 0.2, y: 0.1, w: 1.2, d: 0.3 },
      { id: 'el_switch', name: 'Main light switch', kind: 'light_switch', areaId: 'area_entrance', x: 0.1, y: depth - rrD + 0.2, w: 0.2, d: 0.1,
        location_hint: 'Next to the entrance door, at shoulder height' },
      { id: 'el_breaker', name: 'Breaker panel', kind: 'breaker', areaId: 'area_storage', x: width - 0.8, y: depth - 0.5, w: 0.6, d: 0.2 },
      ...Array.from({ length: Math.max(2, Math.floor(diningW / 2.2)) }, (_, i) => ({
        id: `el_table_${i + 1}`, name: `Table ${i + 1}`, kind: 'table', areaId: 'area_dining',
        x: 0.8 + i * 2.1, y: (depth - rrD) / 2 - 0.4, w: 1.2, d: 0.8,
      })),
    ],
  }
  return normalizeLayout(layout)
}

function daysBetween(fromIso, now) {
  const from = new Date(fromIso + 'T00:00:00+09:00')
  return Math.floor((now - from) / 86400000)
}

/**
 * Recomendações de limpeza por regra (intervalo de manutenção vs. última limpeza).
 * Retorna [{ element_id, element_name, service, reason, priority }].
 */
export function ruleRecommendations(layout, now = new Date()) {
  const out = []
  for (const el of layout.elements || []) {
    const kind = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
    if (!kind.service) continue
    const interval = el.service_interval_days || kind.intervalDays
    if (!interval) continue
    if (!el.last_serviced_at) {
      out.push({
        element_id: el.id,
        element_name: el.name,
        service: kind.service,
        reason: `No cleaning record for "${el.name}". Recommended every ${interval} days.`,
        priority: 'medium',
      })
      continue
    }
    const days = daysBetween(el.last_serviced_at, now)
    if (days >= interval) {
      out.push({
        element_id: el.id,
        element_name: el.name,
        service: kind.service,
        reason: `Last cleaned ${days} days ago (${el.last_serviced_at}). Recommended every ${interval} days.`,
        priority: days >= interval * 1.5 ? 'high' : 'medium',
      })
    } else if (days >= interval * 0.85) {
      out.push({
        element_id: el.id,
        element_name: el.name,
        service: kind.service,
        reason: `Due in ${interval - days} days (last cleaned ${el.last_serviced_at}).`,
        priority: 'low',
      })
    }
  }
  return out
}

/** Remove recomendações que já estão pendentes para o mesmo elemento + serviço. */
export function dedupeRecommendations(candidates, existing = []) {
  const key = r => `${r.element_id || ''}::${(r.service || '').toLowerCase()}`
  const open = new Set(existing.filter(r => r.status === 'pending').map(key))
  const seen = new Set()
  return candidates.filter(r => {
    const k = key(r)
    if (!r.service || open.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

/** Data (YYYY-MM-DD) mais recente entre a ficha do elemento e o histórico de limpezas. */
export function lastServicedFromLog(el, logs = []) {
  let best = el?.last_serviced_at || null
  for (const l of logs) {
    if (l.element_id !== el?.id || !l.service_date) continue
    const d = String(l.service_date).slice(0, 10)
    if (!best || d > best) best = d
  }
  return best
}

/** Layout com last_serviced_at atualizado a partir do histórico (facility_service_log). */
export function withServiceLog(layout, logs = []) {
  if (!logs.length) return layout
  return {
    ...layout,
    elements: layout.elements.map(el => {
      const last = lastServicedFromLog(el, logs)
      return last === el.last_serviced_at ? el : { ...el, last_serviced_at: last }
    }),
  }
}

/**
 * Situação de manutenção do elemento para pintar o mapa:
 * 'overdue' (passou do intervalo) · 'due' (vence em breve) · 'ok' · 'none' (sem registro) · null (sem limpeza recorrente).
 */
export function elementStatus(el, now = new Date()) {
  const kind = ELEMENT_KINDS[el?.kind] || ELEMENT_KINDS.other
  const interval = el?.service_interval_days || kind.intervalDays
  if (!interval || !kind.service) return null
  if (!el.last_serviced_at) return 'none'
  const days = daysBetween(el.last_serviced_at, now)
  if (days >= interval) return 'overdue'
  if (days >= interval * 0.85) return 'due'
  return 'ok'
}

export function statusMap(layout, now = new Date()) {
  const out = new Map()
  for (const el of layout.elements || []) {
    const st = elementStatus(el, now)
    if (st) out.set(el.id, st)
  }
  return out
}

/** Elementos com serviço aceito pelo cliente (ainda não executado) = tarefas para o funcionário. */
export function todoElementIds(recs = []) {
  return new Set(recs.filter(r => r.status === 'accepted' && r.element_id).map(r => r.element_id))
}

/** Histórico de um elemento, mais recente primeiro. */
export function elementHistory(elementId, logs = []) {
  return logs
    .filter(l => l.element_id === elementId)
    .sort((a, b) => String(b.service_date).localeCompare(String(a.service_date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

function overlapRatio(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y))
  const inter = ix * iy
  return inter / Math.max(0.01, Math.min(a.w * a.d, b.w * b.d))
}

/**
 * Construção aos poucos: junta ao modelo o que a IA viu em UMA foto.
 * - área do mesmo tipo que se sobrepõe a uma existente = a mesma área (não duplica);
 * - equipamento do mesmo tipo a menos de 1,5 m de um existente = o mesmo (só ganha a foto e textos que faltavam);
 * - o resto entra como novo. A foto é ligada a cada equipamento que aparece nela.
 * Retorna { layout, added: [nomes], updated: [nomes], grew: bool }.
 */
export function mergeLayoutAdditions(base, additions, photoRef) {
  const cur = normalizeLayout(base)
  const add = additions && typeof additions === 'object' ? additions : {}
  const width = Math.max(cur.width, Number(add.width) || 0)
  const depth = Math.max(cur.depth, Number(add.depth) || 0)
  const grew = width > cur.width || depth > cur.depth
  const incoming = normalizeLayout({ ...add, width, depth })
  const areas = cur.areas.map(a => ({ ...a }))
  const elements = cur.elements.map(e => ({ ...e, photos: [...e.photos] }))
  const walls = [...cur.walls]
  const added = []
  const updated = []
  const areaIdMap = {}

  for (const a of incoming.areas) {
    const same = areas.find(x => x.kind === a.kind && overlapRatio(x, a) > 0.3)
    if (same) { areaIdMap[a.id] = same.id; continue }
    const id = areas.some(x => x.id === a.id) ? newId('area') : a.id
    areaIdMap[a.id] = id
    areas.push({ ...a, id })
    added.push(a.name)
  }

  for (const e of incoming.elements) {
    const cx = e.x + e.w / 2
    const cy = e.y + e.d / 2
    const same = elements.find(x => x.kind === e.kind && Math.hypot(x.x + x.w / 2 - cx, x.y + x.d / 2 - cy) < 1.5)
    if (same) {
      if (photoRef && !same.photos.includes(photoRef)) same.photos.push(photoRef)
      if (!same.location_hint && e.location_hint) same.location_hint = e.location_hint
      if (!same.instructions && e.instructions) same.instructions = e.instructions
      updated.push(same.name)
      continue
    }
    const id = elements.some(x => x.id === e.id) ? newId('el') : e.id
    elements.push({
      ...e,
      id,
      areaId: e.areaId ? (areaIdMap[e.areaId] || null) : null,
      photos: photoRef ? [photoRef, ...e.photos.filter(p => p !== photoRef)] : e.photos,
    })
    added.push(e.name)
  }

  for (const w of incoming.walls) {
    const dup = walls.some(x => Math.hypot(x.x1 - w.x1, x.y1 - w.y1) + Math.hypot(x.x2 - w.x2, x.y2 - w.y2) < 0.8
      || Math.hypot(x.x1 - w.x2, x.y1 - w.y2) + Math.hypot(x.x2 - w.x1, x.y2 - w.y1) < 0.8)
    if (!dup) walls.push(w)
  }

  return { layout: normalizeLayout({ width, depth, areas, walls, elements }), added, updated: [...new Set(updated)], grew }
}
