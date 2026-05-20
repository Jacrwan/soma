import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/canvas-api': {
        target: 'https://djusd.instructure.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/canvas-api/, ''),
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
