/**
 * Pure planning function for server-side posProductMappings writes.
 * No Firestore access — all data is passed in. Testable without Firebase mocks.
 */

/**
 * Determine canonical doc id, fields to write, and duplicates to delete.
 * - canonicalId: existing doc with earliest createdAt, or normalised posItemName
 * - fields: merged payload (null → delete all)
 * - deleteIds: duplicate doc ids to remove
 * - existingCreatedAt: caller should use as createdAt (null → server timestamp)
 */
export function planServerMappingWrite(
  existingDocs: Array<{ id: string; data: Record<string, unknown> }>,
  newFieldsOrNull: Record<string, unknown> | null,
  posItemName: string,
): {
  canonicalId: string
  fields: Record<string, unknown> | null
  deleteIds: string[]
  existingCreatedAt: unknown
} {
  const sorted = [...existingDocs].sort((a, b) => {
    const aTs = (a.data.createdAt as any)?.toMillis?.() ?? 0
    const bTs = (b.data.createdAt as any)?.toMillis?.() ?? 0
    return aTs - bTs
  })
  const canonicalId = sorted[0]?.id ?? posItemName.toLowerCase().replace(/\s+/g, '_')

  if (newFieldsOrNull === null) {
    return {
      canonicalId,
      fields: null,
      deleteIds: existingDocs.map(d => d.id),
      existingCreatedAt: null,
    }
  }

  const deleteIds = sorted.slice(1).map(d => d.id)
  const existingData = sorted[0]?.data ?? {}
  const existingCreatedAt = existingData.createdAt ?? null

  const fields: Record<string, unknown> = {
    ...newFieldsOrNull,
    posSystem: existingData.posSystem ?? null,
    posItemName,
    mappingKey: posItemName.toLowerCase(),
  }
  return { canonicalId, fields, deleteIds, existingCreatedAt }
}
