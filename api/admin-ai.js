// api/admin-ai.js
// Assistente de IA para o admin do KuriPuro. Lê o sistema inteiro via PostgREST.

import { API_BUILD } from './_gemini.js'
import { runGeminiToolLoop } from './_tool-loop.js'
import { requireAdminSecret } from './_auth.js'
import { ADMIN_AI_TABLE_GUIDE, ADMIN_AI_TABLES, scrubAiRow } from '../src/lib/adminAiScope.js'

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const ALLOWED_TABLES = ADMIN_AI_TABLES

async function sbFetch(path, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.headers?.Prefer || (options.method && options.method !== 'GET' ? 'return=representation' : undefined),
      ...options.headers,
    },
  })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data))
  return { data, headers: resp.headers }
}

function checkTable(table) {
  if (!ALLOWED_TABLES.includes(table)) {
    throw new Error(`Tabela "${table}" não permitida. Tabelas: ${ALLOWED_TABLES.join(', ')}`)
  }
}

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
      name: 'list_tables',
      description: 'Lista todas as tabelas do sistema que você pode ler. Use primeiro se não souber onde está um dado.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'query_data',
      description: 'Lê registros de qualquer tabela do sistema. Para nomes parciais use ilike, ex: {"full_name":{"op":"ilike","value":"%leticia%"}}',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: `Tabela: ${ALLOWED_TABLES.join(', ')}` },
          select: { type: 'STRING', description: 'Colunas ou "*"' },
          filters: { type: 'OBJECT', description: 'Filtros eq ou {op,value}' },
          order: { type: 'STRING', description: 'ex: scheduled_date.desc' },
          limit: { type: 'NUMBER', description: 'Máximo (padrão 80, máx 200)' },
        },
        required: ['table'],
      },
    },
    {
      name: 'count_data',
      description: 'Conta registros de uma tabela com filtros. Use para totais (jobs hoje, faturas abertas, etc).',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING' },
          filters: { type: 'OBJECT' },
        },
        required: ['table'],
      },
    },
    {
      name: 'record_salary_advance',
      description: 'Registra um adiantamento em salary_payments SOMENTE depois que o admin confirmar. Nunca chame na primeira mensagem. Primeiro busque o funcionário, mostre nome + valor + data + período, espere o sim, e só então chame com confirmed=true.',
      parameters: {
        type: 'OBJECT',
        properties: {
          employee_id: { type: 'STRING', description: 'UUID do employees.id' },
          employee_name: { type: 'STRING' },
          amount: { type: 'NUMBER', description: 'Valor em ienes' },
          payment_date: { type: 'STRING', description: 'YYYY-MM-DD (Tóquio)' },
          period: { type: 'STRING', description: 'YYYY-MM; padrão = mês da payment_date' },
          description: { type: 'STRING' },
          confirmed: { type: 'BOOLEAN', description: 'true só depois do admin confirmar os dados' },
        },
        required: ['employee_id', 'amount', 'payment_date', 'confirmed'],
      },
    },
    {
      name: 'insert_data',
      description: 'Insere registro(s). Confirme com o usuário antes de criar em massa.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING' },
          data: { type: 'OBJECT', description: 'Campos, ou { rows: [...] }' },
        },
        required: ['table', 'data'],
      },
    },
    {
      name: 'update_data',
      description: 'Atualiza registros. Confirme antes.',
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
      description: 'Apaga registros. Permanente — confirme antes.',
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
  if (name === 'list_tables') {
    return { tables: ALLOWED_TABLES, guide: ADMIN_AI_TABLE_GUIDE }
  }
  if (name === 'query_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    const select = encodeURIComponent(args.select || '*')
    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 80, 1), 200)
    const order = args.order ? `&order=${encodeURIComponent(args.order)}` : ''
    const path = `${args.table}?select=${select}${query ? '&' + query : ''}${order}&limit=${limit}`
    const { data } = await sbFetch(path)
    return scrubAiRow(data)
  }
  if (name === 'count_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    const path = `${args.table}?select=id${query ? '&' + query : ''}`
    const { headers } = await sbFetch(path, {
      headers: { Prefer: 'count=exact', Range: '0-0' },
    })
    const cr = headers.get('content-range') || ''
    const total = cr.includes('/') ? Number(cr.split('/')[1]) : null
    return { table: args.table, count: Number.isFinite(total) ? total : null, contentRange: cr }
  }
  if (name === 'record_salary_advance') {
    const amount = Number(args.amount)
    const payment_date = String(args.payment_date || '').slice(0, 10)
    const period = String(args.period || payment_date.slice(0, 7)).slice(0, 7)
    const description = args.description || 'Advance payment'
    const preview = {
      employee_id: args.employee_id,
      employee_name: args.employee_name || '',
      amount,
      payment_date,
      period,
      description,
    }
    if (!args.confirmed) {
      return {
        needs_confirmation: true,
        message: 'Mostre estes dados ao admin e só chame de novo com confirmed=true após o sim.',
        preview,
      }
    }
    if (!args.employee_id || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(payment_date) || !/^\d{4}-\d{2}$/.test(period)) {
      throw new Error('record_salary_advance exige employee_id, amount > 0, payment_date YYYY-MM-DD e confirmed=true')
    }
    const dupQuery = `salary_payments?select=id,amount,payment_date,employee_name,period,description&employee_id=eq.${encodeURIComponent(args.employee_id)}&payment_type=eq.advance&payment_date=eq.${payment_date}&amount=eq.${amount}&limit=5`
    const { data: existing } = await sbFetch(dupQuery)
    if (Array.isArray(existing) && existing.length) {
      return { skipped_duplicate: true, existing: scrubAiRow(existing) }
    }
    const row = {
      employee_id: args.employee_id,
      employee_name: args.employee_name || '',
      period,
      amount,
      payment_date,
      description,
      payment_type: 'advance',
      status: 'scheduled',
      is_deduction: false,
    }
    const { data } = await sbFetch('salary_payments', { method: 'POST', body: JSON.stringify([row]) })
    return { inserted: true, row: scrubAiRow(data) }
  }
  if (name === 'insert_data') {
    checkTable(args.table)
    const rows = args.data?.rows
    if (Array.isArray(rows) && rows.length) {
      const { data } = await sbFetch(args.table, { method: 'POST', body: JSON.stringify(rows) })
      return scrubAiRow(data)
    }
    const { data } = await sbFetch(args.table, { method: 'POST', body: JSON.stringify([args.data]) })
    return scrubAiRow(data)
  }
  if (name === 'update_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    if (!query) throw new Error('update_data exige filters')
    const { data } = await sbFetch(`${args.table}?${query}`, { method: 'PATCH', body: JSON.stringify(args.changes) })
    return scrubAiRow(data)
  }
  if (name === 'delete_data') {
    checkTable(args.table)
    const query = buildQuery(args.filters)
    if (!query) throw new Error('delete_data exige filters')
    const { data } = await sbFetch(`${args.table}?${query}`, { method: 'DELETE' })
    return scrubAiRow(data)
  }
  throw new Error(`Função desconhecida: ${name}`)
}

const SYSTEM_INSTRUCTION = `Você é a IA central do KuriPuro (limpeza de restaurantes/bares no Japão). Esta tela é a área exclusiva de IA do admin: você PODE e DEVE consultar o banco para responder.
Tabelas: ${ALLOWED_TABLES.join(', ')}.
Guia: ${ADMIN_AI_TABLE_GUIDE}

Regras:
- Responda no idioma do usuário (português, japonês ou inglês).
- Nunca invente números. Sempre use query_data e/ou count_data. Se a tabela não existir (erro PGRST205), diga que o SQL ainda não foi aplicado.
- Para visão geral, use count_data e depois query_data nas linhas relevantes.
- Nomes parciais: ilike {"full_name":{"op":"ilike","value":"%nome%"}} ou company_name.
- Jobs: status assigned / in_progress / completed / cancelled. Datas YYYY-MM-DD (Tóquio).
- Faturas: faturas + fatura_items. Status draft/sent/paid/cancelled.
- Comercial: sales_leads, mitsumori, mitsumori_items, sales_touchpoints. interest é INTERNO (não vai no PDF da 見積書).
- Folha: salary_payments (adiantamentos e salário), payroll (fechamento). salary_periods/salary_statements podem não existir — use payroll.
- Adiantamento: NUNCA grave na primeira mensagem. 1) query employees pelo nome, 2) mostre employee_name, amount, payment_date (YYYY-MM-DD Tóquio) e period (YYYY-MM), 3) espere o admin confirmar, 4) record_salary_advance com confirmed=true. Não use insert_data para adiantamento. Se faltar data ou valor, pergunte. period = mês da payment_date. Evite duplicar o mesmo employee_id+data+valor.
- Fechamento de salário: o admin fecha em Payroll Close; a IA não inventa totais. Se pedir holerite, cite cada adiantamento com data e valor.
- Nunca mostre senhas ou password_hash. Pode falar de salário, contratos, interesse do cliente, reclamações.
- Para CRIAR jobs: busque employee_id em employees; insert_data em jobs com title, employee_id, employee_name, scheduled_date, scheduled_time, status "assigned", address.
- Mudanças (insert/update/delete): se o pedido for claro, execute; se ambíguo, confirme. Adiantamento sempre confirma.
- Seja direto. Cite as tabelas que usou. No final, resuma.`

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      api: 'admin-ai',
      build: API_BUILD,
      geminiKey: !!process.env.GEMINI_API_KEY,
      tables: ALLOWED_TABLES,
    })
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!requireAdminSecret(req, res)) return

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
      maxIterations: 16,
    })

    res.status(200).json({ reply, toolLog })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
