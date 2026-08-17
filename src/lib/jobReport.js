export function jobDurationMin(job) {
  if (job?.retro_time_min) return Number(job.retro_time_min)
  if (job?.started_at && job?.completed_at) {
    const ms = new Date(job.completed_at) - new Date(job.started_at)
    if (ms > 0) return Math.round(ms / 60000)
  }
  return null
}

export function jobReportText(job) {
  if (job?.retro_report) return job.retro_report
  return job?.notes_employee || ''
}

export function jobReportType(job) {
  if (job?.retro_report) return 'retroativo'
  return 'ao vivo'
}

export function fmtDuration(min, lang = 'en') {
  if (min == null) return '—'
  if (min < 60) return lang === 'ja' ? `${min}分` : `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (lang === 'ja') return m ? `${h}時間${m}分` : `${h}時間`
  return m ? `${h}h ${m}min` : `${h}h`
}

export function fmtTime(iso, lang = 'en') {
  if (!iso) return '—'
  try {
    const locale = lang === 'ja' ? 'ja-JP' : 'en-GB'
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  } catch { return '—' }
}

/** Monta registro para service_reports a partir de um job concluído */
export function jobToServiceReport(job, lang = 'en') {
  const duration = jobDurationMin(job)
  return {
    job_id: job.id,
    employee_id: job.employee_id,
    employee_name: job.employee_name,
    client_name: (job.title || '').replace(/ — .*/, ''),
    job_title: job.title,
    report_date: job.scheduled_date,
    time_in: job.started_at ? fmtTime(job.started_at, lang) : (job.scheduled_time || '—'),
    time_out: job.completed_at ? fmtTime(job.completed_at, lang) : '—',
    duration_min: duration,
    report_type: jobReportType(job),
    notes_out: jobReportText(job),
    retro_ai_summary: job.retro_ai_summary || null,
    checklist_done: job.checklist_done,
    checklist_total: job.checklist_total,
    checklist_missed_items: job.checklist_missed_items,
    photo_ai_score: job.photo_ai_score,
    photo_ai_approved: job.photo_ai_approved,
    photo_ai_issues: job.photo_ai_issues,
    photo_before_url: job.photo_start_url,
    photo_during_url: null,
    photo_after_url: job.photo_end_url,
    signature_url: job.signature_url,
    job_value: job.retro_value ?? job.value,
    pdf_url: null,
    created_at: job.completed_at || job.updated_at || new Date().toISOString(),
  }
}

export async function syncServiceReport(supabase, job) {
  if (!job?.id || job.status !== 'completed') return
  const row = jobToServiceReport(job)
  try {
    const { data: existing } = await supabase.from('service_reports').select('id').eq('job_id', job.id).maybeSingle()
    if (existing?.id) {
      await supabase.from('service_reports').update(row).eq('job_id', job.id)
    } else {
      await supabase.from('service_reports').insert(row)
    }
  } catch {}
}
