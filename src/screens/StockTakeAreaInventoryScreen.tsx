import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { setLastLocation } from 'src/services/activeTake';
import { setDeptLastArea } from 'src/services/activeDeptTake';

type RouteParams = { venueId: string; departmentId: string; areaId: string };

type Item = {
  id: string;
  name: string;
  expectedQuantity?: number;
  unit?: string;
};

export default function StockTakeAreaInventoryScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { venueId, departmentId, areaId } = route.params as RouteParams;

  const [loading, setLoading] = useState(true);
  const [areaReadonly, setAreaReadonly] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const listRef = useRef<FlatList>(null);

  const itemsPath = (v: string, d: string, a: string) =>
    `venues/${v}/departments/${d}/areas/${a}/items`;
  const areaDocPath = (v: string, d: string, a: string) =>
    `venues/${v}/departments/${d}/areas/${a}`;
  const areasPath = (v: string, d: string) =>
    `venues/${v}/departments/${d}/areas`;

  // Check area readonly (completed)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const a = await getDoc(doc(db, areaDocPath(venueId, departmentId, areaId)));
        if (!alive) return;
        const d = a.data() as any;
        setAreaReadonly(!!d?.completedAt);
      } catch (e) {
        setAreaReadonly(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [venueId, departmentId, areaId]);

  // Load items
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, itemsPath(venueId, departmentId, areaId)),
      (snap) => {
        const next: Item[] = [];
        snap.forEach((d) => {
          const data = (d.data() as any) || {};
          next.push({
            id: d.id,
            name: data.name ?? '(Unnamed item)',
            expectedQuantity: typeof data.expectedQuantity === 'number' ? data.expectedQuantity : undefined,
            unit: data.unit ?? '',
          });
        });
        setItems(next);
        setLoading(false);
      },
      (err) => {
        console.warn('[StockTakeAreaInventory] onSnapshot error', err);
        Alert.alert('Load Error', 'Could not load items for this area. Check your access and try again.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [venueId, departmentId, areaId]);

  const totalItems = items.length;
  const counted = useMemo(
    () => items.filter((i) => counts[i.id] != null && counts[i.id] !== '').length,
    [items, counts]
  );
  const hasPartials = counted > 0 && counted < totalItems;

  const onChangeCount = (itemId: string, val: string) => {
    if (areaReadonly) return; // ignore edits on finalized areas
    const trimmed = (val ?? '').trim();
    const n = trimmed === '' ? '' : String(Number(trimmed));
    if (n === 'NaN') {
      setCounts((prev) => ({ ...prev, [itemId]: '' }));
    } else {
      setCounts((prev) => ({ ...prev, [itemId]: n }));
    }
  };

  const resetToAreas = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 2,
        routes: [
          { name: 'ExistingVenueDashboard' as never },
          { name: 'DepartmentSelection' as never, params: { venueId } as any },
          { name: 'AreaSelection' as never, params: { venueId, departmentId } as any },
        ],
      }) as any
    );
  };

  const commitArea = async () => {
    if (areaReadonly) {
      Alert.alert(
        'Area is finalized',
        'This area was completed in a previous stock take. Start a new stock take for this department from the Departments screen to enter new counts.',
        [{ text: 'OK', onPress: resetToAreas }]
      );
      return;
    }

    if (totalItems > 0 && counted < totalItems) {
      Alert.alert(
        'Incomplete Counts',
        `You have ${totalItems - counted} uncounted item(s). Enter zero for the missing ones or skip to auto-fill zero.`,
        [
          { text: 'Go Back', style: 'cancel' },
          { text: 'Skip & Fill Zeros', style: 'destructive', onPress: () => void doCommit(true) },
        ]
      );
      return;
    }
    await doCommit(false);
  };

  const doCommit = async (fillZerosForMissing: boolean) => {
    try {
      setSaving(true);

      // 1) Save item counts; write zero when requested.
      for (const it of items) {
        const raw = counts[it.id];
        const shouldWrite = raw != null && raw !== '' ? true : fillZerosForMissing;
        if (!shouldWrite) continue;

        const qty = raw != null && raw !== '' ? Number(raw) : 0;
        const itemRef = doc(db, `${itemsPath(venueId, departmentId, areaId)}/${it.id}`);
        await setDoc(itemRef, { lastCount: qty, lastCountAt: serverTimestamp() }, { merge: true });
      }

      // 2) Mark area completed for this cycle
      const areaRef = doc(db, areaDocPath(venueId, departmentId, areaId));
      await setDoc(areaRef, { completedAt: serverTimestamp() }, { merge: true });

      // 3) Update pointers
      await setLastLocation(venueId, { lastDepartmentId: departmentId, lastAreaId: null });
      await setDeptLastArea(venueId, departmentId, null);

      // 4) Done → back to Areas
      Alert.alert('Area Submitted', 'Counts saved. Thanks!', [{ text: 'OK', onPress: resetToAreas }]);
    } catch (e: any) {
      console.warn('[commitArea] error', e);
      Alert.alert('Commit Error', e?.message ?? 'Failed to submit area.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading items…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, paddingBottom: 8 }}
      >
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          renderItem={({ item }) => (
            <View
              style={{
                padding: 12,
                marginBottom: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#ddd',
              }}
            >
              <Text style={{ fontWeight: '600', marginBottom: 8 }}>{item.name}</Text>
              <TextInput
                value={counts[item.id] ?? ''}
                onChangeText={(t) => onChangeCount(item.id, t)}
                editable={!areaReadonly}
                selectTextOnFocus={!areaReadonly}
                keyboardType="numeric"
                placeholder={
                  typeof item.expectedQuantity === 'number'
                    ? `Expected: ${item.expectedQuantity}${item.unit ? ' ' + item.unit : ''}`
                    : 'Enter quantity'
                }
                placeholderTextColor="#9CA3AF"
                style={{
                  borderWidth: 1,
                  borderColor: areaReadonly ? '#eee' : '#ccc',
                  backgroundColor: areaReadonly ? '#f7f7f7' : '#fff',
                  borderRadius: 8,
                  padding: 10,
                }}
              />
            </View>
          )}
          ListFooterComponent={<View style={{ height: 80 }} />}
        />

        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderColor: '#eee',
            backgroundColor: '#fff',
          }}
        >
          <TouchableOpacity
            onPress={commitArea}
            disabled={saving}
            style={{
              padding: 14,
              borderRadius: 10,
              backgroundColor: areaReadonly ? '#b2bec3' : (hasPartials ? '#ff9f43' : '#2ecc71'),
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>
              {areaReadonly
                ? 'Area Finalized (Read-only)'
                : saving
                ? 'Submitting…'
                : hasPartials
                ? 'Submit (Partially Counted)'
                : 'Submit Area'}
            </Text>
          </TouchableOpacity>
          {areaReadonly && (
            <Text style={{ marginTop: 8, textAlign: 'center', color: '#555' }}>
              To enter new counts, go back to Departments and press “Start New Stock Take”.
            </Text>
          )}
          {!areaReadonly && (
            <Text style={{ marginTop: 8, textAlign: 'center', color: '#555' }}>
              Counted {counted} of {totalItems} item(s)
            </Text>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
