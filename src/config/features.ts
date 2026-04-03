// @ts-nocheck
/**
 * Feature flags — flip to true to unlock features
 * SUPPLIER_PORTAL: false — set true when ready to launch
 * XERO_INTEGRATION: false — set true when Xero app certified
 * BILLING_ACTIVE: false — set true when Stripe backend ready
 */
export const FEATURES = {
  SUPPLIER_PORTAL: false,
  XERO_INTEGRATION: false,
  BILLING_ACTIVE: false,
} as const;
