// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import LocalThemeGate from '../../theme/LocalThemeGate';
import IdentityBadge from '../../components/IdentityBadge';
import { fetchBriefing, BriefingData } from '../../services/reports/briefing';
import { explainVariance } from '../../services/aiVariance';

// ─── Tiny helpers ────────────────────────────────────────────────────────────

function fmtDollars(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtMins(mins: number | null): string {
  if (mins == null) return '–';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ─── Lane section wrapper ────────────────────────────────────────────────────

function Lane({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.lane}>
      <Text style={styles.laneLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ─── Secondary nav tile ──────────────────────────────────────────────────────

function NavTile({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.navTile} onPress={onPress} activeOpacity={0.75}>
      <Text style={styles.navTileText}>{title}</Text>
      <Text style={styles.navTileChev}>›</Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ReportsIndexScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BriefingData | null>(null);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const isManager = data?.role === 'owner' || data?.role === 'manager';

  useEffect(() => {
    if (!venueId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    setAiInsight(null);

    fetchBriefing(venueId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);

        // Fire AI insight async — non-blocking
        const isOwnerOrManager = d.role === 'owner' || d.role === 'manager';
        if (d.hasCountData && isOwnerOrManager) {
          setAiLoading(true);
          explainVariance({
            venueId,
            shortages: d.topShortages.map((s) => ({
              name: s.name,
              dollarVariance: s.dollarVariance,
              varianceUnits: s.varianceUnits,
            })),
            totalVarianceDollars: d.shortfallDollars,
            trendItems: d.trendItems.map((t) => t.name),
            totalItemsCounted: d.totalItemsCounted,
            mode: 'briefing',
          })
            .then((res) => {
              if (!cancelled) setAiInsight(res.summary || null);
            })
            .catch(() => {})
            .finally(() => {
              if (!cancelled) setAiLoading(false);
            });
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [venueId]);

  // ── Empty / loading states ────────────────────────────────────────────────

  if (!venueId) {
    return (
      <LocalThemeGate>
        <View style={styles.root}>
          <ScreenHeader />
          <View style={styles.centred}>
            <Text style={styles.emptyTitle}>No venue selected</Text>
            <Text style={styles.emptyBody}>Select a venue to see your briefing.</Text>
          </View>
        </View>
      </LocalThemeGate>
    );
  }

  if (loading) {
    return (
      <LocalThemeGate>
        <View style={styles.root}>
          <ScreenHeader />
          <View style={styles.centred}>
            <ActivityIndicator color="#60A5FA" size="large" />
            <Text style={[styles.emptyBody, { marginTop: 12 }]}>Building your briefing…</Text>
          </View>
        </View>
      </LocalThemeGate>
    );
  }

  if (!data?.hasCountData) {
    return (
      <LocalThemeGate>
        <View style={styles.root}>
          <ScreenHeader />
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nothing to brief yet</Text>
              <Text style={styles.emptyBody}>
                Complete a stocktake to see your first briefing — variance, trends, and what to act
                on.
              </Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => nav.navigate('DepartmentSelection')}
              >
                <Text style={styles.ctaBtnText}>Start a stocktake</Text>
              </TouchableOpacity>
            </View>
            {isManager && <SecondaryNav nav={nav} />}
          </ScrollView>
        </View>
      </LocalThemeGate>
    );
  }

  // ── Full briefing view ────────────────────────────────────────────────────

  const netVariance = data.shortfallDollars - data.excessDollars;
  const hasDollarData = data.dollarItemCount > 0;

  return (
    <LocalThemeGate>
      <View style={styles.root}>
        <ScreenHeader />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>

          {/* ── ANCHOR METRIC (owner/manager only) ── */}
          {isManager && (
            <View style={styles.anchorCard}>
              <Text style={styles.anchorLabel}>VARIANCE THIS STOCKTAKE</Text>
              {hasDollarData ? (
                <>
                  <Text style={[styles.anchorValue, { color: data.shortfallDollars > 0 ? '#F87171' : '#4ADE80' }]}>
                    {data.shortfallDollars > 0 ? `–${fmtDollars(data.shortfallDollars)}` : 'On track'}
                  </Text>
                  {data.excessDollars > 0 && (
                    <Text style={styles.anchorSub}>
                      +{fmtDollars(data.excessDollars)} excess
                    </Text>
                  )}
                  <Text style={styles.anchorMeta}>
                    {data.dollarItemCount} of {data.totalItemsCounted} items have cost prices ·{' '}
                    {data.totalAreasCompleted}/{data.totalAreas} areas done
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.anchorValue, { color: '#94A3B8', fontSize: 28 }]}>
                    No cost prices yet
                  </Text>
                  <Text style={styles.anchorMeta}>
                    Add cost prices to products to see dollar variance.
                  </Text>
                </>
              )}
            </View>
          )}

          {/* ── STAFF ANCHOR ── */}
          {!isManager && (
            <View style={styles.anchorCard}>
              <Text style={styles.anchorLabel}>STOCKTAKE PROGRESS</Text>
              <Text style={[styles.anchorValue, { fontSize: 30, color: '#F9FAFB' }]}>
                {data.totalAreasCompleted}/{data.totalAreas} areas done
              </Text>
              <Text style={styles.anchorMeta}>
                {data.totalItemsCounted} items counted this cycle
              </Text>
            </View>
          )}

          {/* ── LANE 1: WHERE IT LEAKED ── */}
          {isManager && (
            <Lane label="WHERE IT LEAKED">
              {data.topShortages.length === 0 ? (
                <Text style={styles.laneEmpty}>
                  {data.hasPrevCycleData
                    ? 'No shortages detected this cycle.'
                    : 'Nothing to compare yet — par levels used as baseline.'}
                </Text>
              ) : (
                <>
                  {data.topShortages.map((item) => (
                    <View key={item.itemId} style={styles.lineRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.lineRowName}>{item.name}</Text>
                        <Text style={styles.lineRowSub}>
                          {item.areaName} · {item.deptName}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.lineRowNeg}>
                          {item.varianceUnits}
                        </Text>
                        {item.dollarVariance > 0 && (
                          <Text style={styles.lineRowDollar}>
                            –{fmtDollars(item.dollarVariance)}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.laneLink}
                    onPress={() => nav.navigate('DepartmentVariance')}
                  >
                    <Text style={styles.laneLinkText}>See full breakdown →</Text>
                  </TouchableOpacity>
                </>
              )}
            </Lane>
          )}

          {/* ── LANE 2: WHAT THE TREND SAYS ── */}
          {isManager && (
            <Lane label="WHAT THE TREND SAYS">
              {!data.hasPrevCycleData ? (
                <View style={styles.unlockBox}>
                  <Text style={styles.unlockTitle}>Needs 2 completed stocktakes</Text>
                  <Text style={styles.unlockBody}>
                    Complete another full stocktake and trend detection will activate — showing you
                    items that are consistently short cycle after cycle.
                  </Text>
                </View>
              ) : data.trendItems.length === 0 ? (
                <Text style={styles.laneEmpty}>No items short in two consecutive cycles.</Text>
              ) : (
                <>
                  <Text style={styles.trendIntro}>
                    Short in the last two stocktakes — these aren't one-offs:
                  </Text>
                  {data.trendItems.map((item) => (
                    <View key={item.itemId} style={styles.trendRow}>
                      <View style={styles.trendDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.trendName}>{item.name}</Text>
                        <Text style={styles.trendSub}>{item.deptName}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </Lane>
          )}

          {/* ── LANE 3: WHAT TO DO ABOUT IT ── */}
          {isManager && (
            <Lane label="WHAT TO DO ABOUT IT">
              {aiLoading ? (
                <View style={styles.aiLoading}>
                  <ActivityIndicator color="#60A5FA" size="small" />
                  <Text style={styles.aiLoadingText}>Analysing…</Text>
                </View>
              ) : aiInsight ? (
                <Text style={styles.aiText}>{aiInsight}</Text>
              ) : (
                <Text style={styles.laneEmpty}>
                  AI analysis unavailable — check your connection.
                </Text>
              )}
            </Lane>
          )}

          {/* ── AREA STATS (all roles) ── */}
          <Lane label={isManager ? 'AREA BREAKDOWN' : 'YOUR AREAS THIS CYCLE'}>
            {data.areaStats.length === 0 ? (
              <Text style={styles.laneEmpty}>No areas counted yet.</Text>
            ) : (
              data.areaStats.map((area) => (
                <View key={area.areaId} style={styles.areaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.areaName}>{area.areaName}</Text>
                    <Text style={styles.areaSub}>{area.deptName}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.areaDuration}>{fmtMins(area.durationMins)}</Text>
                    {area.itemsCounted > 0 && (
                      <Text style={styles.areaMeta}>
                        {area.itemsCounted}/{area.totalItems} items
                        {area.shortItems > 0 ? ` · ${area.shortItems} short` : ''}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </Lane>

          {/* ── Secondary nav (owner/manager only) ── */}
          {isManager && <SecondaryNav nav={nav} />}
        </ScrollView>
      </View>
    </LocalThemeGate>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScreenHeader() {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle}>Briefing</Text>
        <Text style={styles.headerSub}>What happened. What it means. What to do.</Text>
      </View>
      <IdentityBadge align="right" />
    </View>
  );
}

function SecondaryNav({ nav }: { nav: any }) {
  return (
    <View style={styles.secondaryNav}>
      <Text style={styles.secondaryNavLabel}>DETAILED REPORTS</Text>
      <NavTile title="Variance Snapshot" onPress={() => nav.navigate('VarianceSnapshot')} />
      <NavTile title="Department Variance" onPress={() => nav.navigate('DepartmentVariance')} />
      <NavTile title="Weekly Performance" onPress={() => nav.navigate('LastCycleSummary')} />
      <NavTile title="Budgets" onPress={() => nav.navigate('Budgets')} />
      <NavTile title="Invoice Reconciliations" onPress={() => nav.navigate('Reconciliations')} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F1115',
  },
  header: {
    padding: 16,
    borderBottomColor: '#263142',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '700',
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 2,
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
  },
  emptyTitle: {
    color: '#F9FAFB',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyBody: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
  },
  ctaBtn: {
    marginTop: 20,
    backgroundColor: '#1D4ED8',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  ctaBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },

  // Anchor card
  anchorCard: {
    backgroundColor: '#0B132B',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E3A5F',
  },
  anchorLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  anchorValue: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  anchorSub: {
    color: '#4ADE80',
    fontSize: 15,
    marginTop: 4,
  },
  anchorMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 8,
  },

  // Lane
  lane: {
    marginBottom: 16,
    backgroundColor: '#161B2A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  laneLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
  },
  laneEmpty: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
  },
  laneLink: {
    marginTop: 12,
  },
  laneLinkText: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: '600',
  },

  // Variance line rows
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  lineRowName: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
  },
  lineRowSub: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  lineRowNeg: {
    color: '#F87171',
    fontSize: 16,
    fontWeight: '700',
  },
  lineRowDollar: {
    color: '#F87171',
    fontSize: 12,
    marginTop: 2,
  },

  // Trend rows
  trendIntro: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  trendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
    marginRight: 12,
  },
  trendName: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
  },
  trendSub: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },

  // Unlock box
  unlockBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  unlockTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  unlockBody: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
  },

  // AI insight
  aiLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiLoadingText: {
    color: '#64748B',
    fontSize: 13,
  },
  aiText: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 21,
  },

  // Area rows
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  areaName: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
  },
  areaSub: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  areaDuration: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  areaMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },

  // Secondary nav
  secondaryNav: {
    marginTop: 8,
  },
  secondaryNavLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 8,
  },
  navTile: {
    backgroundColor: '#161B2A',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  navTileText: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '500',
  },
  navTileChev: {
    color: '#475569',
    fontSize: 20,
    fontWeight: '300',
  },
});
