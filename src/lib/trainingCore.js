// v1.0.208 · Treinamento como CURSO — pure helpers, no Supabase, shared by the admin page,
// the employee screen and the tests.
//
// Catalog (one JSON for the company):
//   { course: { title, description }, modules: [Module], videos: [Lesson], updated_at }
//   Module = { id, title, description, order, sequential }   sequential: lessons open one after the other
//   Lesson = { id, yt, title, channel, thumb, duration_s, module_id, required, audience: 'all' | [employeeId],
//              note, quiz: null | { q, options: [..], answer }, order, added_at }
// Progress (one JSON per employee):
//   { [lessonId]: { watched_s, pos, pct, done, done_at, quiz_ok, quiz_at, last_at }, _certificate_at }
// Old catalogs (v1.0.190: { videos } with `category`) are turned into modules by category.

export const DONE_RATIO = 0.9 // watched 90% of the video (really played, not skipped) = watched

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * Understands any YouTube link (or a bare 11-char id) and says what it is.
 * → { videoId } | { playlistId } | { channel } | null
 */
export function parseYouTube(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (YT_ID.test(raw)) return { videoId: raw }
  if (/^@[\w.-]{2,}$/.test(raw)) return { channel: raw }
  if (/^UC[\w-]{22}$/.test(raw)) return { channel: raw }
  if (/^(PL|UU|OL|FL|LL)[\w-]{10,}$/.test(raw)) return { playlistId: raw }
  let url
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'youtu.be') return YT_ID.test(parts[0] || '') ? { videoId: parts[0] } : null
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null
  const v = url.searchParams.get('v')
  if (v && YT_ID.test(v)) return { videoId: v }
  if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && YT_ID.test(parts[1] || '')) return { videoId: parts[1] }
  const list = url.searchParams.get('list')
  if (list) return { playlistId: list }
  if (parts[0]?.startsWith('@')) return { channel: parts[0] }
  if (parts[0] === 'channel' && parts[1]) return { channel: parts[1] }
  return null
}

/** Every video id found in a pasted block (one or many links, any separator), without repeats. */
export function videoIdsIn(text) {
  const out = []
  for (const piece of String(text || '').split(/[\s,;]+/)) {
    const p = parseYouTube(piece)
    if (p?.videoId && !out.includes(p.videoId)) out.push(p.videoId)
  }
  return out
}

export const thumbOf = yt => `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`

export function fmtDuration(s) {
  const n = Math.round(Number(s) || 0)
  if (!n) return ''
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** "1h 20min" / "35 min" for totals. */
export function fmtTotal(s) {
  const m = Math.round((Number(s) || 0) / 60)
  if (!m) return ''
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}` : `${m} min`
}

const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.added_at || '').localeCompare(String(b.added_at || ''))
const renumber = list => list.map((x, k) => ({ ...x, order: k }))

export const DEFAULT_COURSE = { title: 'Treinamento Kuripuro', description: '' }

export function makeModule({ title, description, sequential = true } = {}, order = 0) {
  return { id: newId(), title: String(title || '').trim() || 'Módulo', description: String(description || '').trim(), sequential: !!sequential, order }
}

export function makeVideo({ yt, title, channel, thumb, duration_s, module_id, required, audience, note, quiz }, order = 0) {
  return {
    id: newId(),
    yt,
    title: String(title || '').trim() || 'YouTube',
    channel: channel || '',
    thumb: thumb || thumbOf(yt),
    duration_s: Number(duration_s) || 0,
    module_id: module_id || null,
    required: required !== false,
    audience: Array.isArray(audience) && audience.length ? audience : 'all',
    note: String(note || '').trim(),
    quiz: cleanQuiz(quiz),
    order,
    added_at: new Date().toISOString(),
  }
}

/** A quiz only counts when it has a question, at least 2 options and a valid right answer. */
export function cleanQuiz(quiz) {
  if (!quiz) return null
  const options = (quiz.options || []).map(o => String(o || '').trim()).filter(Boolean)
  const q = String(quiz.q || '').trim()
  const answer = Number(quiz.answer)
  if (!q || options.length < 2 || !(answer >= 0 && answer < options.length)) return null
  return { q, options, answer }
}

/** Any stored catalog (old list, old {videos}, new course) → { course, modules, videos } in order. */
export function normalizeCatalog(raw) {
  const src = Array.isArray(raw) ? { videos: raw } : (raw || {})
  const course = { ...DEFAULT_COURSE, ...(src.course || {}) }
  let modules = Array.isArray(src.modules) ? [...src.modules].sort(byOrder) : []
  let videos = Array.isArray(src.videos) ? [...src.videos].sort(byOrder) : []
  // v1.0.190 catalogs: category → module
  const orphan = videos.filter(v => !v.module_id || !modules.some(m => m.id === v.module_id))
  if (orphan.length) {
    const made = new Map()
    videos = videos.map(v => {
      if (v.module_id && modules.some(m => m.id === v.module_id)) return v
      const name = String(v.category || '').trim() || 'Geral'
      let m = modules.find(x => x.title === name) || made.get(name)
      if (!m) { m = makeModule({ title: name }, modules.length + made.size); made.set(name, m) }
      return { ...v, module_id: m.id }
    })
    modules = [...modules, ...made.values()]
  }
  return { course, modules: renumber(modules), videos: videos.map(v => ({ ...v, quiz: cleanQuiz(v.quiz) })) }
}

export const lessonsIn = (cat, moduleId) => cat.videos.filter(v => v.module_id === moduleId).sort(byOrder)

/** Adds lessons at the end of a module; a video already in the course (same YouTube id) is skipped. */
export function addLessons(cat, moduleId, drafts) {
  const have = new Set(cat.videos.map(v => v.yt))
  const inMod = lessonsIn(cat, moduleId)
  let order = inMod.length ? Math.max(...inMod.map(v => v.order ?? 0)) + 1 : 0
  const added = []
  for (const d of drafts || []) {
    if (!d?.yt || have.has(d.yt)) continue
    have.add(d.yt)
    added.push(makeVideo({ ...d, module_id: moduleId }, order++))
  }
  return { cat: { ...cat, videos: [...cat.videos, ...added] }, added: added.length, skipped: (drafts || []).length - added.length }
}

export function addModule(cat, data) {
  const m = makeModule(data, cat.modules.length)
  return { cat: { ...cat, modules: [...cat.modules, m] }, module: m }
}

export const updateModule = (cat, id, patch) => ({ ...cat, modules: cat.modules.map(m => (m.id === id ? { ...m, ...patch } : m)) })
export const updateLesson = (cat, id, patch) => ({ ...cat, videos: cat.videos.map(v => (v.id === id ? { ...v, ...patch, quiz: 'quiz' in patch ? cleanQuiz(patch.quiz) : v.quiz } : v)) })

/** Removing a module removes its lessons too. */
export const removeModule = (cat, id) => ({ ...cat, modules: renumber(cat.modules.filter(m => m.id !== id)), videos: cat.videos.filter(v => v.module_id !== id) })
export const removeLesson = (cat, id) => ({ ...cat, videos: cat.videos.filter(v => v.id !== id) })

function swap(list, id, dir) {
  const cur = [...list]
  const i = cur.findIndex(x => x.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= cur.length) return renumber(cur)
  ;[cur[i], cur[j]] = [cur[j], cur[i]]
  return renumber(cur)
}

export const moveModule = (cat, id, dir) => ({ ...cat, modules: swap(cat.modules, id, dir) })

export function moveLesson(cat, id, dir) {
  const v = cat.videos.find(x => x.id === id)
  if (!v) return cat
  const moved = swap(lessonsIn(cat, v.module_id), id, dir)
  const map = new Map(moved.map(x => [x.id, x.order]))
  return { ...cat, videos: cat.videos.map(x => (map.has(x.id) ? { ...x, order: map.get(x.id) } : x)) }
}

/** Puts a lesson at the end of another module. */
export function lessonToModule(cat, id, moduleId) {
  const end = lessonsIn(cat, moduleId).length
  return { ...cat, videos: cat.videos.map(v => (v.id === id ? { ...v, module_id: moduleId, order: end } : v)) }
}

export const visibleTo = (lesson, employeeId) =>
  !lesson?.audience || lesson.audience === 'all' || (Array.isArray(lesson.audience) && lesson.audience.includes(employeeId))

/** Watched (90%+ really played) and, when the lesson has a question, answered right. */
export const lessonDone = (lesson, p) => !!(p?.done && (!lesson?.quiz || p.quiz_ok))

/**
 * The course as one employee sees it: modules with only their lessons, each lesson with a state
 * 'done' | 'doing' | 'open' | 'locked', the lesson to continue, and the totals.
 */
export function courseFor(raw, progress, employeeId) {
  const cat = normalizeCatalog(raw)
  const pr = progress || {}
  let next = null
  let total = 0, done = 0, requiredTotal = 0, requiredDone = 0, seconds = 0
  const modules = []
  for (const m of cat.modules) {
    const ls = lessonsIn(cat, m.id).filter(v => visibleTo(v, employeeId))
    if (!ls.length) continue
    let blocked = false
    const lessons = ls.map((v, i) => {
      const p = pr[v.id] || {}
      const isDone = lessonDone(v, p)
      const state = isDone ? 'done' : blocked ? 'locked' : (p.pct > 0 || p.done) ? 'doing' : 'open'
      if (m.sequential && !isDone) blocked = true
      total++; seconds += v.duration_s || 0
      if (isDone) done++
      if (v.required) { requiredTotal++; if (isDone) requiredDone++ }
      const lesson = { ...v, state, index: i, p }
      if (!next && state !== 'done' && state !== 'locked') next = { ...lesson, module: m }
      return lesson
    })
    const mDone = lessons.filter(l => l.state === 'done').length
    modules.push({ ...m, lessons, done: mDone, total: lessons.length, complete: mDone === lessons.length })
  }
  const finished = total > 0 && requiredDone === requiredTotal && (requiredTotal > 0 || done === total)
  return {
    course: cat.course, modules, next, total, done, requiredTotal, requiredDone,
    requiredLeft: requiredTotal - requiredDone, seconds, pct: total ? done / total : 0, finished,
    certificateAt: pr._certificate_at || null,
  }
}

/** Lesson after this one for this employee (next in module, then first of the next module). */
export function lessonAfter(view, lessonId) {
  const flat = view.modules.flatMap(m => m.lessons.map(l => ({ ...l, module: m })))
  const i = flat.findIndex(l => l.id === lessonId)
  return i >= 0 ? flat[i + 1] || null : null
}

/**
 * One player tick. Counts only seconds that were really played (a jump forward does not count),
 * so skipping to the end does not mark the video watched.
 */
export function tickProgress(prev, { current, duration, lastCurrent }) {
  const p = { watched_s: 0, pos: 0, pct: 0, done: false, ...(prev || {}) }
  const dur = Number(duration) || 0
  const cur = Number(current) || 0
  const step = cur - (Number(lastCurrent) || 0)
  if (step > 0 && step <= 3) p.watched_s = Math.min(dur || Infinity, (p.watched_s || 0) + step)
  p.pos = cur
  p.pct = dur ? Math.min(1, p.watched_s / dur) : 0
  if (dur) p.dur = dur
  p.last_at = new Date().toISOString()
  if (!p.done && dur && p.pct >= DONE_RATIO) { p.done = true; p.done_at = p.last_at }
  return p
}

/** The player said "ended": watched only if most of it was really played. */
export function endProgress(prev, duration) {
  const p = { ...(prev || {}) }
  const dur = Number(duration) || 0
  p.pos = 0
  p.last_at = new Date().toISOString()
  if (!p.done && dur && (p.watched_s || 0) / dur >= DONE_RATIO - 0.05) { p.done = true; p.done_at = p.last_at; p.pct = 1 }
  return p
}

/** Answer to the lesson question. Wrong answers can try again (watching again is suggested). */
export function answerQuiz(prev, lesson, choice) {
  const ok = !!lesson?.quiz && Number(choice) === lesson.quiz.answer
  const p = { ...(prev || {}), quiz_tries: ((prev || {}).quiz_tries || 0) + 1 }
  if (ok) { p.quiz_ok = true; p.quiz_at = new Date().toISOString() }
  return { p, ok }
}

/** What one employee still has to do (☰ badge, admin table). */
export function summary(raw, progress, employeeId) {
  const v = courseFor(raw, progress, employeeId)
  return { total: v.total, done: v.done, requiredLeft: v.requiredLeft, left: v.total - v.done, finished: v.finished, pct: v.pct }
}
