import React, { useMemo } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useDensity } from '../../hooks/useDensity';

type Params = { venueId?: string; departmentId?: string };

function ReportsIndexScreen() {
  dlog('[TallyUp Reports] ReportsIndexScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as Params;
  const { isCompact } = useDensity();

  const [lastOpened] = usePersistedState<string>('ui:reports:lastOpened', '');
  const lastMeta = useMemo(() => {
    if (!lastOpened) return null;
    const label =
      lastOpened === 'DepartmentVariance' ? 'Department Variance'
      : lastOpened === 'CountActivity' ? 'Count Activity'
      : lastOpened === 'LastCycleSummary' ? 'Last Cycle Summary'
      : null;
    if (!label) return null;
    return { name: lastOpened, label };
  }, [lastOpened]);

  const D = isCompact ? 0.92 : 1;

  const go = (name: string) => nav.navigate(name as never, { venueId, departmentId });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: isCompact ? 20 : 22, fontWeight: '900', marginBottom: 8 }}>Reports</Text>
        <Text style={{ color: '#6B7280', marginBottom: 12 }}>
          Choose a report. These respect your current venue{departmentId ? ` and department` : ''}.
        </Text>

        {lastMeta ? (
          <View style={{ marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' }}>
            <Text style={{ fontWeight: '800', marginBottom: 8 }}>Last opened</Text>
            <TouchableOpacity onPress={() => go(lastMeta.name)} style={{ paddingVertical: 10*D, paddingHorizontal: 12*D, borderRadius: 10, backgroundColor: '#111827' }}>
              <Text style={{ color: 'white', fontWeight: '800' }}>{lastMeta.label}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ gap: 10 }}>
          <TouchableOpacity onPress={() => go('DepartmentVariance')} style={{ padding: 14*D, borderRadius: 12, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#DBEAFE' }}>
            <Text style={{ fontWeight: '800', color: '#1E40AF' }}>Department Variance</Text>
            <Text style={{ color: '#1E3A8A' }}>Expected vs Counted per area; filter & export.</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => go('CountActivity')} style={{ padding: 14*D, borderRadius: 12, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#D1FAE5' }}>
            <Text style={{ fontWeight: '800', color: '#065F46' }}>Count Activity</Text>
            <Text style={{ color: '#065F46' }}>Recent counts with flags / below-par; filter & export.</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => go('LastCycleSummary')} style={{ padding: 14*D, borderRadius: 12, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB' }}>
            <Text style={{ fontWeight: '800', color: '#111827' }}>Last Cycle Summary</Text>
            <Text style={{ color: '#374151' }}>Top-level progress snapshot; export.</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

export default withErrorBoundary(ReportsIndexScreen, 'Reports Index');
