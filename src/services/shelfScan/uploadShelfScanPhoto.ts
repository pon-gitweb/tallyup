// @ts-nocheck
// Stub — uploadShelfScanPhoto
export async function uploadShelfScanPhoto({ venueId, uid, scanId, fileUri }: any): Promise<{ url: string }> {
  console.log('[shelfScan] uploadShelfScanPhoto stub', { venueId, scanId });
  return { url: fileUri };
}
