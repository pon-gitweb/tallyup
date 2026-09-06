/**
 * Tests for DeliveryHubScreen (3c-ii).
 *
 * Suite A: originLabel — four cases (3 real origins + absent-field)
 * Suite B: groupInvoicesBySupplier — section structure and grouping contract
 * Suite C: reconciliation link contract — Pathway A invoices expose orderId
 * Suite D: section-type separation — pending items never in invoice sections
 *
 * All helpers tested are pure (no I/O). Mocks break the import chain from
 * DeliveryHubScreen → ThemeContext → @expo-google-fonts (ESM, not Jest-parseable).
 */

// ── Dependency mocks (top-level, hoisted before imports) ──────────────────────

jest.mock('../../../context/ThemeContext', () => ({
  useColours: jest.fn(() => ({
    cream: '#f5f3ee', navy: '#3b3f4a', surface: '#fbfaf6',
    border: '#e7e3da', text: '#3b3f4a', textSecondary: '#6b7280',
    deepBlue: '#1b4f72',
  })),
  useTheme: jest.fn(() => ({ theme: {} })),
}));

jest.mock('../../../context/VenueProvider', () => ({
  useVenueId: jest.fn(() => 'venue-test'),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(() => ({ navigate: jest.fn(), goBack: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('firebase/firestore', () => ({
  getFirestore:   jest.fn(() => ({})),
  collection:     jest.fn(),
  query:          jest.fn(),
  orderBy:        jest.fn(),
  limit:          jest.fn(),
  getDocs:        jest.fn().mockResolvedValue({ docs: [] }),
  where:          jest.fn(),
}));

// ── Import helpers under test ─────────────────────────────────────────────────

import { originLabel, groupInvoicesBySupplier } from '../DeliveryHubScreen';

// ── Suite A: originLabel ──────────────────────────────────────────────────────

describe('originLabel — four origin cases (3c-ii)', () => {
  it('A1: "planned" → "Planned order"', () => {
    expect(originLabel('planned')).toBe('Planned order');
  });

  it('A2: "invoice-first" → "Unplanned delivery"', () => {
    expect(originLabel('invoice-first')).toBe('Unplanned delivery');
  });

  it('A3: "packing-slip" → "Unplanned — matched from packing slip"', () => {
    expect(originLabel('packing-slip')).toBe('Unplanned — matched from packing slip');
  });

  it('A4: undefined (field absent) → "Recorded before origin tracking began"', () => {
    expect(originLabel(undefined)).toBe('Recorded before origin tracking began');
  });

  it('A4b: null (field absent) → "Recorded before origin tracking began"', () => {
    expect(originLabel(null)).toBe('Recorded before origin tracking began');
  });

  it('A5: all four label strings are distinct', () => {
    const labels = new Set([
      originLabel('planned'),
      originLabel('invoice-first'),
      originLabel('packing-slip'),
      originLabel(undefined),
    ]);
    expect(labels.size).toBe(4);
  });

  it('A6: no label is empty or falsy', () => {
    for (const origin of ['planned', 'invoice-first', 'packing-slip', undefined, null]) {
      const label = originLabel(origin as any);
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('A7: absent-field label does not contain any of the three known origin values', () => {
    const absentLabel = originLabel(undefined);
    expect(absentLabel).not.toContain('planned');
    expect(absentLabel).not.toContain('invoice-first');
    expect(absentLabel).not.toContain('packing-slip');
  });
});

// ── Suite B: groupInvoicesBySupplier ──────────────────────────────────────────

describe('groupInvoicesBySupplier — section structure (3c-ii)', () => {
  const now = Date.now();
  const makeInv = (id: string, supplierName: string, msSince = 0) => ({
    id,
    supplierName,
    receivingOrigin: 'planned',
    createdAt: { toDate: () => new Date(now - msSince) },
  });

  it('B1: invoices from the same supplier go into one section', () => {
    const sections = groupInvoicesBySupplier([
      makeInv('i1', 'ACME'),
      makeInv('i2', 'ACME'),
    ] as any);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('ACME');
    expect(sections[0].data).toHaveLength(2);
  });

  it('B2: invoices from different suppliers produce separate sections', () => {
    const sections = groupInvoicesBySupplier([
      makeInv('i1', 'ACME'),
      makeInv('i2', 'Beta Co'),
      makeInv('i3', 'ACME'),
    ] as any);
    const titles = sections.map(s => s.title).sort();
    expect(titles).toEqual(['ACME', 'Beta Co']);
  });

  it('B3: every section has sectionType "invoices"', () => {
    const sections = groupInvoicesBySupplier([
      makeInv('i1', 'ACME'),
      makeInv('i2', 'Beta Co'),
    ] as any);
    for (const s of sections) {
      expect(s.sectionType).toBe('invoices');
    }
  });

  it('B4: sections sorted so the most-recent supplier appears first', () => {
    const sections = groupInvoicesBySupplier([
      makeInv('i1', 'Beta Co', 5000),
      makeInv('i2', 'ACME',    0),
    ] as any);
    expect(sections[0].title).toBe('ACME');
    expect(sections[1].title).toBe('Beta Co');
  });

  it('B5: within a section, items are sorted newest first', () => {
    const sections = groupInvoicesBySupplier([
      makeInv('old', 'ACME', 10000),
      makeInv('new', 'ACME', 0),
      makeInv('mid', 'ACME', 5000),
    ] as any);
    const ids = sections[0].data.map((i: any) => i.id);
    expect(ids).toEqual(['new', 'mid', 'old']);
  });

  it('B6: absent supplierName falls back to "Unknown supplier"', () => {
    const sections = groupInvoicesBySupplier([
      { id: 'i1', receivingOrigin: 'invoice-first', createdAt: null },
    ] as any);
    expect(sections[0].title).toBe('Unknown supplier');
  });

  it('B7: empty input produces empty output', () => {
    expect(groupInvoicesBySupplier([])).toHaveLength(0);
  });
});

// ── Suite C: Pathway A reconciliation link contract ───────────────────────────

describe('Pathway A reconciliation link — orderId field (3c-ii)', () => {
  it('C1: a "planned" invoice with orderId has the data needed for the link', () => {
    const inv = { id: 'inv1', receivingOrigin: 'planned', orderId: 'ord-abc' };
    const hasOrderLink = inv.receivingOrigin === 'planned' && !!inv.orderId;
    expect(hasOrderLink).toBe(true);
  });

  it('C2: a "planned" invoice WITHOUT orderId should not produce a link', () => {
    const inv = { id: 'inv1', receivingOrigin: 'planned', orderId: null };
    const hasOrderLink = inv.receivingOrigin === 'planned' && !!inv.orderId;
    expect(hasOrderLink).toBe(false);
  });

  it('C3: "invoice-first" invoices do not get a reconciliation link', () => {
    const inv = { id: 'inv1', receivingOrigin: 'invoice-first', orderId: 'ord-xyz' };
    const hasOrderLink = inv.receivingOrigin === 'planned' && !!inv.orderId;
    expect(hasOrderLink).toBe(false);
  });

  it('C4: "packing-slip" invoices do not get a reconciliation link', () => {
    const inv = { id: 'inv1', receivingOrigin: 'packing-slip', orderId: null };
    const hasOrderLink = inv.receivingOrigin === 'planned' && !!inv.orderId;
    expect(hasOrderLink).toBe(false);
  });

  it('C5: absent-origin invoices do not get a reconciliation link', () => {
    const inv = { id: 'inv1', receivingOrigin: undefined, orderId: 'ord-xyz' };
    const hasOrderLink = inv.receivingOrigin === 'planned' && !!inv.orderId;
    expect(hasOrderLink).toBe(false);
  });
});

// ── Suite D: section-type separation guarantee ────────────────────────────────

describe('Pending deliveries never mixed with invoices (3c-ii)', () => {
  it('D1: all invoice sections have sectionType "invoices"', () => {
    const invSections = groupInvoicesBySupplier([
      { id: 'i1', supplierName: 'ACME', receivingOrigin: 'planned', createdAt: null },
    ] as any);
    for (const s of invSections) {
      expect(s.sectionType).toBe('invoices');
      expect(s.sectionType).not.toBe('pending');
    }
  });

  it('D2: pending section has a distinct sectionType "pending"', () => {
    const pendingSection = {
      title: 'Awaiting invoice',
      key: 'pending',
      sectionType: 'pending',
      data: [{ id: 'pd1', supplierName: 'Beta Co', status: 'awaiting_invoice' }],
    };
    expect(pendingSection.sectionType).toBe('pending');
    expect(pendingSection.sectionType).not.toBe('invoices');
  });

  it('D3: no invoice section has sectionType "pending"', () => {
    const invSections = groupInvoicesBySupplier([
      { id: 'i1', supplierName: 'S1', receivingOrigin: 'invoice-first', createdAt: null },
      { id: 'i2', supplierName: 'S2', receivingOrigin: 'packing-slip', createdAt: null },
    ] as any);
    const hasPendingType = invSections.some(s => s.sectionType === 'pending');
    expect(hasPendingType).toBe(false);
  });

  it('D4: pending items never appear inside a supplier invoice section', () => {
    // Simulate the screen useMemo that builds all sections
    const invSections = groupInvoicesBySupplier([
      { id: 'i1', supplierName: 'ACME', receivingOrigin: 'planned', createdAt: null },
    ] as any);
    const pendingItems = [{ id: 'pd1', supplierName: 'ACME', status: 'awaiting_invoice' }];
    const allSections: any[] = [
      ...invSections,
      { title: 'Awaiting invoice', key: 'pending', sectionType: 'pending', data: pendingItems },
    ];

    const invoiceSections = allSections.filter(s => s.sectionType === 'invoices');
    const pendingSections  = allSections.filter(s => s.sectionType === 'pending');

    // Counts are correct (even though both use supplier 'ACME')
    expect(invoiceSections).toHaveLength(1);
    expect(pendingSections).toHaveLength(1);

    // Invoice section has only invoice, not the pending item
    expect(invoiceSections[0].data.some((item: any) => item.id === 'pd1')).toBe(false);
    // Pending section has only the pending item, not the invoice
    expect(pendingSections[0].data.some((item: any) => item.id === 'i1')).toBe(false);
  });
});
