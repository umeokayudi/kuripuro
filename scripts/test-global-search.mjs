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
