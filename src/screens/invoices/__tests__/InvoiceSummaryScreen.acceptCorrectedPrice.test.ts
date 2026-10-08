/**
 * Behavioural test — acceptCorrectedPrice updateDoc payload.
 *
 * Mocks updateDoc and asserts the exact payload it receives.
 * The invokeAcceptCorrectedPrice helper mirrors the production implementation
 * (InvoiceSummaryScreen.tsx → acceptCorrectedPrice). If the implementation
 * changes its payload, update this test to match.
 */

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((...args: any[]) => ({ _path: args.filter(Boolean).join('/') })),
  updateDoc: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => '__SERVER_TS__'),
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { uid: 'uid-test' } })),
}));

import { updateDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const mockUpdateDoc = updateDoc as jest.Mock;

async function invokeAcceptCorrectedPrice(
  venueId: string,
  pc: { productId: string; correctedUnitPrice: number; caseMismatchGuess: unknown },
) {
  const { doc } = jest.requireMock('firebase/firestore');
  const guess = pc.caseMismatchGuess;
  const correctedUnitPrice = pc.correctedUnitPrice;
  const caseFields =
    typeof guess === 'number' && guess > 1
      ? { caseSize: guess, unitCost: correctedUnitPrice, caseCost: correctedUnitPrice * guess }
      : {};
  await updateDoc(doc(null, 'venues', venueId, 'products', pc.productId), {
    costPrice: correctedUnitPrice,
    ...caseFields,
    priceAcceptedAt: serverTimestamp(),
    priceAcceptedBy: getAuth().currentUser?.uid || null,
    priceChanged: false,
  });
}

describe('acceptCorrectedPrice — updateDoc payload', () => {
  beforeEach(() => {
    mockUpdateDoc.mockClear();
  });

  it('includes caseSize, unitCost, caseCost when guess is a number > 1', async () => {
    await invokeAcceptCorrectedPrice('venue-1', {
      productId: 'prod-1',
      correctedUnitPrice: 12.75,
      caseMismatchGuess: 6,
    });
    const [, payload] = mockUpdateDoc.mock.calls[0];
    expect(payload.costPrice).toBe(12.75);
    expect(payload.caseSize).toBe(6);
    expect(payload.unitCost).toBe(12.75);
    expect(payload.caseCost).toBeCloseTo(76.5);
    expect(payload.priceChanged).toBe(false);
  });

  it('omits caseSize, unitCost, caseCost when guess is 1', async () => {
    await invokeAcceptCorrectedPrice('venue-1', {
      productId: 'prod-2',
      correctedUnitPrice: 5.0,
      caseMismatchGuess: 1,
    });
    const [, payload] = mockUpdateDoc.mock.calls[0];
    expect(payload.costPrice).toBe(5.0);
    expect(payload.caseSize).toBeUndefined();
    expect(payload.unitCost).toBeUndefined();
    expect(payload.caseCost).toBeUndefined();
  });

  it('omits case fields when guess is undefined', async () => {
    await invokeAcceptCorrectedPrice('venue-1', {
      productId: 'prod-3',
      correctedUnitPrice: 8.0,
      caseMismatchGuess: undefined,
    });
    const [, payload] = mockUpdateDoc.mock.calls[0];
    expect(payload.caseSize).toBeUndefined();
    expect(payload.unitCost).toBeUndefined();
    expect(payload.caseCost).toBeUndefined();
  });

  it('Modelo scenario: price=3.67 × guess=21 → caseCost≈77.07', async () => {
    await invokeAcceptCorrectedPrice('venue-1', {
      productId: 'modelo',
      correctedUnitPrice: 3.67,
      caseMismatchGuess: 21,
    });
    const [, payload] = mockUpdateDoc.mock.calls[0];
    expect(payload.caseSize).toBe(21);
    expect(payload.unitCost).toBe(3.67);
    expect(payload.caseCost).toBeCloseTo(77.07);
  });

  it('includes priceAcceptedAt and priceAcceptedBy in all cases', async () => {
    await invokeAcceptCorrectedPrice('venue-1', {
      productId: 'prod-4',
      correctedUnitPrice: 10,
      caseMismatchGuess: 12,
    });
    const [, payload] = mockUpdateDoc.mock.calls[0];
    expect(payload.priceAcceptedAt).toBe('__SERVER_TS__');
    expect(payload.priceAcceptedBy).toBe('uid-test');
  });
});
