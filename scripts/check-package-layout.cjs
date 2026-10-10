#!/usr/bin/env node
/* Checks that a packaged app's resources folder holds what the import needs at
 * runtime: the DuckDB API and the DuckDB engine for the target platform
 * unpacked next to app.asar, no engines for other platforms, and the import
 * and forecast process scripts (out/main/*Worker-*.js) inside app.asar, with nothing
 * but the app at its top level. Used by verify-portable.cjs (Windows build)
 * and smoke-packaged.cjs (Linux build).
 *
 *   node scripts/check-package-layout.cjs <resourcesDir> <win32|linux>  */
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const ENGINE = { win32: 'node-bindings-win32-x64', linux: 'node-bindings-linux-x64' }
// the only top-level entries app.asar may hold (build.files plus node_modules)
const ASAR_TOP_LEVEL = new Set(['build', 'out', 'package.json', 'node_modules'])

/** Problems found, as readable sentences; empty when the layout is good. */
function checkPackageLayout(resourcesDir, platform) {
  const problems = []
  const asar = join(resourcesDir, 'app.asar')
  const duck = join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@duckdb')
  if (!existsSync(asar)) return [`no app.asar in ${resourcesDir}`]
  if (!existsSync(join(duck, 'node-api', 'package.json'))) problems.push('@duckdb/node-api is not unpacked next to app.asar')
  if (!existsSync(join(duck, 'node-bindings', 'package.json'))) problems.push('@duckdb/node-bindings is not unpacked next to app.asar')
  const engine = ENGINE[platform]
  if (!engine) return [`unknown platform ${platform}`]
  if (!existsSync(join(duck, engine, 'duckdb.node'))) problems.push(`the ${platform} DuckDB engine (${engine}/duckdb.node) is missing`)
  const present = existsSync(duck) ? readdirSync(duck) : []
  const foreign = present.filter((d) => d.startsWith('node-bindings-') && d !== engine)
  if (foreign.length > 0) problems.push(`engines for other platforms are packaged: ${foreign.join(', ')}`)
  const { listPackage } = require('@electron/asar')
  const files = listPackage(asar).map((p) => p.replace(/\\/g, '/'))
  // a platform `files` list replaces the top-level one, so a list of only
  // exclusions packs the whole project (sources, workspaces, backups, notes)
  const stray = [...new Set(files.map((p) => p.split('/')[1]))].filter((top) => !ASAR_TOP_LEVEL.has(top))
  if (stray.length > 0) problems.push(`app.asar holds files that are not part of the app: ${stray.join(', ')}`)
  if (!files.some((p) => /\/out\/main\/(chunks\/)?importWorker-[^/]+\.js$/.test(p))) {
    problems.push('the import process script (out/main/importWorker-*.js) is not in app.asar')
  }
  if (!files.some((p) => /\/out\/main\/(chunks\/)?forecastWorker-[^/]+\.js$/.test(p))) {
    problems.push('the forecast process script (out/main/forecastWorker-*.js) is not in app.asar')
  }
  return problems
}

/** The fuses the app ships with (Electron hardening spec §4.4), by the
 *  @electron/fuses option name. */
const EXPECTED_FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  OnlyLoadAppFromAsar: true,
  EnableEmbeddedAsarIntegrityValidation: true
}

/** Fuses of the Electron binary that differ from `expected`, as sentences. */
async function checkFuses(binaryPath, expected = EXPECTED_FUSES) {
  const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses')
  const wire = await getCurrentFuseWire(binaryPath)
  const ENABLE = 49 // FuseState.ENABLE ('1'); DISABLE is 48 ('0')
  return Object.entries(expected)
    .filter(([name, on]) => (wire[FuseV1Options[name]] === ENABLE) !== on)
    .map(([name, on]) => `fuse ${name} should be ${on ? 'on' : 'off'}`)
}

module.exports = { checkPackageLayout, checkFuses, EXPECTED_FUSES }

if (require.main === module) {
  const [resourcesDir, platform] = process.argv.slice(2)
  if (!resourcesDir || !platform) {
    console.error('usage: check-package-layout.cjs <resourcesDir> <win32|linux>')
    process.exit(2)
  }
  const problems = checkPackageLayout(resourcesDir, platform)
  for (const p of problems) console.error(`check-package-layout: ${p}`)
  if (problems.length === 0) console.log(`check-package-layout: ${platform} layout OK (${resourcesDir})`)
  process.exit(problems.length === 0 ? 0 : 1)
}
