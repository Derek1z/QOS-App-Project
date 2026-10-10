#!/usr/bin/env node
/* Runs the full smoke suite inside a packaged Linux build (app.asar +
 * app.asar.unpacked), the same layout the Windows portable runs from. The
 * normal `npm run smoke` runs the unpacked sources (`electron .`), so it never
 * exercises packaging; this does.
 *
 *   node scripts/smoke-packaged.cjs <linux-unpacked dir>  */
const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, readdirSync, rmSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { checkPackageLayout, checkFuses } = require('./check-package-layout.cjs')
const { cleanSmokeTemp } = require('./clean-smoke-temp.cjs')

const appDir = process.argv[2] && resolve(process.argv[2])
if (!appDir || !existsSync(appDir)) {
  console.error('usage: smoke-packaged.cjs <linux-unpacked dir>')
  process.exit(2)
}

const problems = checkPackageLayout(join(appDir, 'resources'), 'linux')
for (const p of problems) console.error(`smoke-packaged: ${p}`)
if (problems.length > 0) process.exit(1)

const exe = readdirSync(appDir)
  .map((f) => join(appDir, f))
  .find((f) => /2g-3g-4g-qos/i.test(f) && !f.endsWith('.so') && !f.endsWith('.pak'))
if (!exe) {
  console.error('smoke-packaged: no app executable in ' + appDir)
  process.exit(1)
}

// a throwaway home for app_state.json, config and cache: never the project's
const home = mkdtempSync(join(tmpdir(), 'qos-packaged-smoke-'))
const runtime = join(home, 'runtime')
mkdirSync(runtime, { recursive: true })
console.log(`smoke-packaged: running ${exe} --smoke ...`)
const r = spawnSync(exe, ['--smoke', '--no-sandbox', '--ozone-platform=headless', '--headless'], {
  cwd: home,
  encoding: 'utf8',
  timeout: 600_000,
  env: {
    ...process.env,
    PORTABLE_EXECUTABLE_DIR: home,
    XDG_RUNTIME_DIR: runtime,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    WAYLAND_DISPLAY: '',
    DISPLAY: ''
  }
})
const out = (r.stdout ?? '') + (r.stderr ?? '')
rmSync(home, { recursive: true, force: true })
cleanSmokeTemp()

if (r.status !== 0 || !out.includes('SMOKE_OK')) {
  console.error(out.split('\n').slice(-40).join('\n'))
  console.error(`smoke-packaged: FAILED (exit ${r.status}${r.error ? `, ${r.error.message}` : ''})`)
  process.exit(1)
}
console.log('smoke-packaged: packaged build passed the full smoke suite')
// Electron hardening spec §4.4: the binary carries the shipped fuses
checkFuses(exe).then((fuseProblems) => {
  for (const p of fuseProblems) console.error(`smoke-packaged: ${p}`)
  if (fuseProblems.length > 0) process.exit(1)
  console.log('smoke-packaged: fuses verified')
  process.exit(0)
}, (e) => {
  console.error(`smoke-packaged: could not read fuses: ${e.message}`)
  process.exit(1)
})
