import { describe, it, expect } from 'vitest'
import { importTechBlock } from '../../src/renderer/lib/importTech'

/** A file of another technology is stopped before import (spec §4.5). */
describe('importTechBlock', () => {
  it('blocks a file detected as another technology, with the exact message', () => {
    expect(importTechBlock('3G', '4G', false)).toEqual({
      blocked: true,
      message: 'This file looks like 3G; this is a 4G workspace.'
    })
  })
  it('does not block the workspace\'s own technology', () => {
    expect(importTechBlock('4G', '4G', false)).toEqual({ blocked: false, message: null })
  })
  it('does not block when detection is unsure (Review Focus 4)', () => {
    expect(importTechBlock(null, '4G', false)).toEqual({ blocked: false, message: null })
    expect(importTechBlock(undefined, '2G', false)).toEqual({ blocked: false, message: null })
  })
  it('"Import anyway" lifts the block for that file', () => {
    expect(importTechBlock('2G', '4G', true)).toEqual({ blocked: false, message: null })
  })
})
