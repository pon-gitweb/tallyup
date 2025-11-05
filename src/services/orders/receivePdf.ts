/**
 * PDF finalize helper that reuses the same core routine as CSV, because
 * both produce the identical parsed payload shape:
 *   { invoice, lines, matchReport, confidence, warnings }
 */
import { finalizeReceiveFromCsv } from './receive';

export const finalizeReceiveFromPdf = finalizeReceiveFromCsv;
export default finalizeReceiveFromPdf;
