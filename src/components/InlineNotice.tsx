import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function InlineNotice({ tone='warn', children }: { tone?: 'info'|'warn'|'error'; children: React.ReactNode }) {
  const style = tone === 'error' ? styles.error : tone === 'info' ? styles.info : styles.warn;
  const textStyle = tone === 'error' ? styles.errorText : tone === 'info' ? styles.infoText : styles.warnText;
  return (
    <View style={[styles.base, style]}>
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { padding: 10, borderRadius: 10 },
  info: { backgroundColor: '#E7F3FF' },
  infoText: { color: '#003E8A' },
  warn: { backgroundColor: '#FFF4E5' },
  warnText: { color: '#8A5200' },
  error: { backgroundColor: '#FDE8E8' },
  errorText: { color: '#8A1C1C' },
});
