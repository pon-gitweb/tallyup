import * as DocumentPicker from 'expo-document-picker';
import { Alert } from 'react-native';
import { uploadPdfFromUri } from './storageTextUpload';
import { ensureDevMembership } from '../../services/devBootstrap';

/**
 * Pick a PDF and upload it to:
 *   uploads/{venueId}/products/imports/{timestamp}-{name}.pdf
 * Uses the same data_url upload path as Products CSV.
 */
export async function importProductsPdf(): Promise<{ fullPath: string; downloadURL: string } | null> {
  try {
    const pick = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true,
    });
    // Cancelled
    if (!pick || (pick as any).canceled === true) {
      return null;
    }
    // Support old/new SDK shapes
    const file = Array.isArray((pick as any).assets) ? (pick as any).assets[0] : (pick as any);
    const uri: string = file.uri || file.file || '';
    const name: string = file.name || 'products.pdf';
    if (!uri) throw new Error('No file uri from DocumentPicker');

    const { venueId } = await ensureDevMembership();

    const safeName = name.replace(/[^\w\.\-]+/g, '_').slice(0, 80);
    const ts = Date.now();
    const destPath = `uploads/${venueId}/products/imports/${ts}-${safeName}`;

    const res = await uploadPdfFromUri(uri, destPath);
    return res;
  } catch (e: any) {
    console.log('[ImportProductsPDF] failed', e?.message || e);
    Alert.alert('PDF Import', String(e?.message || e));
    return null;
  }
}
