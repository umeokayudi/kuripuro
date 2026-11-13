// v1.0.212 · The ONE place the server talks to an AI provider.
//
// Every route (admin AI, employee AI, sales AI, photo/report/contract analysis, 作業報告書,
// 提案書, Google Agenda drafts, voice transcription, quote minimum…) calls aiGenerate() or
// aiGenerateImage() from here. No screen and no other file calls a provider directly, and
// no AI key ever reaches the browser: this runs only in Vercel Functions.
//
// Which provider answers is decided by the server env var AI_PROVIDER:
//   AI_PROVIDER=gemini  (default while unset)  → api/_ai-gemini.js  (GEMINI_API_KEY)
//   AI_PROVIDER=muse                           → api/_ai-muse.js   (META_AI_API_KEY)
// Switching provider = changing that variable in Vercel and redeploying. Nothing else.
//
// The request/response shape used by the callers stays the one they already use
// ({ contents, systemInstruction, tools, generationConfig } → { candidates[0].content.parts }),
// so the data plumbing (DB lookups, tools, prompts, screens) does not change. A provider that
// speaks another format translates inside its own file.
import * as gemini from './_ai-gemini.js'
import * as muse from './_ai-muse.js'

export const API_BUILD = '2026-11-12-v1.0.212'

const PROVIDERS = { gemini, muse }
const KNOWN = ['gemini', 'muse']

/** The provider name chosen in AI_PROVIDER (lowercase), 'gemini' when unset. */
export function aiProviderName() {
  return String(process.env.AI_PROVIDER || 'gemini').trim().toLowerCase() || 'gemini'
}

function provider() {
  const name = aiProviderName()
  if (!KNOWN.includes(name)) {
    throw new Error(`AI_PROVIDER="${name}" não existe. Use gemini ou muse nas variáveis da Vercel.`)
  }
  const p = PROVIDERS[name]
  if (!p) throw new Error(`O provedor de IA "${name}" ainda não está ligado nesta versão.`)
  return p
}

/** True when the active provider has its key on the server. */
export function aiConfigured() {
  try { return provider().configured() } catch { return false }
}

/** For /api/version and the owner's settings: which provider/model is active (never the key). */
export function aiStatus() {
  const name = aiProviderName()
  let p = null
  try { p = provider() } catch {}
  return {
    provider: name,
    configured: !!p && p.configured(),
    model: p?.modelLabel ? p.modelLabel() : null,
  }
}

/** True when the active provider has a stronger model to escalate to (Muse: Wonder). */
export function aiCanEscalate() {
  try { return !!provider().canEscalate } catch { return false }
}

function hasAnswer(data) {
  const parts = data?.candidates?.[0]?.content?.parts || []
  return parts.some(p => p.functionCall || (typeof p.text === 'string' && p.text.trim()))
}

/** Every result carries _ai: { provider, model, usage, costUsd, heavy, escalated }. */
function withMeta(data, name) {
  if (data && !data._ai) {
    const u = data.usageMetadata || {}
    data._ai = {
      provider: name,
      model: data.modelVersion || null,
      usage: { inputTokens: u.promptTokenCount || 0, cachedTokens: u.cachedContentTokenCount || 0, outputTokens: u.candidatesTokenCount || 0 },
      costUsd: null,
    }
  }
  return data
}

/**
 * Text / JSON / tool-call generation.
 * body: { contents, systemInstruction?, tools?, generationConfig? }  (current shape)
 * options.timeoutMs: max time for one call. options.lowThinking: ask for brief reasoning.
 * options.heavy: owner's heavy analyses (Muse: muse-wonder-1.0 instead of muse-spark-1.3).
 * Owner's rule (2026-11-13): when the default model comes back empty or cut off, the same
 * request goes up to the heavy model on its own, once.
 */
export async function aiGenerate(body, options = {}) {
  const p = provider()
  const first = withMeta(await p.generate(body, options), p.name)
  if (!p.canEscalate || options.heavy || options.noEscalate || hasAnswer(first)) return first
  const started = Date.now()
  try {
    const second = withMeta(await p.generate(body, { ...options, heavy: true }), p.name)
    second._ai.escalated = 'resposta vazia ou cortada'
    second._ai.costUsd = (second._ai.costUsd || 0) + (first._ai.costUsd || 0)
    second._ai.escalateMs = Date.now() - started
    return second
  } catch {
    return first
  }
}

/** Image generation (提案書 photos). Returns { data: base64, mime, model }. */
export async function aiGenerateImage(prompt, aspect) {
  const p = provider()
  if (!p.generateImage) throw new Error('O provedor de IA ativo não gera imagens.')
  return p.generateImage(prompt, aspect)
}
