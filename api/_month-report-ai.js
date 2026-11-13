// v1.0.247 · AI for the client monthly report (Relatório mensal do cliente).
// Writes, in the PDF language, ONLY from the facts the page sends (aiFacts in deepMonthReport.js):
//   intro   — opening / month summary (what was delivered, highlights, regularity)
//   visits  — per visit, a short "what was done and why"
//   closing — delivering what was promised (the signature space is in the PDF itself)
// The facts carry no time of day, no duration, no value and no employee name. Every answer is
// passed through safeAiText() here AND again in the browser, so a sentence with a clock time,
// hours/minutes or money never reaches the client even if the model writes one.
// Models (Muse): intro + closing on the heavy model (muse-wonder-1.0, one small call); the visit
// texts on the everyday model (muse-spark-1.3) in parallel batches — aiGenerate() goes up to the
// heavy model on its own when the everyday one comes back empty.
import { aiGenerate } from './_ai.js'
import { safeAiText } from '../src/lib/monthReportText.js'

const LANG_NAME = {
  ja: 'Japanese (polite business keigo, as a Japanese cleaning company writes to its client: ～いたしました／～しております)',
  en: 'English (polite, professional)',
  pt: 'Brazilian Portuguese (polite, professional)',
}
const BATCH = 12

const RULES = `STRICT RULES — breaking any of them makes the text unusable:
1. Use ONLY the facts in the JSON. Do not invent anything: no dirt level, no condition of the equipment, no problem found, no quantity, no product, no person, no client reaction, no future plan that is not in the facts.
2. NEVER write a time of day, a start or end time, a duration, hours or minutes, "how long", nor any price, cost, fee or value. Do not write the words "hour", "minute", 時間, 分, horas, minutos.
3. The only allowed "why" is the "purpose" given for each task. If a task has no purpose, just say it was done.
4. An item in "not_done_items" must NOT be described as done. Checklist lines are internal notes in Portuguese: use them only to describe the work done, in the output language, and ignore routine closing items (keys, lights, trash, ventilation).
5. "field_worker_note" is an informal internal note: use it only when it states a concrete fact about the work; never quote it.
6. When the facts are few, write less: one short factual sentence is better than filler.
7. Plain text only: no markdown, no bullet symbols, no emojis, no greeting, no signature.`

const clip = (s, n) => String(s || '').slice(0, n)

function parseJson(raw) {
  const cleaned = String(raw || '{}').replace(/```json|```/g, '').trim()
  try { return JSON.parse(cleaned) } catch { return null }
}

async function ask(prompt, options) {
  const data = await aiGenerate({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  }, { timeoutMs: 45000, ...options })
  return { out: parseJson(data?.candidates?.[0]?.content?.parts?.[0]?.text), model: data?._ai?.model || null }
}

/** Only the fields the AI may see, clipped (the page already builds them, this is the server's own guard). */
function cleanFacts(f = {}) {
  const visits = (Array.isArray(f.visits) ? f.visits : []).slice(0, 120).map(v => ({
    id: clip(v.id, 64), store: clip(v.store, 80), date: clip(v.date, 10), weekday: clip(v.weekday, 12),
    tasks: (Array.isArray(v.tasks) ? v.tasks : []).slice(0, 20).map(t => ({ name: clip(t?.name, 60), purpose: t?.purpose ? clip(t.purpose, 200) : null })),
    checklist: typeof v.checklist === 'object' && v.checklist ? {
      checked: Number(v.checklist.checked) || 0, total: Number(v.checklist.total) || 0,
      done_items: (v.checklist.done_items || []).slice(0, 30).map(x => clip(x, 120)),
      not_done_items: (v.checklist.not_done_items || []).slice(0, 30).map(x => clip(x, 120)),
    } : 'not recorded',
    photos: { before: Number(v.photos?.before) || 1, after: Number(v.photos?.after) || 1 },
    client_notes: safeAiText(clip(v.client_notes, 800)).text,
    field_worker_note: safeAiText(clip(v.field_worker_note, 400)).text,
  }))
  return {
    client: clip(f.client, 120), month: clip(f.month, 7), month_label: clip(f.month_label, 40), today: clip(f.today, 10) || null,
    month_finished: !!f.month_finished,
    totals: Object.fromEntries(Object.entries(f.totals || {}).map(([k, x]) => [clip(k, 60), Number(x) || 0])),
    stores: (f.stores || []).slice(0, 60).map(s => ({ name: clip(s.name, 80), completed: Number(s.completed) || 0, scheduled: Number(s.scheduled) || 0 })),
    days_with_a_visit: (f.days_with_a_visit || []).slice(0, 31).map(d => clip(d, 10)),
    task_counts_in_report: Object.fromEntries(Object.entries(f.task_counts_in_report || {}).slice(0, 40).map(([k, x]) => [clip(k, 60), Number(x) || 0])),
    visits,
  }
}

async function writeMonth(facts, lang) {
  const { visits, ...month } = facts
  const prompt = `You write the opening and the closing of the MONTHLY REPORT that KuriPuro, a professional cleaning company in Tokyo, sends to its client "${facts.client}" about the deep cleanings of ${facts.month_label}.
Write in ${LANG_NAME[lang]}.

${RULES}

OPENING ("intro"): 3 to 5 sentences. Say what was delivered (completed of scheduled, the completion %), in how many stores and over how many days (regularity), and the highlights that the numbers show (stores with the most visits, the tasks done most). If "month_finished" is false, say the month is still under way and that the "still_scheduled" visits remain planned — never call it complete. Mention before/after photos only for the "visits_in_report_with_before_after_photos" visits.
CLOSING ("closing"): 1 to 2 sentences. If completed equals scheduled and the month is finished, state that everything that was promised for the month was delivered; otherwise state honestly what was delivered so far. End thanking the client for their trust. No signature (it is printed below).

FACTS:
${JSON.stringify({ ...month, visits_in_report: visits.map(v => ({ store: v.store, date: v.date, tasks: v.tasks.map(t => t.name) })) }, null, 1)}

Answer ONLY JSON: {"intro": "<opening>", "closing": "<closing>"}`
  return ask(prompt, { heavy: true })
}

async function writeVisits(list, client, lang) {
  const prompt = `You write, for each visit of the monthly report that KuriPuro (professional cleaning, Tokyo) sends to "${client}", the short paragraph "What was done and why".
Write in ${LANG_NAME[lang]}.

${RULES}

Each paragraph: 1 to 3 sentences (Japanese: at most about 150 characters; other languages: at most about 55 words). Say what was cleaned (the tasks, and the checklist items done that describe the work), then why, using only the given purposes. You may say that before and after photos were recorded. Do not repeat the store name or the date (they are printed above the paragraph). Make each paragraph fit its own visit — do not copy the same text to every visit when the facts differ.

VISITS:
${JSON.stringify(list, null, 1)}

Answer ONLY JSON: {"visits": [{"id": "<visit id>", "text": "<paragraph>"}]}`
  return ask(prompt)
}

export async function monthReportAi(req, res) {
  const body = req.body || {}
  const lang = LANG_NAME[body.lang] ? body.lang : 'ja'
  const facts = cleanFacts(body.facts)
  if (!facts.client) { res.status(400).json({ error: 'Faltam os dados do mês.' }); return }
  try {
    const batches = []
    for (let i = 0; i < facts.visits.length; i += BATCH) batches.push(facts.visits.slice(i, i + BATCH))
    const [month, ...parts] = await Promise.all([
      writeMonth(facts, lang),
      ...batches.map(b => writeVisits(b, facts.client, lang).catch(() => ({ out: null }))),
    ])
    const ids = new Set(facts.visits.map(v => v.id))
    const visits = {}
    let removed = 0
    for (const p of parts) {
      for (const v of p.out?.visits || []) {
        if (!ids.has(v?.id)) continue
        const s = safeAiText(v.text, 900)
        removed += s.removed
        if (s.text) visits[v.id] = s.text
      }
    }
    const intro = safeAiText(month.out?.intro, 1400)
    const closing = safeAiText(month.out?.closing, 700)
    removed += intro.removed + closing.removed
    if (!intro.text && !closing.text && !Object.keys(visits).length) {
      res.status(502).json({ error: 'A IA não devolveu os textos. Os textos automáticos continuam valendo.' })
      return
    }
    res.status(200).json({
      intro: intro.text, closing: closing.text, visits, removed,
      missing: facts.visits.filter(v => !visits[v.id]).map(v => v.id),
      models: [month.model, ...parts.map(p => p.model)].filter(Boolean),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
