import * as FileSystem from 'expo-file-system';
import { getApp } from 'firebase/app';
import { getStorage, ref, uploadString, getDownloadURL, UploadMetadata } from 'firebase/storage';
type BaseUploadResult = { fullPath: string; downloadURL: string };

async function uploadDataUrl(destPath: string, dataUrl: string, contentType?: string, cacheControl?: string): Promise<BaseUploadResult> {
  if (!destPath) throw new Error('uploadDataUrl: missing destPath');
  if (!dataUrl) throw new Error('uploadDataUrl: missing dataUrl');
  const storage = getStorage(getApp());
  const r = ref(storage, destPath);
  const meta: UploadMetadata = {};
  if (contentType) meta.contentType = contentType;
  if (cacheControl) meta.cacheControl = cacheControl;
  await uploadString(r, dataUrl, 'data_url', meta);
  const downloadURL = await getDownloadURL(r);
  return { fullPath: r.fullPath, downloadURL };
}

export async function uploadFromUri(opts: { fileUri: string; destPath: string; contentType: string; cacheControl?: string; }): Promise<BaseUploadResult> {
  const { fileUri, destPath, contentType, cacheControl } = opts;
  if (!fileUri) throw new Error('uploadFromUri: missing fileUri');
  if (!destPath) throw new Error('uploadFromUri: missing destPath');
  if (!contentType) throw new Error('uploadFromUri: missing contentType');
  const b64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
  const dataUrl = `data:${contentType};base64,${b64}`;
  return uploadDataUrl(destPath, dataUrl, contentType, cacheControl);
}

export async function uploadCsvFromUri(fileUri: string, destPath: string): Promise<BaseUploadResult> {
  return uploadFromUri({ fileUri, destPath, contentType: 'text/csv' });
}
export async function uploadPdfFromUri(fileUri: string, destPath: string): Promise<BaseUploadResult> {
  return uploadFromUri({ fileUri, destPath, contentType: 'application/pdf' });
}

export async function uploadFileAsBase64(opts: { destPath: string; dataUrl?: string; uri?: string; fileUri?: string; contentType?: string; cacheControl?: string; }): Promise<BaseUploadResult> {
  const { destPath, dataUrl, uri, fileUri, contentType, cacheControl } = opts || ({} as any);
  if (dataUrl) return uploadDataUrl(destPath, dataUrl, contentType, cacheControl);
  const chosenUri = fileUri || uri;
  if (!chosenUri) throw new Error('uploadFileAsBase64: missing fileUri');
  let ct = contentType;
  if (!ct) {
    const lower = chosenUri.toLowerCase();
    if (lower.endsWith('.csv')) ct = 'text/csv';
    else if (lower.endsWith('.pdf')) ct = 'application/pdf';
    else ct = 'application/octet-stream';
  }
  return uploadFromUri({ fileUri: chosenUri, destPath, contentType: ct, cacheControl });
}
