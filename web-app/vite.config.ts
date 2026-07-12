import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/app/' for production builds only — served by Firebase Hosting under /app/
// build.outDir: '../web/app' — outputs directly into the folder firebase.json deploys from
// emptyOutDir: true — clears stale assets on each build

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',
  plugins: [react()],
  build: {
    outDir: '../web/app',
    emptyOutDir: true,
  },
}))
