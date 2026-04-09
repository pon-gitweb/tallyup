// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { SupplierPortalService, SupplierSpecial } from '../../services/supplier/SupplierPortalService';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function SupplierSpecialsScreen() {
  const route = useRoute<any>();
  const { supplierId } = route.params;
  const themeColours = useColours();
  const [specials, setSpecials] = useState<SupplierSpecial[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [discount, setDiscount] = useState('');

  const load = useCallback(async () => {
    setSpecials(await SupplierPortalService.getSpecials(supplierId));
  }, [supplierId]);

  useEffect(() => { load(); }, [load]);

  const onAdd = useCallback(async () => {
    if (!title.trim()) { Alert.alert('Title required'); return; }
    await SupplierPortalService.addSpecial(supplierId, {
      title: title.trim(), description: description.trim() || null,
      discountPct: discount ? parseFloat(discount) : null,
      active: true, validFrom: new Date().toISOString(), validTo: null, productName: null,
    });
    setTitle(''); setDescription(''); setDiscount(''); setAdding(false);
    await load();
  }, [supplierId, title, description, discount, load]);

  return (
    <View style={{ flex: 1, backgroundColor: themeColours.background, padding: 16 }}>
      <TouchableOpacity onPress={() => setAdding(a => !a)}
        style={{ backgroundColor: themeColours.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: '#fff', fontWeight: '900' }}>{adding ? 'Cancel' : '+ Add special or promotion'}</Text>
      </TouchableOpacity>

      {adding && (
        <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 14, gap: 10, marginBottom: 12, borderWidth: 1, borderColor: themeColours.border }}>
          <TextInput value={title} onChangeText={setTitle} placeholder="Title (e.g. 20% off chicken this week)"
            style={{ backgroundColor: themeColours.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColours.border, color: themeColours.text }} />
          <TextInput value={description} onChangeText={setDescription} placeholder="Description (optional)" multiline
            style={{ backgroundColor: themeColours.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColours.border, color: themeColours.text, minHeight: 60 }} />
          <TextInput value={discount} onChangeText={setDiscount} placeholder="Discount % (optional)" keyboardType="numeric"
            style={{ backgroundColor: themeColours.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: themeColours.border, color: themeColours.text }} />
          <TouchableOpacity onPress={onAdd} style={{ backgroundColor: themeColours.success, borderRadius: 10, padding: 14, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '900' }}>Publish special</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList data={specials} keyExtractor={s => s.id}
        renderItem={({ item }) => (
          <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: item.active ? '#BBF7D0' : themeColours.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '900', color: themeColours.text, flex: 1 }}>{item.title}</Text>
              <TouchableOpacity onPress={() => SupplierPortalService.toggleSpecial(supplierId, item.id, !item.active).then(load)}
                style={{ backgroundColor: item.active ? '#F0FDF4' : '#F9FAFB', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
                <Text style={{ fontWeight: '800', color: item.active ? themeColours.success : themeColours.textSecondary, fontSize: 12 }}>
                  {item.active ? 'Active' : 'Inactive'}
                </Text>
              </TouchableOpacity>
            </View>
            {item.description && <Text style={{ color: themeColours.textSecondary, fontSize: 13, marginTop: 4 }}>{item.description}</Text>}
            {item.discountPct && <Text style={{ color: themeColours.success, fontWeight: '700', marginTop: 4 }}>🏷️ {item.discountPct}% off</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: themeColours.textSecondary, marginTop: 60 }}>No specials yet — add one above</Text>}
      />
    </View>
  );
}
export default withErrorBoundary(SupplierSpecialsScreen, 'SupplierSpecials');
