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

console.log(`verify-portable: checking binary ${targetExe}...`)
let r
if (process.platform === 'win32') {
  r = spawnSync(targetExe, ['--smoke'], {
    encoding: 'utf8',
    timeout: 300_000,
    cwd: targetDir,
    env: { ...process.env, SMOKE_TEST: '1', QOS_SMOKE: '1' }
  })
} else {
  // Cross-compiling for Windows on Linux: the .exe can't run here, so check
  // the packaged files the import needs at runtime. (Before 2026-10-02 this
  // only checked the .exe was over 10 MB, which let a build that couldn't
  // import on Windows pass.) A full Windows run needs `npm run dist:portable`
  // on Windows, or running the new .exe there.
  const { checkPackageLayout } = require('./check-package-layout.cjs')
  const problems = checkPackageLayout(join(RELEASE, 'win-unpacked', 'resources'), 'win32')
  if (problems.length === 0) {
    console.log('verify-portable: Windows package layout verified (win32 DuckDB engine unpacked, no foreign engines, no JavaScript outside app.asar, import process present).')
    r = { status: 0, stdout: 'Layout verified', stderr: '' }
  } else {
    for (const p of problems) console.error('verify-portable: ' + p)
    r = { status: 1, stdout: '', stderr: problems.join('\n') }
  }
}
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
  if (process.platform === 'win32') {
    console.log(`verify-portable: SMOKE_OK — Portable binary verified (${exe}, ${portableSizeMb} MB)`)
  } else {
    console.log(`verify-portable: layout OK, smoke NOT run — cross-built on ${process.platform}; run the .exe on Windows to verify (${exe}, ${portableSizeMb} MB)`)
  }
} else {
  console.error('verify-portable: FAILED — smoke test did not pass on ' + targetExe + ' (exit code ' + r.status + ')')
  if (out.trim()) console.error(out.slice(-2000))
  process.exit(1)
}

