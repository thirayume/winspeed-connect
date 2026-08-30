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
        className="fixed bottom-3 right-3 z-[9999] rounded-full border-2 border-amber-950 bg-amber-300 px-4 py-2 text-sm font-bold tracking-wide text-amber-950 shadow-xl"
        role="status"
        aria-label="Test environment"
      >
        {environmentLabel} · ข้อมูลสำหรับทดสอบ
      </div>
    )}
  </StrictMode>,
)
