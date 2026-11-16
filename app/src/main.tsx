import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// Configuration errors (a missing board address) surface as a page, not a blank screen.
import('./App')
  .then(({ App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((error: unknown) =>
    root.render(
      <div className="container" style={{ padding: '64px 24px' }}>
        <h1>CRISP Signal is not configured</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>,
    ),
  )
