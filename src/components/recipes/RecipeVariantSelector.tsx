// @ts-nocheck
import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, SafeAreaView } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type Variant = {
  name: string;
  differentiator?: string;
  estimatedGpPct?: number;
  estimatedSellPrice?: number;
};

type Props = {
  visible: boolean;
  variants: Variant[];
  onSelect: (variant: Variant) => void;
  onCancel: () => void;
};

export default function RecipeVariantSelector({ visible, variants, onSelect, onCancel }: Props) {
  const { theme } = useTheme();
  const c = theme.colours;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.oat }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 15, color: c.deepBlue }}>‹ Back</Text>
            </TouchableOpacity>
            <View style={{ width: 50 }} />
          </View>

          <Text style={{ fontFamily: theme.fontTitle, fontSize: 22, color: c.text, marginBottom: 4 }}>
            ✦ A few options
          </Text>
          <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.textSecondary, marginBottom: 18 }}>
            We found a few ways to make this — pick the one that fits your venue.
          </Text>

          {variants.map((v, idx) => {
            const gp = Number.isFinite(v.estimatedGpPct) ? `${Number(v.estimatedGpPct).toFixed(0)}%` : '—';
            const price = Number.isFinite(v.estimatedSellPrice) ? `$${Number(v.estimatedSellPrice).toFixed(2)}` : '—';
            return (
              <TouchableOpacity
                key={`${v.name}_${idx}`}
                onPress={() => onSelect(v)}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: c.border,
                  padding: 16,
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 16, color: c.text, marginBottom: 4 }}>
                  {v.name}
                </Text>
                {!!v.differentiator && (
                  <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.textSecondary, marginBottom: 10 }}>
                    {v.differentiator}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <View>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid }}>Est. GP</Text>
                    <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: c.success }}>{gp}</Text>
                  </View>
                  <View>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid }}>Est. sell price</Text>
                    <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: c.text }}>{price}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
