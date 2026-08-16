#!/usr/bin/env node
/* Remove stale qos-smoke-* scratch directories left in the OS temp folder by
 * past smoke runs. Each run of --smoke creates a qos-smoke-XXXXXX workspace
 * (src/main/index.ts) that a crashed or interrupted run leaves behind; they
 * accumulate and consume the disk the portable SFX needs to extract, which
 * made verify-portable race the disk. Runs at the start of every build. */
const { readdirSync, statSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const PREFIX = 'qos-smoke-'
// Never delete a directory touched in the last 10 minutes — a smoke run (or a
// manually launched app) could still be writing to it.
const FRESH_MS = 10 * 60 * 1000

function cleanSmokeTemp(opts = {}) {
  const now = Date.now()
  let removed = 0
  try {
    const root = tmpdir()
    for (const name of readdirSync(root)) {
      if (!name.startsWith(PREFIX)) continue
      const p = join(root, name)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (!st.isDirectory()) continue
      if (!opts.all && now - st.mtimeMs < FRESH_MS) continue
      try {
        rmSync(p, { recursive: true, force: true })
        removed++
      } catch {
        /* locked by a live run — leave it */
      }
    }
  } catch {
    /* temp folder unavailable — nothing to clean */
  }
  if (removed > 0) console.log(`clean-smoke-temp: removed ${removed} stale qos-smoke-* dir(s)`)
  return removed
}

if (require.main === module) cleanSmokeTemp()
module.exports = { cleanSmokeTemp }
