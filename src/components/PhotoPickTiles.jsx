// Job photo (Before / After): one camera tile, same size as the photo thumbnails.
// v1.0.222: tapping it asks "Câmera" or "Galeria" (was two tiles side by side).
import CameraOrGallery from './CameraOrGallery'

export default function PhotoPickTiles({ onFiles, L, required = false }) {
  const color = required ? '#ef4444' : '#3b82f6'
  return (
    <CameraOrGallery L={L} onFiles={onFiles} multiple>
      {open => (
        <button type="button" onClick={open} data-testid="photo-add" aria-label={L('Add photo', '写真を追加', 'Adicionar foto')}
          style={{ width: 64, height: 64, borderRadius: 8, border: `1.5px solid ${color}66`, background: `${color}14`, color, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', padding: 0, boxSizing: 'border-box', flexShrink: 0 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>📷</span>
          <span style={{ fontSize: 18, lineHeight: 1, fontWeight: 800 }}>+</span>
        </button>
      )}
    </CameraOrGallery>
  )
}
