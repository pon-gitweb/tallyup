/**
 * Metro used to expose global.require; newer builds don’t always.
 * Some libs expect it. Bridge it to Metro’s __r during app bootstrap.
 */
declare const global: any;
if (typeof global !== 'undefined'
  && typeof global.require === 'undefined'
  && typeof global.__r === 'function') {
  global.require = global.__r;
}
