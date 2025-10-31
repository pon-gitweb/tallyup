// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import ManualReceiveScreen from './ManualReceiveScreen';
import GenericCsvProcessorScreen from './GenericCsvProcessorScreen';
import PdfReceiveScreen from './PdfReceiveScreen';
import ScanReceiveScreen from './ScanReceiveScreen';

type Tab = 'Manual'|'CSV'|'PDF'|'Scan';
type Props = {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  venueId: string;
  orderLines?: any[];
  initialTab?: Tab;
};

const tabs: Tab[] = ['Manual','CSV','PDF','Scan'];

export default function ReceiveModal({ visible, onClose, orderId, venueId, orderLines, initialTab='Manual' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => { setTab(initialTab); }, [initialTab, visible]);

  function renderTab() {
    switch (tab) {
      case 'Manual': return <ManualReceiveScreen orderId={orderId} venueId={venueId} orderLines={orderLines} onDone={onClose} embed />;
      case 'CSV':    return <GenericCsvProcessorScreen orderId={orderId} venueId={venueId} orderLines={orderLines} onDone={onClose} embed />;
      case 'PDF':    return <PdfReceiveScreen orderId={orderId} venueId={venueId} orderLines={orderLines} onDone={onClose} embed />;
      case 'Scan':   return <ScanReceiveScreen orderId={orderId} venueId={venueId} orderLines={orderLines} onDone={onClose} embed />;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={styles.header}>
            {tabs.map(t => (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab===t && styles.tabActive]}>
                <Text style={styles.tabText}>{t}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={onClose} style={styles.close}><Text>✕</Text></TouchableOpacity>
          </View>
          <View style={styles.body}>{renderTab()}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap:{flex:1,backgroundColor:'rgba(0,0,0,0.4)',justifyContent:'center',padding:16},
  card:{backgroundColor:'#fff',borderRadius:12,maxHeight:'90%'},
  header:{flexDirection:'row',alignItems:'center',padding:12,borderBottomWidth:1,borderColor:'#eee'},
  tab:{paddingHorizontal:12,paddingVertical:8,borderRadius:8,marginRight:8,backgroundColor:'#f2f2f2'},
  tabActive:{backgroundColor:'#e6f0ff'},
  tabText:{fontWeight:'600'},
  close:{marginLeft:'auto',padding:8},
  body:{padding:12}
});
