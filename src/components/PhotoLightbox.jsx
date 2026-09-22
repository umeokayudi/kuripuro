import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { lockBodyScroll } from '../lib/bodyScrollLock'

function unpackLightbox(url, urls) {
  if (url && typeof url === 'object' && !Array.isArray(url)) {
    const current = url.url || url.src || ''
    const list = (url.urls?.length ? url.urls : (current ? [current] : [])).filter(Boolean)
    return { current, list }
  }
  const current = url || ''
  const list = (urls?.length ? urls : (current ? [current] : [])).filter(Boolean)
  return { current, list }
}

export default function PhotoLightbox({ url, urls, onClose, closeLabel = 'Close' }) {
  const packed = unpackLightbox(url, urls)
  const list = packed.list
  const listKey = list.join('|')
  const start = Math.max(0, list.indexOf(packed.current))
  const [index, setIndex] = useState(() => (start >= 0 ? start : 0))

  useEffect(() => {
    setIndex(start >= 0 ? start : 0)
  }, [listKey, start])

  useEffect(() => {
    if (!list.length) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
      if (e.key === 'ArrowRight' && list.length > 1) setIndex(i => (i + 1) % list.length)
      if (e.key === 'ArrowLeft' && list.length > 1) setIndex(i => (i - 1 + list.length) % list.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, onClose])

  useEffect(() => {
    if (!list.length) return undefined
    return lockBodyScroll()
  }, [list.length])

  if (!list.length) return null
  const current = list[Math.min(index, list.length - 1)]

  const node = (
    <div className="photo-lightbox" onClick={onClose}>
      <button type="button" className="photo-lightbox-close" onClick={onClose}>
        ✕ {closeLabel}
      </button>
      {list.length > 1 && (
        <>
          <button
            type="button"
            className="photo-lightbox-nav left"
            onClick={(e) => { e.stopPropagation(); setIndex(i => (i - 1 + list.length) % list.length) }}
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            className="photo-lightbox-nav right"
            onClick={(e) => { e.stopPropagation(); setIndex(i => (i + 1) % list.length) }}
            aria-label="Next photo"
          >
            ›
          </button>
          <div className="photo-lightbox-count">{index + 1} / {list.length}</div>
        </>
      )}
      <img
        src={viewablePhotoUrl(current)}
        alt=""
        draggable={false}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
  return typeof document !== 'undefined' ? createPortal(node, document.body) : node
}
