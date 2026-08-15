// api/admin-ai.js
// Assistente de IA para o admin do KuriPuro. Usa Gemini com "function calling"
// pra poder consultar e alterar dados no Supabase (jobs, employees, clients,
// salary_payments, complaints, evaluations, transport_claims) a partir de
// comandos em linguagem natural.

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const ALLOWED_TABLES = [
  'employees', 'jobs', 'clients', 'salary_payments', 'complaints',
  'evaluations', 'transport_claims', 'badges', 'checkins', 'messages',
]

async function sbFetch(path, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.method && options.method !== 'GET' ? 'return=representation' : undefined,
      ...options.headers,
    },
  })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data))
  return data
}

function checkTable(table) {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Tabela "${table}" não permitida. Tabelas disponíveis: ${ALLOWED_TABLES.join(', ')}`)
  }
}

function buildQuery(filters = {}) {
  const parts = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
  return parts.join('&')
}

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'query_data',
      description: 'Busca registros de uma tabela do sistema. Use para responder perguntas sobre dados existentes.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Nome da tabela: ${ALLOWED_TABLES.join(', ')}` },
          select: { type: 'STRING', description: 'Colunas a retornar, separadas por vírgula. Use "*" para todas.' },
          filters: { type: 'OBJECT', description: 'Filtros de igualdade, ex: {"employee_id": "abc123"}' },
          limit: { type: 'NUMBER', description: 'Máximo de registros a retornar (padrão 50)' },
        },
        required: ['table'],
      },
    },
    {
      name: 'insert_data',
      description: 'Insere um novo registro em uma tabela. SEMPRE confirme com o usuário antes de chamar esta função.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Nome da tabela: ${ALLOWED_TABLES.join(', ')}` },
          data: { type: 'OBJECT', description: 'Campos e valores do novo registro' },
        },
        required: ['table', 'data'],
      },
    },
    {
      name: 'update_data',
      description: 'Atualiza registros existentes em uma tabela que combinam com os filtros. SEMPRE confirme com o usuário antes de chamar esta função.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Nome da tabela: ${ALLOWED_TABLES.join(', ')}` },
          filters: { type: 'OBJECT', description: 'Filtros de igualdade pra identificar quais registros mudar, ex: {"id": "abc123"}' },
          changes: { type: 'OBJECT', description: 'Campos e novos valores' },
        },
        required: ['table', 'filters', 'changes'],
      },
    },
    {
      name: 'delete_data',
      description: 'Apaga registros de uma tabela que combinam com os filtros. Ação PERMANENTE. SEMPRE confirme explicitamente com o usuário antes de chamar esta função.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Nome da tabela: ${ALLOWED_TABLES.join(', ')}` },
          filters: { type: 'OBJECT', description: 'Filtros de igualdade pra identificar quais registros apagar' },
        },
        required: ['table', 'filters'],
      },
    },
  ],
}]

async function executeTool(name, args) {
  if (name === 'query_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    const select = args.select || '*'
    const limit = args.limit || 50
    const path = `${args.table}?select=${select}${query ? '&' + query : ''}&limit=${limit}`
    return await sbFetch(path)
  }
  if (name === 'insert_data') {
    checkTable(args.table)
    return await sbFetch(args.table, { method: 'POST', body: JSON.stringify([args.data]) })
  }
  if (name === 'update_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    return await sbFetch(`${args.table}?${query}`, { method: 'PATCH', body: JSON.stringify(args.changes) })
  }
  if (name === 'delete_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    return await sbFetch(`${args.table}?${query}`, { method: 'DELETE' })
  }
  throw new Error(`Função desconhecida: ${name}`)
}

const SYSTEM_INSTRUCTION = `Você é o assistente de IA do painel administrativo do KuriPuro (sistema de gestão de limpeza de restaurantes/bares do grupo Umeoka).
Você tem acesso de leitura E escrita ao banco de dados via as funções query_data, insert_data, update_data e delete_data, nas tabelas: ${ALLOWED_TABLES.join(', ')}.

Regras importantes:
- Responda sempre em português.
- Para PERGUNTAS e ANÁLISES (ex: "quantos jobs o André completou essa semana", "qual funcionário tem mais reclamações"), use query_data livremente sem pedir confirmação.
- Para MUDANÇAS nos dados (insert_data, update_data, delete_data), a menos que o usuário já tenha dado uma instrução clara e específica com todos os detalhes necessários, primeiro explique em texto o que você vai fazer e peça confirmação. Só chame a função de escrita depois que o usuário confirmar explicitamente (ex: "sim", "confirma", "pode fazer").
- Nunca invente dados. Se não tiver certeza de um valor, busque com query_data primeiro.
- Ao apagar dados (delete_data), seja especialmente cauteloso — confirme exatamente quais registros serão apagados antes de agir.
- Seja direto e conciso nas respostas.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { messages } = req.body || {}
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' })
    return
  }

  try {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const toolLog = []
    let finalText = ''

    for (let iteration = 0; iteration < 6; iteration++) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents,
            tools: TOOLS,
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          }),
        }
      )
      if (!resp.ok) throw new Error(`Gemini API error: ${await resp.text()}`)
      const data = await resp.json()
      const candidate = data?.candidates?.[0]
      const parts = candidate?.content?.parts || []
      const functionCall = parts.find(p => p.functionCall)?.functionCall

      if (!functionCall) {
        finalText = parts.map(p => p.text || '').join('')
        break
      }

      contents.push({ role: 'model', parts: [functionCallPart] })

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

    res.status(200).json({ reply: finalText || '(sem resposta)', toolLog })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
