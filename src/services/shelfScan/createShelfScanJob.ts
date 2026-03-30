// @ts-nocheck
// Stub — createShelfScanJob
export async function createShelfScanJob({ venueId, scanId, photoUrl, areaId }: any): Promise<{ jobId: string }> {
  console.log('[shelfScan] createShelfScanJob stub', { venueId, scanId });
  return { jobId: scanId || 'stub-job' };
}
