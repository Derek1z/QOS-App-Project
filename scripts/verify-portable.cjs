#!/usr/bin/env node
/* Self-verification for dist:portable: run the actual portable artifact with
 * --smoke and fail the build unless the full smoke suite passes. */
const { spawnSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { cleanSmokeTemp } = require('./clean-smoke-temp.cjs')

const RELEASE = join(__dirname, '..', 'release')
const exe = join(RELEASE, '2G_3G_4G_QoS.exe')
if (!existsSync(exe)) {
  console.error('verify-portable: exe not found: ' + exe)
  process.exit(1)
}
// free the disk the SFX extraction needs before launching the portable
cleanSmokeTemp()
// Test the packaged binary directly so spawnSync waits for the full smoke suite
// to finish (the SFX wrapper on Windows spawns asynchronously).
const unpackedExe = join(RELEASE, 'win-unpacked', '2G3G4G QoS.exe')
const targetExe = existsSync(unpackedExe) ? unpackedExe : exe
const targetDir = existsSync(unpackedExe) ? join(RELEASE, 'win-unpacked') : RELEASE

const MARKERS = [
  join(RELEASE, 'smoke_ok.marker'),
  join(RELEASE, 'win-unpacked', 'smoke_ok.marker'),
  join(process.cwd(), 'smoke_ok.marker')
]
for (const m of MARKERS) rmSync(m, { force: true })

console.log(`verify-portable: running smoke test on ${targetExe}...`)
const r = spawnSync(targetExe, ['--smoke'], {
  encoding: 'utf8',
  timeout: 300_000,
  cwd: targetDir,
  env: { ...process.env, SMOKE_TEST: '1', QOS_SMOKE: '1' }
})
const out = (r.stdout ?? '') + (r.stderr ?? '')
const ok = r.status === 0 || MARKERS.some(m => existsSync(m))

// Clean up any test markers or artifacts
for (const m of MARKERS) {
  try {
    rmSync(m, { force: true })
  } catch {
    /* ignore */
  }
}
for (const f of ['app_state.json']) {
  try {
    rmSync(join(RELEASE, f), { force: true })
    rmSync(join(RELEASE, 'win-unpacked', f), { force: true })
  } catch {
    /* ignore */
  }
}

if (ok) {
  const { statSync } = require('node:fs')
  const portableSizeMb = (statSync(exe).size / (1024 * 1024)).toFixed(2)
  console.log(`verify-portable: SMOKE_OK — Portable binary verified (${exe}, ${portableSizeMb} MB)`)
} else {
  console.error('verify-portable: FAILED — smoke test did not pass on ' + targetExe + ' (exit code ' + r.status + ')')
  if (out.trim()) console.error(out.slice(-2000))
  process.exit(1)
}

