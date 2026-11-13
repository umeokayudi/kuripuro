// v1.0.234 · names inside the media ZIP   npx vite-node scripts/test-media-zip.mjs
import { zipEntries } from '../src/lib/mediaZip.js'
import { zipFiles } from '../src/lib/zipStore.js'
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log(`${c ? '✅' : '❌'} ${n}${x ? ` — ${x}` : ''}`) }
const jobs = [
  { id: 'b', title: 'Loja Sul — Grease Trap', scheduled_date: '2026-10-08' },
  { id: 'a', title: 'Loja/Norte: "A" — Deep Clean (AC)', scheduled_date: '2026-10-05' },
  { id: 'c', title: 'Loja Sul — Grease Trap', scheduled_date: '2026-10-08' },
  { id: 'd', title: 'Sem mídia', scheduled_date: '2026-10-09' },
]
const media = new Map([
  ['a', [{ path: 'jobs/a/start_0.jpg', kind: 'photo', section: 'before' }, { path: 'jobs/a/end_0.JPG', kind: 'photo', section: 'after' }, { path: 'jobs/a/end_1.jpg', kind: 'photo', section: 'after' }, { path: 'jobs/a/video_0.mp4', kind: 'video', section: 'after' }]],
  ['b', [{ path: 'jobs/b/start_0.jpg', kind: 'photo', section: 'before' }]],
  ['c', [{ path: 'jobs/c/start_0.jpg', kind: 'photo', section: 'before' }]],
])
const e = zipEntries(jobs, media)
const names = e.map(x => x.name)
ok('one entry per file, job without media left out', e.length === 6, names.join(' | '))
ok('ordered by date', names[0].startsWith('2026-10-05'))
ok('no character a zip or Windows refuses', names.every(n => !/[\\:*?"<>|]/.test(n) && n.split('/').length === 2))
ok('before / after / video names', names.includes('2026-10-05 Loja Norte A - Deep Clean (AC)/antes_1.jpg') && names.some(n => n.endsWith('/depois_2.jpg')) && names.some(n => n.endsWith('/video_1.mp4')), names[0])
ok('two services same day and store get separate folders', new Set(names.filter(n => n.startsWith('2026-10-08')).map(n => n.split('/')[0])).size === 2)
ok('all names unique', new Set(names).size === names.length)
const blob = zipFiles(e.map(x => ({ name: x.name, data: new Uint8Array([1, 2, 3]) })))
const buf = new Uint8Array(await blob.arrayBuffer())
ok('zip has the end record with 6 files', buf[buf.length - 22] === 0x50 && buf[buf.length - 12] === 6)
console.log(failed ? `\n${failed} failed` : '\nall good'); process.exit(failed ? 1 : 0)
