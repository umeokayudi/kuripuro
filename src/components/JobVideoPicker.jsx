import { fill, pickLang } from '../hooks/useLang'
import CameraOrGallery from './CameraOrGallery'

const fmtSize = (b) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

/**
 * Botão "Adicionar vídeo (opcional)" do app do funcionário.
 * video: { status: 'compressing'|'ready'|'uploading'|'uploaded'|'queued'|'failed', progress, size } | null
 * v1.0.199: after compressing it is sent at once (status uploading → uploaded), during the job.
 */
export default function JobVideoPicker({ video, onPick, onRemove, labels = {}, lang }) {
  const L = labels
  const pick3 = (en, ja, pt) => pickLang(lang, en, ja, pt)
  if (!video) {
    // v1.0.222: one button; tapping it asks camera or gallery (CameraOrGallery).
    return (
      <div style={{ marginBottom: 12 }}>
        <CameraOrGallery L={pick3} kind="video" onFiles={files => onPick(files[0])}>
          {open => (
            <button type="button" onClick={open} data-testid="video-add" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1.5px solid #3b82f666', background: '#3b82f614', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}>
              <span style={{ fontSize: 22 }}>🎬</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#3b82f6' }}>{L.add || 'Add video (optional)'}</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>{L.hint}</span>
              </span>
            </button>
          )}
        </CameraOrGallery>
      </div>
    )
  }

  const pct = Math.round((video.progress || 0) * 100)
  const size = fmtSize(video.size || 0)
  const st = video.status
  const text = st === 'uploaded' ? fill(L.sent || 'Video sent ✓ · {size}', { size })
    : st === 'uploading' ? fill(L.sending || 'Sending video… {pct}% · {size}', { pct, size })
      : st === 'queued' ? (L.queuedDuring || 'Video saved on this phone; it will be sent when the internet is back.')
        : st === 'failed' ? (L.failedShort || 'Video not sent. Remove it and pick it again.')
          : st === 'ready' ? fill(L.ready || 'Video ready · {size}', { size })
            : fill((video.slow && L.compressingSlow) || L.compressing || 'Compressing… {pct}%', { pct })
  const color = st === 'uploaded' ? '#4ade80' : st === 'failed' ? '#f87171' : st === 'queued' ? '#fbbf24' : 'rgba(255,255,255,0.75)'
  const showBar = st === 'compressing' || st === 'uploading'
  const note = st === 'compressing' ? (L.keepOpen || L.willUpload) : st === 'uploaded' || st === 'failed' ? null : L.willUpload
  return (
    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 0 }}>🎬 {text}</span>
        <button type="button" onClick={onRemove} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'transparent', color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
          {L.remove || 'Remove'}
        </button>
      </div>
      {showBar && (
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(3, pct)}%`, height: '100%', background: st === 'uploading' ? '#3b82f6' : '#c19c56', transition: 'width 0.3s' }} />
        </div>
      )}
      {note && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{note}</div>}
    </div>
  )
}
