export function buildAiUrlSafe(path: string): string {
  const base = process.env.EXPO_PUBLIC_AI_URL || '';
  const a = base.endsWith('/') ? base.slice(0, -1) : base;
  const b = path.startsWith('/') ? path : `/${path}`;
  return `${a}${b}`;
}
