import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Props = { children: React.ReactNode; onReset?: () => void; title?: string };
type State = { hasError: boolean; message?: string };

export default class SafeBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: undefined };

  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: String(err?.message || err) };
  }

  componentDidCatch(error: any, info: any) {
    if (__DEV__) console.log('[SafeBoundary] caught', { error, info });
  }

  render() {
    if (!this.state.hasError) return this.props.children as any;
    return (
      <View style={{ flex: 1, alignItems:'center', justifyContent:'center', padding:16 }}>
        <Text style={{ fontSize:18, fontWeight:'800', marginBottom:6 }}>{this.props.title || 'Something went wrong'}</Text>
        <Text style={{ color:'#6B7280', textAlign:'center', marginBottom:16 }}>{this.state.message || 'An unexpected error occurred.'}</Text>
        <TouchableOpacity onPress={() => this.setState({ hasError:false, message:undefined }, () => this.props.onReset?.())}
          style={{ paddingVertical:10, paddingHorizontal:14, backgroundColor:'#111', borderRadius:10 }}>
          <Text style={{ color:'#fff', fontWeight:'800' }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
