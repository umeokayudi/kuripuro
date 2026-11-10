// v1.0.190/208 · Treinamento como curso: links, módulos, sequência, pergunta, certificado
import assert from 'node:assert/strict'
import { parseYouTube, videoIdsIn, normalizeCatalog, addModule, addLessons, moveLesson, moveModule, lessonToModule, removeModule,
  courseFor, tickProgress, endProgress, answerQuiz, summary, lessonAfter, cleanQuiz, updateLesson } from '../src/lib/trainingCore.js'
import { isoDuration } from '../api/_youtube.js'

const ID = 'dQw4w9WgXcQ'
for (const u of [ID, `https://youtu.be/${ID}?si=x`, `https://www.youtube.com/watch?v=${ID}&t=3`, `youtube.com/shorts/${ID}`, `https://m.youtube.com/embed/${ID}`])
  assert.deepEqual(parseYouTube(u), { videoId: ID }, u)
assert.deepEqual(parseYouTube('https://www.youtube.com/playlist?list=PLabcdefghijkl'), { playlistId: 'PLabcdefghijkl' })
assert.equal(parseYouTube('https://vimeo.com/123'), null)
assert.deepEqual(videoIdsIn(`https://youtu.be/${ID}\nhttps://youtu.be/${ID}, https://youtu.be/abcdefghijk`), [ID, 'abcdefghijk'])

// old v1.0.190 catalog → modules by category
const old = normalizeCatalog({ videos: [{ id: 'a', yt: ID, title: 'A', category: 'Deep', order: 0 }, { id: 'b', yt: 'abcdefghijk', title: 'B', order: 1 }] })
assert.deepEqual(old.modules.map(m => m.title), ['Deep', 'Geral'])
assert.ok(old.videos.every(v => old.modules.some(m => m.id === v.module_id)))

// build a course: module 1 (in order) with 2 lessons, module 2 with 1
let cat = normalizeCatalog(null)
let r = addModule(cat, { title: 'Básico' }); cat = r.cat; const m1 = r.module.id
r = addModule(cat, { title: 'Segurança', sequential: false }); cat = r.cat; const m2 = r.module.id
cat = addLessons(cat, m1, [{ yt: 'aaaaaaaaaaa', title: 'L1' }, { yt: 'bbbbbbbbbbb', title: 'L2' }]).cat
const again = addLessons(cat, m2, [{ yt: 'aaaaaaaaaaa' }, { yt: 'ccccccccccc', title: 'S1', required: false }])
assert.equal(again.added, 1); cat = again.cat
const [l1, l2] = cat.videos.filter(v => v.module_id === m1)
cat = updateLesson(cat, l2.id, { quiz: { q: 'Qual?', options: ['x', 'y'], answer: 1 } })
assert.equal(cleanQuiz({ q: 'q', options: ['só uma'], answer: 0 }), null)

let v = courseFor(cat, {}, 'e1')
assert.equal(v.total, 3); assert.equal(v.requiredTotal, 2)
assert.deepEqual(v.modules[0].lessons.map(l => l.state), ['open', 'locked'])
assert.equal(v.next.title, 'L1')

// skipping to the end does not count; really playing does
let p = tickProgress(null, { current: 95, duration: 100, lastCurrent: 0 })
assert.equal(p.done, false)
assert.equal(endProgress(p, 100).done, false)
p = null
for (let s = 1; s <= 90; s++) p = tickProgress(p, { current: s, duration: 100, lastCurrent: s - 1 })
assert.equal(p.done, true)
let pr = { [l1.id]: p }
v = courseFor(cat, pr, 'e1')
assert.deepEqual(v.modules[0].lessons.map(l => l.state), ['done', 'open'])
assert.equal(lessonAfter(v, l1.id).title, 'L2')

// L2: watched but quiz not answered → not done; wrong then right
pr[l2.id] = { done: true, pct: 1 }
v = courseFor(cat, pr, 'e1')
assert.equal(v.modules[0].lessons[1].state, 'doing'); assert.equal(v.finished, false)
const lesson2 = cat.videos.find(x => x.id === l2.id)
assert.equal(answerQuiz(pr[l2.id], lesson2, 0).ok, false)
pr[l2.id] = answerQuiz(pr[l2.id], lesson2, 1).p
v = courseFor(cat, pr, 'e1')
assert.equal(v.finished, true) // optional S1 not needed
assert.equal(summary(cat, pr, 'e1').requiredLeft, 0)

// ordering / moving / removing
cat = moveLesson(cat, l2.id, -1)
assert.deepEqual(courseFor(cat, {}, 'e1').modules[0].lessons.map(l => l.title), ['L2', 'L1'])
cat = moveModule(cat, m2, -1)
assert.equal(courseFor(cat, {}, 'e1').modules[0].title, 'Segurança')
cat = lessonToModule(cat, l1.id, m2)
assert.equal(cat.videos.find(x => x.id === l1.id).module_id, m2)
cat = removeModule(cat, m2)
assert.equal(cat.videos.length, 1)
assert.equal(isoDuration('PT1H2M3S'), 3723)
console.log('training OK')
