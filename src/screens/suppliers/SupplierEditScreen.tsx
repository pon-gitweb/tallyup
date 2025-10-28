// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { createSupplier, updateSupplier, Supplier } from '../../services/suppliers';

function isValidHHmm(s: string) {
  if (!s) return true; // allow blank (means none)
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const hh = Number(m[1]); const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export default function SupplierEditScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const venueId = useVenueId();
  const { supplierId, supplier }: { supplierId?: string|null; supplier?: Supplier } = route.params || {};

  const [name, setName] = useState(supplier?.name || '');
  const [email, setEmail] = useState(supplier?.email || '');
  const [phone, setPhone] = useState(supplier?.phone || '');
  const [orderingMethod, setOrderingMethod] = useState<'email'|'portal'|'phone'>(supplier?.orderingMethod || 'email');
  const [portalUrl, setPortalUrl] = useState(supplier?.portalUrl || '');
  const [leadDays, setLeadDays] = useState(String(supplier?.defaultLeadDays ?? ''));
  // NEW:
  const [orderCutoffLocalTime, setOrderCutoffLocalTime] = useState(supplier?.orderCutoffLocalTime || '');
  const [mergeWindowHours, setMergeWindowHours] = useState(
    supplier?.mergeWindowHours != null ? String(supplier.mergeWindowHours) : ''
  );

  const [busy, setBusy] = useState(false);

  async function onSave() {
    if (!venueId) { Alert.alert('No Venue', 'Attach or create a venue first.'); return; }
    if (!name.trim()) { Alert.alert('Name required', 'Enter supplier name.'); return; }
    if (!isValidHHmm(orderCutoffLocalTime)) {
      Alert.alert('Invalid cutoff', 'Use HH:mm in 24-hour format (e.g., 16:00).');
      return;
    }
    const mergeNum = mergeWindowHours.trim() ? Number(mergeWindowHours) : null;
    if (mergeNum != null && !Number.isFinite(mergeNum)) {
      Alert.alert('Invalid merge hours', 'Enter a whole number of hours or leave blank.');
      return;
    }

    setBusy(true);
    try {
      const payload: Supplier = {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        orderingMethod,
        portalUrl: portalUrl.trim() || null,
        defaultLeadDays: leadDays.trim() ? (Number(leadDays) || null) : null,
        orderCutoffLocalTime: orderCutoffLocalTime.trim() || null,
        mergeWindowHours: mergeNum,
      };
      if (supplierId) {
        await updateSupplier(venueId, supplierId, payload);
      } else {
        await createSupplier(venueId, payload);
      }
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{supplierId ? 'Edit Supplier' : 'New Supplier'}</Text>

      <Text style={styles.lbl}>Name</Text>
      <TextInput style={styles.inp} value={name} onChangeText={setName} />

      <Text style={styles.lbl}>Email</Text>
      <TextInput style={styles.inp} value={email} onChangeText={setEmail} keyboardType="email-address" />

      <Text style={styles.lbl}>Phone</Text>
      <TextInput style={styles.inp} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

      <Text style={styles.lbl}>Ordering Method (email | portal | phone)</Text>
      <TextInput style={styles.inp} value={orderingMethod} onChangeText={(t)=>setOrderingMethod((t as any) || 'email')} />

      <Text style={styles.lbl}>Portal URL</Text>
      <TextInput style={styles.inp} value={portalUrl} onChangeText={setPortalUrl} autoCapitalize="none" />

      <Text style={styles.lbl}>Default Lead Days</Text>
      <TextInput style={styles.inp} value={leadDays} onChangeText={setLeadDays} keyboardType="numeric" />

      {/* NEW policy fields */}
      <View style={{ height: 8 }} />
      <Text style={styles.section}>Order Timing Policy (optional)</Text>

      <Text style={styles.lbl}>Order Cutoff (HH:mm, venue local time)</Text>
      <TextInput
        style={styles.inp}
        value={orderCutoffLocalTime}
        onChangeText={setOrderCutoffLocalTime}
        placeholder="e.g. 16:00"
        autoCapitalize="none"
      />

      <Text style={styles.lbl}>Merge Window (hours)</Text>
      <TextInput
        style={styles.inp}
        value={mergeWindowHours}
        onChangeText={setMergeWindowHours}
        placeholder="e.g. 8"
        keyboardType="numeric"
      />

      <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={onSave} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 8, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  section: { fontWeight: '800', marginTop: 12 },
  lbl: { fontWeight: '700', marginTop: 8 },
  inp: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor:'#fff' },
  primary: { marginTop: 12, backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontWeight: '700' },
});
