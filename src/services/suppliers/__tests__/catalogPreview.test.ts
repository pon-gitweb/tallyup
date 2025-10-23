import { previewCatalog } from '../../suppliers/catalogPreview';

describe('catalogPreview', () => {
  const csv = [
    'Product Name,Sku,Price,Pack,Unit,GST%',
    'Lemonade 1.5L,LEMON-15,3.99,6x1.5L,bottle,15',
    'Lemon,L-1,0.60,1kg,kg,15',
    'Cola Classic 330ml,COLA-330,1.20,24x330ml,can,15',
  ].join('\n');

  const headerMap = {
    name: 'Product Name',
    sku: 'Sku',
    price: 'Price',
    packSize: 'Pack',
    unit: 'Unit',
    gstPercent: 'GST%',
  };

  const existingProducts = [
    { id: 'p1', name: 'Lemonade 1.5L' },
    { id: 'p2', name: 'Cola Classic 330ml' },
    { id: 'p3', name: 'Orange Juice 1L' },
  ];

  it('normalizes rows and suggests matches', () => {
    const res = previewCatalog({ csvText: csv, headerMap, existingProducts });
    expect(res.rows.length).toBe(3);

    // Row 0 exact match
    expect(res.suggestions[0].matchQuality).toBe('exact');
    expect(res.suggestions[0].productId).toBe('p1');

    // Row 1 startsWith or none depending on product list (no exact here)
    expect(['startsWith', 'none']).toContain(res.suggestions[1].matchQuality);

    // Row 2 exact match
    expect(res.suggestions[2].matchQuality).toBe('exact');
    expect(res.suggestions[2].productId).toBe('p2');

    // Price parsed
    expect(res.rows[0].price).toBeCloseTo(3.99, 2);
  });
});
