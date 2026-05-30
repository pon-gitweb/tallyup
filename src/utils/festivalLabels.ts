const FESTIVAL_LABELS: Record<string, string> = {
  department: 'Bar',
  departments: 'Bars',
  area: 'Storage location',
  areas: 'Storage locations',
  stocktake: 'Session count',
  stocktakes: 'Session counts',
  cycle: 'Session',
  cycles: 'Sessions',
  'par level': 'Par level',
  'stock control': 'Stock control',
};

export function getLabel(key: string, venueType: string | null | undefined): string {
  if (venueType !== 'festival') return key;
  const lower = key.toLowerCase();
  return FESTIVAL_LABELS[lower] ?? key;
}
