import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setupGlobalAlert } from './components/ui/AppAlert.tsx'

setupGlobalAlert()

const isTestEnvironment = import.meta.env.VITE_APP_ENV === 'test'
const environmentLabel = import.meta.env.VITE_ENVIRONMENT_LABEL || 'TEST SYSTEM'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {isTestEnvironment && (
      <div
        className="pointer-events-none fixed top-1 left-1/2 z-[9999] -translate-x-1/2 whitespace-nowrap rounded-full border border-amber-700 bg-amber-100/95 px-2 py-0.5 text-[10px] font-semibold leading-4 tracking-wide text-amber-950 shadow-sm print:hidden"
        role="status"
        aria-label="ระบบทดสอบ — ข้อมูลสำหรับทดสอบ"
      >
        {environmentLabel}
      </div>
    )}
  </StrictMode>,
)
