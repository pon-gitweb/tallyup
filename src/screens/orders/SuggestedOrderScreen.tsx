import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, ActivityIndicator, ScrollView, View, Text, TouchableOpacity, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import * as orders from '../../services/orders';

// ---------- UI compat helpers (normalize buckets & dedupe aliases) ----------
type SuggestedLine = {
  productId: string;
  qty: number;
  productName?: string | null;
  cost?: number;
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;
};

type CompatBucket = {
  items: Record<string, SuggestedLine>;
  lines: SuggestedLine[];
};

const ALIAS_KEYS = new Set(['__no_supplier__', 'no_supplier', 'none', 'null', 'undefined', '']);

const isLine = (v: any): v is SuggestedLine =>
  v && typeof v === 'object' && 'productId' in v && ('qty' in v || 'quantity' in v);

/** Accepts any bucket-ish shape and returns a {items, lines} compat bucket. */
function toCompatBucket(bucket: any): CompatBucket {
  const b = bucket ?? {};

  // Already normalized
  if (Array.isArray(b.lines)) {
    const items = b.items && typeof b.items === 'object' ? (b.items as Record<string, SuggestedLine>) : {};
    return { items, lines: b.lines as SuggestedLine[] };
  }

  // Derive from items map
  if (b.items && typeof b.items === 'object') {
    const items = b.items as Record<string, SuggestedLine>;
    const lines = Object.values(items).filter(isLine);
    return { items, lines };
  }

  // Legacy: plain object of productId -> line
  const obj = b as Record<string, any>;
  const items: Record<string, SuggestedLine> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (isLine(v)) items[k] = v;
  }
  return { items, lines: Object.values(items) };
}

/** Turn raw suggestions object into unique supplier entries, de-duping by object identity. */
function uniqueSupplierEntries(suggestions: Record<string, any> | null | undefined) {
  const out: Array<[string, CompatBucket]> = [];
  const seen = new Set<any>();
  if (!suggestions || typeof suggestions !== 'object') return out;

  for (const sid of Object.keys(suggestions)) {
    const raw = (suggestions as any)[sid];
    if (!raw || typeof raw !== 'object') continue;
    if (seen.has(raw)) continue;       // alias keys often point to the same object
    seen.add(raw);
    out.push([sid, toCompatBucket(raw)]);
  }
  return out;
}

function supplierLabel(sid: string) {
  if (sid === 'unassigned' || ALIAS_KEYS.has(sid)) return 'Unassigned (no supplier)';
  return `Supplier: ${sid}`;
}
// ---------------------------------------------------------------------------

export default function SuggestedOrderScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [roundToPack, setRoundToPack] = useState(true);
  const [defaultParIfMissing, setDefaultParIfMissing] = useState(6);
  const [suggestions, setSuggestions] = useState<Record<string, any> | null>(null);

  async function load() {
    try {
      setLoading(true);
      console.log('[SuggestedOrders UI] load', { venueId, roundToPack, defaultParIfMissing });
      const res = await (orders as any).buildSuggestedOrdersInMemory?.(venueId, {
        roundToPack,
        defaultParIfMissing,
      });
      setSuggestions(res || {});
    } catch (e: any) {
      console.warn('[SuggestedOrders UI] load error', e?.message || e);
      Alert.alert('Suggested Orders', e?.message || String(e));
      setSuggestions({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  const entries = useMemo(() => uniqueSupplierEntries(suggestions), [suggestions]);
  const totalLines = useMemo(
    () => entries.reduce((sum, [, b]) => sum + (Array.isArray(b.lines) ? b.lines.length : 0), 0),
    [entries]
  );

  useLayoutEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={async () => {
            try {
              if (!suggestions) return;
              if (totalLines === 0) {
                Alert.alert('Suggested Orders', 'No suggestions to create.');
                return;
              }
              // Sanitize a legacy-friendly payload: supplierKey -> { productId: line }
              const payload: Record<string, Record<string, SuggestedLine>> = {};
              const seen = new Set<any>();
              for (const [sid, bucket] of entries) {
                // map alias keys to canonical "unassigned"
                const key = (sid === 'unassigned' || ALIAS_KEYS.has(sid)) ? 'unassigned' : sid;
                // if this underlying bucket is same as a prior alias, skip (we already added it)
                if (seen.has(bucket)) continue;
                seen.add(bucket);

                const out: Record<string, SuggestedLine> = {};
                for (const line of bucket.lines) {
                  out[line.productId] = line;
                }
                if (Object.keys(out).length > 0) payload[key] = out;
              }

              const res = await (orders as any).createDraftsFromSuggestions?.(venueId, payload, {
                createdBy: null,
              });
              console.log('[SuggestedOrders UI] created drafts', res);
              Alert.alert('Suggested Orders', 'Draft orders created.');
              // navigate or refresh
              nav.goBack();
            } catch (e: any) {
              console.warn('[SuggestedOrders UI] create drafts error', e?.message || e);
              Alert.alert('Create Drafts', e?.message || String(e));
            }
          }}
          disabled={loading || totalLines === 0}
          style={{ paddingHorizontal: 12 }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', opacity: loading || totalLines === 0 ? 0.4 : 1 }}>
            Create Drafts
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [nav, loading, totalLines, entries, suggestions, venueId]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, borderBottomWidth: 1, borderColor: '#eee' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginRight: 12 }}>Suggested Orders</Text>
          {loading ? <ActivityIndicator /> : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Text style={{ marginRight: 8 }}>Round to pack</Text>
          <Switch
            value={roundToPack}
            onValueChange={(v) => {
              setRoundToPack(v);
              // reload with new param
              setTimeout(load, 0);
            }}
          />
          <View style={{ width: 16 }} />
          <Text>Fallback par if missing: {defaultParIfMissing}</Text>
        </View>

        <Text style={{ marginTop: 6, color: '#666' }}>
          {totalLines > 0
            ? `Ready to create ${totalLines} suggested lines across ${entries.length} supplier group(s).`
            : 'No suggestions made — check par levels or link products to suppliers.'}
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {entries.map(([sid, bucket]) => {
          const lines = bucket.lines ?? [];
          if (lines.length === 0) return null;

          return (
            <View key={sid} style={{ padding: 12, borderBottomWidth: 1, borderColor: '#f1f1f1' }}>
              <Text style={{ fontWeight: '700', marginBottom: 6 }}>{supplierLabel(sid)}</Text>
              {lines.map((ln) => (
                <View key={ln.productId} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <View style={{ flexShrink: 1, paddingRight: 12 }}>
                    <Text style={{ fontSize: 15 }}>{ln.productName || ln.productId}</Text>
                    {ln.needsPar || ln.needsSupplier ? (
                      <Text style={{ color: '#b26b00', fontSize: 12 }}>
                        {ln.needsPar ? 'No par (defaulted)' : ''}{ln.needsPar && ln.needsSupplier ? ' · ' : ''}
                        {ln.needsSupplier ? 'No supplier' : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ fontWeight: '600' }}>× {ln.qty}</Text>
                </View>
              ))}
            </View>
          );
        })}
        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}
