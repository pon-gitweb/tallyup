import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';

type State = { error?: any; info?: any };

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = {};

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, info: any) {
    console.error('[ErrorBoundary] componentDidCatch error:', error);
    console.error('[ErrorBoundary] componentDidCatch info:', info);
    this.setState({ error, info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children as any;

    const details = String(error?.stack || error?.message || error) +
      (info?.componentStack ? `\n\nComponent stack:\n${info.componentStack}` : '');

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <ScrollView style={styles.box} contentContainerStyle={{ padding: 12 }}>
          <Text style={styles.mono}>{details}</Text>
        </ScrollView>
        <TouchableOpacity style={styles.btn} onPress={() => this.setState({ error: undefined, info: undefined })}>
          <Text style={styles.btnText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  box: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa' },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any, fontSize: 12, color: '#333' },
  btn: { marginTop: 12, backgroundColor: '#0a7', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
