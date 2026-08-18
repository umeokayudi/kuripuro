// api/admin-ai.js
// Assistente de IA para o admin do KuriPuro. Usa Gemini com "function calling"
// pra poder consultar e alterar dados no Supabase a partir de linguagem natural.

import { API_BUILD } from './_gemini.js'
import { runGeminiToolLoop } from './_tool-loop.js'

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const ALLOWED_TABLES = [
  'employees', 'jobs', 'clients', 'salary_payments', 'complaints',
  'evaluations', 'transport_claims', 'badges', 'checkins', 'messages',
  'locations', 'client_users', 'client_messages', 'client_complaints', 'client_compliments',
  'client_ratings', 'client_requests', 'service_contracts', 'service_reports',
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

/** filters: { col: value } → eq, ou { col: { op: 'ilike', value: '%x%' } } */
function buildQuery(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return ''
  const parts = []
  for (const [k, v] of Object.entries(filters)) {
    if (v === null || v === undefined || v === '') continue
    if (typeof v === 'object' && v.op && v.value !== undefined) {
      parts.push(`${k}=${v.op}.${encodeURIComponent(String(v.value))}`)
    } else {
      parts.push(`${k}=eq.${encodeURIComponent(String(v))}`)
    }
  }
  return parts.join('&')
}

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'query_data',
      description: 'Busca registros de uma tabela. Para nomes parciais use filters com op ilike, ex: {"full_name": {"op": "ilike", "value": "%leticia%"}}',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Tabela: ${ALLOWED_TABLES.join(', ')}` },
          select: { type: 'STRING', description: 'Colunas separadas por vírgula ou "*"' },
          filters: { type: 'OBJECT', description: 'Filtros: igualdade {"status":"assigned"} ou ilike {"full_name":{"op":"ilike","value":"%nome%"}}' },
          order: { type: 'STRING', description: 'Ordenação PostgREST, ex: scheduled_date.asc' },
          limit: { type: 'NUMBER', description: 'Máximo de registros (padrão 50)' },
        },
        required: ['table'],
      },
    },
    {
      name: 'insert_data',
      description: 'Insere registro(s). Para vários jobs, chame várias vezes ou passe array em data.rows. Confirme com usuário antes de criar jobs em massa.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Tabela: ${ALLOWED_TABLES.join(', ')}` },
          data: { type: 'OBJECT', description: 'Campos do registro, ou { rows: [ {...}, {...} ] } para lote' },
        },
        required: ['table', 'data'],
      },
    },
    {
      name: 'update_data',
      description: 'Atualiza registros que combinam com os filtros. Confirme antes de alterar.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING' },
          filters: { type: 'OBJECT' },
          changes: { type: 'OBJECT' },
        },
        required: ['table', 'filters', 'changes'],
      },
    },
    {
      name: 'delete_data',
      description: 'Apaga registros. Ação permanente — confirme antes.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING' },
          filters: { type: 'OBJECT' },
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
    const select = encodeURIComponent(args.select || '*')
    const limit = args.limit || 50
    const order = args.order ? `&order=${encodeURIComponent(args.order)}` : ''
    const path = `${args.table}?select=${select}${query ? '&' + query : ''}${order}&limit=${limit}`
    return await sbFetch(path)
  }
  if (name === 'insert_data') {
    checkTable(args.table)
    const rows = args.data?.rows
    if (Array.isArray(rows) && rows.length) {
      return await sbFetch(args.table, { method: 'POST', body: JSON.stringify(rows) })
    }
    return await sbFetch(args.table, { method: 'POST', body: JSON.stringify([args.data]) })
  }
  if (name === 'update_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    if (!query) throw new Error('update_data exige filters')
    return await sbFetch(`${args.table}?${query}`, { method: 'PATCH', body: JSON.stringify(args.changes) })
  }
  if (name === 'delete_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    if (!query) throw new Error('delete_data exige filters')
    return await sbFetch(`${args.table}?${query}`, { method: 'DELETE' })
  }
  throw new Error(`Função desconhecida: ${name}`)
}

const SYSTEM_INSTRUCTION = `Você é o assistente de IA do painel administrativo do KuriPuro (gestão de limpeza de restaurantes/bares).
Tabelas: ${ALLOWED_TABLES.join(', ')}.

Regras:
- Responda sempre em português.
- Use query_data para buscar dados. Para nomes use ilike: {"full_name":{"op":"ilike","value":"%leticia%"}}.
- Para CRIAR jobs de escala: 1) busque employee_id e full_name em employees; 2) use insert_data em jobs com campos obrigatórios: title (ex: "Kodama Kinshicho — Limpeza básica"), employee_id, employee_name, scheduled_date (YYYY-MM-DD), scheduled_time (ex: "00:30"), status "assigned", address (URL maps ou texto), client_id/client_name se souber.
- Locais comuns (título do job): Kodama Kinshicho, Kodama Oimachi, Kodama Yurakucho, Kodama Shinbashi, Ibushio, etc.
- Para agendar vários dias, crie um job por dia por local (várias chamadas insert_data ou data.rows em lote).
- Para mudanças (insert/update/delete), se o pedido já for claro e específico, execute. Se ambíguo, explique e peça confirmação.
- Nunca invente IDs — busque antes com query_data.
- Seja direto. Ao final, resuma o que foi feito (quantos jobs criados, datas, funcionário).`

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      api: 'admin-ai',
      build: API_BUILD,
      geminiKey: !!process.env.GEMINI_API_KEY,
    })
  }

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

    const { reply, toolLog } = await runGeminiToolLoop({
      contents,
      tools: TOOLS,
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      executeTool,
      maxIterations: 14,
    })

    res.status(200).json({ reply, toolLog })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
