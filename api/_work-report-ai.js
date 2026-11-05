// v1.0.150 · AI for the 作業報告書 (work report).
//   task 'polish': fix one text, write it in the report language and polite business tone,
//                  and resize it (short / normal / long).
//   task 'draft' : from the employee's notes (any language) + fields, fill the whole report.
// Never invents prices, model numbers or facts that are not in the notes.
import { geminiGenerate } from './_gemini.js'

const LANG_NAME = { ja: 'Japanese (polite business keigo, as a Japanese cleaning company writes to a client: ～いたしました／～しておりました)', en: 'English (polite, professional)', pt: 'Brazilian Portuguese (polite, professional)' }
const SIZE = {
  short: 'Make it SHORT: 1–2 sentences, only the essential facts.',
  normal: 'Keep a NORMAL length: 2–4 sentences.',
  long: 'Make it LONGER and more explanatory for the client (4–7 sentences): explain why it matters, without inventing facts.',
  same: 'Keep about the same length.',
}
const FIELD_HINT = {
  summary: 'the opening paragraph of the report (作業概要) addressed to the client',
  before: 'the description of the condition BEFORE the work (作業前)',
  after: 'the description of the result AFTER the work (作業後)',
  notices: 'notes for the client (ご報告事項): problems on the day, rescheduling, things the client should know',
  note: 'the explanation under a before/after photo pair of one part',
  extra: 'an extra explanation section for the client',
  caption: 'a photo caption (very short, like 上段左から：エアフィルター（目詰まり）、吸込グリル)',
  step: 'one step of the work (short, like 養生：客席・床・家具をビニールシートで養生)',
  rec: 'one maintenance recommendation (short, like エアフィルター清掃：2週間に1回（店舗スタッフ様で実施可能）)',
  closing: 'the closing sentence',
  any: 'a text of a service report',
}

const clip = (s, n) => String(s || '').slice(0, n)

function parseJson(raw) {
  const cleaned = String(raw || '{}').replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch { return null }
}

async function ask(prompt) {
  const data = await geminiGenerate({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
  })
  return parseJson(data?.candidates?.[0]?.content?.parts?.[0]?.text)
}

async function polish(body) {
  const lang = LANG_NAME[body.lang] ? body.lang : 'ja'
  const text = clip(body.text, 6000)
  if (!text.trim()) return { error: 'Texto vazio.' }
  const prompt = `You edit texts of a service report (作業報告書) that KuriPuro, a cleaning company in Tokyo, sends to its client.
The text below is ${FIELD_HINT[body.field] || FIELD_HINT.any}. It may have been written quickly by a field worker in Portuguese, English or Japanese, with typos.

Rewrite it in ${LANG_NAME[lang]}.
- Correct spelling and grammar, keep every fact. Do NOT invent numbers, brands, dates, prices or problems.
- ${SIZE[body.size] || SIZE.same}
- No markdown, no bullet symbols, no greeting unless it is the opening paragraph.
${body.context ? `Context (do not copy, only to understand): ${clip(body.context, 800)}` : ''}

TEXT:
"""${text}"""

Answer ONLY JSON: {"text": "<rewritten text>"}`
  const out = await ask(prompt)
  if (!out?.text) return { error: 'A IA não devolveu texto. Tente de novo.' }
  return { text: String(out.text).trim() }
}

async function draft(body) {
  const lang = LANG_NAME[body.lang] ? body.lang : 'ja'
  const detailed = body.mode === 'detailed'
  const info = {
    client: clip(body.client, 120), contact: clip(body.contact, 80), service: clip(body.title, 160),
    fields: body.fields || {}, quote_number: clip(body.quote_number, 30),
    worker_notes: clip(body.notes, 6000), job: body.job || null,
    photo_captions: (body.photo_captions || []).slice(0, 40).map(s => clip(s, 160)),
    parts_listed: (body.parts || []).slice(0, 15).map(s => clip(s, 60)),
  }
  const prompt = `You write the service report (作業報告書) that KuriPuro, a cleaning company in Tokyo, sends to its client after a job.
Write everything in ${LANG_NAME[lang]}.
Use ONLY facts found in the information below (worker notes may be in Portuguese/English/Japanese with typos). Never invent prices, models, years, numbers of units or problems. When something is unknown, leave that field empty ("" or []).
Report type: ${detailed ? 'DETAILED (all sections)' : 'SIMPLE (short: summary, steps, before, after, notices only — parts/extras/recommendations empty)'}.

Example of the expected tone (Japanese): "いつも大変お世話になっております。KuriPuroでございます。御見積書（No.129）に基づき実施いたしました業務用エアコン分解洗浄につきまして、下記の通りご報告申し上げます。"
Steps look like: "養生：客席・床・家具をビニールシートで養生し、本体に洗浄用カバーを取り付け".
Parts table rows: name of the part, level (heavy | medium_heavy | medium | light), state before, why cleaning it matters, state after, and a 2–4 sentence note for the client.

INFORMATION:
${JSON.stringify(info, null, 1)}

Answer ONLY JSON:
{"title": "<service name, short, e.g. 業務用エアコン分解洗浄>",
 "summary": "<opening paragraph addressed to the client>",
 "steps": ["<step>", ...],
 "before_text": "<condition before>",
 "after_text": "<result after>",
 "parts_intro": "${detailed ? '<1–3 sentences introducing the parts table>' : ''}",
 "parts": [${detailed ? '{"name":"","level":"heavy","before":"","why":"","after":"","note":""}' : ''}],
 "extras": [${detailed ? '{"title":"","text":""}' : ''}],
 "notices": "<ご報告事項, empty if nothing to report>",
 "recs_intro": "",
 "recommendations": [${detailed ? '"<recommendation>"' : ''}]}`
  const out = await ask(prompt)
  if (!out || typeof out !== 'object') return { error: 'A IA não devolveu o relatório. Tente de novo.' }
  return out
}

export async function workReportAi(req, res) {
  const body = req.body || {}
  try {
    const out = body.task === 'draft' ? await draft(body) : await polish(body)
    res.status(out.error ? 502 : 200).json(out)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
