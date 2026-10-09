import { geminiGenerate } from './_gemini.js'
import { requireSalesSession } from './_salesSession.js'

export const config = { api: { bodyParser: { sizeLimit: '26mb' } } }

const MAX_INLINE_BYTES = 18 * 1024 * 1024

function inlinePart(base64, mimeType) {
  const clean = String(base64 || '').replace(/^data:[^,]+,/, '')
  if (!clean || clean.length > Math.ceil(MAX_INLINE_BYTES * 1.38)) throw new Error('Arquivo vazio ou acima do limite de IA.')
  const bytes = Buffer.from(clean, 'base64')
  if (!bytes.length || bytes.length > MAX_INLINE_BYTES) throw new Error('Arquivo vazio ou acima do limite de IA.')
  return { inlineData: { mimeType, data: bytes.toString('base64') } }
}

function parseJsonCandidate(data) {
  const raw = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '{}'
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(clean)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const user = requireSalesSession(req, res)
  if (!user) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const { task, base64, mime_type: mimeType, text = '', language = 'en' } = req.body || {}
    if (!['business-card', 'voice-note', 'meeting-summary', 'funnel-review'].includes(task)) return res.status(400).json({ error: 'Tarefa de IA inválida.' })
    const lang = language === 'ja' ? 'Japanese' : language === 'pt' ? 'Portuguese' : 'English'
    let parts
    let json = true

    if (task === 'business-card') {
      if (!String(mimeType || '').match(/^image\/(jpeg|png|webp)$/)) return res.status(400).json({ error: 'Use uma imagem JPEG, PNG ou WebP.' })
      parts = [inlinePart(base64, mimeType), { text: `Read this business card and extract only information that is actually visible. Current date in Japan: ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())}. Return JSON only: {"company_name":"","site_name":"","contact_name":"","contact_title":"","phone":"","email":"","address":"","website":"","date":"YYYY-MM-DD","uncertain_fields":[]}. Keep the card's original spelling. Use empty strings for missing fields. List ambiguous field names in uncertain_fields. Do not infer missing data.` }]
    } else if (task === 'voice-note') {
      if (!String(mimeType || '').match(/^audio\/(webm|mp4|mpeg|wav|x-wav)$/)) return res.status(400).json({ error: 'Formato de áudio não compatível.' })
      parts = [inlinePart(base64, mimeType), { text: `Transcribe this salesperson's spoken note faithfully in the language spoken. Also return JSON only with keys transcript, summary, company_name, contact_name, needs, next_step, followup_date (YYYY-MM-DD or empty), uncertain_fields. Write summary and next_step in ${lang}. Do not invent names, dates, amounts, or commitments. If words are unclear, mark them in uncertain_fields.` }]
    } else if (task === 'meeting-summary') {
      if (text.trim()) parts = [{ text: `Review the following sales meeting transcript. Return JSON only with keys summary, decisions, objections, open_questions, next_step, followup_date (YYYY-MM-DD or empty), risks. Write the summary and next_step in ${lang}. Ground every point in the transcript; do not invent commitments.
TRANSCRIPT:
${text.slice(0, 45_000)}` }]
      else {
        if (!String(mimeType || '').match(/^audio\/(webm|mp4|mpeg|wav|x-wav)$/)) return res.status(400).json({ error: 'Formato de áudio não compatível.' })
        parts = [inlinePart(base64, mimeType), { text: `Transcribe and summarize this sales meeting recording. Return JSON only with keys transcript, summary, decisions, objections, open_questions, next_step, followup_date (YYYY-MM-DD or empty), risks. Write summary and next_step in ${lang}. Do not invent commitments; mark unclear details as uncertain.` }]
      }
    } else {
      json = false
      parts = [{ text: `You are an assistant reviewing KuriPuro's sales funnel for the signed-in user. Give specific suggestions for next actions, missed follow-ups, conversion ratios, and quote/contract progress. Do not claim a trend unless supported by the supplied data. Mark recommendations as suggestions for a human to review. Answer in ${lang}.
SALES DATA:
${text.slice(0, 45_000)}` }]
    }

    const result = await geminiGenerate({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: task === 'funnel-review' ? 1200 : 1600, ...(json ? { responseMimeType: 'application/json' } : {}) },
    })
    const answer = json ? parseJsonCandidate(result) : (result?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '')
    return res.status(200).json({ task, answer })
  } catch (error) {
    console.error('[sales-ai]', error?.message || error)
    return res.status(500).json({ error: 'A análise de IA falhou. Revise o conteúdo e tente novamente.' })
  }
}
