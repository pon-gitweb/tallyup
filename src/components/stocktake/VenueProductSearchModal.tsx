// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../common/Toast';
import { useConfirmModal } from '../common/useConfirmModal';

type VenueProduct = {
  id: string;
  name: string;
  unit?: string;
  supplierName?: string;
  costPrice?: number;
  parLevel?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  venueId: string | null | undefined;
  areaName?: string;
  onSelect: (product: VenueProduct) => void;
  onBatchSelect?: (products: VenueProduct[]) => void;
};

export default function VenueProductSearchModal({
  visible,
  onClose,
  venueId,
  areaName,
  onSelect,
  onBatchSelect,
}: Props) {
  const c = useColours();
  const { showError } = useToast();
  const { modal } = useConfirmModal();
  const S = makeStyles(c);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<VenueProduct[]>([]);
  const [q, setQ] = useState('');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [toastText, setToastText] = useState('');
  const [multiMode, setMultiMode] = useState(false);
  const [selected, setSelected] = useState<Map<string, VenueProduct>>(new Map());

  useEffect(() => {
    if (!visible || !venueId) return;
    setLoading(true);
    (async () => {
      try {
        const db = getFirestore();
        const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
        const loaded = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        loaded.sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' })
        );
        setProducts(loaded);
      } catch (e: any) {
        setProducts([]);
        showError(e?.message || 'Could not load products.');
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, venueId]);

  // Auto-clear toast after 2.5 s
  useEffect(() => {
    if (!toastText) return;
    const t = setTimeout(() => setToastText(''), 2500);
    return () => clearTimeout(t);
  }, [toastText]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(p => (p.name || '').toLowerCase().includes(needle));
  }, [products, q]);

  const handleClose = () => {
    setQ('');
    setAddedIds(new Set());
    setToastText('');
    setMultiMode(false);
    setSelected(new Map());
    onClose();
  };

  const handleSelect = (p: VenueProduct) => {
    if (multiMode) {
      setSelected(prev => {
        const n = new Map(prev);
        if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p);
        return n;
      });
      return;
    }
    if (addedIds.has(p.id)) return;
    onSelect(p);
    setAddedIds(prev => {
      const n = new Set(prev);
      n.add(p.id);
      return n;
    });
    setToastText(`${p.name} added to ${areaName || 'area'}`);
  };

  const handleBatchDone = () => {
    if (selected.size === 0) return;
    const products = [...selected.values()];
    handleClose();
    if (onBatchSelect) onBatchSelect(products);
  };

  const handleSelectAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      // Deselect all currently filtered
      setSelected(prev => {
        const n = new Map(prev);
        filtered.forEach(p => n.delete(p.id));
        return n;
      });
    } else {
      // Select all currently filtered
      setSelected(prev => {
        const n = new Map(prev);
        filtered.forEach(p => n.set(p.id, p));
        return n;
      });
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      {modal}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={S.wrap}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <TouchableOpacity style={S.backdrop} onPress={handleClose} activeOpacity={1} />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={S.sheet}>
          {/* Header */}
          <View style={S.header}>
            <View style={{ flex: 1 }}>
              <Text style={S.title}>Search venue products</Text>
              <Text style={S.sub}>
                {multiMode
                  ? `${selected.size} selected — tap Done to add`
                  : `Tap to add to ${areaName || 'this area'}`}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {!!onBatchSelect && (
                <TouchableOpacity
                  onPress={() => { setMultiMode(v => !v); setSelected(new Map()); }}
                  style={[S.doneBtn, { backgroundColor: multiMode ? c.navy : c.border }]}
                >
                  <Text style={[S.doneBtnText, { color: multiMode ? c.surface : c.text }]}>
                    {multiMode ? 'Cancel' : 'Multi'}
                  </Text>
                </TouchableOpacity>
              )}
              {multiMode && filtered.length > 0 && (
                <TouchableOpacity onPress={handleSelectAll} style={S.selectAllBtn}>
                  <Text style={S.selectAllText}>
                    {allFilteredSelected ? 'Deselect all' : `Select all (${filtered.length})`}
                  </Text>
                </TouchableOpacity>
              )}
              {multiMode && selected.size > 0 ? (
                <TouchableOpacity onPress={handleBatchDone} style={S.doneBtn}>
                  <Text style={S.doneBtnText}>Done ({selected.size})</Text>
                </TouchableOpacity>
              ) : !multiMode ? (
                <TouchableOpacity onPress={handleClose} style={S.doneBtn}>
                  <Text style={S.doneBtnText}>Done</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Search bar */}
          <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search by name…"
              placeholderTextColor={c.slateMid}
              style={S.searchInput}
              autoFocus
              clearButtonMode="while-editing"
            />
          </View>

          {/* List */}
          {loading ? (
            <View style={{ alignItems: 'center', padding: 32 }}>
              <ActivityIndicator color={c.deepBlue} />
              <Text style={{ color: c.slateMid, marginTop: 10, fontSize: 13 }}>Loading products…</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={p => p.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: toastText ? 60 : 32 }}
              renderItem={({ item }) => {
                const wasAdded = addedIds.has(item.id);
                const isSelected = selected.has(item.id);
                return (
                  <TouchableOpacity
                    style={[S.row, wasAdded && !multiMode && S.rowAdded, multiMode && isSelected && { backgroundColor: c.positiveSoft }]}
                    onPress={() => handleSelect(item)}
                    activeOpacity={0.75}
                    disabled={wasAdded && !multiMode}
                  >
                    {multiMode && (
                      <View style={{
                        width: 22, height: 22, borderRadius: 5, borderWidth: 2, marginRight: 10,
                        borderColor: isSelected ? c.success : c.border,
                        backgroundColor: isSelected ? c.success : c.surface,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isSelected && <Text style={{ color: c.surface, fontSize: 12, fontWeight: '900' }}>✓</Text>}
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={S.rowName}>{item.name}</Text>
                      <Text style={S.rowSub}>
                        {item.unit || 'unit?'}
                        {item.supplierName ? ` · ${item.supplierName}` : ''}
                        {typeof item.parLevel === 'number' ? ` · Par ${item.parLevel}` : ''}
                      </Text>
                    </View>
                    {!multiMode && wasAdded ? (
                      <Text style={S.checkmark}>✓</Text>
                    ) : !multiMode ? (
                      <Text style={{ fontSize: 20, color: c.slateMid }}>›</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={{ textAlign: 'center', color: c.slateMid, padding: 28, fontSize: 14 }}>
                  {q.trim()
                    ? 'No products match your search.'
                    : 'No products in this venue yet.\nAdd products via Settings → Products first.'}
                </Text>
              }
            />
          )}

          {/* Success toast */}
          {!!toastText && (
            <View style={S.toast} pointerEvents="none">
              <Text style={S.toastText}>✓ {toastText}</Text>
            </View>
          )}
        </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '78%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: c.oat,
    },
    title: { fontSize: 17, fontWeight: '800', color: c.navy },
    sub: { fontSize: 12, color: c.slateMid, marginTop: 2 },
    doneBtn: {
      backgroundColor: c.deepBlue,
      borderRadius: 8,
      paddingVertical: 7,
      paddingHorizontal: 14,
    },
    doneBtnText: { color: c.surface, fontWeight: '700', fontSize: 14 },
    searchInput: {
      backgroundColor: c.oat,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      color: c.navy,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: c.oat,
    },
    rowAdded: { backgroundColor: c.positiveSoft },
    rowName: { fontSize: 14, fontWeight: '700', color: c.navy },
    rowSub: { fontSize: 12, color: c.slateMid, marginTop: 2 },
    checkmark: { fontSize: 18, color: c.success, fontWeight: '800' },
    selectAllBtn: { paddingHorizontal: 10, paddingVertical: 7 },
    selectAllText: { color: c.deepBlue, fontSize: 13, fontWeight: '600' },
    toast: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.success,
      paddingVertical: 12,
      alignItems: 'center',
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 20,
    },
    toastText: { color: c.surface, fontWeight: '700', fontSize: 14 },
  });
}
