// Relatório retroativo — IA objetiva vs checklist marcado (sem valor/pagamento).

import { geminiGenerate } from './_gemini.js'
import { buildEvaluateReportPrompt, normalizeEvaluateResult, parsePhotoAiJson } from '../src/lib/photoAi.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { report, checklist, jobTitle, markedDone } = req.body || {}
  if (!report) { res.status(400).json({ error: 'report is required' }); return }

  const checklistItems = Array.isArray(checklist) ? checklist : []
  const marked = Array.isArray(markedDone) ? markedDone : []
  const prompt = buildEvaluateReportPrompt({ report, checklist: checklistItems, jobTitle, markedDone: marked })

  try {
    const data = await geminiGenerate({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    })
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const parsed = parsePhotoAiJson(raw)
    res.status(200).json(normalizeEvaluateResult(parsed, { checklist: checklistItems, markedDone: marked }))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
