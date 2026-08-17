// Modelos atuais (ago/2026). Os antigos 1.5/2.0 foram desligados pela Google.
const MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
]

export async function geminiGenerate(body) {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não configurada. No Vercel: Settings → Environment Variables → adicione GEMINI_API_KEY com sua chave de https://aistudio.google.com/apikey'
    )
  }

  let lastErr = ''
  for (const model of MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    )
    if (resp.ok) return resp.json()

    lastErr = await resp.text()
    const tryNext = lastErr.includes('NOT_FOUND') || lastErr.includes('"code":404')
    if (!tryNext) break
  }

  throw new Error(`Gemini API error: ${lastErr}`)
}
