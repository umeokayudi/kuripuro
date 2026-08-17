import { geminiGenerate } from './_gemini.js'

/** Gemini 3 exige devolver os parts completos (com thought_signature) no loop de tools */
export async function runGeminiToolLoop({ contents, tools, systemInstruction, executeTool, maxIterations = 6 }) {
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

    // IMPORTANTE: passar todos os parts do model (inclui thought_signature)
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

  return { reply: finalText || '(sem resposta)', toolLog }
}
