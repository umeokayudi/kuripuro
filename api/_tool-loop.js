import { aiGenerate, aiCanEscalate } from './_ai.js'

// Vercel stops a function at 60 s (vercel.json maxDuration). The loop keeps its own
// budget below that so it can still answer with what it found instead of being killed.
const DEFAULT_BUDGET_MS = 52000
const MAX_CALL_MS = 25000
const MAX_HEAVY_CALL_MS = 45000 // the heavy model (Muse Wonder) thinks longer
const MIN_CALL_MS = 5000

// Numbers in an answer given without a single lookup are most likely made up.
const STATES_NUMBERS = /[¥￥$]\s?\d|\d[\d.,]*\s?(円|yen|ienes|reais|horas?|h\b|%|jobs?|serviços?|clientes?|lojas?)|\b\d{3,}\b/i

/** Adds one call's usage/cost to the running total for this conversation turn. */
function addUsage(total, data) {
  const m = data?._ai
  if (!m) return
  total.provider = m.provider
  total.model = m.model || total.model
  total.calls += 1
  total.inputTokens += m.usage?.inputTokens || 0
  total.cachedTokens += m.usage?.cachedTokens || 0
  total.outputTokens += m.usage?.outputTokens || 0
  if (m.costUsd != null) total.costUsd = (total.costUsd || 0) + m.costUsd
  if (m.heavy) total.heavyCalls += 1
  if (m.escalated) total.escalated.push(m.escalated)
  if (m.skipped) total.skipped.push(...m.skipped)
}

/** Gemini 3 exige devolver os parts completos (com thought_signature) no loop de tools */
export async function runToolLoop({
  contents,
  tools,
  systemInstruction,
  executeTool,
  maxIterations = 10,
  synthesizeOnEmpty = true,
  budgetMs = DEFAULT_BUDGET_MS,
  canContinue = false,
  heavy = false,
}) {
  const deadline = Date.now() + budgetMs
  const callTimeout = () => Math.min(heavy ? MAX_HEAVY_CALL_MS : MAX_CALL_MS, deadline - Date.now())
  const toolLog = []
  let finalText = ''
  let outOfTime = false
  let escalatedForNumbers = false
  const usage = { provider: null, model: null, calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: null, heavyCalls: 0, escalated: [], skipped: [] }

  for (let i = 0; i < maxIterations; i++) {
    if (callTimeout() < MIN_CALL_MS) { outOfTime = true; break }
    let data
    try {
      data = await aiGenerate({ contents, tools, systemInstruction }, { timeoutMs: callTimeout(), lowThinking: !heavy, heavy })
      addUsage(usage, data)
    } catch (err) {
      // Lookups already done are worth an answer; with nothing done yet, report the error.
      if (!toolLog.length) throw err
      outOfTime = true
      break
    }
    const parts = data?.candidates?.[0]?.content?.parts || []
    const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall)

    if (!functionCalls.length) {
      finalText = parts.map(p => p.text || '').join('')
      // Owner's rule: the default model answered with numbers without looking anything up →
      // the same question goes once to the heavy model, which must use the tools.
      if (!heavy && !escalatedForNumbers && !toolLog.length && tools?.length && aiCanEscalate()
        && STATES_NUMBERS.test(finalText) && callTimeout() >= 15000) {
        escalatedForNumbers = true
        try {
          const retry = await aiGenerate({ contents, tools, systemInstruction }, { timeoutMs: callTimeout(), heavy: true })
          addUsage(usage, retry)
          usage.escalated.push('números sem consultar o banco')
          const retryParts = retry?.candidates?.[0]?.content?.parts || []
          if (retryParts.some(p => p.functionCall)) { heavy = true; data = retry; parts.length = 0; parts.push(...retryParts) }
          else { finalText = retryParts.map(p => p.text || '').join('') || finalText; break }
        } catch { break }
        if (!parts.some(p => p.functionCall)) break
      } else break
    }
    const calls = parts.filter(p => p.functionCall).map(p => p.functionCall)

    contents.push({ role: 'model', parts })

    // Gemini often asks for several lookups at once (an employee, a client, a contract).
    // Answer all of them in one round: answering only the first made it ask again, one
    // model round trip per lookup, which is what pushed long requests past the time limit.
    const responses = await Promise.all(calls.map(async functionCall => {
      let toolResult
      try {
        toolResult = await executeTool(functionCall.name, functionCall.args || {})
        toolLog.push({ name: functionCall.name, args: functionCall.args, ok: true })
      } catch (err) {
        toolResult = { error: err.message }
        toolLog.push({ name: functionCall.name, args: functionCall.args, ok: false, error: err.message })
      }
      return { functionResponse: { ...(functionCall.id ? { id: functionCall.id } : {}), name: functionCall.name, response: { result: toolResult } } }
    }))

    contents.push({ role: 'user', parts: responses })
  }

  // Out of time with lookups done: hand the work back so the next request carries on from
  // here (the browser sends it on its own) instead of asking the person to split the request.
  if (!finalText && outOfTime && canContinue && toolLog.length) {
    return { reply: '', toolLog, incomplete: true, usage }
  }

  if (!finalText && synthesizeOnEmpty && toolLog.length && callTimeout() >= MIN_CALL_MS) {
    const failed = toolLog.filter(t => !t.ok)
    const summary = toolLog.map(t =>
      `${t.ok ? '✓' : '✗'} ${t.name}${t.error ? `: ${t.error}` : ''}`
    ).join('\n')

    try {
      const synth = await aiGenerate({
        contents: [
          ...contents,
          {
            role: 'user',
            parts: [{
              text: `Com base nas ferramentas executadas acima, responda ao usuário em português de forma clara e completa.
${failed.length ? `Algumas consultas falharam:\n${failed.map(f => `- ${f.name}: ${f.error}`).join('\n')}\nUse os dados que funcionaram e explique o que faltou.` : ''}
${outOfTime ? 'O tempo para esta resposta acabou antes de terminar. Diga o que já foi encontrado ou proposto e o que ainda falta, e peça para o usuário mandar "continue".\n' : ''}Resumo das ferramentas:\n${summary}`,
            }],
          },
        ],
        systemInstruction,
      }, { timeoutMs: callTimeout(), lowThinking: !heavy, heavy })
      addUsage(usage, synth)
      finalText = synth?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    } catch {}
  }

  if (!finalText && toolLog.some(t => !t.ok)) {
    const err = toolLog.find(t => !t.ok)
    finalText = `Não consegui concluir: ${err.error}`
  }

  if (!finalText && outOfTime) {
    finalText = 'Este pedido levou mais tempo do que o limite. Mande "continue" para eu seguir de onde parei.'
  }

  return { reply: finalText || '(sem resposta)', toolLog, usage }
}
