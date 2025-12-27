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
  runAISuggest: runAISuggestLegacy,
  buildSuggestedOrdersInMemory: buildSuggestedOrdersInMemoryLegacy,

  createDraftsFromSuggestions: createDraftsFromSuggestionsLegacy,
  computeSuggestionKey: computeSuggestionKeyLegacy,

  listSubmittedOrders: OrdersRepo.listSubmittedOrders,
  deleteDraft: OrdersRepo.deleteDraft,
  submitDraftOrder: OrdersRepo.submitDraftOrder,
  submitOrHoldDraftOrder: OrdersRepo.submitOrHoldDraftOrder,
  finalizeReceiveFromCsv: OrdersRepo.finalizeReceiveFromCsv,
  finalizeReceiveFromPdf: OrdersRepo.finalizeReceiveFromPdf,
};
