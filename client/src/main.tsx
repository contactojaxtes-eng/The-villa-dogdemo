import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import App from './App'
import { NotificationToaster } from './components/layout/NotificationToaster'
import './index.css'
import Swal from 'sweetalert2'

// JAXTES styling helper for alerts
const getSwalAlertConfig = (title: string, text: string, icon: 'success' | 'error' | 'warning' | 'info') => {
  const isDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')
  
  return {
    title,
    text,
    icon,
    target: document.body,
    heightAuto: false,
    returnFocus: false,
    background: isDark ? '#1b1b1f' : '#ffffff',
    color: isDark ? '#ffffff' : '#1c1c1e',
    confirmButtonColor: '#145AEC',
    confirmButtonText: 'Aceptar',
    buttonsStyling: true,
    customClass: {
      container: 'font-sans z-[99999]',
      popup: 'rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl p-6 font-sans',
      title: 'antifont text-xl font-black tracking-wide text-[var(--text-primary)]',
      htmlContainer: 'text-xs text-[var(--text-secondary)] font-medium leading-relaxed mt-2',
      confirmButton: 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold px-6 py-2.5 rounded-xl shadow-md transition-all outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:ring-offset-2 cursor-pointer',
    }
  }
}

// Override alert
window.alert = (message: any) => {
  const msgStr = String(message)
  let title = 'Notificación'
  let icon: 'success' | 'error' | 'warning' | 'info' = 'info'
  
  const lower = msgStr.toLowerCase()
  if (lower.includes('éxito') || lower.includes('exito') || lower.includes('correcto') || lower.includes('guardado') || lower.includes('confirmado') || lower.includes('creado') || lower.includes('liquidado')) {
    title = '¡Éxito!'
    icon = 'success'
  } else if (lower.includes('error') || lower.includes('falló') || lower.includes('no se pudo') || lower.includes('denegado') || lower.includes('inválido') || lower.includes('cuidado') || lower.includes('obligatorio') || lower.includes('cerrada') || lower.includes('debes abrir')) {
    title = 'Atención'
    icon = 'warning'
    if (lower.includes('error') || lower.includes('falló')) {
      title = 'Error'
      icon = 'error'
    }
  }
  
  Swal.fire(getSwalAlertConfig(title, msgStr, icon) as any)
}


// Capturar desactualización de assets tras nuevos despliegues y recargar limpiamente
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

import { ErrorBoundary } from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <NotificationToaster />
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
