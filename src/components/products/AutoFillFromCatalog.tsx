// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import {
  searchGlobalCatalogByNamePrefix,
  catalogHitToProductPatch,
} from '../../services/globalCatalog';

type Props = {
  initialTerm?: string;
  onApply: (patch: any) => void;
};

const clean = (s: any) => (typeof s === 'string' ? s.trim() : '');

export default function AutoFillFromCatalog({ initialTerm = '', onApply }: Props) {
  const [term, setTerm] = useState(initialTerm);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [touched, setTouched] = useState(false);

  async function doSearch(q: string) {
    setTouched(true);
    const t = clean(q);
    if (!t) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      // Prefix search across all global_suppliers/{id}/items
      const hits = await searchGlobalCatalogByNamePrefix(t, 10, 40);
      setRows(Array.isArray(hits) ? hits : []);
    } catch (e: any) {
      console.log('[AutoFillFromCatalog] search error', e?.message || e);
      // Soft failure for now – just show "No matches"
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function applyRow(hit: any) {
    const patch = catalogHitToProductPatch(hit);
    onApply(patch);
  }

  // small debounce: search after user pauses typing
  useEffect(() => {
    const h = setTimeout(() => {
      if (clean(term)) doSearch(term);
      else setRows([]);
    }, 250);
    return () => clearTimeout(h);
  }, [term]);

  const emptyState = useMemo(() => {
    if (!touched && !clean(term)) {
      return <Text style={S.hint}>Type a name or SKU to search the global catalog.</Text>;
    }
    if (loading) {
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <ActivityIndicator />
          <Text style={S.hint}>Searching…</Text>
        </View>
      );
    }
    if (clean(term) && rows.length === 0) {
      return <Text style={S.hint}>No matches.</Text>;
    }
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
        {rows.map((hit) => {
          const key = `${hit.supplierGlobalId || 'sup'}:${hit.externalSku || hit.name || Math.random().toString(36).slice(2)}`;
          const price =
            hit.priceBottleExGst != null
              ? Number(hit.priceBottleExGst)
              : hit.priceCaseExGst != null && hit.unitsPerCase
              ? Number(hit.priceCaseExGst) / Number(hit.unitsPerCase)
              : null;

          return (
            <TouchableOpacity
              key={key}
              onPress={() => applyRow(hit)}
              style={S.rowItem}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={S.rowTitle}>{hit.name || hit.externalSku || key}</Text>
                <Text style={S.rowSub}>
                  {hit.externalSku ? `SKU ${hit.externalSku} · ` : ''}
                  {hit.size ? `${hit.size} · ` : ''}
                  {hit.unit ? `${hit.unit} · ` : ''}
                  {Number.isFinite(hit?.unitsPerCase)
                    ? `pack ${hit.unitsPerCase}`
                    : ''}
                </Text>
                <Text style={S.rowSubDim}>
                  {hit.supplierName ? `Supplier: ${hit.supplierName}` : '—'}
                  {price != null && Number.isFinite(price)
                    ? ` · $${price.toFixed(2)} ex GST`
                    : ''}
                </Text>
              </View>
              <View style={S.applyPill}>
                <Text style={S.applyText}>Apply</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  btn: {
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '800' },
  hint: { color: '#374151', marginTop: 8 },
  rowItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#F3F4F6',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#374151', marginTop: 1 },
  rowSubDim: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  applyPill: {
    backgroundColor: '#111827',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  applyText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
