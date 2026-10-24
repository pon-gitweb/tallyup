import * as fs from 'fs';
import * as path from 'path';
import { SUPPLIER_REGISTRATION_OPEN } from '../supplierRegistrationGate';

describe('SUPPLIER_REGISTRATION_OPEN', () => {
  test('is false — registration is closed', () => {
    expect(SUPPLIER_REGISTRATION_OPEN).toBe(false);
  });

  test('gate check is the first statement in the /supplier-register handler', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'api.ts'), 'utf8');

    // Find the handler body start
    const handlerStart = src.indexOf('app.post("/supplier-register"');
    expect(handlerStart).toBeGreaterThan(-1);

    // Find the opening brace of the async callback body
    const asyncArrowIdx = src.indexOf('async (req, res) => {', handlerStart);
    expect(asyncArrowIdx).toBeGreaterThan(-1);
    const bodyStart = asyncArrowIdx + 'async (req, res) => {'.length;

    // Find where the gate check appears
    const gateIdx = src.indexOf('SUPPLIER_REGISTRATION_OPEN', bodyStart);
    expect(gateIdx).toBeGreaterThan(-1);

    // Assert the gate check comes before any of the deferred operations
    const laterOps = ['checkRateLimit', 'req.body', 'collection("supplierRegistrations")', 'sendMail'];
    for (const op of laterOps) {
      const opIdx = src.indexOf(op, bodyStart);
      if (opIdx !== -1) {
        expect(gateIdx).toBeLessThan(opIdx);
      }
    }

    // Assert the gate block contains res.status(503) and a return
    // Extract the text between the gate check and the first 'try {'
    const tryIdx = src.indexOf('try {', gateIdx);
    const gateBlock = src.slice(gateIdx, tryIdx);
    expect(gateBlock).toContain('res.status(503)');
    expect(gateBlock).toContain('return');
  });
});
