const { existsSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = join(__dirname, '..')
const releaseDir = join(root, 'release')
const unpackedDir = join(releaseDir, 'win-unpacked')
const zipFile = join(releaseDir, '2G_3G_4G_QoS_Portable_Folder.zip')

if (!existsSync(unpackedDir)) {
  console.error('zip-portable-folder: win-unpacked directory not found at ' + unpackedDir)
  process.exit(1)
}

console.log('zip-portable-folder: Compressing win-unpacked into 2G_3G_4G_QoS_Portable_Folder.zip...')

const script = `
import zipfile, os, sys

src_dir = sys.argv[1]
zip_path = sys.argv[2]

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root_dir, dirs, files in os.walk(src_dir):
        for file in files:
            full_path = os.path.join(root_dir, file)
            rel_path = os.path.relpath(full_path, src_dir)
            arcname = os.path.join("2G_3G_4G_QoS_Portable", rel_path)
            zf.write(full_path, arcname)
`

const py = spawnSync('python3', ['-c', script, unpackedDir, zipFile], { encoding: 'utf8' })
if (py.status !== 0) {
  console.error('zip-portable-folder: Failed to create zip archive: ' + py.stderr)
  process.exit(1)
}

const sizeMb = (statSync(zipFile).size / (1024 * 1024)).toFixed(2)
console.log(`zip-portable-folder: ZIP_OK — Created portable folder archive: ${zipFile} (${sizeMb} MB)`)
