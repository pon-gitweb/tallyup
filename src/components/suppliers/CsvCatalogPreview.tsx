// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ScrollView } from 'react-native';
import { previewCatalog } from '../../services/suppliers/catalogPreview';

type ProductCandidate = { id: string; name?: string | null };

type Props = {
  supplierId?: string | null; // for future "Apply" wiring
  existingProducts: ProductCandidate[]; // caller supplies (e.g., from listProducts(...))
  initialCsv?: string;
  initialHeaderMap?: {
    name?: string; sku?: string; price?: string; packSize?: string; unit?: string; gstPercent?: string;
  };
};

export default function CsvCatalogPreview({
  supplierId = null,
  existingProducts,
  initialCsv = '',
  initialHeaderMap = { name: 'Product Name', sku: 'Sku', price: 'Price', packSize: 'Pack', unit: 'Unit', gstPercent: 'GST%' }
}: Props) {
  const [csv, setCsv] = useState(initialCsv);
  const [map, setMap] = useState(initialHeaderMap);
  const [ran, setRan] = useState(false);

  const { rows, suggestions } = useMemo(() => {
    if (!ran) return { rows: [], suggestions: [] };
    return previewCatalog({ csvText: csv, headerMap: map, existingProducts });
  }, [csv, map, existingProducts, ran]);

  const onRun = () => setRan(true);

  return (
    <View style={S.wrap}>
      <Text style={S.title}>Supplier CSV → Preview (read-only)</Text>
      <Text style={S.hint}>Paste CSV, map headers, then Preview. No writes occur.</Text>

      <ScrollView horizontal contentContainerStyle={{ paddingVertical: 8 }}>
        <View style={S.mapCol}>
          <Text style={S.label}>name</Text>
          <TextInput value={map.name ?? ''} onChangeText={(v)=>setMap((m)=>({...m, name:v}))} style={S.input} placeholder="Product Name" />
        </View>
        <View style={S.mapCol}>
          <Text style={S.label}>sku</Text>
          <TextInput value={map.sku ?? ''} onChangeText={(v)=>setMap((m)=>({...m, sku:v}))} style={S.input} placeholder="Sku" />
        </View>
        <View style={S.mapCol}>
          <Text style={S.label}>price</Text>
          <TextInput value={map.price ?? ''} onChangeText={(v)=>setMap((m)=>({...m, price:v}))} style={S.input} placeholder="Price" />
        </View>
        <View style={S.mapCol}>
          <Text style={S.label}>packSize</Text>
          <TextInput value={map.packSize ?? ''} onChangeText={(v)=>setMap((m)=>({...m, packSize:v}))} style={S.input} placeholder="Pack" />
        </View>
        <View style={S.mapCol}>
          <Text style={S.label}>unit</Text>
          <TextInput value={map.unit ?? ''} onChangeText={(v)=>setMap((m)=>({...m, unit:v}))} style={S.input} placeholder="Unit" />
        </View>
        <View style={S.mapCol}>
          <Text style={S.label}>gstPercent</Text>
          <TextInput value={map.gstPercent ?? ''} onChangeText={(v)=>setMap((m)=>({...m, gstPercent:v}))} style={S.input} placeholder="GST%" />
        </View>
      </ScrollView>

      <TextInput
        style={[S.input, S.csvBox]}
        value={csv}
        onChangeText={setCsv}
        placeholder="Paste CSV text here (first row must be headers)…"
        multiline
      />

      <TouchableOpacity onPress={onRun} style={S.btn}>
        <Text style={S.btnText}>Preview</Text>
      </TouchableOpacity>

      {ran ? (
        <View style={{ marginTop: 12 }}>
          <Text style={S.subTitle}>Normalized rows: {rows.length}</Text>
          <FlatList
            data={rows}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item, index }) => {
              const sug = suggestions[index];
              return (
                <View style={S.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.rowTitle}>{item.name}</Text>
                    <Text style={S.rowSub}>
                      {item.sku ? `SKU ${item.sku} · ` : ''}
                      {item.price != null ? `$${item.price.toFixed(2)} · ` : ''}
                      {item.packSize ? `${item.packSize} · ` : ''}
                      {item.unit ? `${item.unit} · ` : ''}
                      {item.gstPercent != null ? `${item.gstPercent}% GST` : ''}
                    </Text>
                    <Text style={[S.tag, sug?.matchQuality === 'exact' ? S.tagOk : (sug?.matchQuality === 'startsWith' ? S.tagWarn : S.tagNeutral)]}>
                      {sug?.matchQuality || 'none'}
                      {sug?.productName ? ` · ${sug.productName}` : ''}
                    </Text>
                    {Array.isArray(sug?.candidates) && sug.candidates.length ? (
                      <Text style={S.cands}>
                        Candidates: {sug.candidates.map(c => c.name || c.productId).join(', ')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff', padding: 12 },
  title: { fontSize: 18, fontWeight: '800' },
  subTitle: { fontSize: 14, fontWeight: '800', marginBottom: 8 },
  hint: { fontSize: 12, color: '#6b7280', marginTop: 4, marginBottom: 8 },
  mapCol: { width: 140, marginRight: 8 },
  label: { fontSize: 11, color: '#374151', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, backgroundColor: '#fff' },
  csvBox: { minHeight: 120, textAlignVertical: 'top' },
  btn: { marginTop: 8, backgroundColor: '#111827', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  tag: { marginTop: 6, fontSize: 11, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, alignSelf: 'flex-start' },
  tagOk: { backgroundColor: '#ecfdf5', color: '#065f46' },
  tagWarn: { backgroundColor: '#fffbeb', color: '#92400e' },
  tagNeutral: { backgroundColor: '#f3f4f6', color: '#374151' },
  cands: { marginTop: 4, fontSize: 11, color: '#374151' }
});
