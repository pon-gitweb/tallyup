/**
 * Festival label translations.
 * When venueType === 'festival', shared venue terminology maps to festival equivalents.
 *
 * Usage:
 *   const { venueType } = useVenue();
 *   const label = (key: string) =>
 *     venueType === 'festival' ? getFestivalLabel(key) : key;
 */

const FESTIVAL_TRANSLATIONS: Record<string, string> = {
  'Department':         'Bar',
  'Departments':        'Bars',
  'Area':               'Storage location',
  'Areas':              'Storage locations',
  'Stocktake':          'Session count',
  'Stocktakes':         'Session counts',
  'Cycle':              'Session',
  'Cycles':             'Sessions',
  'Add department':     'Add bar',
  'Add area':           'Add storage location',
  'Complete stocktake': 'Submit session count',
  'Start stocktake':    'Start session count',
  'Items':              'Products',
};

export function getFestivalLabel(key: string): string {
  return FESTIVAL_TRANSLATIONS[key] ?? key;
}

/**
 * Returns a label function scoped to the venue type.
 * Pass venueType from useVenue() or useVenueType().
 *
 * Example:
 *   const venueType = useVenueType();
 *   const L = makeLabelFn(venueType);
 *   <Text>{L('Department')}</Text>  →  'Bar' in festival, 'Department' otherwise
 */
export function makeLabelFn(venueType: string | null): (key: string) => string {
  if (venueType !== 'festival') return (key: string) => key;
  return getFestivalLabel;
}
