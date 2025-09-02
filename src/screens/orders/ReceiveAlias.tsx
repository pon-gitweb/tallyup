import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRoute } from '@react-navigation/native';

let Impl: any = null;

try { Impl = require('./OrderReceiveScreen').default; } catch {}
try { if (!Impl) Impl = require('./ReceiveOrderScreen').default; } catch {}
try { if (!Impl) Impl = require('./ReceiveScreen').default; } catch {}
try { if (!Impl) Impl = require('./OrderReceive').default; } catch {}

export default function ReceiveAlias(props: any) {
  const route = useRoute<any>();
  const orderId = route?.params?.orderId;

  if (!Impl) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Receive screen not found</Text>
        <Text style={{ textAlign: 'center', opacity: 0.7, marginBottom: 16 }}>
          I looked for: {"OrderReceiveScreen, ReceiveOrderScreen, ReceiveScreen, OrderReceive"}.
          Add one of those files under src/screens/orders/ or tell me the actual file you use.
        </Text>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>orderId: {orderId || '(none passed)'}</Text>
      </View>
    );
  }

  return <Impl {...props} />;
}
