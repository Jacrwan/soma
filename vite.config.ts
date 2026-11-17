import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { dashboardV2Enabled } from './config/dashboardV2'
import { blogPlugin } from './config/blog'
// Epoch Study Hall AI on localhost with no sign-in (dev only, server-side key).
import { epochPractice } from './game/server/practice-api.js'

export default defineConfig(({ mode }) => ({
  define: {
    __DASHBOARD_V2_ENABLED__: JSON.stringify(dashboardV2Enabled({
      ...loadEnv(mode, process.cwd(), ''),
      ...process.env,
    })),
  },
  plugins: [react(), blogPlugin(), epochPractice()],
  // The Epoch game is its own page (game.html), outside the React app.
  build: { rollupOptions: { input: { main: 'index.html', game: 'game.html' } } },
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
}))
