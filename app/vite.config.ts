import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // maplibre-gl v6 loads its worker relative to its own module file; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
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
