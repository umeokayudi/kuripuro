// Assistente de IA para funcionários — somente leitura dos próprios dados

import { runGeminiToolLoop } from './_tool-loop.js'
import { requireAdminSecret } from './_auth.js'

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const EMPLOYEE_TABLES = ['jobs', 'salary_payments', 'transport_claims', 'equipment_requests', 'messages', 'badges', 'checkins', 'salary_statements', 'salary_complaints', 'employee_contracts']

async function sbFetch(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) throw new Error(typeof data === 'string' ? data : JSON.stringify(data))
  return data
}

function buildQuery(filters = {}) {
  return Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&')
}

async function queryEmployeeData(employeeId, args) {
  const table = args.table
  if (!EMPLOYEE_TABLES.includes(table)) {
    throw new Error(`Tabela "${table}" não disponível. Use: ${EMPLOYEE_TABLES.join(', ')}`)
  }
  const filters = { ...(args.filters || {}), employee_id: employeeId }
  const select = (args.select || '*').replace(/password/gi, '')
  const limit = Math.min(args.limit || 30, 50)
  const query = buildQuery(filters)
  const order = table === 'jobs' ? 'scheduled_date.desc' : 'created_at.desc'
  return sbFetch(`${table}?select=${select}&${query}&limit=${limit}&order=${order}`)
}

const TOOLS = [{
  functionDeclarations: [{
    name: 'query_my_data',
    description: 'Busca registros do próprio funcionário (jobs, pagamentos, mensagens, etc).',
    parameters: {
      type: 'OBJECT',
      properties: {
        table: { type: 'STRING', description: `Tabela: ${EMPLOYEE_TABLES.join(', ')}` },
        select: { type: 'STRING', description: 'Colunas separadas por vírgula' },
        filters: { type: 'OBJECT', description: 'Filtros extras (employee_id é aplicado automaticamente)' },
        limit: { type: 'NUMBER' },
      },
      required: ['table'],
    },
  }],
}]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!requireAdminSecret(req, res)) return

  const { messages, employeeId, employeeName, language = 'en' } = req.body || {}
  if (!messages?.length || !employeeId) {
    return res.status(400).json({ error: 'messages and employeeId are required' })
  }

  const responseLanguage = language === 'ja' ? 'Japanese' : language === 'pt' ? 'Portuguese' : 'English'
  const systemInstruction = `You are the personal assistant for KuriPuro employee ${employeeName || ''}.
You may query only this employee's records (id: ${employeeId}) using query_my_data.
Available tables: ${EMPLOYEE_TABLES.join(', ')}.

Rules:
- Respond clearly and kindly in ${responseLanguage}.
- Never invent data; query with query_my_data before answering about the employee's records.
- Do not create, update, or delete records.
- Do not reveal information about other employees, clients, or administrative data.
- Help with this employee's schedule, salary and deductions, transport claims, messages, badges, and hours.
- Keep answers concise, especially for voice conversations.`

  try {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const { reply, toolLog } = await runGeminiToolLoop({
      contents,
      tools: TOOLS,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      executeTool: (_name, args) => queryEmployeeData(employeeId, args || {}),
      maxIterations: 5,
    })

    res.status(200).json({ reply, toolLog })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
