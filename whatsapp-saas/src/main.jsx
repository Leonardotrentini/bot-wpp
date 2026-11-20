import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './contexts/ToastContext.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { registerServiceWorker } from './lib/webPushClient.js'

// Deploy novo + cache: se um chunk hashed sumiu, recarrega 1x com index fresco.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const key = 'vesto:chunk-reload'
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      window.location.reload()
    }
  } catch {
    window.location.reload()
  }
})

// Clique em notificação push (service worker) → navega para a conversa.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data
    if (data?.type === 'VESTO_PUSH_NAV' && typeof data.url === 'string') {
      try {
        const path = data.url.startsWith('http') ? new URL(data.url).pathname + new URL(data.url).search : data.url
        window.location.assign(path)
      } catch {
        window.location.assign('/dashboard/chat')
      }
    }
  })
  void registerServiceWorker()
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
