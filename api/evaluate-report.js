// api/evaluate-report.js
// Recebe o relatório retroativo do trabalhador + o checklist do job e usa
// o Gemini pra decidir quais itens foram feitos, quanto tempo, e quanto ele
// deve ganhar (desconto proporcional ao que não foi feito).

async function callGemini(body) {
  const models = ['gemini-3.5-flash', 'gemini-2.5-pro']
  let lastErr
  for (const model of models) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      )
      if (!resp.ok) { lastErr = new Error(await resp.text()); continue }
      return await resp.json()
    } catch (e) { lastErr = e }
  }
  throw lastErr
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const { report, checklist, jobValue, jobTitle } = req.body || {}
  if (!report) { res.status(400).json({ error: 'report is required' }); return }

  const checklistItems = Array.isArray(checklist) ? checklist : []

  const prompt = `Você avalia relatórios de trabalho de limpeza de restaurante/bar. O trabalhador escreveu um relatório retroativo do que fez no serviço "${jobTitle || 'um local'}".

CHECKLIST ESPERADO deste serviço (${checklistItems.length} itens):
${checklistItems.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(sem checklist definido)'}

RELATÓRIO DO TRABALHADOR:
"${report}"

VALOR CHEIO do serviço: ¥${jobValue || 0}

Sua tarefa: com base APENAS no relatório, decida quais itens do checklist foram claramente feitos. Se o relatório não menciona ou não deixa claro que um item foi feito, considere NÃO feito. Seja justo mas rigoroso — o pagamento depende disso.

Responda APENAS com um JSON válido, sem texto fora dele, no formato exato:
{"itens_feitos": <número>, "itens_total": ${checklistItems.length}, "nao_feitos": [<lista dos itens não feitos, em português>], "tempo_estimado_min": <minutos que o trabalhador diz ter levado, ou null se não mencionou>, "valor_final": <valor em ienes, = valor cheio menos desconto proporcional aos itens não feitos>, "resumo": "<1 frase explicando a avaliação>"}`

  try {
    const data = await callGemini({
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
