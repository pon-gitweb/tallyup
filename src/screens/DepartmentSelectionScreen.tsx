import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { seedVenueDefaults } from 'src/services/seed';
import { setLastLocation } from 'src/services/activeTake';
import {
  ensureDeptSessionActive,
  setDeptLastArea,
  completeDeptSession,
} from 'src/services/activeDeptTake';
import { startNewDepartmentCycle } from 'src/services/cycles';

type RouteParams = { venueId: string };

type Dept = {
  id: string;
  name: string;
  completedAt?: any;
  active?: boolean; // optional; if false, hide from venue flow
};

export default function DepartmentSelectionScreen() {
  const nav = useNavigation();
  const { venueId } = (useRoute().params || {}) as RouteParams;

  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [departments, setDepartments] = React.useState<Dept[]>([]);

  React.useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(
      collection(db, `venues/${venueId}/departments`),
      (snap) => {
        const next: Dept[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          next.push({
            id: d.id,
            name: data?.name || d.id,
            completedAt: data?.completedAt || null,
            active: typeof data?.active === 'boolean' ? data.active : true,
          });
        });
        setDepartments(next);
        setLoading(false);
      },
      (err) => {
        console.warn('[DepartmentSelection] load error', err);
        Alert.alert('Load error', 'Could not load departments for this venue.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [venueId]);

  const onSeed = async () => {
    try {
      setLoading(true);
      await seedVenueDefaults(venueId);
    } catch (e: any) {
      Alert.alert('Seed failed', e?.message ?? 'Could not seed defaults.');
    } finally {
      setLoading(false);
    }
  };

  const goAreas = async (departmentId: string) => {
    try {
      await ensureDeptSessionActive(venueId, departmentId);
      await setDeptLastArea(venueId, departmentId, null);
      // Global resume points to hub with known department
      await setLastLocation(venueId, { lastDepartmentId: departmentId, lastAreaId: null });
    } catch {}
    nav.navigate('AreaSelection' as never, { venueId, departmentId } as never);
  };

  /** Strict finalize PER DEPARTMENT: requires all areas complete (handled elsewhere). */
  const onCompleteDepartment = async (departmentId: string, departmentName: string) => {
    try {
      setBusy(true);
      // This action expects the areas are already all complete. If not, the screen that calls
      // this should have prevented it; but we can leave a guard here for safety later if needed.
      await completeDeptSession(venueId, departmentId);
      Alert.alert('Department completed', `${departmentName} stock take is complete.`);
    } catch (e: any) {
      console.warn('[DepartmentSelection] complete error', e);
      Alert.alert('Action failed', e?.message ?? 'Could not complete the stock take.');
    } finally {
      setBusy(false);
    }
  };

  /** Start a new cycle for a completed department (does not delete past counts). */
  const onStartNewCycle = async (departmentId: string, departmentName: string) => {
    try {
      setBusy(true);
      await startNewDepartmentCycle(venueId, departmentId);
      Alert.alert('New stock take started', `${departmentName} is ready for a fresh count.`);
      // Land on the Areas screen for that department
      await setLastLocation(venueId, { lastDepartmentId: departmentId, lastAreaId: null });
      nav.navigate('AreaSelection' as never, { venueId, departmentId } as never);
    } catch (e: any) {
      console.warn('[DepartmentSelection] new cycle error', e);
      Alert.alert('Start failed', e?.message ?? 'Could not start a new stock take.');
    } finally {
      setBusy(false);
    }
  };

  if (!venueId) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <Text>Missing venue. Please go back and try again.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading departments…</Text>
      </View>
    );
  }

  if (departments.length === 0) {
    return (
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ marginBottom: 12 }}>No departments found for this venue.</Text>
        <TouchableOpacity
          onPress={onSeed}
          style={{ backgroundColor: '#2ecc71', padding: 14, borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>
            Seed Default Departments/Areas/Items
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const visibleDepts = departments.filter((d) => d.active !== false);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        {visibleDepts.map((item) => {
          const isComplete = !!item.completedAt;
          return (
            <View
              key={item.id}
              style={{
                padding: 14,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: isComplete ? '#55efc4' : '#ddd',
                marginBottom: 12,
                backgroundColor: isComplete ? '#eafff6' : '#fff',
              }}
            >
              <TouchableOpacity onPress={() => goAreas(item.id)} disabled={busy}>
                <Text style={{ fontWeight: '700' }}>{item.name}</Text>
                <Text style={{ color: '#555', marginTop: 4 }}>{item.id}</Text>
                {isComplete && (
                  <Text style={{ color: '#00b894', marginTop: 6, fontSize: 12 }}>
                    Department complete
                  </Text>
                )}
              </TouchableOpacity>

              {!isComplete && (
                <TouchableOpacity
                  onPress={() => onCompleteDepartment(item.id, item.name)}
                  disabled={busy}
                  style={{
                    marginTop: 10,
                    alignSelf: 'flex-start',
                    backgroundColor: '#2d3436',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                    Complete {item.name}
                  </Text>
                </TouchableOpacity>
              )}

              {isComplete && (
                <TouchableOpacity
                  onPress={() => onStartNewCycle(item.id, item.name)}
                  disabled={busy}
                  style={{
                    marginTop: 10,
                    alignSelf: 'flex-start',
                    backgroundColor: '#0984e3',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                    Start New Stock Take
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
