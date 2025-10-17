// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet, TextInput, Linking, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { validatePromo, startCheckout } from '../../services/entitlement';

type Props = {
  visible: boolean;
  onClose: ()=>void;

  venueId: string;
  uid: string;

  // Callbacks into screen:
  onEntitled?: (state: { source: 'promo'|'trial'|'subscription'; plan: string; expiresAt?: number|null }) => void;

  // Optional: default plan/interval
  defaultInterval?: 'month'|'year';
};

const price = {
  month: { amount: 29, label: 'NZD / month' },
  year:  { amount: 290, label: 'NZD / year', note: '2 months free' },
};

export default function PaymentSheet(props: Props){
  const [interval, setInterval] = useState<'month'|'year'>(props.defaultInterval || 'month');
  const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string|null>(null);

  const planLabel = useMemo(()=> interval === 'year' ? 'AI+ (Annual)' : 'AI+ (Monthly)', [interval]);
  const amount = price[interval].amount;

  const tryPromo = async ()=>{
    setBusy(true); setError(null);
    try {
      const res = await validatePromo(promo.trim(), props.venueId, props.uid);
      if (res?.entitled) {
        props.onEntitled?.({ source: 'promo', plan: res.plan || 'ai_plus', expiresAt: res.expiresAt });
        props.onClose();
      } else {
        setError('Promo code not valid.');
      }
    } catch (e:any) {
      setError(e?.message || 'Promo code not valid.');
    } finally {
      setBusy(false);
    }
  };

  const goCheckout = async ()=>{
    setBusy(true); setError(null);
    try {
      const session = await startCheckout({ planId: 'ai_plus', interval, venueId: props.venueId, uid: props.uid });
      // Open the (stub) checkout URL — replace with in-app webview later if desired
      const ok = await Linking.openURL(session.sessionUrl);
      if (!ok) throw new Error('Could not open checkout');
      // In a real flow, webhook → entitlement. For demo, we simulate success signal here.
      // You can wire a "Return to app" deep-link later.
    } catch (e:any) {
      setError(e?.message || 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  };

  const Button = ({onPress, children, muted}:{onPress:()=>void; children:any; muted?:boolean})=>(
    <TouchableOpacity onPress={onPress} style={[S.btn, muted? S.btnMuted: null]} disabled={!!busy}>
      <Text style={[S.btnText, muted? S.btnTextMuted: null]}>{children}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={S.back} onPress={props.onClose}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios' ? 'padding' : undefined}>
          <View style={S.card}>

            <Text style={S.title}>Unlock AI Suggested Orders</Text>
            <Text style={S.sub}>Smarter ordering, fewer shortages, lower waste.</Text>

            {/* Interval toggle */}
            <View style={S.toggleWrap}>
              <TouchableOpacity onPress={()=>setInterval('month')} style={[S.toggle, interval==='month'? S.toggleActive: null]}>
                <Text style={[S.toggleText, interval==='month'? S.toggleTextActive: null]}>Monthly</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>setInterval('year')} style={[S.toggle, interval==='year'? S.toggleActive: null]}>
                <Text style={[S.toggleText, interval==='year'? S.toggleTextActive: null]}>Annual</Text>
              </TouchableOpacity>
            </View>

            {/* Plan card */}
            <View style={S.plan}>
              <Text style={S.planTitle}>{planLabel}</Text>
              <Text style={S.planPrice}>${amount} <Text style={S.planNote}>{price[interval].label}</Text></Text>
              {interval==='year' ? <Text style={S.savingNote}>{price.year.note}</Text> : null}
              <View style={S.bullets}>
                <Text style={S.bullet}>• AI-generated supplier buckets</Text>
                <Text style={S.bullet}>• Draft creation & duplicate blocks</Text>
                <Text style={S.bullet}>• Future: stock trends & seasons</Text>
              </View>
              {error ? <Text style={S.error}>{error}</Text> : null}
              {busy ? <ActivityIndicator style={{marginTop:8}}/> : null}
              <Button onPress={goCheckout}>Continue to payment</Button>
              <Button onPress={()=>setPromoOpen(true)} muted>I have a promo code</Button>
            </View>

            {/* Promo inline */}
            {promoOpen && (
              <View style={S.promo}>
                <Text style={S.promoTitle}>Apply promo</Text>
                <TextInput
                  value={promo} onChangeText={setPromo}
                  placeholder="Enter promo code" autoCapitalize="characters"
                  style={S.input}
                />
                <View style={{flexDirection:'row', gap:8, marginTop:8}}>
                  <Button onPress={tryPromo}>Apply</Button>
                  <Button onPress={()=>{ setPromo(''); setPromoOpen(false); }} muted>Cancel</Button>
                </View>
              </View>
            )}

            <Button onPress={props.onClose} muted>Close</Button>
          </View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const S = StyleSheet.create({
  back:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', padding:20 },
  card:{ backgroundColor:'#fff', borderRadius:14, padding:16 },
  title:{ fontSize:18, fontWeight:'800' },
  sub:{ fontSize:13, color:'#6b7280', marginTop:4, marginBottom:12 },

  toggleWrap:{ flexDirection:'row', gap:8 },
  toggle:{ flex:1, paddingVertical:8, borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, alignItems:'center' },
  toggleActive:{ backgroundColor:'#111827', borderColor:'#111827' },
  toggleText:{ fontSize:13, color:'#111827', fontWeight:'700' },
  toggleTextActive:{ color:'#fff' },

  plan:{ marginTop:12, borderWidth:1, borderColor:'#e5e7eb', borderRadius:12, padding:12 },
  planTitle:{ fontSize:16, fontWeight:'800' },
  planPrice:{ fontSize:22, fontWeight:'900', marginTop:4 },
  planNote:{ fontSize:12, color:'#6b7280', fontWeight:'700' },
  savingNote:{ fontSize:12, color:'#059669', marginTop:2, fontWeight:'700' },
  bullets:{ marginTop:8 },
  bullet:{ fontSize:13, color:'#374151', marginTop:2 },
  error:{ color:'#DC2626', marginTop:6, fontSize:12, fontWeight:'700' },

  promo:{ marginTop:12, paddingTop:12, borderTopWidth:1, borderTopColor:'#f3f4f6' },
  promoTitle:{ fontSize:14, fontWeight:'800', marginBottom:6 },

  btn:{ backgroundColor:'#111827', paddingVertical:10, borderRadius:10, alignItems:'center', marginTop:10 },
  btnMuted:{ backgroundColor:'#e5e7eb' },
  btnText:{ color:'#fff', fontWeight:'800' },
  btnTextMuted:{ color:'#111827' },

  input:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, padding:10, fontSize:16, backgroundColor:'#fff' },
});
