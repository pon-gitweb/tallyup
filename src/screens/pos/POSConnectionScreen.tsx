// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId, useVenue } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { getAdapter, listAdapters } from '../../services/pos/POSRegistry';
import { SquareAdapter } from '../../services/pos/adapters/SquareAdapter';

// Square app credential — placeholder until the developer account is
// registered. The OAuth tile stays inert (shows a stub message instead of
// opening a real authorize URL) while this is a placeholder.
const SQUARE_APP_ID = 'YOUR_SQUARE_APP_ID';

function base64UrlEncode(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2];
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 !== undefined ? b2 >> 4 : 0)];
    result += b2 !== undefined ? chars[((b2 & 15) << 2) | (b3 !== undefined ? b3 >> 6 : 0)] : '';
    result += b3 !== undefined ? chars[b3 & 63] : '';
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_');
}

function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return base64UrlEncode(bytes).slice(0, 128);
}

// PKCE code_challenge = base64url(SHA-256(code_verifier)) — needs a SHA-256
// primitive. expo-crypto is the obvious one but isn't installed yet (flagged
// rather than installed silently, per instruction). Returns null until that's
// resolved; the caller treats null as "not ready" rather than opening a
// broken OAuth URL with a missing/incorrect challenge.
async function generateCodeChallenge(_verifier: string): Promise<string | null> {
  return null;
}

function useManagerAccess(venueId: string | null) {
  const { user } = useVenue();
  const [allowed, setAllowed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!venueId || !user?.uid) { setAllowed(false); setChecked(true); return; }
    let active = true;
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        if (!active) return;
        if (venueSnap.data()?.ownerUid === user.uid) {
          setAllowed(true);
          return;
        }
        const memberSnap = await getDoc(doc(db, 'venues', venueId, 'members', user.uid));
        const role = memberSnap.data()?.role;
        if (active) setAllowed(role === 'manager' || role === 'owner');
      } catch {
        if (active) setAllowed(false);
      } finally {
        if (active) setChecked(true);
      }
    })();
    return () => { active = false; };
  }, [venueId, user?.uid]);

  return { allowed, checked };
}

function formatConnectedAt(value: any): string {
  try {
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    return date.toLocaleDateString('en-NZ');
  } catch {
    return '—';
  }
}

type PosConfig = { adapter: string; connectedAt?: any };

export default function POSConnectionScreen() {
  const venueId = useVenueId();
  const c = useColours();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const { allowed, checked } = useManagerAccess(venueId);

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [squareConnected, setSquareConnected] = useState<boolean | null>(null);

  const adapterKeys = listAdapters();

  // Square's status isn't read from posIntegration/config directly — it goes
  // through a Cloud Function that checks the server-side token (see
  // SquareAdapter.isConnected), so a stale/missing config doc can't show a
  // false "connected" state.
  useEffect(() => {
    if (!venueId || !allowed) return;
    let active = true;
    new SquareAdapter(venueId).isConnected().then(connected => {
      if (active) setSquareConnected(connected);
    });
    return () => { active = false; };
  }, [venueId, allowed]);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, 'venues', venueId, 'posIntegration', 'config'));
      if (snap.exists()) {
        const data = snap.data() as any;
        setConfig({ adapter: data.adapter, connectedAt: data.connectedAt });
        setSelected(data.adapter);
      } else {
        setConfig(null);
        setSelected(null);
      }
    } catch (e: any) {
      showError(e?.message || 'Could not load POS connection');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    if (venueId && allowed) load();
  }, [venueId, allowed, load]);

  // Square has no credentials to type in — connecting means opening Square's
  // OAuth authorize page in the browser. PKCE: code_verifier is generated and
  // stashed locally (keyed by venueId, which doubles as the OAuth `state`),
  // and the callback deep link exchanges it server-side. See RootNavigator's
  // handleSquareCallback for the other half of this flow.
  async function connectSquare() {
    if (!venueId) return;
    setSaving(true);
    try {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      if (!challenge) {
        showInfo('Square connection setup needs one more step on our side before it can go live — check back soon.');
        return;
      }
      await AsyncStorage.setItem(`square_pkce_verifier_${venueId}`, verifier);
      const url = `https://connect.squareup.com/oauth2/authorize` +
        `?client_id=${encodeURIComponent(SQUARE_APP_ID)}` +
        `&scope=ITEMS_READ+MERCHANT_PROFILE_READ` +
        `&session=false` +
        `&state=${encodeURIComponent(venueId)}` +
        `&code_challenge=${encodeURIComponent(challenge)}` +
        `&code_challenge_method=S256`;
      await Linking.openURL(url);
    } catch (e: any) {
      showError(e?.message || 'Could not start Square connection.');
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!venueId || !selected) return;
    if (selected === 'square') {
      await connectSquare();
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(db, 'venues', venueId, 'posIntegration', 'config'), {
        adapter: selected,
        connectedAt: serverTimestamp(),
        credentials: {},
      }, { merge: true });
      showSuccess('POS connection saved');
      await load();
    } catch (e: any) {
      showError(e?.message || 'Could not save POS connection');
    } finally {
      setSaving(false);
    }
  }

  function onDisconnect() {
    confirm({
      title: 'Disconnect POS?',
      message: 'This venue will no longer be linked to a POS system.',
      confirmLabel: 'Disconnect',
      destructive: true,
      onConfirm: async () => {
        if (!venueId) return;
        try {
          await deleteDoc(doc(db, 'venues', venueId, 'posIntegration', 'config'));
          showSuccess('POS disconnected');
          await load();
        } catch (e: any) {
          showError(e?.message || 'Could not disconnect POS');
        }
      },
    });
  }

  if (!checked) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background }}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: c.background, gap: 8 }}>
        <Text style={{ fontSize: 32 }}>🔒</Text>
        <Text style={{ fontWeight: '800', fontSize: 17, color: c.navy }}>Manager access required</Text>
        <Text style={{ color: c.textSecondary, textAlign: 'center' }}>
          POS connection settings are visible to managers and owners.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {modal}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>

        {/* Status */}
        <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: config ? c.success : c.textSecondary }} />
            <Text style={{ fontWeight: '900', color: c.text, fontSize: 16 }}>
              {config ? `Connected — ${getAdapter(config.adapter).name}` : 'No POS connected'}
            </Text>
          </View>
          {config?.connectedAt && (
            <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4 }}>
              Connected: {formatConnectedAt(config.connectedAt)}
            </Text>
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <>
            {/* Tiles */}
            <View style={{ gap: 10 }}>
              {adapterKeys.map(key => {
                const adapter = getAdapter(key);
                const isMock = key === 'mock';
                const isSquare = key === 'square';
                const isSelected = selected === key;

                let badgeBg = c.primaryLight, badgeBorder = c.border, badgeText = c.warning;
                let badgeLabel = 'Coming soon — partnership pending';
                if (isMock) {
                  badgeBg = c.positiveSoft; badgeBorder = c.positiveStrong; badgeText = c.positiveStrong;
                  badgeLabel = 'Test / Demo mode';
                } else if (isSquare) {
                  if (squareConnected) {
                    badgeBg = c.positiveSoft; badgeBorder = c.positiveStrong; badgeText = c.positiveStrong;
                    badgeLabel = 'Connected';
                  } else {
                    badgeBg = c.surface; badgeBorder = c.border; badgeText = c.textSecondary;
                    badgeLabel = squareConnected === null ? 'Checking…' : 'Not connected';
                  }
                }

                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setSelected(key)}
                    activeOpacity={0.8}
                    style={{
                      borderRadius: 14, padding: 14, borderWidth: 2,
                      borderColor: isSelected ? c.primary : c.border,
                      backgroundColor: isSelected ? c.primaryLight : c.surface,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontWeight: '900', fontSize: 15, color: isSelected ? c.primary : c.text, flex: 1 }}>
                        {adapter.name}
                      </Text>
                      <View style={{
                        backgroundColor: badgeBg,
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                        borderWidth: 1, borderColor: badgeBorder,
                      }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: badgeText }}>
                          {badgeLabel}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Credentials placeholder — real adapters only; Square uses OAuth, not typed credentials */}
            {selected && selected !== 'mock' && selected !== 'square' && (
              <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, gap: 8 }}>
                <Text style={{ fontWeight: '700', fontSize: 13, color: c.textSecondary }}>
                  API credentials will be configured here when integration is active
                </Text>
                <TextInput
                  editable={false}
                  value=""
                  style={{
                    borderWidth: 1, borderColor: c.border, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 10, color: c.textSecondary,
                    backgroundColor: c.background,
                  }}
                />
              </View>
            )}

            {/* Save */}
            <TouchableOpacity
              onPress={onSave}
              disabled={!selected || saving}
              style={{
                backgroundColor: selected ? c.primary : c.border,
                borderRadius: 12, padding: 16, alignItems: 'center',
              }}
            >
              {saving
                ? <ActivityIndicator color={c.primaryText} />
                : <Text style={{ color: selected ? c.primaryText : c.textSecondary, fontWeight: '900', fontSize: 16 }}>
                    Save connection
                  </Text>}
            </TouchableOpacity>

            {/* Disconnect */}
            {config && (
              <TouchableOpacity
                onPress={onDisconnect}
                style={{
                  backgroundColor: c.negativeSoft, borderRadius: 12, padding: 16,
                  alignItems: 'center', borderWidth: 1, borderColor: c.border,
                }}
              >
                <Text style={{ fontWeight: '900', color: c.error }}>Disconnect</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
