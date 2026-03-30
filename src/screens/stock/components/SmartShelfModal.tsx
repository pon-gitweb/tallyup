// @ts-nocheck
// Stub — SmartShelfModal (shelf AI analysis UI — coming soon)
import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
export default function SmartShelfModal({ visible, onClose }: any) {
  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'center', alignItems:'center' }}>
        <View style={{ backgroundColor:'#fff', borderRadius:16, padding:24, margin:24 }}>
          <Text style={{ fontWeight:'900', fontSize:18, marginBottom:8 }}>Smart Shelf Analysis</Text>
          <Text style={{ color:'#6B7280', marginBottom:16 }}>This feature is coming soon. Photo-based shelf counting is in active development.</Text>
          <TouchableOpacity onPress={onClose} style={{ backgroundColor:'#111', padding:14, borderRadius:12, alignItems:'center' }}>
            <Text style={{ color:'#fff', fontWeight:'800' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
