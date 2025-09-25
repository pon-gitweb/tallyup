/**
 * DEV safety: stops crashes from bare identifiers like `vented` in Firestore paths.
 * We STILL replace sources below, this is just to keep the app running meanwhile.
 */
export {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis as any;
const alias = (k: string, v: string) => {
  if (!Object.prototype.hasOwnProperty.call(g, k)) {
    Object.defineProperty(g, k, { value: v, configurable: true, writable: false });
  }
};
// canonical + common typos -> 'venues'
alias('venues', 'venues');
alias('venue', 'venues');
alias('vented', 'venues');
alias('venuse', 'venues');
alias('ven', 'venues');
