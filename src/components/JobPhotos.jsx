import StorageImage from './StorageImage'
import { parsePhotoUrls } from '../lib/jobPhotoUrls'

const thumbStyle = (size) => ({
  width: size,
  height: size,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  flexShrink: 0,
  overflow: 'hidden',
})

function labeledUrls(urls, label) {
  return urls.map((url, i) => ({
    url,
    label: urls.length > 1 ? `${label} ${i + 1}` : label,
  }))
}

/**
 * Before/after job photos — compact thumbnails or a contained 3:4 comparison grid.
 * photoStartUrl / photoEndUrl may be a single path or a packed JSON list.
 */
export default function JobPhotos({
  photoStartUrl,
  photoEndUrl,
  beforeLabel = 'Before',
  afterLabel = 'After',
  variant = 'compact',
  size = 56,
  onPhotoClick,
  style,
}) {
  const startUrls = parsePhotoUrls(photoStartUrl)
  const endUrls = parsePhotoUrls(photoEndUrl)
  if (!startUrls.length && !endUrls.length) return null

  const items = [
    ...labeledUrls(startUrls, beforeLabel),
    ...labeledUrls(endUrls, afterLabel),
  ]
  const urls = items.map(item => item.url)

  const open = (url) => {
    if (!onPhotoClick) return
    onPhotoClick({ url, urls })
  }

  if (variant === 'compact') {
    return (
      <div className="jp-thumbs" style={style}>
        {items.map(({ url, label }) => (
          <StorageImage
            key={url}
            url={url}
            alt={label}
            fit="cover"
            onClick={onPhotoClick ? (e) => { e?.stopPropagation?.(); open(url) } : undefined}
            style={thumbStyle(size)}
          />
        ))}
      </div>
    )
  }

  const cols = items.length === 2 ? 'jp-compare' : 'jp-compare jp-compare-one'

  return (
    <div className={cols} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, ...style }}>
      {items.map(({ url, label }) => (
        <figure key={url} className="jp-figure" style={items.length > 2 ? { flex: '1 1 140px', minWidth: 120 } : undefined}>
          <div className="jp-figure-label">{label}</div>
          <div className="jp-frame">
            <StorageImage
              url={url}
              alt={label}
              fit="contain"
              onClick={onPhotoClick ? () => open(url) : undefined}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </figure>
      ))}
    </div>
  )
}
