import { geminiGenerate } from './_gemini.js'
import { SALES_BUCKET, normalizeMime, ownsSalesObject, requireActiveSalesSession, salesDb } from './_salesSession.js'

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
    if (!['business-card', 'voice-note', 'meeting-summary', 'funnel-review', 'sales-insights', 'route-lead'].includes(task)) return res.status(400).json({ error: 'Tarefa de IA inválida.' })
    const lang = language === 'ja' ? 'Japanese' : language === 'pt' ? 'Portuguese' : 'English'
    let parts
    let json = true

    if (task === 'business-card') {
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

    const result = await geminiGenerate({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: task === 'sales-insights' ? 2200 : task === 'funnel-review' ? 1200 : 1600, ...(json ? { responseMimeType: 'application/json' } : {}) },
    })
    const answer = json ? parseJsonCandidate(result) : (result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '')
    return res.status(200).json({ task, answer })
  } catch (error) {
    console.error('[sales-ai]', error?.message || error)
    if (error?.status) return res.status(error.status).json({ error: error.message })
    return res.status(500).json({ error: 'A análise de IA falhou. Revise o conteúdo e tente novamente.' })
  }
}
