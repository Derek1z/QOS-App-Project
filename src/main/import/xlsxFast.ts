import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { createInflateRaw } from 'node:zlib'
import type { CsvSample } from './csv'
import { excelSerialToText } from './excel'

/**
 * Fast sample reader for large .xlsx files. Real NCA dashboards are 20MB+
 * workbooks whose sheets use Excel's compact cell format (no cell addresses),
 * which exceljs's streaming reader cannot parse and whose full in-memory load
 * takes ~30s. Instead of loading the whole workbook, this reads only the first
 * first rows of the relevant zip entries (sheet XML, shared strings, styles)
 * from the raw file, inflating only until the output bound is reached.
 */

// --- minimal ZIP reader (central directory) --------------------------------

interface ZipEntry {
  localOffset: number
  compSize: number
  method: number
}

function readZipEntries(fd: number, want: Set<string>): Map<string, ZipEntry> {
  const size = fstatSync(fd).size
  const tailLen = Math.min(size, 65557)
  const tail = Buffer.alloc(tailLen)
  readSync(fd, tail, 0, tailLen, size - tailLen)
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive (end-of-central-directory not found)')
  const cdOffset = tail.readUInt32LE(eocd + 16)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cd = Buffer.alloc(cdSize)
  readSync(fd, cd, 0, cdSize, cdOffset)
  const out = new Map<string, ZipEntry>()
  let pos = 0
  while (pos + 46 <= cd.length) {
    if (cd.readUInt32LE(pos) !== 0x02014b50) break
    const method = cd.readUInt16LE(pos + 10)
    const compSize = cd.readUInt32LE(pos + 20)
    const nameLen = cd.readUInt16LE(pos + 28)
    const extraLen = cd.readUInt16LE(pos + 30)
    const commentLen = cd.readUInt16LE(pos + 32)
    const localOffset = cd.readUInt32LE(pos + 42)
    const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen)
    if (want.has(name)) out.set(name, { localOffset, compSize, method })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** Decompress just the start of a stored/deflated zip entry. */
async function inflatePrefix(
  fd: number,
  entry: ZipEntry,
  maxOut: number
): Promise<Buffer> {
  const lh = Buffer.alloc(30)
  readSync(fd, lh, 0, 30, entry.localOffset)
  const nameLen = lh.readUInt16LE(26)
  const extraLen = lh.readUInt16LE(28)
  const dataStart = entry.localOffset + 30 + nameLen + extraLen

  if (entry.method === 0) {
    // stored (no compression)
    const n = Math.min(entry.compSize, maxOut)
    const raw = Buffer.alloc(n)
    readSync(fd, raw, 0, n, dataStart)
    return raw
  }

  const inflater = createInflateRaw()
  const outs: Buffer[] = []
  let total = 0
  const pump = (async () => {
    try {
      for await (const c of inflater) {
        outs.push(c)
        total += c.length
        if (total >= maxOut) {
          inflater.destroy()
          break
        }
      }
    } catch {
      // truncated deflate stream is expected — keep what we got
    }
    return Buffer.concat(outs)
  })()

  const buf = Buffer.alloc(64 * 1024)
  let pos = dataStart
  let remaining = entry.compSize
  while (remaining > 0 && !inflater.destroyed) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, remaining), pos)
    if (n <= 0) break
    pos += n
    remaining -= n
    // copy: zlib may hold the input by reference (backpressure), so a reused buffer corrupts the stream
    inflater.write(Buffer.from(buf.subarray(0, n)))
  }
  try {
    inflater.end()
  } catch {
    /* already destroyed */
  }
  return pump
}

// --- tiny XML helpers (indexOf scanning — no regex needed) ----------------

function decodeXml(s: string): string {
  let out = s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  const entities: Record<string, string> = {
    '&quot;': '"',
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&'
  }
  for (const [k, v] of Object.entries(entities)) out = out.split(k).join(v)
  return out
}

function nextTag(text: string, from: number, open: string, close: string): { start: number; end: number } | null {
  const start = text.indexOf(open, from)
  if (start < 0) return null
  const end = text.indexOf(close, start)
  if (end < 0) return null
  return { start, end: end + close.length }
}

function attr(text: string, name: string): string | null {
  const needle = name + '="'
  const i = text.indexOf(needle)
  if (i < 0) return null
  const j = text.indexOf('"', i + needle.length)
  if (j < 0) return null
  return text.slice(i + needle.length, j)
}

function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// --- part parsers ----------------------------------------------------------

/** First sheet's worksheet path from workbook.xml + its rels (default sheet1). */
function firstSheetFile(wbXml: string, relsXml: string): string {
  const sheet = /<sheet [^>]*r:id="([^"]+)"/.exec(wbXml)
  if (!sheet) return 'xl/worksheets/sheet1.xml'
  const rel = new RegExp('Relationship Id="' + sheet[1] + '"[^>]*Target="([^"]+)"').exec(relsXml)
  if (!rel) return 'xl/worksheets/sheet1.xml'
  let t = rel[1]
  if (t.startsWith('/')) t = t.slice(1)
  else if (!t.startsWith('xl/')) t = 'xl/' + t
  return t
}

/** Shared strings from a prefix of sharedStrings.xml (plain + rich text). */
function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  let pos = 0
  for (;;) {
    const si = nextTag(xml, pos, '<si>', '</si>')
    if (!si) break
    const body = xml.slice(si.start + 4, si.end - 5)
    const texts: string[] = []
    let p = 0
    for (;;) {
      const t = nextTag(body, p, '<t', '>')
      if (!t) break
      const tEnd = nextTag(body, t.end, '</t>', '</t>')
      if (!tEnd) break
      texts.push(body.slice(t.end, tEnd.start))
      p = tEnd.end
    }
    out.push(decodeXml(texts.join('')))
    pos = si.end
  }
  return out
}

/** Style indexes whose number format renders a date/time. */
function parseDateStyleIndexes(xml: string): Set<number> {
  const custom = new Map<number, string>()
  let pos = 0
  for (;;) {
    const nf = nextTag(xml, pos, '<numFmt ', '>')
    if (!nf) break
    const seg = xml.slice(nf.start, nf.end)
    const id = attr(seg, 'numFmtId')
    const code = attr(seg, 'formatCode')
    if (id && code) custom.set(Number(id), decodeXml(code))
    pos = nf.end
  }
  const isDate = (id: number): boolean => {
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true
    const code = custom.get(id)
    if (!code) return false
    const stripped = code.replace(/"[^"]*"/g, '')
    return /[ymdhs]/.test(stripped)
  }
  const out = new Set<number>()
  const cx = xml.indexOf('<cellXfs')
  if (cx < 0) return out
  const end = xml.indexOf('</cellXfs>', cx)
  const section = end > cx ? xml.slice(cx, end) : xml.slice(cx)
  let idx = 0
  let p = 0
  for (;;) {
    const xf = nextTag(section, p, '<xf ', '>')
    if (!xf) break
    const id = attr(section.slice(xf.start, xf.end), 'numFmtId')
    if (id && isDate(Number(id))) out.add(idx)
    idx++
    p = xf.end
  }
  return out
}

// --- row parsing -----------------------------------------------------------

interface RawRow {
  cells: Array<string | null>
}

function parseSheetRows(
  xml: string,
  sharedStrings: string[],
  dateStyles: Set<number>
): { header: string[]; rows: RawRow[] } {
  const rows: RawRow[] = []
  let pos = 0
  for (;;) {
    const rowOpen = nextTag(xml, pos, '<row ', '>')
    if (!rowOpen) break
    const rowEnd = nextTag(xml, rowOpen.end, '</row>', '</row>')
    if (!rowEnd) break
    const rowXml = xml.slice(rowOpen.end, rowEnd.start)
    const cells: Array<string | null> = []
    let p = 0
    for (;;) {
      const cOpen = nextTag(rowXml, p, '<c ', '>')
      if (!cOpen) break
      const cEnd = nextTag(rowXml, cOpen.end, '</c>', '</c>')
      if (!cEnd) break
      const openTag = rowXml.slice(cOpen.start, cOpen.end)
      const body = rowXml.slice(cOpen.end, cEnd.start)
      const rRef = attr(openTag, 'r')
      const tType = attr(openTag, 't')
      const sIdx = attr(openTag, 's')
      const v = nextTag(body, 0, '<v>', '</v>')
      const is = nextTag(body, 0, '<is>', '</is>')
      let text: string | null = null
      if (tType === 's' && v) {
        const idx = Number(body.slice(v.start + 3, v.end - 4).trim())
        text = sharedStrings[idx] ?? null
      } else if (tType === 'inlineStr' && is) {
        const inner = body.slice(is.start + 4, is.end - 5)
        const t = nextTag(inner, 0, '<t', '>')
        const tClose = t ? nextTag(inner, t.end, '</t>', '</t>') : null
        text = t ? decodeXml(inner.slice(t.end, tClose?.start ?? inner.length)) : ''
      } else if (v) {
        const raw = body.slice(v.start + 3, v.end - 4)
        if (sIdx && dateStyles.has(Number(sIdx)) && /^-?[0-9]+(\.[0-9]+)?$/.test(raw)) {
          text = excelSerialToText(Number(raw))
        } else {
          text = decodeXml(raw)
        }
      } else {
        text = ''
      }
      const idx = rRef ? colIndex(rRef.replace(/[0-9]+$/, '')) : cells.length
      while (cells.length < idx) cells.push(null)
      cells[idx] = text
      p = cEnd.end
    }
    rows.push({ cells })
    pos = rowEnd.end
  }
  const header = rows[0] ? rows[0].cells.map((c) => (c ?? '').trim()) : []
  return { header, rows }
}

// --- public entry point ----------------------------------------------------

/** Sample an .xlsx by reading only the start of its zip entries. Throws when
 *  the file is not a readable workbook, so callers can fall back. */
export async function readExcelSampleFast(path: string, maxRows: number): Promise<CsvSample> {
  const fd = openSync(path, 'r')
  try {
    const firstPass = readZipEntries(fd, new Set([
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels'
    ]))
    let sheetFile = 'xl/worksheets/sheet1.xml'
    if (firstPass.has('xl/workbook.xml') && firstPass.has('xl/_rels/workbook.xml.rels')) {
      const wbBuf = await inflatePrefix(fd, firstPass.get('xl/workbook.xml')!, 64 * 1024)
      const relsBuf = await inflatePrefix(fd, firstPass.get('xl/_rels/workbook.xml.rels')!, 64 * 1024)
      sheetFile = firstSheetFile(wbBuf.toString('utf8'), relsBuf.toString('utf8'))
    }
    const entries = readZipEntries(fd, new Set([sheetFile, 'xl/sharedStrings.xml', 'xl/styles.xml']))
    if (!entries.has(sheetFile)) throw new Error('Worksheet entry not found: ' + sheetFile)
    const sheetXml = (await inflatePrefix(fd, entries.get(sheetFile)!, 256 * 1024)).toString('utf8')
    const sharedStrings = entries.has('xl/sharedStrings.xml')
      ? parseSharedStrings((await inflatePrefix(fd, entries.get('xl/sharedStrings.xml')!, 256 * 1024)).toString('utf8'))
      : []
    const dateStyles = entries.has('xl/styles.xml')
      ? parseDateStyleIndexes((await inflatePrefix(fd, entries.get('xl/styles.xml')!, 64 * 1024)).toString('utf8'))
      : new Set<number>()
    const { header, rows } = parseSheetRows(sheetXml, sharedStrings, dateStyles)
    if (header.length === 0) throw new Error('No rows found in first worksheet')
    const width = header.length
    const sample = rows.slice(1, 1 + maxRows).map((r) => {
      const out: string[] = new Array(width).fill('')
      for (let i = 0; i < width; i++) out[i] = r.cells[i] ?? ''
      return out
    })
    return { header, rows: sample }
  } finally {
    closeSync(fd)
  }
}
