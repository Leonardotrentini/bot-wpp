import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Backend usado pelo proxy do dev server (evita CORS ao usar a API real em local).
const DEV_API_TARGET = process.env.DEV_API_TARGET || 'https://backend-production-7a466.up.railway.app'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: DEV_API_TARGET, changeOrigin: true },
      '/socket.io': { target: DEV_API_TARGET, changeOrigin: true, ws: true },
    },
  },
  preview: {
    host: true,
    port: parseInt(process.env.PORT || '4173', 10),
  },
})
