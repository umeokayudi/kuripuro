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
  if (/gemini-3\.7/.test(name)) s += 100
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
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
  )
  if (!resp.ok) return []
  const data = await resp.json()
  return (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .sort((a, b) => rankModel(b) - rankModel(a))
}

async function resolveModels(key) {
  if (cachedModels) return cachedModels
  const available = await fetchAvailableModels(key)
  const preferred = PREFERRED.filter(m => available.includes(m))
  cachedModels = preferred.length ? preferred : available.slice(0, 8)
  if (!cachedModels.length) cachedModels = PREFERRED
  return cachedModels
}

async function callModel(key, model, body) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  )
  const text = await resp.text()
  return { ok: resp.ok, text, retryable: !resp.ok && (text.includes('NOT_FOUND') || text.includes('"code":404')) }
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

export const API_BUILD = '2026-08-31-v16'
