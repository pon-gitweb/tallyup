import { toProductItems } from './productSnapshotItems';

/**
 * loadSnapshotItems — reads snapshot items from either the legacy inline array
 * or the itemChunks subcollection (for snapshots with >200 items).
 *
 * The caller supplies fetchChunks so that this module stays free of Firebase
 * SDK imports and works identically in all three codebases (mobile, web-app,
 * functions). The functions copy uses the Admin SDK; the others use the client.
 *
 * @param snapshotData  The raw Firestore document data for the snapshot.
 * @param fetchChunks   Async thunk that returns all chunk docs for this snapshot,
 *                      each shaped as { index: number; items: any[] }.
 */
export async function loadSnapshotItems(
  snapshotData: any,
  fetchChunks: () => Promise<Array<{ index: number; items: any[] }>>,
): Promise<any[]> {
  let items: any[];
  if ((snapshotData.itemChunkCount ?? 0) > 0) {
    const chunks = await fetchChunks();
    items = chunks
      .slice()
      .sort((a, b) => a.index - b.index)
      .flatMap(c => c.items);
  } else {
    items = snapshotData.items ?? [];
  }
  return toProductItems(items, snapshotData.itemsGranularity);
}
