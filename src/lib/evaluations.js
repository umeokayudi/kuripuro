import { supabase } from './supabase'
import { tokyoToday } from './dates'

/** Points per star. Positive: stars = how good. Complaint: stars = how serious. */
export const EVAL_POINTS = { positive: { 1: 2, 2: 3, 3: 5, 4: 8, 5: 10 }, complaint: { 1: -2, 2: -3, 3: -5, 4: -8, 5: -10 } }

/** Complaint severity buttons → stored stars. */
export const COMPLAINT_LEVELS = [
  { stars: 1, en: 'Small', ja: '軽い', pt: 'Leve' },
  { stars: 3, en: 'Medium', ja: '普通', pt: 'Médio' },
  { stars: 5, en: 'Serious', ja: '重大', pt: 'Grave' },
]

/** Categories are saved in English (existing rows); `ja`/`pt` are for display. */
export const EVAL_CATEGORIES = {
  positive: [
    { key: 'Perfect cleaning', icon: '✨', ja: '完璧な清掃', pt: 'Limpeza perfeita' },
    { key: 'Excellent work', icon: '💪', ja: '素晴らしい仕事', pt: 'Ótimo trabalho' },
    { key: 'On time', icon: '⏰', ja: '時間通り', pt: 'Pontual' },
    { key: 'Great attitude', icon: '😊', ja: '態度が良い', pt: 'Ótima atitude' },
    { key: 'Client praised', icon: '🙌', ja: '顧客から好評', pt: 'Cliente elogiou' },
    { key: 'Extra effort', icon: '⭐', ja: 'プラスαの努力', pt: 'Esforço extra' },
    { key: 'Good photos', icon: '📷', ja: '写真が良い', pt: 'Boas fotos' },
  ],
  complaint: [
    { key: 'Incomplete service', icon: '🧽', ja: '清掃不十分', pt: 'Serviço incompleto' },
    { key: 'Lateness', icon: '⏰', ja: '遅刻', pt: 'Atraso' },
    { key: 'Missing photos', icon: '📷', ja: '写真なし', pt: 'Faltou foto' },
    { key: 'Client complaint', icon: '📞', ja: '顧客クレーム', pt: 'Reclamação do cliente' },
    { key: 'Forgot key / lights', icon: '🔑', ja: '鍵・消灯忘れ', pt: 'Esqueceu chave / luz' },
    { key: 'Bad attitude', icon: '😠', ja: '態度が悪い', pt: 'Má atitude' },
    { key: 'Property damage', icon: '💥', ja: '物損', pt: 'Danificou algo' },
    { key: 'No-show', icon: '🚫', ja: '無断欠勤', pt: 'Não apareceu' },
  ],
}

export function categoryLabel(key, lang = 'en') {
  const all = [...EVAL_CATEGORIES.positive, ...EVAL_CATEGORIES.complaint]
  return String(key || '').split(',').map(k => k.trim()).filter(Boolean).map(k => {
    const c = all.find(x => x.key === k)
    if (!c) return k
    return lang === 'ja' ? c.ja : lang === 'pt' ? c.pt : c.key
  }).join(', ')
}

export const pointsFor = (type, stars) => EVAL_POINTS[type]?.[stars] ?? 0

const clampScore = s => Math.min(100, Math.max(0, s))

/** Saves one evaluation and moves the employee score. Returns { row, prevScore, newScore }. */
export async function saveEvaluation({ employee, job, type, stars, categories = [], description = '' }) {
  const pts = pointsFor(type, stars)
  const { data: fresh } = await supabase.from('employees').select('score').eq('id', employee.id).maybeSingle()
  const prevScore = fresh?.score ?? employee.score ?? 100
  const newScore = clampScore(prevScore + pts)
  const { data: row, error } = await supabase.from('evaluations').insert({
    employee_id: employee.id,
    employee_name: employee.full_name,
    job_id: job?.id || null,
    job_title: job?.title || null,
    type,
    stars,
    points_change: pts,
    category: categories.length ? categories.join(', ') : (type === 'positive' ? 'Excellent work' : 'Incomplete service'),
    description: description.trim() || null,
    eval_date: tokyoToday(),
  }).select().single()
  if (error) throw error
  await supabase.from('employees').update({ score: newScore }).eq('id', employee.id)
  return { row, prevScore, newScore }
}

/** Removes an evaluation and gives the points back. */
export async function removeEvaluation(row) {
  const { error } = await supabase.from('evaluations').delete().eq('id', row.id)
  if (error) throw error
  const { data: fresh } = await supabase.from('employees').select('score').eq('id', row.employee_id).maybeSingle()
  const newScore = clampScore((fresh?.score ?? 100) - (row.points_change || 0))
  await supabase.from('employees').update({ score: newScore }).eq('id', row.employee_id)
  return newScore
}
