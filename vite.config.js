import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works under https://fallais.github.io/wing-lift/.
  base: './',
  // The particle worker is created with { type: 'module' }.
  worker: { format: 'es' },
  build: {
    // The lazily loaded 3D chunk is mostly three.js (~145 kB gzipped).
    chunkSizeWarningLimit: 600,
  },
});
