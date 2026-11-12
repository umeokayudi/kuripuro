// Two tiles for a job photo (Before / After): take it now with the camera, or pick it from the gallery.
// Phones open the camera directly only when the input has `capture`, so each choice gets its own input.
// Colors readable on the dark and the light employee theme.
const tile = color => ({
  width: 76, height: 64, borderRadius: 10, border: `1.5px solid ${color}66`, background: `${color}14`, display: 'flex', alignItems: 'center',
  justifyContent: 'center', cursor: 'pointer', flexDirection: 'column', gap: 2, boxSizing: 'border-box', flexShrink: 0,
})
const cap = color => ({ fontSize: 10, color, lineHeight: 1.1, textAlign: 'center', fontWeight: 800 })

export default function PhotoPickTiles({ onFiles, L, required = false }) {
  const color = required ? '#ef4444' : '#3b82f6'
  const take = e => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onFiles(files) }
  return (
    <>
      <label style={tile(color)} data-testid="photo-camera">
        <span style={{ fontSize: 20 }}>📷</span>
        <span style={cap(color)}>{L('Take photo', '撮影', 'Tirar foto')}</span>
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={take} />
      </label>
      <label style={tile(color)} data-testid="photo-gallery">
        <span style={{ fontSize: 20 }}>🖼</span>
        <span style={cap(color)}>{L('Gallery', 'ギャラリー', 'Galeria')}</span>
        <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={take} />
      </label>
    </>
  )
}
