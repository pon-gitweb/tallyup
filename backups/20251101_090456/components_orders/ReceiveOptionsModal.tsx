import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, TextInput, ScrollView } from 'react-native';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCsvSelected: () => Promise<void>;
  onConfirmManual: (quantities: Array<{ productId: string; receivedQty: number }>) => Promise<void>;
  onUploadPdf?: () => Promise<void>;
  onScanOcr?: () => Promise<void>;
  orderLines?: Array<{ id: string; productId?: string; name?: string; qty?: number }>;
};

export default function ReceiveOptionsModal({ 
  visible, 
  onClose, 
  onCsvSelected, 
  onConfirmManual, 
  onUploadPdf, 
  onScanOcr,
  orderLines = [] 
}: Props){
  const [busy, setBusy] = useState(false);
  const [manualQuantities, setManualQuantities] = useState<Record<string, number>>({});
  const [showManualEditor, setShowManualEditor] = useState(false);

  // Initialize quantities when modal opens or lines change
  React.useEffect(() => {
    if (visible && orderLines.length > 0) {
      const initialQuantities: Record<string, number> = {};
      orderLines.forEach(line => {
        initialQuantities[line.id] = line.qty || 0;
      });
      setManualQuantities(initialQuantities);
    }
  }, [visible, orderLines]);

  const run = async (fn?: ()=>Promise<void>) => { 
    if(!fn||busy) return; 
    setBusy(true); 
    try{ await fn(); } 
    finally { setBusy(false); } 
  };

  const handleManualConfirm = async () => {
    const quantities = orderLines.map(line => ({
      productId: line.productId || line.id,
      receivedQty: manualQuantities[line.id] || 0
    }));
    
    await run(() => onConfirmManual(quantities));
  };

  const updateQuantity = (lineId: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setManualQuantities(prev => ({
      ...prev,
      [lineId]: Math.max(0, numValue)
    }));
  };

  if (showManualEditor) {
    return (
      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        <View style={S.backdrop}>
          <View style={[S.card, { maxHeight: '80%' }]}>
            <Text style={S.title}>Edit Received Quantities</Text>
            
            <ScrollView style={{ maxHeight: 400 }}>
              {orderLines.map((line) => (
                <View key={line.id} style={S.quantityRow}>
                  <View style={S.productInfo}>
                    <Text style={S.productName} numberOfLines={1}>
                      {line.name || line.productId || 'Unknown Product'}
                    </Text>
                    <Text style={S.orderedQty}>Ordered: {line.qty || 0}</Text>
                  </View>
                  <View style={S.quantityInputContainer}>
                    <TextInput
                      style={S.quantityInput}
                      value={String(manualQuantities[line.id] || '')}
                      onChangeText={(value) => updateQuantity(line.id, value)}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={S.buttonRow}>
              <TouchableOpacity 
                style={[S.btn, S.secondaryBtn]} 
                onPress={() => setShowManualEditor(false)}
                disabled={busy}
              >
                <Text style={S.secondaryBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[S.btn, S.primaryBtn]} 
                onPress={handleManualConfirm}
                disabled={busy}
              >
                <Text style={S.btnText}>Confirm Receive</Text>
              </TouchableOpacity>
            </View>

            {busy && <View style={{marginTop:12}}><ActivityIndicator /></View>}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.card}>
          <Text style={S.title}>Receive order</Text>
          <TouchableOpacity style={S.btn} onPress={()=>run(onCsvSelected)} disabled={busy}>
            <Text style={S.btnText}>Upload invoice CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btn} onPress={()=>setShowManualEditor(true)} disabled={busy}>
            <Text style={S.btnText}>Confirm manually</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btn} onPress={()=>run(onUploadPdf)} disabled={busy}>
            <Text style={S.btnText}>Upload PDF (stub)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btn} onPress={()=>run(onScanOcr)} disabled={busy}>
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
  btn:{paddingVertical:12,paddingHorizontal:12,borderRadius:10,marginTop:10},
  primaryBtn:{backgroundColor:'#111827'},
  secondaryBtn:{backgroundColor:'#F3F4F6'},
  btnText:{color:'#fff',fontWeight:'800',textAlign:'center'},
  secondaryBtnText:{color:'#111827',fontWeight:'800',textAlign:'center'},
  cancel:{paddingVertical:10,marginTop:12},
  cancelText:{textAlign:'center',fontWeight:'700',color:'#374151'},
  
  // Manual editor styles
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  productInfo: {
    flex: 1,
    marginRight: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  orderedQty: {
    fontSize: 12,
    color: '#6B7280',
  },
  quantityInputContainer: {
    width: 80,
  },
  quantityInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
});
