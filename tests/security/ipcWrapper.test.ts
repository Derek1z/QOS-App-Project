import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Electron hardening spec §4.1: every IPC channel goes through the one
 *  sender-checked wrapper in ipc.ts. */

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? sources(p) : /\.ts$/.test(n) ? [p] : []
  })
}

const root = join(__dirname, '../../src/main')

describe('IPC registration', () => {
  it('ipc.ts calls ipcMain.handle exactly once, inside the checked wrapper', () => {
    const text = readFileSync(join(root, 'ipc.ts'), 'utf8')
    expect(text.match(/ipcMain\.handle\(/g)?.length).toBe(1)
    expect(text).toMatch(/assertTrustedSender\(e, channel\)/)
  })

  it('no other main-process file registers IPC channels directly', () => {
    const offenders = sources(root)
      .filter((f) => !f.endsWith('/ipc.ts'))
      .filter((f) => /ipcMain\.(handle|on)\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1))
    expect(offenders).toEqual([])
  })
})
