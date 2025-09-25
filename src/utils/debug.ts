export const DEBUG_ORDERS = true; // set to false after diagnostics
export const dbg = (feature: string, msg: string, data?: any) => {
  try { console.log(`[${feature}] ${msg}`, data ?? ''); } catch {}
};
