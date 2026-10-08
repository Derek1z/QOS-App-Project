import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GHANA_DISTRICTS_GEOJSON, DISTRICT_ALIASES } from '../../src/renderer/lib/ghanaDistricts'
import { matchMapData } from '../../src/renderer/lib/mapData'
import { GHANA_REGIONS_GEOJSON } from '../../src/renderer/lib/ghanaRegions'

/** The bundled district map (geoBoundaries GHA ADM2, 2019 boundaries): 260
 *  districts, each in its region. Guan District (2021, the 261st) is not in
 *  the source. Official 2019 counts per region. */
const OFFICIAL_2019: Record<string, number> = {
  Ahafo: 6, Ashanti: 43, Bono: 12, 'Bono East': 11, Central: 22, Eastern: 33,
  'Greater Accra': 29, 'North East': 6, Northern: 16, Oti: 8, Savannah: 7,
  'Upper East': 15, 'Upper West': 11, Volta: 18, Western: 14, 'Western North': 9
}

describe('Ghana district shapes', () => {
  const features = GHANA_DISTRICTS_GEOJSON.features

  it('has all 260 districts of the 2019 boundaries, without duplicates', () => {
    const names = features.map((f) => f.properties.name)
    expect(names.length).toBe(260)
    expect(new Set(names).size).toBe(260)
    for (const n of ['Mion', 'Kadjebi', 'Kassena Nankana Municipal', 'Kassena Nankana West', 'Awutu Senya East', 'Ho Municipal', 'Bosome Freho', 'Asuogyaman', 'Upper Denkyira West']) {
      expect(names).toContain(n)
    }
  })

  it('puts each district in its region (official counts per region)', () => {
    const regionNames = GHANA_REGIONS_GEOJSON.features.map((f) => f.properties.name).sort()
    expect(Object.keys(OFFICIAL_2019).sort()).toEqual(regionNames)
    const counts: Record<string, number> = {}
    for (const f of features) counts[f.properties.region ?? '?'] = (counts[f.properties.region ?? '?'] ?? 0) + 1
    expect(counts).toEqual(OFFICIAL_2019)
  })

  it('places the districts the old centroid rule misfiled', () => {
    const region = (n: string): string | null | undefined => features.find((f) => f.properties.name === n)?.properties.region
    expect(region('Asuogyaman')).toBe('Eastern')
    expect(region('Upper Denkyira West')).toBe('Central')
    expect(region('Ho Municipal')).toBe('Volta')
  })

  it('every official district name (2019 list, as in operator data) lands on its own shape', () => {
    const official = readFileSync(join(__dirname, '../fixtures/ghana-districts-official.txt'), 'utf8').trim().split('\n')
    expect(official.length).toBe(260)
    const { data, unmatched } = matchMapData(
      official.map((name) => ({ name, healthScore: 50 })),
      features.map((f) => f.properties.name),
      DISTRICT_ALIASES
    )
    expect(unmatched).toEqual([])
    expect(new Set(data.map((d) => d.name)).size).toBe(260)
  })

  it('still accepts the boundary source\'s spellings', () => {
    const { data, unmatched } = matchMapData(
      ['Accra Metropolis', 'Assin Fosu', 'Kasena Nankana East', 'Wassa Amenfi Central', 'Ledzokuku Municipal'].map((name) => ({ name, healthScore: 50 })),
      features.map((f) => f.properties.name),
      DISTRICT_ALIASES
    )
    expect(unmatched).toEqual([])
    expect(data.map((d) => d.name)).toEqual(['Accra Metropolitan', 'Assin Central Municipal', 'Kassena Nankana Municipal', 'Amenfi Central', 'Ledzekuku Municipal'])
  })
})
