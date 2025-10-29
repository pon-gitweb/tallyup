// @ts-nocheck
/**
 * Expo-safe CSV utilities (no Node streams, no native deps).
 * Handles common RFC4180 cases: quoted fields, commas, CRLF/LF, escaped quotes.
 * Provides:
 *  - parseCsv(text): { headers: string[], rows: string[][] }
 *  - toObjects({headers, rows}): Array<Record<string,string>>
 *  - autoHeaderMap(headers, wanted): Record<wantedKey, headerName|null>
 *  - remapObjects(rows, map): Array<Record<string,string>>
 */

function _splitLines(text:string): string[] {
  // Normalize newlines to \n and split
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

export function parseCsv(text:string): { headers:string[]; rows:string[][] } {
  const out:string[][] = [];
  const lines = _splitLines(text);

  for (let i=0;i<lines.length;i++){
    const line = lines[i];
    const row:string[] = [];
    let cur = '';
    let inQ = false;

    for (let j=0;j<line.length;j++){
      const ch = line[j];
      if (inQ) {
        if (ch === '"') {
          const next = line[j+1];
          if (next === '"') { cur += '"'; j++; } // escaped quote ""
          else { inQ = false; }
        } else {
          cur += ch;
        }
      } else {
        if (ch === ',') {
          row.push(cur);
          cur = '';
        } else if (ch === '"') {
          inQ = true;
        } else {
          cur += ch;
        }
      }
    }
    row.push(cur);

    // Handle multi-line quoted fields: if still open, merge with next lines
    if (inQ) {
      let k = i + 1;
      let acc = row.pop() || '';
      while (k < lines.length) {
        const nxt = lines[k];
        acc += '\n' + nxt;
        // try to close quotes by re-parsing a fake line
        let tmp = acc;
        let open = false;
        for (let t=0;t<tmp.length;t++){
          if (tmp[t] === '"') {
            const nn = tmp[t+1];
            if (nn === '"') { t++; continue; }
            open = !open;
          }
        }
        i = k;
        if (!open) break;
        k++;
      }
      row.push(acc);
    }

    // Skip pure blanks after header
    const nonEmpty = row.some(c => String(c).trim().length>0);
    if (out.length === 0 || nonEmpty) out.push(row);
  }

  const headers = (out.shift() || []).map(h => String(h || '').trim());
  // Pad rows to headers length
  const rows = out.map(r => {
    const c = r.slice(0, headers.length);
    while (c.length < headers.length) c.push('');
    return c;
  });

  return { headers, rows };
}

export function toObjects(parsed:{headers:string[], rows:string[][]}) {
  const { headers, rows } = parsed || { headers:[], rows:[] };
  return rows.map((r) => {
    const o:any = {};
    headers.forEach((h, idx) => { o[h] = r[idx] ?? ''; });
    return o;
  });
}

/** Build a best-effort header mapping from the CSV headers to desired keys. */
export function autoHeaderMap(headers:string[], wanted:string[]): Record<string,string|null> {
  const map:Record<string,string|null> = {};
  const norm = (s:string)=>String(s||'').toLowerCase().replace(/\s+/g,'').replace(/[_-]/g,'');
  const H = headers.map(h => ({ h, n: norm(h) }));

  wanted.forEach(w => {
    const nw = norm(w);
    let hit = H.find(x => x.n === nw);
    if (!hit) {
      // heuristics
      hit = H.find(x => x.n === nw + 'name') || H.find(x => x.n === nw + 'id');
      if (!hit) {
        // some common aliases
        const aliases:Record<string,string[]> = {
          name: ['product','item','title'],
          unit: ['uom','measure','units'],
          supplierid: ['supplier','vendor','suppliercode','supplier_id'],
          suppliername: ['supplier','vendor','supplier_title'],
          costprice: ['price','cost','unitcost'],
          packsize: ['pack','case','carton','qtyperpack'],
          parlevel: ['par','parqty','minstock'],
        };
        const list = aliases[nw] || [];
        hit = H.find(x => list.includes(x.n));
      }
    }
    map[w] = hit ? hit.h : null;
  });

  return map;
}

/** Remap array of objects with a {wantedKey: headerName|null} map. */
export function remapObjects(objs:Array<Record<string,any>>, map:Record<string,string|null>) {
  return objs.map(o => {
    const r:any = {};
    Object.keys(map||{}).forEach((k) => {
      const src = map[k];
      r[k] = src ? (o[src] ?? '') : '';
    });
    return r;
  });
}
