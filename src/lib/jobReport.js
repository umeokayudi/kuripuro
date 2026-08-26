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
  const location = (job.title || '').replace(/ — .*/, '').trim()
  return {
    job_id: job.id,
    employee_id: job.employee_id,
    employee_name: job.employee_name,
    client_id: job.client_id || null,
    client_name: location,
    location_name: location,
    job_title: job.title,
    report_date: job.scheduled_date,
    time_in: job.started_at ? fmtTime(job.started_at, lang) : (job.scheduled_time || '—'),
    time_out: job.completed_at ? fmtTime(job.completed_at, lang) : '—',
    duration_min: duration,
    report_type: jobReportType(job),
    notes_out: jobReportText(job),
    photo_comment: job.notes_employee || null,
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

/** Preenche fotos e campos faltantes do relatório a partir do job original */
export function mergeReportWithJob(report, job, lang = 'en') {
  if (!report || !job) return report
  const fromJob = jobToServiceReport(job, lang)
  return {
    ...report,
    photo_before_url: report.photo_before_url || fromJob.photo_before_url,
    photo_after_url: report.photo_after_url || fromJob.photo_after_url,
    signature_url: report.signature_url || fromJob.signature_url,
    photo_ai_score: report.photo_ai_score ?? fromJob.photo_ai_score,
    photo_ai_approved: report.photo_ai_approved ?? fromJob.photo_ai_approved,
    photo_ai_issues: report.photo_ai_issues || fromJob.photo_ai_issues,
    checklist_done: report.checklist_done ?? fromJob.checklist_done,
    checklist_total: report.checklist_total ?? fromJob.checklist_total,
    checklist_missed_items: report.checklist_missed_items || fromJob.checklist_missed_items,
    notes_out: report.notes_out || fromJob.notes_out,
    retro_ai_summary: report.retro_ai_summary || fromJob.retro_ai_summary,
    duration_min: report.duration_min ?? fromJob.duration_min,
    time_in: report.time_in && report.time_in !== '—' ? report.time_in : fromJob.time_in,
    time_out: report.time_out && report.time_out !== '—' ? report.time_out : fromJob.time_out,
    job_value: report.job_value ?? fromJob.job_value,
  }
}

export function reportNeedsPhotoSync(report, job) {
  if (!job) return false
  const jobHasPhotos = !!(job.photo_start_url || job.photo_end_url)
  const reportHasPhotos = !!(report?.photo_before_url || report?.photo_after_url)
  return jobHasPhotos && !reportHasPhotos
}

export async function syncServiceReport(supabase, job) {
  if (!job?.id || job.status !== 'completed') return
  const row = jobToServiceReport(job)
  const { data: existing, error: findErr } = await supabase
    .from('service_reports')
    .select('id')
    .eq('job_id', job.id)
    .maybeSingle()
  if (findErr) throw findErr
  if (existing?.id) {
    const { error } = await supabase.from('service_reports').update(row).eq('job_id', job.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('service_reports').insert(row)
    if (error) throw error
  }
}
