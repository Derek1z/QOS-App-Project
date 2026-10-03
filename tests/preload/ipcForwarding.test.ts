import { describe, it, expect, vi, beforeAll } from 'vitest'

type Bridge = Record<string, Record<string, (...args: unknown[]) => unknown>>

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]) => undefined),
  api: null as Bridge | null
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Bridge) => {
      h.api = api
    }
  },
  ipcRenderer: { invoke: h.invoke, on: vi.fn(), removeListener: vi.fn() },
  webUtils: { getPathForFile: vi.fn() }
}))

// wrappers that are not request/response IPC calls
const NOT_INVOKE = new Set(['files.path', 'imports.onProgress', 'workspace.onChanged', 'analytics.onForecastProgress'])

describe('preload IPC bridge', () => {
  beforeAll(async () => {
    await import('../../src/preload/index')
  })

  it('forwards every argument of every IPC wrapper unchanged', async () => {
    const mismatched: string[] = []
    for (const [ns, methods] of Object.entries(h.api!)) {
      for (const [name, fn] of Object.entries(methods)) {
        const id = `${ns}.${name}`
        if (NOT_INVOKE.has(id)) continue
        h.invoke.mockClear()
        await fn('arg1', 'arg2', 'arg3', 'arg4')
        const forwarded = (h.invoke.mock.calls[0] ?? []).slice(1)
        if (JSON.stringify(forwarded) !== '["arg1","arg2","arg3","arg4"]') {
          mismatched.push(`${id} -> ${JSON.stringify(forwarded)}`)
        }
      }
    }
    expect(mismatched).toEqual([])
  })
})
