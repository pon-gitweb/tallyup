import * as DocumentPicker from 'expo-document-picker';
import { Alert } from 'react-native';
import { ensureDevMembership } from '../../services/devBootstrap';
import { uploadUriViaApi } from './uploadViaApi';

export async function importProductsPdf(): Promise<{ fullPath: string; downloadURL: string } | null> {
  try {
    const pick = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (!pick || (pick as any).canceled) return null;
    const file = Array.isArray((pick as any).assets) ? (pick as any).assets[0] : (pick as any);
    const uri: string = file.uri || file.file || '';
    const name: string = file.name || 'products.pdf';
    if (!uri) throw new Error('No file uri from DocumentPicker');

    const { venueId } = await ensureDevMembership(); // or get from context if preferred
    const safeName = name.replace(/[^\w\.\-]+/g, '_').slice(0, 80);
    const ts = Date.now();
    const destPath = `uploads/${venueId}/products/imports/${ts}-${safeName}`;

    const out = await uploadUriViaApi({ fileUri: uri, destPath, contentType: 'application/pdf' });
    return out;
  } catch (e: any) {
    console.log('[ImportProductsPDF] failed', e?.message || e);
    Alert.alert('PDF Import', String(e?.message || e));
    return null;
  }
}
