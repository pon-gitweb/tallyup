import * as DocumentPicker from 'expo-document-picker';
import { Alert } from 'react-native';
import { uploadUriViaApi } from '../imports/uploadViaApi';
import { ensureDevMembership } from '../devBootstrap';

export async function uploadInvoicePdf(orderId: string): Promise<{ fullPath: string; downloadURL: string } | null> {
  try {
    const pick = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (!pick || (pick as any).canceled) return null;
    const file = Array.isArray((pick as any).assets) ? (pick as any).assets[0] : (pick as any);
    const uri: string = file.uri || file.file || '';
    const name: string = file.name || 'invoice.pdf';
    if (!uri) throw new Error('No file uri from DocumentPicker');

    const { venueId } = await ensureDevMembership(); // or use your context hook
    const safeName = name.replace(/[^\w\.\-]+/g, '_').slice(0, 80);
    const ts = Date.now();
    const destPath = `uploads/${venueId}/invoices/${orderId}/${ts}-${safeName}`;

    return await uploadUriViaApi({ fileUri: uri, destPath, contentType: 'application/pdf' });
  } catch (e: any) {
    console.log('[uploadInvoicePdf] failed', e?.message || e);
    Alert.alert('Invoice PDF', String(e?.message || e));
    return null;
  }
}
