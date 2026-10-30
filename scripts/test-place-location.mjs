// A place only counts as located with real coordinates (v1.0.104): Places / map pin / pasted numbers / Maps link.
import assert from 'node:assert/strict'
import { coordsFromText, isRealCoords, realCoords } from '../src/lib/placeLocation.js'
import { japaneseAddressParts } from '../api/geocode.js'

// the June stand-in (Shinbashi) on every place is not a location
assert.equal(isRealCoords('35.658500', '139.751400'), false)
assert.equal(realCoords({ gps_lat: '35.658500', gps_lng: '139.751400' }), null)
assert.deepEqual(realCoords({ gps_lat: '35.674171', gps_lng: '139.766876' }), { lat: 35.674171, lng: 139.766876 })
assert.equal(isRealCoords(null, null), false)
assert.equal(isRealCoords('', ''), false)
assert.equal(isRealCoords(48.85, 2.35), false) // outside Japan

// /place/ links: the pin (!3d!4d) wins over the map centre (@)
const place = 'https://www.google.com/maps/place/ATOMIC+BAR/@35.6625,139.7310,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.66273!4d139.73126'
assert.deepEqual(coordsFromText(place), { lat: 35.66273, lng: 139.73126 })
assert.deepEqual(coordsFromText('https://www.google.com/maps/place/X/@35.6625,139.731,17z'), { lat: 35.6625, lng: 139.731 })
assert.deepEqual(coordsFromText('https://www.google.com/maps?q=35.67417,139.76688'), { lat: 35.67417, lng: 139.76688 })
assert.deepEqual(coordsFromText('https://www.google.com/maps/search/?api=1&query=35.67417%2C139.76688'), { lat: 35.67417, lng: 139.76688 })
// pasted numbers (also full-width comma / a space)
assert.deepEqual(coordsFromText('35.67417, 139.76688'), { lat: 35.67417, lng: 139.76688 })
assert.deepEqual(coordsFromText('35.67417 139.76688'), { lat: 35.67417, lng: 139.76688 })
assert.deepEqual(coordsFromText('(35.67417，139.76688)'), { lat: 35.67417, lng: 139.76688 })
// a search link with only text has no location
assert.equal(coordsFromText('https://www.google.com/maps/search/?api=1&query=ATOMIC%20BAR%20%E5%85%AD%E6%9C%AC%E6%9C%A8'), null)
assert.equal(coordsFromText('東京都港区新橋3-19-4'), null)

// a shop name before the address no longer breaks the address search
assert.equal(japaneseAddressParts('焼肉男マンモス 東京都港区新橋3-19-4').ja, '東京都港区新橋3-19-4')
assert.equal(japaneseAddressParts('魚無双トオダ 東京都港区新橋4-15-6').ja, '東京都港区新橋4-15-6')
assert.equal(japaneseAddressParts('東京都中央区銀座2-5-19PUZZLE銀座10階').ja, '東京都中央区銀座2-5-19')

console.log('place-location: ok')
