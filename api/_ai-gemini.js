// Gemini provider (Google AI Studio). Only api/_ai.js calls this file; every screen and
// route goes through aiGenerate() / aiGenerateImage() there.
export const name = 'gemini'
export const configured = () => !!process.env.GEMINI_API_KEY
export const modelLabel = () => (cachedModels && cachedModels[0]) || 'gemini (auto)'
export const canEscalate = false

const PREFERRED = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
]

let cachedModels = null

function rankModel(name) {
  let s = 0
  if (/gemini-3\.8/.test(name)) s += 110
  else if (/gemini-3\.7/.test(name)) s += 100
  else if (/gemini-3\.6/.test(name)) s += 90
  else if (/gemini-3\.5/.test(name)) s += 80
  else if (/gemini-2\.5/.test(name)) s += 70
  if (/flash/i.test(name)) s += 10
  if (/lite/i.test(name)) s -= 3
  if (/image|tts|live|omni|pro|native-audio/i.test(name)) s -= 100
  if (/preview/i.test(name)) s -= 5
  if (/1\.5|2\.0/.test(name)) s -= 200
  return s
}

async function fetchAvailableModels(key) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': key }, signal: controller.signal }
    )
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .sort((a, b) => rankModel(b) - rankModel(a))
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

async function resolveModels(key) {
  if (cachedModels) return cachedModels
  const available = await fetchAvailableModels(key)
  const preferred = PREFERRED.filter(m => available.includes(m))
  cachedModels = preferred.length ? preferred : available.slice(0, 8)
  if (!cachedModels.length) cachedModels = ['gemini-2.5-flash']
  return cachedModels
}

async function callModel(key, model, body, timeoutMs = 25000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    )
    const text = await resp.text()
    return { ok: resp.ok, text, retryable: !resp.ok && (text.includes('NOT_FOUND') || text.includes('"code":404')) }
  } catch (error) {
    return { ok: false, text: error.name === 'AbortError' ? 'Tempo limite da IA excedido. Tente novamente.' : 'Não foi possível conectar à IA.', retryable: false }
  } finally {
    clearTimeout(timer)
  }
}

/** options.timeoutMs: how long one model call may take (default 25 s). */
export async function generate(body, { timeoutMs } = {}) {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não configurada. No Vercel: Settings → Environment Variables → adicione GEMINI_API_KEY (https://aistudio.google.com/apikey)'
    )
  }

  const models = await resolveModels(key)
  let lastErr = ''

  for (const model of models) {
    const { ok, text, retryable } = await callModel(key, model, body, timeoutMs)
    if (ok) {
      try { return JSON.parse(text) } catch { throw new Error(`Gemini resposta inválida: ${text.slice(0, 200)}`) }
    }
    lastErr = `[${model}] ${text}`
    if (!retryable) break
  }

  cachedModels = null
  throw new Error(`Gemini API error: ${lastErr}`)
}


/* ------------------------------------------------------------ images (提案書) */
const clip = (s, n) => String(s ?? '').slice(0, n)

let imageModels = null
async function listImageModels(key) {
  if (imageModels) return imageModels
  const rank = n => {
    let s = 0
    const v = n.match(/(\d+)\.(\d+)/)
    if (v) s += Number(v[1]) * 10 + Number(v[2])
    if (/flash/.test(n)) s += 5
    if (/preview|exp/.test(n)) s -= 2
    return s
  }
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=300', { headers: { 'x-goog-api-key': key } })
    const data = r.ok ? await r.json() : {}
    const models = data.models || []
    const gen = models.filter(m => /image/i.test(m.name) && !/imagen/i.test(m.name) && m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, '')).sort((a, b) => rank(b) - rank(a))
    const imagen = models.filter(m => /imagen/i.test(m.name) && m.supportedGenerationMethods?.includes('predict'))
      .map(m => m.name.replace(/^models\//, '')).sort((a, b) => rank(b) - rank(a))
    imageModels = { gen: gen.length ? gen : ['gemini-2.5-flash-image'], imagen }
  } catch {
    imageModels = { gen: ['gemini-2.5-flash-image'], imagen: [] }
  }
  return imageModels
}

async function postJson(url, key, body, ms = 55000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ctl.signal })
    const text = await r.text()
    return { ok: r.ok, json: (() => { try { return JSON.parse(text) } catch { return null } })(), text }
  } catch (e) {
    return { ok: false, text: e.name === 'AbortError' ? 'Tempo limite da IA de imagem.' : e.message }
  } finally { clearTimeout(t) }
}

export async function generateImage(prompt, aspect) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY não configurada no Vercel.')
  const { gen, imagen } = await listImageModels(key)
  let last = ''
  for (const model of gen.slice(0, 3)) {
    const r = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, key, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: aspect } },
    })
    const part = r.json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data || p.inline_data?.data)
    const inline = part?.inlineData || part?.inline_data
    if (inline?.data) return { data: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png', model }
    last = `[${model}] ${clip(r.text, 300)}`
    if (/imageConfig|aspectRatio/i.test(r.text || '')) {
      // older image models do not know imageConfig: try once more without it
      const r2 = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, key, {
        contents: [{ parts: [{ text: `${prompt}\nAspect ratio ${aspect}, landscape.` }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      })
      const p2 = r2.json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data || p.inline_data?.data)
      const i2 = p2?.inlineData || p2?.inline_data
      if (i2?.data) return { data: i2.data, mime: i2.mimeType || i2.mime_type || 'image/png', model }
      last = `[${model}] ${clip(r2.text, 300)}`
    }
  }
  for (const model of imagen.slice(0, 1)) {
    const r = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, key, {
      instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: aspect },
    })
    const b64 = r.json?.predictions?.[0]?.bytesBase64Encoded
    if (b64) return { data: b64, mime: r.json.predictions[0].mimeType || 'image/png', model }
    last = `[${model}] ${clip(r.text, 300)}`
  }
  imageModels = null
  throw new Error(`A IA não conseguiu gerar a imagem. ${last}`)
}
