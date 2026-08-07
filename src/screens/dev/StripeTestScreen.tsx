// DEV ONLY — remove this screen and its navigator entry before production
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getAuth } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { db } from '../../services/firebase';
import { createCheckout, fetchEntitlement, openBillingPortal } from '../../services/payments';

const PRICE_ID = 'price_1Tz2GwAJ9PbuJOpgLGTa0ev7';
const RETURN_URL = 'https://tallyup-f1463.web.app/app';

function StripeTestScreen() {
  const venueId = useVenueId();
  const themeColours = useColours();
  const uid = getAuth().currentUser?.uid ?? '';

  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

  const [entitlementResult, setEntitlementResult] = useState<{ ok: boolean; entitled: boolean } | null>(null);
  const [entitlementBusy, setEntitlementBusy] = useState(false);
  const [entitlementErr, setEntitlementErr] = useState<string | null>(null);

  const [portalBusy, setPortalBusy] = useState(false);
  const [portalErr, setPortalErr] = useState<string | null>(null);

  const [subscription, setSubscription] = useState<any>(undefined);

  useEffect(() => {
    if (!venueId) return;
    return onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => setSubscription(snap.data()?.subscription ?? null),
      (err) => console.error('[StripeTest] snapshot error', err),
    );
  }, [venueId]);

  async function handleCheckout() {
    if (!venueId || !uid) return;
    setCheckoutBusy(true);
    setCheckoutErr(null);
    try {
      const result = await createCheckout({
        uid,
        venueId,
        priceId: PRICE_ID,
        successUrl: RETURN_URL,
        cancelUrl: RETURN_URL,
      });
      const url = result.url;
      if (url) {
        await Linking.openURL(url);
      } else {
        setCheckoutErr('No checkout URL returned from server.');
      }
    } catch (e: any) {
      setCheckoutErr(e?.message || 'Checkout failed');
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function handleEntitlement() {
    if (!venueId) return;
    setEntitlementBusy(true);
    setEntitlementErr(null);
    setEntitlementResult(null);
    try {
      setEntitlementResult(await fetchEntitlement(venueId));
    } catch (e: any) {
      setEntitlementErr(e?.message || 'Entitlement check failed');
    } finally {
      setEntitlementBusy(false);
    }
  }

  async function handlePortal() {
    if (!venueId || !uid) return;
    setPortalBusy(true);
    setPortalErr(null);
    try {
      const result = await openBillingPortal({ uid, venueId, returnUrl: RETURN_URL });
      if (result.url) {
        await Linking.openURL(result.url);
      } else {
        setPortalErr('No portal URL returned from server.');
      }
    } catch (e: any) {
      setPortalErr(e?.message || 'Portal URL failed');
    } finally {
      setPortalBusy(false);
    }
  }

  const Err = ({ msg }: { msg: string }) => (
    <Text style={{ color: '#dc2626', fontSize: 13, marginTop: 6, fontWeight: '600' }}>{msg}</Text>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: themeColours.background }}
      contentContainerStyle={{ padding: 16 }}
    >
      {/* DEV banner */}
      <View style={{ backgroundColor: '#FEF08A', borderRadius: 10, padding: 14, marginBottom: 20, borderWidth: 2, borderColor: '#CA8A04' }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#713F12', textAlign: 'center', letterSpacing: 0.5 }}>
          ⚠️  STRIPE SANDBOX TEST — TEMPORARY
        </Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#92400E', textAlign: 'center', marginTop: 4 }}>
          Remove before production. Not visible to real users.
        </Text>
      </View>

      <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 2, fontWeight: '600' }}>
        Venue ID: {venueId ?? '(none)'}
      </Text>
      <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 16, fontWeight: '600' }}>
        UID: {uid || '(not signed in)'}
      </Text>

      {/* Test card hint */}
      <View style={{ backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: '#BFDBFE' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E3A5F', marginBottom: 2 }}>Stripe test card</Text>
        <Text style={{ fontSize: 14, fontFamily: 'monospace', color: '#1E3A5F', letterSpacing: 1 }}>4242 4242 4242 4242</Text>
        <Text style={{ fontSize: 12, color: '#3B82F6', marginTop: 2 }}>Any future expiry · Any CVC · Any postcode</Text>
      </View>

      {/* Button 1: Checkout */}
      <TouchableOpacity
        style={{ backgroundColor: '#1b4f72', padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 4, opacity: checkoutBusy ? 0.6 : 1 }}
        onPress={handleCheckout}
        disabled={checkoutBusy}
      >
        {checkoutBusy
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Start Test Checkout</Text>
        }
      </TouchableOpacity>
      {checkoutErr && <Err msg={checkoutErr} />}

      {/* Button 2: Entitlement */}
      <TouchableOpacity
        style={{ backgroundColor: '#065F46', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12, marginBottom: 4, opacity: entitlementBusy ? 0.6 : 1 }}
        onPress={handleEntitlement}
        disabled={entitlementBusy}
      >
        {entitlementBusy
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Check Entitlement Now</Text>
        }
      </TouchableOpacity>
      {entitlementErr && <Err msg={entitlementErr} />}
      {entitlementResult && (
        <View style={{ backgroundColor: '#F0FDF4', borderRadius: 8, padding: 10, marginTop: 6, borderWidth: 1, borderColor: '#86EFAC' }}>
          <Text style={{ fontSize: 13, fontFamily: 'monospace', color: '#14532D' }}>
            {JSON.stringify(entitlementResult, null, 2)}
          </Text>
        </View>
      )}

      {/* Button 3: Billing portal */}
      <TouchableOpacity
        style={{ backgroundColor: '#6D28D9', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12, marginBottom: 4, opacity: portalBusy ? 0.6 : 1 }}
        onPress={handlePortal}
        disabled={portalBusy}
      >
        {portalBusy
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Open Billing Portal</Text>
        }
      </TouchableOpacity>
      {portalErr && <Err msg={portalErr} />}

      {/* Live subscription snapshot */}
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', marginTop: 24, marginBottom: 8, letterSpacing: 1 }}>
        LIVE: venues/{venueId ?? '…'}.subscription (onSnapshot)
      </Text>
      <View style={{ backgroundColor: '#1E293B', borderRadius: 10, padding: 14, minHeight: 80 }}>
        {subscription === undefined
          ? <ActivityIndicator color="#94A3B8" />
          : <Text style={{ fontSize: 12, fontFamily: 'monospace', color: '#94A3B8' }}>
              {subscription === null
                ? '(no subscription field yet)'
                : JSON.stringify(subscription, null, 2)}
            </Text>
        }
      </View>
    </ScrollView>
  );
}

export default StripeTestScreen;
