import { viewablePhotoUrl } from '../lib/photoUrl'

export default function PhotoLightbox({ url, onClose, closeLabel = 'Close' }) {
  if (!url) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
      >
        ✕ {closeLabel}
      </button>
      <img
        src={viewablePhotoUrl(url)}
        alt=""
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8, objectFit: 'contain' }}
      />
    </div>
  )
}
