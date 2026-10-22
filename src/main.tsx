import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { engine } from './state/engine'
import './styles.css'
import './workspace-tools.css'

// Production builds work offline after the first visit (see src/pwa/service-worker.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Silence the decks rather than leaving audio running behind the error screen. */}
    <ErrorBoundary onError={() => { void engine.suspend().catch(() => undefined) }}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
