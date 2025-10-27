// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { searchProducts } from '../../services/catalogSafe';

type Props = {
  initialTerm?: string;
  onApply: (patch: any) => void;
};

const numOrNull = (v:any)=>{ const n=Number(v); return Number.isFinite(n)?n:null; };
const intOrNull = (v:any)=>{ const n=Math.round(Number(v)); return Number.isFinite(n)?n:null; };

export default function AutoFillFromCatalog({ initialTerm = '', onApply }: Props) {
  const [term, setTerm] = useState(initialTerm);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [touched, setTouched] = useState(false);

  async function doSearch(q: string) {
    setTouched(true);
    const t = q.trim();
    if (!t) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await searchProducts(t, 12);
      setRows(Array.isArray(res) ? res : []);
    } finally {
      setLoading(false);
    }
  }

  function applyRow(r:any) {
    const patch = {
      name: r.name ?? null,
      sku: r.sku ?? null,
      unit: r.unit ?? null,
      size: r.size ?? null,
      packSize: intOrNull(r.packSize),
      abv: numOrNull(r.abv),
      costPrice: numOrNull(r.costPrice ?? r.price ?? r.unitCost),
      gstPercent: numOrNull(r.gstPercent ?? 15) ?? 15,
      supplierNameSuggested: r.supplierName ?? null,
      supplierGlobalId: r.id ?? null,
      categorySuggested: r.category ?? null,
    };
    onApply(patch);
  }

  // small debounce: search after user pauses typing
  useEffect(() => {
    const h = setTimeout(() => { if (term.trim()) doSearch(term); else setRows([]); }, 250);
    return () => clearTimeout(h);
  }, [term]);

  const emptyState = useMemo(() => {
    if (!touched && !term.trim()) return <Text style={S.hint}>Type a name or SKU to search the catalog.</Text>;
    if (loading) return (
      <View style={{ flexDirection:'row', alignItems:'center', gap:8, paddingTop:6 }}>
        <ActivityIndicator />
        <Text style={S.hint}>Searching…</Text>
      </View>
    );
    if (term.trim() && rows.length === 0) return <Text style={S.hint}>No matches.</Text>;
    return null;
  }, [touched, term, loading, rows]);

  return (
    <View style={S.wrap}>
      <Text style={S.title}>Auto-fill from Global Catalog</Text>
      <View style={S.row}>
        <TextInput
          value={term}
          onChangeText={setTerm}
          placeholder="Search name or SKU"
          autoCapitalize="none"
          style={S.input}
        />
        <TouchableOpacity onPress={() => doSearch(term)} style={S.btn}>
          <Text style={S.btnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {emptyState}

      {/* Results (non-virtualized list to avoid nested VirtualizedList warnings) */}
      <View style={{ marginTop: 8 }}>
        {rows.map((r) => (
          <TouchableOpacity key={r.id} onPress={() => applyRow(r)} style={S.rowItem} activeOpacity={0.8}>
            <View style={{ flex:1 }}>
              <Text style={S.rowTitle}>{r.name ?? r.sku ?? r.id}</Text>
              <Text style={S.rowSub}>
                {r.sku ? `SKU ${r.sku} · ` : ''}{r.size ? `${r.size} · ` : ''}{r.unit ? `${r.unit} · ` : ''}{Number.isFinite(r?.packSize) ? `pack ${r.packSize}` : ''}
              </Text>
              <Text style={S.rowSubDim}>
                {r.supplierName ? `Supplier: ${r.supplierName}` : '—'}
                {Number.isFinite(r?.costPrice) ? ` · $${Number(r.costPrice).toFixed(2)} ex GST` : ''}
              </Text>
            </View>
            <View style={S.applyPill}><Text style={S.applyText}>Apply</Text></View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  btn: { backgroundColor: '#111827', paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '800' },
  hint: { color: '#374151', marginTop: 8 },
  rowItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#374151', marginTop: 1 },
  rowSubDim: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  applyPill: { backgroundColor: '#111827', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  applyText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
