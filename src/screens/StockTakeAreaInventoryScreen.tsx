import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { areaDoc, areaItemsCol, areaItemDoc } from '../services/paths';

type Params = {
  venueId: string;
  sessionId: string;
  departmentId: string;
  areaName: string;
};

type ItemRow = {
  id: string;
  name: string;               // UI name; may be derived from ID when rules disallow 'name' write
  expectedQuantity?: number;
  unit?: string;
};

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const { params } = useRoute<any>();
  const { venueId, sessionId, departmentId, areaName } = params as Params;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [allItems, setAllItems] = useState<ItemRow[]>([]);
  const [query, setQuery] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [areaStarted, setAreaStarted] = useState<boolean>(false);
  const [areaCompleted, setAreaCompleted] = useState<boolean>(false);
  const unsubRef = useRef<ReturnType<typeof onSnapshot> | null>(null);

  const readOnly = areaCompleted;

  useEffect(() => {
    const aRef = areaDoc(venueId, departmentId, areaName);
    (async () => {
      setLoading(true);
      try {
        const aSnap = await getDoc(aRef);
        const aData = aSnap.exists() ? (aSnap.data() as any) : {};
        const started = !!aData?.startedAt;
        const completed = !!aData?.completedAt;
        setAreaStarted(started);
        setAreaCompleted(completed);

        if (!completed && !started) {
          await setDoc(aRef, { startedAt: serverTimestamp() }, { merge: true });
          setAreaStarted(true);
          console.log('[TallyUp Inventory] startedAt set', { venueId, departmentId, areaName });
        }

        const itemsSnap = await getDocs(areaItemsCol(venueId, departmentId, areaName));
        const items: ItemRow[] = itemsSnap.docs.map(d => {
          const data = d.data() as any;
          // We may not have a 'name' field (rules). Use ID as fallback and reveal expected/unit if present.
          const uiName = data?.name ?? d.id;
          return {
            id: d.id,
            name: uiName,
            expectedQuantity: data?.expectedQuantity,
            unit: data?.unit,
          };
        });
        setAllItems(items);
      } catch (e: any) {
        Alert.alert('Load error', e?.message ?? 'Unknown error');
      } finally {
        setLoading(false);
      }
    })();

    const unsub = onSnapshot(aRef, (snap) => {
      const d = snap.exists() ? (snap.data() as any) : {};
      setAreaStarted(!!d?.startedAt);
      setAreaCompleted(!!d?.completedAt);
    });
    unsubRef.current = unsub;
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [venueId, departmentId, areaName]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(i => (i.name ?? '').toLowerCase().includes(q));
  }, [query, allItems]);

  const onChangeCount = (id: string, v: string) => setCounts((p) => ({ ...p, [id]: v }));

  const onSubmit = async () => {
    if (readOnly) {
      Alert.alert('Read-only', 'This area is complete and cannot be edited.');
      return;
    }
    if (submitting) return;

    const unfilled = filtered.filter(i => counts[i.id] === undefined || counts[i.id] === '');
    if (unfilled.length > 0) {
      Alert.alert(
        'Uncounted items',
        `You have ${unfilled.length} uncounted items.`,
        [
          { text: 'Go Back', style: 'cancel' },
          { text: 'Skip & Fill Zeros', style: 'destructive', onPress: () => void doCommit(true) }
        ]
      );
      return;
    }
    await doCommit(false);
  };

  const doCommit = async (fillZeros: boolean) => {
    try {
      setSubmitting(true);

      const aRef = areaDoc(venueId, departmentId, areaName);
      const latest = await getDoc(aRef);
      if (latest.exists() && !!(latest.data() as any)?.completedAt) {
        Alert.alert('Already complete', 'This area has already been completed.');
        setSubmitting(false);
        return;
      }

      const batch = writeBatchCompat();

      // PER RULES: only lastCount + lastCountAt on items
      filtered.forEach(i => {
        const raw = counts[i.id] ?? (fillZeros ? '0' : '0');
        const qty = Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : 0;
        batch.set(
          areaItemDoc(venueId, departmentId, areaName, i.id),
          { lastCount: qty, lastCountAt: serverTimestamp() },
          { merge: true }
        );
      });

      // Only set completedAt if not set yet
      batch.set(aRef, { completedAt: serverTimestamp() }, { merge: true });

      console.log('[TallyUp Inventory] commit', {
        venueId, departmentId, areaName, items: filtered.length, fields: ['lastCount','lastCountAt','completedAt']
      });

      await batch.commit();
      setAreaCompleted(true);
      nav.goBack();
    } catch (e: any) {
      console.log('[TallyUp Inventory] commit error', e);
      Alert.alert('Submit error', e?.message ?? 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  function writeBatchCompat() {
    const { writeBatch } = require('firebase/firestore');
    const { db } = require('../services/firebase');
    return writeBatch(db);
  }

  // ---------- MVP #7: Search Across Venue (stub) + Quick Add ----------
  const slugify = (s: string) =>
    s.toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'item';

  const onSearchAcrossVenue = () => {
    Alert.alert(
      'Search across venue',
      'This is a stub in the MVP. In the full release, you’ll be able to search all departments and add items directly from the venue catalogue.'
    );
  };

  const onQuickAdd = async () => {
    if (readOnly) {
      Alert.alert('Read-only', 'This department is complete. Start a new cycle to add items.');
      return;
    }
    const q = query.trim();
    if (!q) {
      Alert.alert('Nothing to add', 'Type a name first, then tap Quick add.');
      return;
    }
    const newId = slugify(q);
    try {
      // Rules let us write ONLY lastCount/lastCountAt to create a placeholder item.
      await setDoc(
        areaItemDoc(venueId, departmentId, areaName, newId),
        { lastCount: 0, lastCountAt: serverTimestamp() },
        { merge: true }
      );
      // Update UI locally with the user-friendly name (not persisted due to rules).
      setAllItems(prev => {
        if (prev.some(p => p.id === newId)) return prev;
        return [{ id: newId, name: q }, ...prev];
      });
      setCounts(prev => ({ ...prev, [newId]: '' }));
      setQuery('');
      Alert.alert('Added', `Placeholder item “${q}” added to this area.`);
      console.log('[TallyUp QuickAdd] placeholder created', { venueId, departmentId, areaName, id: newId });
    } catch (e: any) {
      Alert.alert('Quick add failed', e?.message ?? 'Unknown error');
    }
  };
  // -------------------------------------------------------------------

  const renderRow = ({ item }: { item: ItemRow }) => {
    const placeholder = item.expectedQuantity != null
      ? `Expected: ${item.expectedQuantity}${item.unit ? ' ' + item.unit : ''}`
      : 'Enter count';
    return (
      <View style={S.row}>
        <Text style={S.name}>{item.name}</Text>
        <TextInput
          style={[S.input, readOnly && S.inputDisabled]}
          placeholder={placeholder}
          keyboardType="numeric"
          editable={!readOnly}
          value={counts[item.id] ?? ''}
          onChangeText={(v) => onChangeCount(item.id, v)}
        />
      </View>
    );
  };

  if (loading) return <View style={S.center}><ActivityIndicator /></View>;

  const noMatches = filtered.length === 0 && query.trim().length > 0;

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={S.chipRow}>
        <Text style={[S.chip, areaCompleted ? S.chipComplete : areaStarted ? S.chipInProgress : S.chipIdle]}>
          {areaCompleted ? 'Complete' : areaStarted ? 'In Progress' : 'Not started'}
        </Text>
      </Text>

      <TextInput
        style={S.search}
        placeholder="Search items in this area…"
        value={query}
        onChangeText={setQuery}
        editable={!readOnly}
      />

      {noMatches ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ marginBottom: 8 }}>No matches in this area.</Text>
          <TouchableOpacity style={[S.actionBtn, readOnly && S.disabled]} onPress={onSearchAcrossVenue} disabled={readOnly}>
            <Text style={S.actionText}>Search across venue (stub)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.actionBtn, readOnly && S.disabled]} onPress={onQuickAdd} disabled={readOnly}>
            <Text style={S.actionText}>Quick add “{query.trim()}” to this area</Text>
          </TouchableOpacity>
          {readOnly && <Text style={{ color: '#666', marginTop: 6 }}>Area is complete — start a new cycle to add items.</Text>}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}

      {!readOnly && filtered.length > 0 && (
        <TouchableOpacity style={[S.submitBtn, submitting && { opacity: 0.6 }]} onPress={onSubmit} disabled={submitting}>
          <Text style={S.submitText}>{submitting ? 'Submitting…' : 'Submit Area'}</Text>
        </TouchableOpacity>
      )}
      {readOnly && (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#444' }}>This area is complete (read‑only).</Text>
        </View>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chipRow: { marginBottom: 8 },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden', color: '#111' },
  chipIdle: { backgroundColor: '#E5E7EB' },
  chipInProgress: { backgroundColor: '#FFE8C2' },
  chipComplete: { backgroundColor: '#D9FBE4' },
  search: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 12 },
  actionBtn: { backgroundColor: '#F3F4F6', padding: 12, borderRadius: 10, marginTop: 8, alignItems: 'center' },
  actionText: { color: '#111', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  row: { paddingVertical: 10, borderBottomColor: '#eee', borderBottomWidth: 1 },
  name: { fontSize: 16, marginBottom: 6, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10 },
  inputDisabled: { backgroundColor: '#f5f5f5' },
  submitBtn: { backgroundColor: '#0A84FF', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  submitText: { color: '#fff', fontWeight: '700' },
});
