import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/app/' for production builds only — served by Firebase Hosting under /app/
// build.outDir: '../web/app' — outputs directly into the folder firebase.json deploys from
// emptyOutDir: true — clears stale assets on each build

const BUILD_ID = Date.now().toString()

function versionJsonPlugin(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: BUILD_ID }),
      })
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), versionJsonPlugin()],
  build: {
    outDir: '../web/app',
    emptyOutDir: true,
  },
}))
