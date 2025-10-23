// @ts-nocheck
import React from 'react';
import { Modal, View, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import EditProductScreen from '../../screens/setup/EditProductScreen';

type Props = {
  visible: boolean;
  onClose: () => void;
  productId: string | null;
  product?: any;
};

export default function InlineEditProductModal({ visible, onClose, productId, product }: Props) {
  // Minimal navigation/route shims so EditProductScreen can run unchanged.
  const navigation = React.useMemo(() => ({
    goBack: onClose,
    navigate: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }), [onClose]);

  const route = React.useMemo(() => ({
    params: { productId, product }
  }), [productId, product]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={S.wrap}>
        <View style={S.sheet}>
          {/* Mount the real, full editor */}
          <EditProductScreen navigation={navigation} route={route} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  sheet: { flex: 1 },
});
