// @ts-nocheck
/**
 * StocktakeSummaryScreen
 * Shown after a full department stocktake is submitted.
 * Shows counts, value, variance summary and AI insight.
 * On first cycle: also shows stock holding baseline, category breakdown,
 * projected retail value, and dead stock flags.
 * When autoSuggestPar is enabled: shows PAR review for items below their level.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { resetAllDepartmentsStockTake } from '../../services/reset';
import { useVenueId } from '../../context/VenueProvider';
import { markStepComplete } from '../../services/guide/SetupGuideService';
import { db } from '../../services/firebase';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

type SummaryItem = {
  name: string;
  counted: number;
  unit?: string;
  costPrice?: number;
};

type Props = {
  departmentName: string;
  submittedAt: string;
  itemsCounted: number;
  itemsMissed: number;
  totalValue: number;
  windowHours: number;
  items: SummaryItem[];
};

type CategoryBreakdown = { category: string; itemCount: number; value: number };

type BaselineData = {
  isFirstCycle: boolean;
  autoSuggestPar: boolean;
  categoryBreakdown: CategoryBreakdown[];
  projectedRetailValue: number;
  deadStock: SummaryItem[];
  parIssues: { name: string; counted: number; parLevel: number; unit?: string }[];
};

function StocktakeSummaryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const themeColours = useColours();
  const venueId = useVenueId();
  const { showError } = useToast();
  const { confirm, modal } = useConfirmModal();
  const [resetting, setResetting] = React.useState(false);
  const [baseline, setBaseline] = useState<BaselineData | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [activeMinutes, setActiveMinutes] = useState<number | null>(null);
  const [totalBreaks, setTotalBreaks] = useState<number>(0);
  const [breakMinutes, setBreakMinutes] = useState<number>(0);

  const handleNewCycle = () => {
    confirm({
      title: 'Start new stocktake?',
      message: 'This will reset all areas so you can begin a fresh count. Your completed data is saved.',
      confirmLabel: 'Start new stocktake',
      onConfirm: async () => {
        setResetting(true);
        try {
          await resetAllDepartmentsStockTake(venueId);
          nav.navigate('Dashboard' as never);
        } catch (e) {
          showError('Could not reset stocktake. Please try again.');
        } finally { setResetting(false); }
      },
    });
  };

  const {
    departmentName, submittedAt, itemsCounted,
    itemsMissed, totalValue, windowHours, items = [],
  } = (route.params || {}) as Props;

  useEffect(() => {
    markStepComplete('first_stocktake').catch(() => {});
  }, []);

  // Load baseline and PAR data from Firestore
  useEffect(() => {
    if (!venueId) { setBaselineLoading(false); return; }
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        const venueData = venueSnap.data() as any ?? {};
        const completedCount: number = venueData.totalStocktakesCompleted ?? 0;
        const autoSuggestPar: boolean = venueData.autoSuggestPar === true;
        const isFirstCycle = completedCount <= 1;

        if (!isFirstCycle && !autoSuggestPar) {
          setBaselineLoading(false);
          return;
        }

        // Load products for category mapping + PAR levels
        const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
        const categoryMap: Record<string, string> = {};
        const parMap: Record<string, number> = {};
        productsSnap.forEach(d => {
          const p = d.data() as any;
          const key = (p.name ?? '').toLowerCase().trim();
          if (key) {
            if (p.categorySuggested) categoryMap[key] = p.categorySuggested;
            if (typeof p.parLevel === 'number') parMap[key] = p.parLevel;
          }
        });

        // Build category breakdown (first cycle only)
        const byCategory: Record<string, { itemCount: number; value: number }> = {};
        const deadStock: SummaryItem[] = [];
        for (const item of items) {
          const key = item.name.toLowerCase().trim();
          const cat = categoryMap[key] ?? 'Uncategorised';
          if (!byCategory[cat]) byCategory[cat] = { itemCount: 0, value: 0 };
          byCategory[cat].itemCount += 1;
          byCategory[cat].value += item.counted * (item.costPrice ?? 0);
          if (item.counted === 0) deadStock.push(item);
        }
        const categoryBreakdown: CategoryBreakdown[] = Object.entries(byCategory)
          .map(([category, d]) => ({ category, ...d }))
          .sort((a, b) => b.value - a.value);

        // PAR issues: items counted below their PAR level (when autoSuggestPar)
        const parIssues: BaselineData['parIssues'] = [];
        if (autoSuggestPar) {
          for (const item of items) {
            const key = item.name.toLowerCase().trim();
            const parLevel = parMap[key];
            if (parLevel != null && item.counted < parLevel) {
              parIssues.push({ name: item.name, counted: item.counted, parLevel, unit: item.unit });
            }
          }
          parIssues.sort((a, b) => (a.counted / a.parLevel) - (b.counted / b.parLevel));
        }

        setBaseline({
          isFirstCycle,
          autoSuggestPar,
          categoryBreakdown,
          projectedRetailValue: totalValue * 1.15, // cost + 15% GST as minimum retail floor
          deadStock,
          parIssues,
        });
      } catch (e) {
        // non-critical — silent fail
      } finally {
        setBaselineLoading(false);
      }
    })();
  }, [venueId, items, totalValue]);

  // Load active counting time across all departments' areas
  useEffect(() => {
    if (!venueId) return;
    (async () => {
      try {
        const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
        let totalActive = 0;
        let totalBreakCount = 0;
        await Promise.all(deptsSnap.docs.map(async deptDoc => {
          const areasSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas')
          );
          areasSnap.docs.forEach(d => {
            const data = d.data();
            if (typeof data.activeCountingMinutes === 'number') {
              totalActive += data.activeCountingMinutes;
            }
            const segs = data.countSessionSegments || [];
            if (segs.length > 1) totalBreakCount += segs.length - 1;
          });
        }));
        const wallMinutes = Math.round(windowHours * 60);
        const breakMins = Math.max(0, wallMinutes - Math.round(totalActive));
        setActiveMinutes(Math.round(totalActive));
        setTotalBreaks(totalBreakCount);
        setBreakMinutes(breakMins);
      } catch {
        // Non-fatal — falls back to wall clock display
      }
    })();
  }, [venueId, windowHours]);

  const formatDuration = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)} minutes`;
    if (hours === 1) return '1 hour';
    return `${Math.round(hours)} hours`;
  };

  const completionPct = itemsCounted + itemsMissed > 0
    ? Math.round((itemsCounted / (itemsCounted + itemsMissed)) * 100)
    : 100;

  const barColour = completionPct === 100 ? themeColours.success : completionPct >= 80 ? themeColours.warning : themeColours.error;

  const c = themeColours;

  const isFirst = !baselineLoading && baseline?.isFirstCycle === true;

  const handleShareReport = async () => {
    try {
      await Share.share({
        message: `Stocktake complete at ${venueId ? 'our venue' : departmentName}. ${itemsCounted} products counted. ${totalValue > 0 ? `Stock value: $${totalValue.toFixed(2)}.` : ''}`,
        title: 'Stocktake Report',
      });
    } catch {}
  };

  return (
    <>
      {modal}
      <ScrollView style={{ flex: 1, backgroundColor: '#f5f3ee' }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Hero */}
      <View style={{ backgroundColor: isFirst ? '#1b4f72' : '#0B132B', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 48 }}>{isFirst ? '🎉' : '✅'}</Text>
        <Text style={{ fontSize: 24, fontWeight: '900', color: '#fff' }}>
          {isFirst ? 'First stocktake complete!' : 'Stocktake complete'}
        </Text>
        {windowHours > 0 && (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, marginTop: 4 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>
              ⏱ {activeMinutes != null && activeMinutes > 0
                ? `${activeMinutes} min active counting${totalBreaks > 0 ? ` · ${totalBreaks} break${totalBreaks > 1 ? 's' : ''} (${breakMinutes} min) excluded` : ''}`
                : `Done in ${formatDuration(windowHours)}`
              }
            </Text>
          </View>
        )}
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 4 }}>
          {departmentName} · {new Date(submittedAt).toLocaleString('en-NZ')}
        </Text>
        {isFirst && (
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center', marginTop: 4 }}>
            Well done — your stock is now on record for the first time.
          </Text>
        )}
      </View>

      {/* Quick stats */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          { label: 'Items counted', value: itemsCounted, colour: c.success },
          { label: 'Not counted', value: itemsMissed, colour: itemsMissed > 0 ? c.warning : c.success },
          { label: 'Duration', value: activeMinutes != null && activeMinutes > 0 ? `${activeMinutes} min` : formatDuration(windowHours), colour: '#1b4f72', small: true },
          ...(activeMinutes != null && totalBreaks > 0 ? [{ label: 'Breaks excluded', value: `${totalBreaks} break${totalBreaks > 1 ? 's' : ''} · ${breakMinutes} min`, colour: '#6b7280', small: true }] : []),
        ].map((stat, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' }}>
            <Text style={{ fontSize: stat.small ? 16 : 28, fontWeight: '900', color: stat.colour }}>{stat.value}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 2 }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Completion rate */}
      <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ fontWeight: '800', color: c.text }}>Completion rate</Text>
          <Text style={{ fontWeight: '900', color: barColour }}>{completionPct}%</Text>
        </View>
        <View style={{ height: 8, backgroundColor: c.border, borderRadius: 4, overflow: 'hidden' }}>
          <View style={{ height: 8, width: completionPct + '%', backgroundColor: barColour, borderRadius: 4 }} />
        </View>
        {itemsMissed > 0 && (
          <Text style={{ color: c.warning, fontSize: 12, marginTop: 8 }}>
            ⚠️ {itemsMissed} item{itemsMissed > 1 ? 's were' : ' was'} recorded as 0 (not counted)
          </Text>
        )}
      </View>

      {/* Total stock value */}
      {totalValue > 0 && (
        <View style={{ backgroundColor: c.primaryLight, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.success, fontWeight: '700', marginBottom: 4 }}>Total stock value counted</Text>
          <Text style={{ fontSize: 32, fontWeight: '900', color: c.success }}>
            ${totalValue.toFixed(2)}
          </Text>
          <Text style={{ color: c.success, fontSize: 12, marginTop: 4 }}>Based on cost prices in your product list</Text>
        </View>
      )}

      {/* First-cycle baseline */}
      {!baselineLoading && baseline?.isFirstCycle && (
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 20 }}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '900', color: c.text, fontSize: 16 }}>First stocktake baseline</Text>
              <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 1 }}>
                Your opening stock position — use this as your benchmark.
              </Text>
            </View>
          </View>

          {/* Category breakdown */}
          {baseline.categoryBreakdown.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: '800', color: c.text, marginBottom: 2 }}>By category</Text>
              {baseline.categoryBreakdown.map((row, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border }}>
                  <Text style={{ color: c.text, fontWeight: '600', flex: 1 }}>{row.category}</Text>
                  <Text style={{ color: c.textSecondary, fontSize: 12, marginRight: 12 }}>{row.itemCount} item{row.itemCount !== 1 ? 's' : ''}</Text>
                  <Text style={{ color: c.primary, fontWeight: '800' }}>${row.value.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Projected retail value */}
          {baseline.projectedRetailValue > 0 && (
            <View style={{ backgroundColor: c.primaryLight, borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: c.primary }}>Projected retail value</Text>
                <Text style={{ color: c.textSecondary, fontSize: 11, marginTop: 1 }}>Cost + 15% GST (minimum floor)</Text>
              </View>
              <Text style={{ fontSize: 20, fontWeight: '900', color: c.primary }}>
                ${baseline.projectedRetailValue.toFixed(2)}
              </Text>
            </View>
          )}

          {/* Dead stock flags */}
          {baseline.deadStock.length > 0 && (
            <View>
              <Text style={{ fontWeight: '800', color: c.warning, marginBottom: 6 }}>
                ⚠️ Dead stock ({baseline.deadStock.length} item{baseline.deadStock.length !== 1 ? 's' : ''} at zero)
              </Text>
              {baseline.deadStock.slice(0, 5).map((item, i) => (
                <Text key={i} style={{ color: c.textSecondary, fontSize: 12, marginBottom: 2 }}>
                  • {item.name}{item.unit ? ` (${item.unit})` : ''}
                </Text>
              ))}
              {baseline.deadStock.length > 5 && (
                <Text style={{ color: c.textSecondary, fontSize: 12 }}>
                  + {baseline.deadStock.length - 5} more
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* PAR suggestions (shown when autoSuggestPar is on and there are issues) */}
      {!baselineLoading && baseline?.autoSuggestPar && baseline.parIssues.length > 0 && (
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.amber + '66', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 20 }}>📋</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '900', color: c.text, fontSize: 16 }}>PAR review</Text>
              <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 1 }}>
                {baseline.parIssues.length} item{baseline.parIssues.length !== 1 ? 's are' : ' is'} below PAR level
              </Text>
            </View>
          </View>

          {baseline.parIssues.slice(0, 8).map((issue, i) => {
            const pct = Math.round((issue.counted / issue.parLevel) * 100);
            return (
              <View key={i} style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: c.border, paddingTop: i > 0 ? 8 : 0 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: c.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{issue.name}</Text>
                  <Text style={{ color: c.warning, fontWeight: '800', fontSize: 13 }}>
                    {issue.counted}/{issue.parLevel} {issue.unit ?? ''}
                  </Text>
                </View>
                <View style={{ height: 4, backgroundColor: c.border, borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <View style={{ height: 4, width: Math.min(pct, 100) + '%', backgroundColor: pct < 50 ? c.error : c.warning, borderRadius: 2 }} />
                </View>
              </View>
            );
          })}
          {baseline.parIssues.length > 8 && (
            <Text style={{ color: c.textSecondary, fontSize: 12 }}>+ {baseline.parIssues.length - 8} more</Text>
          )}

          <TouchableOpacity
            onPress={() => nav.navigate('Dashboard' as never)}
            style={{ backgroundColor: c.primaryLight, borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 4 }}>
            <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13 }}>Review & update PAR levels →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* What's next — context-aware CTAs */}
      <View style={{ gap: 10 }}>
        {isFirst ? (
          <TouchableOpacity
            style={{ backgroundColor: '#1b4f72', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' }}
            onPress={() => nav.navigate('StockHolding' as never)}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>View stock report →</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={{ backgroundColor: '#1b4f72', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' }}
              onPress={() => nav.navigate('Reports' as never)}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>View variance report →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' }}
              onPress={handleShareReport}
            >
              <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 15 }}>Share report</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={{ backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' }}
          onPress={handleNewCycle}
          disabled={resetting}
        >
          <Text style={{ color: '#374151', fontWeight: '700', fontSize: 15 }}>
            {resetting ? 'Resetting…' : 'Start next stocktake'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ paddingVertical: 10, alignItems: 'center' }}
          onPress={() => nav.navigate('Dashboard' as never)}
        >
          <Text style={{ color: '#6B7280', fontSize: 13 }}>Back to dashboard</Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: 20 }} />
    </ScrollView>
    </>
  );
}

export default withErrorBoundary(StocktakeSummaryScreen, 'StocktakeSummary');
