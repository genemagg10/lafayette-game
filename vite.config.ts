import { defineConfig } from 'vite'

export default defineConfig({
  // Relative so a dist folder works at a domain root and under /lafayette-game/.
  base: './',
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  server: { host: '127.0.0.1', port: 4731, strictPort: true },
  preview: { host: '127.0.0.1', port: 4731, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      treeshake: {
        // three's package marks only src/nodes as side-effectful. The build
        // entry is build/three.webgpu.js, so Rollup otherwise drops the TSL
        // prototype setup (swizzles and oneMinus) and materials throw.
        moduleSideEffects: (id) => (id.includes('node_modules/three/') ? true : undefined),
      },
    },
  },
})
