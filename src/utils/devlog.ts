export const dlog   = (...args: any[]) => { if (__DEV__) console.log(...args); };
export const dwarn  = (...args: any[]) => { if (__DEV__) console.warn(...args); };
export const derror = (...args: any[]) => { if (__DEV__) console.error(...args); };
