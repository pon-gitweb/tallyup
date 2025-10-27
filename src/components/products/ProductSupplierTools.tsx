// @ts-nocheck
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import { previewCatalog } from '../../services/suppliers/catalogPreview';
import { applyCatalogLinks } from '../../services/suppliers/catalogApply';
import { useVenueId } from '../../context/VenueProvider';

type ProductCandidate = { id: string; name?: string | null };

type Props = {
  existingProducts: ProductCandidate[];
  onApplied?: (summary: { ok: number; skipped: number; error: number }) => void;
};

const MAX_H = Math.floor(Dimensions.get('window').height * 0.65);

export default function ProductSupplierTools({ existingProducts, onApplied }: Props) {
  const venueId = useVenueId();

  // Which supplier this CSV belongs to
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');

  // CSV + header mapping
  const [csv, setCsv] = useState('');
  const [map, setMap] = useState({
    name: 'Product Name',
    sku: 'Sku',
    price: 'Price',
    packSize: 'Pack',
    unit: 'Unit',
    gstPercent: 'GST%',
  });
  const [ran, setRan] = useState(false);

  const res = useMemo(() => {
    return ran ? previewCatalog({ csvText: csv, headerMap: map, existingProducts }) : { rows: [], suggestions: [] };
  }, [csv, map, existingProducts, ran]);

  const exactRows = useMemo(() => {
    // Build ApplyRow list from exact matches only
    return res.suggestions
      .map((sug, i) => ({ sug, row: res.rows[i] }))
      .filter(({ sug }) => sug?.matchQuality === 'exact' && !!sug.productId)
      .map(({ sug, row }, i) => ({
        rowIndex: i,
        productId: sug.productId!,
        productName: sug.productName ?? row?.name ?? null,
        supplierId: supplierId.trim(),
        supplierName: supplierName.trim() || null,
        createIfMissing: false,
      }));
  }, [res, supplierId, supplierName]);

  const onPreview = () => setRan(true);

  const onApplyExact = async () => {
    if (!venueId) return;
    if (!supplierId.trim()) {
      alert('Please enter the Supplier ID this CSV belongs to.');
      return;
    }
    if (!exactRows.length) {
      alert('No exact matches to apply.');
      return;
    }
    try {
      const { results } = await applyCatalogLinks({ venueId, rows: exactRows });
      const ok = results.filter((r) => r.status === 'ok').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      const error = results.filter((r) => r.status === 'error').length;
      onApplied?.({ ok, skipped, error });
      alert(`Applied: ${ok} ok, ${skipped} skipped, ${error} error`);
    } catch (e: any) {
      alert(e?.message || 'Apply failed');
    }
  };

  return (
    <ScrollView
      style={{ maxHeight: MAX_H }}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 16 }}
    >
      <View style={S.wrap}>
        <Text style={S.title}>Product Supplier Tools</Text>
        <Text style={S.hint}>
          1) Set which supplier this CSV belongs to → 2) Paste CSV + map → 3) Preview → 4) Apply exact matches.
        </Text>

        <View style={S.rowInputs}>
          <View style={S.col}>
            <Text style={S.label}>Supplier ID</Text>
            <TextInput value={supplierId} onChangeText={setSupplierId} placeholder="e.g. s_hancocks" style={S.input} />
          </View>
          <View style={S.col}>
            <Text style={S.label}>Supplier Name</Text>
            <TextInput value={supplierName} onChangeText={setSupplierName} placeholder="e.g. Hancocks" style={S.input} />
          </View>
        </View>

        <View style={S.mapRow}>
          {(['name', 'sku', 'price', 'packSize', 'unit', 'gstPercent'] as const).map((k) => (
            <View style={S.mapCol} key={k}>
              <Text style={S.label}>{k}</Text>
              <TextInput value={map[k] ?? ''} onChangeText={(v) => setMap((m) => ({ ...m, [k]: v }))} style={S.input} />
            </View>
          ))}
        </View>

        <TextInput
          style={[S.input, S.csvBox]}
          value={csv}
          onChangeText={setCsv}
          placeholder="Paste supplier CSV text (first row = headers)…"
          multiline
        />

        <TouchableOpacity onPress={onPreview} style={S.btn}>
          <Text style={S.btnText}>Preview</Text>
        </TouchableOpacity>

        {ran ? (
          <View style={{ marginTop: 12 }}>
            <Text style={S.subTitle}>Rows: {res.rows.length}</Text>

            {/* Non-virtualized list to avoid nesting warnings */}
            <View>
              {res.rows.map((item: any, index: number) => {
                const sug = res.suggestions[index];
                const tagStyle =
                  sug?.matchQuality === 'exact'
                    ? S.tagOk
                    : sug?.matchQuality === 'startsWith'
                    ? S.tagWarn
                    : S.tagNeutral;

                return (
                  <View key={index} style={[S.row, { marginBottom: 6 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={S.rowTitle}>{item.name}</Text>
                      <Text style={S.rowSub}>
                        {item.sku ? `SKU ${item.sku} · ` : ''}
                        {item.price != null ? `$${Number(item.price).toFixed(2)} · ` : ''}
                        {item.packSize ? `${item.packSize} · ` : ''}
                        {item.unit ? `${item.unit} · ` : ''}
                        {item.gstPercent != null ? `${item.gstPercent}% GST` : ''}
                      </Text>
                      <Text style={[S.tag, tagStyle]}>
                        {sug?.matchQuality || 'none'}
                        {sug?.productName ? ` · ${sug.productName}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}
              {res.rows.length === 0 && <Text style={S.rowSub}>No rows to preview.</Text>}
            </View>

            <TouchableOpacity onPress={onApplyExact} style={[S.btn, { marginTop: 12 }]}>
              <Text style={S.btnText}>Apply exact matches (set preferred)</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  wrap: { backgroundColor: '#fff', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  title: { fontSize: 16, fontWeight: '800' },
  subTitle: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  hint: { fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 8 },

  rowInputs: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },

  mapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mapCol: { width: 150 },

  label: { fontSize: 11, color: '#374151', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  csvBox: { minHeight: 120, textAlignVertical: 'top' },

  btn: { marginTop: 8, backgroundColor: '#111827', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  row: { paddingVertical: 10, borderBottomWidth: 1, borderColor: '#f3f4f6' },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },

  tag: { marginTop: 6, fontSize: 11, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, alignSelf: 'flex-start' },
  tagOk: { backgroundColor: '#ecfdf5', color: '#065f46' },
  tagWarn: { backgroundColor: '#fffbeb', color: '#92400e' },
  tagNeutral: { backgroundColor: '#f3f4f6', color: '#374151' },
});
