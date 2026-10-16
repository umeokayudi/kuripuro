#!/usr/bin/env node
import {
  normalizeLayout,
  restaurantTemplate,
  ruleRecommendations,
  dedupeRecommendations,
  areaForElement,
  perimeterWalls,
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

console.log('✅ Smart Facility model tests passed')
