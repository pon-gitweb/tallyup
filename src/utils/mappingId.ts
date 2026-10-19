/**
 * Shared POS mapping helpers used by the mobile app and web app.
 *
 * normName: strips non-alphanumeric to build a stable lookup key.
 * mappingDocId: deterministic Firestore doc ID for posProductMappings.
 */

export function normName(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
}

export function mappingDocId(posItemName: string, posSystem: string): string {
  return `${normName(posItemName).replace(/\s+/g, '_')}_${posSystem}`.slice(0, 500)
}
