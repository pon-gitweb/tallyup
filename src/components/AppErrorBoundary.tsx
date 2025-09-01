import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, DevSettings } from 'react-native';
import { logError } from '../utils/errors';

type State = { hasError: boolean; detail?: string };

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: any) { return { hasError: true, detail: String(error?.message || error) }; }
  componentDidCatch(error: any, info: any) { logError(error, 'AppErrorBoundary', { componentStack: info?.componentStack }); }
  handleReload = () => { DevSettings.reload(); };
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>The app hit an unexpected error. You can reload and continue. If this keeps happening, please let us know.</Text>
        {this.state.detail ? <Text style={styles.detail}>{this.state.detail}</Text> : null}
        <TouchableOpacity style={styles.btn} onPress={this.handleReload}><Text style={styles.btnText}>Reload App</Text></TouchableOpacity>
      </View>
    );
  }
}
const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20, gap: 12, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  sub: { opacity: 0.8 },
  detail: { fontFamily: 'monospace', fontSize: 12, opacity: 0.7 },
  btn: { backgroundColor: '#0A84FF', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignSelf: 'flex-start' },
  btnText: { color: '#fff', fontWeight: '700' },
});
