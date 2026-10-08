import { describe, it, expect } from 'vitest'
import { matchMapData, mapTooltip } from '../../src/renderer/lib/mapData'

/** Health map: workspace district/region names are matched to the map's
 *  shapes tolerantly; no data is shown as no data, never as a made-up score. */
const SHAPES = ['Adenta Municipal', 'Wa East', 'Lambussie-karni', 'Accra Metropolitan']

describe('matchMapData', () => {
  it('matches names ignoring case, spacing, punctuation and Municipal/Metropolitan/District', () => {
    const { data, unmatched } = matchMapData(
      [
        { name: 'ADENTA', healthScore: 71.6 },
        { name: 'wa east district', healthScore: 90 },
        { name: 'Lambussie Karni', healthScore: 55.2 },
        { name: 'Accra Metro', healthScore: 60 },
        { name: 'Not A Ghana District', healthScore: 50 }
      ],
      SHAPES
    )
    expect(data).toEqual([
      { name: 'Adenta Municipal', value: 72 },
      { name: 'Wa East', value: 90 },
      { name: 'Lambussie-karni', value: 55 },
      { name: 'Accra Metropolitan', value: 60 }
    ])
    expect(unmatched).toEqual(['Not A Ghana District'])
  })

  it('leaves a district without a score out instead of inventing one', () => {
    const { data, unmatched } = matchMapData([{ name: 'Wa East', healthScore: null }], SHAPES)
    expect(data).toEqual([])
    expect(unmatched).toEqual([])
  })
})

describe('mapTooltip', () => {
  it('says "no data" for a shape without a value', () => {
    expect(mapTooltip({ name: 'Wa East', value: NaN })).toBe('Wa East: no data')
    expect(mapTooltip({ name: 'Wa East', value: undefined })).toBe('Wa East: no data')
    expect(mapTooltip({ name: 'Wa East', value: 88 })).toBe('Wa East: Health Score 88%')
  })
})
