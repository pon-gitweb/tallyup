// @ts-nocheck
/**
 * AppearanceScreen
 * Settings → Appearance
 * User customises colours, uploads logo, picks density.
 * Changes apply instantly across the whole app.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert, Image, ScrollView, Text,
  TouchableOpacity, View, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, PRESET_THEMES, DEFAULT_THEME, ThemeColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

const COLOUR_SWATCHES = [
  '#0F172A', '#1E3A5F', '#14532D', '#7F1D1D',
  '#1C1917', '#0C4A6E', '#4C1D95', '#064E3B',
  '#374151', '#6B21A8', '#9A3412', '#1D4ED8',
];

function ColourSwatch({ colour, selected, onPress }: { colour: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colour,
      borderWidth: selected ? 3 : 0,
      borderColor: '#fff',
      shadowColor: selected ? colour : 'transparent',
      shadowOpacity: 0.6,
      shadowRadius: 4,
      elevation: selected ? 4 : 0,
    }} />
  );
}

function AppearanceScreen() {
  const { theme, updateTheme, updateColours, resetTheme } = useTheme();
  const { colours } = theme;
  const [busy, setBusy] = useState(false);

  const onPickLogo = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setBusy(true);
        await updateTheme({ logoUri: result.assets[0].uri });
        setBusy(false);
      }
    } catch (e) {
      Alert.alert('Could not upload logo', 'Please try again.');
      setBusy(false);
    }
  }, [updateTheme]);

  const onRemoveLogo = useCallback(async () => {
    await updateTheme({ logoUri: null });
  }, [updateTheme]);

  const onPreset = useCallback(async (preset: typeof PRESET_THEMES[0]) => {
    await updateColours({ ...preset.colours } as Partial<ThemeColours>);
  }, [updateColours]);

  const onPrimaryColour = useCallback(async (colour: string) => {
    // Derive a light version automatically
    await updateColours({ primary: colour });
  }, [updateColours]);

  const onReset = useCallback(() => {
    Alert.alert('Reset appearance', 'This will restore the default Hosti-Stock theme.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => { await resetTheme(); } },
    ]);
  }, [resetTheme]);

  const C = colours;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.background }} contentContainerStyle={{ padding: 16, gap: 20 }}>

      {/* Header */}
      <View>
        <Text style={{ fontSize: 22, fontWeight: '900', color: C.text }}>Appearance</Text>
        <Text style={{ color: C.textSecondary, marginTop: 4, fontSize: 14 }}>
          Customise how Hosti-Stock looks for your venue. Changes apply instantly.
        </Text>
      </View>

      {/* Logo */}
      <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border }}>
        <Text style={{ fontWeight: '900', color: C.text, marginBottom: 12 }}>Venue Logo</Text>
        {theme.logoUri ? (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Image
              source={{ uri: theme.logoUri }}
              style={{ width: 200, height: 60, resizeMode: 'contain', borderRadius: 8 }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={onPickLogo}
                style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: C.primaryLight, alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: C.accent }}>Change logo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onRemoveLogo}
                style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: '#FEF2F2', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: C.error }}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={onPickLogo} disabled={busy}
            style={{ borderWidth: 2, borderColor: C.border, borderStyle: 'dashed', borderRadius: 12, padding: 24, alignItems: 'center', gap: 8 }}>
            {busy ? <ActivityIndicator color={C.accent} /> : (
              <>
                <Text style={{ fontSize: 32 }}>🖼️</Text>
                <Text style={{ fontWeight: '800', color: C.accent }}>Upload venue logo</Text>
                <Text style={{ color: C.textSecondary, fontSize: 12, textAlign: 'center' }}>
                  PNG or JPG — appears on dashboard, reports and order emails
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Preset themes */}
      <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border }}>
        <Text style={{ fontWeight: '900', color: C.text, marginBottom: 4 }}>Theme Presets</Text>
        <Text style={{ color: C.textSecondary, fontSize: 13, marginBottom: 12 }}>Pick a colour theme or customise below.</Text>
        <View style={{ gap: 8 }}>
          {PRESET_THEMES.map(preset => (
            <TouchableOpacity key={preset.name} onPress={() => onPreset(preset)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                padding: 12, borderRadius: 12,
                backgroundColor: colours.primary === preset.colours.primary ? C.primaryLight : '#F9FAFB',
                borderWidth: 1,
                borderColor: colours.primary === preset.colours.primary ? C.accent : C.border,
              }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: preset.colours.primary }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', color: C.text }}>{preset.name}</Text>
              </View>
              {colours.primary === preset.colours.primary && (
                <Text style={{ color: C.accent, fontWeight: '900' }}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Primary colour picker */}
      <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border }}>
        <Text style={{ fontWeight: '900', color: C.text, marginBottom: 4 }}>Primary Colour</Text>
        <Text style={{ color: C.textSecondary, fontSize: 13, marginBottom: 12 }}>Used for buttons, headers and key actions.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {COLOUR_SWATCHES.map(colour => (
            <ColourSwatch
              key={colour}
              colour={colour}
              selected={colours.primary === colour}
              onPress={() => onPrimaryColour(colour)}
            />
          ))}
        </View>
        {/* Current colour preview */}
        <View style={{ marginTop: 16, backgroundColor: C.primary, borderRadius: 10, padding: 14, alignItems: 'center' }}>
          <Text style={{ color: C.primaryText, fontWeight: '900' }}>Preview — this is your primary colour</Text>
        </View>
      </View>

      {/* Density */}
      <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border }}>
        <Text style={{ fontWeight: '900', color: C.text, marginBottom: 4 }}>Display Density</Text>
        <Text style={{ color: C.textSecondary, fontSize: 13, marginBottom: 12 }}>How compact or spacious the interface feels.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['compact', 'comfortable', 'spacious'] as const).map(d => (
            <TouchableOpacity key={d} onPress={() => updateTheme({ density: d })}
              style={{
                flex: 1, padding: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: theme.density === d ? C.primary : '#F9FAFB',
                borderWidth: 1, borderColor: theme.density === d ? C.primary : C.border,
              }}>
              <Text style={{ fontWeight: '800', color: theme.density === d ? C.primaryText : C.textSecondary, fontSize: 12, textTransform: 'capitalize' }}>
                {d}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Reset */}
      <TouchableOpacity onPress={onReset} style={{ alignItems: 'center', padding: 12 }}>
        <Text style={{ color: C.textSecondary, fontSize: 13 }}>Reset to default appearance</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(AppearanceScreen, 'Appearance');
