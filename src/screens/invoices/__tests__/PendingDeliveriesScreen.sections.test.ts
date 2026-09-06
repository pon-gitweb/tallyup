/**
 * Tests for the SectionList grouping logic added to PendingDeliveriesScreen (2b).
 *
 * Strategy: extract the grouping logic as a pure helper mirroring the
 * production useMemo so it can be tested without React / Firebase / navigation.
 */

// ── Mirror of the production sections computation ─────────────────────────────

type Delivery = {
  id: string;
  supplierName?: string | null;
  createdAt?: { toMillis?: () => number } | null;
  [key: string]: any;
};

function buildSections(deliveries: Delivery[]) {
  const grouped = new Map<string, Delivery[]>();
  for (const d of deliveries) {
    const key = d.supplierName || 'Unknown supplier';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }
  const result: Array<{ title: string; data: Delivery[] }> = [];
  grouped.forEach((data, title) => result.push({ title, data }));
  result.sort((a, b) => {
    const ta = a.data[0]?.createdAt?.toMillis?.() ?? 0;
    const tb = b.data[0]?.createdAt?.toMillis?.() ?? 0;
    return tb - ta;
  });
  return result;
}

function ts(ms: number) {
  return { toMillis: () => ms };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PendingDeliveriesScreen — SectionList sections (2b)', () => {

  it('S1: deliveries from the same supplier appear in one section', () => {
    const deliveries: Delivery[] = [
      { id: 'd1', supplierName: 'Acme Foods', createdAt: ts(1000) },
      { id: 'd2', supplierName: 'Acme Foods', createdAt: ts(2000) },
    ];
    const sections = buildSections(deliveries);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Acme Foods');
    expect(sections[0].data.map(d => d.id)).toEqual(['d1', 'd2']);
  });

  it('S2: deliveries from different suppliers appear in separate sections', () => {
    const deliveries: Delivery[] = [
      { id: 'd1', supplierName: 'Acme Foods',  createdAt: ts(1000) },
      { id: 'd2', supplierName: 'Metro Wines', createdAt: ts(2000) },
      { id: 'd3', supplierName: 'Acme Foods',  createdAt: ts(3000) },
    ];
    const sections = buildSections(deliveries);
    expect(sections).toHaveLength(2);
    const titles = sections.map(s => s.title);
    expect(titles).toContain('Acme Foods');
    expect(titles).toContain('Metro Wines');
  });

  it('S3: groups sorted by most-recent item — latest supplier first', () => {
    const deliveries: Delivery[] = [
      { id: 'd1', supplierName: 'Older Co',  createdAt: ts(1000) },
      { id: 'd2', supplierName: 'Newer Co',  createdAt: ts(9000) },
    ];
    const sections = buildSections(deliveries);
    expect(sections[0].title).toBe('Newer Co');
    expect(sections[1].title).toBe('Older Co');
  });

  it('S4: single-supplier list renders without error and items are preserved', () => {
    const deliveries: Delivery[] = [
      { id: 'x1', supplierName: 'Solo Supplier', createdAt: ts(500) },
    ];
    const sections = buildSections(deliveries);
    expect(sections).toHaveLength(1);
    expect(sections[0].data).toHaveLength(1);
    expect(sections[0].data[0].id).toBe('x1');
  });

  it('S5: empty deliveries list produces empty sections (no crash)', () => {
    const sections = buildSections([]);
    expect(sections).toHaveLength(0);
  });

  it('S6: missing supplierName falls back to "Unknown supplier" group', () => {
    const deliveries: Delivery[] = [
      { id: 'u1', supplierName: null,      createdAt: ts(100) },
      { id: 'u2', supplierName: undefined, createdAt: ts(200) },
      { id: 'u3', supplierName: 'Known',   createdAt: ts(300) },
    ];
    const sections = buildSections(deliveries);
    const unknown = sections.find(s => s.title === 'Unknown supplier');
    expect(unknown).toBeDefined();
    expect(unknown!.data.map(d => d.id)).toEqual(expect.arrayContaining(['u1', 'u2']));
    const known = sections.find(s => s.title === 'Known');
    expect(known).toBeDefined();
  });
});
