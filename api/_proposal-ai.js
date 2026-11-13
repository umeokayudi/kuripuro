// v1.0.210 · AI for the Proposta visual (提案書).
//   task 'draft' : from the quote (client, needs, notes, items) write the whole sheet — title,
//                  intro, before/after, service steps (with a photo prompt + search words each),
//                  plans A/B (which quote items and how many times — NEVER prices), 12-month schedule.
//   task 'polish': fix / shorten / lengthen one text of the sheet.
//   task 'image' : make one photo for a slot (image model of the active AI provider). The server saves it in
//                  service-photos/proposals/<id>/ai_<time>.png and returns the path.
import { aiGenerate, aiGenerateImage } from './_ai.js'
import { uploadStorageObject } from './_storage.js'

const LANG_NAME = {
  ja: 'Japanese (polite business Japanese, the way a Japanese cleaning company writes a 提案書 to a client)',
  en: 'English (polite, professional, short)',
  pt: 'Brazilian Portuguese (polite, professional, short)',
}
const clip = (s, n) => String(s ?? '').slice(0, n)

function parseJson(raw) {
  const cleaned = String(raw || '{}').replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch { return null }
}

async function ask(prompt, temperature = 0.5) {
  const data = await aiGenerate({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature },
  }, { timeoutMs: 45000 })
  return parseJson(data?.candidates?.[0]?.content?.parts?.[0]?.text)
}

async function draft(b) {
  const lang = LANG_NAME[b.lang] ? b.lang : 'ja'
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map(it => ({ i: Number(it.i), description: clip(it.description, 120), quantity: Number(it.quantity) || 1 }))
  const prompt = `You design a ONE-PAGE visual proposal sheet (提案書, landscape) that KuriPuro, a commercial cleaning company in Tokyo, sends to a client together with its quote.
The sheet must make the quote EASY TO UNDERSTAND at a glance: what the problem is, what we do (with photos), which plans exist and how often we come.

Write ALL texts in ${LANG_NAME[lang]}. Short texts: this is a visual sheet, not a letter.

QUOTE
- Client: ${clip(b.client, 80)}${b.site ? ` / place: ${clip(b.site, 80)}` : ''}
- What the client needs: ${clip(b.needs, 400) || '(not written)'}
- Interest / service: ${clip(b.interest, 200) || '(not written)'}
- Frequency written in the quote: ${clip(b.frequency, 80) || '(not written)'} · hours per visit: ${clip(b.hours, 10) || '-'}
- Notes: ${clip(b.notes, 1500) || '(none)'}
- Quote items (index i, description, quantity): ${JSON.stringify(items)}
${b.hint ? `- Extra instructions from the office: ${clip(b.hint, 600)}` : ''}

RULES
- NEVER write prices, yen amounts or numbers of money anywhere. Prices are added by the system from the quote items.
- Do not invent facts about the client (no made-up problems, sizes, dates). General explanations about the service are fine.
- plans: 1 or 2 plans (3 only if the quote clearly has 3 options). Plan A = the complete option (recommended). Plan B = the cheaper / lighter option.
  Each plan lists the quote items it includes: lines = [{"item": <index i>, "qty": <how many times in that plan>, "unit": "<short unit like 回 / 月 / 台 or ''>"}].
  Use the quantity of the quote unless the plan is clearly different (for example plan B does the deep cleaning once instead of twice).
- services: 1 or 2 blocks (3 only if needed) = the kinds of work in the quote (for example "集中洗浄（深い洗浄）" and "月次メンテナンス"). Each has exactly 3 steps.
  For every step write: title (very short), sub (very short, what it achieves), prompt (in ENGLISH, a description of a realistic PHOTO to illustrate the step, no text in the image),
  search (2–4 short words in English AND Japanese separated by commas to find a similar photo in our job photos, e.g. "carpet, カーペット").
- compare: a before → after pair that shows the problem and the result (for example dirt inside carpet fibers → clean fibers). before_tags = up to 3 tiny labels of what is dirty. Prompts in ENGLISH.
- intro: 2–3 short paragraphs separated by a blank line. Thank the client, explain the problem in simple words, and the solution.
  Mark the 1–2 key ideas: **text** = blue highlight, ++text++ = green highlight (for example **しっかり洗う（深い洗浄）** と ++定期的なメンテナンス++).
- schedule: a 12-month example of the recommended plan. rows = one per kind of service, months = list of month numbers (1–12) when it happens,
  tags = {"<month>": "<very short label like 初回 / 2回目>"} (optional). start_month = 1 unless the notes say when it starts. color must match the service.
- colors: "blue" | "green" | "orange" | "teal" | "purple". icons: "polisher" | "vacuum" | "spray" | "ac" | "kitchen" | "floor" | "window" | "sparkle".

Answer ONLY JSON with this shape:
{"title":"","intro":"",
 "compare":{"show":true,"title":"","before_label":"","before_tags":[""],"before_prompt":"","before_search":"","after_label":"","after_prompt":"","after_search":""},
 "services":[{"name":"","badge":"<frequency, e.g. 年に1〜2回 / 毎月>","desc":"<1–2 short lines>","color":"blue","icon":"polisher","steps":[{"title":"","sub":"","prompt":"","search":""}]}],
 "plans":[{"name":"","recommended":true,"subtitle":"","chips":["",""],"bullets":["","",""],"lines":[{"item":0,"qty":1,"unit":""}],"price_note":""}],
 "schedule":{"show":true,"title":"","note":"<e.g. （プランAの例）>","start_month":1,"rows":[{"label":"","color":"blue","months":[1,7],"tags":{"1":"初回","7":"2回目"}}],"legend":[""]},
 "footer_text":""}`
  const out = await ask(prompt, 0.6)
  if (!out || typeof out !== 'object') return { error: 'A IA não respondeu direito. Tente de novo.' }
  return { draft: out }
}

const FIELD = {
  intro: 'the opening paragraphs of the proposal. Keep the **highlight** and ++highlight++ marks if present',
  desc: 'the short description under a service name (1–2 lines)',
  bullet: 'one bullet point of a plan (one short line)',
  footer: 'the footer note of the proposal',
  title: 'the title of the proposal (short)',
  any: 'a short text of the proposal',
}
const SIZE = { short: 'Make it SHORTER.', long: 'Make it a bit LONGER and clearer, without inventing facts.', same: 'Keep about the same length.' }

async function polish(b) {
  const lang = LANG_NAME[b.lang] ? b.lang : 'ja'
  const text = clip(b.text, 3000)
  if (!text.trim()) return { error: 'Texto vazio.' }
  const out = await ask(`You edit ${FIELD[b.field] || FIELD.any} of a visual proposal (提案書) that KuriPuro, a cleaning company in Tokyo, sends to a client.
Rewrite it in ${LANG_NAME[lang]}. Fix spelling/grammar, keep every fact, never add prices or numbers that are not there. ${SIZE[b.size] || SIZE.same} No markdown except the highlight marks.
TEXT:
"""${text}"""
Answer ONLY JSON: {"text":"..."}`, 0.4)
  return out?.text ? { text: String(out.text) } : { error: 'A IA não respondeu direito.' }
}

/* ------------------------------------------------------------------ images */

async function image(b) {
  const id = String(b.id || '')
  if (!/^[\w-]{6,64}$/.test(id)) return { error: 'id inválido' }
  const subject = clip(b.prompt, 800).trim()
  if (!subject) return { error: 'Escreva o que a foto deve mostrar.' }
  const aspect = ['4:3', '16:9', '1:1', '3:4'].includes(b.aspect) ? b.aspect : '4:3'
  const style = b.style === 'illustration'
    ? 'Clean, friendly flat illustration in a modern Japanese business style, soft colors.'
    : 'Realistic, bright, professional photograph, natural light, sharp focus, like a photo taken by a professional cleaning company in Japan.'
  const prompt = `${style}
Subject: ${subject}
Setting: commercial spaces in Tokyo (offices, restaurants, shops) cleaned by a professional cleaning company. Workers, if shown, wear plain dark uniforms; faces not in focus.
Strictly NO text, NO letters, NO numbers, NO logos, NO watermarks in the image.`
  const out = await aiGenerateImage(prompt, aspect)
  const ext = /jpe?g/.test(out.mime) ? 'jpg' : /webp/.test(out.mime) ? 'webp' : 'png'
  const path = `proposals/${id}/ai_${Date.now()}.${ext}`
  try {
    await uploadStorageObject(path, Buffer.from(out.data, 'base64'), out.mime)
    return { path, model: out.model }
  } catch {
    // storage write failed on the server: the browser uploads it instead
    return { data: out.data, mime: out.mime, model: out.model }
  }
}

export async function proposalAi(req, res) {
  const b = req.body || {}
  try {
    const out = b.task === 'draft' ? await draft(b)
      : b.task === 'polish' ? await polish(b)
        : b.task === 'image' ? await image(b)
          : { error: 'task?' }
    res.status(out.error ? 400 : 200).json(out)
  } catch (err) {
    res.status(500).json({ error: String(err.message || err).slice(0, 400) })
  }
}
