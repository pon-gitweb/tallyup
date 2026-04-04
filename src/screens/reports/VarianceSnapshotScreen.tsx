// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { computeVarianceSnapshot, VarianceRow } from '../../services/reports/variance';
import { explainVariance } from '../../services/aiVariance';
import { attributeVarianceToRecipes } from '../../services/sales/matchSalesToRecipes';
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
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function load() {
    try {
      if (!venueId) { setLoading(false); return; }
      setLoading(true);
      const res = await computeVarianceSnapshot(venueId);
      setRowsShort(res.shortages || []);
      setRowsExcess(res.excesses || []);
      setShortageValue(res.totalShortageValue || 0);
      setExcessValue(res.totalExcessValue || 0);
      // Auto-generate AI summary
      if ((res.shortages?.length || 0) + (res.excesses?.length || 0) > 0) {
        setAiLoading(true);
        try {
          const topItems = [...(res.shortages || []).slice(0, 3), ...(res.excesses || []).slice(0, 2)];
          const ctx = {
            venueId,
            areaId: null,
            productId: 'overall',
            expected: 0,
            counted: 0,
            unit: null,
            lastDeliveryAt: null,
            lastSalesLookbackDays: 7,
            auditTrail: [],
            shortages: res.shortages?.slice(0, 5),
            excesses: res.excesses?.slice(0, 5),
            totalShortageValue: res.totalShortageValue,
            totalExcessValue: res.totalExcessValue,
          };
          const explained = await explainVariance(ctx);
          setAiSummary(explained.summary || null);
        } catch {}
        setAiLoading(false);
      }
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

        {/* AI Summary */}
        {aiLoading && (
          <View style={{ backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <ActivityIndicator size="small" color="#1D4ED8" />
            <Text style={{ color: '#1D4ED8', fontWeight: '700' }}>AI is analysing your variance...</Text>
          </View>
        )}
        {aiSummary && !aiLoading && (
          <View style={{ backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#BFDBFE' }}>
            <Text style={{ fontWeight: '900', color: '#1D4ED8', marginBottom: 6 }}>🤖 AI Summary</Text>
            <Text style={{ color: '#1E3A5F', fontSize: 14, lineHeight: 20 }}>{aiSummary}</Text>
          </View>
        )}
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


  const [attribution, setAttribution] = React.useState(null);
  React.useEffect(() => {
    if (!venueId || !productId || variance >= 0) return;
    attributeVarianceToRecipes(venueId, productId,
      onHand != null && par != null ? (onHand - par) : 0, 0, 0
    ).then(r => { if (r && r.length > 0) setAttribution(r[0]); }).catch(() => {});
  }, [venueId, productId, variance]);
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
        {attribution ? (
          <Text style={[styles.subtle, { color: '#D97706', marginTop: 2 }]} numberOfLines={2}>
            {'⚠️ '}{attribution.recipeName} ({attribution.qtySold} sold · {attribution.attributedPct}% of variance)
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
  const now = new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const netVariance = shortageValue - excessValue;
  const netColour = netVariance > 0 ? '#DC2626' : '#16A34A';

  const buildRows = (rows: VarianceRow[]) => rows.map((r: any) => `
    <tr style="border-bottom:1px solid #F1F5F9;">
      <td style="padding:8px 6px;font-weight:600;">${escapeHtml(r.name || '—')}</td>
      <td style="padding:8px 6px;color:#6B7280;">${escapeHtml(r.unit || '')}</td>
      <td style="padding:8px 6px;color:#6B7280;">${escapeHtml(r.supplierName || '—')}</td>
      <td style="padding:8px 6px;text-align:right;">${r.par ?? '—'}</td>
      <td style="padding:8px 6px;text-align:right;">${r.onHand ?? '—'}</td>
      <td style="padding:8px 6px;text-align:right;font-weight:700;color:${(r.variance||0)<0?'#DC2626':'#16A34A'};">${r.variance ?? '—'}</td>
      <td style="padding:8px 6px;text-align:right;font-weight:700;">${typeof r.value==='number'?'$'+Number(r.value).toFixed(2):'—'}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="padding:12px;text-align:center;color:#9CA3AF;">None recorded</td></tr>';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,Roboto,sans-serif; color:#111827; background:#fff; }
  .header { background:#0F172A; color:#fff; padding:24px 20px; }
  .header h1 { font-size:22px; font-weight:900; margin-bottom:4px; }
  .header p { opacity:0.7; font-size:13px; }
  .summary { display:flex; gap:12px; padding:16px 20px; background:#F8FAFC; border-bottom:1px solid #E2E8F0; }
  .stat { flex:1; background:#fff; border-radius:10px; padding:12px; border:1px solid #E2E8F0; }
  .stat-label { font-size:11px; color:#6B7280; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; }
  .stat-value { font-size:22px; font-weight:900; margin-top:4px; }
  .section { padding:16px 20px; }
  .section h2 { font-size:14px; font-weight:900; text-transform:uppercase; letter-spacing:0.5px; color:#6B7280; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  thead tr { background:#F8FAFC; }
  th { padding:8px 6px; text-align:left; font-size:11px; font-weight:700; color:#6B7280; text-transform:uppercase; letter-spacing:0.3px; border-bottom:2px solid #E2E8F0; }
  th:last-child, th:nth-child(4), th:nth-child(5), th:nth-child(6) { text-align:right; }
  .footer { padding:16px 20px; border-top:1px solid #E2E8F0; color:#9CA3AF; font-size:11px; text-align:center; margin-top:20px; }
</style></head>
<body>
  <div class="header">
    <h1>${escapeHtml(venueName)}</h1>
    <p>Variance Report &nbsp;·&nbsp; ${now}</p>
    <p style="margin-top:4px;opacity:0.5;font-size:11px;">Generated by Hosti-Stock</p>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="stat-label">Shortage value</div>
      <div class="stat-value" style="color:#DC2626;">$${Number(shortageValue||0).toFixed(2)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Excess value</div>
      <div class="stat-value" style="color:#16A34A;">$${Number(excessValue||0).toFixed(2)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Net variance</div>
      <div class="stat-value" style="color:${netColour};">$${Math.abs(netVariance).toFixed(2)}</div>
    </div>
  </div>

  <div class="section">
    <h2>Shortages</h2>
    <table>
      <thead><tr>
        <th>Product</th><th>Unit</th><th>Supplier</th>
        <th>PAR</th><th>On-hand</th><th>Variance</th><th>Value</th>
      </tr></thead>
      <tbody>${buildRows(shortages)}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Excess</h2>
    <table>
      <thead><tr>
        <th>Product</th><th>Unit</th><th>Supplier</th>
        <th>PAR</th><th>On-hand</th><th>Variance</th><th>Value</th>
      </tr></thead>
      <tbody>${buildRows(excesses)}</tbody>
    </table>
  </div>

  <div class="footer">
    Hosti-Stock &nbsp;·&nbsp; hosti.co.nz &nbsp;·&nbsp; Printed ${now}
  </div>
</body></html>`;
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
