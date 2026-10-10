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

async function callModel(key, model, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
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

export async function geminiGenerate(body) {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não configurada. No Vercel: Settings → Environment Variables → adicione GEMINI_API_KEY (https://aistudio.google.com/apikey)'
    )
  }

  const models = await resolveModels(key)
  let lastErr = ''

  for (const model of models) {
    const { ok, text, retryable } = await callModel(key, model, body)
    if (ok) {
      try { return JSON.parse(text) } catch { throw new Error(`Gemini resposta inválida: ${text.slice(0, 200)}`) }
    }
    lastErr = `[${model}] ${text}`
    if (!retryable) break
  }

  cachedModels = null
  throw new Error(`Gemini API error: ${lastErr}`)
}

export const API_BUILD = '2026-10-10-v1.0.16'
