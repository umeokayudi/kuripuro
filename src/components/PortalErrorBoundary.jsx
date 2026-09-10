import { Component } from 'react'

/** Isolates portal crashes — rest of the app can still recover via reload. */
export default class PortalErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      const label = this.props.label || 'Portal'
      return (
        <div style={{
          minHeight: '100vh', background: '#0d2137', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: '#f87171' }}>
              {label} error
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 16, lineHeight: 1.5 }}>
              Something went wrong. Your data is safe — try reloading. If it persists, contact support.
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: '#c19c56', color: '#0d2137', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
