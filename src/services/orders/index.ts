/** Canonical orders barrel — exports from concrete files. */

/* ---------- Types ---------- */
export type {
  Supplier,
  SuggestedLine,
  SuggestedLegacyMap,
  CreateDraftsOptions,
  CreateDraftsResult,
  OrderStatus,
  OrderSummary,
  OrderLine,
  OrderWithLines,
} from './_types';

/* ---------- Suggestions ---------- */
export { buildSuggestedOrdersInMemory } from './suggest';

/* ---------- Draft creation & mutations ---------- */
export { createDraftOrderWithLines } from './create';
export {
  setParOnProduct,
  setSupplierOnProduct,
} from './updates';

/* ---------- Queries / helpers ---------- */
export { getOrderWithLines, calcTotal } from './queries';

/* ---------- Listing ---------- */
export { listOrders } from './list';

/* ---------- Submit/Receive flows ---------- */
export { submitDraftOrder, receiveOrder, postInvoice } from './submit';
export { markOrderReceived } from './manage';

/* ---------- Suppliers & smart setters ---------- */
export { listSuppliers, setSupplierSmart } from './suppliers';
export { setParSmart } from './par';
