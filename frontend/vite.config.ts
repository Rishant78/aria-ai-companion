import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Disable runtime dependency auto-discovery. With all external dependencies explicitly
    // declared in `include`, Vite uses `createExplicitDepsOptimizer`. This permanently prevents
    // mid-flight background re-optimization, avoids NTFS directory swapping failures (EPERM)
    // on Windows, and eliminates HTTP 504 (Outdated Optimize Dep) white-screen errors.
    noDiscovery: true,
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'three',
      'three/examples/jsm/controls/OrbitControls.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      '@pixiv/three-vrm',
    ],
    // Fallback protection against race conditions on outdated query hashes.
    ignoreOutdatedRequests: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
