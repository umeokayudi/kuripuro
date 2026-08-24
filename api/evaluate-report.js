// api/evaluate-report.js
// Relatório retroativo — IA analisa só o texto vs checklist (sem valor/pagamento).

import { geminiGenerate } from './_gemini.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { report, checklist, jobTitle, markedDone } = req.body || {}
  if (!report) { res.status(400).json({ error: 'report is required' }); return }

  const checklistItems = Array.isArray(checklist) ? checklist : []
  const marked = Array.isArray(markedDone) ? markedDone : []

  const prompt = `Você avalia relatórios de trabalho de limpeza de restaurante/bar.

IMPORTANTE: valor, pagamento e desconto NÃO fazem parte desta análise. Não calcule nem mencione dinheiro. Vá direto para a análise do relatório contra o checklist.

Serviço: "${jobTitle || 'um local'}"

CHECKLIST ESPERADO (${checklistItems.length} itens):
${checklistItems.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(sem checklist definido)'}

${marked.length ? `ITENS MARCADOS PELO FUNCIONÁRIO COMO FEITOS (${marked.length}):\n${marked.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n` : ''}

RELATÓRIO DO FUNCIONÁRIO:
"${report}"

Com base no relatório (e nos itens marcados, se houver), indique quais itens do checklist ficaram claramente comprovados no texto. Se o relatório não menciona ou não deixa claro que um item foi feito, considere NÃO feito.

Responda APENAS com JSON válido, sem texto fora dele:
{"itens_feitos": <número>, "itens_total": ${checklistItems.length}, "nao_feitos": [<itens não comprovados no relatório, em português>], "tempo_estimado_min": <minutos mencionados ou null>, "resumo": "<1 frase sobre a análise do relatório vs checklist — sem mencionar valor ou pagamento>"}`

  try {
    const data = await geminiGenerate({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    })
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const cleaned = raw.replace(/```json|```/g, '').trim()
    let parsed
    try { parsed = JSON.parse(cleaned) } catch { parsed = { error: 'parse', raw: cleaned } }
    res.status(200).json(parsed)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
