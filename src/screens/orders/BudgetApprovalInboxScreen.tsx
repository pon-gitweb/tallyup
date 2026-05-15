// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, ScrollView, Text,
  TextInput, TouchableOpacity, View, Modal
} from 'react-native';
import { collection, onSnapshot, orderBy, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import {
  approveBudgetOverride, rejectBudgetOverride, BudgetOverrideRequest
} from '../../services/budgetApprovals';
import { listBudgets, computeBudgetProgress, createBudget, Budget } from '../../services/budgets';
import { listSuppliers } from '../../services/suppliers';
import { useNavigation } from '@react-navigation/native';

type SupplierBudgetRow = {
  budgetId: string;
  supplierId: string | null;
  supplierName: string;
  amount: number;
  spent: number;
  remaining: number;
  pct: number;
};

function BudgetApprovalInboxScreen() {
  const venueId = useVenueId();
  const colours = useColours();
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BudgetOverrideRequest[]>([]);
  const [rejectFor, setRejectFor] = useState<BudgetOverrideRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Supplier budgets section
  const [supplierBudgets, setSupplierBudgets] = useState<SupplierBudgetRow[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(true);
  const [newBudgetOpen, setNewBudgetOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [budgetSupplierId, setBudgetSupplierId] = useState('');
  const [budgetSupplierName, setBudgetSupplierName] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetPeriod, setBudgetPeriod] = useState<'monthly' | 'weekly' | 'quarterly'>('monthly');
  const [savingBudget, setSavingBudget] = useState(false);

  useEffect(() => {
    if (!venueId) { setRows([]); setLoading(false); return; }
    const q = query(
      collection(db, 'venues', venueId, 'sessions'),
      where('type', '==', 'budget-override-request'),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      const out: BudgetOverrideRequest[] = [];
      snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
      setLoading(false);
    }, () => { setRows([]); setLoading(false); });
    return () => unsub();
  }, [venueId]);

  // Load supplier budgets
  useEffect(() => {
    if (!venueId) { setBudgetsLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const budgets = await listBudgets(venueId);
        const withProgress: SupplierBudgetRow[] = [];
        for (const b of budgets) {
          try {
            const prog = await computeBudgetProgress(venueId, b);
            withProgress.push({
              budgetId: b.id!,
              supplierId: b.supplierId || null,
              supplierName: b.supplierId
                ? ((await getDocs(collection(db, 'venues', venueId, 'suppliers'))).docs
                    .find(d => d.id === b.supplierId)?.data()?.name ?? 'Supplier')
                : 'All suppliers',
              amount: b.amount,
              spent: prog.spent,
              remaining: prog.remaining,
              pct: prog.pct,
            });
          } catch {}
        }
        if (!cancelled) setSupplierBudgets(withProgress);
      } catch {}
      finally { if (!cancelled) setBudgetsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  async function handleAddBudget() {
    if (!venueId || !budgetAmount.trim() || !budgetSupplierId) return;
    const amount = parseFloat(budgetAmount);
    if (!isFinite(amount) || amount <= 0) {
      Alert.alert('Invalid amount', 'Enter a valid budget amount.');
      return;
    }
    setSavingBudget(true);
    try {
      const now = new Date();
      const periodDays = budgetPeriod === 'weekly' ? 7 : budgetPeriod === 'quarterly' ? 90 : 30;
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + (budgetPeriod === 'quarterly' ? 3 : budgetPeriod === 'weekly' ? 0 : 1), 0);
      const { isoToTs } = await import('../../services/budgets');
      await createBudget(venueId, {
        amount,
        supplierId: budgetSupplierId || null,
        periodStart: isoToTs(start.toISOString().slice(0, 10)),
        periodEnd: isoToTs(end.toISOString().slice(0, 10)),
        notes: budgetPeriod,
      });
      setNewBudgetOpen(false);
      setBudgetSupplierId('');
      setBudgetSupplierName('');
      setBudgetAmount('');
      // Reload budgets
      setBudgetsLoading(true);
      const budgets = await listBudgets(venueId);
      const withProgress: SupplierBudgetRow[] = [];
      for (const b of budgets) {
        try {
          const prog = await computeBudgetProgress(venueId, b);
          withProgress.push({
            budgetId: b.id!,
            supplierId: b.supplierId || null,
            supplierName: b.supplierId ? budgetSupplierName : 'All suppliers',
            amount: b.amount,
            spent: prog.spent,
            remaining: prog.remaining,
            pct: prog.pct,
          });
        } catch {}
      }
      setSupplierBudgets(withProgress);
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not save budget.');
    } finally {
      setSavingBudget(false);
      setBudgetsLoading(false);
    }
  }

  async function openNewBudget() {
    try {
      const sups = await listSuppliers(venueId);
      setSuppliers(sups.filter((s: any) => !s.isHoldingSupplier && s.name));
    } catch { setSuppliers([]); }
    setNewBudgetOpen(true);
  }

  const onApprove = async (req: BudgetOverrideRequest) => {
    Alert.alert(
      'Approve override?',
      'This will submit the order and exceed the budget by $' + req.overBy.toFixed(2) + '.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve', onPress: async () => {
            try {
              setBusy(true);
              await approveBudgetOverride(venueId, req);
              Alert.alert('Approved', 'Order has been submitted.');
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not approve.');
            } finally { setBusy(false); }
          }
        }
      ]
    );
  };

  const onReject = async () => {
    if (!rejectFor) return;
    try {
      setBusy(true);
      await rejectBudgetOverride(venueId, rejectFor, rejectNote);
      setRejectFor(null);
      setRejectNote('');
      Alert.alert('Rejected', 'Order returned to draft.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not reject.');
    } finally { setBusy(false); }
  };

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {/* Supplier Spend vs Budget section */}
      <View style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>Supplier Budgets</Text>
          <TouchableOpacity
            onPress={openNewBudget}
            style={{ backgroundColor: '#EFF6FF', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 }}
          >
            <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 13 }}>+ Set budget</Text>
          </TouchableOpacity>
        </View>
        {budgetsLoading ? (
          <ActivityIndicator size="small" />
        ) : supplierBudgets.length === 0 ? (
          <View style={{ backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' }}>
            <Text style={{ color: '#64748B', fontSize: 13 }}>No supplier budgets set. Tap "+ Set budget" to add one.</Text>
          </View>
        ) : (
          supplierBudgets.map(row => {
            const barColor = row.pct >= 100 ? '#F87171' : row.pct >= 80 ? '#F59E0B' : '#4ADE80';
            const over = row.spent > row.amount;
            return (
              <View key={row.budgetId} style={{ backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', fontSize: 14, color: '#0F172A' }}>{row.supplierName}</Text>
                  <Text style={{ fontWeight: '600', fontSize: 13, color: '#374151' }}>
                    ${row.amount.toFixed(0)}/period
                  </Text>
                </View>
                <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>
                  This period: ${row.spent.toFixed(0)}
                </Text>
                <View style={{ height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, marginVertical: 6 }}>
                  <View style={{ height: 6, width: `${Math.min(row.pct, 100)}%` as any, backgroundColor: barColor, borderRadius: 3 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  {over ? (
                    <Text style={{ fontSize: 12, color: '#B91C1C', fontWeight: '600' }}>
                      🔴 ${(row.spent - row.amount).toFixed(0)} over — review ordering
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#065f46', fontWeight: '600' }}>
                      ✓ ${row.remaining.toFixed(0)} under budget
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={() => nav.navigate('SupplierSpend', { supplierId: row.supplierId })}
                    style={{ backgroundColor: '#EFF6FF', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 }}
                  >
                    <Text style={{ color: '#1b4f72', fontWeight: '700', fontSize: 12 }}>View spend →</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      <Text style={{ fontSize: 22, fontWeight: '900', marginBottom: 4 }}>Budget Approvals</Text>
      <Text style={{ color: '#6B7280', marginBottom: 16 }}>
        Orders that exceeded budget and need your approval.
      </Text>

      <FlatList
        data={rows}
        keyExtractor={r => r.id}
        scrollEnabled={false}
        ListEmptyComponent={
          <View style={{ paddingTop: 48, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#374151' }}>All clear</Text>
            <Text style={{ color: '#6B7280', marginTop: 4 }}>No pending budget overrides.</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item: req }) => (
          <View style={{
            backgroundColor: '#FEF2F2', borderRadius: 14, padding: 14,
            borderWidth: 1, borderColor: '#FECACA'
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '900', fontSize: 16, color: '#111' }}>
                {req.supplierName || 'Order'}
              </Text>
              <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#B91C1C' }}>Over budget</Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', marginTop: 4, fontSize: 13 }}>
              Requested by: {req.requestedByName || 'Staff member'}
            </Text>
            <View style={{ marginTop: 10, padding: 10, backgroundColor: '#fff', borderRadius: 10, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#6B7280' }}>Order total</Text>
                <Text style={{ fontWeight: '800' }}>${req.orderTotal.toFixed(2)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#6B7280' }}>Budget limit</Text>
                <Text style={{ fontWeight: '800' }}>${req.budgetAmount.toFixed(2)}</Text>
              </View>
              <View style={{ height: 1, backgroundColor: '#F3F4F6', marginVertical: 4 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: '#B91C1C' }}>Over by</Text>
                <Text style={{ fontWeight: '900', color: '#B91C1C' }}>${req.overBy.toFixed(2)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                disabled={busy}
                onPress={() => { setRejectFor(req); setRejectNote(''); }}
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '800', color: '#374151' }}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                onPress={() => onApprove(req)}
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: colours.success, alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '800', color: colours.primaryText }}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Reject modal */}
      <Modal visible={!!rejectFor} transparent animationType="fade" onRequestClose={() => setRejectFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Reject override</Text>
            <Text style={{ color: '#6B7280', marginBottom: 12 }}>
              Order will be returned to draft. Staff member will need to reduce the order or get approval.
            </Text>
            <TextInput
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder="Reason (optional)..."
              style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, marginBottom: 12 }}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setRejectFor(null)}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                onPress={onReject}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: colours.error, alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '800', color: colours.primaryText }}>{busy ? 'Rejecting...' : 'Reject'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* New budget modal */}
      <Modal visible={newBudgetOpen} transparent animationType="slide" onRequestClose={() => setNewBudgetOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '80%' }}>
            <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 12 }}>Set supplier budget</Text>

            <Text style={{ fontWeight: '700', marginBottom: 6 }}>Supplier</Text>
            <ScrollView style={{ maxHeight: 140, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10 }}>
              {suppliers.map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => { setBudgetSupplierId(s.id); setBudgetSupplierName(s.name); }}
                  style={{ padding: 12, backgroundColor: budgetSupplierId === s.id ? '#EFF6FF' : '#fff', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}
                >
                  <Text style={{ fontWeight: budgetSupplierId === s.id ? '700' : '400', color: budgetSupplierId === s.id ? '#1b4f72' : '#0F172A' }}>
                    {budgetSupplierId === s.id ? '✓ ' : ''}{s.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={{ fontWeight: '700', marginBottom: 4 }}>Budget amount ($)</Text>
            <TextInput
              value={budgetAmount}
              onChangeText={setBudgetAmount}
              placeholder="e.g. 3000"
              keyboardType="decimal-pad"
              style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, marginBottom: 12 }}
            />

            <Text style={{ fontWeight: '700', marginBottom: 6 }}>Period</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {(['weekly', 'monthly', 'quarterly'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setBudgetPeriod(p)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: budgetPeriod === p ? '#1b4f72' : '#F1F5F9' }}
                >
                  <Text style={{ fontWeight: '700', fontSize: 12, color: budgetPeriod === p ? '#fff' : '#374151', textTransform: 'capitalize' }}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setNewBudgetOpen(false)}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={savingBudget || !budgetSupplierId || !budgetAmount.trim()}
                onPress={handleAddBudget}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#1b4f72', alignItems: 'center', opacity: (!budgetSupplierId || !budgetAmount.trim()) ? 0.5 : 1 }}
              >
                <Text style={{ fontWeight: '800', color: '#fff' }}>{savingBudget ? 'Saving…' : 'Save budget'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

export default withErrorBoundary(BudgetApprovalInboxScreen, 'BudgetApprovalInbox');
