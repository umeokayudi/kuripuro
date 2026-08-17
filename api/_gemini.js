const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']

export async function geminiGenerate(body) {
  let lastErr = ''
  for (const model of MODELS) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    )
    if (resp.ok) return resp.json()
    lastErr = await resp.text()
    if (!lastErr.includes('NOT_FOUND') && !lastErr.includes('404')) break
  }
  throw new Error(`Gemini API error: ${lastErr}`)
}
