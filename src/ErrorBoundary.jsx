import { Component } from 'react'
import { isChunkError, reloadOnceForNewVersion } from './lib/chunkReload'

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error:null } }
  static getDerivedStateFromError(e) { return { error:e, updating: isChunkError(e) } }
  componentDidCatch(e) { if (isChunkError(e) && !reloadOnceForNewVersion()) this.setState({ updating:false }) }
  render() {
    if (this.state.error && this.state.updating) return <div style={{padding:24,fontFamily:'system-ui',color:'#334155'}}>Updating Kuripuro… · 更新中… · Atualizando…</div>
    if (this.state.error) return (
      <div style={{padding:20,fontFamily:'monospace',background:'#1a0000',color:'#f87171',minHeight:'100vh'}}>
        <h2>App Error</h2>
        <pre style={{whiteSpace:'pre-wrap',fontSize:12}}>{this.state.error?.toString()}</pre>
        <pre style={{whiteSpace:'pre-wrap',fontSize:11,color:'#fbbf24'}}>{this.state.error?.stack}</pre>
        <button onClick={()=>window.location.reload()} style={{marginTop:20,padding:'8px 16px',cursor:'pointer'}}>Reload</button>
      </div>
    )
    return this.props.children
  }
}
