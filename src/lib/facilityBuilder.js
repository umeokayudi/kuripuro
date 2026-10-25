import { AREA_KINDS, ELEMENT_KINDS, kindLabel, levelLayout, mergeLevel, newId, normalizeLayout, perimeterWalls } from './facilityModel'

/**
 * Montagem fácil da planta: modelos prontos de divisão dos cômodos, itens com tamanho real
 * que se encaixam sozinhos no cômodo certo (encostados na parede quando faz sentido) e
 * "kits" que enchem um cômodo de uma vez. Tudo em metros, origem no canto superior esquerdo,
 * frente da loja (porta) embaixo (y = depth).
 */

const r1 = v => Math.round(v * 10) / 10
const r2 = v => Math.round(v * 100) / 100

/** Tamanho real aproximado de cada item (largura × profundidade, em metros). */
export const DEFAULT_SIZE = {
  range_hood: [1.8, 0.9], grease_trap: [0.6, 0.6], air_conditioner: [1.0, 0.3], stove: [1.8, 0.75],
  fryer: [0.45, 0.75], oven: [0.9, 0.8], fridge: [1.2, 0.8], dishwasher: [0.65, 0.65], sink: [1.2, 0.6],
  duct: [0.5, 2.0], grating: [1.2, 0.3], table: [1.2, 0.75], counter: [2.4, 0.6], toilet: [0.45, 0.7],
  light_switch: [0.12, 0.05], breaker: [0.6, 0.15], valve: [0.2, 0.2], light: [0.6, 0.6],
  floor: [1.5, 1.0], window: [1.8, 0.1], stairs: [1.0, 2.8], supplies: [0.8, 0.45], other: [0.9, 0.6],
}

/** Grupos da paleta (ordem = como aparecem no editor). */
export const PALETTE = [
  { id: 'kitchen', icon: '🔥', kinds: ['stove', 'range_hood', 'fryer', 'oven', 'fridge', 'sink', 'dishwasher', 'grease_trap', 'grating', 'duct'] },
  { id: 'dining', icon: '🍽', kinds: ['table', 'counter', 'air_conditioner', 'window', 'light'] },
  { id: 'restroom', icon: '🚻', kinds: ['toilet', 'sink', 'floor'] },
  { id: 'controls', icon: '⚡', kinds: ['light_switch', 'breaker', 'valve', 'supplies', 'stairs', 'other'] },
]

/** Cômodo onde cada item costuma ficar (o primeiro que existir na planta). */
const HOME_AREA = {
  range_hood: ['kitchen'], stove: ['kitchen'], fryer: ['kitchen'], oven: ['kitchen'], fridge: ['kitchen', 'storage', 'bar'],
  dishwasher: ['washing', 'kitchen'], sink: ['washing', 'kitchen', 'restroom', 'bar'], grease_trap: ['washing', 'kitchen'],
  grating: ['kitchen', 'washing'], duct: ['kitchen', 'ventilation'], table: ['dining'], counter: ['bar', 'dining', 'kitchen'],
  toilet: ['restroom'], light_switch: ['entrance', 'dining'], breaker: ['storage', 'office', 'kitchen'],
  valve: ['kitchen', 'washing'], light: ['dining'], floor: ['restroom', 'kitchen'], window: ['dining', 'entrance'],
  air_conditioner: ['dining', 'sales', 'office'], stairs: ['dining', 'sales', 'office', 'entrance'], supplies: ['storage', 'washing', 'kitchen', 'office'], other: ['storage'],
}

// camadas: o que está no chão não bate com o que está no teto ou preso alto na parede
const CEILING = new Set(['range_hood', 'duct', 'light'])
const HIGH_WALL = new Set(['air_conditioner', 'light_switch', 'breaker', 'window', 'valve'])
const FLAT = new Set(['grease_trap', 'grating', 'floor'])
/** Itens que vão encostados na parede (com a frente para dentro). */
const AGAINST_WALL = new Set(['stove', 'fryer', 'oven', 'fridge', 'dishwasher', 'sink', 'counter', 'toilet', 'other', 'supplies',
  'air_conditioner', 'light_switch', 'breaker', 'window', 'valve'])
/** Prefere a parede do fundo (y = 0) ou a da frente (vitrine) para estes. */
const PREFER_EDGE = { window: 'bottom', air_conditioner: 'top', stove: 'top', fryer: 'top', oven: 'top', fridge: 'top', light_switch: 'left' }

export function layerOf(kind) {
  if (CEILING.has(kind)) return 'ceiling'
  if (HIGH_WALL.has(kind)) return 'wall'
  if (FLAT.has(kind)) return 'flat'
  return 'floor'
}

/** Folga em volta (mesa precisa de espaço para as cadeiras). */
function clearance(kind) {
  if (kind === 'table') return 0.55
  if (layerOf(kind) === 'floor') return 0.15
  return 0.05
}

function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.d + gap && b.y < a.y + a.d + gap
}

function inside(r, area) {
  return r.x >= area.x - 1e-6 && r.y >= area.y - 1e-6 && r.x + r.w <= area.x + area.w + 1e-6 && r.y + r.d <= area.y + area.d + 1e-6
}

function fits(layout, rect, kind, ignoreId) {
  const layer = layerOf(kind)
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > layout.width + 1e-6 || rect.y + rect.d > layout.depth + 1e-6) return false
  const gap = clearance(kind)
  return !layout.elements.some(e => {
    if (e.id === ignoreId) return false
    const other = layerOf(e.kind)
    // chão bate com chão; ralo/grelha no chão bate com móvel em cima
    const clash = other === layer || (layer === 'floor' && other === 'flat') || (layer === 'flat' && other === 'floor')
    return clash && overlaps(rect, e, Math.max(gap, clearance(e.kind)) * (layer === other ? 1 : 0.2))
  })
}

/** Cômodo de destino: o escolhido, senão o cômodo típico do item, senão o maior. */
export function homeArea(layout, kind, areaId) {
  if (areaId) {
    const a = layout.areas.find(x => x.id === areaId)
    if (a) return a
  }
  for (const k of HOME_AREA[kind] || []) {
    const a = layout.areas.find(x => x.kind === k)
    if (a) return a
  }
  return [...layout.areas].sort((a, b) => b.w * b.d - a.w * a.d)[0] || null
}

function uniqueName(layout, kind, lang, base) {
  const label = base || kindLabel(kind, lang)
  const same = layout.elements.filter(e => e.kind === kind).length
  return same ? `${label} ${same + 1}` : label
}

/** Posições candidatas encostadas em cada borda do cômodo (frente para dentro). */
function edgeCandidates(area, w, d, kind) {
  const step = 0.1
  const out = []
  const edges = ['top', 'bottom', 'left', 'right']
  const pref = PREFER_EDGE[kind]
  if (pref) edges.sort((a, b) => (a === pref ? -1 : b === pref ? 1 : 0))
  for (const edge of edges) {
    const horiz = edge === 'top' || edge === 'bottom'
    const ew = horiz ? w : d
    const ed = horiz ? d : w
    const len = horiz ? area.w : area.d
    if (ew > len + 1e-6) continue
    const stops = []
    for (let t = 0.15; t + ew <= len - 0.15 + 1e-6; t += step) stops.push(t)
    if (!stops.length) stops.push(Math.max(0, (len - ew) / 2))
    // começa pelo canto, depois vai andando pela parede
    for (const t of stops) {
      if (edge === 'top') out.push({ x: area.x + t, y: area.y, w: ew, d: ed })
      if (edge === 'bottom') out.push({ x: area.x + t, y: area.y + area.d - ed, w: ew, d: ed })
      if (edge === 'left') out.push({ x: area.x, y: area.y + t, w: ed, d: ew })
      if (edge === 'right') out.push({ x: area.x + area.w - ed, y: area.y + t, w: ed, d: ew })
    }
  }
  return out
}

/** Posições em grade dentro do cômodo (mesas, ralos, tapetes). */
function gridCandidates(area, w, d, kind) {
  const m = kind === 'table' ? 0.6 : 0.2
  const out = []
  const sx = Math.max(0.2, kind === 'table' ? w + 1.0 : 0.2)
  const sy = Math.max(0.2, kind === 'table' ? d + 1.2 : 0.2)
  for (let y = area.y + m; y + d <= area.y + area.d - m + 1e-6; y += sy) {
    for (let x = area.x + m; x + w <= area.x + area.w - m + 1e-6; x += sx) out.push({ x, y, w, d })
  }
  if (!out.length) out.push({ x: area.x + (area.w - w) / 2, y: area.y + (area.d - d) / 2, w, d })
  return out
}

/**
 * Coloca um item novo no lugar certo. Retorna { layout, id, areaId }.
 * - coifa: em cima do fogão/fritadeira que ainda não tem coifa;
 * - itens de parede: encostados na borda do cômodo, começando pelo canto;
 * - mesas e ralos: em grade dentro do cômodo, sem bater em nada.
 */
export function placeItem(layout, kind, { areaId = null, lang = 'en', name = null } = {}) {
  const k = ELEMENT_KINDS[kind] ? kind : 'other'
  const area = homeArea(layout, k, areaId) || { id: null, x: 0, y: 0, w: layout.width, d: layout.depth }
  let [w, d] = DEFAULT_SIZE[k] || DEFAULT_SIZE.other
  w = Math.min(w, area.w)
  d = Math.min(d, area.d)
  let rect = null

  if (k === 'range_hood') {
    const hooded = new Set(layout.elements.filter(e => e.kind === 'range_hood').map(h => {
      const under = layout.elements.find(e => (e.kind === 'stove' || e.kind === 'fryer') && overlaps(e, h))
      return under?.id
    }))
    const cooker = layout.elements.find(e => (e.kind === 'stove' || e.kind === 'fryer') && !hooded.has(e.id) && (!areaId || inside(e, area)))
    if (cooker) rect = { x: cooker.x - 0.05, y: Math.max(0, cooker.y - 0.05), w: cooker.w + 0.1, d: cooker.d + 0.15 }
  }
  if (!rect) {
    const candidates = AGAINST_WALL.has(k) ? edgeCandidates(area, w, d, k) : gridCandidates(area, w, d, k)
    rect = candidates.find(c => fits(layout, c, k)) || null
    if (!rect && AGAINST_WALL.has(k)) rect = gridCandidates(area, w, d, k).find(c => fits(layout, c, k)) || null
    if (!rect) rect = { x: area.x + (area.w - w) / 2, y: area.y + (area.d - d) / 2, w, d }
  }
  rect.x = Math.max(0, Math.min(layout.width - rect.w, rect.x))
  rect.y = Math.max(0, Math.min(layout.depth - rect.d, rect.y))
  const id = newId('el')
  const el = {
    id, kind: k, name: uniqueName(layout, k, lang, name), areaId: area.id,
    x: r2(rect.x), y: r2(rect.y), w: r2(rect.w), d: r2(rect.d), h: ELEMENT_KINDS[k].h,
  }
  return { layout: normalizeLayout({ ...layout, elements: [...layout.elements, el] }), id, areaId: area.id }
}

/** Itens típicos de cada cômodo (botão "encher o cômodo"). */
export const ROOM_KITS = {
  kitchen: [{ kind: 'stove' }, { kind: 'range_hood' }, { kind: 'fridge' }, { kind: 'sink' }, { kind: 'grease_trap' }, { kind: 'grating' }, { kind: 'light_switch' }],
  dining: [{ kind: 'table', auto: true }, { kind: 'air_conditioner' }, { kind: 'light_switch' }, { kind: 'window' }],
  restroom: [{ kind: 'toilet' }, { kind: 'sink' }, { kind: 'light_switch' }],
  washing: [{ kind: 'sink' }, { kind: 'dishwasher' }, { kind: 'grease_trap' }, { kind: 'grating' }],
  storage: [{ kind: 'breaker' }, { kind: 'other', name: { en: 'Shelf', ja: '棚', pt: 'Prateleira' } }, { kind: 'light_switch' }],
  bar: [{ kind: 'counter' }, { kind: 'fridge' }, { kind: 'sink' }],
  office: [{ kind: 'other', name: { en: 'Desk', ja: '机', pt: 'Mesa de escritório' } }, { kind: 'other', name: { en: 'Desk', ja: '机', pt: 'Mesa de escritório' } }, { kind: 'air_conditioner' }, { kind: 'light_switch' }, { kind: 'breaker' }],
  sales: [{ kind: 'counter', name: { en: 'Cash counter', ja: 'レジカウンター', pt: 'Caixa' } }, { kind: 'other', name: { en: 'Display shelf', ja: '陳列棚', pt: 'Gôndola / prateleira' } }, { kind: 'other', name: { en: 'Display shelf', ja: '陳列棚', pt: 'Gôndola / prateleira' } }, { kind: 'air_conditioner' }, { kind: 'light_switch' }, { kind: 'window' }],
  entrance: [{ kind: 'light_switch' }, { kind: 'window' }, { kind: 'floor', name: { en: 'Entrance mat', ja: '玄関マット', pt: 'Tapete de entrada' } }],
  ventilation: [{ kind: 'duct' }],
  other: [{ kind: 'light_switch' }],
}

/** Enche o cômodo com os itens típicos. Mesas: quantas couberem (até 12). Retorna { layout, added: [ids] }. */
export function fillRoom(layout, areaId, lang = 'en', { onlyTables = false } = {}) {
  const area = layout.areas.find(a => a.id === areaId)
  if (!area) return { layout, added: [] }
  let cur = layout
  const added = []
  for (const item of (ROOM_KITS[area.kind] || ROOM_KITS.other).filter(it => !onlyTables || it.kind === 'table')) {
    const count = item.auto ? Math.max(1, Math.min(12, Math.floor((area.w * area.d) / 4.5))) : 1
    for (let i = 0; i < count; i++) {
      const before = cur.elements.length
      const res = placeItem(cur, item.kind, { areaId, lang, name: item.name ? item.name[lang] || item.name.en : null })
      const el = res.layout.elements.find(e => e.id === res.id)
      // mesa extra que não coube de verdade (caiu no meio, por cima de outra): para de pôr
      if (item.auto && i > 0 && cur.elements.some(e => e.kind === 'table' && overlaps(e, el, 0.3))) break
      cur = res.layout
      if (cur.elements.length > before) added.push(res.id)
    }
  }
  return { layout: cur, added }
}

/** Enche todos os cômodos; pedaços repetidos do mesmo tipo (ex.: salão em L) só ganham mesas. */
export function fillAllRooms(layout, lang = 'en') {
  let cur = layout
  const seen = new Set()
  let added = 0
  for (const a of layout.areas) {
    const res = fillRoom(cur, a.id, lang, { onlyTables: seen.has(a.kind) })
    seen.add(a.kind)
    cur = res.layout
    added += res.added.length
  }
  return { layout: cur, added }
}

// ---------------------------------------------------------------------------
// Modelos prontos de planta
// ---------------------------------------------------------------------------

export const PLAN_PRESETS = ['side', 'back', 'bar', 'open', 'office', 'shop']

/**
 * Modelos prontos de negócio inteiro: um toque monta a loja já com os cômodos e os equipamentos.
 * upper = o que vai no 2º andar (null = só térreo).
 */
export const STORE_TEMPLATES = [
  { id: 'restaurant', icon: '🍽', width: 12, depth: 8, preset: 'side', rooms: { entrance: true, restroom: true, washing: true, storage: true } },
  { id: 'izakaya', icon: '🏮', width: 10, depth: 7, preset: 'bar', rooms: { entrance: true, restroom: true, washing: true } },
  { id: 'ramen', icon: '🍜', width: 8, depth: 5, preset: 'bar', rooms: { restroom: true } },
  { id: 'cafe', icon: '☕', width: 8, depth: 6, preset: 'open', rooms: { entrance: true, restroom: true } },
  { id: 'family', icon: '👨‍👩‍👧', width: 16, depth: 10, preset: 'back', rooms: { entrance: true, restroom: true, washing: true, storage: true, office: true } },
  { id: 'twoFloors', icon: '🏢', width: 10, depth: 7, preset: 'back', rooms: { entrance: true, restroom: true, washing: true }, upper: 'dining' },
  { id: 'office', icon: '🗂', width: 10, depth: 7, preset: 'office', rooms: { entrance: true, restroom: true, storage: true } },
  { id: 'shop', icon: '🛍', width: 9, depth: 7, preset: 'shop', rooms: { entrance: true, restroom: true } },
]

export const UPPER_FLOORS = ['dining', 'rooms', 'office']

/** Onde a escada fica: num canto livre do salão (ou da área principal) do térreo; deitada se o cômodo for raso. */
function stairsSpot(ground) {
  const [a1, a2] = DEFAULT_SIZE.stairs
  const mains = ground.areas.filter(a => ['dining', 'sales', 'office', 'entrance'].includes(a.kind)).sort((p, q) => q.w * q.d - p.w * p.d)
  const free = (x, y, w, d) => !ground.elements.some(e => e.x < x + w + 0.2 && e.x + e.w > x - 0.2 && e.y < y + d + 0.2 && e.y + e.d > y - 0.2)
  for (const a of mains) {
    for (const [w, d] of [[a1, a2], [a2, a1]]) {
      if (a.w < w + 0.2 || a.d < d + 0.2) continue
      for (const [x, y] of [[a.x + 0.1, a.y + 0.1], [a.x + a.w - w - 0.1, a.y + 0.1], [a.x + 0.1, a.y + a.d - d - 0.1], [a.x + a.w - w - 0.1, a.y + a.d - d - 0.1]]) {
        if (free(x, y, w, d)) return { x: r2(x), y: r2(y), w, d }
      }
    }
  }
  return { x: 0.1, y: 0.1, w: a1, d: a2 }
}

/** Cômodos do andar de cima (sem itens). */
function upperAreas(W, D, kind, lang) {
  const raw = []
  const rrW = r1(Math.min(2.2, W * 0.25))
  const sideD = r1(Math.min(2.4, D * 0.35))
  if (kind === 'office') {
    raw.push({ kind: 'office', x: 0, y: 0, w: r1(W - rrW), d: D })
    raw.push({ kind: 'restroom', x: r1(W - rrW), y: 0, w: rrW, d: sideD })
    raw.push({ kind: 'storage', x: r1(W - rrW), y: sideD, w: rrW, d: r1(D - sideD) })
  } else if (kind === 'rooms') {
    // salas privadas (ozashiki) no fundo, corredor na frente, banheiro no canto
    const rD = r1(Math.min(3.2, D * 0.55))
    const n = Math.max(2, Math.min(4, Math.floor((W - rrW) / 2.6)))
    const rw = r1((W - rrW) / n)
    for (let i = 0; i < n; i++) raw.push({ kind: 'dining', x: r1(i * rw), y: 0, w: i === n - 1 ? r1(W - rrW - i * rw) : rw, d: rD, room: i + 1 })
    raw.push({ kind: 'restroom', x: r1(W - rrW), y: 0, w: rrW, d: rD })
    raw.push({ kind: 'entrance', x: 0, y: rD, w: W, d: r1(D - rD), hall: true })
  } else {
    raw.push({ kind: 'dining', x: 0, y: 0, w: r1(W - rrW), d: D })
    raw.push({ kind: 'restroom', x: r1(W - rrW), y: 0, w: rrW, d: sideD })
    raw.push({ kind: 'storage', x: r1(W - rrW), y: sideD, w: rrW, d: r1(D - sideD) })
  }
  const roomName = { en: 'Private room', ja: '個室', pt: 'Sala privada' }
  const hallName = { en: 'Hallway', ja: '廊下', pt: 'Corredor' }
  return raw.map(a => ({
    id: newId('area'), kind: a.kind, x: a.x, y: a.y, w: a.w, d: a.d, notes: '', level: 1,
    name: a.room ? `${roomName[lang] || roomName.en} ${a.room}` : a.hall ? hallName[lang] || hallName.en : kindLabel(a.kind, lang, AREA_KINDS),
  }))
}

/**
 * Põe (ou troca) o 2º andar: cômodos do andar de cima + a mesma escada embaixo e em cima.
 * kind = 'dining' | 'rooms' | 'office'; fill = já colocar os equipamentos típicos lá em cima.
 */
export function addUpperFloor(layout, kind = 'dining', { lang = 'en', fill = true } = {}) {
  const W = layout.width
  const D = layout.depth
  let ground = levelLayout(layout, 0)
  const hasStairs = ground.elements.find(e => e.kind === 'stairs')
  const stairsName = kindLabel('stairs', lang)
  if (!hasStairs) {
    const spot = stairsSpot(ground)
    const area = ground.areas.find(a => spot.x + spot.w / 2 >= a.x && spot.x + spot.w / 2 <= a.x + a.w && spot.y + spot.d / 2 >= a.y && spot.y + spot.d / 2 <= a.y + a.d)
    ground = { ...ground, elements: [...ground.elements, { id: newId('el'), kind: 'stairs', name: stairsName, areaId: area?.id || null, ...spot }] }
  }
  const stairs = hasStairs || ground.elements[ground.elements.length - 1]
  const areas = upperAreas(W, D, kind, lang)
  const upArea = areas.find(a => stairs.x + stairs.w / 2 >= a.x && stairs.x + stairs.w / 2 <= a.x + a.w && stairs.y + stairs.d / 2 >= a.y && stairs.y + stairs.d / 2 <= a.y + a.d)
  let upper = normalizeLayout({
    width: W, depth: D, areas,
    walls: [...perimeterWalls(W, D, 2.6), ...roomWalls(areas)],
    elements: [{ id: newId('el'), kind: 'stairs', name: stairsName, areaId: upArea?.id || null, x: stairs.x, y: stairs.y, w: stairs.w, d: stairs.d }],
  })
  if (fill) upper = fillAllRooms(upper, lang).layout
  const withGround = mergeLevel({ ...layout, levels: 2 }, 0, ground)
  return mergeLevel({ ...withGround, levels: 2 }, 1, upper)
}

/** Tira o 2º andar inteiro (e a escada do térreo). */
export function removeUpperFloors(layout) {
  const ground = levelLayout(layout, 0)
  return normalizeLayout({ ...ground, elements: ground.elements.filter(e => e.kind !== 'stairs'), levels: 1 })
}

/** Monta um modelo pronto inteiro (cômodos + equipamentos + 2º andar se tiver). */
export function buildTemplate(tpl, { lang = 'en', fill = true, upper } = {}) {
  let l = generatePlan({ width: tpl.width, depth: tpl.depth, preset: tpl.preset, rooms: tpl.rooms, lang })
  const up = upper === undefined ? tpl.upper : upper
  // escada primeiro: as mesas do térreo se ajeitam em volta dela
  if (up) l = addUpperFloor(l, up, { lang, fill })
  if (fill) l = fillLevel(l, 0, lang)
  return l
}

/** Equipamentos típicos em todos os cômodos de um andar. */
export function fillLevel(layout, level, lang = 'en') {
  return mergeLevel(layout, level, fillAllRooms(levelLayout(layout, level), lang).layout)
}
export const OPTIONAL_ROOMS = ['entrance', 'restroom', 'washing', 'storage', 'office', 'bar']

function row(x, y, w, d, items) {
  const total = items.reduce((s, it) => s + it.weight, 0)
  let cx = x
  return items.map((it, i) => {
    const ww = i === items.length - 1 ? x + w - cx : r1((w * it.weight) / total)
    const a = { kind: it.kind, x: r1(cx), y: r1(y), w: r1(ww), d: r1(d) }
    cx += ww
    return a
  })
}

/**
 * Gera cômodos + paredes (com vão de porta) a partir de um modelo pronto.
 * rooms = { entrance, restroom, washing, storage, office, bar } (true/false).
 */
export function generatePlan({ width = 12, depth = 8, preset = 'side', rooms = {}, lang = 'en' } = {}) {
  const W = Math.max(3, Number(width) || 12)
  const D = Math.max(3, Number(depth) || 8)
  const on = k => !!rooms[k]
  const service = ['washing', 'storage', 'office'].filter(on).map(kind => ({ kind, weight: 1 }))
  let raw = []

  // salão com a entrada na frente: faixa da porta embaixo à esquerda, o resto continua sendo salão
  const diningBlock = (x, y, w, d) => {
    if (!on('entrance') || d < 3) return [{ kind: 'dining', x, y, w, d }]
    const eD = r1(Math.min(1.6, d / 3))
    const eW = w - 3 < 2 ? w : 3
    const out = [{ kind: 'dining', x, y, w, d: r1(d - eD) }, { kind: 'entrance', x, y: r1(y + d - eD), w: r1(eW), d: eD }]
    if (eW < w) out.push({ kind: 'dining', x: r1(x + eW), y: r1(y + d - eD), w: r1(w - eW), d: eD, same: true })
    return out
  }

  if (preset === 'open') {
    // um salão só, com a cozinha num canto do fundo e banheiro/serviço embaixo dela
    const kW = r1(Math.min(W * 0.4, 4))
    const kD = r1(Math.min(D * 0.45, 3.5))
    raw.push({ kind: 'kitchen', x: r1(W - kW), y: 0, w: kW, d: kD })
    raw.push(...diningBlock(0, 0, r1(W - kW), D))
    const extra = [...(on('restroom') ? ['restroom'] : []), ...service.map(x => x.kind)].slice(0, 2)
    let y = kD
    const left = D - kD
    const each = extra.length ? Math.min(2.2, left / (extra.length + (left > extra.length * 2.2 + 1.5 ? 1 : 0))) : 0
    const spare = left - each * extra.length
    if (spare >= 1.5) { raw.push({ kind: 'dining', x: r1(W - kW), y: r1(y), w: kW, d: r1(spare), same: true }); y = r1(y + spare) }
    extra.forEach((kind, i) => {
      const d = r1(i === extra.length - 1 ? D - y : each + (spare < 1.5 ? spare / extra.length : 0))
      raw.push({ kind, x: r1(W - kW), y: r1(y), w: kW, d })
      y = r1(y + d)
    })
    if (!extra.length && left > 0.5) raw.push({ kind: 'dining', x: r1(W - kW), y: kD, w: kW, d: r1(left), same: true })
  } else if (preset === 'back' || preset === 'bar') {
    // cozinha no fundo (y = 0) ocupando a largura, com banheiro e serviço ao lado; salão na frente
    const kD = r1(Math.min(D * 0.38, 4))
    const extras = [...(on('restroom') ? [{ kind: 'restroom', weight: 1 }] : []), ...service]
    // loja estreita: cada cômodo do fundo precisa de ~1,8 m; o que não cabe vai para uma segunda faixa
    const fitBack = Math.max(0, Math.floor((W * 0.5) / 1.8))
    const back = [{ kind: 'kitchen', weight: extras.slice(0, fitBack).length ? 3 : 1 }, ...extras.slice(0, fitBack)]
    raw.push(...row(0, 0, W, kD, back))
    let y = kD
    const overflow = extras.slice(fitBack)
    if (overflow.length) {
      const oD = r1(Math.min(2.2, D * 0.18))
      raw.push(...row(0, y, W, oD, overflow))
      y = r1(y + oD)
    }
    if (preset === 'bar' || on('bar')) {
      const bD = 1.4
      raw.push({ kind: 'bar', x: 0, y: r1(y), w: W, d: bD })
      y += bD
    }
    raw.push(...diningBlock(0, r1(y), W, r1(D - y)))
  } else if (preset === 'office') {
    // escritório: sala grande na frente; copa, banheiro e depósito numa faixa no fundo
    const bD = r1(Math.min(2.6, D * 0.35))
    const back = [{ kind: 'kitchen', weight: 1 }, ...(on('restroom') ? [{ kind: 'restroom', weight: 1 }] : []), ...(on('storage') ? [{ kind: 'storage', weight: 1 }] : [])]
    raw.push(...row(0, 0, W, bD, back))
    const eD = on('entrance') ? r1(Math.min(1.6, (D - bD) / 3)) : 0
    raw.push({ kind: 'office', x: 0, y: bD, w: W, d: r1(D - bD - eD) })
    if (eD) raw.push({ kind: 'entrance', x: 0, y: r1(D - eD), w: r1(Math.min(3, W)), d: eD }, ...(W > 3.5 ? [{ kind: 'office', x: 3, y: r1(D - eD), w: r1(W - 3), d: eD, same: true }] : []))
  } else if (preset === 'shop') {
    // loja: área de vendas na frente, depósito e banheiro no fundo
    const bD = r1(Math.min(2.6, D * 0.3))
    const back = [{ kind: 'storage', weight: 2 }, ...(on('restroom') ? [{ kind: 'restroom', weight: 1 }] : []), ...(on('office') ? [{ kind: 'office', weight: 1 }] : [])]
    raw.push(...row(0, 0, W, bD, back))
    const eD = on('entrance') ? r1(Math.min(1.6, (D - bD) / 3)) : 0
    raw.push({ kind: 'sales', x: 0, y: bD, w: W, d: r1(D - bD - eD) })
    if (eD) raw.push({ kind: 'entrance', x: 0, y: r1(D - eD), w: r1(Math.min(3, W)), d: eD }, ...(W > 3.5 ? [{ kind: 'sales', x: 3, y: r1(D - eD), w: r1(W - 3), d: eD, same: true }] : []))
  } else {
    // 'side': salão à esquerda, cozinha à direita, serviço embaixo da cozinha
    const kW = r1(Math.min(W * 0.4, 6))
    const dW = r1(W - kW)
    const sD = service.length ? r1(Math.min(2.5, D / 3)) : 0
    raw.push({ kind: 'kitchen', x: dW, y: 0, w: kW, d: r1(D - sD) })
    if (service.length) raw.push(...row(dW, r1(D - sD), kW, sD, service))
    const hasBar = on('bar')
    const rrD = on('restroom') || on('entrance') ? r1(Math.min(2.5, D / 3)) : 0
    if (hasBar) raw.push({ kind: 'bar', x: r1(dW - 1.4), y: 0, w: 1.4, d: r1(D - rrD) })
    raw.push({ kind: 'dining', x: 0, y: 0, w: hasBar ? r1(dW - 1.4) : dW, d: r1(D - rrD) })
    if (rrD) {
      const bottom = [...(on('entrance') ? [{ kind: 'entrance', weight: 1 }] : [{ kind: 'dining', weight: 1, same: true }]), ...(on('restroom') ? [{ kind: 'restroom', weight: 1 }] : [])]
      raw.push(...row(0, r1(D - rrD), dW, rrD, bottom).map((a, i) => ({ ...a, same: bottom[i].same })))
    }
  }

  const count = {}
  const areas = raw.filter(a => a.w >= 0.5 && a.d >= 0.5).map(a => {
    // pedaço do mesmo salão: mesmo nome, sem número
    if (!a.same) count[a.kind] = (count[a.kind] || 0) + 1
    const label = kindLabel(a.kind, lang, AREA_KINDS)
    return { id: newId('area'), kind: a.kind, name: count[a.kind] > 1 ? `${label} ${count[a.kind]}` : label, x: a.x, y: a.y, w: a.w, d: a.d, notes: '' }
  })
  const walls = [...perimeterWalls(W, D, 2.6), ...roomWalls(areas)]
  return normalizeLayout({ width: W, depth: D, areas, walls, elements: [] })
}

// cômodos que se ligam sem parede (mesmo ambiente)
const OPEN_PAIRS = new Set(['dining|entrance', 'bar|dining', 'kitchen|washing', 'kitchen|ventilation', 'bar|entrance', 'dining|dining', 'entrance|office', 'office|office', 'entrance|sales', 'sales|sales'])
const DOOR = 0.9

/** Paredes entre cômodos vizinhos, com um vão de porta no meio do trecho em comum. */
export function roomWalls(areas) {
  const out = []
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const a = areas[i]
      const b = areas[j]
      if (OPEN_PAIRS.has([a.kind, b.kind].sort().join('|'))) continue
      const segs = []
      // borda vertical em comum
      for (const [p, q] of [[a, b], [b, a]]) {
        if (Math.abs(p.x + p.w - q.x) < 0.05) {
          const y1 = Math.max(p.y, q.y)
          const y2 = Math.min(p.y + p.d, q.y + q.d)
          if (y2 - y1 > 0.3) segs.push({ x1: q.x, y1, x2: q.x, y2 })
        }
        if (Math.abs(p.y + p.d - q.y) < 0.05) {
          const x1 = Math.max(p.x, q.x)
          const x2 = Math.min(p.x + p.w, q.x + q.w)
          if (x2 - x1 > 0.3) segs.push({ x1, y1: q.y, x2, y2: q.y })
        }
      }
      for (const sgm of segs) {
        const len = Math.hypot(sgm.x2 - sgm.x1, sgm.y2 - sgm.y1)
        if (len < DOOR + 0.6) { out.push({ id: newId('wall'), ...sgm, h: 2.6 }); continue }
        const vert = sgm.x1 === sgm.x2
        const mid = vert ? (sgm.y1 + sgm.y2) / 2 : (sgm.x1 + sgm.x2) / 2
        const g1 = r2(mid - DOOR / 2)
        const g2 = r2(mid + DOOR / 2)
        if (vert) {
          out.push({ id: newId('wall'), x1: sgm.x1, y1: sgm.y1, x2: sgm.x1, y2: g1, h: 2.6 })
          out.push({ id: newId('wall'), x1: sgm.x1, y1: g2, x2: sgm.x1, y2: sgm.y2, h: 2.6 })
        } else {
          out.push({ id: newId('wall'), x1: sgm.x1, y1: sgm.y1, x2: g1, y2: sgm.y1, h: 2.6 })
          out.push({ id: newId('wall'), x1: g2, y1: sgm.y1, x2: sgm.x2, y2: sgm.y1, h: 2.6 })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Ajustes rápidos do item selecionado
// ---------------------------------------------------------------------------

/** Move o item (dx, dy em metros) sem sair da planta. */
export function nudge(layout, el, dx, dy) {
  return {
    x: r2(Math.max(0, Math.min(layout.width - el.w, el.x + dx))),
    y: r2(Math.max(0, Math.min(layout.depth - el.d, el.y + dy))),
  }
}

/** Gira 90° (troca largura e profundidade mantendo o centro). */
export function rotate90(layout, el) {
  const cx = el.x + el.w / 2
  const cy = el.y + el.d / 2
  const w = el.d
  const d = el.w
  return {
    w, d,
    x: r2(Math.max(0, Math.min(layout.width - w, cx - w / 2))),
    y: r2(Math.max(0, Math.min(layout.depth - d, cy - d / 2))),
  }
}

/** Encosta o item na borda mais próxima do cômodo dele (ou da loja). */
export function snapToWall(layout, el) {
  const area = layout.areas.find(a => a.id === el.areaId)
    || layout.areas.find(a => el.x + el.w / 2 >= a.x && el.x + el.w / 2 <= a.x + a.w && el.y + el.d / 2 >= a.y && el.y + el.d / 2 <= a.y + a.d)
    || { x: 0, y: 0, w: layout.width, d: layout.depth }
  const dist = {
    top: el.y - area.y,
    bottom: area.y + area.d - (el.y + el.d),
    left: el.x - area.x,
    right: area.x + area.w - (el.x + el.w),
  }
  const edge = Object.keys(dist).sort((a, b) => dist[a] - dist[b])[0]
  if (edge === 'top') return { y: r2(area.y) }
  if (edge === 'bottom') return { y: r2(area.y + area.d - el.d) }
  if (edge === 'left') return { x: r2(area.x) }
  return { x: r2(area.x + area.w - el.w) }
}

/** Centraliza o item no cômodo dele. */
export function centerInArea(layout, el) {
  const area = layout.areas.find(a => a.id === el.areaId) || { x: 0, y: 0, w: layout.width, d: layout.depth }
  return { x: r2(area.x + (area.w - el.w) / 2), y: r2(area.y + (area.d - el.d) / 2) }
}

/** Cópia do item logo ao lado (mesmo tamanho). */
export function duplicateItem(layout, el, lang = 'en') {
  const id = newId('el')
  const base = el.name.replace(/\s+\d+$/, '')
  let rect = { x: el.x + el.w + 0.2, y: el.y, w: el.w, d: el.d }
  if (rect.x + rect.w > layout.width) rect = { ...rect, x: el.x, y: el.y + el.d + 0.2 }
  rect.x = Math.max(0, Math.min(layout.width - el.w, rect.x))
  rect.y = Math.max(0, Math.min(layout.depth - el.d, rect.y))
  const copy = { ...el, id, name: uniqueName(layout, el.kind, lang, base), x: r2(rect.x), y: r2(rect.y), photos: [], last_serviced_at: null }
  if (Array.isArray(el.tasks)) copy.tasks = el.tasks.map(t => ({ ...t, last_done: null }))
  return { layout: normalizeLayout({ ...layout, elements: [...layout.elements, copy] }), id }
}
