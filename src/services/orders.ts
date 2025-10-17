// @ts-nocheck
/** Minimal, accurate barrel for orders services (Expo-safe). */

/* Draft creation (header + /lines subcollection) */
export { createDraftOrderWithLines } from './orders/create'; // if your file is src/services/orders/create.ts
export { createDraftsFromSuggestions } from './orders/createDraftsFromSuggestions';

/* Product smart updates used by Suggested Orders (supplier/PAR) */
export { setParSmart, setSupplierSmart } from './orders/manage';

/* Optional aliases for older call sites */
export { setSupplierSmart as setSupplierOnProduct } from './orders/manage';
