import { fill } from '../hooks/useLang'

const fmtSize = (b) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

/**
 * Botão "Adicionar vídeo (opcional)" do app do funcionário.
 * video: { status: 'compressing'|'ready', progress, size } | null
 */
export default function JobVideoPicker({ video, onPick, onRemove, labels = {} }) {
  const L = labels
  if (!video) {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.2)', cursor: 'pointer' }}>
          <span style={{ fontSize: 20 }}>🎬</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{L.add || 'Add video (optional)'}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{L.hint}</span>
          </span>
          <input type="file" accept="video/*" capture="environment" style={{ display: 'none' }} onChange={ev => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) onPick(f) }} />
        </label>
      </div>
    )
  }

  const pct = Math.round((video.progress || 0) * 100)
  return (
    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: video.status === 'ready' ? '#4ade80' : 'rgba(255,255,255,0.75)', fontWeight: 600 }}>
          🎬 {video.status === 'ready' ? fill(L.ready || 'Video ready · {size}', { size: fmtSize(video.size || 0) }) : fill(L.compressing || 'Compressing… {pct}%', { pct })}
        </span>
        <button type="button" onClick={onRemove} style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'transparent', color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          {L.remove || 'Remove'}
        </button>
      </div>
      {video.status === 'compressing' && (
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', marginTop: 8, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#c19c56', transition: 'width 0.3s' }} />
        </div>
      )}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>{L.willUpload}</div>
    </div>
  )
}
