import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getDoc, onSnapshot, serverTimestamp, setDoc, writeBatch, getDocs, query, orderBy, limit, startAfter, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { areaDoc, areaItemsCol, areaItemDoc } from '../services/paths';
import useDebouncedValue from '../hooks/useDebouncedValue';

type Params = {
  venueId: string;
  sessionId: string;
  departmentId: string;
  areaName: string;
};

type ItemRow = {
  id: string;
  name: string;
  expectedQuantity?: number;
  unit?: string;
};

const PAGE_SIZE = 50;

export default function StockTakeAreaInventoryScreen() {
  const nav = useNavigation<any>();
  const { params } = useRoute<any>();
  const { venueId, sessionId, departmentId, areaName } = params as Params;

  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pageCursor, setPageCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [allItems, setAllItems] = useState<ItemRow[]>([]);
  const [queryText, setQueryText] = useState('');
  const debouncedQuery = useDebouncedValue(queryText, 200);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [areaStarted, setAreaStarted] = useState<boolean>(false);
  const [areaCompleted, setAreaCompleted] = useState<boolean>(false);
  const unsubRef = useRef<ReturnType<typeof onSnapshot> | null>(null);

  const readOnly = areaCompleted;

  // Prime + live area state
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

        // Load first page of items
        await loadFirstPage();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, departmentId, areaName]);

  const loadFirstPage = useCallback(async () => {
    setPaging(true);
    try {
      const baseQ = query(areaItemsCol(venueId, departmentId, areaName), orderBy('__name__'), limit(PAGE_SIZE));
      const snap = await getDocs(baseQ);
      const items: ItemRow[] = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data?.name ?? d.id, // UI-only: may not exist due to rules
          expectedQuantity: data?.expectedQuantity,
          unit: data?.unit,
        };
      });
      setAllItems(items);
      setPageCursor(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.size === PAGE_SIZE);
    } finally {
      setPaging(false);
    }
  }, [venueId, departmentId, areaName]);

  const loadMore = useCallback(async () => {
    if (!hasMore || paging || !pageCursor) return;
    setPaging(true);
    try {
      const moreQ = query(
        areaItemsCol(venueId, departmentId, areaName),
        orderBy('__name__'),
        startAfter(pageCursor),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(moreQ);
      const items: ItemRow[] = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data?.name ?? d.id,
          expectedQuantity: data?.expectedQuantity,
          unit: data?.unit,
        };
      });
      setAllItems(prev => [...prev, ...items]);
      setPageCursor(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.size === PAGE_SIZE);
    } finally {
      setPaging(false);
    }
  }, [venueId, departmentId, areaName, hasMore, paging, pageCursor]);

  // Debounced search (client-side over loaded page(s))
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(i => (i.name ?? '').toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
  }, [debouncedQuery, allItems]);

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

      filtered.forEach(i => {
        const raw = counts[i.id] ?? (fillZeros ? '0' : '0');
        const qty = Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : 0;
        batch.set(
          areaItemDoc(venueId, departmentId, areaName, i.id),
          { lastCount: qty, lastCountAt: serverTimestamp() },
          { merge: true }
        );
      });

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

  // Quick Add (unchanged) — safe with rules
  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'item';
  const onQuickAdd = async () => {
    if (readOnly) {
      Alert.alert('Read-only', 'This department is complete. Start a new cycle to add items.');
      return;
    }
    const q = queryText.trim();
    if (!q) {
      Alert.alert('Nothing to add', 'Type a name first, then tap Quick add.');
      return;
    }
    const newId = slugify(q);
    try {
      await setDoc(
        areaItemDoc(venueId, departmentId, areaName, newId),
        { lastCount: 0, lastCountAt: serverTimestamp() },
        { merge: true }
      );
      setAllItems(prev => prev.some(p => p.id === newId) ? prev : [{ id: newId, name: q }, ...prev]);
      setCounts(prev => ({ ...prev, [newId]: '' }));
      setQueryText('');
      Alert.alert('Added', `Placeholder item “${q}” added to this area.`);
      console.log('[TallyUp QuickAdd] placeholder created', { venueId, departmentId, areaName, id: newId });
    } catch (e: any) {
      Alert.alert('Quick add failed', e?.message ?? 'Unknown error');
    }
  };

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

  const noMatches = filtered.length === 0 && debouncedQuery.trim().length > 0;

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
        value={queryText}
        onChangeText={setQueryText}
        editable={!readOnly}
      />

      {noMatches ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ marginBottom: 8 }}>No matches in loaded items.</Text>
          <TouchableOpacity style={[S.actionBtn, readOnly && S.disabled]} onPress={() => Alert.alert('Search across venue', 'Stub — coming post-MVP.')} disabled={readOnly}>
            <Text style={S.actionText}>Search across venue (stub)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.actionBtn, readOnly && S.disabled]} onPress={onQuickAdd} disabled={readOnly}>
            <Text style={S.actionText}>Quick add “{queryText.trim()}” to this area</Text>
          </TouchableOpacity>
          {readOnly && <Text style={{ color: '#666', marginTop: 6 }}>Area is complete — start a new cycle to add items.</Text>}
        </View>
      ) : (
        <>
          <FlatList
            data={filtered}
            keyExtractor={(it) => it.id}
            renderItem={renderRow}
            contentContainerStyle={{ paddingBottom: 24 }}
            onEndReachedThreshold={0.4}
            onEndReached={() => { if (!debouncedQuery) void loadMore(); }}
            ListFooterComponent={
              (!debouncedQuery && hasMore) ? (
                <TouchableOpacity style={[S.loadMore, paging && { opacity: 0.6 }]} onPress={loadMore} disabled={paging}>
                  <Text style={S.loadMoreText}>{paging ? 'Loading…' : 'Load more'}</Text>
                </TouchableOpacity>
              ) : null
            }
          />
        </>
      )}

      {!readOnly && filtered.length > 0 && (
        <TouchableOpacity style={[S.submitBtn, submitting && { opacity: 0.6 }]} onPress={onSubmit} disabled={submitting}>
          <Text style={S.submitText}>{submitting ? 'Submitting…' : 'Submit Area'}</Text>
        </TouchableOpacity>
      )}
      {readOnly && (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#444' }}>This area is complete (read-only).</Text>
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
  loadMore: { padding: 12, alignItems: 'center' },
  loadMoreText: { color: '#0A84FF', fontWeight: '700' },
});
