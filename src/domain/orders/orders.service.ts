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
  finalizeReceiveFromPdf: (OrdersRepo as any).finalizeReceiveFromPdf,
  finalizeReceiveFromCsv: (OrdersRepo as any).finalizeReceiveFromCsv,
  submitOrHoldDraftOrder: OrdersRepo.submitOrHoldDraftOrder,
  submitDraftOrder: OrdersRepo.submitDraftOrder,
  deleteDraft: OrdersRepo.deleteDraft,
  runAISuggest: runAISuggestLegacy,
  buildSuggestedOrdersInMemory: buildSuggestedOrdersInMemoryLegacy,

  createDraftsFromSuggestions: createDraftsFromSuggestionsLegacy,
  computeSuggestionKey: computeSuggestionKeyLegacy,

  listSubmittedOrders: OrdersRepo.listSubmittedOrders,
};
