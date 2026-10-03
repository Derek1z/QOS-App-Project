import { runPacked, type PackedJobs } from './runner'

/** Entry of one forecast pool process (an Electron utility process, see
 *  utilityRunner.ts). Imports only the pure engine — never DuckDB — and
 *  answers each { id, jobs } (packed) message with { id, results } (packed)
 *  or { id, error }. */
process.parentPort.on('message', (e) => {
  const { id, jobs } = e.data as { id: number; jobs: PackedJobs }
  try {
    process.parentPort.postMessage({ id, results: runPacked(jobs) })
  } catch (err) {
    process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
})
