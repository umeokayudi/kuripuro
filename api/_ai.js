// v1.0.212 · The ONE place the server talks to an AI provider.
//
// Every route (admin AI, employee AI, sales AI, photo/report/contract analysis, 作業報告書,
// 提案書, Google Agenda drafts, voice transcription, quote minimum…) calls aiGenerate() or
// aiGenerateImage() from here. No screen and no other file calls a provider directly, and
// no AI key ever reaches the browser: this runs only in Vercel Functions.
//
// Which provider answers is decided by the server env var AI_PROVIDER:
//   AI_PROVIDER=gemini  (default while unset)  → api/_ai-gemini.js  (GEMINI_API_KEY)
//   AI_PROVIDER=muse                           → Meta Model API (META_AI_API_KEY) — section 2
// Switching provider = changing that variable in Vercel and redeploying. Nothing else.
//
// The request/response shape used by the callers stays the one they already use
// ({ contents, systemInstruction, tools, generationConfig } → { candidates[0].content.parts }),
// so the data plumbing (DB lookups, tools, prompts, screens) does not change. A provider that
// speaks another format translates inside its own file.
import * as gemini from './_ai-gemini.js'

export const API_BUILD = '2026-11-12-v1.0.212'

const PROVIDERS = { gemini }
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

/**
 * Text / JSON / tool-call generation.
 * body: { contents, systemInstruction?, tools?, generationConfig? }  (current shape)
 * options.timeoutMs: max time for one call. options.lowThinking: ask for brief reasoning.
 * options.heavy: owner's heavy analyses (the provider may pick a stronger model).
 */
export async function aiGenerate(body, options = {}) {
  return provider().generate(body, options)
}

/** Image generation (提案書 photos). Returns { data: base64, mime, model }. */
export async function aiGenerateImage(prompt, aspect) {
  const p = provider()
  if (!p.generateImage) throw new Error('O provedor de IA ativo não gera imagens.')
  return p.generateImage(prompt, aspect)
}
