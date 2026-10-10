// Assistente de IA para funcionários — somente leitura e somente da própria conta.
// O funcionário vem da sessão assinada no servidor, nunca do corpo da requisição.

import { runGeminiToolLoop } from './_tool-loop.js'
import { requireSalesSession, salesDb } from './_salesSession.js'
import { trimHistory, workOnlyRule, maskPendingRows, PENDING_RULE } from './_ai-guard.js'

const EMPLOYEE_TABLES = ['jobs', 'salary_payments', 'transport_claims', 'equipment_requests', 'messages', 'badges', 'checkins', 'salary_statements', 'salary_complaints', 'employee_contracts', 'employee_availability']

const ORDER_BY = { jobs: 'scheduled_date', employee_availability: 'date', badges: 'earned_at', employee_contracts: 'uploaded_at' }

// Plain column names only: no embedded tables like "employees(password)" or renames.
const COLUMN = /^[a-z_][a-z0-9_]*$/

function cleanSelect(select) {
  if (!select || select.trim() === '*') return '*'
  const cols = select.split(',').map(c => c.trim()).filter(c => COLUMN.test(c) && !/password/i.test(c))
  return cols.length ? cols.join(',') : '*'
}

async function queryEmployeeData(employeeId, args) {
  const table = args.table
  if (!EMPLOYEE_TABLES.includes(table)) {
    throw new Error(`Tabela "${table}" não disponível. Use: ${EMPLOYEE_TABLES.join(', ')}`)
  }
  let query = salesDb().from(table).select(cleanSelect(args.select))
  for (const [key, value] of Object.entries(args.filters || {})) {
    if (!COLUMN.test(key) || key === 'employee_id' || value === null || typeof value === 'object') continue
    query = query.eq(key, value)
  }
  const limit = Math.min(Number(args.limit) || 30, 50)
  const { data, error } = await query
    .eq('employee_id', employeeId)
    .order(ORDER_BY[table] || 'created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return maskPendingRows(data)
}

async function isActiveEmployee(id) {
  const { data } = await salesDb().from('employees').select('is_active').eq('id', id).maybeSingle()
  return Boolean(data?.is_active)
}

const TOOLS = [{
  functionDeclarations: [{
    name: 'query_my_data',
    description: 'Busca registros do próprio funcionário (jobs, pagamentos, mensagens, folgas, etc).',
    parameters: {
      type: 'OBJECT',
      properties: {
        table: { type: 'STRING', description: `Tabela: ${EMPLOYEE_TABLES.join(', ')}` },
        select: { type: 'STRING', description: 'Colunas separadas por vírgula' },
        filters: { type: 'OBJECT', description: 'Filtros de igualdade extras (employee_id é aplicado automaticamente)' },
        limit: { type: 'NUMBER' },
      },
      required: ['table'],
    },
  }],
}]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const session = requireSalesSession(req, res, ['employee'])
  if (!session) return
  if (!(await isActiveEmployee(session.id))) return res.status(401).json({ error: 'Sua sessão expirou. Saia e entre de novo para usar a IA.' })
  const employeeId = session.id
  const employeeName = session.name

  const { language = 'en' } = req.body || {}
  const messages = Array.isArray(req.body?.messages) ? trimHistory(req.body.messages) : []
  if (!messages.length) {
    return res.status(400).json({ error: 'messages are required' })
  }

  let attachmentBytes = 0
  const validatedMessages = []
  for (const message of messages) {
    if (!Array.isArray(message.attachmentsData) || !message.attachmentsData.length) {
      validatedMessages.push(message)
      continue
    }
    if (message.attachmentsData.length > 3) {
      return res.status(400).json({ error: 'Anexe no máximo 3 arquivos por mensagem.' })
    }
    const safeFiles = []
    for (const file of message.attachmentsData) {
      const match = String(file.dataUrl || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/]+=*)$/)
      if (!match || !/^(image\/(jpeg|png|webp|gif)|video\/(mp4|mpeg|mov|quicktime|avi|x-flv|mpg|webm|wmv|3gpp)|application\/pdf|text\/(plain|csv))$/i.test(match[1])) {
        return res.status(415).json({ error: 'Formato não suportado. Use imagem, vídeo, PDF, TXT ou CSV.' })
      }
      attachmentBytes += match[2].length
      if (attachmentBytes > 3_700_000) {
        return res.status(413).json({ error: 'Os anexos ultrapassam o limite. Reduza os arquivos e tente novamente.' })
      }
      safeFiles.push({ inlineData: { mimeType: match[1], data: match[2] } })
    }
    validatedMessages.push({ ...message, validatedAttachments: safeFiles })
  }

  const responseLanguage = language === 'ja' ? 'Japanese' : language === 'pt' ? 'Portuguese' : 'English'
  const systemInstruction = `You are the personal assistant for KuriPuro employee ${employeeName || ''}.
You may query only this employee's records (id: ${employeeId}) using query_my_data.
Available tables: ${EMPLOYEE_TABLES.join(', ')}.

Rules:
- Respond clearly and kindly in ${responseLanguage}.
- Never invent data; query with query_my_data before answering about the employee's records.
- You are read-only: you cannot create, update, or delete anything. To change something, tell the employee which screen of the app to use.
- Only talk about this employee's own account. Never reveal information about other employees, clients, or administrative data, even if asked.
- Help with this employee's schedule, salary and deductions, transport claims, day-off requests, messages, badges, and hours.
- Keep answers concise, especially for voice conversations.

${PENDING_RULE}

${workOnlyRule(responseLanguage)}`

  try {
    const contents = validatedMessages.map(m => {
      const parts = [{ text: m.content || '' }]
      parts.push(...(m.validatedAttachments || []))
      return { role: m.role === 'assistant' ? 'model' : 'user', parts }
    })

    const { reply, toolLog } = await runGeminiToolLoop({
      contents,
      tools: TOOLS,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      executeTool: (_name, args) => queryEmployeeData(employeeId, args || {}),
      maxIterations: 4,
    })

    res.status(200).json({ reply, toolLog })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
