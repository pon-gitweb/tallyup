// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, collection, getDocs, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';

type Product = { id: string; name: string; unit?: string | null; category?: string | null };

export default function BatchPriceEntryScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { showSuccess, showError } = useToast();
  const db = getFirestore();

  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  useEffect(() => {
    if (!venueId) { setLoading(false); return; }
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
        const unpriced: Product[] = [];
        snap.forEach(d => {
          const data = d.data() as any;
          if (data.costPrice == null && data.name) {
            unpriced.push({
              id: d.id,
              name: data.name,
              unit: data.unit || null,
              category: data.category || null,
            });
          }
        });
        unpriced.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setProducts(unpriced);
      } catch {}
      setLoading(false);
    })();
  }, [venueId]);

  const filledCount = Object.values(prices).filter(p => {
    const v = parseFloat(p);
    return p.trim() && !isNaN(v) && v > 0;
  }).length;

  const handleSave = async () => {
    if (!venueId || filledCount === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      let count = 0;
      for (const [id, raw] of Object.entries(prices)) {
        const val = parseFloat(raw);
        if (isNaN(val) || val <= 0) continue;
        batch.update(doc(db, 'venues', venueId, 'products', id), {
          costPrice: val,
          updatedAt: serverTimestamp(),
        });
        count++;
      }
      await batch.commit();
      showSuccess(`${count} price${count !== 1 ? 's' : ''} added to your products.`);
      nav.goBack();
    } catch (e: any) {
      showError(e?.message || 'Please try again.');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={c.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!products.length) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: c.navy, marginBottom: 8, textAlign: 'center' }}>
          All products have prices ✓
        </Text>
        <Text style={{ color: c.textSecondary, textAlign: 'center', lineHeight: 20 }}>
          No unpriced products found. Add new products or scan invoices to set prices automatically.
        </Text>
        <TouchableOpacity onPress={() => nav.goBack()} style={{ marginTop: 24, backgroundColor: c.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28 }}>
          <Text style={{ color: c.primaryText, fontWeight: '700' }}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: c.navy }}>Add cost prices</Text>
        <Text style={{ color: c.textSecondary, marginTop: 2, fontSize: 14 }}>
          {products.length} product{products.length !== 1 ? 's' : ''} need a price for dollar variance
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 110 }}
        keyboardShouldPersistTaps="handled"
      >
        {products.map((p, idx) => (
          <View
            key={p.id}
            style={{
              backgroundColor: c.surface, borderRadius: 12, padding: 12,
              marginBottom: 8, borderWidth: 1, borderColor: c.border,
              flexDirection: 'row', alignItems: 'center', gap: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: c.navy, fontSize: 14 }}>{p.name}</Text>
              {(p.category || p.unit) ? (
                <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {[p.category, p.unit].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: c.textSecondary, fontSize: 16, fontWeight: '600' }}>$</Text>
              <TextInput
                ref={el => { inputRefs.current[p.id] = el; }}
                value={prices[p.id] ?? ''}
                onChangeText={v => setPrices(prev => ({ ...prev, [p.id]: v }))}
                placeholder="0.00"
                placeholderTextColor={c.textSecondary}
                keyboardType="decimal-pad"
                returnKeyType={idx < products.length - 1 ? 'next' : 'done'}
                onSubmitEditing={() => {
                  if (idx < products.length - 1) {
                    inputRefs.current[products[idx + 1].id]?.focus();
                  }
                }}
                style={{
                  width: 80, height: 40, borderRadius: 8,
                  borderWidth: 2,
                  borderColor: prices[p.id]?.trim() && !isNaN(parseFloat(prices[p.id])) && parseFloat(prices[p.id]) > 0
                    ? '#14B8A6' : c.border,
                  backgroundColor: '#fff', fontSize: 16, fontWeight: '700',
                  textAlign: 'center', color: c.navy,
                }}
              />
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: 16, backgroundColor: c.background,
        borderTopWidth: 1, borderTopColor: c.border,
      }}>
        <TouchableOpacity
          style={{
            backgroundColor: filledCount > 0 ? '#14B8A6' : c.border,
            borderRadius: 999, paddingVertical: 14, alignItems: 'center',
            opacity: saving ? 0.6 : 1,
          }}
          onPress={handleSave}
          disabled={filledCount === 0 || saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{
              color: filledCount > 0 ? '#fff' : c.textSecondary,
              fontWeight: '800', fontSize: 15,
            }}>
              {filledCount > 0
                ? `Save ${filledCount} price${filledCount !== 1 ? 's' : ''}`
                : 'Enter prices above to save'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
