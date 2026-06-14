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
 * Neutral "project" language for shared UI that appears before a venue is
 * created, or in multi-project contexts (e.g. the project list).
 */
const NONE_TRANSLATIONS: Record<string, string> = {
  'venue':              'project',
  'Venue':              'Project',
  'venues':             'projects',
  'Venues':             'Projects',
  'festival':           'project',
  'Festival':           'Project',
  'stocktake':          'stocktake',
  'Stocktake':          'Stocktake',
  'department':         'section',
  'Department':         'Section',
  'Departments':        'Sections',
  'area':               'area',
  'Area':               'Area',
  'session':            'session',
  'Session':            'Session',
  'Create a venue':     'Create a project',
  'My venues':          'My projects',
  'Add venue':          'Add project',
  'No venues yet':      'No projects yet',
  'Your venue':         'Your project',
};

export function getNoneLabel(key: string): string {
  return NONE_TRANSLATIONS[key] ?? key;
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
  if (venueType === 'festival') return getFestivalLabel;
  if (venueType === 'none') return getNoneLabel;
  return (key: string) => key;
}

/**
 * Returns the appropriate label for `key` given a venue type context.
 *
 * 'venue'    → venue-specific language (returns key as-is — venue is the
 *              baseline terminology)
 * 'festival' → festival-specific language
 * 'none'     → neutral "project" language, for shared UI shown before a
 *              venue is created or across multiple projects
 */
export function getProjectLabel(key: string, venueType: 'venue' | 'festival' | 'none'): string {
  if (venueType === 'festival') return getFestivalLabel(key);
  if (venueType === 'none') return getNoneLabel(key);
  return key;
}
