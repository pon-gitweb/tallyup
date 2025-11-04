import * as FileSystem from 'expo-file-system';

const BASE = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/, '')
  : '';

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

export async function uploadUriViaApi(opts: { fileUri: string; destPath: string; contentType: string; cacheControl?: string }) {
  const { fileUri, destPath, contentType, cacheControl } = opts;
  if (!BASE) throw new Error('Missing EXPO_PUBLIC_AI_URL');
  if (!fileUri) throw new Error('uploadUriViaApi: missing fileUri');
  if (!destPath) throw new Error('uploadUriViaApi: missing destPath');
  if (!contentType) throw new Error('uploadUriViaApi: missing contentType');

  const b64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
  const dataUrl = `data:${contentType};base64,${b64}`;

  // Try ${BASE}/upload-file first; on 404 fall back to ${BASE}/api/upload-file.
  const primary = `${BASE}/upload-file`;
  const fallback = `${BASE}/api/upload-file`;

  let res = await postJson(primary, { destPath, dataUrl, cacheControl });
  if (res.status === 404) {
    if (__DEV__) console.log('[uploadViaApi] primary 404, trying fallback', fallback);
    res = await postJson(fallback, { destPath, dataUrl, cacheControl });
  }

  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`upload-file failed ${res.status} ${txt}`);
  }
  return res.json(); // { ok:true, fullPath, downloadURL }
}
