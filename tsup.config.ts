import { defineConfig } from 'tsup'

export default defineConfig([
  // Main entry (React + core)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', 'three', 'jszip'],
    treeshake: true,
    splitting: false,
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
  },
  // Core-only entry (no React)
  {
    entry: { core: 'src/core/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['three', 'jszip'],
    treeshake: true,
    splitting: false,
  },
])
