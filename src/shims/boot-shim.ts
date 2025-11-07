declare const global: any;

// ultra-early visibility
try {
  const g: any = globalThis as any;
  const before = { gRequire: typeof g.require, g__r: typeof g.__r, topRequire: typeof (global as any).___top_require__ };
  // If Metro’s loader exists, restore both forms other code might expect.
  if (typeof g.__r === 'function') {
    if (typeof g.require === 'undefined') g.require = g.__r;
    // Create a safe top-level identifier by hanging it off global and referencing it later.
    if (typeof (global as any).___top_require__ === 'undefined') (global as any).___top_require__ = g.__r;
  }
  const after = { gRequire: typeof g.require, g__r: typeof g.__r, topRequire: typeof (global as any).___top_require__ };
  // eslint-disable-next-line no-console
  console.log('[boot-shim] before=', before, 'after=', after);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log('[boot-shim] threw during init', e);
}
