// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';

type Tab = 'Manual' | 'CSV' | 'PDF' | 'Scan';

type Props = {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  orderLines?: any[];

  // Callbacks provided by OrderDetailScreen
  onCsvSelected?: () => void;
  onPdfSelected?: () => void;
  onFileSelected?: () => void;
  onManualSelected?: () => void;
};

export default function ReceiveOptionsModal({
  visible,
  onClose,
  orderId,
  orderLines,
  onCsvSelected,
  onPdfSelected,
  onFileSelected,
  onManualSelected,
}: Props) {
  const [tab, setTab] = useState<Tab>('Manual');
  useEffect(() => {
    if (visible) setTab('Manual');
  }, [visible]);

  function call(cb?: () => void) {
    if (cb) cb();
    onClose?.();
  }

  let Body: React.ReactNode = null;

  if (tab === 'Manual') {
    Body = (
      <View style={S.section}>
        <Text style={S.h}>Manual receive</Text>
        <Text style={S.p}>
          Type in received quantities line by line, add promos or extras, and post the order.
        </Text>
        <TouchableOpacity
          style={S.primary}
          onPress={() => call(onManualSelected)}
        >
          <Text style={S.primaryTxt}>Open Manual Receive</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (tab === 'CSV') {
    Body = (
      <View style={S.section}>
        <Text style={S.h}>CSV invoice</Text>
        <Text style={S.p}>
          Use a CSV export from your supplier. We’ll parse the invoice, match to the order, and
          let you review before posting.
        </Text>
        <TouchableOpacity
          style={S.primary}
          onPress={() => call(onCsvSelected)}
        >
          <Text style={S.primaryTxt}>Pick CSV invoice</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (tab === 'PDF') {
    Body = (
      <View style={S.section}>
        <Text style={S.h}>PDF invoice</Text>
        <Text style={S.p}>
          Upload a PDF invoice. We’ll try to read line items and PO, then ask you to confirm.
        </Text>

        <TouchableOpacity
          style={S.primary}
          onPress={() => call(onPdfSelected)}
        >
          <Text style={S.primaryTxt}>Pick PDF invoice</Text>
        </TouchableOpacity>

        {onFileSelected ? (
          <TouchableOpacity
            style={S.secondary}
            onPress={() => call(onFileSelected)}
          >
            <Text style={S.secondaryTxt}>Smart file picker (PDF / CSV)</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (tab === 'Scan') {
    Body = (
      <View style={S.section}>
        <Text style={S.h}>Scan / camera</Text>
        <Text style={S.p}>
          Scan/OCR receiving is coming soon. For now, use PDF/CSV upload or Manual Receive.
        </Text>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={S.backdrop}>
        <View style={S.sheet}>
          <View style={S.header}>
            <Text style={S.title}>Receive options</Text>
            <TouchableOpacity onPress={onClose} style={S.close}>
              <Text style={S.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={S.tabsRow}>
            {(['Manual', 'CSV', 'PDF', 'Scan'] as Tab[]).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={[S.tab, tab === t && S.tabActive]}
              >
                <Text style={[S.tabTxt, tab === t && S.tabTxtActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={S.body} contentContainerStyle={S.bodyContent}>
            {Body}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: -2 },
      },
      android: { elevation: 14 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  title: { fontSize: 16, fontWeight: '700' },
  close: { marginLeft: 'auto', padding: 8 },
  closeTxt: { fontSize: 18 },
  tabsRow: { flexDirection: 'row', padding: 12, gap: 8 },
  tab: {
    backgroundColor: '#f2f4f7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabActive: { backgroundColor: '#e6f0ff' },
  tabTxt: { fontWeight: '600', color: '#344054' },
  tabTxtActive: { color: '#1e40af' },
  body: { paddingHorizontal: 12 },
  bodyContent: { paddingBottom: 24 },

  section: { paddingVertical: 8, gap: 8 },
  h: { fontSize: 16, fontWeight: '700' },
  p: { fontSize: 13, color: '#4B5563' },

  primary: {
    marginTop: 8,
    backgroundColor: '#111827',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryTxt: { color: '#fff', fontWeight: '700' },

  secondary: {
    marginTop: 8,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryTxt: { color: '#111827', fontWeight: '700' },
});
