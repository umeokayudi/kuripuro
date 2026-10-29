import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './redesign.css'
import './field-app.css'
import './brand.css'
import ErrorBoundary from './ErrorBoundary.jsx'
import { installChunkRecovery } from './lib/chunkReload'

installChunkRecovery()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
)
