import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error:null } }
  static getDerivedStateFromError(e) { return { error:e } }
  render() {
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
