import { geminiGenerate } from './_gemini.js'

/** Gemini 3 exige devolver os parts completos (com thought_signature) no loop de tools */
export async function runGeminiToolLoop({
  contents,
  tools,
  systemInstruction,
  executeTool,
  maxIterations = 10,
  synthesizeOnEmpty = true,
}) {
  const toolLog = []
  let finalText = ''

  for (let i = 0; i < maxIterations; i++) {
    const data = await geminiGenerate({ contents, tools, systemInstruction })
    const parts = data?.candidates?.[0]?.content?.parts || []
    const functionCall = parts.find(p => p.functionCall)?.functionCall

    if (!functionCall) {
      finalText = parts.map(p => p.text || '').join('')
      break
    }

    contents.push({ role: 'model', parts })

    let toolResult
    try {
      toolResult = await executeTool(functionCall.name, functionCall.args || {})
      toolLog.push({ name: functionCall.name, args: functionCall.args, ok: true })
    } catch (err) {
      toolResult = { error: err.message }
      toolLog.push({ name: functionCall.name, args: functionCall.args, ok: false, error: err.message })
    }

    contents.push({
      role: 'user',
      parts: [{ functionResponse: { name: functionCall.name, response: { result: toolResult } } }],
    })
  }

  if (!finalText && synthesizeOnEmpty && toolLog.length) {
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
Resumo das ferramentas:\n${summary}`,
            }],
          },
        ],
        systemInstruction,
      })
      finalText = synth?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    } catch {}
  }

  if (!finalText && toolLog.some(t => !t.ok)) {
    const err = toolLog.find(t => !t.ok)
    finalText = `Não consegui concluir: ${err.error}`
  }

  return { reply: finalText || '(sem resposta)', toolLog }
}
