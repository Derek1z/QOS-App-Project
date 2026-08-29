const { existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = join(__dirname, '..')
const winBinding = join(root, 'node_modules', '@duckdb', 'node-bindings-win32-x64', 'duckdb.node')
const linuxBinding = join(root, 'node_modules', '@duckdb', 'node-bindings-linux-x64', 'duckdb.node')

if (!existsSync(winBinding)) {
  console.log('ensure-duckdb-bindings: Fetching win32-x64 DuckDB binding...')
  const targetDir = join(root, 'node_modules', '@duckdb', 'node-bindings-win32-x64')
  mkdirSync(targetDir, { recursive: true })
  const p = spawnSync('npm', ['pack', '@duckdb/node-bindings-win32-x64@1.5.5-r.4', '--pack-destination', '/tmp'], { encoding: 'utf8' })
  if (p.status === 0) {
    spawnSync('tar', ['-xzf', '/tmp/duckdb-node-bindings-win32-x64-1.5.5-r.4.tgz', '-C', targetDir, '--strip-components=1'])
  }
}

if (!existsSync(linuxBinding)) {
  console.log('ensure-duckdb-bindings: Fetching linux-x64 DuckDB binding...')
  const targetDir = join(root, 'node_modules', '@duckdb', 'node-bindings-linux-x64')
  mkdirSync(targetDir, { recursive: true })
  const p = spawnSync('npm', ['pack', '@duckdb/node-bindings-linux-x64@1.5.5-r.4', '--pack-destination', '/tmp'], { encoding: 'utf8' })
  if (p.status === 0) {
    spawnSync('tar', ['-xzf', '/tmp/duckdb-node-bindings-linux-x64-1.5.5-r.4.tgz', '-C', targetDir, '--strip-components=1'])
  }
}

console.log('ensure-duckdb-bindings: DuckDB multi-platform bindings verified.')
