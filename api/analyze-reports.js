// api/analyze-reports.js — IA analisa relatórios de serviço (tempo, padrões, metas)

import { geminiGenerate } from './_gemini.js'

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

function durationMin(job) {
  if (job.retro_time_min) return Number(job.retro_time_min)
  if (job.started_at && job.completed_at) {
    const ms = new Date(job.completed_at) - new Date(job.started_at)
    if (ms > 0) return Math.round(ms / 60000)
  }
  return null
}

function compactJob(j) {
  const dur = durationMin(j)
  return {
    funcionario: j.employee_name,
    local: j.title,
    data: j.scheduled_date,
    tipo: j.retro_report ? 'retroativo' : 'ao_vivo',
    duracao_min: dur,
    checklist: j.checklist_total ? `${j.checklist_done || 0}/${j.checklist_total}` : null,
    itens_nao_feitos: j.checklist_missed_items || null,
    nota_ia_foto: j.photo_ai_score,
    foto_aprovada: j.photo_ai_approved,
    problemas_foto: j.photo_ai_issues,
    relatorio: (j.retro_report || j.notes_employee || '').slice(0, 400),
    resumo_ia_retro: j.retro_ai_summary,
    valor: j.retro_value ?? j.value,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { days = 30, employeeName } = req.body || {}
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString().split('T')[0]

  try {
    let url = `${SUPABASE_URL}/rest/v1/jobs?select=*&status=eq.completed&scheduled_date=gte.${since}&order=completed_at.desc&limit=200`

    const resp = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    let jobs = await resp.json()
    if (!resp.ok) throw new Error(typeof jobs === 'string' ? jobs : JSON.stringify(jobs))
    if (employeeName) {
      const q = String(employeeName).toLowerCase()
      jobs = (Array.isArray(jobs) ? jobs : []).filter(j => j.employee_name?.toLowerCase().includes(q))
    } else {
      jobs = Array.isArray(jobs) ? jobs : []
    }

    const rows = (Array.isArray(jobs) ? jobs : []).map(compactJob)
    if (!rows.length) {
      return res.status(200).json({ analysis: 'Nenhum relatório de serviço concluído no período.', count: 0 })
    }

    const prompt = `Você é consultor de operações do KuriPuro (limpeza de restaurantes/bares no Japão).
Analise os relatórios de serviço abaixo (${rows.length} jobs nos últimos ${days} dias) e produza um relatório em português com:

1. **Resumo geral** — volume, tendências
2. **Tempo por funcionário** — média, mais rápido, mais lento, outliers
3. **Qualidade** — checklist, notas da IA nas fotos, problemas recorrentes
4. **Padrões** — locais que demoram mais, dias/horários, tipos de serviço
5. **Metas sugeridas** — 3-5 metas SMART para a equipe (tempo, qualidade, checklist)
6. **Alertas** — funcionários ou locais que precisam atenção

Seja específico com números. Use bullet points. Não invente dados além do JSON.

DADOS:
${JSON.stringify(rows, null, 0)}`

    const data = await geminiGenerate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
    })

    const analysis = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '(sem análise)'
    res.status(200).json({ analysis, count: rows.length, periodDays: days })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
