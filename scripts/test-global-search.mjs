#!/usr/bin/env node
// v1.0.102 · global search matching (pure).
import { matches, normSearch } from '../src/lib/globalSearch.js'
const assert = (c, m) => { if (!c) throw new Error(m) }
assert(matches('Kodama Ramen 新宿三丁目店', 'kodama'), 'case')
assert(matches('ＫＯＤＡＭＡ フーズ', 'Kodama'), 'full-width')
assert(matches('Café Bom Dia', 'cafe bom'), 'accents + two words')
assert(!matches('Sushi Takumi', 'kodama'), 'no match')
assert(normSearch('  A   B ') === 'a b', 'spaces')
console.log('global search: ok')

// v1.0.114 · grouping + places that only exist in Contracts
import { groupResults, placeIndex, SEARCH_GROUPS } from '../src/lib/globalSearch.js'
const g = groupResults([
  { type: 'person', id: 'e1' }, { type: 'invoice', id: 'f1' }, { type: 'client', id: 'c1' },
  { type: 'place', id: 'p1' }, { type: 'job', id: 'j1' }, { type: 'client', id: 'c2' },
])
assert(g.map(x => x.type).join() === SEARCH_GROUPS.join(), 'group order cliente/local/serviço/fatura/pessoa')
assert(g[0].items.length === 2, 'two clients in one group')
assert(groupResults([]).length === 0, 'no empty groups')
const pl = placeIndex(
  [{ id: 'l1', name: 'Shinbashi', client_id: null, address: '' }],
  [{ id: 'k1', location_name: 'Kodama Yurakucho', client_id: 'kodama', location_address: '有楽町1-1' },
   { id: 'k2', location_name: 'shinbashi', client_id: 'otp', location_address: '新橋1-1' }],
)
const kodama = pl.find(p => matches(p.name, 'kodama yurakucho'))
assert(kodama && kodama.contractOnly && kodama.client_id === 'kodama', 'contract-only place is searchable')
const sb = pl.filter(p => normSearch(p.name) === 'shinbashi')
assert(sb.length === 1 && sb[0].client_id === 'otp' && sb[0].address === '新橋1-1', 'one row per place, contract fills the gaps')
console.log('global search groups: ok')
