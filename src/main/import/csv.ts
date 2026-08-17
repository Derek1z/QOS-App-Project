import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'

export interface CsvSample {
  header: string[]
  rows: string[][]
}

const CHUNK = 256 * 1024

/** Quote-aware single-record parser over `text` starting at `start`. */
function parseRecord(text: string, start: number): { fields: string[]; next: number; complete: boolean } {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  let i = start
  for (; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      fields.push(field)
      return { fields, next: i + 1, complete: true }
    } else {
      field += ch
    }
  }
  return { fields, next: i, complete: false }
}

/** Read the header plus up to `maxRows` data rows from a CSV file. */
export function readCsvSample(path: string, maxRows = 30): CsvSample {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`)
  const fd = openSync(path, 'r')
  try {
    let buf = Buffer.alloc(0)
    let offset = 0
    let parsed = 0
    const want = maxRows + 1 // header + maxRows rows
    const records: string[][] = []
    let eof = false

    while (records.length < want && !eof) {
      const chunk = Buffer.alloc(CHUNK)
      const n = readSync(fd, chunk, 0, CHUNK, offset)
      offset += n
      if (n === 0) {
        eof = true
      } else {
        // a short read means the file ends inside this chunk, so any
        // unterminated record parsed below is genuinely the last one
        if (n < CHUNK) eof = true
        buf = Buffer.concat([buf, chunk.subarray(0, n)])
      }
      const text = buf.toString('utf8')
      let start = 0
      // parse as many complete records as available
      for (;;) {
        const recStart = start
        const rec = parseRecord(text, start)
        if (!rec.complete) {
          // a record that runs to the end of the buffer is only dropped if
          // the file ended there without a trailing newline — re-parse it
          // with a synthetic newline so the final row is never lost
          if (eof && recStart < text.length && text.slice(recStart).trim() !== '') {
            const rec2 = parseRecord(text + '\n', recStart)
            if (rec2.complete) records.push(rec2.fields)
          }
          start = rec.next
          break
        }
        records.push(rec.fields)
        parsed++
        start = rec.next
        if (records.length >= want) break
      }
      // keep only the unparsed tail
      buf = Buffer.from(text.slice(start), 'utf8')
    }

    if (records.length === 0) return { header: [], rows: [] }
    const header = records[0].map((h) => h.trim())
    if (header.length > 0) header[0] = header[0].replace(/^\uFEFF/, '')
    const rows = records.slice(1).filter((r) => !(r.length === 1 && r[0].trim() === ''))
    void parsed
    return { header, rows }
  } finally {
    closeSync(fd)
  }
}

export function fileSize(path: string): number {
  return statSync(path).size
}
