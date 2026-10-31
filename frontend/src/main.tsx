import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx'

const container = document.getElementById('root')
if (container) {
  ;(window as unknown as { __ARIA_MOUNTED__?: boolean }).__ARIA_MOUNTED__ = true
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary name="Root">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

