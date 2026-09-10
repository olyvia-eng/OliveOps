import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getSessionStorage, installGlobalErrorHandlers } from './errors/routeErrorRecovery.js'

const removeGlobalErrorHandlers = installGlobalErrorHandlers({
  target: window,
  storage: getSessionStorage(),
  reload: () => window.location.reload(),
  route: () => window.location.pathname,
})

if (import.meta.hot) import.meta.hot.dispose(removeGlobalErrorHandlers)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
