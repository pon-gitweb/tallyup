const fs = require('fs');
const path = 'src/screens/orders/OrderDetailScreen.tsx';
const src = fs.readFileSync(path, 'utf8');

const loadingIdx = src.indexOf('if (loading) return');
if (loadingIdx < 0) { console.log('[fix] No loading early return found. Nothing changed.'); process.exit(0); }

let effStart = src.indexOf('// Auto-accept');
if (effStart < 0) effStart = src.indexOf('// Auto accept');
if (effStart < 0) { console.error('[fix] Auto-accept marker not found. Aborting.'); process.exit(1); }

const tail = src.slice(effStart);
const closeIdx = tail.indexOf('});');
if (closeIdx < 0) { console.error('[fix] Could not find end of auto-accept effect. Aborting.'); process.exit(1); }

const effEnd = effStart + closeIdx + 3; // include "});"
const effectBlock = src.slice(effStart, effEnd);

// remove block
let rest = src.slice(0, effStart) + src.slice(effEnd);

// insert just before loading early return
const head = rest.slice(0, loadingIdx);
const after = rest.slice(loadingIdx);
const out = head + '\n' + effectBlock + '\n' + after;

fs.writeFileSync(path, out, 'utf8');

// warn if any other effects remain below the loading return
const below = out.slice(out.indexOf('if (loading) return'));
const rem = (below.match(/\buseEffect\s*\(/g) || []).length;
if (rem > 0) console.warn(`[fix] Warning: ${rem} useEffect hook(s) remain below the loading return.`); else console.log('[fix] Success.');
