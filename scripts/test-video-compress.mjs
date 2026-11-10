import { targetSize, videoTypeInfo, bitrateFor, VIDEO_MAX_SECONDS } from '../src/lib/videoCompress.js'

function assert(c, m) { if (!c) { console.error('❌', m); process.exit(1) } }

// iPhone em pé (1080x1920) → 720 no lado maior, largura par
let s = targetSize(1080, 1920)
assert(s.width === 406 && s.height === 720, `portrait 1080x1920 → ${JSON.stringify(s)}`)
s = targetSize(3840, 2160)
assert(s.width === 720 && s.height === 406, `4K landscape → ${JSON.stringify(s)}`)
s = targetSize(640, 360)
assert(s.width === 640 && s.height === 360, 'small video is not upscaled')
s = targetSize(641, 359)
assert(s.width % 2 === 0 && s.height % 2 === 0, 'always even sizes')
assert(targetSize(0, 100) === null, 'no size → null')

assert(videoTypeInfo('video/quicktime').ext === 'mov', 'iPhone mov')
assert(videoTypeInfo('', 'IMG_0001.MOV').ext === 'mov', 'mov by name')
assert(videoTypeInfo('video/mp4;codecs=avc1').contentType === 'video/mp4', 'mp4 with codecs')
assert(videoTypeInfo('image/jpeg', 'a.jpg') === null, 'not a video')

// v1.0.199 · up to 3 minutes; the bitrate keeps the file under ~40 MB (Supabase limit 50 MB)
assert(VIDEO_MAX_SECONDS === 180, 'max 3 min')
assert(bitrateFor(60, 2_000_000, 192_000) === 2_000_000, '1 min keeps 2 Mbps')
for (const sec of [90, 120, 180, 600]) {
  const v = bitrateFor(sec, 2_000_000, 192_000)
  const mb = Math.min(sec, 180) * (v + 192_000) / 8 / 1024 / 1024
  assert(mb <= 40, `${sec}s → ${mb.toFixed(1)} MB (over 40)`)
  assert(v >= 1_000_000, `${sec}s keeps a decent bitrate (${v})`)
}
console.log('✅ video compress helpers ok')
