import { configDefaults, defineConfig } from 'vitest/config'

/** `?modulePath` imports (electron-vite: the path of a utility-process entry)
 *  would otherwise load the entry module itself in tests, which then reads
 *  process.parentPort at import time. Tests get a placeholder path instead;
 *  the real fork is exercised by the smoke test and the packaged build. */
export default defineConfig({
  test: {
    // setup hooks that build a real DuckDB workspace (schema + KPI seeds +
    // recompute) take 5-10 s on the development laptop when it is busy; the
    // default 10 s made them flaky
    hookTimeout: 30_000,
    // other sessions' git worktrees live under .claude/worktrees
    exclude: [...configDefaults.exclude, '.claude/**']
  },
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
