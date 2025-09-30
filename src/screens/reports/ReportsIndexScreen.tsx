import React, { useMemo } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { useDensity } from '../../hooks/useDensity';

type RouteParams = { venueId?: string; departmentId: string };

function ReportsIndexScreen() {
  dlog('[TallyUp Reports] ReportsIndexScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as RouteParams;
  const { isCompact } = useDensity();
  const D = isCompact ? 0.86 : 1;

  const Card: React.FC<{ title: string; subtitle: string; onPress: () => void }> = ({ title, subtitle, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingVertical: 14 * D, paddingHorizontal: 16 * D, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' }}
    >
      <Text style={{ fontSize: isCompact ? 16 : 18, fontWeight: '800', marginBottom: 4 }}>{title}</Text>
      <Text style={{ color: '#6B7280' }}>{subtitle}</Text>
    </TouchableOpacity>
  );

  const disabled = useMemo(() => !venueId || !departmentId, [venueId, departmentId]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: isCompact ? 18 : 20, fontWeight: '900', marginBottom: 6 }}>Reports</Text>
        <Text style={{ color: '#6B7280', marginBottom: 8 }}>
          Explore area-level variance and count activity. Exports match the CSV behavior in stock.
        </Text>

        <Card
          title="Department Variance"
          subtitle="Compare Expected vs Counted per area in this department"
          onPress={() => !disabled && nav.navigate('DepartmentVariance', { venueId, departmentId })}
        />
        <Card
          title="Count Activity"
          subtitle="Recent count activity across areas and items"
          onPress={() => !disabled && nav.navigate('CountActivity', { venueId, departmentId })}
        />

        {disabled ? (
          <View style={{ padding: 12, borderRadius: 10, backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1 }}>
            <Text style={{ color: '#92400E', fontWeight: '700' }}>
              Missing venue/department context. Open Reports from an Area to auto-fill context.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default withErrorBoundary(ReportsIndexScreen, 'Reports Index');
