// @ts-nocheck
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';

import { db } from '../../services/firebase';
import {
  collection,
  onSnapshot,
  getDocs,
} from 'firebase/firestore';

import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useColours } from '../../context/ThemeContext';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { seedDefaultDepartmentsAndAreas } from '../../services/onboarding/defaultDepartments';
import { resetDepartment } from '../../services/reset';

type DeptRow = {
  id: string;
  name: string;
  order?: number;
  startedAt?: any;
  completedAt?: any;
  status?: 'idle' | 'inprog' | 'done';
};

// Derive department-level status from its areas
async function enrichDepartmentsWithAreaStatus(
  venueId: string,
  rows: DeptRow[],
): Promise<DeptRow[]> {
  if (!venueId || rows.length === 0) return rows;

  const enriched = await Promise.all(
    rows.map(async (row) => {
      try {
        const areasCol = collection(
          db,
          'venues',
          venueId,
          'departments',
          row.id,
          'areas',
        );
        const snap = await getDocs(areasCol);
        if (snap.empty) {
          // No areas yet – fall back to whatever is on the dept doc
          let existingStatus: 'idle' | 'inprog' | 'done' = 'idle';
          if (row.completedAt) existingStatus = 'done';
          else if (row.startedAt) existingStatus = 'inprog';
          return { ...row, status: existingStatus };
        }

        let anyStarted = false;
        let allCompleted = true;

        snap.forEach((d) => {
          const a: any = d.data();
          const started = !!a.startedAt;
          const completed = !!a.completedAt;

          if (started) anyStarted = true;
          if (!completed) allCompleted = false;
        });

        let derived: 'idle' | 'inprog' | 'done' = 'idle';
        if (allCompleted) derived = 'done';
        else if (anyStarted) derived = 'inprog';

        return { ...row, status: derived };
      } catch (e: any) {
        if (__DEV__) {
          console.log(
            '[Departments] enrich status failed',
            row.id,
            e?.message || String(e),
          );
        }
        // On error, don’t blow up UI – just return original row
        return row;
      }
    }),
  );

  return enriched;
}

function DepartmentSelectionScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const colours = useColours();
  const styles = makeStyles(colours);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 150);

  // Ensure we only try to seed once per mount to avoid loops
  const seedTriedRef = useRef(false);

  // If venueId is missing, show a soft error
  const venueMissing = !venueId;

  useEffect(() => {
    if (!venueId) {
      setLoading(false);
      setDepartments([]);
      return;
    }

    setLoading(true);
    const colRef = collection(db, 'venues', venueId, 'departments');

    const unsub = onSnapshot(
      colRef,
      (snap) => {
        (async () => {
          // No departments yet → try to seed defaults once
          if (snap.empty) {
            setDepartments([]);
            setLoading(false);

            if (!seedTriedRef.current) {
              seedTriedRef.current = true;
              try {
                const result = await seedDefaultDepartmentsAndAreas(venueId);
                if (__DEV__) {
                  console.log(
                    '[Departments] seeded default departments/areas',
                    { venueId, result },
                  );
                }
              } catch (e: any) {
                if (__DEV__) {
                  console.log(
                    '[Departments] seedDefaultDepartmentsAndAreas failed',
                    e?.code,
                    e?.message || String(e),
                  );
                }
                // Don’t block the user; they can still add departments manually later.
              }
            }

            return;
          }

          const rows: DeptRow[] = [];
          snap.forEach((d) => {
            rows.push({
              id: d.id,
              ...(d.data() as any),
            });
          });

          // Robust sort: honour numeric `order` when present, then name/id.
          rows.sort((a, b) => {
            const ao =
              typeof a.order === 'number'
                ? a.order
                : Number.MAX_SAFE_INTEGER;
            const bo =
              typeof b.order === 'number'
                ? b.order
                : Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;

            const an = (a.name || a.id || '').toLowerCase();
            const bn = (b.name || b.id || '').toLowerCase();
            return an.localeCompare(bn);
          });

          // Derive status from areas
          const withStatus = await enrichDepartmentsWithAreaStatus(
            venueId,
            rows,
          );

          setDepartments(withStatus);
          setLoading(false);
        })().catch((e: any) => {
          if (__DEV__) {
            console.log(
              '[Departments] snapshot handler failed',
              e?.message || String(e),
            );
          }
          setDepartments([]);
          setLoading(false);
        });
      },
      (e: any) => {
        if (__DEV__) {
          console.log(
            '[Departments] listener error',
            e?.code,
            e?.message || e,
          );
        }
        setDepartments([]);
        setLoading(false);
        Alert.alert(
          'Could not load departments',
          e?.message || 'Permission or connectivity issue',
        );
      },
    );

    return () => unsub();
  }, [venueId]);

  const onRefresh = useCallback(() => {
    // Realtime listener keeps things fresh; we just show the spinner briefly.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 300);
  }, []);

  const filtered = useMemo(() => {
    const term = dq.trim().toLowerCase();
    if (!term) return departments;
    return departments.filter((d) =>
      (d.name || d.id).toLowerCase().includes(term),
    );
  }, [departments, dq]);

  const openDepartment = useCallback(
    (dept: DeptRow) => {
      if (!venueId) return;
      // IMPORTANT: this must match the actual route name in your navigator ("Areas")
      nav.navigate('Areas', {
        venueId,
        departmentId: dept.id,
        departmentName: dept.name,
      });
    },
    [nav, venueId],
  );

  const resetDept = useCallback(
    (dept: DeptRow) => {
      if (!venueId) return;
      Alert.alert(
        'Reset department?',
        `This will clear progress for all areas in “${dept.name || dept.id}”. Counts stay attached to the last completed stock take.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: async () => {
              try {
                await resetDepartment(venueId, dept.id);
              } catch (e: any) {
                Alert.alert(
                  'Reset failed',
                  e?.message || 'Unknown error',
                );
              }
            },
          },
        ],
      );
    },
    [venueId],
  );

  const renderDept = ({ item }: { item: DeptRow }) => {
    const status: 'idle' | 'inprog' | 'done' =
      item.status ??
      (item.completedAt ? 'done' : item.startedAt ? 'inprog' : 'idle');

    const statusLabel =
      status === 'done'
        ? 'Completed'
        : status === 'inprog'
        ? 'In progress'
        : 'Not started';

    const pillStyle =
      status === 'done'
        ? styles.pillDone
        : status === 'inprog'
        ? styles.pillInProg
        : styles.pillIdle;

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => openDepartment(item)}
        onLongPress={() => resetDept(item)}
        delayLongPress={500}
        activeOpacity={0.9}
      >
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.rowTitle}>{item.name || item.id}</Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 4,
            }}
          >
            <Text style={[styles.pill, pillStyle]}>{statusLabel}</Text>
          </View>
        </View>
        <MaterialIcons name="chevron-right" size={20} color={colours.textSecondary} />
      </TouchableOpacity>
    );
  };

  if (venueMissing) {
    return (
      <View style={styles.wrap}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Departments</Text>
            <Text style={styles.sub}>
              We couldn&apos;t find a current venue. Please go back and reopen.
            </Text>
          </View>
          <IdentityBadge />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Departments</Text>
          <Text style={styles.sub}>Choose a department to start counting</Text>
        </View>
        <IdentityBadge />
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search departments"
          placeholderTextColor="#94A3B8"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          blurOnSubmit={false}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <ActivityIndicator color={colours.primary} />
          <Text style={{ marginTop: 8, color: colours.textSecondary }}>
            Loading departments…
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(x) => x.id}
          renderItem={renderDept}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 20, alignItems: 'center' }}>
              <Text style={{ color: colours.textSecondary, textAlign: 'center' }}>
                No departments found yet.{'\n'}
                We&apos;ll create defaults (Bar, Kitchen, etc.) automatically
                for new venues.
              </Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColours>) {
  return StyleSheet.create({
    wrap: { flex: 1, backgroundColor: c.background, padding: 16 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    title: { fontSize: 22, fontWeight: '800', color: c.text },
    sub: { color: c.textSecondary, marginTop: 2 },

    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    searchInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: c.surface,
      color: c.text,
    },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 10,
      backgroundColor: c.surface,
    },
    rowTitle: { fontSize: 16, fontWeight: '700', color: c.text },

    pill: {
      fontWeight: '700',
      fontSize: 12,
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 999,
    },
    pillDone: { backgroundColor: '#def7ec', color: '#03543f' },
    pillInProg: { backgroundColor: c.primaryLight, color: c.primary },
    pillIdle: { backgroundColor: '#fdf2f8', color: '#9b1c1c' },
  });
}

export default withErrorBoundary(DepartmentSelectionScreen, 'Departments');
