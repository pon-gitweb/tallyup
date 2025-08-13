import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, TouchableOpacity, SafeAreaView
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, doc, getDocs, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { path } from 'src/services/firestorePaths';

type RouteParams = {
  venueId: string;
  departmentId: string;
  areaId: string;
};

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
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, path.items(venueId, departmentId, areaId)),
      (snap) => {
        const next: Item[] = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          next.push({
            id: d.id,
            name: data.name ?? '(Unnamed item)',
            expectedQuantity: typeof data.expectedQuantity === 'number' ? data.expectedQuantity : 0,
            unit: data.unit ?? '',
          });
        });
        setItems(next);
        setCounts((prev) => {
          const cloned = { ...prev };
          next.forEach((it) => {
            if (cloned[it.id] == null || cloned[it.id] === '') {
              cloned[it.id] = String(it.expectedQuantity ?? 0);
            }
          });
          return cloned;
        });
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
    () => items.filter(i => counts[i.id] != null && counts[i.id] !== '').length,
    [items, counts]
  );
  const hasPartials = counted > 0 && counted < totalItems;

  const ensureAreaStarted = async () => {
    try {
      const areaRef = doc(db, path.area(venueId, departmentId, areaId));
      await updateDoc(areaRef, { startedAt: serverTimestamp() }, { merge: true } as any);
    } catch (e) {
      console.log('ensureAreaStarted noop', e);
    }
  };

  const onChangeCount = (itemId: string, val: string) => {
    if (!val || Number.isNaN(Number(val))) {
      setCounts(prev => ({ ...prev, [itemId]: '' }));
    } else {
      setCounts(prev => ({ ...prev, [itemId]: val }));
      void ensureAreaStarted();
    }
  };

  const commitArea = async () => {
    if (totalItems > 0 && counted < totalItems) {
      Alert.alert(
        'Incomplete Counts',
        `You have ${totalItems - counted} uncounted item(s). Skip them or go back to finish?`,
        [
          { text: 'Go Back', style: 'cancel' },
          { text: 'Skip Uncounted', style: 'destructive', onPress: () => void doCommit(true) },
        ]
      );
      return;
    }
    await doCommit(false);
  };

  const doCommit = async (skipUncounted: boolean) => {
    try {
      setSaving(true);

      for (const it of items) {
        const raw = counts[it.id];
        if (raw == null || raw === '') {
          if (skipUncounted) continue;
        }
        const qty = Number(raw ?? 0);
        const itemRef = doc(db, path.item(venueId, departmentId, areaId, it.id));
        await setDoc(itemRef, { lastCount: qty, lastCountAt: serverTimestamp() }, { merge: true });
      }

      const areaRef = doc(db, path.area(venueId, departmentId, areaId));
      await updateDoc(areaRef, { completedAt: serverTimestamp() }, { merge: true } as any);

      const areasSnap = await getDocs(collection(db, path.areas(venueId, departmentId)));
      const allDone = areasSnap.docs.every(d => {
        const data = d.data() || {};
        return !!data.completedAt;
      });

      if (allDone) {
        await updateDoc(doc(db, path.department(venueId, departmentId)), {
          completedAt: serverTimestamp(),
        }, { merge: true } as any);
      }

      Alert.alert('Area Submitted', 'Counts saved. Thanks!');
      navigation.goBack();
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
            <View style={{
              padding: 12, marginBottom: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ddd'
            }}>
              <Text style={{ fontWeight: '600', marginBottom: 8 }}>{item.name}</Text>
              <TextInput
                value={counts[item.id] ?? ''}
                onChangeText={(t) => onChangeCount(item.id, t)}
                keyboardType="numeric"
                placeholder="Enter quantity"
                style={{
                  borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10
                }}
              />
              {typeof item.expectedQuantity === 'number' && (
                <Text style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                  Expected: {item.expectedQuantity} {item.unit ?? ''}
                </Text>
              )}
            </View>
          )}
          ListFooterComponent={<View style={{ height: 80 }} />}
        />

        <View style={{
          paddingHorizontal: 16, paddingVertical: 10,
          borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fff'
        }}>
          <TouchableOpacity
            onPress={commitArea}
            disabled={saving}
            style={{
              padding: 14, borderRadius: 10,
              backgroundColor: hasPartials ? '#ff9f43' : '#2ecc71',
              alignItems: 'center'
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>
              {saving ? 'Submitting…' : hasPartials ? 'Submit (Partially Counted)' : 'Submit Area'}
            </Text>
          </TouchableOpacity>
          <Text style={{ marginTop: 8, textAlign: 'center', color: '#555' }}>
            Counted {counted} of {totalItems} item(s)
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
