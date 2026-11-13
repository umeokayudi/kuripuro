// v1.0.244 · Modern loading state with the KuriPuro mark in motion. Reusable on any screen
// (employee, client, admin): <BrandLoader label="Loading…" />. Uses the "Cor que trabalha" tokens.
import './brandLoader.css'

export default function BrandLoader({ label = 'Loading…', fill = false }) {
  return (
    <div className={`kp-bl${fill ? ' kp-bl-fill' : ''}`} role="status" aria-live="polite" aria-label={label}>
      <div className="kp-bl-logo" aria-hidden="true">
        <span className="kp-bl-ring" />
        <span className="kp-bl-ring kp-bl-ring-2" />
        <span className="kp-bl-mark">K</span>
      </div>
      <p className="kp-bl-text">{label}</p>
      <div className="kp-bl-bar" aria-hidden="true"><i /></div>
    </div>
  )
}
