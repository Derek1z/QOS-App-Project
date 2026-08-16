// Generates the 4G QoS app icon set with zero dependencies:
//   build/icon.png  — 512×512 source PNG
//   build/icon.ico  — multi-size ICO (256/128/64/48/32/16, PNG-compressed)
//   build/favicon.png — 32×32 PNG for the renderer tab
//
// Design: dark navy rounded square, four ascending signal bars (the app's
// antenna motif) — cyan for the first three, green on top for healthy signal.
// Every shape is drawn with 4× supersampling for smooth anti-aliased edges.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// --- minimal PNG encoder (RGBA, 8-bit, no interlace) ------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const p of pngs) {
    const e = Buffer.alloc(16)
    e[0] = p.size >= 256 ? 0 : p.size
    e[1] = p.size >= 256 ? 0 : p.size
    e[4] = 1 // planes
    e.writeUInt16LE(32, 6) // bit count
    e.writeUInt32LE(p.buf.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += p.buf.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
}

// --- drawing ----------------------------------------------------------------
const SS = 4 // supersampling factor

// hex color -> [r, g, b]
function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}

const BG_TOP = hex('#0d1420')
const BG_BOTTOM = hex('#1a2536')
const BAR_CYAN = hex('#38bdf8')
const BAR_GREEN = hex('#10b981')

// sample(p, q) in normalized [0,1] coords -> [r, g, b, a]
function sample(px, py) {
  // background: rounded square, full-bleed
  const r = 0.16
  const cx = 0.5
  const cy = 0.5
  const hw = 0.5 - r
  const hh = 0.5 - r
  const dx = Math.max(Math.abs(px - cx) - hw, 0)
  const dy = Math.max(Math.abs(py - cy) - hh, 0)
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0]

  const t = py
  const bg = [
    Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
    Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
    Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
  ]

  // four ascending signal bars (capsules)
  const barW = 0.1
  const gap = 0.055
  const total = barW * 4 + gap * 3
  const x0 = 0.5 - total / 2 + barW / 2
  const baseline = 0.66
  const heights = [0.17, 0.3, 0.43, 0.56]
  for (let i = 0; i < 4; i++) {
    const bx = x0 + i * (barW + gap)
    const top = baseline - heights[i]
    // capsule: distance from point to vertical segment <= barW/2
    const segY = Math.max(top, Math.min(baseline, py))
    const ddx = Math.abs(px - bx)
    const ddy = Math.abs(py - segY)
    if (ddx * ddx + ddy * ddy <= (barW / 2) * (barW / 2)) {
      const col = i === 3 ? BAR_GREEN : BAR_CYAN
      return [col[0], col[1], col[2], 1]
    }
  }
  return [bg[0], bg[1], bg[2], 1]
}

function renderIcon(size) {
  const W = size * SS
  const img = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x * SS + sx + 0.5) / W, (y * SS + sy + 0.5) / W)
          r += c[0] * c[3]
          g += c[1] * c[3]
          b += c[2] * c[3]
          a += c[3]
        }
      }
      const idx = (y * size + x) * 4
      const alpha = a / (SS * SS)
      if (alpha > 0) {
        img[idx] = Math.round(r / a)
        img[idx + 1] = Math.round(g / a)
        img[idx + 2] = Math.round(b / a)
      }
      img[idx + 3] = Math.round(alpha)
    }
  }
  return img
}

// --- write artifacts ---------------------------------------------------------
const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })

const png512 = encodePng(512, 512, renderIcon(512))
fs.writeFileSync(path.join(outDir, 'icon.png'), png512)

const sizes = [256, 128, 64, 48, 32, 16]
const ico = encodeIco(sizes.map((s) => ({ size: s, buf: encodePng(s, s, renderIcon(s)) })))
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico)

const fav = encodePng(32, 32, renderIcon(32))
fs.writeFileSync(path.join(outDir, 'favicon.png'), fav)

console.log('icon.png  ', (png512.length / 1024).toFixed(1), 'KB')
console.log('icon.ico  ', (ico.length / 1024).toFixed(1), 'KB  sizes=', sizes.join('/'))
console.log('favicon.png', (fav.length / 1024).toFixed(1), 'KB')
console.log('FAVICON_DATA_URI=data:image/png;base64,' + fav.toString('base64'))
