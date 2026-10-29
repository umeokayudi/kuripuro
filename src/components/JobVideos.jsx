import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang'
import { listJobVideos, peekVideoStatus, readVideoStatus } from '../lib/jobVideo'

/**
 * Vídeos opcionais do serviço (jobs/<jobId>/video_n.*), ao lado das fotos Antes/Depois.
 * Lista: só a miniatura com ▶; o vídeo só carrega quando alguém toca (sem autoplay).
 * Mostra também o estado do envio: "enviando…" ou "falhou".
 * lazy: mostra só um botão e busca ao clicar (bom para listas com muitos jobs).
 */
export default function JobVideos({ jobId, lazy = false, label, style, emptyLabel = null }) {
  const { t, tr } = useLang()
  const L = t?.jobVideo || {}
  const [open, setOpen] = useState(!lazy)
  const [state, setState] = useState({ loading: false, videos: null, status: null, error: false })
  const [playing, setPlaying] = useState(null)

  useEffect(() => {
    if (!open || !jobId) return
    let alive = true
    setState({ loading: true, videos: null, status: null, error: false })
    Promise.all([listJobVideos(jobId), readVideoStatus(jobId)])
      .then(([videos, status]) => { if (alive) setState({ loading: false, videos, status, error: false }) })
      .catch(() => { if (alive) setState({ loading: false, videos: [], status: null, error: true }) })
    return () => { alive = false }
  }, [open, jobId])

  if (!jobId) return null

  if (!open) {
    return (
      <button type="button" className="btn btn-sm" style={style} onClick={ev => { ev.stopPropagation(); setOpen(true) }}>
        🎬 {L.show || 'Show video'}
      </button>
    )
  }

  if (state.loading) return <div style={{ fontSize: 12, color: 'var(--text3)', ...style }}>{L.loading || 'Loading video…'}</div>
  if (state.error) return lazy || emptyLabel ? <div style={{ fontSize: 12, color: 'var(--text3)', ...style }}>{L.loadFailed}</div> : null
  const st = state.status
  const pendingNote = st && st.status !== 'uploaded' && !(state.videos || []).some(v => v.path === st.path)
    ? (st.status === 'failed'
      ? <div style={{ fontSize: 12, color: 'var(--red, #ef4444)', fontWeight: 700 }}>⚠️ {tr('Video failed to upload — the employee can try again', '動画の送信に失敗 — スタッフが再送できます', 'Vídeo falhou — o funcionário pode tentar de novo')}</div>
      : <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 700 }}>⏳ {tr('Video uploading…', '動画を送信中…', 'Vídeo enviando…')}</div>)
    : null
  if (!state.videos?.length) return pendingNote ? <div style={style}>{pendingNote}</div> : emptyLabel ? <div style={style}>{emptyLabel}</div> : (lazy ? <div style={{ fontSize: 12, color: 'var(--text3)', ...style }}>{L.none || 'No video'}</div> : null)

  return (
    <div style={style} onClick={ev => ev.stopPropagation()}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
        🎬 {label || L.title || 'Video'}{st?.status === 'uploaded' && st.duration ? ` · ${st.duration}s` : ''}{st?.status === 'uploaded' && st.size ? ` · ${(st.size / 1024 / 1024).toFixed(1)} MB` : ''}
      </div>
      {pendingNote}
      <div style={{ display: 'grid', gap: 8 }}>
        {state.videos.map(v => playing === v.path ? (
          <video key={v.path} src={v.url} controls autoPlay preload="auto" playsInline
            style={{ width: '100%', maxHeight: 360, borderRadius: 8, background: '#000' }} />
        ) : (
          <button key={v.path} type="button" onClick={() => setPlaying(v.path)} aria-label={tr('Play video', '動画を再生', 'Tocar vídeo')}
            style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', maxHeight: 360, borderRadius: 8, border: 'none', padding: 0, cursor: 'pointer', overflow: 'hidden',
              background: v.poster ? `#000 url("${v.poster}") center / cover no-repeat` : '#111' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>▶</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Reports list cell: 🎬 when a video is attached, ⏳ while sending, ⚠️ when it failed, — when none. */
export function VideoMark({ jobId }) {
  const { tr } = useLang()
  const [st, setSt] = useState(undefined)
  useEffect(() => {
    let alive = true
    peekVideoStatus(jobId).then(s => { if (alive) setSt(s) })
    return () => { alive = false }
  }, [jobId])
  if (st === undefined) return <span style={{ color: 'var(--text3)' }}>…</span>
  if (!st) return <span style={{ color: 'var(--text3)' }}>—</span>
  if (st.status === 'uploaded') return <span title={tr('Video attached', '動画あり', 'Vídeo anexado')}>🎬{st.duration ? <small style={{ color: 'var(--text2)' }}> {st.duration}s</small> : null}</span>
  if (st.status === 'failed') return <span title={tr('Video failed', '動画の送信失敗', 'Vídeo falhou')}>⚠️</span>
  return <span title={tr('Video uploading…', '動画を送信中…', 'Vídeo enviando…')}>⏳</span>
}
