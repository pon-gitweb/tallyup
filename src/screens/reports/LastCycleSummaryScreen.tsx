// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import LocalThemeGate from '../../theme/LocalThemeGate';
import MaybeTText from '../../components/themed/MaybeTText';
import IdentityBadge from '../../components/IdentityBadge';
import { useVenueId } from '../../context/VenueProvider';
import { loadWeeklyPerformance, WeeklyPerformanceSummary } from '../../services/reports/weeklyPerformance';
import { exportPdf } from '../../utils/exporters';

const dlog = (...a: any[]) => {
  if (__DEV__) console.log('[TallyUp Reports] WeeklyPerformance', ...a);
};

export default function LastCycleSummaryScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<WeeklyPerformanceSummary | null>(null);

  const load = async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await loadWeeklyPerformance(venueId);
      dlog({ venueId, ...res.stock });
      setSummary(res);
    } catch (e: any) {
      Alert.alert('Could not load weekly performance', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [venueId]);

  const onExportPdf = async () => {
    if (!summary) return;
    try {
      const title = 'Weekly Performance Report';
      const html = buildWeeklyPerformanceHtml(summary);
      const out = await exportPdf(title, html);
      dlog('Weekly performance PDF', out);
      if (!out.ok && out.reason === 'sharing_unavailable') {
        Alert.alert(
          'PDF generated',
          'Sharing is unavailable on this device, but the PDF was written to storage.',
        );
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not export report');
    }
  };

  const s = summary;

  return (
    <LocalThemeGate>
      <View style={{ flex: 1, backgroundColor: '#020617' }}>
        {/* Header */}
        <View
          style={{
            padding: 16,
            borderBottomColor: '#1E293B',
            borderBottomWidth: 1,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <MaybeTText style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>
              Weekly Performance
            </MaybeTText>
            <Text style={{ color: '#94A3B8', marginTop: 4 }}>
              High-level summary of how the venue is tracking this week.
            </Text>
            <Text style={{ color: '#64748B', marginTop: 2, fontSize: 12 }}>
              {s?.windowLabel ?? 'Last 7 days'}
            </Text>
          </View>
          <IdentityBadge align="right" />
        </View>

        {/* Body */}
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            gap: 12,
            paddingBottom: 32,
          }}>
          {!venueId && (
            <Text style={{ color: '#F97316', marginBottom: 8 }}>
              No venue selected — select a venue to see performance.
            </Text>
          )}

          {loading && (
            <View
              style={{
                paddingVertical: 32,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <ActivityIndicator />
              <Text style={{ color: '#9CA3AF', marginTop: 8 }}>Loading…</Text>
            </View>
          )}

          {!loading && s && (
            <>
              {/* Top KPI row */}
              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                }}>
                <KpiCard
                  label="Venue GP (actual)"
                  value={
                    s.gp.actual != null
                      ? `${s.gp.actual.toFixed(1)}%`
                      : 'Not enough data'
                  }
                  tone={s.gp.actual != null ? 'good' : 'muted'}
                />
                <KpiCard
                  label="Net sales (week)"
                  value={
                    s.sales.totalNetSales != null
                      ? formatMoney(s.sales.totalNetSales)
                      : 'Missing sales'
                  }
                  tone={s.sales.totalNetSales != null ? 'neutral' : 'warn'}
                />
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                }}>
                <KpiCard
                  label="Spend (invoices)"
                  value={
                    s.spend.totalSpend != null
                      ? formatMoney(s.spend.totalSpend)
                      : 'Missing invoices'
                  }
                  tone={s.spend.totalSpend != null ? 'neutral' : 'warn'}
                />
                <KpiCard
                  label="Shrinkage (value)"
                  value={
                    s.variance.totalShrinkValue != null
                      ? formatMoney(s.variance.totalShrinkValue)
                      : 'No variance yet'
                  }
                  tone={
                    s.variance.totalShrinkValue != null &&
                    s.variance.totalShrinkValue > 0
                      ? 'alert'
                      : 'muted'
                  }
                />
              </View>

              {/* Stock coverage */}
              <SectionCard title="Stocktake coverage">
                <StatLine
                  label="Departments"
                  value={s.stock.departments.toString()}
                />
                <StatLine
                  label="Areas"
                  value={`${s.stock.areasCompleted}/${s.stock.areasTotal} completed`}
                  helper={
                    s.stock.areasInProgress > 0
                      ? `${s.stock.areasInProgress} in progress`
                      : undefined
                  }
                />
                <HintText>
                  Aim for all areas completed weekly to keep variance and GP
                  honest.
                </HintText>
              </SectionCard>

              {/* GP context */}
              <SectionCard title="Gross profit context">
                <Text style={{ color: '#E5E7EB', marginBottom: 4 }}>
                  Expected and landed GP will get smarter as more products,
                  invoices, and recipes flow through TallyUp.
                </Text>

                <Text
                  style={{
                    color: '#9CA3AF',
                    fontSize: 13,
                    marginBottom: 4,
                  }}>
                  For now we:
                </Text>
                <Bullet>Use invoices as a proxy for weekly cost of goods.</Bullet>
                <Bullet>
                  Use sales data as reported by your POS or sales imports.
                </Bullet>
                <Bullet>
                  Show actual GP only when both are present for this week.
                </Bullet>

                {s.gp.actual == null && (
                  <HintText>
                    To unlock accurate GP, scan invoices into TallyUp and import
                    or connect your sales data.
                  </HintText>
                )}
              </SectionCard>

              {/* Data quality / honesty */}
              <SectionCard title="Data quality (how honest is this report?)">
                {s.flags.map((f, i) => (
                  <Text
                    key={i}
                    style={{
                      color: '#E5E7EB',
                      marginBottom: 4,
                      fontSize: 13,
                    }}>
                    • {f}
                  </Text>
                ))}
              </SectionCard>

              {/* Export */}
              <TouchableOpacity
                onPress={onExportPdf}
                style={{
                  marginTop: 8,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: '#1D4ED8',
                  alignItems: 'center',
                }}>
                <Text
                  style={{
                    color: 'white',
                    fontWeight: '800',
                  }}>
                  Export Weekly Performance (PDF)
                </Text>
              </TouchableOpacity>

              <Text
                style={{
                  color: '#64748B',
                  fontSize: 12,
                  marginTop: 6,
                  textAlign: 'center',
                }}>
                PDF includes venue name, week window, KPIs, and data quality
                notes.
              </Text>
            </>
          )}

          {!loading && !s && venueId && (
            <Text style={{ color: '#F97316' }}>
              No data yet to build a weekly performance report.
            </Text>
          )}
        </ScrollView>
      </View>
    </LocalThemeGate>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warn' | 'alert' | 'muted';
}) {
  const base = '#0F172A';
  const bg =
    tone === 'good'
      ? '#022C22'
      : tone === 'alert'
      ? '#3F1D2B'
      : tone === 'warn'
      ? '#3B2610'
      : tone === 'neutral'
      ? '#020617'
      : base;
  const border =
    tone === 'good'
      ? '#22C55E'
      : tone === 'alert'
      ? '#F97373'
      : tone === 'warn'
      ? '#FBBF24'
      : '#1F2937';

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bg,
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: border,
      }}>
      <Text
        style={{
          color: '#CBD5F5',
          fontSize: 12,
          marginBottom: 4,
        }}>
        {label}
      </Text>
      <Text
        style={{
          color: 'white',
          fontSize: 18,
          fontWeight: '800',
        }}>
        {value}
      </Text>
    </View>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: '#020617',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#1E293B',
      }}>
      <Text
        style={{
          color: '#E5E7EB',
          fontWeight: '800',
          marginBottom: 8,
        }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function StatLine({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
      }}>
      <Text style={{ color: '#9CA3AF' }}>{label}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            color: '#E5E7EB',
            fontWeight: '700',
          }}>
          {value}
        </Text>
        {helper ? (
          <Text
            style={{
              color: '#9CA3AF',
              fontSize: 11,
            }}>
            {helper}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: '#9CA3AF',
        fontSize: 12,
        marginTop: 6,
      }}>
      {children}
    </Text>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: '#E5E7EB',
        fontSize: 13,
        marginBottom: 2,
      }}>
      • {children}
    </Text>
  );
}

function formatMoney(v: number | null | undefined) {
  if (v == null || isNaN(v as any)) return '—';
  return '$' + Number(v).toFixed(2);
}

function buildWeeklyPerformanceHtml(s: WeeklyPerformanceSummary) {
  const name = s.venueName || 'Venue';
  const safe = (x: any) => (x == null ? '—' : String(x));

  const gp =
    s.gp.actual != null ? `${s.gp.actual.toFixed(1)}%` : 'Not enough data';
  const sales =
    s.sales.totalNetSales != null
      ? '$' + s.sales.totalNetSales.toFixed(2)
      : 'Missing';
  const spend =
    s.spend.totalSpend != null
      ? '$' + s.spend.totalSpend.toFixed(2)
      : 'Missing';
  const shrink =
    s.variance.totalShrinkValue != null
      ? '$' + s.variance.totalShrinkValue.toFixed(2)
      : 'None / not recorded';

  const flagsHtml =
    s.flags && s.flags.length
      ? '<ul>' + s.flags.map((f) => `<li>${escapeHtml(f)}</li>`).join('') + '</ul>'
      : '<p>No issues detected.</p>';

  return `
    <html>
      <body style="font-family:-apple-system,Roboto,sans-serif;padding:16px;">
        <h2>${escapeHtml(name)} — Weekly Performance</h2>
        <p style="color:#4B5563;margin:0 0 12px 0;">${escapeHtml(
          s.windowLabel || 'Last 7 days',
        )}</p>

        <h3>Key metrics</h3>
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">Actual GP</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${gp}</td>
          </tr>
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">Net sales</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${sales}</td>
          </tr>
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">Spend (invoices)</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${spend}</td>
          </tr>
          <tr>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;">Shrinkage (value)</td>
            <td style="padding:6px;border-bottom:1px solid #E5E7EB;text-align:right;">${shrink}</td>
          </tr>
        </table>

        <h3>Stocktake coverage</h3>
        <p>
          Departments: ${safe(s.stock.departments)}<br/>
          Areas: ${safe(s.stock.areasCompleted)}/${safe(
    s.stock.areasTotal,
  )} completed (${safe(s.stock.areasInProgress)} in progress)
        </p>

        <h3>Data quality</h3>
        ${flagsHtml}
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
