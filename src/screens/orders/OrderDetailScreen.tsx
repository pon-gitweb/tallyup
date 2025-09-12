// @ts-nocheck
import React from 'react';
import { SafeAreaView, View } from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import OrderEditor from 'src/components/orders/OrderEditor';

type ParamList = { OrderDetail: { orderId: string } };

export default function OrderDetailScreen() {
  const route = useRoute<RouteProp<ParamList, 'OrderDetail'>>();
  const nav = useNavigation<any>();
  const orderId = route?.params?.orderId;

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <OrderEditor
          orderId={orderId}
          onSubmitted={() => {
            // After submit, go back to Orders list
            nav.navigate('Orders');
          }}
        />
      </View>
    </SafeAreaView>
  );
}
