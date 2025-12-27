/**
 * Orders domain public API.
 * During migration, we wrap existing implementations here.
 * Screens should import from `src/domain/orders` eventually.
 */
import { runAISuggest as runAISuggestLegacy } from '../../services/orders/suggestAI';
import { buildSuggestedOrdersInMemory as buildSuggestedOrdersInMemoryLegacy } from '../../services/orders/suggest';
import {
  createDraftsFromSuggestions as createDraftsFromSuggestionsLegacy,
  computeSuggestionKey as computeSuggestionKeyLegacy,
} from '../../services/orders/createFromSuggestions';
import { listSubmittedOrders as listSubmittedOrdersLegacy } from '../../services/orders/listSubmittedOrders';
import { submitDraftOrder as submitDraftOrderLegacy } from '../../services/orders/submit';
import { deleteDraft as deleteDraftLegacy } from '../../services/orders/deleteDraft';
import { finalizeReceiveFromCsv as finalizeReceiveFromCsvLegacy, finalizeReceiveFromPdf as finalizeReceiveFromPdfLegacy } from '../../services/orders/receive';

export const OrdersService = {
  runAISuggest: runAISuggestLegacy,
  buildSuggestedOrdersInMemory: buildSuggestedOrdersInMemoryLegacy,

  createDraftsFromSuggestions: createDraftsFromSuggestionsLegacy,
  computeSuggestionKey: computeSuggestionKeyLegacy,

  listSubmittedOrders: listSubmittedOrdersLegacy,
  submitDraftOrder: submitDraftOrderLegacy,
  deleteDraft: deleteDraftLegacy,
  finalizeReceiveFromCsv: finalizeReceiveFromCsvLegacy,
  finalizeReceiveFromPdf: finalizeReceiveFromPdfLegacy,
};
