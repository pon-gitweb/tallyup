/* Global JSX & common shims to calm TS until real impls land */
/// <reference types="react" />

declare module '@testing-library/react-native' {
  export const render: any;
  export const screen: any;
  export const fireEvent: any;
  export const waitFor: any;
}
declare module '@testing-library/jest-native' {
  const matchers: any;
  export = matchers;
}

/* Firebase auth (Expo RN): allow getReactNativePersistence without typing mismatch */
declare module 'firebase/auth' {
  export const getReactNativePersistence: any;
}

/* Services not fully typed yet — loosen to unblock TS */
declare module 'src/services/products' {
  export type Product = any;
  export const listProducts: any;
  export const deleteProductById: any;
  export const createProduct: any;
  export const updateProduct: any;
}
declare module 'src/services/orders' {
  export const createDraftOrderWithLines: any;
  export const getOrderWithLines: any;
  export const calcTotal: any;
  export const markOrderReceived: any;
  export const updateOrderLineQty: any;
  export const deleteOrderLine: any;
  export const updateOrderNotes: any;
  export const receiveOrder: any;
  export const submitOrder: any;
  export const postInvoice: any;
}
declare module 'src/services/venues' {
  export const createJoinAndSeedDevVenue: any;
}

/* Only stub the helper so hooks compile even if it's missing in some branches. */
declare module 'src/context/VenueProvider' {
  export const safeAttach: <T extends (() => void) | undefined>(unsub?: T) => void;
  const _default: any;
  export default _default;
}

/* Reports/variance: extend types to match screen usage (optional props) */
declare global {
  interface VarianceRow { id?: string; [k: string]: any; }
  interface VarianceResult {
    shortage?: VarianceRow[];
    excess?: VarianceRow[];
    excesses?: VarianceRow[];
    totalShortageValue?: number;
    totalExcessValue?: number;
  }
  interface LastCycleSummaryData {
    itemsCounted?: number;
    shortages?: number;
    excesses?: number;
    valueImpact?: number;
    topVariances?: Array<{ id?: string; name?: string; variance?: number }>;
  }
}
export {};
// --- Expo module shims (runtime-safe via dynamic imports) ---
declare module 'expo-file-system' {
  export const cacheDirectory: string | null;
  export const documentDirectory: string | null;
  export enum EncodingType { UTF8 = 'utf8', Base64 = 'base64' }
  export function writeAsStringAsync(
    fileUri: string,
    contents: string,
    opts?: { encoding?: EncodingType }
  ): Promise<void>;
}

declare module 'expo-sharing' {
  export function isAvailableAsync(): Promise<boolean>;
  export function shareAsync(
    url: string,
    opts?: { mimeType?: string; dialogTitle?: string; UTI?: string }
  ): Promise<void>;
}

declare module 'expo-print' {
  export function printToFileAsync(opts: {
    html: string;
    base64?: boolean;
  }): Promise<{ uri: string }>;
}

