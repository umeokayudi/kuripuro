import { aiGenerate } from './_ai.js'
import { SALES_BUCKET, normalizeMime, ownsSalesObject, requireActiveSalesSession, salesDb } from './_salesSession.js'
import { saveLeadDump } from './_sales-visits.js'

const MAX_INLINE_BYTES = 18 * 1024 * 1024

function inlinePart(base64, mimeType) {
  const clean = String(base64 || '').replace(/^data:[^,]+,/, '')
  if (!clean || clean.length > Math.ceil(MAX_INLINE_BYTES * 1.38)) throw new Error('Arquivo vazio ou acima do limite de IA.')
  const bytes = Buffer.from(clean, 'base64')
  if (!bytes.length || bytes.length > MAX_INLINE_BYTES) throw new Error('Arquivo vazio ou acima do limite de IA.')
  return { inlineData: { mimeType, data: bytes.toString('base64') } }
}

// Files are uploaded to private Storage first; the AI reads them from there so
// the request body stays small (Vercel caps function bodies at 4.5 MB).
async function storedPart(user, objectPath, mimeType) {
  if (!ownsSalesObject(user, objectPath, ['cards', 'meetings'])) throw Object.assign(new Error('Arquivo não encontrado nesta conta.'), { status: 403 })
  const { data, error } = await salesDb().storage.from(SALES_BUCKET).download(objectPath)
  if (error || !data) throw Object.assign(new Error('Arquivo não encontrado.'), { status: 404 })
  const bytes = Buffer.from(await data.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_INLINE_BYTES) throw Object.assign(new Error('Arquivo vazio ou acima do limite de IA.'), { status: 413 })
  return { inlineData: { mimeType, data: bytes.toString('base64') } }
}

function parseJsonCandidate(data) {
  const raw = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '{}'
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(clean)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = await requireActiveSalesSession(req, res)
  if (!user) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { task, base64, object_path: objectPath, text = '', language = 'en' } = req.body || {}
    const mimeType = normalizeMime(req.body?.mime_type)
    const filePart = mime => (objectPath ? storedPart(user, objectPath, mime) : inlinePart(base64, mime))
    if (!['business-card', 'voice-note', 'meeting-summary', 'funnel-review', 'sales-insights', 'route-lead', 'lead-dump'].includes(task)) return res.status(400).json({ error: 'Tarefa de IA inválida.' })
    const lang = language === 'ja' ? 'Japanese' : language === 'pt' ? 'Portuguese' : 'English'
    let parts
    let json = true
    let proofPath = ''

    // v1.0.206 · "Jogue tudo aqui": any text, photos (card, storefront, LINE/Maps screenshot)
    // and a voice note go to the AI at once; it returns the lead fields + a booked visit.
    if (task === 'lead-dump') {
      if (user.role !== 'salesperson') return res.status(403).json({ error: 'Use a conta do vendedor.' })
      const files = (Array.isArray(req.body?.files) ? req.body.files : []).slice(0, 6)
      const clean = String(text || '').slice(0, 20_000)
      if (!clean.trim() && !files.length) return res.status(400).json({ error: 'Cole um texto, tire uma foto ou grave um áudio.' })
      // Seller typed the form by hand: keep what they typed as the lead's proof, no AI call.
      if (req.body?.proof_only) {
        const path = await saveLeadDump(salesDb(), user.id, { text: clean, typed: true, at: new Date().toISOString(), by: user.name || '' })
        return res.status(200).json({ task, answer: null, proof_path: path })
      }
      const fileParts = []
      for (const f of files) {
        const mime = normalizeMime(f?.mime_type)
        if (!/^image\/(jpeg|png|webp)$/.test(mime) && !/^audio\/(webm|mp4|mpeg|wav)$/.test(mime)) continue
        fileParts.push(await storedPart(user, String(f?.path || ''), mime))
        if (!proofPath && mime.startsWith('image/') && String(f.path).startsWith(`cards/${user.id}/`)) proofPath = String(f.path)
      }
      if (!fileParts.length && !clean.trim()) return res.status(400).json({ error: 'Arquivo não compatível. Use foto (JPG/PNG) ou áudio.' })
      // Without a photo, what the seller pasted is kept as the proof of where the lead came from.
      if (!proofPath) {
        proofPath = await saveLeadDump(salesDb(), user.id, { text: clean, files: files.map(f => String(f?.path || '')).filter(Boolean), at: new Date().toISOString(), by: user.name || '' })
      }
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' }).format(new Date())
      parts = [...fileParts, { text: `You help a salesperson of KuriPuro (restaurant/kitchen cleaning company in Japan) register a sales lead with zero typing.
They dumped everything they have below: pasted text (LINE/e-mail/notes/website), photos (business card, storefront sign, menu, Google Maps or chat screenshots) and/or a voice note. Read ALL of it.
Today in Japan: ${today} (${weekday}). Resolve relative dates ("amanhã", "sexta", "来週火曜", "next Monday") to YYYY-MM-DD from today.
Return JSON only:
{"company_name":"","company_kana":"","site_name":"","contact_name":"","contact_title":"","phone":"","email":"","address":"","website":"","line_id":"","maps_url":"","industry":"","needs":"","interest":"","competitor":"","decision_maker":"","expected_monthly":0,"locations_count":0,"next_followup_date":"","notes":"","visit":{"date":"","time":"","duration_min":60,"place":"","note":""},"uncertain_fields":[],"summary":""}
Rules:
- company_name = company or restaurant brand; site_name = the branch/store (e.g. "渋谷店"). If only one name exists, put it in company_name.
- Keep names, addresses and phone numbers exactly as written (Japanese stays Japanese). Phone digits as shown.
- maps_url only if a Google Maps link is present. address only if written or clearly visible.
- needs = what cleaning they want/the problem (in ${lang}). notes = a short note in ${lang} of what happened and what to do next (2–3 lines max).
- visit: fill ONLY when a visit/meeting/appointment is mentioned (date required; time "HH:MM" 24h if said; duration_min if said, else 60). Otherwise leave visit.date empty.
- next_followup_date only if a follow-up/return date is mentioned and no visit already covers it.
- expected_monthly in JPY only if a monthly amount is said. Never invent data: empty string / 0 when unknown. List doubtful fields in uncertain_fields.
- summary: one short sentence in ${lang} saying what you found.
SELLER DUMP (text):
${clean || '(no text — read the files)'}` }]
    }

    if (task === 'lead-dump') { /* parts built above */ } else if (task === 'business-card') {
      if (!String(mimeType || '').match(/^image\/(jpeg|png|webp)$/)) return res.status(400).json({ error: 'Use uma imagem JPEG, PNG ou WebP.' })
      parts = [await filePart(mimeType), { text: `Read this business card and extract only information that is actually visible. Current date in Japan: ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())}. Return JSON only: {"company_name":"","site_name":"","contact_name":"","contact_title":"","phone":"","email":"","address":"","website":"","date":"YYYY-MM-DD","uncertain_fields":[]}. Keep the card's original spelling. Use empty strings for missing fields. List ambiguous field names in uncertain_fields. Do not infer missing data.` }]
    } else if (task === 'voice-note') {
      if (!String(mimeType || '').match(/^audio\/(webm|mp4|mpeg|wav)$/)) return res.status(400).json({ error: 'Formato de áudio não compatível.' })
      parts = [await filePart(mimeType), { text: `Transcribe this salesperson's spoken note faithfully in the language spoken. Also return JSON only with keys transcript, summary, company_name, contact_name, needs, next_step, followup_date (YYYY-MM-DD or empty), uncertain_fields. Write summary and next_step in ${lang}. Do not invent names, dates, amounts, or commitments. If words are unclear, mark them in uncertain_fields.` }]
    } else if (task === 'meeting-summary') {
      if (text.trim()) parts = [{ text: `Review the following sales meeting transcript. Return JSON only with keys summary, decisions, objections, open_questions, next_step, followup_date (YYYY-MM-DD or empty), risks. Write the summary and next_step in ${lang}. Ground every point in the transcript; do not invent commitments.
TRANSCRIPT:
${text.slice(0, 45_000)}` }]
      else {
        if (!String(mimeType || '').match(/^audio\/(webm|mp4|mpeg|wav)$/)) return res.status(400).json({ error: 'Formato de áudio não compatível.' })
        parts = [await filePart(mimeType), { text: `Transcribe and summarize this sales meeting recording. Return JSON only with keys transcript, summary, decisions, objections, open_questions, next_step, followup_date (YYYY-MM-DD or empty), risks. Write summary and next_step in ${lang}. Do not invent commitments; mark unclear details as uncertain.` }]
      }
    } else if (task === 'sales-insights') {
      json = false
      const scope = user.role === 'admin' ? 'the whole sales team (manager view). Include a short coaching note per seller.' : 'one salesperson (their own data). Coach them directly.'
      parts = [{ text: `You analyse KuriPuro's B2B cleaning-services sales data for ${scope}
Answer in ${lang}, in short sections with bullets:
1. Why deals are lost or stall (use lost/decline reasons, client answers, days to answer).
2. Price: which quote size and which item prices get approved vs declined; average price per item that sells best.
3. Region: where it converts best and worst.
4. Timing: days to close, days to answer a quote, best weekday for contacts.
5. Most common client answers and a suggested reply script for the top 3 objections.
6. Next actions (max 5), concrete.
Rules: only claim what the numbers support; when a sample is small (under 5) say so; never invent clients, amounts or names; numbers are JPY.
DATA (JSON):
${text.slice(0, 45_000)}` }]
    } else if (task === 'route-lead') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Somente admin.' })
      parts = [{ text: `Pick which salesperson should approach this new lead, using only the data given (each seller's win rate by region and source, open workload, overdue follow-ups, recent activity). Prefer proven results in the same region/source, then lower workload and fewer overdue follow-ups. Return JSON only: {"salesperson_id":"","reason":"one or two sentences in ${lang}","confidence":"low|medium|high"}. If data is too thin, still pick the best option and set confidence low.
DATA (JSON):
${text.slice(0, 30_000)}` }]
    } else {
      json = false
      parts = [{ text: `You are an assistant reviewing KuriPuro's sales funnel for the signed-in user. Give specific suggestions for next actions, missed follow-ups, conversion ratios, and quote/contract progress. Do not claim a trend unless supported by the supplied data. Mark recommendations as suggestions for a human to review. Answer in ${lang}.
SALES DATA:
${text.slice(0, 45_000)}` }]
    }

    const result = await aiGenerate({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: task === 'sales-insights' ? 2200 : task === 'funnel-review' ? 1200 : task === 'lead-dump' ? 8000 : 1600, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }, task === 'lead-dump' ? { timeoutMs: 45000 } : undefined)
    const answer = json ? parseJsonCandidate(result) : (result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '')
    return res.status(200).json({ task, answer, ...(proofPath ? { proof_path: proofPath } : {}) })
  } catch (error) {
    console.error('[sales-ai]', error?.message || error)
    if (error?.status) return res.status(error.status).json({ error: error.message })
    return res.status(500).json({ error: 'A análise de IA falhou. Revise o conteúdo e tente novamente.' })
  }
}
