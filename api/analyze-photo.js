// api/analyze-photo.js
// Recebe a URL de uma foto (já hospedada no Supabase Storage) e usa o
// modelo de visão da Anthropic (Claude Haiku) para dar uma nota de
// qualidade da limpeza. A chave da API fica só no servidor (env var
// ANTHROPIC_API_KEY no Vercel), nunca é exposta no navegador.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { photoUrl, locationName } = req.body || {}
  if (!photoUrl) {
    res.status(400).json({ error: 'photoUrl is required' })
    return
  }

  try {
    const imgResp = await fetch(photoUrl)
    if (!imgResp.ok) throw new Error('Could not fetch photo')
    const buffer = await imgResp.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mediaType = imgResp.headers.get('content-type') || 'image/jpeg'

    const prompt = `Você é um inspetor de qualidade de limpeza de restaurante/bar. Analise esta foto tirada após a limpeza de "${locationName || 'um local'}". Responda APENAS com um JSON válido, sem nenhum texto fora dele, no formato exato:
{"nota": <número de 1 a 10>, "aprovado": <true ou false>, "problemas": [<lista curta de problemas visíveis, em português, vazia se não houver>]}
Considere aprovado (true) apenas se nota >= 7. Seja objetivo: sujeira visível, lixo, bagunça, manchas, poeira acumulada, chão sujo são motivos para reprovar.`

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })

    if (!claudeResp.ok) {
      const errText = await claudeResp.text()
      throw new Error(`Anthropic API error: ${errText}`)
    }

    const data = await claudeResp.json()
    const textBlock = (data.content || []).find(c => c.type === 'text')
    const raw = textBlock ? textBlock.text : '{}'
    const cleaned = raw.replace(/```json|```/g, '').trim()

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      parsed = { nota: null, aprovado: null, problemas: [], raw: cleaned }
    }

    res.status(200).json(parsed)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
