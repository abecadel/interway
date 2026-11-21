// Bundles the route service (src/service) for Node: one file, dependencies included (see service/Dockerfile).
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/service/main.ts',
    outDir: 'dist-service',
    target: 'node20',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
  ssr: { noExternal: true, target: 'node' },
});
