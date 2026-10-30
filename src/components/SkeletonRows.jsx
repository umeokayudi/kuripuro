// v1.0.117 · Placeholder rows while a list loads (never an empty list or a 0 before the data arrives).
export default function SkeletonRows({ rows = 3, label = '…' }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="kp-skel kp-skel-row" />)}
    </div>
  )
}
