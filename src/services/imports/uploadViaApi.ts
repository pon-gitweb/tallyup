import * as FileSystem from 'expo-file-system';
import { getAuth } from 'firebase/auth';

const BASE = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/, '')
  : '';

async function postJson(url: string, body: any) {
  // Attach Firebase ID token so API can verify the caller & venue membership
  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken().catch(()=>null);

  const headers: Record<string,string> = { 'content-type': 'application/json' };
  if (idToken) headers['authorization'] = `Bearer ${idToken}`;

  if (__DEV__) {
    try {
      console.log('[uploadViaApi] POST', url.replace(BASE, ''), { hasToken: !!idToken });
    } catch {}
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
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
