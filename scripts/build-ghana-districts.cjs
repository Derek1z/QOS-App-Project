#!/usr/bin/env node
/**
 * Builds src/renderer/lib/ghanaDistricts.ts from a geoBoundaries GHA ADM2
 * GeoJSON (gbOpen, CC BY 4.0):
 *   https://www.geoboundaries.org/api/current/gbOpen/GHA/ADM2/
 *   -> geoBoundaries-GHA-ADM2_simplified.geojson
 *
 *   node scripts/build-ghana-districts.cjs path/to/geoBoundaries-GHA-ADM2_simplified.geojson
 *
 * Coordinates are rounded to 3 decimals (~110 m) and points closer than the
 * tolerance are dropped. Each district is placed in the region (from
 * ghanaRegions.ts) that holds most of its area, sampled on a grid of interior
 * points: a centroid can fall outside an irregular district (e.g. along the
 * Volta Lake).
 */
const fs = require('node:fs')
const path = require('node:path')

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/build-ghana-districts.cjs <geoBoundaries-GHA-ADM2.geojson>')
  process.exit(1)
}
const root = path.join(__dirname, '..')
const regionsTs = fs.readFileSync(path.join(root, 'src/renderer/lib/ghanaRegions.ts'), 'utf8')
const regions = JSON.parse(regionsTs.slice(regionsTs.indexOf('{"type":"FeatureCollection"'), regionsTs.lastIndexOf('}') + 1))
const src = JSON.parse(fs.readFileSync(input, 'utf8'))

// drop a point this close (degrees) to the last kept one: at most 1/25 of the
// district's extent, so small urban districts keep their shape
const MAX_TOL = 0.012
const round = (v) => Math.round(v * 1000) / 1000

function simplifyRing(ring, TOL) {
  const out = []
  for (const [x, y] of ring) {
    const p = [round(x), round(y)]
    const last = out[out.length - 1]
    if (last && Math.abs(last[0] - p[0]) < TOL && Math.abs(last[1] - p[1]) < TOL) continue
    out.push(p)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]])
  return out.length >= 4 ? out : null
}

function simplifyPolygon(poly, tol) {
  const rings = poly.map((r) => simplifyRing(r, tol))
  if (!rings[0]) return null
  return rings.filter(Boolean)
}

function simplifyGeometry(g) {
  const pts = pointsOf(g)
  const extent = Math.min(
    Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])),
    Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]))
  )
  const tol = Math.min(MAX_TOL, extent / 25)
  if (g.type === 'Polygon') {
    const p = simplifyPolygon(g.coordinates, tol)
    if (!p) throw new Error('polygon vanished on simplification')
    return { type: 'Polygon', coordinates: p }
  }
  const polys = g.coordinates.map((p) => simplifyPolygon(p, tol)).filter(Boolean)
  if (polys.length === 0) throw new Error('multipolygon vanished on simplification')
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
}

function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const inPolygon = (pt, poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h))
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
const pointsOf = (g) => polygonsOf(g).flatMap((p) => p[0])

/** A grid of points inside the district: the vote then measures area, not
 *  boundary points (which sit on the line between two regions). */
function interiorPoints(geometry, n = 24) {
  const pts = pointsOf(geometry)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const out = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const pt = [x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)]
      if (polygonsOf(geometry).some((p) => inPolygon(pt, p))) out.push(pt)
    }
  }
  return out.length > 0 ? out : pts
}

function regionOf(geometry) {
  const votes = new Map()
  for (const pt of interiorPoints(geometry)) {
    for (const r of regions.features) {
      if (polygonsOf(r.geometry).some((p) => inPolygon(pt, p))) {
        votes.set(r.properties.name, (votes.get(r.properties.name) ?? 0) + 1)
        break
      }
    }
  }
  let best = null
  for (const [name, n] of votes) if (!best || n > best[1]) best = [name, n]
  return best ? best[0] : null
}

/** geoBoundaries spelling -> official district name (2019 MMDA list, as in
 *  operator data). The source spelling stays accepted via DISTRICT_ALIASES. */
const OFFICIAL_NAME = {
  'Accra Metropolis': 'Accra Metropolitan',
  'Adansi Akrofuom': 'Akrofuom',
  'Adenta Municipal': 'Adentan Municipal',
  'Akwapem North': 'Akuapem North Municipal',
  'Akwapem South': 'Akwapim South',
  'Akyem Mansa': 'Akyemansa',
  'Asene Akroso Manso': 'Asene Manso Akroso',
  'Asikuma-odoben-brakwa': 'Asikuma Odoben Brankwa',
  'Assin Fosu': 'Assin Central Municipal',
  'Atwima Nwabiagya South': 'Atwima Nwabiagya Municipal',
  'Awutu Senya': 'Awutu Senya West',
  'Bolga  East': 'Bolgatanga East',
  'Bunkpurugu Nakpanduri': 'Bunkpurugu Nyankpanduri',
  'Dormaa Municipal': 'Dormaa Central Municipal',
  'Kasena Nankana East': 'Kassena Nankana Municipal',
  'Kasena Nankana West': 'Kassena Nankana West',
  'Ledzokuku Municipal': 'Ledzekuku Municipal',
  'Lower Manya': 'Lower Manya Krobo Municipal',
  'Sagnerigu': 'Sagnarigu Municipal',
  'Sekondi Takoradi Metropolis': 'Sekondi Takoradi Metropolitan',
  'Sekyere Afram Plains North': 'Sekyere Afram Plains',
  'Twifo Hemang Lower Denkyira': 'Twifo Heman Lower Denkyira',
  'Upper Manya': 'Upper Manya Krobo',
  'Wassa Amenfi Central': 'Amenfi Central',
  'Wassa Amenfi West': 'Amenfi West Municipal'
}
for (const s of Object.keys(OFFICIAL_NAME)) {
  if (!src.features.some((f) => f.properties.shapeName === s)) throw new Error(`OFFICIAL_NAME: no source shape '${s}'`)
}

const features = src.features
  .map((f) => ({
    type: 'Feature',
    properties: { name: OFFICIAL_NAME[f.properties.shapeName] ?? f.properties.shapeName, region: regionOf(f.geometry) },
    geometry: simplifyGeometry(f.geometry)
  }))
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name))

const header = `// Ghana ${features.length}-district (ADM2) boundaries, 2019, from geoBoundaries
// gbOpen GHA ADM2 (CC BY 4.0; source: USAID Ghana HPNO, Ghana Statistical
// Service). Built by scripts/build-ghana-districts.cjs: coordinates rounded and
// points thinned for an offline bundle; each district carries the region that
// holds most of its area (ghanaRegions.ts); names follow the official 2019
// district list. Guan District (2021) is
// not in the source.
export interface GhanaDistrictFeature {
  type: 'Feature'
  properties: { name: string; region: string | null }
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
}
export const GHANA_DISTRICTS_GEOJSON: { type: 'FeatureCollection'; features: GhanaDistrictFeature[] } = `
const out = path.join(root, 'src/renderer/lib/ghanaDistricts.ts')
fs.writeFileSync(out, header + JSON.stringify({ type: 'FeatureCollection', features }) +
  '\n\n/** Source spellings of renamed districts, still accepted when matching data. */\n' +
  'export const DISTRICT_ALIASES: Record<string, string> = ' + JSON.stringify(OFFICIAL_NAME, null, 2) + '\n')
const unplaced = features.filter((f) => !f.properties.region).map((f) => f.properties.name)
console.log(`wrote ${out}: ${features.length} districts, ${fs.statSync(out).size} bytes` +
  (unplaced.length ? `; no region: ${unplaced.join(', ')}` : ''))
