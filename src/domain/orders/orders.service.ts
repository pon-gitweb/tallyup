/**
 * Orders domain public API.
 * During migration, we wrap existing implementations here.
 * Screens should import from `src/domain/orders` eventually.
 */
import { runAISuggest as runAISuggestLegacy } from '../../services/orders/suggestAI';
import { OrdersRepo } from './orders.repo';
import { buildSuggestedOrdersInMemory as buildSuggestedOrdersInMemoryLegacy } from '../../services/orders/suggest';
import {
  createDraftsFromSuggestions as createDraftsFromSuggestionsLegacy,
  computeSuggestionKey as computeSuggestionKeyLegacy,
} from '../../services/orders/createFromSuggestions';

export const OrdersService = {
  finalizeReceiveFromPdf: (...args: Parameters<typeof OrdersRepo.finalizeReceiveFromPdf>) => OrdersRepo.finalizeReceiveFromPdf(...args),
  finalizeReceiveFromCsv: (...args: Parameters<typeof OrdersRepo.finalizeReceiveFromCsv>) => OrdersRepo.finalizeReceiveFromCsv(...args),
  submitOrHoldDraftOrder: (...args: Parameters<typeof OrdersRepo.submitOrHoldDraftOrder>) => OrdersRepo.submitOrHoldDraftOrder(...args),
  submitDraftOrder: (...args: Parameters<typeof OrdersRepo.submitDraftOrder>) => OrdersRepo.submitDraftOrder(...args),
  deleteDraft: (...args: Parameters<typeof OrdersRepo.deleteDraft>) => OrdersRepo.deleteDraft(...args),
  runAISuggest: runAISuggestLegacy,
  buildSuggestedOrdersInMemory: buildSuggestedOrdersInMemoryLegacy,

  createDraftsFromSuggestions: createDraftsFromSuggestionsLegacy,
  computeSuggestionKey: computeSuggestionKeyLegacy,

  listSubmittedOrders: (...args: Parameters<typeof OrdersRepo.listSubmittedOrders>) => OrdersRepo.listSubmittedOrders(...args),
};
