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
    employee: j.employee_name,
    location: j.title,
    date: j.scheduled_date,
    type: j.retro_report ? 'retroactive' : 'live',
    duration_min: dur,
    checklist: j.checklist_total ? `${j.checklist_done || 0}/${j.checklist_total}` : null,
    missed_items: j.checklist_missed_items || null,
    photo_ai_score: j.photo_ai_score,
    photo_approved: j.photo_ai_approved,
    photo_issues: j.photo_ai_issues,
    report: (j.retro_report || j.notes_employee || '').slice(0, 400),
    ai_summary: j.retro_ai_summary,
    value: j.retro_value ?? j.value,
  }
}

const PROMPTS = {
  en: (rows, days) => `You are an operations consultant for KuriPuro (restaurant/bar cleaning in Japan).
Analyze the service reports below (${rows.length} jobs in the last ${days} days) and produce a report in English with:

1. **Overall summary** — volume, trends
2. **Time per employee** — average, fastest, slowest, outliers
3. **Quality** — checklist, AI photo scores, recurring issues
4. **Patterns** — locations that take longer, days/times, service types
5. **Suggested goals** — 3-5 SMART goals for the team (time, quality, checklist)
6. **Alerts** — employees or locations needing attention

Be specific with numbers. Use bullet points. Do not invent data beyond the JSON.

DATA:
${JSON.stringify(rows, null, 0)}`,

  ja: (rows, days) => `あなたはKuriPuro（日本のレストラン・バー清掃会社）のオペレーションコンサルタントです。
以下のサービスレポート（過去${days}日間、${rows.length}件）を分析し、日本語でレポートを作成してください：

1. **全体概要** — 件数、傾向
2. **従業員別作業時間** — 平均、最速、最遅、外れ値
3. **品質** — チェックリスト、AI写真スコア、繰り返しの問題
4. **パターン** — 時間がかかる店舗、曜日・時間帯、サービス種別
5. **推奨目標** — チーム向けSMART目標を3〜5個（時間、品質、チェックリスト）
6. **アラート** — 注意が必要な従業員や店舗

具体的な数値を使ってください。箇条書きで。JSONにないデータは作らないでください。

データ:
${JSON.stringify(rows, null, 0)}`,
}

const EMPTY = {
  en: 'No completed service reports in this period.',
  ja: 'この期間に完了したサービスレポートはありません。',
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { days = 30, employeeName, lang = 'en' } = req.body || {}
  const locale = lang === 'ja' ? 'ja' : 'en'
  const since = new Date(Date.now() - Number(days) * 86400000).toISOString().split('T')[0]

  try {
    const url = `${SUPABASE_URL}/rest/v1/jobs?select=*&status=eq.completed&scheduled_date=gte.${since}&order=completed_at.desc&limit=200`

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

    const rows = jobs.map(compactJob)
    if (!rows.length) {
      return res.status(200).json({ analysis: EMPTY[locale], count: 0 })
    }

    const prompt = PROMPTS[locale](rows, days)

    const data = await geminiGenerate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
    })

    const fallback = locale === 'ja' ? '（分析なし）' : '(no analysis)'
    const analysis = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || fallback
    res.status(200).json({ analysis, count: rows.length, periodDays: days })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
