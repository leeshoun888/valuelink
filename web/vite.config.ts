import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the same build runs from GitHub Pages, a Node server, and the APK's
// WebViewAssetLoader (https://appassets.androidplatform.net/assets/web/).
export default defineConfig({
  base: './',
  plugins: [react()],
  // maplibre-gl v6 spawns a module worker relative to its own file; pre-bundling breaks that URL.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8790' },
  },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('maplibre')) return 'map'
          if (id.includes('three') || id.includes('@react-three') || id.includes('postprocessing')) return 'three'
        },
      },
    },
  },
})
