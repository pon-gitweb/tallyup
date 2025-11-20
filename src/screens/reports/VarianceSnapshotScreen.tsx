// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { computeVarianceSnapshot, VarianceRow } from '../../services/reports/variance';
import { explainVariance } from '../../services/aiVariance';
import { exportPdf } from '../../utils/exporters';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';

export default function VarianceSnapshotScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rowsShort, setRowsShort] = useState<VarianceRow[]>([]);
  const [rowsExcess, setRowsExcess] = useState<VarianceRow[]>([]);
  const [shortageValue, setShortageValue] = useState(0);
  const [excessValue, setExcessValue] = useState(0);
  const [q, setQ] = useState('');

  async function load() {
    try {
      if (!venueId) { setLoading(false); return; }
      setLoading(true);
      const res = await computeVarianceSnapshot(venueId);
      setRowsShort(res.shortages || []);
      setRowsExcess(res.excesses || []);
      setShortageValue(res.totalShortageValue || 0);
      setExcessValue(res.totalExcessValue || 0);
    } catch (e: any) {
      Alert.alert('Failed to load variance', e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  const qlc = q.trim().toLowerCase();
  const filteredShort = useMemo(
    () => (!qlc ? rowsShort : rowsShort.filter(r => (r.name || '').toLowerCase().includes(qlc))),
    [rowsShort, qlc]
  );
  const filteredExcess = useMemo(
    () => (!qlc ? rowsExcess : rowsExcess.filter(r => (r.name || '').toLowerCase().includes(qlc))),
    [rowsExcess, qlc]
  );

  const onExportPdf = async () => {
    if (!venueId) {
      Alert.alert('Not ready', 'Select a venue first.');
      return;
    }
    if (!rowsShort.length && !rowsExcess.length) {
      Alert.alert('Nothing to export', 'There are no shortages or excesses in this snapshot yet.');
      return;
    }
    try {
      const venueName = await fetchVenueName(venueId);
      const html = buildVarianceHtml(
        venueName,
        rowsShort,
        rowsExcess,
        shortageValue,
        excessValue,
      );
      const out = await exportPdf('Variance Snapshot', html);
      if (!out.ok) {
        Alert.alert(
          'PDF generated',
          'Sharing may be unavailable or failed on this device, but the PDF was written to storage if supported.',
        );
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export variance snapshot.');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollPad}>

        <Text style={styles.h1}>Variance Snapshot</Text>
        <Text style={styles.sub}>Compares current on-hand (from last counts) against guidance (“expected”).</Text>

        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or SKU"
          style={styles.input}
        />

        <View style={styles.totals}>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>Shortage value</Text>
            <Text style={[styles.pillValue, { color: '#C62828' }]}>{formatMoney(shortageValue)}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>Excess value</Text>
            <Text style={[styles.pillValue, { color: '#2E7D32' }]}>{formatMoney(excessValue)}</Text>
          </View>
        </View>

        {/* Top Shortages */}
        <Text style={styles.sectionTitle}>Top Shortages (value impact)</Text>
        <SectionCard>
          {loading && <RowLoading />}
          {!loading && filteredShort.length === 0 && <RowEmpty text="No shortages in this cycle" />}
          {!loading && filteredShort.map((r, i) => (
            <Row key={r.id || i} row={r} divider={i < filteredShort.length - 1} venueId={venueId} />
          ))}
        </SectionCard>

        {/* Top Excess */}
        <Text style={styles.sectionTitle}>Top Excess (value impact)</Text>
        <SectionCard>
          {loading && filteredExcess.length === 0 && <RowEmpty text="No excess in this cycle" />}
          {!loading && filteredExcess.map((r, i) => (
            <Row key={r.id || i} row={r} divider={i < filteredExcess.length - 1} venueId={venueId} />
          ))}
        </SectionCard>

        <TouchableOpacity onPress={onExportPdf} style={styles.exportBtn}>
          <Text style={styles.exportText}>Export Variance (PDF)</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={load} style={styles.reloadBtn}>
          <Text style={styles.reloadText}>Reload</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

function formatMoney(v: number) {
  if (v == null || isNaN(v as any)) return '0.00';
  return Number(v).toFixed(2);
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Row({ row, divider, venueId }: { row: VarianceRow; divider?: boolean; venueId: string }) {
  const {
    id,
    productId,
    name,
    unit,
    supplierName,
    par,
    onHand,
    variance,
    value,
  } = (row || {}) as any;

  // Derived cost line: simple, user-friendly.
  const shrinkUnits = typeof row?.shrinkUnits === 'number' ? row.shrinkUnits : 0;
  const hasShrink = shrinkUnits > 0;

  const baseCost =
    (typeof row?.landedCost === 'number' && row.landedCost > 0)
      ? row.landedCost
      : ((typeof row?.listCost === 'number' && row.listCost > 0) ? row.listCost : null);

  const realCost =
    (typeof row?.realCostPerUnit === 'number' && row.realCostPerUnit > 0)
      ? row.realCostPerUnit
      : null;

  async function onExplain() {
    try {
      const counted = typeof onHand === 'number' ? onHand : 0;
      const expected = (typeof counted === 'number' && typeof variance === 'number') ? (counted - variance) : 0;

      const ctx: any = {
        venueId,
        areaId: null,
        productId: productId || id || String(name || 'unknown'),
        expected,
        counted,
        unit: unit || null,
        lastDeliveryAt: row?.lastDeliveryAt || null,
        lastSalesLookbackDays: 3,
        auditTrail: Array.isArray(row?.auditTrail) ? row.auditTrail : [],
        // NEW: cost + flow context so AI can talk about real COGS and shrinkage honestly
        costPerUnit: baseCost,
        realCostPerUnit: realCost,
        shrinkUnits: shrinkUnits || 0,
        shrinkValue: row?.shrinkValue ?? null,
        salesQty: row?.salesQty ?? null,
        invoiceQty: row?.invoiceQty ?? null,
      };

      const res = await explainVariance(ctx);

      // Be honest when context is thin
      const notMuchData = (!ctx.lastDeliveryAt) && (!ctx.auditTrail?.length);
      const suggestions = [
        !ctx.lastDeliveryAt ? 'recent delivery date' : null,
        !ctx.auditTrail?.length ? 'audit trail entries' : null,
        'recent sales window',
      ].filter(Boolean).join(', ');

      const lines = [
        res.summary || 'No explanation available.',
        res.confidence != null ? `\nConfidence: ${(res.confidence * 100).toFixed(0)}%` : '',
        (res.factors && res.factors.length) ? `\nFactors:\n• ${res.factors.join('\n• ')}` : '',
        notMuchData ? `\n\nLimited data. Add ${suggestions} for better insights.` : '',
        res.cachedAt ? `\n\nCached: ${new Date(res.cachedAt).toLocaleString()}` : '',
      ].filter(Boolean);

      Alert.alert('AI Insight', lines.join('\n'));
    } catch (e: any) {
      Alert.alert('AI Insight', e?.message || 'Failed to get explanation.');
    }
  }

  const costLine = hasShrink && baseCost != null && realCost != null
    ? `Cost $${formatMoney(baseCost)} → Real $${formatMoney(realCost)} (lost ${shrinkUnits}${unit ? ' ' + unit : ''})`
    : null;

  return (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{name || '—'}</Text>
        <Text style={styles.subtle} numberOfLines={1}>
          {(unit ? unit : '') + (supplierName ? (unit ? ' • ' : '') + supplierName : '')}
        </Text>
        {costLine ? (
          <Text style={styles.subtle} numberOfLines={1}>
            {costLine}
          </Text>
        ) : null}
      </View>
      <Cell label="Par" value={par} />
      <Cell label="On-hand" value={onHand} />
      <Cell label="Variance" value={variance} emph />
      <Cell label="Val." value={typeof value === 'number' ? formatMoney(value) : '—'} />
      <TouchableOpacity onPress={onExplain} style={styles.aiBtn} accessibilityLabel="Explain this variance">
        <Text style={styles.aiText}>🤖 Explain</Text>
      </TouchableOpacity>
    </View>
  );
}

function RowLoading() {
  return (
    <View style={[styles.row, styles.rowDivider, { justifyContent: 'center' }]}>
      <ActivityIndicator />
    </View>
  );
}

function RowEmpty({ text }: { text: string }) {
  return (
    <View style={[styles.row, { justifyContent: 'center' }]}>
      <Text style={styles.subtle}>{text}</Text>
    </View>
  );
}

function Cell({ label, value, emph }: { label: string; value: any; emph?: boolean }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={[styles.cellVal, emph && { color: '#0B5FFF' }]} numberOfLines={1}>
        {value == null || value === '' ? '—' : String(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  scrollPad: { padding: 12 },
  h1: { fontSize: 18, fontWeight: '800' },
  sub: { opacity: 0.7, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 },
  totals: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  pill: { flex: 1, backgroundColor: '#F2F2F7', padding: 10, borderRadius: 12 },
  pillLabel: { fontWeight: '700', opacity: 0.8 },
  pillValue: { fontWeight: '900', fontSize: 16 },
  sectionTitle: { fontWeight: '800', marginBottom: 6, marginTop: 10 },
  card: { backgroundColor: '#F5F6F8', borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, backgroundColor: 'white' },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  name: { fontWeight: '700', marginBottom: 2, maxWidth: 160 },
  subtle: { fontSize: 12, color: '#6B7280' },
  cell: { alignItems: 'flex-end', minWidth: 70, paddingLeft: 8 },
  cellLabel: { opacity: 0.6, fontSize: 12 },
  cellVal: { fontWeight: '800' },
  reloadBtn: { alignSelf: 'center', marginTop: 8, backgroundColor: '#EFF6FF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  reloadText: { color: '#1D4ED8', fontWeight: '800' },
  exportBtn: { alignSelf: 'center', marginTop: 12, backgroundColor: '#1D4ED8', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  exportText: { color: 'white', fontWeight: '800' },
  aiBtn: { marginLeft: 8, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  aiText: { color: '#1D4ED8', fontWeight: '800' },
});

async function fetchVenueName(venueId: string | null | undefined) {
  if (!venueId) return 'Venue';
  try {
    const snap = await getDoc(doc(db, 'venues', venueId));
    if (snap.exists()) {
      const d: any = snap.data() || {};
      return d.name || d.venueName || 'Venue';
    }
  } catch (e) {
    // best-effort only
  }
  return 'Venue';
}

function buildVarianceHtml(
  venueName: string,
  shortages: VarianceRow[],
  excesses: VarianceRow[],
  shortageValue: number,
  excessValue: number,
) {
  const shortRows = (shortages || []).map((r: any) => {
    const name = r.name || r.id || '—';
    const unit = r.unit || '';
    const sup = r.supplierName || '';
    const par = r.par ?? '—';
    const onHand = r.onHand ?? '—';
    const variance = r.variance ?? '—';
    const value = typeof r.value === 'number' ? '$' + Number(r.value).toFixed(2) : '—';
    return `
      <tr>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(name)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(unit)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(sup)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${escapeHtml(par)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${escapeHtml(onHand)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${escapeHtml(variance)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${value}</td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="7" style="padding:8px;text-align:center;color:#6B7280;">
        No shortages recorded in this snapshot.
      </td>
    </tr>
  `;

  const excessRows = (excesses || []).map((r: any) => {
    const name = r.name || r.id || '—';
    const unit = r.unit || '';
    const sup = r.supplierName || '';
    const par = r.par ?? '—';
    const onHand = r.onHand ?? '—';
    const variance = r.variance ?? '—';
    const value = typeof r.value === 'number' ? '$' + Number(r.value).toFixed(2) : '—';
    return `
      <tr>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(name)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(unit)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;">${escapeHtml(sup)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${escapeHtml(par)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${escapeHtml(onHand)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${escapeHtml(variance)}</td>
        <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${value}</td>
      </tr>
    `;
  }).join('') || `
    <tr>
      <td colspan="7" style="padding:8px;text-align:center;color:#6B7280;">
        No excess recorded in this snapshot.
      </td>
    </tr>
  `;

  return `
    <html>
      <body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;">
        <h2>${escapeHtml(venueName)} — Variance Snapshot</h2>
        <p style="color:#4B5563;margin:0 0 12px 0;">
          On-hand vs expected, showing where you are short or overstocked.
        </p>

        <h3>Headline numbers</h3>
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">Shortage value</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">$${Number(shortageValue || 0).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">Excess value</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">$${Number(excessValue || 0).toFixed(2)}</td>
          </tr>
        </table>

        <h3>Shortages</h3>
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Product</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Unit</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Supplier</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Par</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">On-hand</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Variance</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Value</th>
            </tr>
          </thead>
          <tbody>
            ${shortRows}
          </tbody>
        </table>

        <h3>Excess</h3>
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:13px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Product</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Unit</th>
              <th style="text-align:left;padding:6px;border-bottom:1px solid #CBD5E1;">Supplier</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Par</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">On-hand</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Variance</th>
              <th style="text-align:right;padding:6px;border-bottom:1px solid #CBD5E1;">Value</th>
            </tr>
          </thead>
          <tbody>
            ${excessRows}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function escapeHtml(str: any) {
  const s = String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
