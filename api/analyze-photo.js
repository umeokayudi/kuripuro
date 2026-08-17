// api/analyze-photo.js
// Recebe a URL de uma foto (já hospedada no Supabase Storage) e usa o
// Gemini para dar uma nota de qualidade da limpeza.
// A chave fica só no servidor (env var GEMINI_API_KEY no Vercel).

import { geminiGenerate } from './_gemini.js'

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

    const data = await geminiGenerate({
      contents: [{
        parts: [
          { inlineData: { mimeType: mediaType, data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
    })

    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '{}'
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
