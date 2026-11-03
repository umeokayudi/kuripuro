// v1.0.132 · Admin "Videos": every video the team sent when finishing a service, in one place.
// Watch it here or save it on this device (one or all). Videos stay in Supabase Storage
// (service-photos/jobs/<jobId>/video_n.*); this page only reads them.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { apiPost } from '../lib/apiFetch'
import { downloadVideo, listJobVideos, videoFileName } from '../lib/jobVideo'
import { tokyoToday } from '../lib/dates'
import { useLang } from '../hooks/useLang'
import EmptyHint from '../components/EmptyHint'

const PERIODS = [7, 30, 90]
const mb = n => (n ? `${(n / 1024 / 1024).toFixed(1)} MB` : '')
const posterOf = path => supabase.storage.from('service-photos').getPublicUrl(path.replace(/\.[a-z0-9]+$/i, '.jpg')).data?.publicUrl || null
const placeOf = job => String(job.title || job.client_name || '').replace(/ — .*/, '')
const baseName = job => `${job.scheduled_date || ''}_${placeOf(job)}_${job.employee_name || ''}`

function daysAgo(n) {
  const d = new Date(`${tokyoToday()}T00:00:00+09:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

/** Server lists the folders 8 at a time; if it is not reachable (local dev), ask per job. */
async function findVideos(jobs) {
  const payload = jobs.map(j => ({ id: j.id, name: baseName(j) }))
  try {
    const resp = await apiPost('/api/photo', { action: 'video-index', jobs: payload })
    if (resp.ok) {
      const data = await resp.json()
      if (Array.isArray(data.items)) return data.items
    }
  } catch { /* fallback below */ }
  const items = []
  for (let i = 0; i < payload.length; i += 6) {
    const part = await Promise.all(payload.slice(i, i + 6).map(j => listJobVideos(j.id, j.name).then(v => ({ job_id: j.id, videos: v })).catch(() => null)))
    for (const it of part) if (it?.videos?.length) items.push(it)
  }
  return items
}

export default function Videos() {
  const { tr } = useLang()
  const [days, setDays] = useState(30)
  const [rows, setRows] = useState(null)
  const [checked, setChecked] = useState(0)
  const [error, setError] = useState('')
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [playing, setPlaying] = useState(null)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    let alive = true
    setRows(null); setError(''); setPlaying(null)
    ;(async () => {
      const { data: jobs, error: err } = await supabase.from('jobs')
        .select('id,title,client_name,employee_name,scheduled_date,completed_at')
        .eq('status', 'completed').gte('completed_at', daysAgo(days))
        .order('completed_at', { ascending: false }).limit(600)
      if (err) throw err
      const items = await findVideos(jobs || [])
      const byId = Object.fromEntries((jobs || []).map(j => [j.id, j]))
      const list = []
      for (const it of items) {
        const job = byId[it.job_id]
        if (!job) continue
        for (const v of it.videos) {
          list.push({ ...v, job, key: v.path, poster: posterOf(v.path), file_name: v.file_name || videoFileName(baseName(job), v) })
        }
      }
      list.sort((a, b) => String(b.job.completed_at || '').localeCompare(String(a.job.completed_at || '')) || a.index - b.index)
      if (alive) { setRows(list); setChecked((jobs || []).length) }
    })().catch(e => { if (alive) { setRows([]); setError(e.message || String(e)) } })
    return () => { alive = false }
  }, [days])

  const people = useMemo(() => [...new Set((rows || []).map(r => r.job.employee_name).filter(Boolean))].sort(), [rows])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (rows || []).filter(r => (!who || r.job.employee_name === who)
      && (!s || `${r.job.title} ${r.job.client_name} ${r.job.employee_name}`.toLowerCase().includes(s)))
  }, [rows, who, q])
  const totalSize = shown.reduce((n, r) => n + (r.size || 0), 0)

  const saveOne = async (r) => {
    setSaving(r.key)
    try { await downloadVideo(r) } catch { toast.error(tr('Could not download. Try again.', 'ダウンロードできませんでした。', 'Não deu para baixar. Tente de novo.')) }
    setSaving(null)
  }
  const saveAll = async () => {
    if (!shown.length) return
    toast(tr(`Downloading ${shown.length} video(s)… if the browser asks, allow multiple downloads.`,
      `${shown.length}件の動画をダウンロード中…ブラウザが確認したら「許可」を押してください。`,
      `Baixando ${shown.length} vídeo(s)… se o navegador perguntar, permita vários downloads.`))
    for (const r of shown) {
      setSaving(r.key)
      try { await downloadVideo(r) } catch { /* next one */ }
      await new Promise(ok => setTimeout(ok, 900))
    }
    setSaving(null)
  }

  return (
    <div>
      <h2 className="page-head" style={{ marginBottom: 4, fontSize: 22 }}>🎬 {tr('Service videos', '作業動画', 'Vídeos dos serviços')}</h2>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text2)' }}>
        {tr('Videos the team sent when finishing a service. Tap to watch, or download to keep a copy.',
          '作業完了時にスタッフが送った動画です。タップで再生、ダウンロードで保存できます。',
          'Vídeos que a equipe enviou ao finalizar o serviço. Toque para assistir ou baixe para guardar uma cópia.')}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        {PERIODS.map(n => (
          <button key={n} type="button" className={`btn btn-sm ${days === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(n)}>
            {tr(`Last ${n} days`, `過去${n}日`, `Últimos ${n} dias`)}
          </button>
        ))}
        <div className="form-group" style={{ margin: 0, flex: '0 1 200px', minWidth: 140 }}>
          <select value={who} onChange={e => setWho(e.target.value)} aria-label={tr('Employee', 'スタッフ', 'Funcionário')}>
            <option value="">{tr('Everyone', '全員', 'Todos')}</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, flex: '1 1 180px', minWidth: 0 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tr('Search place or client', '場所・顧客で検索', 'Buscar local ou cliente')} />
        </div>
        {shown.length > 1 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={saveAll} disabled={!!saving}>
            ⬇ {tr(`Download all (${shown.length})`, `すべてダウンロード (${shown.length})`, `Baixar todos (${shown.length})`)}
          </button>
        )}
      </div>

      {rows === null && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{tr('Looking for videos…', '動画を検索中…', 'Procurando vídeos…')}</div>}
      {error && <div style={{ fontSize: 13, color: 'var(--red, #ef4444)', marginBottom: 10 }}>⚠️ {error}</div>}
      {rows !== null && !shown.length && !error && (
        <EmptyHint icon="🎬" title={tr('No videos in this period', 'この期間の動画はありません', 'Nenhum vídeo neste período')}>
          {tr(`Checked ${checked} finished service(s). Videos appear here when the employee adds one while finishing the service.`,
            `完了した作業 ${checked} 件を確認しました。スタッフが作業完了時に動画を追加するとここに表示されます。`,
            `Conferi ${checked} serviço(s) finalizado(s). O vídeo aparece aqui quando o funcionário adiciona um ao finalizar o serviço.`)}
        </EmptyHint>
      )}

      {shown.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          {tr(`${shown.length} video(s)`, `${shown.length}件`, `${shown.length} vídeo(s)`)}{totalSize ? ` · ${mb(totalSize)}` : ''}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {shown.map(r => (
          <div key={r.key} className="card" style={{ padding: 10, minWidth: 0 }}>
            {playing === r.key ? (
              <video src={r.url} controls autoPlay playsInline preload="auto"
                style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 8, background: '#000' }} />
            ) : (
              <button type="button" onClick={() => setPlaying(r.key)} aria-label={tr('Play video', '動画を再生', 'Tocar vídeo')}
                style={{ position: 'relative', display: 'block', width: '100%', aspectRatio: '16 / 9', borderRadius: 8, border: 'none', padding: 0, cursor: 'pointer', overflow: 'hidden', background: '#111' }}>
                {r.poster && <img src={r.poster} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶</span>
                </span>
              </button>
            )}
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeOf(r.job) || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
              📅 {r.job.scheduled_date || '—'} · 👤 {r.job.employee_name || '—'}{r.size ? ` · ${mb(r.size)}` : ''}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8, width: '100%' }} onClick={() => saveOne(r)} disabled={saving === r.key}>
              {saving === r.key ? tr('Downloading…', 'ダウンロード中…', 'Baixando…') : `⬇ ${tr('Download', 'ダウンロード', 'Baixar')}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
