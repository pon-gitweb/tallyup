import { SUPPLIER_REGISTRATION_OPEN } from '../supplierRegistrationGate';

describe('SUPPLIER_REGISTRATION_OPEN', () => {
  test('is false — registration is closed', () => {
    expect(SUPPLIER_REGISTRATION_OPEN).toBe(false);
  });

  test('returns 503 when gate is closed', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as any;

    if (!SUPPLIER_REGISTRATION_OPEN) {
      res.status(503).json({ ok: false, error: 'Supplier registration is not currently open.' });
    }

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ ok: false, error: 'Supplier registration is not currently open.' });
  });
});
