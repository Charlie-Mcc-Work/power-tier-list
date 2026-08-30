import './lib/polyfills.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { log } from './lib/logger.ts'
import { startMemoryMonitor } from './lib/memory-monitor.ts'

// Start before any render so the blob-URL wrapper sees every createObjectURL.
startMemoryMonitor()

// Catch unhandled errors globally
window.addEventListener('error', (e) => {
  log.error('global', `Unhandled error: ${e.message}`, { filename: e.filename, lineno: e.lineno, stack: e.error?.stack });
});
window.addEventListener('unhandledrejection', (e) => {
  log.error('global', `Unhandled promise rejection: ${e.reason}`, { stack: e.reason?.stack });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
