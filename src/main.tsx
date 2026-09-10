import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getSessionStorage, handleClientError } from './errors/routeErrorRecovery.js'

window.addEventListener('unhandledrejection', (event) => {
  handleClientError({
    error: event.reason,
    route: window.location.pathname,
    source: 'unhandled-rejection',
    storage: getSessionStorage(),
    reload: () => window.location.reload(),
  })
})

window.addEventListener('vite:preloadError', (event) => {
  const preloadEvent = event as Event & { payload?: unknown }
  const result = handleClientError({
    error: preloadEvent.payload ?? new Error('Vite preload error'),
    route: window.location.pathname,
    source: 'vite-preload-error',
    storage: getSessionStorage(),
    reload: () => window.location.reload(),
    forceChunkLoadFailure: true,
  })
  if (result.recoveryStarted) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
