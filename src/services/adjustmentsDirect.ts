/**
 * adjustmentsDirect shim
 * Provides a no-op approveDirectCount for manager inline approvals.
 * Replace with real implementation when available.
 */
export type ApproveArgs = {
  venueId: string;
  departmentId: string;
  areaId: string;
  itemId: string;
};

export async function approveDirectCount(args: ApproveArgs): Promise<{ ok: boolean }> {
  if (__DEV__) console.log('[adjustmentsDirect] approveDirectCount (shim)', args);
  // No-op success
  return { ok: true };
}

export default { approveDirectCount };
