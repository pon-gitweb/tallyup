import fs from 'node:fs';
import path from 'node:path';
const OUT = path.join(process.cwd(), 'supplier_catalogs/normalized');
if (!fs.existsSync(OUT)) { console.log('No normalized folder yet. Run: npm run catalog:parse'); process.exit(0); }
const files = fs.readdirSync(OUT).filter(f => f.endsWith('.csv'));
for (const f of files) {
  const p = path.join(OUT, f);
  const lines = fs.readFileSync(p, 'utf8').split('\n').slice(0, 8);
  console.log(`\n== ${f} ==\n${lines.join('\n')}`);
}
