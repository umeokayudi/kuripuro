import { useEffect, useState } from 'react'
import { useLang } from '../hooks/useLang'
import { listJobVideos } from '../lib/jobVideo'

/**
 * Vídeos opcionais do serviço (jobs/<jobId>/video_n.*).
 * lazy: mostra só um botão e busca ao clicar (bom para listas com muitos jobs).
 */
export default function JobVideos({ jobId, lazy = false, label, style }) {
  const { t } = useLang()
  const L = t?.jobVideo || {}
  const [open, setOpen] = useState(!lazy)
  const [state, setState] = useState({ loading: false, videos: null, error: false })

  useEffect(() => {
    if (!open || !jobId) return
    let alive = true
    setState({ loading: true, videos: null, error: false })
    listJobVideos(jobId)
      .then(videos => { if (alive) setState({ loading: false, videos, error: false }) })
      .catch(() => { if (alive) setState({ loading: false, videos: [], error: true }) })
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
  if (state.error) return lazy ? <div style={{ fontSize: 12, color: 'var(--text3)', ...style }}>{L.loadFailed}</div> : null
  if (!state.videos?.length) return lazy ? <div style={{ fontSize: 12, color: 'var(--text3)', ...style }}>{L.none || 'No video'}</div> : null

  return (
    <div style={style} onClick={ev => ev.stopPropagation()}>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>🎬 {label || L.title || 'Video'}</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {state.videos.map(v => (
          <video
            key={v.path}
            src={v.url}
            controls
            preload="metadata"
            playsInline
            style={{ width: '100%', maxHeight: 360, borderRadius: 8, background: '#000' }}
          />
        ))}
      </div>
    </div>
  )
}
