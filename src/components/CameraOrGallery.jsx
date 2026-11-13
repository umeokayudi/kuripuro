// v1.0.222 · One camera button → a small sheet asks "Câmera" or "Galeria".
// Each choice has its own <input>: phones open the camera directly only when the input has `capture`.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const overlay = { position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(10,20,40,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
const sheet = { width: '100%', maxWidth: 430, background: '#fff', color: '#0f172a', borderRadius: '20px 20px 0 0', padding: '16px 16px calc(16px + env(safe-area-inset-bottom,0px))', boxSizing: 'border-box', boxShadow: '0 -8px 30px rgba(0,0,0,0.18)' }
const choice = { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', marginBottom: 8, borderRadius: 14, border: '1px solid #dbe3f0', background: '#f5f8ff', color: '#1e3a8a', fontSize: 16, fontWeight: 800, cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }

/**
 * children(open) renders the trigger. onFiles gets an array of File.
 * kind: 'photo' | 'video'; capture: 'environment' (back camera) | 'user' (selfie).
 */
export default function CameraOrGallery({ children, onFiles, L, kind = 'photo', capture = 'environment', multiple = false, title }) {
  const cam = useRef(null)
  const gal = useRef(null)
  const [open, setOpen] = useState(false)
  const accept = kind === 'video' ? 'video/*' : 'image/*'
  const take = e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onFiles(files) }
  const pick = ref => { setOpen(false); ref.current?.click() }
  const isVideo = kind === 'video'
  return (
    <>
      {children(() => setOpen(true))}
      <input ref={cam} type="file" accept={accept} capture={capture} style={{ display: 'none' }} onChange={take} />
      <input ref={gal} type="file" accept={accept} multiple={multiple} style={{ display: 'none' }} onChange={take} />
      {open && createPortal(
        <div style={overlay} onClick={() => setOpen(false)} role="presentation">
          <div style={sheet} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" data-testid="cog-sheet">
            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#cbd5e1', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12, textAlign: 'center' }}>
              {title || (isVideo ? L('Add video', '動画を追加', 'Adicionar vídeo') : L('Add photo', '写真を追加', 'Adicionar foto'))}
            </div>
            <button type="button" style={choice} onClick={() => pick(cam)} data-testid="cog-camera">
              <span style={{ fontSize: 24 }}>{isVideo ? '🎥' : '📷'}</span>
              {isVideo ? L('Record with the camera', 'カメラで撮影', 'Gravar com a câmera') : L('Take with the camera', 'カメラで撮る', 'Tirar com a câmera')}
            </button>
            <button type="button" style={choice} onClick={() => pick(gal)} data-testid="cog-gallery">
              <span style={{ fontSize: 24 }}>🖼️</span>
              {L('Choose from the gallery', 'ギャラリーから選ぶ', 'Escolher da galeria')}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ ...choice, justifyContent: 'center', background: 'transparent', border: 'none', color: '#64748b', marginBottom: 0 }}>
              {L('Cancel', 'キャンセル', 'Cancelar')}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
