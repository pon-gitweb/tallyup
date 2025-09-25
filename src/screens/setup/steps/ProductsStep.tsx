import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Button, Alert, FlatList } from 'react-native';
import { getAuth } from 'firebase/auth';
import { db } from '../../../services/firebase';
import { doc, setDoc, collection } from 'firebase/firestore';
import { getCurrentVenueForUser } from '../../../services/devBootstrap';

type ProductRow = {
  sku: string;
  name: string;
  unit?: string;
  category?: string;
  par?: number | null;
};

function parseCSV(text: string): ProductRow[] {
  // very small CSV parser: sku,name,unit,category,par
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows: ProductRow[] = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim());
    if (!cols[0] || !cols[1]) continue;
    rows.push({
      sku: cols[0],
      name: cols[1],
      unit: cols[2] || undefined,
      category: cols[3] || undefined,
      par: cols[4] ? Number(cols[4]) : null,
    });
  }
  return rows;
}

export default function ProductsStep() {
  const [csv, setCsv] = useState('');
  const preview = useMemo(() => parseCSV(csv).slice(0, 50), [csv]);
  const [busy, setBusy] = useState(false);

  async function importRows() {
    const user = getAuth().currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    const venueId = await getCurrentVenueForUser();
    if (!venueId) {
      Alert.alert('No Venue', 'Please create a venue first.');
      return;
    }

    const rows = parseCSV(csv);
    if (rows.length === 0) {
      Alert.alert('Empty CSV', 'Paste CSV text first.');
      return;
    }

    setBusy(true);
    try {
      const col = collection(db, 'venues', venueId, 'products');
      let count = 0;
      for (const r of rows) {
        const id = r.sku || r.name;
        const ref = doc(col, id);
        const payload = {
          sku: r.sku,
          name: r.name,
          unit: r.unit || null,
          category: r.category || null,
          par: typeof r.par === 'number' && !isNaN(r.par) ? r.par : null,
          active: true,
        };
        await setDoc(ref, payload, { merge: true });
        count++;
      }
      Alert.alert('Import complete', `Imported ${count} products.`);
      console.log('[TallyUp Setup] products imported', JSON.stringify({ count }));
    } catch (e: any) {
      console.log('[TallyUp Setup] products import error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Import failed', e?.message ?? 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <Text>Paste CSV with columns: sku,name,unit,category,par</Text>
      <TextInput
        multiline
        value={csv}
        onChangeText={setCsv}
        placeholder={'SKU123,Heineken 330ml,bottle,Beer,24\nSKU124,House Merlot,glass,Wine,12'}
        style={{ height: 150, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8 }}
      />
      <Button title={busy ? 'Importing…' : 'Import Products'} onPress={importRows} disabled={busy} />
      <Text style={{ marginTop: 8, fontWeight: '600' }}>Preview (first 50 rows)</Text>
      <FlatList
        data={preview}
        keyExtractor={(it, i) => it.sku + ':' + i}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 6 }}>
            <Text>{item.sku} — {item.name} {item.unit ? `(${item.unit})` : ''}</Text>
            <Text style={{ opacity: 0.7, fontSize: 12 }}>{item.category || ''} {item.par != null ? ` • par ${item.par}` : ''}</Text>
          </View>
        )}
      />
    </View>
  );
}
