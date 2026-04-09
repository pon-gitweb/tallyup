// @ts-nocheck
/**
 * StocktakeSummaryScreen
 * Shown after a full department stocktake is submitted.
 * Shows counts, value, variance summary and AI insight.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { markStepComplete } from '../../services/guide/SetupGuideService';

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

function StocktakeSummaryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const themeColours = useColours();
  const {
    departmentName, submittedAt, itemsCounted,
    itemsMissed, totalValue, windowHours, items = [],
  } = (route.params || {}) as Props;

  useEffect(() => {
    // Mark first stocktake guide step complete
    markStepComplete('first_stocktake').catch(() => {});
  }, []);

  const formatDuration = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)} minutes`;
    if (hours === 1) return '1 hour';
    return `${Math.round(hours)} hours`;
  };

  const completionPct = itemsCounted + itemsMissed > 0
    ? Math.round((itemsCounted / (itemsCounted + itemsMissed)) * 100)
    : 100;

  const barColour = completionPct === 100 ? themeColours.success : completionPct >= 80 ? themeColours.warning : themeColours.error;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Hero */}
      <View style={{ backgroundColor: themeColours.primary, borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 48 }}>✅</Text>
        <Text style={{ fontSize: 24, fontWeight: '900', color: '#fff' }}>Stocktake complete!</Text>
        {windowHours > 0 && (
          <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, marginTop: 4 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>
              ⏱ Done in {formatDuration(windowHours)}
            </Text>
          </View>
        )}
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 4 }}>
          {departmentName} · {new Date(submittedAt).toLocaleString('en-NZ')}
        </Text>
      </View>

      {/* Quick stats */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          { label: 'Items counted', value: itemsCounted, colour: themeColours.success },
          { label: 'Not counted', value: itemsMissed, colour: itemsMissed > 0 ? themeColours.warning : themeColours.success },
          { label: 'Duration', value: formatDuration(windowHours), colour: themeColours.accent, small: true },
        ].map((stat, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: themeColours.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: themeColours.border }}>
            <Text style={{ fontSize: stat.small ? 16 : 28, fontWeight: '900', color: stat.colour }}>{stat.value}</Text>
            <Text style={{ color: themeColours.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 2 }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Completion rate */}
      <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColours.border }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ fontWeight: '800', color: themeColours.text }}>Completion rate</Text>
          <Text style={{ fontWeight: '900', color: barColour }}>{completionPct}%</Text>
        </View>
        <View style={{ height: 8, backgroundColor: themeColours.border, borderRadius: 4, overflow: 'hidden' }}>
          <View style={{ height: 8, width: completionPct + '%', backgroundColor: barColour, borderRadius: 4 }} />
        </View>
        {itemsMissed > 0 && (
          <Text style={{ color: themeColours.warning, fontSize: 12, marginTop: 8 }}>
            ⚠️ {itemsMissed} item{itemsMissed > 1 ? 's were' : ' was'} recorded as 0 (not counted)
          </Text>
        )}
      </View>

      {/* Total stock value */}
      {totalValue > 0 && (
        <View style={{ backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
          <Text style={{ color: '#166534', fontWeight: '700', marginBottom: 4 }}>Total stock value counted</Text>
          <Text style={{ fontSize: 32, fontWeight: '900', color: '#166534' }}>
            ${totalValue.toFixed(2)}
          </Text>
          <Text style={{ color: '#166534', fontSize: 12, marginTop: 4 }}>Based on cost prices in your product list</Text>
        </View>
      )}

      {/* What's next */}
      <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: themeColours.border }}>
        <Text style={{ fontWeight: '900', color: themeColours.text, marginBottom: 12 }}>What would you like to do next?</Text>
        {[
          { icon: '📊', label: 'View variance report', desc: 'See what changed since last stocktake', route: 'Reports' },
          { icon: '📦', label: 'Place an order', desc: 'AI will suggest what to reorder', route: 'SuggestedOrders' },
          { icon: '🏠', label: 'Back to dashboard', desc: null, route: 'Dashboard' },
        ].map((item, i) => (
          <TouchableOpacity key={i} onPress={() => nav.navigate(item.route as never)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
              borderTopWidth: i > 0 ? 1 : 0, borderTopColor: themeColours.border }}>
            <Text style={{ fontSize: 22 }}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: themeColours.text }}>{item.label}</Text>
              {item.desc && <Text style={{ color: themeColours.textSecondary, fontSize: 12, marginTop: 1 }}>{item.desc}</Text>}
            </View>
            <Text style={{ color: themeColours.textSecondary, fontSize: 18 }}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(StocktakeSummaryScreen, 'StocktakeSummary');
