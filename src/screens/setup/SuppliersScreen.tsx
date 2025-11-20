// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { useVenueId } from '../../context/VenueProvider';
import {
  listSuppliers,
  deleteSupplierById,
  createSupplier,
  updateSupplier,
  Supplier,
} from '../../services/suppliers';
import { runPhotoOcrJob } from '../../services/ocr/photoOcr';
import { pickParseAndUploadProductsCsv } from '../../services/imports/pickAndUploadCsv';

function isValidHHmm(s: string) {
  if (!s) return true; // allow blank (means none)
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export default function SuppliersScreen() {
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Supplier[]>([]);
  const [q, setQ] = useState('');

  // Inline create/edit state
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [orderingMethod, setOrderingMethod] =
    useState<'email' | 'portal' | 'phone'>('email');
  const [portalUrl, setPortalUrl] = useState('');
  const [leadDays, setLeadDays] = useState('2');

  // NEW: timing policy fields (optional)
  const [orderCutoffLocalTime, setOrderCutoffLocalTime] = useState('');
  const [mergeWindowHours, setMergeWindowHours] = useState('');

  const [saving, setSaving] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  async function load() {
    if (!venueId) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await listSuppliers(venueId);
      setRows(data);
    } catch (e: any) {
      console.log('[Suppliers] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [venueId]);

  function openNewForm() {
    setEditingId(null);
    setName('');
    setEmail('');
    setPhone('');
    setOrderingMethod('email');
    setPortalUrl('');
    setLeadDays('2');
    setOrderCutoffLocalTime('');
    setMergeWindowHours('');
    setFormVisible(true);
  }

  function openEditForm(s: Supplier) {
    setEditingId(s.id || null);
    setName(s.name || '');
    setEmail(s.email || '');
    setPhone(s.phone || '');
    setOrderingMethod((s.orderingMethod as any) || 'email');
    setPortalUrl(s.portalUrl || '');

    const ld =
      s.defaultLeadDays != null && !Number.isNaN(Number(s.defaultLeadDays))
        ? String(s.defaultLeadDays)
        : '2';
    setLeadDays(ld);

    setOrderCutoffLocalTime(s.orderCutoffLocalTime || '');
    setMergeWindowHours(
      s.mergeWindowHours != null && !Number.isNaN(Number(s.mergeWindowHours))
        ? String(s.mergeWindowHours)
        : ''
    );

    setFormVisible(true);
  }

  async function onSaveForm() {
    if (!venueId) {
      Alert.alert('No Venue', 'Attach or create a venue first.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name required', 'Enter supplier name.');
      return;
    }
    if (!isValidHHmm(orderCutoffLocalTime)) {
      Alert.alert('Invalid cutoff', 'Use HH:mm in 24-hour format (e.g., 16:00).');
      return;
    }
    const mergeNum = mergeWindowHours.trim() ? Number(mergeWindowHours) : null;
    if (mergeNum != null && !Number.isFinite(mergeNum)) {
      Alert.alert(
        'Invalid merge hours',
        'Enter a whole number of hours or leave blank.'
      );
      return;
    }

    setSaving(true);
    try {
      const payload: Supplier = {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        orderingMethod,
        portalUrl: portalUrl.trim() || null,
        defaultLeadDays: leadDays.trim() ? Number(leadDays) || 2 : 2,
        orderCutoffLocalTime: orderCutoffLocalTime.trim() || null,
        mergeWindowHours: mergeNum,
      };

      if (editingId) {
        await updateSupplier(venueId, editingId, payload);
      } else {
        await createSupplier(venueId, payload);
      }

      setFormVisible(false);
      await load();
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  function onDelete(s: Supplier) {
    Alert.alert('Delete Supplier', `Delete ${s.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (!venueId || !s.id) return;
            await deleteSupplierById(venueId, s.id);
            await load();
          } catch (e: any) {
            Alert.alert('Delete Failed', e?.message || 'Unknown error');
          }
        },
      },
    ]);
  }

  // Photo OCR scan for business card / invoice → prefill supplier fields
  async function scanFromPhoto(kind: 'card' | 'invoice') {
    try {
      if (!venueId) {
        Alert.alert('No Venue', 'Attach or create a venue first.');
        return;
      }

      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (camPerm.status !== 'granted') {
        Alert.alert(
          'Camera permission',
          'Camera access is required to scan a business card or invoice.'
        );
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.6,
      });
      if (res.canceled || !res.assets?.length) return;

      setScanBusy(true);
      const asset = res.assets[0];

      const parsed: any = await runPhotoOcrJob({
        venueId,
        localUri: asset.uri,
      });

      const raw: any = parsed?.raw || parsed?.result || {};
      const supplierName = parsed?.supplierName || raw?.supplierName || '';

      const maybeEmail =
        raw?.supplier?.email ||
        raw?.supplierEmail ||
        raw?.email ||
        null;
      const maybePhone =
        raw?.supplier?.phone ||
        raw?.supplierPhone ||
        raw?.phone ||
        null;
      const maybePortal =
        raw?.supplier?.website ||
        raw?.supplierWebsite ||
        raw?.website ||
        null;

      const filled: string[] = [];

      if (supplierName && !name.trim()) {
        setName(supplierName);
        filled.push('name');
      }
      if (maybeEmail && !email.trim()) {
        setEmail(String(maybeEmail));
        filled.push('email');
      }
      if (maybePhone && !phone.trim()) {
        setPhone(String(maybePhone));
        filled.push('phone');
      }
      if (maybePortal && !portalUrl.trim()) {
        setPortalUrl(String(maybePortal));
        filled.push('portal URL');
      }

      if (filled.length) {
        Alert.alert(
          'Details added',
          `We used the ${kind === 'card' ? 'card' : 'invoice'} to fill: ${filled.join(
            ', '
          )}. You can edit anything before saving.`
        );
      } else {
        Alert.alert(
          'No obvious details',
          'We ran OCR but could not confidently pick out supplier details. You can still fill the form manually.'
        );
      }
    } catch (e: any) {
      Alert.alert('Scan failed', e?.message || 'Unknown error');
    } finally {
      setScanBusy(false);
    }
  }

  // NEW: Upload supplier catalogue via server function (CSV only, no Blob)
  async function uploadSupplierCsv() {
    try {
      if (!venueId) {
        Alert.alert('No Venue', 'Attach or create a venue first.');
        return;
      }
      setUploadBusy(true);

      const res = await pickParseAndUploadProductsCsv(venueId);
      if (res.cancelled) {
        return;
      }

      // We don't yet attach it per-supplier; server stores against venue/catalogue.
      // Later we can extend the function to tag supplierId.
      Alert.alert(
        'Catalogue uploaded',
        'We have uploaded this CSV for this venue. Next, go to Stock Control → Manage Products → Supplier Tools to map items to this supplier.'
      );
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Unknown error');
    } finally {
      setUploadBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((s) => {
      const name = (s.name || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      return (
        name.includes(needle) || email.includes(needle) || phone.includes(needle)
      );
    });
  }, [rows, q]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading suppliers…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Suppliers</Text>

      <Text style={styles.hint}>
        Add suppliers here first. Then go to Stock Control → Manage Products →
        Supplier Tools to attach them to items and keep prices in sync.
      </Text>

      {/* Search + Add */}
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search suppliers (name, email, phone)"
          autoCapitalize="none"
          style={styles.search}
        />
        <TouchableOpacity style={styles.primary} onPress={openNewForm}>
          <Text style={styles.primaryText}>Add Supplier</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id!}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View style={styles.rowCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub}>{item.email || item.phone || '-'}</Text>
              {(item.orderCutoffLocalTime || item.mergeWindowHours != null) && (
                <Text style={styles.policyText}>
                  {item.orderCutoffLocalTime
                    ? `Cutoff: ${item.orderCutoffLocalTime}`
                    : 'Cutoff: —'}
                  {typeof item.mergeWindowHours === 'number'
                    ? ` · Merge: ${item.mergeWindowHours}h`
                    : ''}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => openEditForm(item)}
            >
              <Text style={styles.smallText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallBtn, { backgroundColor: '#FF3B30' }]}
              onPress={() => onDelete(item)}
            >
              <Text style={[styles.smallText, { color: 'white' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text>
            {q.trim()
              ? 'No suppliers match your search.'
              : 'No suppliers yet.'}
          </Text>
        }
      />

      {/* Full-screen create/edit modal */}
      <Modal
        visible={formVisible}
        animationType="slide"
        onRequestClose={() => setFormVisible(false)}
      >
        <View style={styles.formWrap}>
          <Text style={styles.formTitle}>
            {editingId ? 'Edit Supplier' : 'New Supplier'}
          </Text>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.formScroll}
            keyboardShouldPersistTaps="handled"
          >
            {/* Fast add / capture portal */}
            <View style={styles.captureCard}>
              <Text style={styles.captureTitle}>Fast add from photo</Text>
              <Text style={styles.captureHint}>
                Take a photo of a business card or invoice and we’ll auto-fill
                what we can for this supplier.
              </Text>

              <View style={styles.captureRow}>
                <TouchableOpacity
                  style={[styles.capturePill, scanBusy && { opacity: 0.6 }]}
                  disabled={scanBusy}
                  onPress={() => scanFromPhoto('card')}
                >
                  <Text style={styles.capturePillText}>
                    {scanBusy ? 'Scanning…' : 'Scan business card'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.capturePill, scanBusy && { opacity: 0.6 }]}
                  disabled={scanBusy}
                  onPress={() => scanFromPhoto('invoice')}
                >
                  <Text style={styles.capturePillText}>
                    {scanBusy ? 'Scanning…' : 'Scan invoice'}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.capturePill,
                  { alignSelf: 'flex-start', marginTop: 6 },
                  uploadBusy && { opacity: 0.6 },
                ]}
                disabled={uploadBusy}
                onPress={uploadSupplierCsv}
              >
                <Text style={styles.capturePillText}>
                  {uploadBusy ? 'Uploading…' : 'Upload catalogue CSV'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Main details form */}
            <Text style={styles.lbl}>Name</Text>
            <TextInput
              style={styles.inp}
              value={name}
              onChangeText={setName}
              placeholder="Supplier name"
            />

            <Text style={styles.lbl}>Email</Text>
            <TextInput
              style={styles.inp}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              placeholder="email@example.com"
              autoCapitalize="none"
            />

            <Text style={styles.lbl}>Phone</Text>
            <TextInput
              style={styles.inp}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="Phone"
            />

            <Text style={styles.lbl}>Ordering Method (email | portal | phone)</Text>
            <TextInput
              style={styles.inp}
              value={orderingMethod}
              onChangeText={(t) =>
                setOrderingMethod(((t || 'email') as any) || 'email')
              }
              autoCapitalize="none"
              placeholder="email"
            />

            <Text style={styles.lbl}>Portal URL</Text>
            <TextInput
              style={styles.inp}
              value={portalUrl}
              onChangeText={setPortalUrl}
              autoCapitalize="none"
              placeholder="https://portal.example.com"
            />

            <Text style={styles.lbl}>Default Lead Days</Text>
            <TextInput
              style={styles.inp}
              value={leadDays}
              onChangeText={setLeadDays}
              keyboardType="numeric"
              placeholder="2"
            />

            {/* NEW policy fields */}
            <View style={{ height: 4 }} />
            <Text style={styles.section}>Order Timing Policy (optional)</Text>
            <Text style={styles.hintSmall}>
              Use this if the supplier has a daily cutoff (e.g. “orders before
              4pm go on tomorrow’s truck”) or if you want TallyUp to hold and
              merge orders for a few hours.
            </Text>

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

            {/* Next steps card */}
            <View style={styles.toolsCard}>
              <Text style={styles.toolsTitle}>Next steps</Text>
              <Text style={styles.toolsText}>
                After you save, go to Stock Control → Manage Products → Supplier
                Tools to link this supplier to items and keep their price list
                up to date.
              </Text>
              <Text style={styles.toolsTextSmall}>
                Later, we’ll expand this to use uploaded catalogues and scanned
                invoices to keep pricing in sync automatically.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.formActions}>
            <TouchableOpacity
              style={[styles.primary, saving && { opacity: 0.6 }]}
              onPress={onSaveForm}
              disabled={saving}
            >
              <Text style={styles.primaryText}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setFormVisible(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  hint: { fontSize: 12, color: '#6B7280', marginBottom: 10 },
  hintSmall: { fontSize: 11, color: '#6B7280', marginBottom: 4 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D0D3D7',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },

  primary: {
    backgroundColor: '#0A84FF',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryText: { color: 'white', fontWeight: '700' },

  rowCard: {
    backgroundColor: '#EFEFF4',
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: { fontWeight: '700' },
  sub: { opacity: 0.7, marginTop: 2 },
  policyText: { fontSize: 11, color: '#4B5563', marginTop: 2 },

  smallBtn: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallText: { fontWeight: '700' },

  // Full-screen form
  formWrap: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  formTitle: { fontSize: 20, fontWeight: '800', marginBottom: 8 },
  formScroll: {
    paddingBottom: 16,
  },
  lbl: { fontWeight: '700', marginTop: 8 },
  inp: {
    borderWidth: 1,
    borderColor: '#D0D3D7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },

  // Capture portal
  captureCard: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4FF',
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  captureTitle: {
    fontWeight: '800',
    marginBottom: 4,
  },
  captureHint: {
    fontSize: 12,
    color: '#4B5563',
    marginBottom: 6,
  },
  captureRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  capturePill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  capturePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },

  section: { fontSize: 13, fontWeight: '800', marginTop: 12 },
  toolsCard: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  toolsTitle: {
    fontWeight: '800',
    marginBottom: 4,
  },
  toolsText: {
    fontSize: 12,
    color: '#4B5563',
    marginBottom: 4,
  },
  toolsTextSmall: {
    fontSize: 11,
    color: '#6B7280',
  },

  formActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  cancelText: {
    fontWeight: '700',
    color: '#111827',
  },
});
