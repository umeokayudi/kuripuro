// v1.0.189 · Treinamento: link parsing, catalog order, real watched seconds
import assert from 'node:assert/strict'
import { parseYouTube, videoIdsIn, addVideos, moveVideo, tickProgress, endProgress, summary, videosFor } from '../src/lib/trainingCore.js'
import { isoDuration } from '../api/_youtube.js'

const ID = 'dQw4w9WgXcQ'
for (const u of [ID, `https://youtu.be/${ID}?si=x`, `https://www.youtube.com/watch?v=${ID}&t=3`, `youtube.com/shorts/${ID}`, `https://m.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}`])
  assert.deepEqual(parseYouTube(u), { videoId: ID }, u)
assert.deepEqual(parseYouTube('https://www.youtube.com/playlist?list=PLabcdefghijkl'), { playlistId: 'PLabcdefghijkl' })
assert.deepEqual(parseYouTube('https://www.youtube.com/@kuripuro'), { channel: '@kuripuro' })
assert.equal(parseYouTube('https://vimeo.com/123'), null)
assert.deepEqual(videoIdsIn(`https://youtu.be/${ID}\nhttps://youtu.be/${ID}, https://youtu.be/abcdefghijk`), [ID, 'abcdefghijk'])

let { list, added } = addVideos([], [{ yt: ID, title: 'A' }, { yt: 'abcdefghijk', title: 'B', required: true, audience: ['e1'] }])
assert.equal(added, 2)
assert.equal(addVideos(list, [{ yt: ID }]).added, 0)
list = moveVideo(list, list[1].id, -1)
assert.deepEqual(list.map(v => v.title), ['B', 'A'])
assert.equal(videosFor(list, 'e2').length, 1)

// skipping to the end does not count; really playing does
let p = tickProgress(null, { current: 95, duration: 100, lastCurrent: 0 })
assert.equal(p.done, false); assert.equal(p.watched_s, 0)
p = endProgress(p, 100); assert.equal(p.done, false)
p = null
for (let s = 1; s <= 90; s++) p = tickProgress(p, { current: s, duration: 100, lastCurrent: s - 1 })
assert.equal(p.done, true)
const s = summary(list, { [list[0].id]: { done: true } }, 'e1')
assert.deepEqual(s, { total: 2, done: 1, requiredLeft: 0, left: 1 })
assert.equal(summary(list, {}, 'e1').requiredLeft, 1)
assert.equal(isoDuration('PT1H2M3S'), 3723)
assert.equal(isoDuration('PT45S'), 45)
console.log('training OK')
