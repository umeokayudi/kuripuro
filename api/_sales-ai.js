// Salesperson AI — own reports, approaches, meishi photos, voice. Never other sellers.

import { runGeminiToolLoop } from './_tool-loop.js'
import { requireAdminSecret } from './_auth.js'
import { scrubAiRow } from '../src/lib/adminAiScope.js'

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const ALLOWED = ['sales_day_reports', 'sales_field_approaches']

async function sb(path, options = {}) {
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

function filtersQs(filters = {}) {
  return Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
    .join('&')
}

async function queryMine(salespersonId, args) {
  const table = args.table
  if (!ALLOWED.includes(table)) throw new Error(`Table not allowed. Use: ${ALLOWED.join(', ')}`)
  const filters = { ...(args.filters || {}), salesperson_id: salespersonId }
  const select = String(args.select || '*').replace(/password/gi, '')
  const limit = Math.min(args.limit || 40, 80)
  const qs = filtersQs(filters)
  const order = table === 'sales_day_reports' ? 'work_date.desc' : 'created_at.desc'
  return scrubAiRow(await sb(`${table}?select=${select}&${qs}&limit=${limit}&order=${order}`))
}

async function saveDayReport(salespersonId, args) {
  const hours = Number(args.hours_worked)
  const summary = String(args.summary || '').trim()
  if (!args.work_date || !(hours > 0) || summary.length < 8) {
    throw new Error('Day report needs work_date, hours_worked > 0, and a written summary')
  }
  const row = {
    salesperson_id: salespersonId,
    work_date: args.work_date,
    hours_worked: hours,
    started_at: args.started_at || null,
    ended_at: args.ended_at || null,
    areas: args.areas || '',
    summary,
    updated_at: new Date().toISOString(),
  }
  const existing = await sb(`sales_day_reports?salesperson_id=eq.${salespersonId}&work_date=eq.${encodeURIComponent(args.work_date)}&select=id&limit=1`)
  if (Array.isArray(existing) && existing[0]?.id) {
    return scrubAiRow(await sb(`sales_day_reports?id=eq.${existing[0].id}`, { method: 'PATCH', body: JSON.stringify(row) }))
  }
  return scrubAiRow(await sb('sales_day_reports', { method: 'POST', body: JSON.stringify(row) }))
}

async function saveApproach(salespersonId, args) {
  const place = String(args.place || '').trim()
  const meishi = String(args.meishi_photo_url || '').trim()
  if (!args.work_date || !place || !meishi) {
    throw new Error('Approach needs work_date, place, and meishi_photo_url (meishi photo is required)')
  }
  const row = {
    salesperson_id: salespersonId,
    work_date: args.work_date,
    place,
    company_name: args.company_name || '',
    site_name: args.site_name || '',
    contact_name: args.contact_name || '',
    contact_title: args.contact_title || '',
    contact_phone: args.contact_phone || '',
    contact_email: args.contact_email || '',
    meishi_photo_url: meishi,
    notes: args.notes || '',
    followup_note: args.followup_note || '',
    followup_date: args.followup_date || null,
    followup_status: args.followup_status || 'open',
    outcome: args.outcome || '',
  }
  return scrubAiRow(await sb('sales_field_approaches', { method: 'POST', body: JSON.stringify(row) }))
}

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'query_my_data',
      description: 'Read only this salesperson day reports or field approaches.',
      parameters: {
        type: 'OBJECT',
        properties: {
          table: { type: 'STRING', description: 'sales_day_reports or sales_field_approaches' },
          select: { type: 'STRING' },
          filters: { type: 'OBJECT' },
          limit: { type: 'NUMBER' },
        },
        required: ['table'],
      },
    },
    {
      name: 'save_day_report',
      description: 'Save today hours + written report for this salesperson only.',
      parameters: {
        type: 'OBJECT',
        properties: {
          work_date: { type: 'STRING' },
          hours_worked: { type: 'NUMBER' },
          started_at: { type: 'STRING' },
          ended_at: { type: 'STRING' },
          areas: { type: 'STRING' },
          summary: { type: 'STRING' },
        },
        required: ['work_date', 'hours_worked', 'summary'],
      },
    },
    {
      name: 'save_approach',
      description: 'Save a place approached. meishi_photo_url is required.',
      parameters: {
        type: 'OBJECT',
        properties: {
          work_date: { type: 'STRING' },
          place: { type: 'STRING' },
          company_name: { type: 'STRING' },
          site_name: { type: 'STRING' },
          contact_name: { type: 'STRING' },
          contact_title: { type: 'STRING' },
          contact_phone: { type: 'STRING' },
          contact_email: { type: 'STRING' },
          meishi_photo_url: { type: 'STRING' },
          notes: { type: 'STRING' },
          followup_note: { type: 'STRING' },
          followup_date: { type: 'STRING' },
          followup_status: { type: 'STRING' },
          outcome: { type: 'STRING' },
        },
        required: ['work_date', 'place', 'meishi_photo_url'],
      },
    },
  ],
}]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!requireAdminSecret(req, res)) return

  const { messages, salespersonId, salespersonName, image } = req.body || {}
  if (!messages?.length || !salespersonId) {
    return res.status(400).json({ error: 'messages and salespersonId are required' })
  }

  const systemInstruction = `You are the sales AI for ${salespersonName || 'this salesperson'} (id ${salespersonId}) at クリプロ.
You can ONLY see and write this person's sales_day_reports and sales_field_approaches.
Never reveal, guess, or query another salesperson.
Every field approach MUST have a meishi (business card) photo URL.
Day reports need hours worked AND a written summary of the day (places, talks, next steps).
If the user sends a meishi photo, read the card (name, title, company, restaurant/store, phone, email, address) and help fill an approach.
You may save reports and approaches when the user asks, but refuse if meishi is missing for a new approach.
Reply in the user's language (English or Japanese). Be concise and useful for field sales.`

  try {
    const contents = messages.map(m => {
      const parts = [{ text: m.content || '' }]
      if (m.image) parts.push({ inlineData: { mimeType: m.mimeType || 'image/jpeg', data: m.image } })
      return { role: m.role === 'assistant' ? 'model' : 'user', parts }
    })
    if (image && contents.length) {
      const last = contents[contents.length - 1]
      last.parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } })
    }

    const { reply, toolLog } = await runGeminiToolLoop({
      contents,
      tools: TOOLS,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      executeTool: (name, args) => {
        if (name === 'query_my_data') return queryMine(salespersonId, args || {})
        if (name === 'save_day_report') return saveDayReport(salespersonId, args || {})
        if (name === 'save_approach') return saveApproach(salespersonId, args || {})
        throw new Error(`Unknown tool ${name}`)
      },
      maxIterations: 6,
    })

    res.status(200).json({ reply, toolLog })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
