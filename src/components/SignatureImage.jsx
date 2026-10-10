import { useEffect, useState } from 'react'
import { signatureForDisplay } from '../lib/signature'

// Shows a job signature as dark ink on white, including the old white-on-transparent ones.
export default function SignatureImage({ url, height = 40, emptyLabel = '—', style }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let alive = true
    setSrc(null)
    if (url) signatureForDisplay(url).then(v => { if (alive) setSrc(v) })
    return () => { alive = false }
  }, [url])
  if (!url) return <span style={{ color: 'var(--text3)', fontSize: 12 }}>{emptyLabel}</span>
  if (!src) return <span style={{ display: 'inline-block', height, width: height * 2.4 }} />
  return (
    <img
      src={src}
      alt="signature"
      style={{ height, width: 'auto', maxWidth: '100%', background: '#fff', border: '1px solid var(--border, #dfe6f0)', borderRadius: 6, display: 'block', ...style }}
    />
  )
}
