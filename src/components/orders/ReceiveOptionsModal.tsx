// @ts-nocheck
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCsvSelected: () => Promise<void>;
  orderId?: string;
  orderLines?: Array<{ id: string; productId?: string; name?: string; qty?: number }>;
};

export default function ReceiveOptionsModal({ 
  visible, 
  onClose, 
  onCsvSelected, 
  orderId,
  orderLines = [] 
}: Props){
  const [busy, setBusy] = useState(false);
  const navigation = useNavigation();

  const run = async (fn?: ()=>Promise<void>) => { 
    if(!fn||busy) return; 
    setBusy(true); 
    try{ await fn(); } 
    finally { setBusy(false); } 
  };

  const handleManualReceive = () => {
    onClose();
    navigation.navigate('ManualReceive', { 
      orderId,
      orderLines: orderLines.map(line => ({
        id: line.id,
        productId: line.productId,
        name: line.name,
        orderedQty: line.qty || 0
      }))
    });
  };

  const handleCsvUpload = () => {
    onClose();
    navigation.navigate('GenericCsvProcessor', { 
      orderId,
      mode: 'invoice',
      orderLines: orderLines.map(line => ({
        id: line.id,
        productId: line.productId,
        name: line.name,
        orderedQty: line.qty || 0
      }))
    });
  };

  const handlePdfUpload = () => {
    onClose();
    navigation.navigate('PdfReceive', { orderId });
  };

  const handleScanOcr = () => {
    onClose();
    navigation.navigate('ScanReceive', { orderId });
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.card}>
          <Text style={S.title}>Receive order</Text>
          
          <TouchableOpacity style={S.btn} onPress={handleCsvUpload} disabled={busy}>
            <Text style={S.btnText}>Upload invoice CSV</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={S.btn} onPress={handleManualReceive} disabled={busy}>
            <Text style={S.btnText}>Confirm manually</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={S.btn} onPress={handlePdfUpload} disabled={busy}>
            <Text style={S.btnText}>Upload PDF (stub)</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={S.btn} onPress={handleScanOcr} disabled={busy}>
            <Text style={S.btnText}>Scan / OCR (stub)</Text>
          </TouchableOpacity>
          
          {busy ? <View style={{marginTop:12}}><ActivityIndicator /></View> : null}
          
          <TouchableOpacity style={S.cancel} onPress={onClose} disabled={busy}>
            <Text style={S.cancelText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop:{flex:1,backgroundColor:'rgba(0,0,0,0.45)',alignItems:'center',justifyContent:'center'},
  card:{width:'88%',backgroundColor:'#fff',borderRadius:16,padding:16},
  title:{fontSize:18,fontWeight:'800',marginBottom:12},
  btn:{paddingVertical:12,paddingHorizontal:12,borderRadius:10,marginTop:10,backgroundColor:'#111827'},
  btnText:{color:'#fff',fontWeight:'800',textAlign:'center'},
  cancel:{paddingVertical:10,marginTop:12},
  cancelText:{textAlign:'center',fontWeight:'700',color:'#374151'},
});
