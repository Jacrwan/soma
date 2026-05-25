import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: { outDir: 'dist/app' },
  server: {
    host: true,
    proxy: {
      '/canvas-api': {
        target: 'https://djusd.instructure.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/canvas-api/, ''),
      },
    },
  },
})
