import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { applyStrictCsp } from './shared/csp'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: 'src/main/index.ts' }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: 'src/preload/index.ts' }
    }
  },
  renderer: {
    root: 'src/renderer',
    // the packaged page gets the strict CSP (Electron hardening spec §4.3);
    // the dev server keeps the relaxed one in index.html for hot reload
    plugins: [react(), { name: 'strict-csp', apply: 'build', transformIndexHtml: applyStrictCsp }],
    build: { outDir: 'out/renderer' }
  }
})
