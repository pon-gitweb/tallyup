// @ts-nocheck
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator,
  Modal, Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';

import { db } from '../../services/firebase';
import {
  collection, onSnapshot, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

import { useVenueId } from '../../context/VenueProvider';
import IdentityBadge from '../../components/IdentityBadge';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import OfflineBanner from '../../components/OfflineBanner';
import { useNetworkState } from '../../hooks/useNetworkState';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { useDebouncedValue } from '../../utils/useDebouncedValue';
import { seedDefaultDepartmentsAndAreas } from '../../services/onboarding/defaultDepartments';
import { resetDepartment } from '../../services/reset';
import AsyncStorage from '@react-native-async-storage/async-storage';

type DeptRow = {
  id: string;
  name: string;
  order?: number;
  startedAt?: any;
  completedAt?: any;
  status?: 'idle' | 'inprog' | 'done';
  areasTotal?: number;
  areasCompleted?: number;
  totalCyclesCompleted?: number;
  lastCycleAt?: any;
  itemsTotal?: number;
  itemsCounted?: number;
};

function fmtRelative(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

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
        let areasTotal = 0;
        let areasCompleted = 0;
        let itemsTotal = 0;
        let itemsCounted = 0;

        for (const areaDoc of snap.docs) {
          const a: any = areaDoc.data();
          const started = !!a.startedAt;
          const completed = !!a.completedAt;
          areasTotal++;
          if (started) anyStarted = true;
          if (!completed) allCompleted = false;
          if (completed) areasCompleted++;
          try {
            const itemsSnap = await getDocs(
              collection(db, 'venues', venueId, 'departments', row.id, 'areas', areaDoc.id, 'items')
            );
            itemsTotal += itemsSnap.size;
            itemsSnap.forEach(itemDoc => {
              const item = itemDoc.data() as any;
              if (item.lastCount != null) itemsCounted++;
            });
          } catch {}
        }

        let derived: 'idle' | 'inprog' | 'done' = 'idle';
        if (allCompleted) derived = 'done';
        else if (anyStarted) derived = 'inprog';

        return { ...row, status: derived, areasTotal, areasCompleted, itemsTotal, itemsCounted };
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
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const styles = makeStyles(colours);

  const { isOnline } = useNetworkState();
  const [loading, setLoading] = useState(true);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 150);
  const [stocktakeIntroSeen, setStocktakeIntroSeen] = useState(true);

  // Stocktake intro (shown once on first visit)
  useEffect(() => {
    AsyncStorage.getItem('tallyup_intro_stocktake_v1').then(v => {
      if (v === null) setStocktakeIntroSeen(false);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) { setLoadingTimeout(false); return; }
    const t = setTimeout(() => setLoadingTimeout(true), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  // Role gate
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    const uid = getAuth().currentUser?.uid;
    if (!venueId || !uid) return;
    (async () => {
      try {
        const { getDoc: gd } = await import('firebase/firestore');
        const venueSnap = await gd(doc(db, 'venues', venueId));
        const ownerUid = (venueSnap.data() as any)?.ownerUid;
        if (ownerUid === uid) { setIsManager(true); return; }
        const memberSnap = await gd(doc(db, 'venues', venueId, 'members', uid));
        const role = (memberSnap.data() as any)?.role;
        setIsManager(role === 'manager' || role === 'owner');
      } catch {}
    })();
  }, [venueId]);

  // CRUD modal state
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  function openCreate() { setEditId(null); setEditName(''); setShowEdit(true); }
  function openRename(d: DeptRow) { setEditId(d.id); setEditName(d.name || ''); setShowEdit(true); }

  async function onSave() {
    const name = editName.trim();
    if (!name) { showInfo('Enter a department name.'); return; }
    setSaving(true);
    try {
      if (editId) {
        await updateDoc(doc(db, 'venues', venueId, 'departments', editId), { name, updatedAt: serverTimestamp() });
      } else {
        const now = serverTimestamp();
        await addDoc(collection(db, 'venues', venueId, 'departments'), { name, createdAt: now, updatedAt: now });
      }
      setShowEdit(false);
      showSuccess(editId ? '✓ Department renamed.' : '✓ Department added.');
    } catch (e: any) {
      showError(e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  function onDelete(d: DeptRow) {
    confirm({
      title: `Delete ${d.name}?`,
      message: 'This will remove all areas inside it.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'venues', venueId, 'departments', d.id));
          showSuccess('✓ Department deleted.');
        } catch (e: any) {
          showError(e?.message ?? 'Unknown error');
        }
      },
    });
  }

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
        showError(e?.message || 'Could not load departments — permission or connectivity issue.');
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
      confirm({
        title: 'Reset department?',
        message: `This will clear progress for all areas in "${dept.name || dept.id}". Counts stay attached to the last completed stock take.`,
        confirmLabel: 'Reset',
        destructive: true,
        onConfirm: async () => {
          try {
            await resetDepartment(venueId, dept.id);
            // Force immediate UI refresh — onSnapshot won't fire when only area subdocs change
            const snap = await getDocs(collection(db, 'venues', venueId, 'departments'));
            const rows: DeptRow[] = [];
            snap.forEach(d => rows.push({ id: d.id, ...(d.data() as any) }));
            const enriched = await enrichDepartmentsWithAreaStatus(venueId, rows);
            setDepartments(enriched);
            showSuccess('✓ Department reset.');
          } catch (e: any) {
            showError(e?.message || 'Unknown error');
          }
        },
      });
    },
    [venueId, confirm, showSuccess, showError],
  );

  const renderDept = ({ item }: { item: DeptRow }) => {
    const status: 'idle' | 'inprog' | 'done' =
      item.status ?? (item.completedAt ? 'done' : item.startedAt ? 'inprog' : 'idle');

    const lastCycleMs = item.lastCycleAt?.toMillis?.()
      ?? item.lastCycleAt?.toDate?.()?.getTime?.()
      ?? null;

    const leftBorderColor =
      status === 'done' ? colours.success :
      status === 'inprog' ? colours.stellarAmber : colours.border;

    const statusSubtext =
      status === 'done'
        ? `✓ Cycle ${item.totalCyclesCompleted ?? 1} complete · ${fmtRelative(lastCycleMs)}`
        : status === 'inprog'
        ? `${item.areasCompleted ?? 0} of ${item.areasTotal ?? '?'} areas counted · In progress`
        : lastCycleMs
        ? `Last counted ${fmtRelative(lastCycleMs)} · Cycle ${item.totalCyclesCompleted ?? 0}`
        : 'Not started';

    const statusTextColor =
      status === 'done' ? colours.success :
      status === 'inprog' ? colours.stellarAmber : colours.textSecondary;

    return (
      <View style={[styles.row, { borderLeftWidth: 4, borderLeftColor: leftBorderColor, flexDirection: 'column', alignItems: 'stretch', paddingRight: 8 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            style={{ flex: 1, paddingRight: 8 }}
            onPress={() => openDepartment(item)}
            onLongPress={() => isManager ? openRename(item) : resetDept(item)}
            delayLongPress={500}
            activeOpacity={0.9}
          >
            <Text style={styles.rowTitle}>{item.name || item.id}</Text>
            <Text style={{ fontSize: 12, color: statusTextColor, marginTop: 4 }}>
              {statusSubtext}
            </Text>
            {(item.itemsTotal ?? 0) > 0 && (
              <Text style={{ fontSize: 11, color: colours.textSecondary, marginTop: 2 }}>
                {item.itemsCounted ?? 0} of {item.itemsTotal} items counted this cycle
              </Text>
            )}
          </TouchableOpacity>
          {isManager && (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => openRename(item)}
                style={{ padding: 8 }}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <MaterialIcons name="edit" size={18} color={colours.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onDelete(item)}
                style={{ padding: 8 }}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <MaterialIcons name="delete-outline" size={18} color={colours.error} />
              </TouchableOpacity>
            </View>
          )}
          <MaterialIcons name="chevron-right" size={20} color={colours.textSecondary} />
        </View>
        {status === 'done' && (
          <TouchableOpacity
            onPress={() => resetDept(item)}
            style={{
              marginTop: 10, alignSelf: 'flex-start',
              backgroundColor: colours.positiveSoft, paddingHorizontal: 12, paddingVertical: 6,
              borderRadius: 8, borderWidth: 1, borderColor: colours.success + '40',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: colours.success }}>
              Start next {item.name || 'department'} stocktake →
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (venueMissing) {
    return (
      <View style={styles.wrap}>
        {modal}
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
      {modal}
      <OfflineBanner />
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Departments</Text>
          <Text style={styles.sub}>Choose a department to start counting</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isManager && (
            <TouchableOpacity
              onPress={openCreate}
              style={{ backgroundColor: colours.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 }}
            >
              <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 13 }}>+ Add</Text>
            </TouchableOpacity>
          )}
          <IdentityBadge />
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search departments"
          placeholderTextColor={colours.slateMid}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          blurOnSubmit={false}
        />
      </View>

      {/* List */}
      {loading ? (
        loadingTimeout && !isOnline ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <Text style={{ color: colours.stellarAmber, textAlign: 'center', fontWeight: '700' }}>
              📵 No connection — showing cached data
            </Text>
          </View>
        ) : (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={colours.primary} />
            <Text style={{ marginTop: 8, color: colours.textSecondary }}>
              Loading departments…
            </Text>
          </View>
        )
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(x) => x.id}
          renderItem={renderDept}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListHeaderComponent={
            !stocktakeIntroSeen && departments.length > 0 && departments.every(d => d.status !== 'done') ? (
              <View style={{ backgroundColor: colours.oat, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: colours.deepBlue }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: colours.navy, marginBottom: 8 }}>👋 Welcome to stocktaking</Text>
                <Text style={{ fontSize: 14, color: colours.text, lineHeight: 20, marginBottom: 8 }}>
                  A stocktake is a count of everything you have in your venue right now.
                </Text>
                <Text style={{ fontSize: 13, color: colours.slateMid, lineHeight: 19, marginBottom: 12 }}>
                  {'Count your stock regularly to:\n✓ Know exactly what you have\n✓ Spot missing or wasted stock\n✓ Make smarter ordering decisions\n\nYour departments are ready. Tap one to start.'}
                </Text>
                <TouchableOpacity
                  style={{ backgroundColor: colours.deepBlue, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, alignSelf: 'flex-start' }}
                  onPress={() => {
                    setStocktakeIntroSeen(true);
                    AsyncStorage.setItem('tallyup_intro_stocktake_v1', '1').catch(() => {});
                  }}
                >
                  <Text style={{ color: colours.surface, fontWeight: '700', fontSize: 14 }}>Got it — let's go</Text>
                </TouchableOpacity>
              </View>
            ) : null
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

      {/* Add / Rename modal */}
      <Modal visible={showEdit} transparent animationType="fade" onRequestClose={() => setShowEdit(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={() => setShowEdit(false)}>
          <Pressable style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 20, width: '100%', gap: 12 }} onPress={() => {}}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colours.navy }}>
              {editId ? 'Rename department' : 'New department'}
            </Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Department name"
              placeholderTextColor={colours.slateMid}
              autoFocus
              style={{ borderWidth: 1, borderColor: colours.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colours.navy }}
              returnKeyType="done"
              onSubmitEditing={onSave}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colours.oat, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }} onPress={() => setShowEdit(false)}>
                <Text style={{ fontWeight: '700', color: colours.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colours.deepBlue, borderRadius: 10, paddingVertical: 12, alignItems: 'center', opacity: saving ? 0.6 : 1 }} onPress={onSave} disabled={saving}>
                <Text style={{ fontWeight: '700', color: colours.surface }}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
    pillDone: { backgroundColor: c.positiveSoft, color: c.success },
    pillInProg: { backgroundColor: c.primaryLight, color: c.primary },
    pillIdle: { backgroundColor: c.negativeSoft, color: c.error },
  });
}

export default withErrorBoundary(DepartmentSelectionScreen, 'Departments');
