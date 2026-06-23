import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: '/app/' for production builds only — this build is served by Firebase
// Hosting under /app/ (see firebase.json rewrites), so asset URLs there must
// be rooted at /app/. Dev server stays at root for a simpler local workflow.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',
  plugins: [react()],
}))
