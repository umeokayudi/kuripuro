// Ponto por NFC: tag IDs, who is asked, and whether a sticker belongs to the job's location.
import assert from 'node:assert/strict'
import { normalizeTagUid, nfcActiveFor, matchTag, tagPlace } from '../src/lib/nfcClock.js'

assert.equal(normalizeTagUid('04:a2:5f:1b'), '04A25F1B')
assert.equal(normalizeTagUid(' 04-A2 5f '), '04A25F')
assert.equal(normalizeTagUid(null), '')

assert.equal(nfcActiveFor(null, false), false)
assert.equal(nfcActiveFor(null, true), true)
assert.equal(nfcActiveFor('', true), true)
assert.equal(nfcActiveFor('on', false), true)
assert.equal(nfcActiveFor('off', true), false)

const tags = [
  { id: 1, tag_uid: '04A25F1B', location_name: 'Sushi Ginza', client_id: 'c1', client_name: 'Ginza Foods' },
  { id: 2, tag_uid: '0499', location_name: 'Cafe Shibuya', client_id: 'c2' },
  { id: 3, tag_uid: '0477', client_id: 'c3', client_name: 'Tokyo Office' },
  { id: 4, tag_uid: '0466', location_name: 'Sushi Ginza', is_active: false },
]
const job = { title: 'Sushi Ginza — Basic', client_id: 'c1', client_name: 'Ginza Foods' }

assert.equal(matchTag('04:a2:5f:1b', tags, job).status, 'ok')
assert.equal(matchTag('sushi', tags, job).status, 'unknown')
assert.equal(matchTag('', tags, job).status, 'unknown')
assert.equal(matchTag('0499', tags, job).status, 'other_place')
assert.equal(matchTag('0466', tags, job).status, 'unknown', 'turned-off sticker counts as unregistered')
assert.equal(matchTag('0477', tags, { title: 'Floor 3 — Deep', client_id: 'c3' }).status, 'ok', 'client-only sticker matches by client')
assert.equal(matchTag('0477', tags, job).status, 'other_place')
assert.equal(matchTag('04A25F1B', tags, { title: ' sushi ginza  — x' }).status, 'ok', 'location match ignores case and spaces')

assert.equal(tagPlace(tags[0]), 'Sushi Ginza · Ginza Foods')
assert.equal(tagPlace({ tag_uid: '0a:0b' }), '0A0B')
console.log('✅ nfc clock')
