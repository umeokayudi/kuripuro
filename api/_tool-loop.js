import { geminiGenerate } from './_gemini.js'

// Vercel stops a function at 60 s (vercel.json maxDuration). The loop keeps its own
// budget below that so it can still answer with what it found instead of being killed.
const DEFAULT_BUDGET_MS = 52000
const MAX_CALL_MS = 25000
const MIN_CALL_MS = 5000

/** Gemini 3 exige devolver os parts completos (com thought_signature) no loop de tools */
export async function runGeminiToolLoop({
  contents,
  tools,
  systemInstruction,
  executeTool,
  maxIterations = 10,
  synthesizeOnEmpty = true,
  budgetMs = DEFAULT_BUDGET_MS,
  canContinue = false,
}) {
  const deadline = Date.now() + budgetMs
  const callTimeout = () => Math.min(MAX_CALL_MS, deadline - Date.now())
  const toolLog = []
  let finalText = ''
  let outOfTime = false

  for (let i = 0; i < maxIterations; i++) {
    if (callTimeout() < MIN_CALL_MS) { outOfTime = true; break }
    let data
    try {
      data = await geminiGenerate({ contents, tools, systemInstruction }, { timeoutMs: callTimeout(), lowThinking: true })
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
      break
    }

    contents.push({ role: 'model', parts })

    // Gemini often asks for several lookups at once (an employee, a client, a contract).
    // Answer all of them in one round: answering only the first made it ask again, one
    // model round trip per lookup, which is what pushed long requests past the time limit.
    const responses = await Promise.all(functionCalls.map(async functionCall => {
      let toolResult
      try {
        toolResult = await executeTool(functionCall.name, functionCall.args || {})
        toolLog.push({ name: functionCall.name, args: functionCall.args, ok: true })
      } catch (err) {
        toolResult = { error: err.message }
        toolLog.push({ name: functionCall.name, args: functionCall.args, ok: false, error: err.message })
      }
      return { functionResponse: { name: functionCall.name, response: { result: toolResult } } }
    }))

    contents.push({ role: 'user', parts: responses })
  }

  // Out of time with lookups done: hand the work back so the next request carries on from
  // here (the browser sends it on its own) instead of asking the person to split the request.
  if (!finalText && outOfTime && canContinue && toolLog.length) {
    return { reply: '', toolLog, incomplete: true }
  }

  if (!finalText && synthesizeOnEmpty && toolLog.length && callTimeout() >= MIN_CALL_MS) {
    const failed = toolLog.filter(t => !t.ok)
    const summary = toolLog.map(t =>
      `${t.ok ? '✓' : '✗'} ${t.name}${t.error ? `: ${t.error}` : ''}`
    ).join('\n')

    try {
      const synth = await geminiGenerate({
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
      }, { timeoutMs: callTimeout(), lowThinking: true })
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

  return { reply: finalText || '(sem resposta)', toolLog }
}
