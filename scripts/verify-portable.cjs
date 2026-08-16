#!/usr/bin/env node
/* Self-verification for dist:portable: run the actual portable artifact with
 * --smoke and fail the build unless the full smoke suite passes. */
const { spawnSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const RELEASE = join(__dirname, '..', 'release')
const exe = join(RELEASE, '2G_3G_4G_QoS.exe')
if (!existsSync(exe)) {
  console.error('verify-portable: exe not found: ' + exe)
  process.exit(1)
}
// The portable 7z SFX wrapper swallows the child's stdout, so the smoke
// suite writes smoke_ok.marker next to the exe when it completes.
const MARKER = join(RELEASE, 'smoke_ok.marker')
rmSync(MARKER, { force: true })
const r = spawnSync(exe, ['--smoke'], { encoding: 'utf8', timeout: 300_000, cwd: RELEASE })
const out = (r.stdout ?? '') + (r.stderr ?? '')
// NOTE: capture success BEFORE cleanup — the marker is written by the app
const ok = existsSync(MARKER)
// keep the release folder clean
for (const f of ['smoke_ok.marker', 'app_state.json']) {
  try {
    rmSync(join(RELEASE, f), { force: true })
  } catch {
    /* ignore */
  }
}
if (ok) {
  console.log('verify-portable: SMOKE_OK (marker present)')
} else {
  console.error('verify-portable: FAILED — no smoke_ok.marker after running ' + exe)
  if (out.trim()) console.error(out.slice(-2000))
  process.exit(1)
}
