#!/usr/bin/env node
import {
  normalizeLayout,
  restaurantTemplate,
  ruleRecommendations,
  dedupeRecommendations,
  areaForElement,
  perimeterWalls,
  withServiceLog,
  elementStatus,
  statusMap,
  todoElementIds,
  elementHistory,
  mergeLayoutAdditions,
} from '../src/lib/facilityModel.js'
import { FACILITY_STATEMENTS, FACILITY_SETUP_SQL } from '../src/lib/facilitySetupSql.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('=== Smart Facility model tests ===\n')

// normalizeLayout: junk from the AI is cleaned and clamped into the plan
const messy = normalizeLayout({
  width: '10',
  depth: 6,
  areas: [
    { id: 'k', name: 'Kitchen', kind: 'kitchen', x: 8, y: 0, w: 5, d: 3 },
    { id: 'k', name: 'Dup id', kind: 'spaceship', x: -3, y: 2, w: 2, d: 2 },
  ],
  walls: [{ x1: 0, y1: 0, x2: 0, y2: 0 }, { x1: 0, y1: 0, x2: 20, y2: 0 }],
  elements: [
    { id: 'h', name: 'Hood', kind: 'range_hood', areaId: 'k', x: 99, y: 1, w: 1, d: 0.5 },
    { name: '', kind: 'nope', areaId: 'missing', last_serviced_at: 'yesterday' },
  ],
})
assert(messy.width === 10 && messy.depth === 6, 'width/depth parsed')
assert(messy.areas[0].x + messy.areas[0].w <= 10, 'area clamped inside plan')
assert(messy.areas[1].id !== messy.areas[0].id, 'duplicate ids made unique')
assert(messy.areas[1].kind === 'other' && messy.areas[1].x === 0, 'unknown area kind -> other, negative x clamped')
assert(messy.walls.length === 1 && messy.walls[0].x2 === 10, 'zero-length wall dropped, wall clamped')
assert(messy.elements[0].x === 9, 'element clamped inside plan')
assert(messy.elements[1].kind === 'other' && messy.elements[1].areaId === null, 'unknown element kind/area cleaned')
assert(messy.elements[1].last_serviced_at === null, 'invalid date dropped')
assert(normalizeLayout(null).width === 12, 'null layout -> defaults')

// template is valid and every element lands in an area
const tpl = restaurantTemplate(12, 8)
assert(tpl.areas.length >= 5 && tpl.elements.length >= 8, 'template has areas and equipment')
assert(tpl.elements.every(el => areaForElement(tpl, el)), 'template elements are located in an area')
assert(perimeterWalls(5, 4).length === 4, 'perimeter has 4 walls')

// recommendations by maintenance interval
const now = new Date('2026-10-16T12:00:00+09:00')
const layout = normalizeLayout({
  width: 10, depth: 8,
  elements: [
    { id: 'hood', name: 'Hood', kind: 'range_hood', last_serviced_at: '2026-04-01' },   // 198 days, interval 90 -> high
    { id: 'trap', name: 'Trap', kind: 'grease_trap', last_serviced_at: '2026-09-28' },  // 18 days, interval 15 -> medium
    { id: 'ac', name: 'AC', kind: 'air_conditioner', last_serviced_at: '2026-10-10' },  // 6 days -> nothing
    { id: 'fr', name: 'Fridge', kind: 'fridge' },                                         // no record -> medium
    { id: 'sw', name: 'Switch', kind: 'light_switch' },                                   // no service -> nothing
    { id: 'du', name: 'Duct', kind: 'duct', last_serviced_at: '2026-04-25' },           // 174/180 -> low (due soon)
  ],
})
const recs = ruleRecommendations(layout, now)
const by = Object.fromEntries(recs.map(r => [r.element_id, r]))
assert(by.hood?.priority === 'high', 'very overdue hood is high priority')
assert(by.trap?.priority === 'medium', 'overdue grease trap is medium')
assert(!by.ac, 'recently cleaned AC has no recommendation')
assert(by.fr?.priority === 'medium', 'element without record gets a recommendation')
assert(!by.sw, 'switch has no cleaning service')
assert(by.du?.priority === 'low', 'duct due soon is low priority')

const deduped = dedupeRecommendations(
  [...recs, { ...by.hood }],
  [{ element_id: 'trap', service: by.trap.service, status: 'pending' }, { element_id: 'fr', service: by.fr.service, status: 'declined' }],
)
assert(!deduped.some(r => r.element_id === 'trap'), 'pending recommendation not duplicated')
assert(deduped.some(r => r.element_id === 'fr'), 'declined recommendation can be suggested again')
assert(deduped.filter(r => r.element_id === 'hood').length === 1, 'candidates deduped among themselves')

// SQL
assert(FACILITY_STATEMENTS.some(s => s.includes('create table if not exists facility_models')), 'models table SQL')
assert(FACILITY_SETUP_SQL.includes('facility_recommendations') && !FACILITY_SETUP_SQL.includes(');;'), 'setup SQL rendered')

// v1.0.49: cleaning history from jobs drives last cleaned date, map colours and to-dos
const histLayout = normalizeLayout({
  width: 10, depth: 8,
  elements: [
    { id: 'hood', kind: 'range_hood', last_serviced_at: '2026-01-01' },
    { id: 'trap', kind: 'grease_trap' },
    { id: 'tbl', kind: 'table' },
  ],
})
const logs = [
  { id: 'l1', element_id: 'hood', service_date: '2026-10-10', created_at: '2026-10-10T01:00:00Z' },
  { id: 'l2', element_id: 'hood', service_date: '2026-09-01', created_at: '2026-09-01T01:00:00Z' },
]
const live = withServiceLog(histLayout, logs)
const nowH = new Date('2026-10-16T03:00:00Z')
assert(live.elements.find(e => e.id === 'hood').last_serviced_at === '2026-10-10', 'log date beats older manual date')
assert(histLayout.elements.find(e => e.id === 'hood').last_serviced_at === '2026-01-01', 'original layout untouched')
assert(elementStatus(live.elements[0], nowH) === 'ok', 'recently cleaned hood is ok')
assert(elementStatus(histLayout.elements[0], nowH) === 'overdue', 'hood without log is overdue')
assert(elementStatus(live.elements[1], nowH) === 'none', 'trap without record = none')
assert(elementStatus(live.elements[2], nowH) === null, 'table has no recurring cleaning')
assert(elementStatus({ kind: 'grease_trap', last_serviced_at: '2026-10-03' }, nowH) === 'due', '13 of 15 days = due soon')
const sm = statusMap(live, nowH)
assert(sm.get('hood') === 'ok' && !sm.has('tbl'), 'status map')
assert(!ruleRecommendations(live, nowH).some(r => r.element_id === 'hood'), 'logged cleaning stops the hood recommendation')
const td = todoElementIds([{ element_id: 'hood', status: 'accepted' }, { element_id: 'trap', status: 'pending' }, { element_id: 'tbl', status: 'done' }])
assert(td.has('hood') && td.size === 1, 'only accepted recs are to-dos')
assert(elementHistory('hood', logs)[0].id === 'l1', 'history newest first')
assert(FACILITY_SETUP_SQL.includes('facility_service_log') && FACILITY_SETUP_SQL.includes("'done'"), 'service log table + done status in SQL')

// v1.0.50: build the model photo by photo without duplicating or erasing corrections
const start = normalizeLayout({
  width: 10, depth: 8,
  areas: [{ id: 'k', name: 'Kitchen (fixed by admin)', kind: 'kitchen', x: 6, y: 0, w: 4, d: 5 }],
  elements: [{ id: 'hood', name: 'Main hood', kind: 'range_hood', areaId: 'k', x: 7, y: 0.1, w: 2, d: 0.8, location_hint: 'Above the stove' }],
})
assert(start.elements[0].important === true, 'range hood is important by default')
assert(normalizeLayout({ elements: [{ kind: 'table' }] }).elements[0].important === false, 'table not important by default')
assert(normalizeLayout({ elements: [{ kind: 'breaker', important: false }] }).elements[0].important === false, 'admin can turn important off')
const r1 = mergeLayoutAdditions(start, {
  width: 12, depth: 8,
  areas: [{ id: 'kx', name: 'Kitchen', kind: 'kitchen', x: 6.2, y: 0, w: 3.8, d: 5 }, { id: 'st', name: 'Storage', kind: 'storage', x: 10, y: 0, w: 2, d: 3 }],
  elements: [
    { name: 'Hood', kind: 'range_hood', areaId: 'kx', x: 7.3, y: 0.2, w: 2, d: 0.8, instructions: 'Switch on the right' },
    { name: 'Breaker', kind: 'breaker', areaId: 'st', x: 11, y: 0.2, w: 0.5, d: 0.2 },
  ],
}, 'facility/m1/p1.jpg')
assert(r1.layout.width === 12 && r1.grew, 'plan can grow')
assert(r1.layout.areas.length === 2 && r1.layout.areas[0].name === 'Kitchen (fixed by admin)', 'same area not duplicated, admin name kept')
const hood = r1.layout.elements.find(e => e.kind === 'range_hood')
assert(r1.layout.elements.filter(e => e.kind === 'range_hood').length === 1, 'same hood not duplicated')
assert(hood.name === 'Main hood' && hood.location_hint === 'Above the stove', 'existing texts kept')
assert(hood.instructions === 'Switch on the right', 'missing instructions filled')
assert(hood.photos.includes('facility/m1/p1.jpg'), 'photo linked to existing item')
const br = r1.layout.elements.find(e => e.kind === 'breaker')
assert(br && br.photos[0] === 'facility/m1/p1.jpg' && br.areaId === r1.layout.areas[1].id, 'new item added with photo and mapped area')
assert(r1.added.includes('Storage') && r1.added.includes('Breaker') && r1.updated.includes('Main hood'), 'added/updated lists')
const r2 = mergeLayoutAdditions(r1.layout, { elements: [{ name: 'Hood', kind: 'range_hood', x: 7.2, y: 0.1, w: 2, d: 0.8 }] }, 'facility/m1/p1.jpg')
assert(r2.layout.elements.find(e => e.kind === 'range_hood').photos.length === 1, 'same photo not linked twice')
assert(mergeLayoutAdditions(start, null, null).layout.elements.length === 1, 'empty AI answer changes nothing')

console.log('✅ Smart Facility model tests passed')
