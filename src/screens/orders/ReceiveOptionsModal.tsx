// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import ManualReceiveScreen from './receive/ManualReceiveScreen';
import GenericCsvProcessorScreen from './receive/GenericCsvProcessorScreen';
import PdfReceiveScreen from './receive/PdfReceiveScreen';
import ScanReceiveScreen from './receive/ScanReceiveScreen';
import { useVenueId } from '../../context/VenueProvider';

type Tab = 'Manual' | 'CSV' | 'PDF' | 'Scan';
type Props = { visible: boolean; onClose: () => void; orderId: string; orderLines?: any[] };

export default function ReceiveOptionsModal({ visible, onClose, orderId, orderLines }: Props) {
  const venueId = useVenueId?.();
  const [tab, setTab] = useState<Tab>('Manual');
  useEffect(() => { if (visible) setTab('Manual'); }, [visible]);

  const common = { orderId, venueId, orderLines, onDone: onClose, embed: true };
  let Body = null;
  if (tab === 'Manual') Body = <ManualReceiveScreen {...common} />;
  if (tab === 'CSV')    Body = <GenericCsvProcessorScreen {...common} />;
  if (tab === 'PDF')    Body = <PdfReceiveScreen {...common} />;
  if (tab === 'Scan')   Body = <ScanReceiveScreen {...common} />;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={S.backdrop}>
        <View style={S.sheet}>
          <View style={S.header}>
            <Text style={S.title}>Receive options</Text>
            <TouchableOpacity onPress={onClose} style={S.close}><Text style={S.closeTxt}>✕</Text></TouchableOpacity>
          </View>

          <View style={S.tabsRow}>
            {(['Manual','CSV','PDF','Scan'] as Tab[]).map(t => (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={[S.tab, tab===t && S.tabActive]}>
                <Text style={[S.tabTxt, tab===t && S.tabTxtActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={S.body} contentContainerStyle={S.bodyContent}>{Body}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop:{flex:1,backgroundColor:'rgba(0,0,0,0.4)',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#fff',borderTopLeftRadius:16,borderTopRightRadius:16,maxHeight:'92%',...Platform.select({ios:{shadowColor:'#000',shadowOpacity:0.1,shadowRadius:10,shadowOffset:{width:0,height:-2}},android:{elevation:14}})},
  header:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,borderBottomWidth:1,borderColor:'#eee'},
  title:{fontSize:16,fontWeight:'700'},
  close:{marginLeft:'auto',padding:8}, closeTxt:{fontSize:18},
  tabsRow:{flexDirection:'row',padding:12,gap:8},
  tab:{backgroundColor:'#f2f4f7',paddingHorizontal:12,paddingVertical:8,borderRadius:8},
  tabActive:{backgroundColor:'#e6f0ff'},
  tabTxt:{fontWeight:'600',color:'#344054'},
  tabTxtActive:{color:'#1e40af'},
  body:{paddingHorizontal:12}, bodyContent:{paddingBottom:24}
});
