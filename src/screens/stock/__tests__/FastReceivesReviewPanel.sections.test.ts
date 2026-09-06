/**
 * Tests for the SectionList grouping logic added to FastReceivesReviewPanel (2b).
 *
 * Strategy: extract the grouping logic as a pure helper mirroring the
 * production useMemo — no React / Firebase / navigation imports needed.
 */

// ── Mirror of the production sections computation ─────────────────────────────

type FastRec = {
  id: string;
  supplierName?: string;
  payload?: { invoice?: { supplierName?: string } };
  createdAt?: { toDate?: () => Date } | null;
  status?: string;
  [key: string]: any;
};

function buildSections(items: FastRec[]) {
  const grouped = new Map<string, FastRec[]>();
  for (const it of items) {
    const key: string =
      (it as any).supplierName ??
      (it as any).payload?.invoice?.supplierName ??
      'Unknown Supplier';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(it);
  }
  const result: Array<{ title: string; data: FastRec[] }> = [];
  grouped.forEach((data, title) => {
    data.sort((a, b) => {
      const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return tb - ta;
    });
    result.push({ title, data });
  });
  result.sort((a, b) => {
    const ta = a.data[0]?.createdAt?.toDate?.()?.getTime() ?? 0;
    const tb = b.data[0]?.createdAt?.toDate?.()?.getTime() ?? 0;
    return tb - ta;
  });
  return result;
}

function makeTs(ms: number) {
  return { toDate: () => new Date(ms) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FastReceivesReviewPanel — SectionList sections (2b)', () => {

  it('F1: items from the same supplier land in one section', () => {
    const items: FastRec[] = [
      { id: 'r1', supplierName: 'Acme', createdAt: makeTs(1000) },
      { id: 'r2', supplierName: 'Acme', createdAt: makeTs(2000) },
    ];
    const sections = buildSections(items);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Acme');
    expect(sections[0].data.map(i => i.id)).toEqual(['r2', 'r1']); // most-recent first
  });

  it('F2: items from different suppliers appear in separate sections', () => {
    const items: FastRec[] = [
      { id: 'r1', supplierName: 'Acme',  createdAt: makeTs(1000) },
      { id: 'r2', supplierName: 'Metro', createdAt: makeTs(2000) },
    ];
    const sections = buildSections(items);
    expect(sections).toHaveLength(2);
    const titles = sections.map(s => s.title);
    expect(titles).toContain('Acme');
    expect(titles).toContain('Metro');
  });

  it('F3: groups sorted by most-recent item — latest supplier first', () => {
    const items: FastRec[] = [
      { id: 'r1', supplierName: 'Old Co',  createdAt: makeTs(1000) },
      { id: 'r2', supplierName: 'New Co',  createdAt: makeTs(9000) },
    ];
    const sections = buildSections(items);
    expect(sections[0].title).toBe('New Co');
    expect(sections[1].title).toBe('Old Co');
  });

  it('F4: items within a group sorted by createdAt descending', () => {
    const items: FastRec[] = [
      { id: 'early',  supplierName: 'Brew', createdAt: makeTs(100) },
      { id: 'middle', supplierName: 'Brew', createdAt: makeTs(500) },
      { id: 'latest', supplierName: 'Brew', createdAt: makeTs(900) },
    ];
    const sections = buildSections(items);
    expect(sections[0].data.map(i => i.id)).toEqual(['latest', 'middle', 'early']);
  });

  it('F5: single-supplier list renders correctly', () => {
    const items: FastRec[] = [
      { id: 'solo', supplierName: 'Solo', createdAt: makeTs(1000) },
    ];
    const sections = buildSections(items);
    expect(sections).toHaveLength(1);
    expect(sections[0].data).toHaveLength(1);
  });

  it('F6: empty items list produces empty sections', () => {
    const sections = buildSections([]);
    expect(sections).toHaveLength(0);
  });

  it('F7: supplierName from payload.invoice is used when top-level field absent', () => {
    const items: FastRec[] = [
      {
        id: 'nested',
        payload: { invoice: { supplierName: 'Nested Supplier' } },
        createdAt: makeTs(1000),
      },
    ];
    const sections = buildSections(items);
    expect(sections[0].title).toBe('Nested Supplier');
  });

  it('F8: items with no supplier info fall back to "Unknown Supplier"', () => {
    const items: FastRec[] = [
      { id: 'unknown1', createdAt: makeTs(100) },
      { id: 'unknown2', payload: {}, createdAt: makeTs(200) },
    ];
    const sections = buildSections(items);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Unknown Supplier');
    expect(sections[0].data).toHaveLength(2);
  });
});
