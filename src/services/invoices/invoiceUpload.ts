// @ts-nocheck
import * as DocumentPicker from 'expo-document-picker';
import { uploadFileAsBase64 } from '../uploads/uploadFileAsBase64';
import { processInvoicesCsv } from './processInvoicesCsv';
import { processInvoicePdf } from '../imports/processInvoicePdf';

type UploadResult = { fullPath: string; downloadURL: string };

async function pickOne(accept: 'csv'|'pdf') {
  const types = accept === 'csv'
    ? ['text/csv', 'application/vnd.ms-excel', 'text/comma-separated-values']
    : ['application/pdf'];
  const res = await DocumentPicker.getDocumentAsync({ multiple: false, type: types });
  if (res.canceled) throw new Error('pick-cancelled');
  const a = res.assets?.[0];
  if (!a?.uri) throw new Error('no-file-uri');
  return { uri: a.uri, name: a.name || (accept === 'csv' ? 'invoice.csv' : 'invoice.pdf') };
}

export async function uploadInvoiceCsv(venueId: string, orderId: string) {
  const { uri, name } = await pickOne('csv');
  // KNOWN-GOOD uploader path (base64 + uploadString('data_url'))
  const { fullPath } = await uploadFileAsBase64({ venueId, orderId, uri, fileName: name });
  return processInvoicesCsv({ venueId, orderId, storagePath: fullPath });
}

export async function uploadInvoicePdf(venueId: string, orderId: string) {
  const { uri, name } = await pickOne('pdf');
  const { fullPath } = await uploadFileAsBase64({ venueId, orderId, uri, fileName: name });
  return processInvoicePdf({ venueId, orderId, storagePath: fullPath });
}
