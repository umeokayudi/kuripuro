// v1.0.100 · Service report detail = the full record of the job. Everything saved on the job shows
// here, in a fixed order; a missing piece shows a "not sent" tag instead of disappearing.
// header · summary · checklist · media (before / after / video) · notes · GPS
// signature · AI grade with reasons · audit
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { fmtDuration, fmtTime } from '../lib/jobReport'
import { agendaChecklistItems, checklistProgress, contractForAgendaJob, expectedMinutes } from '../lib/agenda'
import { checklistDisplayLabel, splitChecklist } from '../lib/jobChecklist'
import { aiIssueRows } from '../lib/photoAi'
import { appendJobNote, executionMode, jobAudit, jobNotes, manualClose, setNoteVisibility } from '../lib/reportSheet'
import { loadJobLog } from '../lib/jobAdminOps'
import { formatDistance } from '../lib/geocode'
import { mapsCoordsUrl } from '../lib/mapsLink'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { getCleaningType } from '../lib/cleaningType'
import { fill, pickLang } from '../hooks/useLang'
import JobPhotos from './JobPhotos'
import JobVideos from './JobVideos'
import SignatureImage from './SignatureImage'

const box = { background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }
const missingTag = { display: 'inline-block', fontSize: 12, fontWeight: 700, color: '#b45309', background: 'rgba(245,158,11,.12)', borderRadius: 999, padding: '3px 10px' }

function Section({ title, right, children }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</div>
        {right}
      </div>
      {children}
    </section>
  )
}

const fmtStamp = (iso, lang) => {
  if (!iso) return '—'
  try {
    const locale = lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB'
    return new Date(iso).toLocaleString(locale, { timeZone: 'Asia/Tokyo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '—' }
}

function GpsBlock({ r, tr, lang }) {
  const rows = [
    [tr.gpsIn, r.started_at, r.gps_lat_in, r.gps_lng_in, r.gps_acc_in, r.gps_dist_in],
    [tr.gpsOut, r.completed_at, r.gps_lat_out, r.gps_lng_out, r.gps_acc_out, r.gps_dist_out],
  ]
  return (
    <div className="grid-2" style={{ gap: 8 }}>
      {rows.map(([label, at, lat, lng, acc, dist]) => (
        <div key={label} style={{ ...box, fontSize: 12.5, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600 }}>{label} · {at ? fmtTime(at, lang) : '—'}</div>
          {lat != null && lng != null ? (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, color: dist == null ? 'var(--text3)' : Number(dist) > 150 ? 'var(--red)' : 'var(--green)' }}>
                {dist == null ? pickLang(lang, 'Distance unknown', '距離不明', 'Distância desconhecida') : <>{Number(dist) > 150 ? '⚠ ' : ''}{fill(tr.gpsFromSite, { m: formatDistance(dist) })}</>}
              </div>
              {acc != null && <div style={{ color: 'var(--text3)', fontSize: 12 }}>{fill(tr.gpsAccuracy, { m: Math.round(acc) })}</div>}
              <a href={mapsCoordsUrl(lat, lng)} target="_blank" rel="noreferrer">{tr.openMap} ↗</a>
            </>
          ) : <span style={missingTag}>{tr.gpsNone}</span>}
        </div>
      ))}
    </div>
  )
}

const AUDIT_LABEL = {
  created: ['Job created', 'ジョブ作成', 'Job criado'],
  started: ['Started in the employee app', 'スタッフアプリで開始', 'Iniciado no app do funcionário'],
  finished_app: ['Finished in the employee app', 'スタッフアプリで完了', 'Concluído no app do funcionário'],
  finished_retro: ['Reported late (retroactive)', '遡及報告', 'Relatado depois (retroativo)'],
  closed_manual: ['Closed manually by the admin', '管理者が手動で完了', 'Fechado manualmente pelo admin'],
  handover: ['Hand-over', '引き継ぎ', 'Troca de funcionário'],
  'admin:adjust_time': ['Time adjusted', '時間を調整', 'Horário ajustado'],
  'admin:admin_reopen': ['Reopened', '再開', 'Reaberto'],
  'admin:reopen': ['Reopened', '再開', 'Reaberto'],
}

/**
 * row: Reports row (service report merged with the job; row._job = the job itself).
 * onJobSaved(job): the job was saved here (note added).
 */
export default function ReportSheet({ row, tr, lang, contracts = [], user, onPhoto, onRegrade, regrading, onDelete, onJobSaved }) {
  const job = row._job || null
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [logs, setLogs] = useState([])
  const [noteText, setNoteText] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteClient, setNoteClient] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    setLogs([])
    if (row.job_id) loadJobLog(row.job_id).then(l => { if (alive) setLogs(l || []) }).catch(() => {})
    return () => { alive = false }
  }, [row.job_id])

  const done = (row.job_status || job?.status) === 'completed'
  const mode = job ? executionMode(job, logs) : (row.report_type === 'retroativo' ? 'retro' : 'live')
  const contract = job ? contractForAgendaJob(job, contracts) : null
  const planned = job ? expectedMinutes(job, contract) : null
  // The list saved on the job is what the employee ticked; the catalog is only a fallback
  const saved = splitChecklist(job?.checklist_template)
  const items = saved.length ? saved : job ? agendaChecklistItems(job, { contract }) : []
  const progress = checklistProgress(job || row, items)
  const ckDone = progress.total ? progress.done : row.checklist_done
  const ckTotal = progress.total || row.checklist_total
  const notes = job ? jobNotes(job, logs) : (row.notes_out ? [{ at: row.completed_at, author: row.employee_name, role: 'employee', text: row.notes_out }] : [])
  const audit = job ? jobAudit(job, logs) : []
  const manual = job ? manualClose(job, logs) : null
  const deep = job && getCleaningType(job) === 'deep'
  const loc = (row.job_title || row.client_name || '').replace(/ — .*/, '')
  const issues = aiIssueRows(row.photo_ai_issues)

  const addNote = async () => {
    const text = noteText.trim()
    if (!text || !row.job_id) return
    setSaving(true)
    try {
      const { data: fresh, error: readErr } = await supabase.from('jobs').select('*').eq('id', row.job_id).maybeSingle()
      if (readErr || !fresh) throw readErr || new Error(L('Job not found', 'ジョブが見つかりません', 'Job não encontrado'))
      const description = appendJobNote(fresh.description, user?.name || 'Admin', text, new Date(), { client: noteClient })
      const { data: saved, error } = await supabase.from('jobs').update({ description }).eq('id', row.job_id).select('*').maybeSingle()
      if (error) throw error
      setNoteText('')
      setNoteOpen(false)
      setNoteClient(false)
      toast.success(L('Note added to the job', 'ジョブにメモを追加しました', 'Nota adicionada ao job'))
      onJobSaved?.(saved || { ...fresh, description })
    } catch (err) {
      toast.error(err?.message || String(err))
    }
    setSaving(false)
  }

  // v1.0.106 · "visible to the client" ↔ "internal" (only visible notes go into the client report)
  const toggleVisibility = async n => {
    if (!row.job_id || n.line == null) return
    setSaving(true)
    try {
      const { data: fresh, error: readErr } = await supabase.from('jobs').select('*').eq('id', row.job_id).maybeSingle()
      if (readErr || !fresh) throw readErr || new Error(L('Job not found', 'ジョブが見つかりません', 'Job não encontrado'))
      const description = setNoteVisibility(fresh.description, n.line, !n.client)
      const { data: saved, error } = await supabase.from('jobs').update({ description }).eq('id', row.job_id).select('*').maybeSingle()
      if (error) throw error
      onJobSaved?.(saved || { ...fresh, description })
    } catch (err) {
      toast.error(err?.message || String(err))
    }
    setSaving(false)
  }
  const visChip = n => n.kind === 'note' && n.line != null
    ? <button type="button" disabled={saving} onClick={() => toggleVisibility(n)} title={L('Tap to change', 'タップで切替', 'Toque para trocar')}
        style={{ marginLeft: 6, border: 0, cursor: 'pointer', borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 700, background: n.client ? 'rgba(34,197,94,.14)' : 'var(--surface2)', color: n.client ? '#15803d' : 'var(--text2)' }}>
        {n.client ? '👁 ' + L('visible to the client', '顧客に表示', 'visível ao cliente') : '🔒 ' + L('internal', '社内のみ', 'interna')}
      </button>
    : <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--text3)' }}>🔒 {L('internal', '社内のみ', 'interna')}</span>

  const badge = (cls, text) => <span className={`badge ${cls}`}>{text}</span>
  const modeBadge = mode === 'manual'
    ? badge('badge-amber', '🔒 ' + L('Closed by admin', '管理者が完了', 'Fechamento manual do admin'))
    : mode === 'retro' ? badge('badge-amber', tr.typeRetro) : badge('badge-green', tr.typeLive)

  return (
    <div className="kp-report-sheet">
      {/* 0 · header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>
            {loc}{' — '}{deep ? L('Deep clean', 'ディープクリーン', 'Limpeza pesada') : L('Basic cleaning', '通常清掃', 'Limpeza básica')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>
            👤 {row.employee_name || '—'} · 📅 {row.report_date || '—'}{row.area ? ` · ${tr.area}: ${row.area}` : ''}
            {row.client_name && row.client_name !== loc ? <> · 🏢 {row.client_name}</> : null}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {done ? badge('badge-green', L('Completed', '完了', 'Concluído')) : badge('badge-red', tr.pendingJob)}
            {done && modeBadge}
            {ckTotal ? badge(ckDone >= ckTotal ? 'badge-green' : 'badge-amber', fill(L('Checklist {x} of {y}', 'チェック {x}/{y}', 'Checklist {x} de {y}'), { x: ckDone || 0, y: ckTotal })) : null}
          </div>
        </div>
      </div>

      {/* 1 · summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          [tr.start, row.time_in],
          [tr.end, row.time_out],
          [L('Real × planned', '実績 × 予定', 'Real × planejada'), `${fmtDuration(row.duration_min, lang)} × ${planned ? fmtDuration(planned, lang) : '—'}`],
          [tr.value, row.job_value ? `¥${Number(row.job_value).toLocaleString()}` : '—'],
        ].map(([l, v]) => (
          <div key={l} style={box}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>{l}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{v || '—'}</div>
          </div>
        ))}
      </div>

      {/* 2 · checklist */}
      <Section title={L('Checklist', 'チェックリスト', 'Checklist')} right={ckTotal ? <span style={{ fontSize: 12, color: 'var(--text2)' }}>{fill(L('{x} of {y}', '{x}/{y}', '{x} de {y}'), { x: ckDone || 0, y: ckTotal })}</span> : null}>
        {progress.items.length && !progress.countOnly ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {progress.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.4, padding: '6px 10px', borderRadius: 8, background: it.done ? 'rgba(34,197,94,.07)' : 'rgba(239,68,68,.07)' }}>
                <span style={{ fontWeight: 800, color: it.done ? 'var(--green)' : 'var(--red)' }}>{it.done ? '✓' : '✗'}</span>
                <span style={{ minWidth: 0 }}>{checklistDisplayLabel(it.label, lang)}</span>
              </div>
            ))}
          </div>
        ) : ckTotal ? (
          <div style={{ fontSize: 13 }}>{fill(L('{x} of {y} items done', '{y}件中{x}件完了', '{x} de {y} itens feitos'), { x: ckDone || 0, y: ckTotal })}{row.checklist_missed_items ? <div style={{ color: 'var(--red)', marginTop: 4 }}>{tr.missedItems}: {row.checklist_missed_items}</div> : null}</div>
        ) : <span style={missingTag}>{L('No checklist', 'チェックリストなし', 'Sem checklist')}</span>}
      </Section>

      {/* 3 · media */}
      <Section title={L('Service media', '作業メディア', 'Mídia do serviço')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {[['before', tr.before, row.photo_before_url], ['after', tr.after, row.photo_after_url]].map(([k, label, url]) => (
            <div key={k} style={box}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>📷 {label}</div>
              {url ? (
                <>
                  <JobPhotos photoStartUrl={k === 'before' ? url : null} photoEndUrl={k === 'after' ? url : null} beforeLabel={label} afterLabel={label} size={132} onPhotoClick={onPhoto} />
                  <a href={viewablePhotoUrl(url)} target="_blank" rel="noreferrer" style={{ fontSize: 12, display: 'inline-block', marginTop: 6 }}>{tr.openFullscreen} ↗</a>
                </>
              ) : <span style={missingTag}>{done && k === 'after' ? L('Not sent — waiting for the photo', '未送信 — 写真待ち', 'Não enviada — aguardando foto') : L('Not sent', '未送信', 'Não enviada')}</span>}
            </div>
          ))}
        </div>
        <div style={{ ...box, marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>🎬 {L('Post-cleaning video', '清掃後の動画', 'Vídeo pós-limpeza')}</div>
          {row.job_id
            ? <JobVideos jobId={row.job_id} label={L('Video', '動画', 'Vídeo')} emptyLabel={<span style={missingTag}>{L('No video sent', '動画なし', 'Nenhum vídeo enviado')}</span>} />
            : <span style={missingTag}>{L('No video sent', '動画なし', 'Nenhum vídeo enviado')}</span>}
        </div>
      </Section>

      {/* 4 · notes */}
      <Section title={L('Service notes', '作業メモ', 'Notas do serviço')}
        right={row.job_id && !noteOpen ? <button type="button" className="btn btn-sm" onClick={() => setNoteOpen(true)}>＋ {L('Add note', 'メモを追加', 'Adicionar nota')}</button> : null}>
        {noteOpen && (
          <div style={{ marginBottom: 8 }}>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} autoFocus
              placeholder={L('Write a note for this job…', 'このジョブへのメモ…', 'Escreva uma nota para este job…')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, resize: 'vertical' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13, minHeight: 40 }}>
              <input type="checkbox" checked={noteClient} onChange={e => setNoteClient(e.target.checked)} style={{ width: 18, height: 18 }} />
              {L('Visible to the client (goes into the client report)', '顧客に表示（お客様レポートに載る）', 'Visível ao cliente (entra no relatório do cliente)')}
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" className="btn btn-primary" disabled={saving || !noteText.trim()} onClick={addNote} style={{ minHeight: 40 }}>{saving ? '…' : L('Save note', 'メモを保存', 'Salvar nota')}</button>
              <button type="button" className="btn" onClick={() => { setNoteOpen(false); setNoteText(''); setNoteClient(false) }} style={{ minHeight: 40 }}>{L('Cancel', 'キャンセル', 'Cancelar')}</button>
            </div>
          </div>
        )}
        {notes.length ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {notes.map((n, i) => (
              <div key={i} style={{ ...box, borderLeft: `3px solid ${n.role === 'employee' ? '#315cf5' : '#c19c56'}` }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>
                  <b>{n.author || (n.role === 'employee' ? L('Employee', 'スタッフ', 'Funcionário') : 'Admin')}</b>
                  {' · '}{n.role === 'employee' ? L('employee', 'スタッフ', 'funcionário') : 'admin'}
                  {n.kind === 'retro' ? ` · ${tr.typeRetro}` : ''}
                  {' · '}{fmtStamp(n.at, lang)}
                  {visChip(n)}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.text}</div>
              </div>
            ))}
          </div>
        ) : !noteOpen && <span style={{ fontSize: 13, color: 'var(--text3)' }}>{L('No notes on this job.', 'メモはありません。', 'Nenhuma nota neste job.')}</span>}
        {row.retro_ai_summary && (
          <div style={{ marginTop: 8, fontSize: 13, background: '#eef3ff', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 2 }}>{tr.aiRetro}</div>{row.retro_ai_summary}
          </div>
        )}
      </Section>

      {/* 5 · GPS */}
      <Section title={tr.gpsTitle}><GpsBlock r={row} tr={tr} lang={lang} /></Section>

      {/* 6 · signature */}
      <Section title={L('Client signature', 'お客様の署名', 'Assinatura do cliente')}>
        {row.signature_url
          ? <SignatureImage url={row.signature_url} height={90} emptyLabel={tr.noSignature} />
          : <span style={missingTag}>{L('Not collected', '未取得', 'Não coletada')}</span>}
      </Section>

      {/* 7 · AI grade */}
      <Section title={L('AI review', 'AI評価', 'Avaliação da IA')}
        right={row.photo_after_url && row.job_id ? <button type="button" className="btn btn-sm" disabled={regrading} onClick={onRegrade}>{regrading ? tr.analyzing : L('Analyse again', '再分析', 'Analisar de novo')}</button> : null}>
        {row.photo_ai_score != null ? (
          <div style={{ fontSize: 13.5, borderRadius: 10, padding: '10px 12px', background: row.photo_ai_approved ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)' }}>
            <b>🤖 {row.photo_ai_score}/10 {row.photo_ai_approved ? '✅' : '⚠️'}</b>
            {issues.length > 0
              ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{issues.map((r, i) => <li key={i}>{r.issue}{r.fix && <> — <b>{L('fix', '直す', 'corrigir')}:</b> {r.fix}</>}</li>)}</ul>
              : <div style={{ marginTop: 4, color: 'var(--text2)' }}>{L('No problems found in the photo.', '写真に問題は見つかりませんでした。', 'Nenhum problema encontrado na foto.')}</div>}
          </div>
        ) : <span style={missingTag}>{row.photo_after_url ? L('AI grade pending', 'AI評価待ち', 'Análise da IA pendente') : L('No After photo to grade', '評価する写真なし', 'Sem foto After para avaliar')}</span>}
      </Section>

      {/* 8 · audit */}
      <Section title={L('Audit', '監査ログ', 'Auditoria')}>
        {manual && (
          <div style={{ fontSize: 13, marginBottom: 6, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,.1)' }}>
            🔒 {fill(L('Closed manually by {by} on {at}', '{by} が {at} に手動で完了', 'Fechado manualmente por {by} em {at}'), { by: manual.by || 'Admin', at: fmtStamp(manual.at, lang) })}
            {' · '}{L('reason', '理由', 'motivo')}: {manual.note || L('forgot to finish', '完了忘れ', 'esquecimento de finalizar')}
          </div>
        )}
        {audit.length ? (
          <div style={{ display: 'grid', gap: 2, fontSize: 12.5, color: 'var(--text2)' }}>
            {audit.map((a, i) => {
              const lbl = AUDIT_LABEL[a.what] || [a.what.replace(/^admin:/, ''), a.what.replace(/^admin:/, ''), a.what.replace(/^admin:/, '')]
              return <div key={i}>• {fmtStamp(a.at, lang)} · {pickLang(lang, ...lbl)}{a.who ? ` · ${a.who}` : ''}{a.note && a.what !== 'closed_manual' ? ` — ${a.note}` : ''}</div>
            })}
          </div>
        ) : <span style={{ fontSize: 13, color: 'var(--text3)' }}>—</span>}
      </Section>

      <div style={{ display: 'flex', gap: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-danger" onClick={onDelete}>🗑 {tr.deleteReport}</button>
      </div>
    </div>
  )
}
