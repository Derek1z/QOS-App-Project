import { defineConfig } from 'vitest/config'

/** `?modulePath` imports (electron-vite: the path of a utility-process entry)
 *  would otherwise load the entry module itself in tests, which then reads
 *  process.parentPort at import time. Tests get a placeholder path instead;
 *  the real fork is exercised by the smoke test and the packaged build. */
export default defineConfig({
  plugins: [
    {
      name: 'module-path-stub',
      enforce: 'pre',
      resolveId(id) {
        return id.endsWith('?modulePath') ? `\0module-path:${id}` : null
      },
      load(id) {
        return id.startsWith('\0module-path:') ? 'export default "module-path-stub"' : null
      }
    }
  ]
})
