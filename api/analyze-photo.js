// api/analyze-photo.js
// Analisa uma ou várias fotos After. Só julga o que aparece no quadro.

import { geminiGenerate } from './_gemini.js'
import { fetchStorageBuffer } from './_storage.js'
import {
  PHOTO_AI_MAX_ANALYZE,
  buildPhotoAiPrompt,
  normalizePhotoAiResult,
  parsePhotoAiJson,
} from '../src/lib/photoAi.js'
import { parsePhotoUrls } from '../src/lib/jobPhotoUrls.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body || {}
  const urls = parsePhotoUrls(body.photoUrls?.length ? body.photoUrls : (body.photoUrl || ''))
    .slice(0, PHOTO_AI_MAX_ANALYZE)
  if (!urls.length) {
    res.status(400).json({ error: 'photoUrl is required' })
    return
  }

  try {
    const images = []
    for (const url of urls) {
      try {
        const { buffer, contentType } = await fetchStorageBuffer(url)
        images.push({
          inlineData: {
            mimeType: contentType || 'image/jpeg',
            data: buffer.toString('base64'),
          },
        })
      } catch {
        /* skip a missing extra photo */
      }
    }
    if (!images.length) {
      res.status(400).json({ error: 'Nenhuma foto pôde ser lida' })
      return
    }

    const prompt = buildPhotoAiPrompt({
      locationName: body.locationName,
      cleaningType: body.cleaningType || 'basic',
      deepComponents: body.deepComponents || [],
      photoCount: images.length,
      checklist: body.checklist || [],
    })

    const data = await geminiGenerate({
      contents: [{
        parts: [
          ...images,
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 400, responseMimeType: 'application/json' },
    })

    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '{}'
    const parsed = parsePhotoAiJson(raw)
    const result = normalizePhotoAiResult(parsed, { photoCount: images.length })
    res.status(200).json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
