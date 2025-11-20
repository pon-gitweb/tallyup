// @ts-nocheck

export type DataQualityInputs = {
  stock: {
    departments: number;
    areasTotal: number;
    areasCompleted: number;
    areasInProgress: number;
  };
  sales: {
    docs: number;
    totalNetSales: number | null;
  };
  spend: {
    docs: number;
    totalSpend: number | null;
  };
  variance: {
    totalShrinkValue: number | null;
  };
};

export type DataQualityAssessment = {
  level: 'good' | 'ok' | 'limited';
  flags: string[];
};

/**
 * Turn raw stats into human, honest flags about how trustworthy the report is.
 * No Firestore calls here – this stays pure and reusable.
 */
export function assessDataQuality(input: DataQualityInputs): DataQualityAssessment {
  const flags: string[] = [];

  const { stock, sales, spend, variance } = input;

  // Stock coverage
  if (stock.areasTotal === 0) {
    flags.push('No areas configured yet — stock coverage is incomplete.');
  } else if (stock.areasCompleted === 0) {
    flags.push('No areas fully completed in this window — stocktake still in progress.');
  } else if (stock.areasCompleted < stock.areasTotal) {
    flags.push(
      `${stock.areasCompleted}/${stock.areasTotal} areas completed — results may not reflect the whole venue.`,
    );
  }

  // Sales
  if (sales.docs === 0) {
    flags.push('No sales records found for this period — GP and performance are limited.');
  } else if (sales.totalNetSales == null) {
    flags.push('Sales records exist, but no net sales value was found.');
  }

  // Spend / invoices
  if (spend.docs === 0) {
    flags.push('No invoices imported for this period — landed GP is estimated only.');
  } else if (spend.totalSpend == null) {
    flags.push('Invoices exist, but no spend total was found.');
  }

  // Variance / shrinkage
  if (typeof variance.totalShrinkValue === 'number' && variance.totalShrinkValue > 0) {
    flags.push(
      'Shrinkage detected this period — review variance to see which products are leaking margin.',
    );
  }

  // If nothing else, data looks good
  if (!flags.length) {
    flags.push('Data looks good — this report is based on complete, recent information.');
  }

  // Decide level
  let level: DataQualityAssessment['level'] = 'good';

  // Very limited if no sales or no invoices or no completed areas
  if (
    stock.areasTotal === 0 ||
    stock.areasCompleted === 0 ||
    sales.docs === 0 ||
    spend.docs === 0
  ) {
    level = 'limited';
  } else if (flags.length > 1) {
    level = 'ok';
  }

  return { level, flags };
}
