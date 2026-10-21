import { unlinkSync } from 'node:fs'
import { defineConfig } from 'vite'

export default defineConfig({
  // Relative so a dist folder works at a domain root and under /lafayette-game/.
  base: './',
  resolve: {
    alias: [
      { find: 'three/webgpu', replacement: 'three/src/Three.WebGPU.js' },
      { find: 'three/tsl', replacement: 'three/src/nodes/TSL.js' },
      { find: /^three$/, replacement: 'three/src/Three.WebGPU.js' },
    ],
  },
  plugins: [
    {
      name: 'omit-bake-chunks',
      apply: 'build',
      closeBundle() {
        try {
          unlinkSync('dist/data/chunks.json')
        } catch {
          /* bake input only; players never fetch it */
        }
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4731, strictPort: true },
  preview: { host: '127.0.0.1', port: 4731, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      treeshake: {
        // Swizzles live in src/nodes. Keep those modules; the rest of three can shake.
        moduleSideEffects: (id) => (id.includes('/three/src/nodes/') ? true : undefined),
      },
    },
  },
})
