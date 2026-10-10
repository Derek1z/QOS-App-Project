#!/usr/bin/env node
/* Checks that the Windows exe carries the shipped fuses and a correct
 * archive-integrity record:
 * the INTEGRITY/ELECTRONASAR resource must list resources\app.asar with the
 * SHA-256 of that archive's header. With the EnableEmbeddedAsarIntegrityValidation
 * fuse on, Electron refuses to start when this record is missing or wrong
 * (Electron hardening spec §4.4, §6 item 5).
 *
 *   node scripts/check-win-integrity.cjs <win-unpacked dir>  */
const { readFileSync, readdirSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { createHash } = require('node:crypto')

const dir = process.argv[2] && resolve(process.argv[2])
const fail = (msg) => {
  console.error(`check-win-integrity: ${msg}`)
  process.exit(1)
}
if (!dir || !existsSync(dir)) fail('usage: check-win-integrity.cjs <win-unpacked dir>')

const exeName = readdirSync(dir).find((f) => f.toLowerCase().endsWith('.exe') && !/uninstall|elevate/i.test(f))
if (!exeName) fail(`no .exe in ${dir}`)
const asarPath = join(dir, 'resources', 'app.asar')
if (!existsSync(asarPath)) fail(`no resources/app.asar in ${dir}`)

const ResEdit = require('resedit')
const exe = ResEdit.NtExecutable.from(readFileSync(join(dir, exeName)))
const entry = ResEdit.NtExecutableResource.from(exe).entries.find(
  (e) => String(e.type).toUpperCase() === 'INTEGRITY' && String(e.id).toUpperCase() === 'ELECTRONASAR'
)
if (!entry) fail(`${exeName} has no INTEGRITY/ELECTRONASAR resource`)

let records
try {
  records = JSON.parse(Buffer.from(entry.bin).toString('utf8'))
} catch (e) {
  fail(`the integrity resource is not JSON: ${e.message}`)
}
const record = (Array.isArray(records) ? records : []).find((r) => /resources[\\/]app\.asar$/i.test(r.file))
if (!record) fail('the integrity resource has no entry for resources\\app.asar')
if (String(record.alg).toUpperCase() !== 'SHA256') fail(`unexpected algorithm ${record.alg}`)

const { getRawHeader } = require('@electron/asar')
const actual = createHash('sha256').update(getRawHeader(asarPath).headerString).digest('hex')
if (record.value !== actual) fail(`hash mismatch: exe says ${record.value}, app.asar header is ${actual}`)
console.log(`check-win-integrity: ${exeName} carries the correct integrity record for app.asar (${actual.slice(0, 12)}…)`)

const { checkFuses } = require('./check-package-layout.cjs')
checkFuses(join(dir, exeName)).then((problems) => {
  if (problems.length > 0) fail(problems.join('; '))
  console.log(`check-win-integrity: ${exeName} carries the shipped fuses`)
}, (e) => fail(`could not read fuses: ${e.message}`))
