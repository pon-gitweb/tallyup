// @ts-nocheck
import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ReceiveOptionsModal({
  visible,
  onClose,
  orderId,
  orderLines = [],
  onCsvSelected,
  onManualSelected,
  onPdfSelected, // accepts callback from parent
}: {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  orderLines: any[];
  onCsvSelected?: () => void;
  onManualSelected?: () => void;
  onPdfSelected?: () => void;
}) {
  const Item = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.btn} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Receive order</Text>
          <Text style={styles.sub}>PO: {orderId || '-'}</Text>

          <Item label="Upload invoice CSV" onPress={() => { onClose(); onCsvSelected?.(); }} />
          <Item label="Confirm manually"  onPress={() => { onClose(); onManualSelected?.(); }} />
          <Item label="Upload PDF"        onPress={() => { onClose(); onPdfSelected?.(); }} />
          <Item label="Scan / OCR (stub)" onPress={() => { onClose(); console.log('[Receive] OCR stub'); }} />

          <TouchableOpacity onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', alignItems:'center', justifyContent:'flex-end' },
  sheet: { width:'100%', backgroundColor:'#fff', borderTopLeftRadius:16, borderTopRightRadius:16, padding:16, paddingBottom:28 },
  title: { fontSize:18, fontWeight:'700', marginBottom:4 },
  sub: { color:'#666', marginBottom:12 },
  btn: { backgroundColor:'#111', paddingVertical:12, borderRadius:10, marginBottom:10, alignItems:'center' },
  btnText: { color:'#fff', fontWeight:'600' },
  close: { alignSelf:'center', marginTop:8, padding:8 },
  closeText: { color:'#333' },
});
