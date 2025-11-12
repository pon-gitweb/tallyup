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
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import {
  listSuppliers,
  deleteSupplierById,
  createSupplier,
  updateSupplier,
  Supplier,
} from '../../services/suppliers';

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
  const [orderingMethod, setOrderingMethod] = useState<'email' | 'portal' | 'phone'>('email');
  const [portalUrl, setPortalUrl] = useState('');
  const [leadDays, setLeadDays] = useState('2');
  const [saving, setSaving] = useState(false);

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

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        orderingMethod,
        portalUrl: portalUrl.trim() || null,
        defaultLeadDays: Number(leadDays) || 2,
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((s) => {
      const name = (s.name || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      return name.includes(needle) || email.includes(needle) || phone.includes(needle);
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
            </View>
            <TouchableOpacity style={styles.smallBtn} onPress={() => openEditForm(item)}>
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
          <Text>{q.trim() ? 'No suppliers match your search.' : 'No suppliers yet.'}</Text>
        }
      />

      {/* Inline create/edit modal */}
      <Modal
        visible={formVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setFormVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editingId ? 'Edit Supplier' : 'New Supplier'}
            </Text>

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
              onChangeText={(t) => setOrderingMethod(((t || 'email') as any) || 'email')}
              autoCapitalize="none"
            />

            <Text style={styles.lbl}>Portal URL</Text>
            <TextInput
              style={styles.inp}
              value={portalUrl}
              onChangeText={setPortalUrl}
              autoCapitalize="none"
              placeholder="https://supplier-portal.example.com"
            />

            <Text style={styles.lbl}>Default Lead Days</Text>
            <TextInput
              style={styles.inp}
              value={leadDays}
              onChangeText={setLeadDays}
              keyboardType="numeric"
              placeholder="2"
            />

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.secondaryBtn]}
                onPress={() => setFormVisible(false)}
                disabled={saving}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primary, saving && { opacity: 0.6 }]}
                onPress={onSaveForm}
                disabled={saving}
              >
                <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
    paddingVertical: 12,
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
  smallBtn: { backgroundColor: '#E5E7EB', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  smallText: { fontWeight: '700' },

  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  lbl: { fontWeight: '700', marginTop: 8 },
  inp: {
    borderWidth: 1,
    borderColor: '#D0D3D7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  secondaryText: { fontWeight: '700' },
});
