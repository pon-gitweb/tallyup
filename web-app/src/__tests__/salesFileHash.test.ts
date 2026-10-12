import { describe, it, expect } from 'vitest'
import { salesFileHash, legacySalesHash } from '../utils/salesFileHash'

describe('salesFileHash', () => {
  it('same lines → same hash', () => {
    const lines = [{ name: 'Heineken', qtySold: 24, gross: 276, net: 240 }]
    expect(salesFileHash(lines)).toBe(salesFileHash(lines))
  })

  it('same count + same first-5 names but different quantities → different hashes', () => {
    const a = [
      { name: 'Heineken', qtySold: 24, gross: 276 },
      { name: 'Corona',   qtySold: 10, gross: 120 },
      { name: 'Stella',   qtySold: 12, gross: 138 },
      { name: 'Wine',     qtySold: 5,  gross: 75  },
      { name: 'Spirits',  qtySold: 8,  gross: 160 },
    ]
    const b = [
      { name: 'Heineken', qtySold: 99, gross: 1000 }, // different qty
      { name: 'Corona',   qtySold: 10, gross: 120 },
      { name: 'Stella',   qtySold: 12, gross: 138 },
      { name: 'Wine',     qtySold: 5,  gross: 75  },
      { name: 'Spirits',  qtySold: 8,  gross: 160 },
    ]
    expect(salesFileHash(a)).not.toBe(salesFileHash(b))
  })

  it('different order → different hashes', () => {
    const a = [{ name: 'A', qtySold: 1, gross: 10 }, { name: 'B', qtySold: 2, gross: 20 }]
    const b = [{ name: 'B', qtySold: 2, gross: 20 }, { name: 'A', qtySold: 1, gross: 10 }]
    expect(salesFileHash(a)).not.toBe(salesFileHash(b))
  })

  it('empty list → stable hash', () => {
    expect(salesFileHash([])).toBe(salesFileHash([]))
  })
})

describe('legacySalesHash', () => {
  it('same count + same first-5 names → same hash regardless of quantities', () => {
    const a = [{ name: 'A', qtySold: 1, gross: 10 }]
    const b = [{ name: 'A', qtySold: 999, gross: 9999 }]
    expect(legacySalesHash(a)).toBe(legacySalesHash(b))
  })

  it('salesFileHash and legacySalesHash produce different values for same input', () => {
    const lines = [{ name: 'Heineken', qtySold: 24, gross: 276 }]
    expect(salesFileHash(lines)).not.toBe(legacySalesHash(lines))
  })
})
