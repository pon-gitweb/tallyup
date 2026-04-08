// @ts-nocheck
/**
 * InventoryImportScreen
 * "Upload your existing stocktake sheet"
 * Accepts PDF, Excel, CSV, Word, or a photo.
 * Claude extracts products, infers structure, returns preview.
 * User confirms → products written to Firestore.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView,
  Text, TouchableOpacity, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { AI_BASE_URL } from '../../config/ai';
import { withErrorBoundary } from '../../components/ErrorCatcher';

export type ExtractedProduct = {
  name: string;
  unit?: string;
  category?: string;
  area?: string;
  department?: string;
  costPrice?: number | null;
  parLevel?: number | null;
  confidence: 'high' | 'medium' | 'low';
};

export type ExtractionResult = {
  products: ExtractedProduct[];
  inferredAreas: string[];
  inferredDepartments: string[];
  hasPricing: boolean;
  hasStructure: boolean;
  summary: string;
  warnings: string[];
};

function FileTypeButton({ icon, label, sublabel, onPress, colours }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={{
      flex: 1, backgroundColor: colours.surface, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: colours.border, alignItems: 'center', gap: 6,
    }}>
      <Text style={{ fontSize: 32 }}>{icon}</Text>
      <Text style={{ fontWeight: '800', color: colours.text, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colours.textSecondary, fontSize: 11, textAlign: 'center' }}>{sublabel}</Text>
    </TouchableOpacity>
  );
}

function InventoryImportScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const colours = useColours();
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  const processFile = useCallback(async (fileUri: string, fileName: string, mimeType: string) => {
    setLoading(true);
    setLoadingMsg('Reading your file...');
    try {
      // Convert file to base64
      const response = await fetch(fileUri);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      setLoadingMsg('Claude is reading your inventory...');

      // Send to Firebase Function
      const resp = await fetch(`${AI_BASE_URL}/api/extract-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, fileBase64: base64, fileName, mimeType }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || 'Could not read your file. Please try a different format.');
      }

      const result: ExtractionResult = await resp.json();
      setLoading(false);

      // Navigate to preview
      nav.navigate('InventoryImportPreview', { result, venueId });

    } catch (e: any) {
      setLoading(false);
      Alert.alert('Could not read file', e?.message || 'Please try again or use a different format.');
    }
  }, [venueId, nav]);

  const onPickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/csv',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await processFile(asset.uri, asset.name, asset.mimeType || 'application/octet-stream');
      }
    } catch (e) {
      Alert.alert('Could not open file picker', 'Please try again.');
    }
  }, [processFile]);

  const onPickPhoto = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (!result.canceled && result.assets[0]) {
        await processFile(result.assets[0].uri, 'stocktake-photo.jpg', 'image/jpeg');
      }
    } catch (e) {
      Alert.alert('Could not open photos', 'Please try again.');
    }
  }, [processFile]);

  const onCamera = useCallback(async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
      if (!result.canceled && result.assets[0]) {
        await processFile(result.assets[0].uri, 'stocktake-photo.jpg', 'image/jpeg');
      }
    } catch (e) {
      Alert.alert('Could not open camera', 'Please try again.');
    }
  }, [processFile]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colours.background, justifyContent: 'center', alignItems: 'center', gap: 20, padding: 40 }}>
        <ActivityIndicator size="large" color={colours.accent} />
        <Text style={{ fontSize: 18, fontWeight: '900', color: colours.text, textAlign: 'center' }}>{loadingMsg}</Text>
        <Text style={{ color: colours.textSecondary, textAlign: 'center', fontSize: 14 }}>
          Claude is reading your inventory and organising it for you. This usually takes 10–30 seconds.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 16, gap: 20 }}>

      {/* Hero */}
      <View style={{ backgroundColor: colours.primary, borderRadius: 16, padding: 24, gap: 8 }}>
        <Text style={{ fontSize: 26, fontWeight: '900', color: '#fff' }}>Import your inventory</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15 }}>
          Upload your existing stocktake sheet and we'll set everything up for you — products, areas, and categories.
        </Text>
      </View>

      {/* What you can upload */}
      <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colours.border }}>
        <Text style={{ fontWeight: '900', color: colours.text, marginBottom: 12, fontSize: 16 }}>What to upload</Text>
        {[
          { icon: '📊', label: 'Excel or CSV', desc: 'Your existing stocktake spreadsheet' },
          { icon: '📄', label: 'PDF', desc: 'A printed stocktake form or report' },
          { icon: '📝', label: 'Word document', desc: 'A stocktake list in Word format' },
          { icon: '📸', label: 'Photo', desc: 'A photo of your handwritten stocktake sheet' },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: i < 3 ? 10 : 0 }}>
            <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            <View>
              <Text style={{ fontWeight: '700', color: colours.text }}>{item.label}</Text>
              <Text style={{ color: colours.textSecondary, fontSize: 12 }}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Upload options */}
      <Text style={{ fontWeight: '900', color: colours.text, fontSize: 16 }}>Choose your file</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <FileTypeButton icon="📁" label="Browse files" sublabel="PDF, Excel, CSV, Word" onPress={onPickDocument} colours={C} />
        <FileTypeButton icon="🖼️" label="Photo library" sublabel="Screenshot or photo" onPress={onPickPhoto} colours={C} />
        <FileTypeButton icon="📷" label="Camera" sublabel="Take a photo now" onPress={onCamera} colours={C} />
      </View>

      {/* What happens next */}
      <View style={{ backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
        <Text style={{ fontWeight: '800', color: '#166534', marginBottom: 8 }}>What happens next</Text>
        {[
          'Claude reads your file and finds all your products',
          'We group them by area or category',
          'You review and confirm — edit anything before importing',
          'Start your first stocktake straight away',
        ].map((step, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: i < 3 ? 6 : 0 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900' }}>{i + 1}</Text>
            </View>
            <Text style={{ color: '#166534', fontSize: 13, flex: 1 }}>{step}</Text>
          </View>
        ))}
      </View>

      {/* No pricing note */}
      <View style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FDE68A' }}>
        <Text style={{ fontWeight: '800', color: '#92400E', marginBottom: 4 }}>No pricing on your sheet?</Text>
        <Text style={{ color: '#92400E', fontSize: 13 }}>
          No problem — we'll import your products without prices. You can add cost prices later when you link your suppliers, or manually as you go.
        </Text>
      </View>

      {/* Skip option */}
      <TouchableOpacity onPress={() => nav.navigate('ProductsCsvImport')}
        style={{ alignItems: 'center', padding: 12 }}>
        <Text style={{ color: colours.textSecondary, fontSize: 13 }}>I'd rather enter products manually →</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(InventoryImportScreen, 'InventoryImport');
