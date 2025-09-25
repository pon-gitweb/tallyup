export function areaCardStyle(area: any) {
  const base = { padding:14, borderRadius:10, borderWidth:1, marginBottom:12, alignItems:'center' as const };
  if (area?.completedAt) return { ...base, borderColor: '#55efc4', backgroundColor: '#eafff6' }; // green-ish
  if (area?.startedAt && !area?.completedAt) return { ...base, borderColor: '#ffeaa7', backgroundColor: '#fff8e1' }; // amber-ish
  return { ...base, borderColor: '#ddd' };
}
