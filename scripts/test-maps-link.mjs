// Map buttons must open a Google Maps link that works on phones (never ".../maps/undefined&cid=")
// and, when the saved link has the place id, the exact place (cid), not a search with options.
import assert from 'node:assert/strict'
import { mapsOpenUrl, mapsCoordsUrl, hasMapsLink, mapsEmbedQuery } from '../src/lib/mapsLink.js'
import { OTP_BASIC_LOCATIONS, ATOMIC_LOCATION } from '../src/lib/serviceCatalog.js'

const kodama = 'https://www.google.com/maps/place/Uogosho+Kodama+The+Great+Fish+Merchant,+1F+A+4+Chome-19-10+Shinbashi,+Minato+City,+Tokyo+105-0004/data=!4m2!3m1!1s0x60188bc3da4fd7cd:0x2eaff7292663c436!18m1!1e1'
assert.equal(mapsOpenUrl(kodama, 'Kodama Shinbashi'), 'https://maps.google.com/?cid=3364179202778842166')
assert.equal(mapsEmbedQuery(kodama), 'Uogosho Kodama The Great Fish Merchant, 1F A 4 Chome-19-10 Shinbashi, Minato City, Tokyo 105-0004')

const jp = 'https://www.google.com/maps/place/%E3%80%92105-0004+Tokyo,+Minato+City,+Shinbashi,+3+Chome%E2%88%9216%E2%88%9210+2F+%E7%87%BB%E7%94%B7/data=!4m2!3m1!1s0x60188bea2243a255:0x3335729416b3d811!18m1!1e1'
assert.equal(mapsOpenUrl(jp), `https://maps.google.com/?cid=${BigInt('0x3335729416b3d811')}`)
assert.equal(mapsEmbedQuery(jp), '〒105-0004 Tokyo, Minato City, Shinbashi, 3 Chome−16−10 2F 燻男')
assert.equal(new URL(mapsOpenUrl('https://www.google.com/maps/place/Some+Shop,+Tokyo/')).searchParams.get('query'), 'Some Shop, Tokyo')

const official = 'https://www.google.com/maps/search/?api=1&query=ATOMIC%20BAR'
assert.equal(mapsOpenUrl(official), official)
assert.equal(mapsOpenUrl('https://maps.app.goo.gl/abc123'), 'https://maps.app.goo.gl/abc123')
assert.equal(mapsOpenUrl('https://www.google.com/maps/@35.66,139.75,17z'), mapsCoordsUrl('35.66', '139.75'))
assert.equal(mapsOpenUrl('https://www.google.com/maps/data=!3m1!1s0x60188bc3da4fd7cd:0x2eaff7292663c436'), 'https://maps.google.com/?cid=3364179202778842166')
assert.equal(new URL(mapsOpenUrl('東京都港区新橋3-19-4')).searchParams.get('query'), '東京都港区新橋3-19-4')
assert.equal(new URL(mapsOpenUrl('undefined', 'Tooda')).searchParams.get('query'), 'Tooda Tokyo')
assert.equal(mapsOpenUrl(undefined, undefined), null)
assert.equal(hasMapsLink('', ''), false)
assert.equal(mapsCoordsUrl(35.1, 139.2), 'https://www.google.com/maps/search/?api=1&query=35.1%2C139.2')

for (const loc of [...OTP_BASIC_LOCATIONS, ATOMIC_LOCATION]) {
  if (!loc.address) continue
  const url = mapsOpenUrl(loc.address, loc.name)
  assert.ok(!/undefined|data=!/.test(url), `${loc.name}: ${url}`)
}
console.log('✅ map links open Google Maps correctly')
