// Meta Model API (Muse) provider. Only api/_ai.js calls this file.
//
// Facts from the official docs (dev.meta.ai, read 2026-11-12/13):
//   POST https://api.meta.ai/v1/chat/completions   (OpenAI-compatible)   Authorization: Bearer <key>
//   POST https://api.meta.ai/v1/images/generations  model muse-image-1.0, response_format b64_json
//   Models: muse-spark-1.3 (default), muse-wonder-1.0 (heavy), muse-spark-1.2 (audio: 1.3 does not
//   fully support audio yet; input_audio accepts only wav / mp3).
//   Standard mode (content NOT used to train Meta models) = the plain model id. The
//   "-contributor" ids train on the data, so they are never used here.
//   Retry 429 / 500 / 502 / 503 (Retry-After); never retry 4xx or 504.
//   No cost in the response: the cost shown on screen is estimated from usage tokens × price list.
//
// Callers still speak the request/response shape they always used (contents / parts /
// functionCall / functionResponse / inlineData → candidates[0].content.parts); this file
// translates both ways, so prompts, tools and screens stay the same.

export const name = 'muse'
const BASE_URL = 'https://api.meta.ai/v1'

export const MODELS = {
  default: 'muse-spark-1.3',
  heavy: 'muse-wonder-1.0',
  audio: 'muse-spark-1.2',
  image: 'muse-image-1.0',
}

// USD per 1M tokens (Standard mode, pricing page). Image: flat per image.
export const PRICES = {
  'muse-spark-1.3': { input: 1.25, cached: 0.15, output: 4.25 },
  'muse-spark-1.2': { input: 1.25, cached: 0.15, output: 4.25 },
  'muse-wonder-1.0': { input: 4.0, cached: 0.2, output: 20.0 },
  'muse-image-1.0': { perImage: 0.01 },
}

const apiKey = () => String(process.env.META_AI_API_KEY || '').trim()
export const configured = () => !!apiKey()
export const modelLabel = () => `${MODELS.default} · pesado: ${MODELS.heavy}`
export const canEscalate = true

export function estimateCostUsd(model, usage = {}) {
  const p = PRICES[model]
  if (!p) return 0
  if (p.perImage) return p.perImage * (usage.images || 1)
  const cached = Number(usage.cachedTokens) || 0
  const input = Math.max(0, (Number(usage.inputTokens) || 0) - cached)
  const output = Number(usage.outputTokens) || 0
  return (input * p.input + cached * p.cached + output * p.output) / 1_000_000
}

/* ------------------------------------------------------------ request translation */

/** Gemini-style schema (type: 'OBJECT', 'STRING', …) → JSON Schema (lowercase types). */
export function toJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toJsonSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase()
    else if (k === 'nullable') continue
    else if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toJsonSchema(pv)]))
    } else if (k === 'items') out.items = toJsonSchema(v)
    else out[k] = v
  }
  return out
}

function systemText(systemInstruction) {
  if (!systemInstruction) return ''
  if (typeof systemInstruction === 'string') return systemInstruction
  return (systemInstruction.parts || []).map(p => p.text || '').join('\n')
}

const AUDIO_FORMAT = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3' }

/** One inlineData part → OpenAI-style content part (or a text note when Muse cannot read it). */
function mediaPart(inline, info) {
  const mime = String(inline.mimeType || inline.mime_type || '').toLowerCase().split(';')[0]
  const data = inline.data || ''
  if (/^image\/(jpeg|jpg|png|gif|webp|x-icon)$/.test(mime)) {
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }
  }
  if (mime === 'application/pdf') {
    return { type: 'file', file: { filename: 'documento.pdf', file_data: `data:application/pdf;base64,${data}` } }
  }
  if (/^text\/(plain|csv)$/.test(mime)) {
    return { type: 'text', text: `[arquivo ${mime}]\n${Buffer.from(data, 'base64').toString('utf8').slice(0, 200_000)}` }
  }
  if (mime.startsWith('audio/')) {
    const format = AUDIO_FORMAT[mime]
    if (!format) {
      const err = new Error('Este formato de áudio não é aceito pela IA atual (só MP3 ou WAV). Atualize a página e grave de novo.')
      err.statusCode = 415
      throw err
    }
    info.audio = true
    return { type: 'input_audio', input_audio: { data, format } }
  }
  if (mime.startsWith('video/')) {
    info.skipped.push('vídeo')
    return { type: 'text', text: '[Um vídeo foi anexado, mas a IA atual não lê vídeo. Diga isso ao usuário e peça uma foto ou um texto.]' }
  }
  info.skipped.push(mime || 'arquivo')
  return { type: 'text', text: `[Arquivo ${mime || 'desconhecido'} anexado; a IA atual não lê este formato.]` }
}

/**
 * Gemini-shaped body → { messages, tools }.
 * Tool calls get ids; a following user turn of functionResponse parts is matched to the
 * previous model turn's calls in order (the tool loop answers them in the same order).
 */
export function toChatRequest(body = {}) {
  const info = { audio: false, skipped: [] }
  const messages = []
  const sys = systemText(body.systemInstruction || body.system_instruction)
  const json = body.generationConfig?.responseMimeType === 'application/json'
  const sysFull = [sys, json ? 'Responda SOMENTE com JSON válido, sem markdown, sem ``` e sem texto antes ou depois.' : ''].filter(Boolean).join('\n\n')
  if (sysFull) messages.push({ role: 'developer', content: sysFull })

  let lastCallIds = []
  let callCounter = 0
  for (const turn of body.contents || []) {
    const parts = Array.isArray(turn?.parts) ? turn.parts : []
    if (turn.role === 'model' || turn.role === 'assistant') {
      const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('')
      const calls = parts.filter(p => p.functionCall).map(p => {
        const id = p.functionCall.id || `call_${++callCounter}`
        return { id, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }
      })
      lastCallIds = calls.map(c => c.id)
      const msg = { role: 'assistant', content: text || (calls.length ? null : '') }
      if (calls.length) msg.tool_calls = calls
      messages.push(msg)
      continue
    }
    const responses = parts.filter(p => p.functionResponse)
    if (responses.length) {
      responses.forEach((p, i) => {
        const r = p.functionResponse
        messages.push({ role: 'tool', tool_call_id: r.id || lastCallIds[i] || `call_${++callCounter}`, content: JSON.stringify(r.response ?? {}) })
      })
    }
    const content = []
    for (const p of parts) {
      if (p.functionResponse) continue
      if (typeof p.text === 'string') content.push({ type: 'text', text: p.text })
      else if (p.inlineData || p.inline_data) content.push(mediaPart(p.inlineData || p.inline_data, info))
      else if (p.fileData) { info.skipped.push('link de arquivo'); content.push({ type: 'text', text: `[arquivo: ${p.fileData.fileUri || ''}]` }) }
    }
    if (content.length) {
      const onlyText = content.every(c => c.type === 'text')
      messages.push({ role: 'user', content: onlyText ? content.map(c => c.text).join('\n') : content })
    }
  }

  const declarations = (body.tools || []).flatMap(t => t.functionDeclarations || t.function_declarations || [])
  const tools = declarations.map(d => ({
    type: 'function',
    function: { name: d.name, description: d.description || '', parameters: toJsonSchema(d.parameters || { type: 'object', properties: {} }) },
  }))
  return { messages, tools, json, info }
}

/* ----------------------------------------------------------- response translation */

function stripFences(text) {
  const t = String(text || '').trim()
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return m ? m[1] : t
}

export function fromChatResponse(data, { json, model }) {
  const choice = data?.choices?.[0] || {}
  const msg = choice.message || {}
  const parts = []
  let text = typeof msg.content === 'string' ? msg.content
    : Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : ''
  if (json) text = stripFences(text)
  if (text) parts.push({ text })
  for (const call of msg.tool_calls || []) {
    let args = {}
    try { args = call.function?.arguments ? JSON.parse(call.function.arguments) : {} } catch { args = {} }
    parts.push({ functionCall: { id: call.id, name: call.function?.name, args } })
  }
  const u = data?.usage || {}
  const usage = {
    inputTokens: u.prompt_tokens || 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens || 0,
    outputTokens: u.completion_tokens || 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens || 0,
  }
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason: choice.finish_reason || null }],
    usageMetadata: { promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens, totalTokenCount: u.total_tokens || 0 },
    _ai: { provider: 'muse', model: data?.model || model, usage, costUsd: estimateCostUsd(model, usage), finishReason: choice.finish_reason || null },
  }
}

/* ------------------------------------------------------------------- HTTP + retry */

const TRANSIENT = new Set([429, 500, 502, 503])
const sleep = ms => new Promise(r => setTimeout(r, ms))

function readableError(status, text) {
  let msg = ''
  try { msg = JSON.parse(text)?.error?.message || '' } catch {}
  if (status === 401 || status === 403) return 'A chave da IA (META_AI_API_KEY) foi recusada. Confira a chave na Vercel.'
  if (status === 402) return 'A conta da IA (Meta) está sem pagamento configurado.'
  if (status === 429) return 'A IA está recebendo pedidos demais agora. Tente de novo em um minuto.'
  if (status === 413) return 'O pedido ficou grande demais para a IA. Mande menos anexos.'
  if (status >= 500) return 'A IA (Meta) está fora do ar agora. Tente de novo em alguns minutos.'
  return `A IA recusou o pedido${msg ? `: ${msg.slice(0, 200)}` : '.'}`
}

/** POST with timeout and ONE extra try on a transient error (429/500/502/503 or network). */
async function postJson(path, payload, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now()
    if (left < 1500) break
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), left)
    try {
      const resp = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      })
      const text = await resp.text()
      if (resp.ok) {
        try { return JSON.parse(text) } catch { throw Object.assign(new Error('A IA mandou uma resposta inválida.'), { final: true }) }
      }
      lastErr = Object.assign(new Error(readableError(resp.status, text)), { providerStatus: resp.status, final: !TRANSIENT.has(resp.status) })
      if (lastErr.final || attempt === 1) throw lastErr
      const retryAfter = Number(resp.headers.get('retry-after'))
      const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 700 + Math.random() * 600, 4000)
      if (deadline - Date.now() < wait + 3000) throw lastErr
      await sleep(wait)
    } catch (error) {
      if (error.final || error.providerStatus) throw error
      if (error.name === 'AbortError') throw new Error('A IA demorou demais para responder. Tente de novo.')
      lastErr = new Error('Não foi possível conectar à IA (Meta).')
      if (attempt === 1) throw lastErr
      await sleep(600)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr || new Error('A IA demorou demais para responder. Tente de novo.')
}

/* --------------------------------------------------------------------------- API */

/**
 * options: timeoutMs (default 25 s), lowThinking, heavy (owner's heavy analyses → Wonder).
 */
export async function generate(body, { timeoutMs = 25000, lowThinking = false, heavy = false } = {}) {
  if (!configured()) {
    throw new Error('META_AI_API_KEY não configurada no servidor. Na Vercel: Settings → Environment Variables.')
  }
  const { messages, tools, json, info } = toChatRequest(body)
  const model = info.audio ? MODELS.audio : heavy ? MODELS.heavy : MODELS.default
  const requested = Number(body.generationConfig?.maxOutputTokens) || 0
  const payload = {
    model,
    messages,
    // Reasoning tokens count against the output limit: keep the caller's size and add room.
    ...(requested ? { max_completion_tokens: requested + 6000 } : {}),
    // Spark is tuned for the default temperature (docs); the callers' low values were for Gemini.
    reasoning_effort: heavy ? 'high' : lowThinking ? 'low' : 'medium',
  }
  if (tools.length) payload.tools = tools
  const data = await postJson('/chat/completions', payload, timeoutMs)
  const out = fromChatResponse(data, { json, model })
  out._ai.heavy = heavy
  if (info.skipped.length) out._ai.skipped = info.skipped
  return out
}

const SIZE = { '4:3': '1024x768', '16:9': '1344x768', '1:1': '1024x1024', '3:4': '768x1024' }

export async function generateImage(prompt, aspect) {
  if (!configured()) throw new Error('META_AI_API_KEY não configurada no servidor.')
  const data = await postJson('/images/generations', {
    model: MODELS.image,
    prompt,
    n: 1,
    size: SIZE[aspect] || SIZE['4:3'],
    response_format: 'b64_json',
    output_format: 'png',
  }, 55000)
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('A IA não conseguiu gerar a imagem.')
  return { data: b64, mime: 'image/png', model: MODELS.image, costUsd: PRICES[MODELS.image].perImage }
}
