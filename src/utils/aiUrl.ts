const _AI_FALLBACK = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
export function buildAiUrlSafe(path: string): string {
  const base = (process.env.EXPO_PUBLIC_AI_URL || _AI_FALLBACK).replace(/\/+$/, '');
  const b = path.startsWith('/') ? path : `/${path}`;
  return `${base}${b}`;
}
