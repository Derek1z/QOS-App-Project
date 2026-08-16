import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

async function boot(): Promise<void> {
  // Browser preview (no Electron preload): install the stub API so the shell renders.
  if (!window.api) {
    const { previewApi } = await import('./lib/previewApi')
    window.api = previewApi
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
