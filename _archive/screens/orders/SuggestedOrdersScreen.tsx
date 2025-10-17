console.log("[SO Screen] SuggestedOrdersScreen ACTIVE");
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { getAuth } from 'firebase/auth';
import { buildSuggestedOrdersInMemory } from '../../services/orders/suggest';
import { createDraftsFromSuggestions } from '../../services/orders/createDraftsFromSuggestions';
import { runBackfillLinkAndPars } from '../../dev/backfillLinkAndPars';
import { computeSuggestionForItem } from 'src/services/orders/suggestMath';

// Never assume shapes; normalize every bucket
function asBucket(b: any) {
  if (!b || typeof b !== 'object') return { items: {}, lines: [] };
  const items = b.items && typeof b.items === 'object' ? b.items : {};
  const lines = Array.isArray(b.lines) ? b.lines : Object.values(items ?? {});
  return { items, lines };
}

type Props = { route?: { params?: { venueId?: string } } };

// Keys that we treat as "unassigned" (no supplier)
const UNASSIGNED_KEYS = ['unassigned', '__no_supplier__', 'no_supplier', 'none', 'null', 'undefined', ''];

export default function SuggestedOrdersScreen(props: Props) {
  // Dev-only: attach a global probe to call from console (Expo debugger)
  // @ts-ignore
  (globalThis as any).__SO_PROBE__ = require("../../dev/soPermsProbe").probeSuggestedOrdersAccess;
  const auth = getAuth();
  const uid = auth.currentUser?.uid || null;
  const venueId =
    props?.route?.params?.venueId ||
    // @ts-ignore dev helper if present
    (globalThis as any)?.__DEV_VENUE_ID__ ||
    null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, any>>({});

  const load = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      Alert.alert('Suggested Orders', 'Missing venueId.');
      return;
    }
    try {
      setLoading(true);
      const s = await buildSuggestedOrdersInMemory(venueId, {
        roundToPack: true,
        defaultParIfMissing: 6,
      });
      setSuggestions(s || {});
    } catch (e: any) {
      console.warn('[SuggestedOrdersScreen] load error', e?.message || e);
      Alert.alert('Suggested Orders', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const supplierKeys = useMemo(() => {
    const keys = Object.keys(suggestions || {});
    keys.sort((a, b) => {
      const ia = UNASSIGNED_KEYS.indexOf(a), ib = UNASSIGNED_KEYS.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });
    return keys;
  }, [suggestions]);

  const totalLines = useMemo(() => {
    let sum = 0;
    const seen = new Set<any>();
    for (const k of supplierKeys) {
      const b = asBucket((suggestions as any)[k]);
      if (seen.has(b)) continue; // aliases point to same object
      seen.add(b);
      sum += b.lines.length || 0;
    }
    return sum;
  }, [supplierKeys, suggestions]);

  const hasUnassigned = useMemo(() => {
    return supplierKeys.some(k => UNASSIGNED_KEYS.includes(k));
  }, [supplierKeys]);

  // Build a filtered suggestions object that excludes "unassigned" buckets
  const filteredForDrafts = useMemo(() => {
    const out: Record<string, any> = {};
    for (const k of supplierKeys) {
      if (UNASSIGNED_KEYS.includes(k)) continue; // skip per product rule
      const b = asBucket((suggestions as any)[k]);
      if (!b.lines?.length) continue;
      out[k] = b;
    }
    return out;
  }, [supplierKeys, suggestions]);

  async function onCreateDrafts() {
    if (!venueId) return;
    try {
      setBusy(true);

      // Count lines before/after filtering to inform the user about skipped unassigned
      let unassignedCount = 0;
      for (const k of supplierKeys) {
        if (!UNASSIGNED_KEYS.includes(k)) continue;
        const b = asBucket((suggestions as any)[k]);
        unassignedCount += b.lines?.length || 0;
      }

      const res = await createDraftsFromSuggestions(venueId, filteredForDrafts as any, { createdBy: uid });

      const createdCount = Array.isArray(res?.created) ? res.created.length : 0;
      const msg = [
        `${createdCount} draft order(s) created`,
        unassignedCount > 0 ? `• Skipped ${unassignedCount} unassigned line(s)` : null,
      ].filter(Boolean).join('\n');

      Alert.alert('Drafts created', msg || 'Done.');
    } catch (e: any) {
      Alert.alert('Create Drafts', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onBackfill() {
    if (!venueId) return;
    try {
      setBusy(true);
      const res = await runBackfillLinkAndPars(venueId);
      Alert.alert(
        'Backfill complete',
        `Linked: ${res.linkedCount}\nUpdated pars: ${res.parUpdated}\nUnchanged: ${res.unchanged}`
      );
      await load();
    } catch (e: any) {
      Alert.alert('Backfill', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Building suggestions…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1 }}>
      <View style={{ padding:12, borderBottomWidth:1, borderColor:'#eee' }}>
        <Text style={{ fontSize:16, fontWeight:'600' }}>Suggested Orders</Text>
        <Text style={{ color:'#555', marginTop:4 }}>
          {totalLines > 0 ? `${totalLines} line(s) suggested` : 'No suggestions yet'}
        </Text>
        {hasUnassigned ? (
          <View style={{ marginTop:8, backgroundColor:'#FFF7E6', padding:8, borderRadius:6 }}>
            <Text style={{ color:'#8A5A00' }}>
              Some items need attention: no supplier and/or missing par. You can still create drafts,
              but unassigned items won’t be drafted until you assign a supplier.
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection:'row', marginTop:10 }}>
          <TouchableOpacity
            onPress={onCreateDrafts}
            disabled={busy || totalLines === 0}
            style={{ backgroundColor: busy || totalLines === 0 ? '#ddd' : '#000',
                     paddingHorizontal:12, paddingVertical:8, borderRadius:6, marginRight:8 }}>
            <Text style={{ color:'#fff', fontWeight:'600' }}>Create Draft Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onBackfill}
            disabled={busy}
            style={{ backgroundColor: '#4567ee',
                     paddingHorizontal:12, paddingVertical:8, borderRadius:6 }}>
            <Text style={{ color:'#fff', fontWeight:'600' }}>Backfill links + pars</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding:12 }}>
        {supplierKeys.map((k) => {
          const bucket = asBucket((suggestions as any)[k]);
          const lines = bucket.lines || [];
          if (lines.length === 0) return null;

          const isUnassigned = UNASSIGNED_KEYS.includes(k);

          return (
            <View key={k} style={{ marginBottom:14, borderWidth:1, borderColor:'#eee', borderRadius:8 }}>
              <View style={{ padding:10, borderBottomWidth:1, borderColor:'#eee',
                             backgroundColor: isUnassigned ? '#FFF7E6' : '#fafafa' }}>
                <Text style={{ fontWeight:'600' }}>
                  {isUnassigned ? 'Unassigned (link required)' : `Supplier: ${k}`}
                </Text>
                <Text style={{ color:'#666' }}>{lines.length} line(s)</Text>
              </View>

              {lines.map((l: any) => {
                // Derive "smart but pure" meta without changing your stored qty.
                const calc = computeSuggestionForItem({
                  par: typeof l.parLevel === 'number' ? l.parLevel : null,
                  onHand: typeof l.onHand === 'number' ? l.onHand : (typeof l.lastCount === 'number' ? l.lastCount : 0),
                  packSize: typeof l.packSize === 'number' ? l.packSize : null,
                  moq: typeof l.moq === 'number' ? l.moq : null,
                  // If you later load avgDailySales30 or leadTimeDays into line, these will light up automatically:
                  avgDailySales: typeof l.avgDailySales30 === 'number' ? l.avgDailySales30 : null,
                  leadTimeDays: typeof l.leadTimeDays === 'number' ? l.leadTimeDays : null,
                  roundToPack: true,
                });

                return (
                  <View key={l.productId} style={{ padding:10, borderBottomWidth:1, borderColor:'#f2f2f2' }}>
                    <Text style={{ fontWeight:'600' }}>{l.productName || l.productId}</Text>
                    <Text style={{ color:'#444' }}>
                      Qty: {l.qty} @ ${Number(l.cost || 0).toFixed(2)}
                    </Text>

                    {/* Compact “perceived smart” meta line */}
                    {(calc?.applied || calc?.notes?.length || calc?.estDaysToSell != null) ? (
                      <Text style={{ color:'#6B7280', marginTop: 2, fontSize: 12 }}>
                        {calc.applied?.moq ? 'MOQ' : ''}{calc.applied?.moq && (calc.applied?.pack || calc.applied?.leadTime) ? ' · ' : ''}
                        {calc.applied?.pack ? 'Pack' : ''}{calc.applied?.pack && calc.applied?.leadTime ? ' · ' : ''}
                        {calc.applied?.leadTime ? 'Lead' : ''}
                        {calc.estDaysToSell != null ? ` · ~${calc.estDaysToSell} days to sell` : ''}
                        {Array.isArray(calc.notes) && calc.notes.length ? ` · ${calc.notes.join(' · ')}` : ''}
                      </Text>
                    ) : null}

                    {l.needsSupplier ? <Text style={{ color:'#8A5A00' }}>• Needs supplier</Text> : null}
                    {l.needsPar ? <Text style={{ color:'#8A5A00' }}>• Missing par (defaulted)</Text> : null}
                  </View>
                );
              })}
            </View>
          );
        })}

        {totalLines === 0 ? (
          <View style={{ padding:16 }}>
            <Text style={{ color:'#555' }}>
              No suggestions yet. Try “Backfill links + pars” or set pars/suppliers in Products, then refresh.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
