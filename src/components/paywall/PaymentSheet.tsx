// @ts-nocheck
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert
} from 'react-native';
import { Linking } from 'react-native';
import { getAuth } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { createCheckout } from '../../services/payments';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function PaymentSheet({ visible, onClose }: Props){
  const auth = getAuth();
  const uid = auth?.currentUser?.uid || '';
  const venueId = useVenueId();

  const [plan, setPlan] = useState<'monthly'|'yearly'>('monthly');
  const [promoCode, setPromoCode] = useState('');
  const [loading, setLoading] = useState(false);

  const canCheckout = useMemo(()=> !!uid && !!venueId && !loading, [uid, venueId, loading]);

  const onContinue = useCallback(async ()=>{
    if (!uid || !venueId) {
      Alert.alert('Not signed in', 'Please sign in again and try.');
      return;
    }
    try{
      setLoading(true);
      const res = await createCheckout({
        uid,
        venueId,
        plan,
        promoCode: promoCode.trim() || null,
      });

      if (!res?.ok || !res?.checkoutUrl) {
        throw new Error(res?.error || res?.message || 'Checkout unavailable');
      }

      const supported = await Linking.canOpenURL(res.checkoutUrl);
      if (supported) {
        await Linking.openURL(res.checkoutUrl);
      } else {
        Alert.alert('Checkout link', res.checkoutUrl);
      }
      // Keep modal open so user can retry if needed
    }catch(e:any){
      Alert.alert('Could not start checkout', e?.message || 'Please try again.');
    }finally{
      setLoading(false);
    }
  },[uid, venueId, plan, promoCode, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={S.backdrop} onPress={onClose}>
        <Pressable style={S.card} onPress={(e)=>e.stopPropagation()}>
          <Text style={S.title}>Unlock AI Suggested Orders</Text>
          <Text style={S.sub}>
            Try AI-powered purchase planning. Continue with a promo code or proceed to checkout.
          </Text>

          <View style={S.segmentWrap}>
            <TouchableOpacity
              onPress={()=>setPlan('monthly')}
              style={[S.segment, plan==='monthly' && S.segmentActive]}
            >
              <Text style={[S.segmentText, plan==='monthly' && S.segmentTextActive]}>Monthly · $29</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={()=>setPlan('yearly')}
              style={[S.segment, plan==='yearly' && S.segmentActive]}
            >
              <Text style={[S.segmentText, plan==='yearly' && S.segmentTextActive]}>Yearly · $290</Text>
            </TouchableOpacity>
          </View>

          <Text style={S.label}>Promo code (optional)</Text>
          <TextInput
            placeholder="Enter promo code"
            autoCapitalize="characters"
            value={promoCode}
            onChangeText={setPromoCode}
            style={S.input}
          />

          <View style={S.actions}>
            <TouchableOpacity onPress={onClose} style={[S.btn, S.btnGhost]} disabled={loading}>
              <Text style={[S.btnText, S.btnGhostText]}>Not now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onContinue}
              style={[S.btn, canCheckout ? S.btnPrimary : S.btnDisabled]}
              disabled={!canCheckout}
            >
              {loading ? <ActivityIndicator/> : <Text style={S.btnText}>Continue to checkout</Text>}
            </TouchableOpacity>
          </View>

          <Text style={S.footerNote}>
            You’ll complete payment on a secure page. Promo discounts apply at checkout.
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop:{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', justifyContent:'center', padding:24 },
  card:{ backgroundColor:'#fff', borderRadius:14, padding:16 },
  title:{ fontSize:18, fontWeight:'800', marginBottom:4 },
  sub:{ fontSize:13, color:'#6b7280', marginBottom:12 },
  segmentWrap:{ flexDirection:'row', gap:8, marginBottom:12 },
  segment:{ flex:1, borderWidth:1, borderColor:'#e5e7eb', paddingVertical:10, borderRadius:10, alignItems:'center' },
  segmentActive:{ backgroundColor:'#111827', borderColor:'#111827' },
  segmentText:{ fontSize:13, fontWeight:'700', color:'#111827' },
  segmentTextActive:{ color:'#fff' },
  label:{ fontSize:12, fontWeight:'700', color:'#374151', marginBottom:6 },
  input:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, paddingHorizontal:12, paddingVertical:10, fontSize:15, marginBottom:14 },
  actions:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginTop:4, gap:8 },
  btn:{ flex:1, paddingVertical:12, borderRadius:10, alignItems:'center', justifyContent:'center' },
  btnPrimary:{ backgroundColor:'#111827' },
  btnDisabled:{ backgroundColor:'#9CA3AF' },
  btnGhost:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e5e7eb' },
  btnText:{ color:'#fff', fontSize:14, fontWeight:'800' },
  btnGhostText:{ color:'#111827' },
  footerNote:{ marginTop:10, fontSize:11, color:'#6b7280', textAlign:'center' },
});
