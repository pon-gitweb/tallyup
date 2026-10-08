/**
 * A3 structural test — acceptCorrectedPrice writes caseSize = pc.caseMismatchGuess
 *
 * The function is async/Firestore so we verify the source rather than mocking the call.
 * Both fields (costPrice and caseSize) must appear in the same updateDoc call.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../InvoiceSummaryScreen.tsx'),
  'utf8',
);

describe('A3 structural — acceptCorrectedPrice in InvoiceSummaryScreen', () => {
  // Find the function body: from `async function acceptCorrectedPrice` to the closing brace
  const fnStart = SRC.indexOf('async function acceptCorrectedPrice');
  const fnEnd = SRC.indexOf('\n  }', fnStart + 10) + 4; // grab past closing brace
  const FN = SRC.slice(fnStart, fnEnd);

  it('A3-1: function exists in source', () => {
    expect(fnStart).toBeGreaterThan(0);
  });

  it('A3-2: writes costPrice: pc.correctedUnitPrice', () => {
    expect(FN).toContain('costPrice: pc.correctedUnitPrice');
  });

  it('A3-3: writes caseSize: pc.caseMismatchGuess alongside costPrice', () => {
    expect(FN).toContain('caseSize: pc.caseMismatchGuess');
  });

  it('A3-4: both fields are in the same updateDoc call', () => {
    const updateDocStart = FN.indexOf('updateDoc(');
    const updateDocEnd   = FN.indexOf(');', updateDocStart);
    const updateDocBlock = FN.slice(updateDocStart, updateDocEnd);
    expect(updateDocBlock).toContain('costPrice: pc.correctedUnitPrice');
    expect(updateDocBlock).toContain('caseSize: pc.caseMismatchGuess');
  });

  it('A3-5: is guarded by invoiceGuard.allowed check', () => {
    expect(FN).toContain('invoiceGuard.allowed');
  });
});
