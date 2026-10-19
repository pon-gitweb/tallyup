import { stockUnitsPerSale, ingredientStockQty, MappingDoc, ProductDoc } from '../mappingConversion'

// ── stockUnitsPerSale ─────────────────────────────────────────────────────────

describe('stockUnitsPerSale', () => {
  const bottle750: ProductDoc = { id: 'p1', name: 'Gin', size: '750ml' }
  const spiritG: ProductDoc   = { id: 'p2', name: 'Salt', size: '200g Sachet' }

  it('servingType each → qty 1, source each', () => {
    const m: MappingDoc = { servingType: 'each' }
    expect(stockUnitsPerSale(m, bottle750)).toEqual({ qty: 1, source: 'each' })
  })

  it('servingMl over ml product → source servingMl', () => {
    const m: MappingDoc = { servingMl: 30 }
    const r = stockUnitsPerSale(m, bottle750)
    expect(r.source).toBe('servingMl')
    expect(r.qty).toBeCloseTo(30 / 750)
  })

  it('servingMl against g product → unconvertible', () => {
    const m: MappingDoc = { servingMl: 30 }
    expect(stockUnitsPerSale(m, spiritG)).toEqual({ qty: 1, source: 'unconvertible' })
  })

  it('servingMl against null product → unconvertible', () => {
    const m: MappingDoc = { servingMl: 30 }
    expect(stockUnitsPerSale(m, null)).toEqual({ qty: 1, source: 'unconvertible' })
  })

  it('conversionRatio set → source conversionRatio', () => {
    const m: MappingDoc = { conversionRatio: 0.5 }
    expect(stockUnitsPerSale(m, bottle750)).toEqual({ qty: 0.5, source: 'conversionRatio' })
  })

  it('no conversion info → qty 1, source default', () => {
    expect(stockUnitsPerSale({}, bottle750)).toEqual({ qty: 1, source: 'default' })
    expect(stockUnitsPerSale({}, null)).toEqual({ qty: 1, source: 'default' })
  })

  it('servingMl takes priority over conversionRatio', () => {
    const m: MappingDoc = { servingMl: 30, conversionRatio: 0.5 }
    expect(stockUnitsPerSale(m, bottle750).source).toBe('servingMl')
  })

  it('servingType each takes priority over servingMl', () => {
    const m: MappingDoc = { servingType: 'each', servingMl: 30 }
    expect(stockUnitsPerSale(m, bottle750)).toEqual({ qty: 1, source: 'each' })
  })
})

// ── ingredientStockQty ────────────────────────────────────────────────────────

describe('ingredientStockQty', () => {
  const gin750: ProductDoc = { id: 'p1', name: 'Gin', size: '750ml' }
  const salt200g: ProductDoc = { id: 'p2', name: 'Salt', size: '200g Sachet' }

  it('ml ingredient, ml product → stockQty = qtySold * qty / size', () => {
    // 10 serves × 30ml / 750ml = 0.4 bottles
    const r = ingredientStockQty(10, 30, 'ml', 1, gin750)
    expect(r.reason).toBeNull()
    expect(r.stockQty).toBeCloseTo(0.4)
  })

  it('batch recipe: qty per batch divided by yield', () => {
    // batch yield=10, item qty=300ml total → 30ml per serve
    // 5 serves × 30ml/serve / 750ml = 0.2 bottles
    const r = ingredientStockQty(5, 300, 'ml', 10, gin750)
    expect(r.reason).toBeNull()
    expect(r.stockQty).toBeCloseTo(0.2)
  })

  it('l ingredient converts to ml → compatible with ml product', () => {
    // 1L per serve, 750ml bottle → 1000/750 per serve
    const r = ingredientStockQty(1, 1, 'l', 1, gin750)
    expect(r.reason).toBeNull()
    expect(r.stockQty).toBeCloseTo(1000 / 750)
  })

  it('g ingredient, g product → compatible', () => {
    const r = ingredientStockQty(2, 50, 'g', 1, salt200g)
    expect(r.reason).toBeNull()
    expect(r.stockQty).toBeCloseTo(2 * 50 / 200)
  })

  it('ml ingredient against g product → unconvertible (base mismatch)', () => {
    const r = ingredientStockQty(1, 30, 'ml', 1, salt200g)
    expect(r.stockQty).toBeNull()
    expect(r.reason).toMatch(/base mismatch/)
  })

  it('null product → stockQty null', () => {
    const r = ingredientStockQty(1, 30, 'ml', 1, null)
    expect(r.stockQty).toBeNull()
    expect(r.reason).toBeDefined()
  })

  it('unrecognised unit → stockQty null', () => {
    const r = ingredientStockQty(1, 1, 'oz', 1, gin750)
    expect(r.stockQty).toBeNull()
    expect(r.reason).toMatch(/unrecognised/)
  })
})
