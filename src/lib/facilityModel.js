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
  dining: { color: '#60a5fa', icon: '🍽', en: 'Dining hall', ja: '客席', pt: 'Salão' },
  kitchen: { color: '#f97316', icon: '🔥', en: 'Kitchen', ja: '厨房', pt: 'Cozinha' },
  bar: { color: '#a78bfa', icon: '🍸', en: 'Bar counter', ja: 'バー', pt: 'Balcão do bar' },
  restroom: { color: '#22d3ee', icon: '🚻', en: 'Restroom', ja: 'トイレ', pt: 'Banheiro' },
  storage: { color: '#a3a3a3', icon: '📦', en: 'Storage', ja: '倉庫', pt: 'Depósito' },
  washing: { color: '#38bdf8', icon: '🫧', en: 'Dishwashing', ja: '洗い場', pt: 'Área de lavagem' },
  ventilation: { color: '#94a3b8', icon: '🌀', en: 'Ventilation', ja: '換気', pt: 'Ventilação' },
  entrance: { color: '#4ade80', icon: '🚪', en: 'Entrance', ja: '入口', pt: 'Entrada' },
  office: { color: '#fbbf24', icon: '🗂', en: 'Office / staff', ja: '事務所', pt: 'Escritório / equipe' },
  sales: { color: '#f472b6', icon: '🛍', en: 'Sales floor', ja: '売場', pt: 'Área de vendas' },
  other: { color: '#cbd5e1', icon: '▫️', en: 'Other', ja: 'その他', pt: 'Outro' },
}

/**
 * service: serviço de limpeza que o Kuripuro oferece para este tipo de elemento.
 * intervalDays: intervalo recomendado de manutenção (null = sem recomendação automática).
 */
export const ELEMENT_KINDS = {
  range_hood: { icon: '🌀', en: 'Range hood', ja: 'レンジフード', pt: 'Coifa', service: 'Range hood deep clean', intervalDays: 90, h: 0.6, z: 1.6 },
  grease_trap: { icon: '🛢', en: 'Grease trap', ja: 'グリストラップ', pt: 'Caixa de gordura', service: 'Grease trap cleaning', intervalDays: 15, h: 0.3 },
  air_conditioner: { icon: '❄️', en: 'Air conditioner', ja: 'エアコン', pt: 'Ar-condicionado', service: 'AC filter cleaning', intervalDays: 90, h: 0.4, z: 2.2 },
  stove: { icon: '🔥', en: 'Stove / grill', ja: 'コンロ', pt: 'Fogão / chapa', service: 'Stove degreasing', intervalDays: 30, h: 0.9 },
  fryer: { icon: '🍟', en: 'Fryer', ja: 'フライヤー', pt: 'Fritadeira', service: 'Fryer degreasing', intervalDays: 30, h: 0.9 },
  oven: { icon: '♨️', en: 'Oven', ja: 'オーブン', pt: 'Forno', service: 'Oven deep clean', intervalDays: 60, h: 1.2 },
  fridge: { icon: '🧊', en: 'Refrigerator', ja: '冷蔵庫', pt: 'Geladeira', service: 'Refrigerator & coil cleaning', intervalDays: 120, h: 1.8 },
  dishwasher: { icon: '🫧', en: 'Dishwasher', ja: '食洗機', pt: 'Lava-louças', service: 'Dishwasher descaling', intervalDays: 60, h: 1.0 },
  sink: { icon: '🚰', en: 'Sink', ja: 'シンク', pt: 'Pia', service: null, intervalDays: null, h: 0.9 },
  duct: { icon: '🌬', en: 'Exhaust duct', ja: 'ダクト', pt: 'Duto de exaustão', service: 'Exhaust duct cleaning', intervalDays: 180, h: 0.4, z: 2.4 },
  grating: { icon: '🔲', en: 'Floor grating / drain', ja: 'グレーチング', pt: 'Grelha de piso / ralo', service: 'Drain & grating cleaning', intervalDays: 30, h: 0.05 },
  table: { icon: '🪑', en: 'Table', ja: 'テーブル', pt: 'Mesa', service: null, intervalDays: null, h: 0.75 },
  counter: { icon: '🟫', en: 'Counter', ja: 'カウンター', pt: 'Balcão', service: null, intervalDays: null, h: 1.0 },
  toilet: { icon: '🚽', en: 'Toilet', ja: '便器', pt: 'Vaso sanitário', service: 'Restroom deep clean', intervalDays: 30, h: 0.5 },
  light_switch: { icon: '💡', en: 'Light switch', ja: '照明スイッチ', pt: 'Interruptor', service: null, intervalDays: null, h: 0.1, z: 1.2 },
  breaker: { icon: '⚡', en: 'Breaker panel', ja: '分電盤', pt: 'Quadro de disjuntores', service: null, intervalDays: null, h: 0.5, z: 1.4 },
  valve: { icon: '🔧', en: 'Gas / water valve', ja: 'バルブ', pt: 'Registro de gás / água', service: null, intervalDays: null, h: 0.2, z: 0.5 },
  light: { icon: '🔆', en: 'Light', ja: '照明', pt: 'Luminária', service: null, intervalDays: null, h: 0.1, z: 2.6 },
  floor: { icon: '🧽', en: 'Floor', ja: '床', pt: 'Piso', service: 'Floor deep scrub & wax', intervalDays: 60, h: 0.02 },
  window: { icon: '🪟', en: 'Window / glass', ja: '窓', pt: 'Janela / vidro', service: 'Window & glass cleaning', intervalDays: 30, h: 1.5 },
  stairs: { icon: '🪜', en: 'Stairs', ja: '階段', pt: 'Escada', service: 'Stair cleaning', intervalDays: 30, h: 2.6 },
  other: { icon: '▫️', en: 'Other', ja: 'その他', pt: 'Outro', service: null, intervalDays: null, h: 0.5 },
}

/** Itens que o funcionário mais procura: mostram um pino 📷 no 3D e a foto real fica a um toque. */
export const IMPORTANT_KINDS = new Set(['light_switch', 'breaker', 'valve', 'grease_trap', 'range_hood'])

/**
 * Manutenções recorrentes sugeridas por tipo (além da limpeza do ELEMENT_KINDS.service).
 * Cada equipamento ganha estas tarefas por padrão; o admin pode editar, apagar ou criar outras.
 */
export const MAINTENANCE_DEFAULTS = {
  range_hood: [{ name: 'Hood filter & fan check', interval: 180 }],
  air_conditioner: [{ name: 'AC full service (inside unit)', interval: 365 }],
  fridge: [{ name: 'Door seal & temperature check', interval: 180 }],
  dishwasher: [{ name: 'Dishwasher inspection', interval: 180 }],
  stove: [{ name: 'Gas burner & hose inspection', interval: 365 }],
  fryer: [{ name: 'Fryer thermostat check', interval: 365 }],
  oven: [{ name: 'Oven inspection', interval: 365 }],
  duct: [{ name: 'Exhaust fan maintenance', interval: 365 }],
  grease_trap: [{ name: 'Grease trap inspection', interval: 180 }],
  breaker: [{ name: 'Electrical panel inspection', interval: 365 }],
  valve: [{ name: 'Valve & leak check', interval: 365 }],
  light: [{ name: 'Lighting check / bulb replacement', interval: 180 }],
  sink: [{ name: 'Drain & faucet check', interval: 180 }],
  toilet: [{ name: 'Plumbing check', interval: 365 }],
}

export const TASK_TYPES = ['cleaning', 'maintenance']

function normalizeTasks(list) {
  const ids = new Set()
  return list.slice(0, 12).map((t, i) => {
    const name = typeof t?.name === 'string' ? t.name.trim().slice(0, 120) : ''
    if (!name) return null
    let id = typeof t?.id === 'string' && t.id ? t.id.slice(0, 40) : `task${i}`
    while (ids.has(id)) id = `${id}_${i}`
    ids.add(id)
    const iv = Number(t?.interval_days)
    return {
      id,
      type: TASK_TYPES.includes(t?.type) ? t.type : 'cleaning',
      name,
      interval_days: Number.isFinite(iv) && iv >= 1 ? Math.min(3650, Math.round(iv)) : null,
      last_done: /^\d{4}-\d{2}-\d{2}/.test(t?.last_done || '') ? t.last_done.slice(0, 10) : null,
    }
  }).filter(Boolean)
}

/**
 * Limpezas e manutenções do equipamento. Sem lista própria = padrão do tipo
 * (limpeza do catálogo, que herda last_serviced_at / service_interval_days antigos, + manutenções sugeridas).
 */
export function elementTasks(el) {
  if (Array.isArray(el?.tasks)) return el.tasks
  const k = ELEMENT_KINDS[el?.kind] || ELEMENT_KINDS.other
  const out = []
  if (k.service) {
    out.push({ id: 'clean', type: 'cleaning', name: k.service, interval_days: el?.service_interval_days || k.intervalDays || null, last_done: el?.last_serviced_at || null })
  }
  const maint = MAINTENANCE_DEFAULTS[el?.kind] || []
  maint.forEach((m, i) => {
    out.push({ id: `maint${i}`, type: 'maintenance', name: m.name, interval_days: m.interval, last_done: null })
  })
  return out
}

/** Qual tarefa um registro do histórico cumpre: pelo nome do serviço, senão a primeira limpeza. */
export function taskForLog(tasks, log) {
  const name = String(log?.service || '').trim().toLowerCase()
  return (name && tasks.find(t => t.name.toLowerCase() === name))
    || tasks.find(t => t.type === 'cleaning')
    || tasks[0]
    || null
}

/** Tarefas com a data da última vez (ficha ou histórico, a mais recente). */
export function careForElement(el, logs = []) {
  const tasks = elementTasks(el)
  const last = new Map(tasks.map(t => [t.id, t.last_done || null]))
  for (const l of logs) {
    if (l.element_id !== el.id || !l.service_date) continue
    const task = taskForLog(tasks, l)
    if (!task) continue
    const d = String(l.service_date).slice(0, 10)
    if (!last.get(task.id) || d > last.get(task.id)) last.set(task.id, d)
  }
  return tasks.map(t => ({ ...t, last: last.get(t.id) }))
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Situação de uma tarefa: status, próxima data e quantos dias faltam (negativo = atrasada). */
export function taskState(task, now = new Date()) {
  if (!task?.interval_days) return { status: null, next: null, daysLeft: null }
  if (!task.last) return { status: 'none', next: null, daysLeft: null, daysSince: null }
  const days = daysBetween(task.last, now)
  const daysLeft = task.interval_days - days
  const status = days >= task.interval_days ? 'overdue' : days >= task.interval_days * 0.85 ? 'due' : 'ok'
  return { status, next: addDays(task.last, task.interval_days), daysLeft, daysSince: days }
}

const AREA_KEYS = Object.keys(AREA_KINDS)
const ELEMENT_KEYS = Object.keys(ELEMENT_KINDS)

export const MAX_LEVELS = 3
const lvl = (o) => {
  const v = Math.round(Number(o?.level) || 0)
  return v > 0 ? { level: Math.min(MAX_LEVELS - 1, v) } : {}
}

export function kindLabel(kind, lang = 'en', table = ELEMENT_KINDS) {
  const k = table[kind] || table.other
  return lang === 'ja' ? k.ja : lang === 'pt' ? (k.pt || k.en) : k.en
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
      ...lvl(a),
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
    ...lvl(wl),
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
      ...(Array.isArray(e?.tasks) ? { tasks: normalizeTasks(e.tasks) } : {}),
      ...lvl(e),
    }
  })

  const levels = Math.max(num(src.levels, 1, 1, MAX_LEVELS), ...[...areas, ...walls, ...elements].map(x => (x.level || 0) + 1))
  return { width, depth, areas, walls, elements, ...(levels > 1 ? { levels } : {}) }
}

// ---------------------------------------------------------------------------
// Andares: cada área / parede / item tem level (0 = térreo, 1 = 2º andar...). Sem level = térreo.
// ---------------------------------------------------------------------------

export const levelOf = (o) => o?.level || 0
export const levelCount = (layout) => Math.max(1, layout?.levels || 1)

/** Só o que está num andar (o resto do app continua vendo uma planta normal). */
export function levelLayout(layout, level = 0) {
  if (levelCount(layout) < 2) return layout
  const on = x => levelOf(x) === level
  return { ...layout, areas: layout.areas.filter(on), walls: layout.walls.filter(on), elements: layout.elements.filter(on) }
}

/** Devolve um andar editado para a planta inteira (marca o andar em tudo o que veio dele). */
export function mergeLevel(full, level, part) {
  if (levelCount(full) < 2 && !level) return normalizeLayout({ ...part, levels: full.levels })
  const tag = x => (level ? { ...x, level } : (({ level: _drop, ...rest }) => rest)(x))
  const other = x => levelOf(x) !== level
  return normalizeLayout({
    ...full,
    width: part.width,
    depth: part.depth,
    areas: [...full.areas.filter(other), ...part.areas.map(tag)],
    walls: [...full.walls.filter(other), ...part.walls.map(tag)],
    elements: [...full.elements.filter(other), ...part.elements.map(tag)],
  })
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
  for (const row of careSchedule(layout, now)) {
    const { element: el, task, status, daysLeft } = row
    const what = task.type === 'maintenance' ? 'maintenance' : 'cleaning'
    const base = { element_id: el.id, element_name: el.name, service: task.name }
    if (status === 'none') {
      // manutenção sem registro não vira oferta sozinha; limpeza sim
      if (task.type !== 'cleaning') continue
      out.push({ ...base, reason: `No ${what} record for "${el.name}". Recommended every ${task.interval_days} days.`, priority: 'medium' })
    } else if (status === 'overdue') {
      const days = task.interval_days - daysLeft
      out.push({ ...base, reason: `Last ${what} ${days} days ago (${task.last}). Recommended every ${task.interval_days} days.`, priority: days >= task.interval_days * 1.5 ? 'high' : 'medium' })
    } else if (status === 'due') {
      out.push({ ...base, reason: `Due in ${daysLeft} days (last ${what} ${task.last}).`, priority: 'low' })
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

/**
 * Layout com as tarefas (care) e last_serviced_at calculados a partir do histórico (facility_service_log).
 * O campo care é só para mostrar; normalizeLayout não o salva.
 */
export function withServiceLog(layout, logs = []) {
  return {
    ...layout,
    elements: layout.elements.map(el => {
      const care = careForElement(el, logs)
      const clean = care.find(t => t.type === 'cleaning')
      const last = clean?.last || lastServicedFromLog(el, logs)
      return { ...el, care, last_serviced_at: last || null }
    }),
  }
}

const STATUS_RANK = { overdue: 5, due: 4, none_cleaning: 3, ok: 2, none: 1 }

/**
 * Situação de manutenção do elemento para pintar o mapa (a pior entre as tarefas):
 * 'overdue' (passou do intervalo) · 'due' (vence em breve) · 'ok' · 'none' (sem registro) · null (sem tarefa recorrente).
 * Manutenção nunca registrada não apaga o verde de uma limpeza em dia.
 */
export function elementStatus(el, now = new Date()) {
  const care = el?.care || careForElement(el || {}, [])
  let best = null
  for (const t of care) {
    const st = taskState(t, now).status
    if (!st) continue
    const key = st === 'none' && t.type === 'cleaning' ? 'none_cleaning' : st
    if (!best || STATUS_RANK[key] > STATUS_RANK[best]) best = key
  }
  return best === 'none_cleaning' ? 'none' : best
}

/**
 * Agenda de limpeza e manutenção: uma linha por tarefa com última vez, próxima data e situação.
 * Ordem: atrasadas (mais atrasada primeiro), vencendo, nunca feitas, em dia.
 */
export function careSchedule(layout, now = new Date()) {
  const rows = []
  for (const el of layout.elements || []) {
    for (const task of el.care || careForElement(el, [])) {
      const st = taskState(task, now)
      if (!st.status) continue
      rows.push({ element: el, task, ...st })
    }
  }
  const order = { overdue: 0, due: 1, none: 2, ok: 3 }
  return rows.sort((a, b) => order[a.status] - order[b.status]
    || (a.daysLeft ?? 0) - (b.daysLeft ?? 0)
    || (a.task.type === b.task.type ? 0 : a.task.type === 'cleaning' ? -1 : 1))
}

/**
 * Serviços para oferecer (admin e vendedor): lojas aprovadas, tarefas atrasadas ou que vencem em até `horizon` dias.
 * Objetos simples (vão pela API do vendedor). key = modelo:item:tarefa, estável para "já avisei".
 */
export function serviceOffers(models = [], logs = [], { now = new Date(), horizon = 14 } = {}) {
  const rows = []
  for (const m of models) {
    if (m.status !== 'approved') continue
    const layout = withServiceLog(normalizeLayout(m.layout), logs.filter(l => l.model_id === m.id))
    for (const r of careSchedule(layout, now)) {
      if (!(r.status === 'overdue' || r.status === 'due' || (r.daysLeft != null && r.daysLeft <= horizon))) continue
      rows.push({
        key: `${m.id}:${r.element.id}:${r.task.id}`,
        model_id: m.id,
        client_id: m.client_id,
        location: m.location_name || m.name,
        element_id: r.element.id,
        element_name: r.element.name,
        element_kind: r.element.kind,
        task_id: r.task.id,
        task_name: r.task.name,
        task_type: r.task.type,
        interval_days: r.task.interval_days,
        last: r.task.last,
        next: r.next,
        status: r.status,
        daysLeft: r.daysLeft,
        daysSince: r.daysSince,
      })
    }
  }
  return rows.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
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
