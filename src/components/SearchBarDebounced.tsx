import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, Text, StyleSheet } from 'react-native';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onDebouncedChange: (text: string) => void;
  debounceMs?: number;
  placeholder?: string;
  testID?: string;
};

export default function SearchBarDebounced({
  value,
  onChangeText,
  onDebouncedChange,
  debounceMs = 200,
  placeholder = 'Search…',
  testID,
}: Props) {
  const [local, setLocal] = useState(value);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(() => {
      onDebouncedChange(local);
      setLoading(false);
    }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [local, debounceMs, onDebouncedChange]);

  const clearable = useMemo(() => local.length > 0, [local]);

  return (
    <View style={styles.wrap}>
      <TextInput
        testID={testID || 'search-input'}
        placeholder={placeholder}
        value={local}
        onChangeText={(t) => { setLocal(t); onChangeText(t); }}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        blurOnSubmit={false}
      />
      {loading ? (
        <ActivityIndicator style={styles.icon} />
      ) : clearable ? (
        <TouchableOpacity onPress={() => { setLocal(''); onChangeText(''); onDebouncedChange(''); }}>
          <Text style={styles.clear}>×</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.icon} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff' },
  input: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 16 },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  clear: { fontSize: 24, lineHeight: 24, paddingHorizontal: 4, color: '#888' },
});
