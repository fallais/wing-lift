import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The latest git tag, e.g. v1.2.0, or v1.2.0-3-gabc1234 three commits later; the commit hash before any tag. */
function gitVersion(): string {
  try {
    return execSync('git describe --tags --always', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  // Relative asset paths, so the build works under https://fallais.github.io/wing-lift/.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(gitVersion()) },
  // The particle worker is created with { type: 'module' }.
  worker: { format: 'es' },
  build: {
    // The lazily loaded 3D chunk is mostly three.js (~145 kB gzipped).
    chunkSizeWarningLimit: 600,
  },
});
