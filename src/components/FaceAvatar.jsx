// v1.0.174 · Round avatar: the employee's face photo, or their initials when there is none.
import { useEffect, useState } from 'react'
import { faceUrl, onFaceChange } from '../lib/employeeFace'

export const initialsOf = name => String(name || '').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'

export default function FaceAvatar({ id, name, size = 44, fontSize, className = 'avatar', style, onMissing }) {
  const [src, setSrc] = useState(() => faceUrl(id))
  const [failed, setFailed] = useState(false)
  useEffect(() => { setSrc(faceUrl(id)); setFailed(false) }, [id])
  useEffect(() => onFaceChange(changed => { if (changed === id) { setSrc(faceUrl(id)); setFailed(false) } }), [id])
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: fontSize || Math.round(size * 0.34), background: '#E6F1FB', color: '#185FA5', ...style }
  return (
    <div className={className} style={base} aria-label={name || ''}>
      {id && !failed
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => { setFailed(true); onMissing?.(true) }} onLoad={() => onMissing?.(false)} />
        : initialsOf(name)}
    </div>
  )
}
