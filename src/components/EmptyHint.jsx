// v1.0.117 · Empty list with guidance: what goes here and how it gets filled.
export default function EmptyHint({ icon = '📭', title, children }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '22px 16px' }}>
      <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">{icon}</div>
      {title && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{title}</div>}
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  )
}
