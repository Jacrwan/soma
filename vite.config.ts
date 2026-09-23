import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { dashboardV2Enabled } from './config/dashboardV2'

export default defineConfig(({ mode }) => ({
  define: {
    __DASHBOARD_V2_ENABLED__: JSON.stringify(dashboardV2Enabled({
      ...loadEnv(mode, process.cwd(), ''),
      ...process.env,
    })),
  },
  plugins: [react()],
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
