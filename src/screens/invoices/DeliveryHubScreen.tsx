// @ts-nocheck
/**
 * DeliveryHubScreen — unified receiving history.
 *
 * Shows all invoices across all three receiving pathways, grouped by supplier
 * then sorted newest-first within each group. Origin is labelled honestly:
 *
 *   'planned'        → "Planned order"           (Pathway A)
 *   'invoice-first'  → "Unplanned delivery"       (Pathway B)
 *   'packing-slip'   → "Unplanned — matched from packing slip" (Pathway C)
 *   absent / null    → "Recorded before origin tracking began"
 *
 * Pathway-A invoices have an orderId; tapping their row opens OrderDetail so
 * the existing reconciliation detail is reachable without duplication.
 *
 * Pending deliveries (status == 'awaiting_invoice') render in a visually
 * distinct section at the end — never intermixed with invoices, never styled
 * to look like invoices.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, SectionList, TouchableOpacity, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  getFirestore, collection, query, orderBy, limit, getDocs, where,
} from 'firebase/firestore';
import { useColours } from '../../context/ThemeContext';
import { useVenueId } from '../../context/VenueProvider';

// ── Types ─────────────────────────────────────────────────────────────────────

type Invoice = {
  id: string;
  supplierName?: string | null;
  supplierId?: string | null;
  invoiceDate?: any;
  totalAmount?: number | null;
  receivingOrigin?: string | null;
  orderId?: string | null;
  status?: string | null;
  source?: string | null;
  createdAt?: any;
};

type PendingDelivery = {
  id: string;
  supplierName?: string | null;
  supplierId?: string | null;
  createdAt?: any;
  lines?: any[];
  status?: string | null;
};

// ── Origin label (exported for testing) ──────────────────────────────────────

/** Map a receivingOrigin field value to a human-readable label. */
export function originLabel(origin?: string | null): string {
  if (origin === 'planned')       return 'Planned order';
  if (origin === 'invoice-first') return 'Unplanned delivery';
  if (origin === 'packing-slip')  return 'Unplanned — matched from packing slip';
  // Field absent (invoices created before 3c-i shipped) — state this plainly, never guess.
  return 'Recorded before origin tracking began';
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseTs(v: any): number {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v?._seconds) return v._seconds * 1000;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v: any): string {
  const ms = parseTs(v);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Grouping helper (exported for testing) ────────────────────────────────────

/**
 * Groups invoices by supplier, sorts each group newest-first, then sorts
 * groups so the supplier with the most-recent invoice appears first.
 */
export function groupInvoicesBySupplier(
  invoices: Invoice[],
): Array<{ title: string; key: string; sectionType: 'invoices'; data: Invoice[] }> {
  const bySup = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const key = inv.supplierName || 'Unknown supplier';
    if (!bySup.has(key)) bySup.set(key, []);
    bySup.get(key)!.push(inv);
  }
  const sections: Array<{ title: string; key: string; sectionType: 'invoices'; data: Invoice[] }> = [];
  bySup.forEach((data, title) => {
    const sorted = [...data].sort(
      (a, b) => parseTs(b.createdAt || b.invoiceDate) - parseTs(a.createdAt || a.invoiceDate),
    );
    sections.push({ title, key: `supp_${title}`, sectionType: 'invoices', data: sorted });
  });
  // Sort sections so the supplier with the most-recent invoice surfaces first
  sections.sort(
    (a, b) =>
      parseTs(b.data[0]?.createdAt || b.data[0]?.invoiceDate) -
      parseTs(a.data[0]?.createdAt || a.data[0]?.invoiceDate),
  );
  return sections;
}

// ── Origin chip appearance ────────────────────────────────────────────────────

function originChipBg(origin?: string | null): string {
  if (origin === 'planned')       return '#ECFDF5';
  if (origin === 'invoice-first') return '#EFF6FF';
  if (origin === 'packing-slip')  return '#F5F3FF';
  return '#F3F4F6';
}

function originChipFg(origin?: string | null): string {
  if (origin === 'planned')       return '#065F46';
  if (origin === 'invoice-first') return '#1D4ED8';
  if (origin === 'packing-slip')  return '#6D28D9';
  return '#6B7280';
}

// ── Invoice row ───────────────────────────────────────────────────────────────

function InvoiceItem({ item, c, nav }: { item: Invoice; c: any; nav: any }) {
  const isPlanned = item.receivingOrigin === 'planned';
  const hasOrderLink = isPlanned && !!item.orderId;
  const label = originLabel(item.receivingOrigin);
  const dateStr = fmtDate(item.invoiceDate || item.createdAt);
  const amount =
    typeof item.totalAmount === 'number' ? `$${item.totalAmount.toFixed(2)}` : '—';

  function handlePress() {
    if (hasOrderLink) nav.navigate('OrderDetail', { orderId: item.orderId });
  }

  return (
    <TouchableOpacity
      onPress={hasOrderLink ? handlePress : undefined}
      disabled={!hasOrderLink}
      activeOpacity={hasOrderLink ? 0.7 : 1}
      style={[styles.invoiceRow, { backgroundColor: c.surface, borderColor: c.border }]}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.invoiceAmount, { color: c.navy }]}>{amount}</Text>
        <Text style={[styles.rowDate, { color: c.textSecondary }]}>{dateStr}</Text>
      </View>

      <View style={styles.originRow}>
        <View style={[styles.originChip, { backgroundColor: originChipBg(item.receivingOrigin) }]}>
          <Text style={[styles.originChipText, { color: originChipFg(item.receivingOrigin) }]}>
            {label}
          </Text>
        </View>
        {hasOrderLink && (
          <Text style={[styles.reconLink, { color: c.deepBlue }]}>View reconciliation →</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Pending delivery row ──────────────────────────────────────────────────────

function PendingItem({ item }: { item: PendingDelivery }) {
  const dateStr = fmtDate(item.createdAt);
  const lineCount = Array.isArray(item.lines) ? item.lines.length : 0;
  const supplierStr = item.supplierName || 'Unknown supplier';

  return (
    <View style={styles.pendingRow}>
      <View style={styles.rowTop}>
        <Text style={styles.pendingSupplier}>{supplierStr}</Text>
        <Text style={styles.pendingDate}>{dateStr}</Text>
      </View>
      <Text style={styles.pendingSubtext}>
        {lineCount} {lineCount === 1 ? 'line' : 'lines'} · awaiting invoice
      </Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DeliveryHubScreen() {
  const nav = useNavigation<any>();
  const c = useColours();
  const venueId = useVenueId();

  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [pending,  setPending]    = useState<PendingDelivery[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!venueId) return;
    const db = getFirestore();
    try {
      const [invSnap, pendSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'venues', venueId, 'invoices'),
            orderBy('createdAt', 'desc'),
            limit(200),
          ),
        ),
        getDocs(
          query(
            collection(db, 'venues', venueId, 'pendingDeliveries'),
            where('status', '==', 'awaiting_invoice'),
            orderBy('createdAt', 'desc'),
          ),
        ),
      ]);
      setInvoices(invSnap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)));
      setPending(pendSnap.docs.map(d => ({ id: d.id, ...d.data() } as PendingDelivery)));
    } catch (e) {
      console.warn('[DeliveryHub] load error', (e as any)?.message);
    }
  }, [venueId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Build sections: invoice groups first, then pending (if any) as a single distinct section
  const sections = useMemo(() => {
    const invSections = groupInvoicesBySupplier(invoices);
    const result: any[] = [...invSections];
    if (pending.length > 0) {
      result.push({
        title: 'Awaiting invoice',
        key: 'pending',
        sectionType: 'pending',
        data: pending,
      });
    }
    return result;
  }, [invoices, pending]);

  const renderSectionHeader = useCallback(({ section }: any) => {
    const isPending = section.sectionType === 'pending';
    return (
      <View
        style={[
          styles.sectionHeader,
          { backgroundColor: isPending ? '#FEF3C7' : c.surface },
          isPending && { marginTop: 20 },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: isPending ? '#92400E' : c.navy }]}>
          {isPending ? '⏳ ' : ''}{section.title}
        </Text>
        {isPending && (
          <Text style={styles.pendingSectionSub}>
            Packing-slip deliveries received — invoice not yet matched
          </Text>
        )}
      </View>
    );
  }, [c]);

  const renderItem = useCallback(({ item, section }: any) => {
    if (section.sectionType === 'pending') {
      return <PendingItem item={item} />;
    }
    return <InvoiceItem item={item} c={c} nav={nav} />;
  }, [c, nav]);

  if (loading) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: c.cream, justifyContent: 'center', alignItems: 'center' }}
      >
        <ActivityIndicator size="large" color={c.deepBlue} />
        <Text style={{ color: c.textSecondary, marginTop: 8 }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.cream }} edges={['bottom']}>
      <SectionList
        sections={sections}
        keyExtractor={(item: any, i) => item.id || String(i)}
        renderSectionHeader={renderSectionHeader}
        renderItem={renderItem}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.deepBlue}
          />
        }
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center' }}>
            <Text style={{ color: c.textSecondary, fontSize: 15, textAlign: 'center' }}>
              No deliveries recorded yet.{'\n'}
              Invoices will appear here once received.
            </Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pendingSectionSub: {
    fontSize: 11,
    color: '#92400E',
    marginTop: 2,
    fontStyle: 'italic',
  },

  // Invoice rows
  invoiceRow: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceAmount: {
    fontSize: 15,
    fontWeight: '700',
  },
  rowDate: {
    fontSize: 12,
  },
  originRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
    gap: 8,
  },
  originChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  originChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  reconLink: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Pending delivery rows — visually distinct from invoice rows
  pendingRow: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  pendingSupplier: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
  },
  pendingDate: {
    fontSize: 12,
    color: '#B45309',
  },
  pendingSubtext: {
    fontSize: 12,
    color: '#B45309',
    marginTop: 2,
  },
});
