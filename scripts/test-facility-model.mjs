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
  elementTasks,
  careForElement,
  careSchedule,
  serviceOffers,
  taskState,
} from '../src/lib/facilityModel.js'
import { generatePlan, fillAllRooms, fillRoom, placeItem, PLAN_PRESETS, rotate90, snapToWall, nudge, duplicateItem } from '../src/lib/facilityBuilder.js'
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

// --- v1.0.52: cleaning + maintenance tasks ---
const now52 = new Date('2026-10-17T03:00:00Z')
const hoodEl = normalizeLayout({ elements: [{ id: 'h', kind: 'range_hood', name: 'Hood', last_serviced_at: '2026-09-01' }] }).elements[0]
const hoodTasks = elementTasks(hoodEl)
assert(hoodTasks.length === 2 && hoodTasks[0].type === 'cleaning' && hoodTasks[1].type === 'maintenance', 'hood has default cleaning + maintenance')
assert(hoodTasks[0].last_done === '2026-09-01', 'legacy last_serviced_at goes to the cleaning task')
const hoodLogs = [
  { element_id: 'h', service_date: '2026-10-10', service: 'Hood filter & fan check' },
  { element_id: 'h', service_date: '2026-10-01', service: 'Some AI name' },
]
const hc = careForElement(hoodEl, hoodLogs)
assert(hc[1].last === '2026-10-10', 'maintenance log matched by task name')
assert(hc[0].last === '2026-10-01', 'unknown service name counts as main cleaning')
assert(taskState({ interval_days: 30, last: '2026-09-01' }, now52).status === 'overdue', 'overdue after interval')
assert(taskState({ interval_days: 30, last: '2026-10-15' }, now52).daysLeft === 28, 'days left')
assert(taskState({ interval_days: 30, last: null }, now52).status === 'none', 'never done')
assert(taskState({ interval_days: null, last: null }, now52).status === null, 'no interval = no status')
const custom = normalizeLayout({ elements: [{ id: 'x', kind: 'table', tasks: [{ type: 'maintenance', name: 'Tighten legs', interval_days: 90, last_done: '2026-01-01' }, { name: '' }] }] }).elements[0]
assert(custom.tasks.length === 1 && custom.tasks[0].name === 'Tighten legs', 'custom tasks kept, empty dropped')
const live52 = withServiceLog({ width: 10, depth: 8, areas: [], walls: [], elements: [hoodEl, custom] }, hoodLogs)
const sched = careSchedule(live52, now52)
assert(sched[0].status === 'overdue' && sched[0].task.name === 'Tighten legs', 'schedule: most overdue first')
assert(elementStatus(live52.elements[0], now52) === 'ok', 'hood ok after recent logs')
assert(ruleRecommendations(live52, now52).some(r => r.service === 'Tighten legs'), 'rules offer overdue maintenance')
const neverMaint = withServiceLog({ width: 10, depth: 8, areas: [], walls: [], elements: [normalizeLayout({ elements: [{ id: 'b', kind: 'breaker' }] }).elements[0]] }, [])
assert(ruleRecommendations(neverMaint, now52).length === 0, 'never-recorded maintenance alone does not create an offer')

// --- v1.0.53: há quantos dias + serviços para oferecer ---
assert(taskState({ interval_days: 30, last: '2026-10-15' }, now52).daysSince === 2, 'days since last time')
const offerModels = [
  { id: 'm1', client_id: 'c1', status: 'approved', name: 'Shop', location_name: 'Ebisu', layout: { width: 10, depth: 8, elements: [hoodEl, custom] } },
  { id: 'm2', client_id: 'c2', status: 'draft', name: 'Draft', layout: { width: 10, depth: 8, elements: [custom] } },
]
const offers = serviceOffers(offerModels, hoodLogs.map(l => ({ ...l, model_id: 'm1' })), { now: now52 })
assert(offers.length >= 1 && offers.every(o => o.model_id === 'm1'), 'offers only from approved stores')
assert(offers[0].task_name === 'Tighten legs' && offers[0].status === 'overdue' && offers[0].daysSince > 90 && offers[0].location === 'Ebisu', 'most overdue offer first, with days since')
assert(!offers.some(o => o.status === 'ok' && o.daysLeft > 14), 'offers skip tasks far from due')
assert(JSON.parse(JSON.stringify(offers)).length === offers.length, 'offers are plain objects')

// --- v1.0.52: easy builder ---
const ov = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > 0.01
for (const [W, D] of [[12, 8], [6, 15], [20, 12], [5, 5]]) {
  for (const preset of PLAN_PRESETS) {
    const plan = generatePlan({ width: W, depth: D, preset, rooms: { entrance: true, restroom: true, washing: true, storage: true, office: true } })
    const sum = plan.areas.reduce((s2, a) => s2 + a.w * a.d, 0)
    assert(Math.abs(sum - W * D) < 0.6, `${preset} ${W}x${D}: rooms cover the store (${sum})`)
    for (let i = 0; i < plan.areas.length; i++) for (let j = i + 1; j < plan.areas.length; j++) {
      assert(!ov(plan.areas[i], plan.areas[j]), `${preset} ${W}x${D}: rooms do not overlap`)
    }
    assert(plan.areas.some(a => a.kind === 'kitchen') && plan.walls.length >= 4, `${preset}: has kitchen and walls`)
    const filled = fillAllRooms(plan).layout
    assert(filled.elements.length > plan.areas.length, `${preset}: rooms filled`)
    assert(filled.elements.every(e => e.x >= 0 && e.y >= 0 && e.x + e.w <= W + 1e-6 && e.y + e.d <= D + 1e-6), `${preset}: items inside the store`)
  }
}
const base52 = generatePlan({ width: 12, depth: 8, preset: 'side', rooms: { restroom: true } })
const kitchen52 = base52.areas.find(a => a.kind === 'kitchen')
const p1 = placeItem(base52, 'stove')
const stove = p1.layout.elements.find(e => e.id === p1.id)
assert(p1.areaId === kitchen52.id, 'stove goes to the kitchen')
assert(Math.abs(stove.y - kitchen52.y) < 0.01, 'stove against the back wall')
const p2 = placeItem(p1.layout, 'range_hood')
const hood52 = p2.layout.elements.find(e => e.id === p2.id)
assert(ov(hood52, stove), 'hood placed over the stove')
const p3 = placeItem(p2.layout, 'stove')
assert(!ov(p3.layout.elements.find(e => e.id === p3.id), stove), 'second stove does not overlap the first')
const p4 = placeItem(p3.layout, 'toilet')
assert(p4.layout.areas.find(a => a.id === p4.areaId).kind === 'restroom', 'toilet goes to the restroom')
const dining52 = base52.areas.find(a => a.kind === 'dining')
const tables = fillRoom(base52, dining52.id).layout.elements.filter(e => e.kind === 'table')
assert(tables.length >= 3, 'dining gets several tables')
for (let i = 0; i < tables.length; i++) for (let j = i + 1; j < tables.length; j++) assert(!ov(tables[i], tables[j]), 'tables do not overlap')
const rot = rotate90(base52, { x: 1, y: 1, w: 2, d: 0.5 })
assert(rot.w === 0.5 && rot.d === 2 && Math.abs(rot.x + 0.25 - 2) < 0.01, 'rotate keeps the center')
assert(snapToWall(base52, { x: 0.3, y: 2, w: 1, d: 1 }).x === 0, 'snap to nearest wall')
assert(nudge(base52, { x: 11.5, y: 0, w: 1, d: 1 }, 1, -1).x === 11, 'nudge stays inside')
const dup = duplicateItem(p1.layout, stove)
assert(dup.layout.elements.length === p1.layout.elements.length + 1 && !dup.layout.elements.find(e => e.id === dup.id).photos.length, 'duplicate without photos')

console.log('✅ Smart Facility model tests passed')
