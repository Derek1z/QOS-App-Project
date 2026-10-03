import { runJobs, type SeriesJob } from './runner'

/** Entry of one forecast pool process (an Electron utility process, see
 *  utilityRunner.ts). Imports only the pure engine — never DuckDB — and
 *  answers each { id, jobs } message with { id, results } or { id, error }. */
process.parentPort.on('message', (e) => {
  const { id, jobs } = e.data as { id: number; jobs: SeriesJob[] }
  try {
    process.parentPort.postMessage({ id, results: runJobs(jobs) })
  } catch (err) {
    process.parentPort.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
})
