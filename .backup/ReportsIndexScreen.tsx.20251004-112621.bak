import React, { useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { useDensity } from '../../hooks/useDensity';

type RouteParams = { venueId?: string; departmentId?: string };

function ReportsIndexScreen() {
  dlog('[TallyUp Reports] ReportsIndexScreen');
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, departmentId } = (route.params ?? {}) as RouteParams;
  const { isCompact } = useDensity();
  const [showInfo, setShowInfo] = useState(false);
  const D = isCompact ? 0.86 : 1;

  const disabled = useMemo(() => !venueId || !departmentId, [venueId, departmentId]);

  const Card: React.FC<{ title: string; subtitle: string; onPress: () => void }> = ({ title, subtitle, onPress }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingVertical: 14 * D, paddingHorizontal: 16 * D, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' }}
    >
      <Text style={{ fontSize: isCompact ? 16 : 18, fontWeight: '800', marginBottom: 4 }}>{title}</Text>
      <Text style={{ color: '#6B7280' }}>{subtitle}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Header: left block flexes, button stays visible */}
        <View style={{ flexDirection:'row', alignItems:'flex-start', marginBottom: 4 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontSize: isCompact ? 18 : 20, fontWeight: '900' }}>Reports (this department)</Text>
            <Text style={{ color: '#6B7280', marginTop: 2 }}>Variance and activity views scoped to the current department.</Text>
          </View>
          <TouchableOpacity onPress={() => setShowInfo(true)} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor:'#EEF2FF', borderWidth:1, borderColor:'#E0E7FF' }}>
            <Text style={{ fontWeight:'800', color:'#3730A3' }}>Learn more</Text>
          </TouchableOpacity>
        </View>

        <Card
          title="Department Variance"
          subtitle="Compare Expected vs Counted per area"
          onPress={() => !disabled && nav.navigate('DepartmentVariance', { venueId, departmentId })}
        />
        <Card
          title="Count Activity"
          subtitle="Recent item counts with timestamps"
          onPress={() => !disabled && nav.navigate('CountActivity', { venueId, departmentId })}
        />

        {disabled ? (
          <View style={{ marginTop: 4, padding: 12, borderRadius: 10, backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1 }}>
            <Text style={{ color: '#92400E', fontWeight: '700' }}>
              Missing venue/department context. Open Reports from an Area to auto-fill context.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Explainer modal (local only) */}
      <Modal visible={showInfo} animationType="fade" transparent onRequestClose={()=>setShowInfo(false)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center' }}>
          <View style={{ width:'86%', borderRadius:16, backgroundColor:'#FFFFFF', padding:16 }}>
            <Text style={{ fontSize: isCompact ? 16 : 18, fontWeight:'900', marginBottom: 6 }}>About Operational Reports</Text>
            <Text style={{ color:'#374151', marginBottom:10 }}>
              • <Text style={{ fontWeight:'700' }}>Department Variance</Text> shows Expected vs Counted totals per area. Use “Non-zero variance” and export just the changes.
            </Text>
            <Text style={{ color:'#374151', marginBottom:10 }}>
              • <Text style={{ fontWeight:'700' }}>Count Activity</Text> lists recent item counts with timestamps. Filter to “This cycle only” or “Flagged only”, then export.
            </Text>
            <Text style={{ color:'#6B7280' }}>Tip: the density toggle (More → Density) applies here too for tighter spacing.</Text>
            <View style={{ flexDirection:'row', justifyContent:'flex-end', marginTop:12 }}>
              <TouchableOpacity onPress={()=>setShowInfo(false)} style={{ paddingVertical:8, paddingHorizontal:12, borderRadius:10, backgroundColor:'#F3F4F6' }}>
                <Text style={{ fontWeight:'700' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default withErrorBoundary(ReportsIndexScreen, 'Reports Index');
