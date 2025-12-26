export type SuggestContext = {
  par?: number | null;
  onHand?: number | null;
  packSize?: number | null;
  moq?: number | null;
  avgDailySales?: number | null;  // optional; if null we still compute
  leadTimeDays?: number | null;   // optional
  roundToPack?: boolean;
};

export type SuggestResult = {
  baseDeficit: number;
  suggestedQty: number;
  estDaysToSell: number | null;
  applied: { pack: boolean; moq: boolean; leadTime: boolean; parUsed: boolean };
  notes: string[];
};

export function computeSuggestionForItem(ctx: SuggestContext): SuggestResult {
  const notes: string[] = [];
  const par = typeof ctx.par === 'number' ? ctx.par : null;
  const onHand = typeof ctx.onHand === 'number' ? ctx.onHand : 0;
  const pack = typeof ctx.packSize === 'number' && ctx.packSize > 0 ? Math.floor(ctx.packSize) : null;
  const moq  = typeof ctx.moq === 'number' && ctx.moq > 0 ? Math.floor(ctx.moq) : null;
  const avg  = typeof ctx.avgDailySales === 'number' && ctx.avgDailySales >= 0 ? ctx.avgDailySales : null;
  const lead = typeof ctx.leadTimeDays === 'number' && ctx.leadTimeDays > 0 ? Math.floor(ctx.leadTimeDays) : null;

  const baseDeficit = par == null ? 0 : Math.max(par - onHand, 0);

  let qty = baseDeficit;
  if (par == null && onHand <= 0) {
    if (pack) { qty = Math.max(qty, pack); notes.push('no par → pack'); }
    if (moq)  { qty = Math.max(qty, moq);  notes.push('no par → MOQ'); }
  }

  let packApplied = false;
  if (ctx.roundToPack && pack && qty > 0) {
    qty = Math.ceil(qty / pack) * pack;
    packApplied = true;
  }

  let moqApplied = false;
  if (moq && qty > 0 && qty < moq) {
    qty = moq;
    moqApplied = true;
  }

  let estDaysToSell: number | null = null;
  if (avg == null) notes.push('no avg sales');
  else if (avg === 0) notes.push('avg sales 0');
  else estDaysToSell = Math.ceil(qty / avg);

  if (lead == null) notes.push('no lead time');

  return {
    baseDeficit,
    suggestedQty: qty,
    estDaysToSell,
    applied: { pack: packApplied, moq: moqApplied, leadTime: !!lead, parUsed: par != null },
    notes,
  };
}
