import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // maplibre-gl v6 loads its worker relative to its own module file; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: {
    rolldownOptions: {
      // The service worker is its own entry with a stable name so it can be registered at /sw.js.
      input: { main: 'index.html', sw: 'src/offline/sw.ts' },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // Canonical routes need a built data directory: run them with `npm run test:routes`.
    exclude: [...configDefaults.exclude, ...(process.env.INTERWAY_DATA ? [] : ['src/routing/canonical.test.ts'])],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
      thresholds: { 100: true },
    },
  },
})
