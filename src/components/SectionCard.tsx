import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Props = {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  children?: React.ReactNode;
};

export default function SectionCard({ title, subtitle, onPress, children }: Props) {
  const Content = (
    <View style={{
      backgroundColor: '#fff',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#eaeaea',
      padding: 14,
      marginBottom: 12,
    }}>
      <Text style={{ fontWeight: '700', marginBottom: subtitle ? 4 : 0 }}>{title}</Text>
      {subtitle ? <Text style={{ color: '#666', marginBottom: 8 }}>{subtitle}</Text> : null}
      {children}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        {Content}
      </TouchableOpacity>
    );
  }
  return Content;
}
