// Map pins whose names would overlap become one group; the group takes the worst status color.
import assert from 'node:assert/strict'
import { clusterPixels, worstStatus } from '../src/lib/pinClusters.js'

const g = clusterPixels([{ x: 100, y: 100 }, { x: 140, y: 110 }, { x: 400, y: 100 }, { x: 100, y: 300 }])
assert.equal(g.length, 3)
assert.equal(g[0].items.length, 2)
assert.equal(clusterPixels([{ x: 0, y: 0 }, { x: 200, y: 0 }]).length, 2)
assert.equal(worstStatus(['ok', 'week', 'none']), 'week')
assert.equal(worstStatus(['ok', 'overdue', 'due']), 'overdue')
assert.equal(worstStatus([]), 'none')
console.log('pin clusters ok')
